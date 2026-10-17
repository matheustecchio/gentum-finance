//go:build integration

package database

import (
	"context"
	"fmt"
	"reflect"
	"sync"
	"testing"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
)

func TestHistoryPaginationFiltersAndDeletion(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user := "00000000-0000-0000-0000-000000000001"
	svc := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	must := func(action string, in finance.Row) {
		t.Helper()
		if _, err := svc.Execute(ctx, action, in); err != nil {
			t.Fatal(action, err)
		}
	}
	fail := func(action string, in finance.Row) {
		t.Helper()
		if _, err := svc.Execute(ctx, action, in); err == nil {
			t.Fatal("accepted", action, in)
		}
	}
	category := func(name, parent string) string {
		t.Helper()
		must("category", finance.Row{"name": name, "kind": "EXPENSE", "parentId": parent})
		s, _ := svc.Snapshot(ctx, "2026-10")
		for _, c := range s.Categories {
			if c["name"] == name && c["parentId"] == parent {
				return c["id"]
			}
		}
		t.Fatal("missing category")
		return ""
	}
	root := category("Daily Living", "")
	child := category("Groceries", root)
	sibling := category("Dining", root)
	education := category("Education", "")
	otherRoot := category("Other", "")
	otherChild := category("Groceries", otherRoot)
	accounts := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := accounts.Create(ctx, account.Input{Name: "Wallet", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	entry := func(cat, day, description string) finance.Row {
		return finance.Row{"accountId": a.ID, "categoryId": cat, "date": day, "kind": "EXPENSE", "amount": "29", "description": description}
	}
	for i := 0; i < 25; i++ {
		cat := root
		if i%2 == 0 {
			cat = child
		}
		must("transaction", entry(cat, "2026-10-17", fmt.Sprintf("Entry %02d", i)))
	}
	// Equal timestamps exercise the ID tie-breaker across page boundaries.
	if _, err = pool.Exec(ctx, `UPDATE entry SET created_at='2026-10-17T12:00:00Z' WHERE user_id=$1`, user); err != nil {
		t.Fatal(err)
	}
	must("transaction", entry(sibling, "2026-10-18", "Sibling"))
	must("transaction", entry(education, "2026-09-01", "School"))
	must("transaction", entry(otherChild, "2026-10-17", "Other groceries"))
	page := func(f finance.HistoryFilter) finance.HistoryPage {
		t.Helper()
		p, e := svc.History(ctx, f)
		if e != nil {
			t.Fatal(e)
		}
		if len(p.Entries) > 10 {
			t.Fatal("unbounded page")
		}
		return p
	}
	seen := map[string]bool{}
	f := finance.HistoryFilter{}
	for {
		p := page(f)
		for _, e := range p.Entries {
			if seen[e["id"]] {
				t.Fatal("duplicate")
			}
			seen[e["id"]] = true
		}
		if p.NextCursor == "" {
			break
		}
		f.After = p.NextCursor
	}
	if len(seen) != 28 {
		t.Fatal("missing", len(seen))
	}
	tests := []struct {
		f     finance.HistoryFilter
		count int
	}{{finance.HistoryFilter{CategoryID: root}, 26}, {finance.HistoryFilter{CategoryID: root, SubcategoryID: child}, 13}, {finance.HistoryFilter{CategoryID: education}, 1}, {finance.HistoryFilter{Start: "2026-10-18"}, 1}, {finance.HistoryFilter{End: "2026-09-01"}, 1}, {finance.HistoryFilter{Start: "2026-10-17", End: "2026-10-17", CategoryID: root}, 25}, {finance.HistoryFilter{Start: "2027-01-01"}, 0}}
	for _, tt := range tests {
		count := 0
		f := tt.f
		for {
			p := page(f)
			if !p.HasEntries {
				t.Fatal("false empty ledger")
			}
			count += len(p.Entries)
			if p.NextCursor == "" {
				break
			}
			f.After = p.NextCursor
		}
		if count != tt.count {
			t.Fatalf("%#v: %d", tt.f, count)
		}
	}
	for _, f := range []finance.HistoryFilter{{CategoryID: root, SubcategoryID: otherChild}, {CategoryID: child}, {After: "bad"}, {Start: "2026-10-18", End: "2026-10-17"}} {
		if _, err := svc.History(ctx, f); err == nil {
			t.Fatal("accepted filter", f)
		}
	}
	p := page(finance.HistoryFilter{})
	if _, err := svc.History(ctx, finance.HistoryFilter{After: p.NextCursor, CategoryID: root}); err == nil {
		t.Fatal("cursor filter mismatch")
	}
	summary, err := svc.Summary(ctx, "2026-10")
	if err != nil || len(summary.Entries) != 0 {
		t.Fatal("summary includes history", err)
	}
	before := summary.Accounts[0]["balance"]
	beforeTotals := summary.Totals
	legacy, err := svc.Snapshot(ctx, "2026-10")
	if err != nil || len(legacy.Entries) != 28 {
		t.Fatal("legacy contract", err)
	}
	fail("deleteCategory", finance.Row{"id": root})
	fail("deleteCategory", finance.Row{"id": child})
	empty := category("Unused", "")
	must("deleteCategory", finance.Row{"id": empty})
	budget := category("Budget", "")
	must("budget", finance.Row{"categoryId": budget, "currency": "EUR", "month": "2026-10", "amount": "100"})
	fail("deleteCategory", finance.Row{"id": budget})
	schedule := category("Schedule", "")
	must("recurring", entry(schedule, "2027-01-01", "Stopped"))
	s, _ := svc.Snapshot(ctx, "2026-10")
	must("stopRecurring", finance.Row{"id": s.Recurring[0]["id"]})
	fail("deleteCategory", finance.Row{"id": schedule})
	foreignID := security.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'history-other@example.test','Other','EUR',now(),now())`, foreignID); err != nil {
		t.Fatal(err)
	}
	foreign := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(foreignID)}
	if _, err = foreign.Execute(ctx, "deleteCategory", finance.Row{"id": root}); err == nil {
		t.Fatal("foreign deletion")
	}
	if _, err = foreign.History(ctx, finance.HistoryFilter{CategoryID: root}); err == nil {
		t.Fatal("foreign category")
	}
	fp, err := foreign.History(ctx, finance.HistoryFilter{})
	if err != nil || len(fp.Entries) != 0 || fp.HasEntries {
		t.Fatal("foreign entries", err)
	}
	stable, err := svc.Summary(ctx, "2026-10")
	if err != nil || stable.Accounts[0]["balance"] != before || !reflect.DeepEqual(beforeTotals, stable.Totals) {
		t.Fatal("category deletion changed money", err)
	}
	// A leaf default remains deleted on reads; only explicit starter installation restores it.
	must("starterCategories", finance.Row{})
	defaults, _ := svc.Summary(ctx, "2026-10")
	var defaultID string
	for _, c := range defaults.Categories {
		if c["name"] == "Wages" && c["kind"] == "INCOME" {
			defaultID = c["id"]
		}
	}
	if defaultID == "" {
		t.Fatal("missing default")
	}
	must("deleteCategory", finance.Row{"id": defaultID})
	for i := 0; i < 2; i++ {
		again, _ := svc.Summary(ctx, "2026-10")
		for _, c := range again.Categories {
			if c["id"] == defaultID {
				t.Fatal("reinstalled deleted default")
			}
		}
	}
	must("starterCategories", finance.Row{})
	restored, _ := svc.Summary(ctx, "2026-10")
	found := false
	for _, c := range restored.Categories {
		if c["name"] == "Wages" && c["kind"] == "INCOME" {
			found = true
		}
	}
	if !found {
		t.Fatal("explicit restore failed")
	}
	// Concurrent reference creation and deletion must not both succeed.
	for i := 0; i < 4; i++ {
		id := category(fmt.Sprintf("Race%d", i), "")
		var wg sync.WaitGroup
		wg.Add(2)
		var writeErr, deleteErr error
		go func() {
			defer wg.Done()
			_, writeErr = svc.Execute(ctx, "transaction", entry(id, "2026-10-17", "Concurrent"))
		}()
		go func() { defer wg.Done(); _, deleteErr = svc.Execute(ctx, "deleteCategory", finance.Row{"id": id}) }()
		wg.Wait()
		if writeErr == nil && deleteErr == nil {
			t.Fatal("deleted referenced category")
		}
	}
	after, _ := svc.Summary(ctx, "2026-10")
	if before == "" || after.Accounts[0]["balance"] == "" {
		t.Fatal("missing balances")
	}
}
