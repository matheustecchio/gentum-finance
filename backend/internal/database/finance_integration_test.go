//go:build integration

package database

import (
	"context"
	"encoding/json"
	"fmt"
	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/api"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
	"io"
	"net/http"
	"net/http/httptest"
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
func TestCookieAuthenticationAndTransport(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if e := Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	origin := "http://localhost:5173"
	handler, e := api.NewHandler(account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: security.SessionUser{}}, origin, finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: security.SessionUser{}})
	if e != nil {
		t.Fatal(e)
	}
	auth := security.Auth{Pool: pool, Origin: origin}.Middleware(handler)
	call := func(path, body, source string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		method := "POST"
		if body == "" {
			method = "GET"
		}
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", source)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		auth.ServeHTTP(w, r)
		return w
	}
	credentials := `{"email":"fiction@example.test","password":"fictional-password-123"}`
	if w := call("/auth/register", credentials, "http://evil.test", nil); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w := call("/graphql", `{"query":"{accounts{id}}"}`, origin, nil); w.Code != 401 {
		t.Fatal(w.Code)
	}
	w := call("/auth/register", credentials, origin, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal(cookies)
	}
	cookie := cookies[0]
	w = call("/graphql", `{"query":"mutation{createAccount(input:{name:\"Private\",type:CASH,currency:\"EUR\",initialBalance:\"29\"}){id initialBalance}}"}`, origin, cookie)
	if w.Code != 200 || strings.Contains(w.Body.String(), "errors") {
		t.Fatal(w.Body.String())
	}
	w = call("/auth/logout", `{}`, origin, cookie)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	w = call("/auth/me", "", origin, cookie)
	if w.Code != 401 {
		t.Fatal("logout did not revoke session")
	}
	w = call("/auth/login", `{"email":"fiction@example.test","password":"wrong-password-123"}`, origin, nil)
	if w.Code != 401 {
		t.Fatal("accepted bad password")
	}
	w = call("/auth/login", credentials, origin, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	cookie = w.Result().Cookies()[0]
	w = call("/graphql", `{"query":"{accounts{id initialBalance}}"}`, origin, cookie)
	var result map[string]interface{}
	if e := json.NewDecoder(w.Result().Body).Decode(&result); e != nil {
		t.Fatal(e)
	}
	encoded, _ := json.Marshal(result)
	if !strings.Contains(string(encoded), `"initialBalance":"29"`) {
		t.Fatal(string(encoded))
	}
	pool.Exec(ctx, `UPDATE user_session SET expires_at=now()-interval '1 second'`)
	w = call("/auth/me", "", origin, cookie)
	body, _ := io.ReadAll(w.Result().Body)
	if w.Code != 401 {
		t.Fatal("accepted expired session", string(body))
	}
}
