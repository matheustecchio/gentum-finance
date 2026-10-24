//go:build integration

package database

import (
	"context"
	"strings"
	"testing"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
)

func TestBudgetWorkflowScopesHistoryAndOwnership(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	s := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	must := func(action string, in finance.Row) {
		t.Helper()
		if _, err := s.Execute(ctx, action, in); err != nil {
			t.Fatal(action, err)
		}
	}
	accountService := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := accountService.Create(ctx, account.Input{Name: "Selected", Type: "CASH", Currency: "EUR", InitialBalance: 100000})
	if err != nil {
		t.Fatal(err)
	}
	b, err := accountService.Create(ctx, account.Input{Name: "Other", Type: "CASH", Currency: "EUR", InitialBalance: 100000})
	if err != nil {
		t.Fatal(err)
	}
	gbp, err := accountService.Create(ctx, account.Input{Name: "GBP", Type: "CASH", Currency: "GBP", InitialBalance: 100000})
	if err != nil {
		t.Fatal(err)
	}
	must("category", finance.Row{"name": "Food", "kind": "EXPENSE"})
	snap, _ := s.Snapshot(ctx, "2026-10")
	root := snap.Categories[0]["id"]
	must("category", finance.Row{"name": "Cafe", "kind": "EXPENSE", "parentId": root})
	snap, _ = s.Snapshot(ctx, "2026-10")
	child := ""
	for _, c := range snap.Categories {
		if c["parentId"] == root {
			child = c["id"]
		}
	}
	if child == "" {
		t.Fatal("child missing")
	}
	for _, e := range []finance.Row{
		{"accountId": a.ID, "categoryId": root, "kind": "EXPENSE", "amount": "1000", "date": "2026-10-03"},
		{"accountId": a.ID, "categoryId": child, "kind": "EXPENSE", "amount": "2500", "date": "2026-10-04"},
		{"accountId": b.ID, "categoryId": child, "kind": "EXPENSE", "amount": "4000", "date": "2026-10-04"},
		{"accountId": gbp.ID, "categoryId": child, "kind": "EXPENSE", "amount": "9000", "date": "2026-10-04"},
		{"accountId": a.ID, "categoryId": child, "kind": "EXPENSE", "amount": "500", "date": "2026-11-02"},
	} {
		must("transaction", e)
	}
	input := finance.Row{"name": "Food plan", "currency": "EUR", "amount": "4000", "frequency": "monthly", "date": "2026-10-01", "categoryIds": root + "," + child, "accountIds": a.ID, "alert": "true"}
	must("saveBudget", input)
	get := func(month string) finance.Snapshot {
		t.Helper()
		v, e := s.Snapshot(ctx, month)
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	snap = get("2026-10")
	if len(snap.Budgets) != 1 {
		t.Fatal(snap.Budgets)
	}
	budget := snap.Budgets[0]
	if budget["spent"] != "3500" || budget["remaining"] != "500" || len(strings.Split(budget["entryIds"], ",")) != 2 {
		t.Fatal(budget)
	}
	id := budget["id"]
	input["id"] = id
	input["effectiveDate"] = "2026-11-01"
	input["amount"] = "6000"
	must("saveBudget", input)
	if v := get("2026-10").Budgets[0]; v["amount"] != "4000" || v["spent"] != "3500" {
		t.Fatal(v)
	}
	november := get("2026-11").Budgets[0]
	if november["amount"] != "6000" || november["spent"] != "500" {
		t.Fatal(november)
	}
	if _, e := s.Execute(ctx, "saveBudget", input); e == nil {
		t.Fatal("accepted stale version edit")
	}
	input["id"] = november["id"]
	input["effectiveDate"] = "2026-11-02"
	if _, e := s.Execute(ctx, "saveBudget", input); e == nil {
		t.Fatal("accepted non-boundary")
	}
	input["effectiveDate"] = "2026-11-01"
	input["accountIds"] = gbp.ID
	if _, e := s.Execute(ctx, "saveBudget", input); e == nil {
		t.Fatal("accepted wrong currency")
	}
	foreign := security.ID()
	if _, e := pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'budget-other@example.test','Other','EUR',now(),now())`, foreign); e != nil {
		t.Fatal(e)
	}
	other := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(foreign)}
	for _, action := range []string{"deleteBudget", "stopBudget", "saveBudget"} {
		if _, e := other.Execute(ctx, action, input); e == nil {
			t.Fatal("foreign", action)
		}
	}
	if v, e := other.Snapshot(ctx, "2026-11"); e != nil || len(v.Budgets) != 0 {
		t.Fatal(v, e)
	}
	must("stopBudget", finance.Row{"id": november["id"], "date": "2026-11-30"})
	if len(get("2026-12").Budgets) != 0 || len(get("2026-10").Budgets) != 1 {
		t.Fatal("stop changed history")
	}
	must("deleteBudget", finance.Row{"id": november["id"]})
	if len(get("2026-10").Budgets) != 0 || len(get("2026-10").Entries) != 5 {
		t.Fatal("delete changed ledger")
	}
	// All categories/accounts includes both EUR accounts and excludes GBP.
	delete(input, "id")
	delete(input, "effectiveDate")
	input["categoryIds"] = ""
	input["accountIds"] = ""
	input["frequency"] = "weekly"
	must("saveBudget", input)
	snap = get("2026-10")
	if len(snap.Budgets) != 5 || snap.Budgets[0]["spent"] != "7500" {
		t.Fatal(snap.Budgets)
	}
}

func TestBudgetLegacyUpgradeAndExactCents(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if e := Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	user := "00000000-0000-0000-0000-000000000001"
	cat, id := security.ID(), security.ID()
	if _, e := pool.Exec(ctx, `INSERT INTO category(id,user_id,name,kind) VALUES($1,$2,'Legacy budget','EXPENSE')`, cat, user); e != nil {
		t.Fatal(e)
	}
	if _, e := pool.Exec(ctx, `INSERT INTO budget(id,user_id,category_id,currency,month,amount) VALUES($1,$2,$3,'EUR','2026-10-01',9007199254740993)`, id, user, cat); e != nil {
		t.Fatal(e)
	}
	// Return the isolated fixture to V13 and execute the real upgrade twice.
	if _, e := pool.Exec(ctx, `DROP TABLE budget_plan; DELETE FROM gentum_schema_migration WHERE version=14`); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		if e := Migrate(ctx, pool); e != nil {
			t.Fatal(e)
		}
	}
	s := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	snap, e := s.Snapshot(ctx, "2026-10")
	if e != nil {
		t.Fatal(e)
	}
	if len(snap.Budgets) != 1 || snap.Budgets[0]["amount"] != "9007199254740993" || snap.Budgets[0]["frequency"] != "once" || snap.Budgets[0]["endDate"] != "2026-10-31" {
		t.Fatal(snap.Budgets)
	}
	if _, e = s.Execute(ctx, "deleteCategory", finance.Row{"id": cat}); e == nil {
		t.Fatal("deleted budget category")
	}
	if _, e = s.Execute(ctx, "budget", finance.Row{"categoryId": cat, "currency": "EUR", "month": "2026-10", "amount": "8000"}); e != nil {
		t.Fatal(e)
	}
	snap, e = s.Snapshot(ctx, "2026-10")
	if e != nil || len(snap.Budgets) != 1 || snap.Budgets[0]["amount"] != "8000" {
		t.Fatal(snap.Budgets, e)
	}
}

func TestBudgetAnnualSumRetainsExactWideAggregate(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if e := Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	s := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner("00000000-0000-0000-0000-000000000001")}
	// Each month's total and the account balance fit int64, while the annual expense total does not.
	_, e := pool.Exec(ctx, `INSERT INTO account(id,user_id,name,type,currency,initial_balance,archived,created_at,updated_at) VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','QA','CASH','EUR',9000000000000000000,false,now(),now()); INSERT INTO category(id,user_id,name,kind) VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Expense','EXPENSE')`)
	if e != nil {
		t.Fatal(e)
	}
	for _, d := range []string{"2026-01-01", "2026-02-01"} {
		if _, e = s.Execute(ctx, "transaction", finance.Row{"accountId": "00000000-0000-0000-0000-000000000002", "categoryId": "00000000-0000-0000-0000-000000000003", "kind": "EXPENSE", "amount": "5000000000000000000", "date": d}); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.Execute(ctx, "saveBudget", finance.Row{"name": "Annual", "currency": "EUR", "amount": "100", "frequency": "yearly", "date": "2026-01-01", "alert": "false"}); e != nil {
		t.Fatal(e)
	}
	snap, e := s.Snapshot(ctx, "2026-01")
	if e != nil {
		t.Fatal(e)
	}
	if len(snap.Budgets) != 1 || snap.Budgets[0]["spent"] != "10000000000000000000" || snap.Budgets[0]["remaining"] != "-9999999999999999900" {
		t.Fatal(snap.Budgets)
	}
}
