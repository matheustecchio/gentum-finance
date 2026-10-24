//go:build integration

package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
)

func TestRecurringConfirmationAutomationAndImport(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	repo := finance.PostgresRepository{Pool: pool}
	s := finance.Service{Repository: repo, CurrentUser: owner(user)}
	a, err := (account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}).Create(ctx, account.Input{Name: "Recurring test", Type: "CASH", Currency: "EUR", InitialBalance: 100000})
	if err != nil {
		t.Fatal(err)
	}
	must := func(action string, in finance.Row) {
		t.Helper()
		if _, err := s.Execute(ctx, action, in); err != nil {
			t.Fatal(action, err)
		}
	}
	must("category", finance.Row{"name": "Bills", "kind": "EXPENSE"})
	month := time.Now().UTC().Format("2006-01")
	day := time.Now().UTC().Format("2006-01-02")
	snap, err := s.Snapshot(ctx, month)
	if err != nil {
		t.Fatal(err)
	}
	cat := snap.Categories[0]["id"]
	schedule := func(desc, mode string) string {
		t.Helper()
		must("recurring", finance.Row{"accountId": a.ID, "categoryId": cat, "kind": "EXPENSE", "amount": "1500", "date": day, "description": desc, "frequency": "monthly", "mode": mode})
		var id string
		if err := pool.QueryRow(ctx, `SELECT id::text FROM recurring WHERE user_id=$1 AND description=$2`, user, desc).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	occurrence := func(id string) finance.Row {
		t.Helper()
		snap, e := s.Snapshot(ctx, month)
		if e != nil {
			t.Fatal(e)
		}
		for _, o := range snap.Occurrences {
			if o["recurringId"] == id && o["status"] != "upcoming" {
				return o
			}
		}
		t.Fatal("missing occurrence")
		return nil
	}
	balance := func(want string) {
		t.Helper()
		snap, e := s.Snapshot(ctx, month)
		if e != nil || snap.Accounts[0]["balance"] != want {
			t.Fatal("balance", snap.Accounts, e, "want", want)
		}
	}
	manual := schedule("Variable bill", "manual")
	must("processRecurring", finance.Row{})
	balance("100000")
	o := occurrence(manual)
	if o["status"] != "pending" {
		t.Fatal(o)
	}
	must("editOccurrence", finance.Row{"occurrenceId": o["id"], "amount": "1700", "description": "Actual bill"})
	balance("100000")
	must("confirmOccurrence", finance.Row{"occurrenceId": o["id"]})
	balance("98300")
	if _, e := s.Execute(ctx, "confirmOccurrence", finance.Row{"occurrenceId": o["id"]}); e == nil {
		t.Fatal("confirmed twice")
	}
	auto := schedule("Fixed subscription", "automatic")
	var wg sync.WaitGroup
	errors := make(chan error, 4)
	for range 4 {
		wg.Go(func() { _, e := s.Execute(ctx, "processRecurring", finance.Row{}); errors <- e })
	}
	wg.Wait()
	close(errors)
	for e := range errors {
		if e != nil {
			t.Fatal(e)
		}
	}
	balance("96800")
	if occurrence(auto)["status"] != "posted" {
		t.Fatal(occurrence(auto))
	}
	// Reimporting the generated charge links it rather than adding money twice.
	csv := fmt.Sprintf("date,kind,category_id,amount_cents,description\n%s,EXPENSE,%s,1500,Fixed subscription\n", day, cat)
	preview, e := s.PreviewImport(ctx, finance.Row{"accountId": a.ID, "csv": csv})
	if e != nil || len(preview.Errors) != 0 || preview.Transactions[0]["recurringMatch"] == "" {
		t.Fatal(preview, e)
	}
	must("import", finance.Row{"accountId": a.ID, "csv": csv})
	balance("96800")
	if occurrence(auto)["status"] != "linked" {
		t.Fatal(occurrence(auto))
	}
	// Pending occurrence imports are posted exactly once.
	pending := schedule("Manual subscription", "manual")
	must("processRecurring", finance.Row{})
	csv = strings.ReplaceAll(csv, "Fixed subscription", "Manual subscription")
	must("import", finance.Row{"accountId": a.ID, "csv": csv})
	balance("95300")
	if occurrence(pending)["status"] != "linked" {
		t.Fatal(occurrence(pending))
	}
	// Existing manual/imported transaction is matched when processing catches up.
	must("transaction", finance.Row{"accountId": a.ID, "categoryId": cat, "kind": "EXPENSE", "amount": "1500", "date": day, "description": "Imported first"})
	before := schedule("Imported first", "automatic")
	must("processRecurring", finance.Row{})
	balance("93800")
	if occurrence(before)["status"] != "linked" {
		t.Fatal(occurrence(before))
	}
	skip := schedule("Skip me", "manual")
	must("processRecurring", finance.Row{})
	o = occurrence(skip)
	must("skipOccurrence", finance.Row{"occurrenceId": o["id"]})
	must("processRecurring", finance.Row{})
	balance("93800")
	// Future edits preserve the frozen pending occurrence.
	edit := schedule("Edit me", "manual")
	must("processRecurring", finance.Row{})
	o = occurrence(edit)
	next := time.Now().UTC().AddDate(0, 1, 0).Format("2006-01-02")
	must("editRecurring", finance.Row{"id": edit, "accountId": a.ID, "categoryId": cat, "kind": "EXPENSE", "amount": "9900", "date": next, "description": "New amount", "frequency": "yearly", "mode": "automatic"})
	if occurrence(edit)["amount"] != "1500" {
		t.Fatal("mutated pending")
	}
	must("stopRecurring", finance.Row{"id": edit})
	must("resumeRecurring", finance.Row{"id": edit})
	if _, e := s.Execute(ctx, "editRecurring", finance.Row{"id": edit, "accountId": a.ID, "categoryId": cat, "kind": "EXPENSE", "amount": "9900", "date": day}); e == nil {
		t.Fatal("rewound series")
	}
	// Linking a variable imported record replaces an automatic generated entry.
	variable := schedule("Variable match", "automatic")
	must("processRecurring", finance.Row{})
	balance("92300")
	must("transaction", finance.Row{"accountId": a.ID, "categoryId": cat, "kind": "EXPENSE", "amount": "1800", "date": day, "description": "Actual variable"})
	var actual string
	if e := pool.QueryRow(ctx, `SELECT id::text FROM entry WHERE user_id=$1 AND description='Actual variable'`, user).Scan(&actual); e != nil {
		t.Fatal(e)
	}
	must("linkOccurrence", finance.Row{"occurrenceId": occurrence(variable)["id"], "entryId": actual})
	balance("92000")
	if occurrence(variable)["amount"] != "1800" {
		t.Fatal("linked amount not actual")
	}
	// The background CSV worker uses the same matching contract as preview/import.
	jobSchedule := schedule("Worker import", "automatic")
	must("processRecurring", finance.Row{})
	balance("90500")
	jobID := security.ID()
	jobCSV := fmt.Sprintf("date,kind,category_id,amount_cents,description\n%s,EXPENSE,%s,1500,Worker import\n", day, cat)
	if _, e := s.ImportJob(ctx, "start", finance.Row{"id": jobID, "accountId": a.ID, "csv": jobCSV}); e != nil {
		t.Fatal(e)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		j, e := s.ImportJob(ctx, "status", finance.Row{"id": jobID})
		if e != nil {
			t.Fatal(e)
		}
		if j.Status != "running" {
			if j.Status != "committed" {
				t.Fatal(j)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("worker timeout")
		}
		time.Sleep(10 * time.Millisecond)
	}
	balance("90500")
	if occurrence(jobSchedule)["status"] != "linked" {
		t.Fatal("worker did not match")
	}
	// Foreign owners cannot confirm/link/change schedules.
	other := security.ID()
	if _, e := pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'recurring-other@example.test','Other','EUR',now(),now())`, other); e != nil {
		t.Fatal(e)
	}
	foreign := finance.Service{Repository: repo, CurrentUser: owner(other)}
	for _, action := range []string{"confirmOccurrence", "skipOccurrence", "editOccurrence", "linkOccurrence"} {
		if _, e := foreign.Execute(ctx, action, finance.Row{"occurrenceId": o["id"], "amount": "1", "entryId": security.ID()}); e == nil {
			t.Fatal("foreign", action)
		}
	}
	if _, e := foreign.Execute(ctx, "stopRecurring", finance.Row{"id": edit}); e == nil {
		t.Fatal("foreign stop")
	}
}

func TestRecurringCatchupAndOverflowRollback(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if e := Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	user := "00000000-0000-0000-0000-000000000001"
	repo := finance.PostgresRepository{Pool: pool}
	s := finance.Service{Repository: repo, CurrentUser: owner(user)}
	a, e := (account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}).Create(ctx, account.Input{Name: "Overflow", Type: "CASH", Currency: "EUR", InitialBalance: 9223372036854775807})
	if e != nil {
		t.Fatal(e)
	}
	exec := func(action string, in finance.Row) {
		t.Helper()
		if _, e := s.Execute(ctx, action, in); e != nil {
			t.Fatal(action, e)
		}
	}
	exec("category", finance.Row{"name": "Pay", "kind": "INCOME"})
	var cat string
	if e := pool.QueryRow(ctx, `SELECT id::text FROM category WHERE user_id=$1`, user).Scan(&cat); e != nil {
		t.Fatal(e)
	}
	today := time.Now().UTC()
	day := today.Format("2006-01-02")
	exec("recurring", finance.Row{"accountId": a.ID, "categoryId": cat, "kind": "INCOME", "amount": "1", "date": day, "mode": "automatic"})
	if _, e := s.Execute(ctx, "processRecurring", finance.Row{}); e == nil {
		t.Fatal("accepted overflow")
	}
	var count int
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM recurring_occurrence WHERE user_id=$1`, user).Scan(&count); e != nil || count != 0 {
		t.Fatal("partial occurrence", count, e)
	}
	var schedule string
	pool.QueryRow(ctx, `SELECT id::text FROM recurring WHERE user_id=$1`, user).Scan(&schedule)
	exec("stopRecurring", finance.Row{"id": schedule})
	// Weekly catch-up creates all overdue pending records without touching money.
	start := today.AddDate(0, 0, -21).Format("2006-01-02")
	exec("recurring", finance.Row{"accountId": a.ID, "categoryId": cat, "kind": "INCOME", "amount": "1", "date": start, "mode": "manual", "frequency": "weekly"})
	exec("processRecurring", finance.Row{})
	exec("processRecurring", finance.Row{})
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM recurring_occurrence WHERE user_id=$1 AND status='pending'`, user).Scan(&count); e != nil || count != 4 {
		t.Fatal("catchup", count, e)
	}
	snap, e := s.Snapshot(ctx, today.Format("2006-01"))
	if e != nil {
		t.Fatal(e)
	}
	for _, o := range snap.Occurrences {
		if o["status"] == "pending" {
			if _, e := s.Execute(ctx, "confirmOccurrence", finance.Row{"occurrenceId": o["id"]}); e == nil {
				t.Fatal("confirmed overflow")
			}
			break
		}
	}
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM entry WHERE user_id=$1`, user).Scan(&count); e != nil || count != 0 {
		t.Fatal("partial entries", count, e)
	}
}

