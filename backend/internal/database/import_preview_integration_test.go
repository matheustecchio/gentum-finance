//go:build integration

package database

import (
	"context"
	"fmt"
	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
	"reflect"
	"strings"
	"testing"
)

func TestCSVPreviewAndRevalidation(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	svc := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	ac := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := ac.Create(ctx, account.Input{Name: "Preview wallet", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Execute(ctx, "category", finance.Row{"name": "Preview food", "kind": "EXPENSE"}); err != nil {
		t.Fatal(err)
	}
	var cat string
	if err = pool.QueryRow(ctx, `SELECT id::text FROM category WHERE user_id=$1 AND name='Preview food'`, user).Scan(&cat); err != nil {
		t.Fatal(err)
	}
	before, err := svc.Snapshot(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	header := "date,kind,category_id,amount_cents,description\n"
	raw := header + fmt.Sprintf("2026-10-01,EXPENSE,%s,9007199254740993,Exact\n", cat)
	in := finance.Row{"csv": raw, "accountId": a.ID}
	p, err := svc.PreviewImport(ctx, in)
	if err != nil || p.Count != 1 || len(p.Errors) != 0 || len(p.Transactions) != 1 || p.Transactions[0]["amount"] != "9007199254740993" || p.Transactions[0]["account"] != "Preview wallet" || p.Transactions[0]["category"] != "Preview food" || p.Transactions[0]["currency"] != "EUR" {
		t.Fatal(p, err)
	}
	after, _ := svc.Snapshot(ctx, "2026-10")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("preview wrote data")
	}
	invalid := header + fmt.Sprintf("bad,EXPENSE,%s,1,Date\n2026-10-01,EXPENSE,%s,0,Amount\n2026-10-01,EXPENSE,foreign,1,Category\n", cat, cat)
	p, err = svc.PreviewImport(ctx, finance.Row{"csv": invalid, "accountId": a.ID})
	if err != nil || len(p.Errors) != 3 || p.Errors[0]["record"] != "2" || p.Errors[2]["record"] != "4" {
		t.Fatal(p, err)
	}
	malformed := header + "2026-10-01,EXPENSE,broken\n"
	if _, err = svc.PreviewImport(ctx, finance.Row{"csv": malformed, "accountId": a.ID}); err == nil || !strings.Contains(err.Error(), "CSV record 2") {
		t.Fatal(err)
	}
	if p, err = svc.PreviewImport(ctx, finance.Row{"csv": raw, "accountId": security.ID()}); err != nil || len(p.Errors) != 1 || p.Errors[0]["record"] != "2" {
		t.Fatal(p, err)
	}
	legacy := fmt.Sprintf("date,account_id,category_id,kind,amount_cents,description\n2026-10-01,%s,%s,EXPENSE,29,Legacy\n", a.ID, cat)
	p, err = svc.PreviewImport(ctx, finance.Row{"csv": legacy, "accountId": "ignored"})
	if err != nil || len(p.Errors) != 0 || p.Transactions[0]["accountId"] != a.ID {
		t.Fatal(p, err)
	}
	for _, n := range []int{100000, 100001} {
		rows := header + strings.Repeat(fmt.Sprintf("2026-10-01,EXPENSE,%s,1,Row\n", cat), n)
		p, err = svc.PreviewImport(ctx, finance.Row{"csv": rows, "accountId": a.ID})
		if n == 100000 && (err != nil || p.Count != 100000 || len(p.Errors) != 0) {
			t.Fatal(p, err)
		}
		if n == 100001 && err == nil {
			t.Fatal("accepted >100000")
		}
	}
	// Preview success cannot authorize a later invalid write: archive after preview.
	if _, err = pool.Exec(ctx, `UPDATE account SET archived=true WHERE id=$1`, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Execute(ctx, "import", in); err == nil || !strings.Contains(err.Error(), "CSV record 2") {
		t.Fatal(err)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM entry WHERE user_id=$1`, user).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial stale import", count, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE account SET archived=false WHERE id=$1`, a.ID); err != nil {
		t.Fatal(err)
	}
	in["csv"] = header + fmt.Sprintf("2026-10-01,EXPENSE,%s,1,Valid\n2026-10-01,EXPENSE,%s,0,Invalid\n", cat, cat)
	if _, err = svc.Execute(ctx, "import", in); err == nil {
		t.Fatal("accepted invalid batch")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM entry WHERE user_id=$1`, user).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial import")
	}
	if _, err = svc.Execute(ctx, "import", finance.Row{"csv": legacy}); err != nil {
		t.Fatal(err)
	}
}
