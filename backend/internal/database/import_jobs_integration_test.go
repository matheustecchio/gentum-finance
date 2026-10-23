//go:build integration

package database

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
)

func TestLargeAtomicImportJobs(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	svc := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	ac := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := ac.Create(ctx, account.Input{Name: "Large CSV", Type: "CURRENT", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Execute(ctx, "category", finance.Row{"name": "Import income", "kind": "INCOME"}); err != nil {
		t.Fatal(err)
	}
	var cat string
	if err = pool.QueryRow(ctx, `SELECT id::text FROM category WHERE user_id=$1 AND name='Import income'`, user).Scan(&cat); err != nil {
		t.Fatal(err)
	}
	header := "date,kind,category_id,amount_cents,description\n"
	row := fmt.Sprintf("2026-10-01,INCOME,%s,1,Synthetic\n", cat)
	wait := func(id string) finance.ImportJob {
		t.Helper()
		end := time.Now().Add(45 * time.Second)
		for time.Now().Before(end) {
			j, e := svc.ImportJob(ctx, "status", finance.Row{"id": id})
			if e != nil {
				t.Fatal(e)
			}
			if j.Status != "running" {
				return j
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("import did not finish")
		return finance.ImportJob{}
	}
	count := func() int {
		t.Helper()
		var n int
		if e := pool.QueryRow(ctx, `SELECT count(*) FROM entry WHERE user_id=$1`, user).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	start := func(csv string) string {
		t.Helper()
		id := security.ID()
		if _, e := svc.ImportJob(ctx, "start", finance.Row{"id": id, "csv": csv, "accountId": a.ID}); e != nil {
			t.Fatal(e)
		}
		return id
	}
	// Error after 57,000 uncommitted rows must leave no financial entries.
	bad := header + strings.Repeat(row, 57000) + fmt.Sprintf("2026-10-01,INCOME,%s,0,Invalid\n", cat)
	id := start(bad)
	j := wait(id)
	if j.Status != "failed" || !strings.Contains(j.Message, "CSV record 57002") || count() != 0 {
		t.Fatal(j, count())
	}
	// Hold the owner's write lock to exercise cancellation of a waiting worker.
	lock, e := pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = lock.Exec(ctx, `LOCK TABLE entry IN SHARE MODE`); e != nil {
		t.Fatal(e)
	}
	id = start(header + row)
	if _, e = svc.ImportJob(ctx, "cancel", finance.Row{"id": id}); e != nil {
		t.Fatal(e)
	}
	j = wait(id)
	lock.Rollback(ctx)
	if j.Status != "cancelled" || count() != 0 {
		t.Fatal(j, count())
	}
	// One complete 100k file, exact totals, bounded preview and durable deduplication.
	raw := header + strings.Repeat(row, 100000)
	preview, e := svc.PreviewImport(ctx, finance.Row{"csv": raw, "accountId": a.ID})
	if e != nil || preview.Count != 100000 || len(preview.Transactions) != 50 || preview.ErrorCount != 0 {
		t.Fatal(preview.Count, e)
	}
	started := time.Now()
	id = start(raw)
	j = wait(id)
	if j.Status != "committed" || j.Processed != 100000 || count() != 100000 {
		t.Fatal(j, count())
	}
	t.Logf("100,000 records committed in %s", time.Since(started))
	duplicate := start(raw)
	if j = wait(duplicate); j.Status != "committed" || j.ID != duplicate || count() != 100000 {
		t.Fatal(j, count())
	}
	// Reusing the request ID after a lost acknowledgement must not write again.
	j, e = svc.ImportJob(ctx, "start", finance.Row{"id": id, "csv": raw, "accountId": a.ID})
	if e != nil || j.Status != "committed" || count() != 100000 {
		t.Fatal(j, e)
	}
	if _, e = svc.ImportJob(ctx, "start", finance.Row{"id": id, "csv": header + row, "accountId": a.ID}); e == nil {
		t.Fatal("reused ID for different file")
	}
	if _, e = svc.ImportJob(ctx, "cancel", finance.Row{"id": id}); e != nil {
		t.Fatal(e)
	}
	if j = wait(id); j.Status != "committed" {
		t.Fatal("cancel changed committed outcome", j)
	}
	// Foreign owners cannot observe or cancel this job.
	other := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(security.ID())}
	if j, e = other.ImportJob(ctx, "status", finance.Row{"id": id}); e != nil || j.Status == "committed" {
		t.Fatal("leaked job", j, e)
	}
	// Simulate a stopped sidecar: an unfinished marker becomes failed, never success.
	interrupted := security.ID()
	if _, e = pool.Exec(ctx, `INSERT INTO csv_import_job(id,user_id,fingerprint,status,total) VALUES($1,$2,'interrupted','running',100)`, interrupted, user); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `INSERT INTO csv_import_request(user_id,request_id,job_id) VALUES($2,$1,$1)`, interrupted, user); e != nil {
		t.Fatal(e)
	}
	if j = wait(interrupted); j.Status != "failed" || count() != 100000 {
		t.Fatal(j, count())
	}
	// Aggregate overflow is detected before commit, preserving existing data.
	overflow := header + fmt.Sprintf("2026-10-01,INCOME,%s,9223372036854775807,Overflow\n", cat)
	if j = wait(start(overflow)); j.Status != "failed" || count() != 100000 {
		t.Fatal(j, count())
	}
	var balance string
	if e = pool.QueryRow(ctx, `SELECT sum(amount)::text FROM entry WHERE user_id=$1`, user).Scan(&balance); e != nil || balance != "100000" {
		t.Fatal(balance, e)
	}
}
