//go:build integration

package database

import (
	"context"
	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
	"reflect"
	"testing"
	"time"
)

func TestTransactionCorrections(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	svc := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(user), Now: func() time.Time { return time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC) }}
	must := func(action string, in finance.Row) {
		t.Helper()
		if _, err := svc.Execute(ctx, action, in); err != nil {
			t.Fatal(err)
		}
	}
	snap := func(month string) finance.Snapshot {
		t.Helper()
		s, err := svc.Snapshot(ctx, month)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	ac := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := ac.Create(ctx, account.Input{Name: "Correction wallet", Type: "CASH", Currency: "EUR", InitialBalance: 10000})
	if err != nil {
		t.Fatal(err)
	}
	b, err := ac.Create(ctx, account.Input{Name: "Other", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	must("category", finance.Row{"name": "Food", "kind": "EXPENSE"})
	must("category", finance.Row{"name": "Travel", "kind": "EXPENSE"})
	must("category", finance.Row{"name": "Wages", "kind": "INCOME"})
	cats := snap("2026-10").Categories
	var expense, income, second string
	for _, c := range cats {
		if c["kind"] == "EXPENSE" {
			if expense == "" {
				expense = c["id"]
			} else {
				second = c["id"]
			}
		} else {
			income = c["id"]
		}
	}
	must("transaction", finance.Row{"accountId": a.ID, "kind": "EXPENSE", "categoryId": expense, "amount": "29", "date": "2026-10-01"})
	id := snap("2026-10").Entries[0]["id"]
	must("budget", finance.Row{"categoryId": second, "currency": "EUR", "month": "2026-09", "amount": "1000"})
	edit := finance.Row{"id": id, "categoryId": second, "amount": "301", "date": "2026-09-15", "description": "Corrected", "accountId": b.ID, "kind": "INCOME"}
	must("editTransaction", edit)
	s := snap("2026-09")
	if s.Entries[0]["id"] != id || s.Entries[0]["accountId"] != a.ID || s.Entries[0]["kind"] != "EXPENSE" || s.Entries[0]["description"] != "Corrected" || s.Accounts[0]["balance"] != "9699" || s.Budgets[0]["spent"] != "301" || s.Totals[0]["expense"] != "301" {
		t.Fatal(s)
	}
	if snap("2026-10").Totals[0]["expense"] != "0" {
		t.Fatal("old month not refreshed")
	}
	page, err := svc.History(ctx, finance.HistoryFilter{})
	if err != nil || page.Entries[0]["amount"] != "301" {
		t.Fatal(page, err)
	}
	flow, err := svc.FlowHistory(ctx, finance.FlowFilter{Grouping: "custom", Start: "2026-09-01", End: "2026-09-30"})
	if err != nil || len(flow.Flows) == 0 {
		t.Fatal(flow, err)
	}
	overview, err := svc.Overview(ctx, "2026-10")
	if err != nil || overview.Accounts[0]["amount"] != "9699" {
		t.Fatal(overview, err)
	}
	before := snap("2026-09")
	for _, change := range []finance.Row{{"amount": "0"}, {"amount": "9223372036854775808"}, {"date": "1899-12-31"}, {"categoryId": income}, {"categoryId": security.ID()}} {
		bad := finance.Row{}
		for k, v := range edit {
			bad[k] = v
		}
		for k, v := range change {
			bad[k] = v
		}
		if _, err := svc.Execute(ctx, "editTransaction", bad); err == nil {
			t.Fatal("accepted", bad)
		}
		if !reflect.DeepEqual(before, snap("2026-09")) {
			t.Fatal("failed correction changed data")
		}
	}
	other := security.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'correction@example.test','Other','EUR',now(),now())`, other); err != nil {
		t.Fatal(err)
	}
	foreign := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(other)}
	if _, err := foreign.Execute(ctx, "editTransaction", edit); err == nil {
		t.Fatal("foreign update")
	}
	must("transfer", finance.Row{"fromId": a.ID, "toId": b.ID, "amount": "1", "date": "2026-10-01"})
	must("recurring", finance.Row{"accountId": a.ID, "kind": "INCOME", "categoryId": income, "amount": "1", "date": time.Now().UTC().Format("2006-01-02")})
	must("runDue", finance.Row{})
	for _, e := range snap("2026-10").Entries {
		if e["id"] == id {
			continue
		}
		bad := finance.Row{}
		for k, v := range edit {
			bad[k] = v
		}
		bad["id"] = e["id"]
		if _, err := svc.Execute(ctx, "editTransaction", bad); err == nil {
			t.Fatal("edited protected entry", e)
		}
	}
	must("transaction", finance.Row{"accountId": a.ID, "kind": "INCOME", "categoryId": income, "amount": "1", "date": "2026-10-02", "description": "Overflow"})
	var incomeID string
	for _, e := range snap("2026-10").Entries {
		if e["description"] == "Overflow" {
			incomeID = e["id"]
		}
	}
	before = snap("2026-10")
	if _, err := svc.Execute(ctx, "editTransaction", finance.Row{"id": incomeID, "categoryId": income, "amount": "9223372036854775807", "date": "2026-10-02"}); err == nil {
		t.Fatal("overflow accepted")
	}
	if !reflect.DeepEqual(before, snap("2026-10")) {
		t.Fatal("overflow did not roll back")
	}
	// Exact cents beyond JavaScript's safe range survive an income correction.
	must("editTransaction", finance.Row{"id": incomeID, "categoryId": income, "amount": "9007199254740993", "date": "2026-10-02"})
}
