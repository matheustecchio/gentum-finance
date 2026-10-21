//go:build integration

package database

import (
	"context"
	"encoding/json"
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
	if o.Currency != "EUR" || len(o.Wealth) != 31 || o.Wealth[0]["amount"] != "9500" || len(o.Flows) != 1 || o.Flows[0]["net"] != "-200" {
		t.Fatalf("unexpected Overview: %+v", o)
	}
	must("transaction", finance.Row{"accountId": main.ID, "categoryId": category, "kind": "EXPENSE", "amount": "1", "date": "2026-10-18"})
	o, err = s.Overview(ctx, "2026-10")
	if err != nil || len(o.Wealth) != 31 || o.Wealth[30]["amount"] != "9499" || o.Change30 != "-1" {
		t.Fatalf("same-day update: %+v %v", o, err)
	}
	if len(o.Accounts) != 1 || o.Accounts[0]["name"] != "Main" || o.Accounts[0]["amount"] != "9499" || o.Accounts[0]["change30"] != "-1" {
		t.Fatalf("account balances and changes: %+v", o.Accounts)
	}
	now = now.AddDate(0, 0, 30)
	o, err = s.Overview(ctx, "2026-11")
	if err != nil || len(o.Wealth) != 31 || o.Change30 != "0" {
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
	if err != nil || o.Currency != "EUR" || len(o.Wealth) != 1 || o.Wealth[0]["amount"] != "0" || len(o.Flows) != 0 || len(o.Accounts) != 0 {
		t.Fatalf("cross-owner leakage: %+v %v", o, err)
	}
}

func TestOverviewReconstructsDatedBalancesWithoutTransfersOrFutureActivityChangingToday(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	u := "00000000-0000-0000-0000-000000000001"
	accounts := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(u)}
	makeAccount := func(name string, opening int64) account.Account {
		t.Helper()
		a, err := accounts.Create(ctx, account.Input{Name: name, Type: "CASH", Currency: "EUR", InitialBalance: opening})
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	a, b := makeAccount("Recorded", 10000), makeAccount("Archived", 5000)
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	s := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(u), Now: func() time.Time { return now }}
	must := func(action string, in finance.Row) {
		t.Helper()
		if _, err := s.Execute(ctx, action, in); err != nil {
			t.Fatal(err)
		}
	}
	must("category", finance.Row{"name": "Pay", "kind": "INCOME"})
	must("category", finance.Row{"name": "Food", "kind": "EXPENSE"})
	snap, err := s.Summary(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	category := map[string]string{}
	for _, c := range snap.Categories {
		category[c["kind"]] = c["id"]
	}
	entry := func(id, kind, value, day string) {
		must("transaction", finance.Row{"accountId": id, "categoryId": category[kind], "kind": kind, "amount": value, "date": day})
	}
	entry(a.ID, "INCOME", "1000", "2026-09-10")
	entry(b.ID, "EXPENSE", "100", "2026-09-15")
	must("transfer", finance.Row{"fromId": a.ID, "toId": b.ID, "amount": "400", "date": "2026-10-01"})
	entry(a.ID, "EXPENSE", "200", "2026-10-10")
	entry(a.ID, "EXPENSE", "700", "2026-10-19")
	must("recurring", finance.Row{"accountId": a.ID, "categoryId": category["EXPENSE"], "kind": "EXPENSE", "amount": "900", "date": "2026-10-18"})
	if _, err = pool.Exec(ctx, `UPDATE account SET archived=true WHERE id=$1`, b.ID); err != nil {
		t.Fatal(err)
	}
	makeAccount("Zero opening without entries", 0)
	o, err := s.Overview(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	if len(o.Wealth) != 31 || o.Wealth[0]["amount"] != "15900" || o.Wealth[30]["amount"] != "15700" || o.Change30 != "-200" {
		t.Fatalf("incorrect dated reconstruction %+v", o)
	}
	for _, w := range o.Wealth {
		if w["date"] == "2026-10-01" && w["amount"] != "15900" {
			t.Fatal("transfer changed total wealth", w)
		}
	}
	if len(o.Accounts) != 3 || o.Accounts[0]["name"] != "Archived" || o.Accounts[0]["amount"] != "5300" || o.Accounts[0]["change30"] != "400" || o.Accounts[1]["amount"] != "10400" || o.Accounts[1]["change30"] != "-600" || o.Accounts[2]["change30"] != "" {
		t.Fatalf("account changes must include transfers and exclude future activity: %+v", o.Accounts)
	}
	var observations int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM wealth_observation`).Scan(&observations); err != nil || observations != 0 {
		t.Fatalf("read query wrote fake observations: %d %v", observations, err)
	}
	usd, err := accounts.Create(ctx, account.Input{Name: "USD ledger", Type: "CASH", Currency: "USD", InitialBalance: 5000})
	if err != nil {
		t.Fatal(err)
	}
	entry(usd.ID, "INCOME", "125", "2026-09-01")
	s.Rates = overviewIntegrationRates{}
	o, err = s.Overview(ctx, "2026-10")
	if err != nil || len(o.Wealth) != 31 || o.Wealth[0]["amount"] != "20000" || o.Wealth[30]["amount"] != "19800" || o.Change30 != "-200" || !o.Converted {
		t.Fatalf("historical native currencies not converted consistently: %+v %v", o, err)
	}
	unknown := makeAccount("Undated opening", 200)
	if _, err = pool.Exec(ctx, `UPDATE account SET created_at='2026-10-18T00:00:00Z' WHERE id=$1`, unknown.ID); err != nil {
		t.Fatal(err)
	}
	o, err = s.Overview(ctx, "2026-10")
	if err != nil || len(o.Wealth) != 1 || o.Wealth[0]["amount"] != "20000" || o.Change30 != "" {
		t.Fatalf("unknown opening must not create partial earlier totals %+v %v", o, err)
	}
}

type overviewIntegrationRates struct{}

func (overviewIntegrationRates) Rates(context.Context, time.Time) ([]finance.Rate, error) {
	return []finance.Rate{{Date: "2026-10-16", Base: "EUR", Quote: "USD", Value: json.Number("1.25")}, {Date: "2026-10-16", Base: "EUR", Quote: "GBP", Value: json.Number("0.8")}, {Date: "2026-10-16", Base: "EUR", Quote: "BRL", Value: json.Number("5")}}, nil
}
