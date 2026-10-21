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

func TestGroupedCashFlowAndSelectedCategoryDates(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	accounts := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := accounts.Create(ctx, account.Input{Name: "Grouped checking", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := accounts.Create(ctx, account.Input{Name: "Grouped savings", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	s := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(user), Now: func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }}
	must := func(action string, in finance.Row) {
		t.Helper()
		if _, err := s.Execute(ctx, action, in); err != nil {
			t.Fatal(err)
		}
	}
	must("category", finance.Row{"name": "Grouped food", "kind": "EXPENSE"})
	var category string
	if err = pool.QueryRow(ctx, `SELECT id::text FROM category WHERE user_id=$1 AND name='Grouped food'`, user).Scan(&category); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{"2017-11-01", "2026-09-30", "2026-10-18", "2026-10-19", "2026-10-21", "2026-10-22"} {
		must("transaction", finance.Row{"accountId": a.ID, "categoryId": category, "kind": "EXPENSE", "amount": "100", "date": d})
	}
	must("transfer", finance.Row{"fromId": a.ID, "toId": b.ID, "amount": "200", "date": "2026-10-20"})
	weekly, err := s.FlowHistory(ctx, finance.FlowFilter{Grouping: "week"})
	if err != nil {
		t.Fatal(err)
	}
	if len(weekly.Buckets) != 8 || !weekly.HasEarlier {
		t.Fatalf("weekly page %+v", weekly)
	}
	last := weekly.Buckets[len(weekly.Buckets)-1]
	if last.Start != "2026-10-19" || last.End != "2026-10-21" {
		t.Fatal(last)
	}
	for _, f := range weekly.Flows {
		if f["month"] == last.Start && (f["expense"] != "200" || f["net"] != "-200" || f["income"] != "0") {
			t.Fatal(f)
		}
	}
	older, err := s.FlowHistory(ctx, finance.FlowFilter{Grouping: "week", Before: weekly.Buckets[0].Start})
	if err != nil || len(older.Buckets) != 8 || older.Buckets[7].End >= weekly.Buckets[0].Start {
		t.Fatalf("older page %+v %v", older, err)
	}
	shifted, err := s.FlowHistory(ctx, finance.FlowFilter{Grouping: "week", WeekEnd: 3})
	if err != nil || shifted.Buckets[len(shifted.Buckets)-1].Start != "2026-10-15" {
		t.Fatalf("shifted week %+v %v", shifted, err)
	}
	for _, group := range []string{"month", "quarter", "fourMonths", "halfYear", "year", "fiveYears", "all"} {
		result, e := s.FlowHistory(ctx, finance.FlowFilter{Grouping: group})
		if e != nil {
			t.Fatal(group, e)
		}
		if len(result.Buckets) == 0 || result.Buckets[len(result.Buckets)-1].End != "2026-10-21" {
			t.Fatalf("group %s %+v", group, result)
		}
		if group == "all" && (len(result.Flows) != 1 || result.Flows[0]["expense"] != "500" || result.Buckets[0].Start != "2017-11-01" || result.HasEarlier) {
			t.Fatal(result)
		}
	}
	selected, err := s.Spending(ctx, last.Start, last.End)
	if err != nil || len(selected.Breakdown) != 1 || selected.Breakdown[0]["direct"] != "200" {
		t.Fatalf("selected category %+v %v", selected, err)
	}
	full, err := s.Spending(ctx, "2017-11-01", "2026-10-21")
	if err != nil || full.Breakdown[0]["direct"] != "500" {
		t.Fatal(full, err)
	}
	custom, err := s.FlowHistory(ctx, finance.FlowFilter{Grouping: "custom", Start: "2026-10-18", End: "2026-10-21"})
	if err != nil || len(custom.Buckets) != 4 || custom.HasEarlier {
		t.Fatal(custom, err)
	}
	other := security.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'grouped@example.test','Other','EUR',now(),now())`, other); err != nil {
		t.Fatal(err)
	}
	s.CurrentUser = owner(other)
	empty, err := s.FlowHistory(ctx, finance.FlowFilter{Grouping: "week"})
	if err != nil || len(empty.Flows) != 0 || empty.HasEarlier {
		t.Fatal(empty, err)
	}
	selected, err = s.Spending(ctx, last.Start, last.End)
	if err != nil || len(selected.Breakdown) != 0 {
		t.Fatal(selected, err)
	}
}
