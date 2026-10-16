package api

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gentum.finance/backend/internal/account"
)

type memoryRepository struct{ accounts []account.Account }

func (r *memoryRepository) Save(_ context.Context, a account.Account) (account.Account, error) {
	r.accounts = append(r.accounts, a)
	return a, nil
}
func (r *memoryRepository) List(_ context.Context, user string) ([]account.Account, error) {
	result := []account.Account{}
	for _, a := range r.accounts {
		if a.UserID == user {
			result = append(result, a)
		}
	}
	return result, nil
}

type identity string

func (i identity) UserID(context.Context) (string, error) { return string(i), nil }

func execute(t *testing.T, h http.Handler, query string, variables map[string]interface{}) map[string]interface{} {
	t.Helper()
	body, err := json.Marshal(map[string]interface{}{"query": query, "variables": variables})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/graphql", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:5173")
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("HTTP %d: %s", response.Code, response.Body)
	}
	var result map[string]interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

const createMutation = `mutation Create($input: CreateAccountInput!){createAccount(input:$input){id name type currency initialBalance archived createdAt updatedAt}}`

func TestGraphQLAccountContract(t *testing.T) {
	repository := &memoryRepository{}
	handler, err := NewHandler(account.Service{Repository: repository, CurrentUser: identity("owner-a")}, "http://localhost:5173")
	if err != nil {
		t.Fatal(err)
	}
	for _, cents := range []string{"0", "29", "-1", "9223372036854775807", "-9223372036854775808"} {
		result := execute(t, handler, createMutation, map[string]interface{}{"input": map[string]interface{}{"name": "  Savings  ", "type": "SAVINGS", "currency": "EUR", "initialBalance": cents}})
		if result["errors"] != nil {
			t.Fatalf("%s: %v", cents, result)
		}
		a := result["data"].(map[string]interface{})["createAccount"].(map[string]interface{})
		if a["initialBalance"] != cents || a["name"] != "Savings" || a["id"] == "" {
			t.Fatalf("unexpected account: %v", a)
		}
	}
	result := execute(t, handler, `{accounts{id initialBalance}}`, nil)
	if result["errors"] != nil {
		t.Fatal(result)
	}
	if len(result["data"].(map[string]interface{})["accounts"].([]interface{})) != 5 {
		t.Fatal(result)
	}
	other, err := NewHandler(account.Service{Repository: repository, CurrentUser: identity("owner-b")}, "http://localhost:5173")
	if err != nil {
		t.Fatal(err)
	}
	result = execute(t, other, `{accounts{id}}`, nil)
	if len(result["data"].(map[string]interface{})["accounts"].([]interface{})) != 0 {
		t.Fatal("cross-user data leak")
	}
}

func TestRejectInvalidMoneyAndInputs(t *testing.T) {
	repository := &memoryRepository{}
	handler, err := NewHandler(account.Service{Repository: repository, CurrentUser: identity("owner")}, "http://localhost:5173")
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []interface{}{"1.00", "1e2", "9223372036854775808", "-9223372036854775809", "01", "-0", 100.0, nil} {
		result := execute(t, handler, createMutation, map[string]interface{}{"input": map[string]interface{}{"name": "Valid", "type": "CASH", "currency": "EUR", "initialBalance": value}})
		if result["errors"] == nil {
			t.Fatalf("accepted invalid cents: %v", value)
		}
	}
	for _, query := range []string{
		`mutation{createAccount(input:{name:"",type:CASH,currency:"EUR",initialBalance:"0"}){id}}`,
		`mutation{createAccount(input:{name:"Valid",type:CASH,currency:"XYZ",initialBalance:"0"}){id}}`,
		`mutation{createAccount(input:{name:"Valid",type:CASH,currency:"EUR",initialBalance:"0",userId:"other"}){id}}`,
		`mutation{createAccount(input:{name:"Valid",type:CASH,currency:"EUR",initialBalance:100}){id}}`,
	} {
		if result := execute(t, handler, query, nil); result["errors"] == nil {
			t.Fatal(result)
		}
	}
	if len(repository.accounts) != 0 {
		t.Fatal("invalid inputs were persisted")
	}
	if parseCents("9223372036854775807") != int64(math.MaxInt64) {
		t.Fatal("maximum precision lost")
	}
}

func TestHTTPBoundaries(t *testing.T) {
	handler, err := NewHandler(account.Service{Repository: &memoryRepository{}, CurrentUser: identity("owner")}, "http://localhost:5173")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		method, path, contentType, origin, body string
		status                                  int
	}{
		{"GET", "/graphql", "", "", "", 405},
		{"POST", "/graphql", "text/plain", "", "{}", 415},
		{"POST", "/graphql", "application/json", "https://evil.example", "{}", 403},
		{"POST", "/graphql", "application/json", "", "{", 400},
		{"POST", "/graphql", "application/json", "", "{} {}", 400},
		{"POST", "/graphql", "application/json", "", "{}", 400},
		{"POST", "/graphql", "application/json", "", strings.Repeat("x", (1<<20)+1), 400},
		{"GET", "/other", "", "", "", 404},
		{"OPTIONS", "/graphql", "", "http://localhost:5173", "", 204},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		r.Header.Set("Content-Type", c.contentType)
		r.Header.Set("Origin", c.origin)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != c.status {
			t.Errorf("%s %s: got %d, want %d", c.method, c.path, w.Code, c.status)
		}
	}
}
