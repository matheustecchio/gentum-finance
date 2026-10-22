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

func TestWealthHistoryLongRangesCoverageAndOwnership(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	accounts := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := accounts.Create(ctx, account.Input{Name: "Historical", Type: "CASH", Currency: "EUR", InitialBalance: 10000})
	if err != nil {
		t.Fatal(err)
	}
	svc := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(user), Now: func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }}
	_, err = svc.Execute(ctx, "category", finance.Row{"name": "History fixture", "kind": "EXPENSE"})
	if err != nil {
		t.Fatal(err)
	}
	var category string
	if err = pool.QueryRow(ctx, `SELECT id::text FROM category WHERE user_id=$1 LIMIT 1`, user).Scan(&category); err != nil {
		t.Fatal(err)
	}
	for _, date := range []string{"2016-01-01", "2026-10-21", "2027-01-01"} {
		if _, err = svc.Execute(ctx, "transaction", finance.Row{"accountId": a.ID, "categoryId": category, "kind": "EXPENSE", "amount": "100", "date": date}); err != nil {
			t.Fatal(err)
		}
	}
	second, err := accounts.Create(ctx, account.Input{Name: "Transfer target", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Execute(ctx, "transfer", finance.Row{"fromId": a.ID, "toId": second.ID, "amount": "400", "date": "2026-10-01"}); err != nil {
		t.Fatal(err)
	}
	for _, group := range []string{"week", "month", "quarter", "halfYear", "year", "fiveYears", "all"} {
		out, e := svc.WealthHistory(ctx, finance.FlowFilter{Grouping: group})
		if e != nil || len(out.Wealth) == 0 || out.Wealth[len(out.Wealth)-1]["amount"] != "9800" {
			t.Fatalf("%s: %+v %v", group, out, e)
		}
		if group == "all" && (out.Wealth[0]["date"] != "2016-01-31" || out.Wealth[0]["amount"] != "9900") {
			t.Fatal(out)
		}
	}
	out, err := svc.WealthHistory(ctx, finance.FlowFilter{Grouping: "custom", Start: "2015-12-31", End: "2016-01-02"})
	if err != nil || len(out.Wealth) != 2 || out.Wealth[0]["date"] != "2016-01-01" || out.Wealth[0]["amount"] != "9900" {
		t.Fatal(out, err)
	}
	// A newly opened nonzero account makes earlier combined balances unavailable.
	_, err = accounts.Create(ctx, account.Input{Name: "New opening", Type: "CASH", Currency: "EUR", InitialBalance: 100})
	if err != nil {
		t.Fatal(err)
	}
	out, err = svc.WealthHistory(ctx, finance.FlowFilter{Grouping: "custom", Start: "2016-01-01", End: "2016-02-01"})
	if err != nil || len(out.Wealth) != 0 {
		t.Fatal("fabricated unsupported total", out, err)
	}
	other := security.ID()
	_, err = pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'wealth-other@example.test','Other','EUR',now(),now())`, other)
	if err != nil {
		t.Fatal(err)
	}
	svc.CurrentUser = owner(other)
	out, err = svc.WealthHistory(ctx, finance.FlowFilter{Grouping: "all"})
	if err != nil || len(out.Wealth) != 0 || out.HasEarlier {
		t.Fatal("cross-owner history", out, err)
	}
	accounts.CurrentUser = owner(other)
	if _, err = accounts.Create(ctx, account.Input{Name: "Opening only", Type: "CASH", Currency: "EUR", InitialBalance: 500}); err != nil {
		t.Fatal(err)
	}
	svc.Now = func() time.Time { return time.Now().UTC() }
	out, err = svc.WealthHistory(ctx, finance.FlowFilter{Grouping: "all"})
	if err != nil || len(out.Wealth) != 1 || out.Wealth[0]["amount"] != "500" {
		t.Fatal("fabricated history without dated activity", out, err)
	}

}
