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

func TestOverviewObservationsPreferenceAndMonthlyFlows(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	u := "00000000-0000-0000-0000-000000000001"
	other := security.ID()
	_, err := pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'other@example.test','Other','EUR',now(),now())`, other)
	if err != nil {
		t.Fatal(err)
	}
	a := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(u)}
	main, err := a.Create(ctx, account.Input{Name: "Main", Type: "CASH", Currency: "EUR", InitialBalance: 10000})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	s := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(u), Now: func() time.Time { return now }}
	must := func(action string, in finance.Row) {
		t.Helper()
		if _, err := s.Execute(ctx, action, in); err != nil {
			t.Fatal(err)
		}
	}
	must("category", finance.Row{"name": "Food", "kind": "EXPENSE"})
	var category string
	if err = pool.QueryRow(ctx, `SELECT id::text FROM category WHERE user_id=$1`, u).Scan(&category); err != nil {
		t.Fatal(err)
	}
	must("transaction", finance.Row{"accountId": main.ID, "categoryId": category, "kind": "EXPENSE", "amount": "200", "date": "2026-05-01"})
	must("transaction", finance.Row{"accountId": main.ID, "categoryId": category, "kind": "EXPENSE", "amount": "300", "date": "2026-04-30"})
	o, err := s.Overview(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	if o.Currency != "EUR" || len(o.Wealth) != 1 || o.Wealth[0]["amount"] != "9500" || len(o.Flows) != 1 || o.Flows[0]["net"] != "-200" {
		t.Fatalf("unexpected Overview: %+v", o)
	}
	must("transaction", finance.Row{"accountId": main.ID, "categoryId": category, "kind": "EXPENSE", "amount": "1", "date": "2026-10-18"})
	o, err = s.Overview(ctx, "2026-10")
	if err != nil || len(o.Wealth) != 1 || o.Wealth[0]["amount"] != "9499" {
		t.Fatalf("same-day update: %+v %v", o, err)
	}
	now = now.AddDate(0, 0, 30)
	o, err = s.Overview(ctx, "2026-11")
	if err != nil || len(o.Wealth) != 2 {
		t.Fatalf("30-day observations: %+v %v", o, err)
	}
	must("primaryCurrency", finance.Row{"currency": "USD"})
	o, err = s.Overview(ctx, "2026-11")
	if err != nil || o.Currency != "USD" || o.RateError == "" || len(o.Wealth) != 0 {
		t.Fatalf("missing rates must hide total: %+v %v", o, err)
	}
	if _, err = s.Execute(ctx, "primaryCurrency", finance.Row{"currency": "XYZ"}); err == nil {
		t.Fatal("invalid currency accepted")
	}
	s.CurrentUser = owner(other)
	o, err = s.Overview(ctx, "2026-11")
	if err != nil || o.Currency != "EUR" || len(o.Wealth) != 1 || o.Wealth[0]["amount"] != "0" || len(o.Flows) != 0 {
		t.Fatalf("cross-owner leakage: %+v %v", o, err)
	}
}
