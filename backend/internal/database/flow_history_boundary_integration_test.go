//go:build integration

package database

import (
	"context"
	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"testing"
	"time"
)

func TestFlowHistoryIncludesEarliestPartialWeek(t *testing.T) {
	p := testPool(t)
	ctx := context.Background()
	if e := Migrate(ctx, p); e != nil {
		t.Fatal(e)
	}
	u := owner("00000000-0000-0000-0000-000000000001")
	as := account.Service{Repository: account.PostgresRepository{Pool: p}, CurrentUser: u}
	a, e := as.Create(ctx, account.Input{Name: "Boundary", Type: "CASH", Currency: "EUR"})
	if e != nil {
		t.Fatal(e)
	}
	s := finance.Service{Repository: finance.PostgresRepository{Pool: p}, CurrentUser: u, Now: func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }}
	if _, e = s.Execute(ctx, "category", finance.Row{"name": "Boundary", "kind": "EXPENSE"}); e != nil {
		t.Fatal(e)
	}
	snap, e := s.Snapshot(ctx, "1900-01")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Execute(ctx, "transaction", finance.Row{"accountId": a.ID, "categoryId": snap.Categories[0]["id"], "kind": "EXPENSE", "amount": "100", "date": "1900-01-01"}); e != nil {
		t.Fatal(e)
	}
	all, e := s.FlowHistory(ctx, finance.FlowFilter{Grouping: "all", WeekEnd: 3})
	if e != nil || len(all.Flows) != 1 || all.Flows[0]["expense"] != "100" {
		t.Fatal(all, e)
	}
	h, e := s.FlowHistory(ctx, finance.FlowFilter{Grouping: "week", WeekEnd: 3, Before: "1900-01-04"})
	if e != nil {
		t.Fatal(e)
	}
	if h.HasEarlier {
		t.Fatal("earliest page must end pagination")
	}
	if len(h.Flows) != 1 || h.Flows[0]["expense"] != "100" {
		t.Fatal(h)
	}
	if len(h.Buckets) == 0 {
		t.Fatalf("valid boundary week omitted despite All expense100: %+v", h)
	}
	if h.Buckets[len(h.Buckets)-1].Start != "1900-01-01" || h.Buckets[len(h.Buckets)-1].End != "1900-01-03" {
		t.Fatalf("unexpected boundary week: %+v", h)
	}
}
