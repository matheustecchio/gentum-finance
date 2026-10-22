//go:build integration

package database

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
)

func TestHierarchyStarterAggregationAndCSV(t *testing.T) {
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
	must("category", finance.Row{"name": "Home", "kind": "EXPENSE"})
	snap, err := svc.Snapshot(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	root := snap.Categories[0]["id"]
	if len(snap.Categories[0]["color"]) != 7 {
		t.Fatal("missing initial color")
	}
	must("categoryColor", finance.Row{"id": root, "color": "#A1B2C3"})
	snap, err = svc.Snapshot(ctx, "2026-10")
	if err != nil || snap.Categories[0]["color"] != "#a1b2c3" {
		t.Fatal("color did not persist", err)
	}
	for _, color := range []string{"red", "#fff", "#gggggg", "#1234567", ""} {
		fail("categoryColor", finance.Row{"id": root, "color": color})
	}
	fail("categoryColor", finance.Row{"id": security.ID(), "color": "#123456"})

	must("category", finance.Row{"name": "Repairs", "kind": "EXPENSE", "parentId": root})
	snap, _ = svc.Snapshot(ctx, "2026-10")
	child := ""
	for _, c := range snap.Categories {
		if c["parentId"] == root {
			child = c["id"]
			if c["path"] != "Home / Repairs" {
				t.Fatal(c)
			}
		}
	}
	fail("category", finance.Row{"name": " repairs ", "kind": "EXPENSE", "parentId": root})
	fail("category", finance.Row{"name": "HOME", "kind": "EXPENSE"})
	fail("category", finance.Row{"name": "Third", "kind": "EXPENSE", "parentId": child})
	fail("category", finance.Row{"name": "Wrong kind", "kind": "INCOME", "parentId": root})
	fail("category", finance.Row{"name": "Missing", "kind": "EXPENSE", "parentId": security.ID()})
	other := security.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'foreign@test.invalid','Foreign','EUR',now(),now())`, other); err != nil {
		t.Fatal(err)
	}
	foreign := finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: owner(other)}
	if _, err := foreign.Execute(ctx, "categoryColor", finance.Row{"id": root, "color": "#123456"}); err == nil {
		t.Fatal("foreign color update")
	}

	if _, err := foreign.Execute(ctx, "category", finance.Row{"name": "Foreign", "kind": "EXPENSE", "parentId": root}); err == nil {
		t.Fatal("foreign parent")
	}
	fail("starterCategories", finance.Row{})
	snap, err = svc.Snapshot(ctx, "2026-10")
	if err != nil || len(snap.Categories) != 2 {
		t.Fatal("existing hierarchy changed", snap.Categories, err)
	}
	accounts := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(user)}
	a, err := accounts.Create(ctx, account.Input{Name: "Main", Type: "CASH", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := accounts.Create(ctx, account.Input{Name: "Dollar", Type: "CASH", Currency: "USD"})
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range []struct{ account, cat, amount string }{{a.ID, root, "29"}, {a.ID, child, "9007199254740993"}, {b.ID, child, "17"}} {
		must("transaction", finance.Row{"accountId": v.account, "categoryId": v.cat, "amount": v.amount, "kind": "EXPENSE", "date": "2026-10-17"})
	}
	for _, cat := range []string{root, child} {
		must("budget", finance.Row{"categoryId": cat, "amount": "100", "currency": "EUR", "month": "2026-10"})
	}
	snap, err = svc.Snapshot(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	for _, budget := range snap.Budgets {
		expected := "9007199254740993"
		if budget["categoryId"] == root {
			expected = "9007199254741022"
		}
		if budget["spent"] != expected {
			t.Fatal(budget)
		}
	}
	for _, v := range snap.Breakdown {
		if v["categoryId"] == root && v["currency"] == "EUR" && (v["total"] != "9007199254741022" || v["direct"] != "29") {
			t.Fatal(v)
		}
	}
	// Renaming preserves every linked record and the existing hierarchy, kind and color.
	must("recurring", finance.Row{"accountId": a.ID, "categoryId": child, "kind": "EXPENSE", "amount": "19", "date": "2027-01-17"})
	beforeRename, _ := svc.Snapshot(ctx, "2026-10")
	must("category", finance.Row{"name": "Other", "kind": "EXPENSE", "parentId": root})
	fail("renameCategory", finance.Row{"id": child, "name": " OTHER "})
	for _, name := range []string{"", "   ", strings.Repeat("界", 101)} {
		fail("renameCategory", finance.Row{"id": child, "name": name})
	}
	fail("renameCategory", finance.Row{"id": security.ID(), "name": "Missing"})
	if _, err := foreign.Execute(ctx, "renameCategory", finance.Row{"id": child, "name": "Stolen"}); err == nil {
		t.Fatal("foreign rename")
	}
	must("renameCategory", finance.Row{"id": root, "name": " Housing "})
	must("category", finance.Row{"name": "Maintenance", "kind": "EXPENSE"})
	must("category", finance.Row{"name": "Maintenance", "kind": "INCOME"})
	must("renameCategory", finance.Row{"id": child, "name": strings.Repeat("界", 100)})
	must("renameCategory", finance.Row{"id": child, "name": " Maintenance "})
	must("renameCategory", finance.Row{"id": child, "name": "Maintenance"})
	renamed, err := svc.Snapshot(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(beforeRename.Accounts, renamed.Accounts) || !reflect.DeepEqual(beforeRename.Entries, renamed.Entries) || !reflect.DeepEqual(beforeRename.Recurring, renamed.Recurring) || !reflect.DeepEqual(beforeRename.Budgets, renamed.Budgets) {
		t.Fatal("rename changed financial records")
	}
	for _, c := range renamed.Categories {
		if c["id"] == child && (c["name"] != "Maintenance" || c["parentId"] != root || c["path"] != "Housing / Maintenance" || c["kind"] != "EXPENSE") {
			t.Fatal(c)
		}
		if c["id"] == root && (c["name"] != "Housing" || c["color"] != "#a1b2c3") {
			t.Fatal(c)
		}
	}
	csv := fmt.Sprintf("date,kind,category_id,amount_cents,description\n2026-10-17,EXPENSE,%s,1,Selected\n", child)
	fail("import", finance.Row{"csv": csv})
	if _, err := foreign.Execute(ctx, "import", finance.Row{"csv": csv, "accountId": a.ID}); err == nil {
		t.Fatal("foreign destination")
	}
	must("import", finance.Row{"csv": csv, "accountId": b.ID})
	before, _ := svc.Snapshot(ctx, "2026-10")
	fail("import", finance.Row{"csv": csv + fmt.Sprintf("2026-10-17,EXPENSE,%s,0,Invalid\n", child), "accountId": b.ID})
	after, _ := svc.Snapshot(ctx, "2026-10")
	if len(after.Entries) != len(before.Entries) {
		t.Fatal("partial import")
	}
	legacy := fmt.Sprintf("date,account_id,category_id,kind,amount_cents,description\n2026-10-17,%s,%s,EXPENSE,1,Legacy EUR\n2026-10-17,%s,%s,EXPENSE,2,Legacy USD\n", a.ID, root, b.ID, child)
	must("import", finance.Row{"csv": legacy, "accountId": security.ID()})
	if _, err := pool.Exec(ctx, `UPDATE account SET archived=true WHERE id=$1`, b.ID); err != nil {
		t.Fatal(err)
	}
	fail("import", finance.Row{"csv": csv, "accountId": b.ID})
	after, err = svc.Snapshot(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range after.Entries {
		if entry["description"] == "Legacy EUR" && entry["accountId"] != a.ID {
			t.Fatal(entry)
		}
		if entry["description"] == "Legacy USD" && entry["accountId"] != b.ID {
			t.Fatal(entry)
		}
	}
}

func TestHierarchyMigrationPreservesExistingFinance(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	for _, name := range []string{"V1__create_users_and_accounts.sql", "V2__rename_ledger_to_gentum.sql", "V3__store_money_as_integer_cents.sql", "V4__finance_mvp.sql", "V5__local_access.sql"} {
		data, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	user := "00000000-0000-0000-0000-000000000001"
	cat, acct, sched, entry, budget := security.ID(), security.ID(), security.ID(), security.ID(), security.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO account(id,user_id,name,type,currency,initial_balance,created_at,updated_at) VALUES($1,$2,'Legacy','CASH','EUR',123,now(),now())`, acct, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO category(id,user_id,name,kind) VALUES($1,$2,'Legacy','EXPENSE')`, cat, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO recurring(id,user_id,account_id,category_id,kind,amount,description,next_date,anchor_day) VALUES($1,$2,$3,$4,'EXPENSE',29,'Monthly','2026-10-17',17)`, sched, user, acct, cat); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO entry(id,user_id,account_id,category_id,kind,amount,description,entry_date,recurring_id) VALUES($1,$2,$3,$4,'EXPENSE',29,'Legacy','2026-10-17',$5)`, entry, user, acct, cat, sched); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO budget(id,user_id,category_id,currency,month,amount) VALUES($1,$2,$3,'EUR','2026-10-01',100)`, budget, user, cat); err != nil {
		t.Fatal(err)
	}
	before := map[string]string{}
	for _, table := range []string{"account", "entry", "budget", "recurring"} {
		var data string
		if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM `+table+` t`).Scan(&data); err != nil {
			t.Fatal(err)
		}
		before[table] = data
	}
	data, _ := migrations.ReadFile("migrations/V6__category_hierarchy.sql")
	if _, err := pool.Exec(ctx, string(data)); err != nil {
		t.Fatal(err)
	}
	for table, want := range before {
		var got string
		if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM `+table+` t`).Scan(&got); err != nil || got != want {
			t.Fatal(table, got, want, err)
		}
	}
	var id string
	var root bool
	if err := pool.QueryRow(ctx, `SELECT id::text,parent_id IS NULL FROM category WHERE id=$1`, cat).Scan(&id, &root); err != nil || id != cat || !root {
		t.Fatal(id, root, err)
	}
}
