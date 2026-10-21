//go:build integration

package database

import (
	"context"
	"testing"
	"time"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
)

func TestAnalyticsRangeBoundariesCurrenciesAndOwnership(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	accounts := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := accounts.Create(ctx, account.Input{Name: "Main", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := accounts.Create(ctx, account.Input{Name: "Other currency", Type: "CASH", Currency: "GBP"})
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
	must("category", finance.Row{"name": "Food", "kind": "EXPENSE"})
	var category string
	if err = pool.QueryRow(ctx, `SELECT id::text FROM category WHERE user_id=$1`, user).Scan(&category); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{"2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"} {
		must("transaction", finance.Row{"accountId": a.ID, "categoryId": category, "kind": "EXPENSE", "amount": "100", "date": d})
	}
	must("transaction", finance.Row{"accountId": b.ID, "categoryId": category, "kind": "EXPENSE", "amount": "7", "date": "2026-10-01"})

	c, err := accounts.Create(ctx, account.Input{Name: "Savings", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	must("transfer", finance.Row{"fromId": a.ID, "toId": c.ID, "amount": "11", "date": "2026-10-01"})
	result, err := s.Analytics(ctx, "2026-09-30", "2026-10-01")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Flows) != 3 || len(result.Breakdown) != 2 {
		t.Fatalf("unexpected range: %+v", result)
	}
	for _, f := range result.Flows {
		want := "100"
		if f["currency"] == "GBP" {
			want = "7"
		}
		if f["income"] != "0" || f["expense"] != want || f["net"] != "-"+want {
			t.Fatal(f)
		}
	}
	for _, b := range result.Breakdown {
		want := "200"
		if b["currency"] == "GBP" {
			want = "7"
		}
		if b["direct"] != want || b["categoryId"] != category {
			t.Fatal(b)
		}
	}
	monthly, err := s.Analytics(ctx, "2026-01-01", "2026-10-21")
	if err != nil || len(monthly.Flows) != 3 || monthly.Flows[0]["month"] != "2026-09" {
		t.Fatalf("monthly buckets: %+v %v", monthly, err)
	}
	other := security.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'analytics@example.test','Other','EUR',now(),now())`, other); err != nil {
		t.Fatal(err)
	}
	s.CurrentUser = owner(other)
	result, err = s.Analytics(ctx, "2026-09-30", "2026-10-01")
	if err != nil || len(result.Flows) != 0 || len(result.Breakdown) != 0 {
		t.Fatalf("owner leakage: %+v %v", result, err)
	}
}
