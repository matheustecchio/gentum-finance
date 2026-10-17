//go:build integration

package database

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
	"io"
	"strings"
	"testing"
	"time"
)

type owner string

func (o owner) UserID(context.Context) (string, error) { return string(o), nil }
func TestFinanceAtomicityIsolationAndExactness(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if e := Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	u := "00000000-0000-0000-0000-000000000001"
	other := security.ID()
	if _, e := pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,'other@example.test','Other','EUR',now(),now())`, other); e != nil {
		t.Fatal(e)
	}
	accounts := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: owner(u)}
	a, e := accounts.Create(ctx, account.Input{Name: "Main", Type: "CASH", Currency: "EUR", InitialBalance: 10000})
	if e != nil {
		t.Fatal(e)
	}
	b, _ := accounts.Create(ctx, account.Input{Name: "Savings", Type: "SAVINGS", Currency: "EUR"})
	usd, _ := accounts.Create(ctx, account.Input{Name: "USD", Type: "CASH", Currency: "USD"})
	repo := finance.PostgresRepository{Pool: pool}
	s := finance.Service{Repository: repo, CurrentUser: owner(u)}
	month := time.Now().UTC().Format("2006-01")
	day := time.Now().UTC().Format("2006-01-02")
	must := func(action string, in finance.Row) string {
		t.Helper()
		v, e := s.Execute(ctx, action, in)
		if e != nil {
			t.Fatal(action, e)
		}
		return v
	}
	must("category", finance.Row{"name": "Food", "kind": "EXPENSE"})
	must("category", finance.Row{"name": "Salary", "kind": "INCOME"})
	snap, e := s.Snapshot(ctx, month)
	if e != nil {
		t.Fatal(e)
	}
	expense, income := "", ""
	for _, c := range snap.Categories {
		if c["kind"] == "EXPENSE" {
			expense = c["id"]
		} else {
			income = c["id"]
		}
	}
	entry := finance.Row{"accountId": a.ID, "categoryId": expense, "kind": "EXPENSE", "amount": "29", "date": day, "description": "=SUM(1,2)"}
	must("transaction", entry)
	must("transfer", finance.Row{"fromId": a.ID, "toId": b.ID, "amount": "100", "date": day})
	if _, e := s.Execute(ctx, "transfer", finance.Row{"fromId": a.ID, "toId": usd.ID, "amount": "100", "date": day}); e == nil {
		t.Fatal("accepted cross currency transfer")
	}
	must("budget", finance.Row{"categoryId": expense, "currency": "EUR", "month": month, "amount": "1000"})
	snap, e = s.Snapshot(ctx, month)
	if e != nil {
		t.Fatal(e)
	}
	if snap.Accounts[0]["balance"] != "9871" || snap.Accounts[1]["balance"] != "100" || snap.Budgets[0]["spent"] != "29" {
		t.Fatal(snap)
	}
	for _, v := range snap.Totals {
		if v["currency"] == "EUR" && v["expense"] != "29" {
			t.Fatal(v)
		}
	}
	foreign := finance.Service{Repository: repo, CurrentUser: owner(other)}
	empty, e := foreign.Snapshot(ctx, month)
	if e != nil || len(empty.Accounts) != 0 || len(empty.Entries) != 0 {
		t.Fatal(empty, e)
	}
	if _, e := foreign.Execute(ctx, "transaction", entry); e == nil {
		t.Fatal("accepted foreign references")
	}
	before := len(snap.Entries)
	csv := fmt.Sprintf("date,account_id,category_id,kind,amount_cents,description\n%s,%s,%s,EXPENSE,1,valid\n%s,%s,%s,EXPENSE,0,invalid\n", day, a.ID, expense, day, a.ID, expense)
	if _, e := s.Execute(ctx, "import", finance.Row{"csv": csv}); e == nil {
		t.Fatal("accepted invalid import")
	}
	snap, _ = s.Snapshot(ctx, month)
	if len(snap.Entries) != before {
		t.Fatal("partial import")
	}
	csv = fmt.Sprintf("date,account_id,category_id,kind,amount_cents,description\n%s,%s,%s,INCOME,9007199254740993,Exact\n", day, a.ID, income)
	must("import", finance.Row{"csv": csv})
	out := must("export", finance.Row{})
	decoded, err := base64.StdEncoding.DecodeString(out)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(decoded), int64(len(decoded)))
	if err != nil {
		t.Fatal(err)
	}
	out = ""
	for _, file := range archive.File {
		f, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(f)
		f.Close()
		out += string(data)
	}
	if !strings.Contains(out, "9007199254740993") || !strings.Contains(out, "'=SUM(1,2)") {
		t.Fatal(out)
	}
	schedule := finance.Row{"accountId": a.ID, "categoryId": expense, "kind": "EXPENSE", "amount": "1", "date": day, "description": "Monthly"}
	must("recurring", schedule)
	must("runDue", finance.Row{})
	snap, _ = s.Snapshot(ctx, month)
	before = len(snap.Entries)
	must("runDue", finance.Row{})
	snap, _ = s.Snapshot(ctx, month)
	if len(snap.Entries) != before {
		t.Fatal("duplicate recurrence")
	}
	max, _ := accounts.Create(ctx, account.Input{Name: "Limit", Type: "CASH", Currency: "EUR", InitialBalance: 9223372036854775807})
	if _, e := s.Execute(ctx, "transaction", finance.Row{"accountId": max.ID, "categoryId": income, "kind": "INCOME", "amount": "1", "date": day}); e == nil {
		t.Fatal("accepted balance overflow")
	}
}