func TestRecurringUpgradePreservesLegacyEntries(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	// Build an actual V12 database with the original migration checksums.
	if _, e := pool.Exec(ctx, `CREATE TABLE gentum_schema_migration(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); e != nil {
		t.Fatal(e)
	}
	files, _ := migrations.ReadDir("migrations")
	for version := 1; version <= 12; version++ {
		for _, f := range files {
			if !strings.HasPrefix(f.Name(), fmt.Sprintf("V%d__", version)) {
				continue
			}
			sql, e := migrations.ReadFile("migrations/" + f.Name())
			if e != nil {
				t.Fatal(e)
			}
			if _, e = pool.Exec(ctx, string(sql)); e != nil {
				t.Fatal(e)
			}
			if _, e = pool.Exec(ctx, `INSERT INTO gentum_schema_migration(version,checksum) VALUES($1,$2)`, version, fmt.Sprintf("%x", sha256.Sum256(sql))); e != nil {
				t.Fatal(e)
			}
		}
	}
	user := "00000000-0000-0000-0000-000000000001"
	a, c, s, e := security.ID(), security.ID(), security.ID(), security.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO account(id,user_id,name,type,currency,initial_balance,created_at,updated_at) VALUES($1,$2,'Legacy','CASH','EUR',10000,now(),now())`, a, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO category(id,user_id,name,kind) VALUES($1,$2,'Legacy','EXPENSE')`, c, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO recurring(id,user_id,account_id,category_id,kind,amount,description,next_date,anchor_day) VALUES($1,$2,$3,$4,'EXPENSE',100,'Legacy','2026-02-28',31)`, s, user, a, c); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO entry(id,user_id,account_id,category_id,kind,amount,description,entry_date,recurring_id) VALUES($1,$2,$3,$4,'EXPENSE',100,'Legacy','2026-01-31',$5)`, e, user, a, c, s); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var mode, status, entry string
	var anchor int
	if err := pool.QueryRow(ctx, `SELECT mode,anchor_day FROM recurring WHERE id=$1`, s).Scan(&mode, &anchor); err != nil || mode != "manual" || anchor != 31 {
		t.Fatal(mode, anchor, err)
	}
	if err := pool.QueryRow(ctx, `SELECT status,entry_id::text FROM recurring_occurrence WHERE recurring_id=$1`, s).Scan(&status, &entry); err != nil || status != "posted" || entry != e {
		t.Fatal(status, entry, err)
	}
}
