//go:build integration

package database

import (
	"context"
	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
	"testing"
	"time"
)

func TestCalendarAnalyticsSelectionDrilldownAndOwnership(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	accounts := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := accounts.Create(ctx, account.Input{Name: "Calendar EUR", Type: "CASH", Currency: "EUR", InitialBalance: 10000})
	if err != nil {
		t.Fatal(err)
	}
	gbp, err := accounts.Create(ctx, account.Input{Name: "Calendar GBP", Type: "CASH", Currency: "GBP"})
	if err != nil {
		t.Fatal(err)
	}
	now := func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }
	svc := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(user), Now: now}
	categories := map[string]string{}
	for _, kind := range []string{"INCOME", "EXPENSE"} {
		if _, err = svc.Execute(ctx, "category", finance.Row{"name": "Calendar " + kind, "kind": kind}); err != nil {
			t.Fatal(err)
		}
		var id string
		if err = pool.QueryRow(ctx, `SELECT id::text FROM category WHERE user_id=$1 AND name=$2`, user, "Calendar "+kind).Scan(&id); err != nil {
			t.Fatal(err)
		}
		categories[kind] = id
	}
	post := func(accountID, kind, amount, date string) {
		t.Helper()
		if _, e := svc.Execute(ctx, "transaction", finance.Row{"accountId": accountID, "categoryId": categories[kind], "kind": kind, "amount": amount, "date": date, "description": "Fictional calendar transaction"}); e != nil {
			t.Fatal(e)
		}
	}
	post(a.ID, "INCOME", "1000", "2026-10-19")
	post(a.ID, "EXPENSE", "100", "2026-10-19")
	post(a.ID, "EXPENSE", "200", "2026-10-21")
	post(a.ID, "EXPENSE", "999", "2026-10-22")
	post(a.ID, "INCOME", "500", "2025-03-01")
	post(a.ID, "EXPENSE", "10", "2017-01-01")
	post(gbp.ID, "INCOME", "70", "2026-10-19")
	target, err := accounts.Create(ctx, account.Input{Name: "Transfer target", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Execute(ctx, "transfer", finance.Row{"fromId": a.ID, "toId": target.ID, "amount": "40", "receivedAmount": "30", "date": "2026-10-19"}); err != nil {
		t.Fatal(err)
	}
	get := func(f finance.CashFlowFilter) finance.CashFlowPage {
		t.Helper()
		out, e := svc.CashFlowPage(ctx, f)
		if e != nil {
			t.Fatal(e)
		}
		return out
	}
	out := get(finance.CashFlowFilter{Period: "week", WeekStart: 1})
	if len(out.Buckets) != 7 || out.Start != "2026-10-19" || out.End != "2026-10-25" || len(out.Totals) != 2 || out.Totals[0]["net"] != "700" || out.Totals[1]["income"] != "70" || out.Outgoing[0]["count"] != "2" {
		t.Fatal(out)
	}
	for _, r := range out.Flows {
		if r["month"] > "2026-10-21" {
			t.Fatal("future entry leaked", r)
		}
	}
	out = get(finance.CashFlowFilter{Period: "year", WeekStart: 1})
	if len(out.Buckets) != 12 || out.Totals[0]["income"] != "1000" || out.Totals[0]["expense"] != "300" || out.Totals[0]["incomeChange"] != "500" || out.Totals[0]["incomeAverage"] != "83" {
		t.Fatal(out)
	}
	out = get(finance.CashFlowFilter{Period: "week", WeekStart: 1, Selected: "2026-10-19", CategoryID: categories["EXPENSE"]})
	if out.SelectedEnd != "2026-10-19" || len(out.Entries) != 1 || out.Totals[0]["expense"] != "100" || out.Outgoing[0]["percentage"] != "100%" {
		t.Fatal(out)
	}
	if _, err = svc.CashFlowPage(ctx, finance.CashFlowFilter{Period: "week", WeekStart: 1, Selected: "2025-10-19"}); err == nil {
		t.Fatal("out-of-page selection accepted")
	}
	out = get(finance.CashFlowFilter{Period: "year", WeekStart: 1, Anchor: "2025-10-21"})
	if out.Totals[0]["income"] != "500" || out.Next != "2026-01-01" {
		t.Fatal(out)
	}
	out = get(finance.CashFlowFilter{Period: "all", WeekStart: 1})
	if out.Start != "2017-01-01" || out.Totals[0]["expense"] != "310" {
		t.Fatal(out)
	}
	out = get(finance.CashFlowFilter{Period: "custom", WeekStart: 0, Start: "2026-10-19", End: "2026-10-19"})
	if out.Totals[0]["expense"] != "100" {
		t.Fatal(out)
	}
	wealth, err := svc.WealthCalendar(ctx, finance.CashFlowFilter{Period: "year", WeekStart: 1})
	if err != nil || wealth.Start != "2026-01-01" || wealth.End != "2026-12-31" || wealth.Next != "" {
		t.Fatal(wealth, err)
	}
	for i := 0; i < 53; i++ {
		post(a.ID, "EXPENSE", "1", "2026-10-20")
	}
	out = get(finance.CashFlowFilter{Period: "week", WeekStart: 1, CategoryID: categories["EXPENSE"]})
	if len(out.Entries) != 50 || out.NextOffset != 50 {
		t.Fatal("missing first transaction page", out)
	}
	ids := map[string]bool{}
	for _, entry := range out.Entries {
		ids[entry["id"]] = true
	}
	out = get(finance.CashFlowFilter{Period: "week", WeekStart: 1, CategoryID: categories["EXPENSE"], Offset: 50})
	if len(out.Entries) != 5 || out.NextOffset != 0 {
		t.Fatal("missing last transaction page", out)
	}
	for _, entry := range out.Entries {
		if ids[entry["id"]] {
			t.Fatal("duplicate transaction between pages", entry)
		}
	}

	other := security.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'calendar-other@example.test','Other','EUR',now(),now())`, other); err != nil {
		t.Fatal(err)
	}
	svc.CurrentUser = owner(other)
	out = get(finance.CashFlowFilter{Period: "week", WeekStart: 1, CategoryID: categories["INCOME"]})
	if len(out.Totals) != 0 || len(out.Entries) != 0 || len(out.Flows) != 0 {
		t.Fatal("cross-owner data", out)
	}
}
