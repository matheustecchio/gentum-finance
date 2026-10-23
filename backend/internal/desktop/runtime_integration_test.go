//go:build integration

package desktop_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"gentum.finance/backend/internal/application"
	"gentum.finance/backend/internal/desktop"
)

func TestManagedPostgresPersistsExactMoneySelectionAndPIN(t *testing.T) {
	binaries := os.Getenv("GENTUM_DESKTOP_POSTGRES_DIR")
	if binaries == "" {
		t.Skip("set GENTUM_DESKTOP_POSTGRES_DIR to bundled PostgreSQL resources")
	}
	dir := t.TempDir()
	type instance struct {
		pg     *desktop.Postgres
		app    *application.App
		bridge *desktop.Bridge
	}
	start := func() *instance {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		pg, err := desktop.StartPostgres(ctx, dir, binaries)
		if err != nil {
			t.Fatal(err)
		}
		app, err := application.Open(ctx, pg.Config, pg.Provision, desktop.Origin)
		if err != nil {
			pg.Close()
			t.Fatal(err)
		}
		bridge, err := desktop.NewBridge(app.Handler(), dir)
		if err != nil {
			app.Close()
			pg.Close()
			t.Fatal(err)
		}
		return &instance{pg, app, bridge}
	}
	stop := func(i *instance) { i.app.Close(); i.pg.Close() }
	first := start()
	request := func(i *instance, path string, body any, id string) desktop.Response {
		in := desktop.Request{Method: "GET", Path: path, Headers: map[string]string{"X-Gentum-Database": id}}
		if body != nil {
			raw, _ := json.Marshal(body)
			in.Method = "POST"
			in.Body = string(raw)
		}
		return i.bridge.Do(context.Background(), in)
	}
	must := func(reply desktop.Response) map[string]any {
		t.Helper()
		if reply.Status != 200 {
			t.Fatalf("operation failed with status %d: %s", reply.Status, reply.Body)
		}
		var out map[string]any
		if err := json.Unmarshal([]byte(reply.Body), &out); err != nil {
			t.Fatal(err)
		}
		if out["errors"] != nil {
			t.Fatalf("GraphQL errors: %v", out["errors"])
		}
		return out
	}
	status := must(request(first, "/auth/status", nil, ""))
	id := status["databaseId"].(string)
	must(request(first, "/auth/setup", map[string]string{"source": "new", "mode": "open"}, id))
	must(request(first, "/graphql", map[string]string{"query": `mutation {createAccount(input:{name:"Fictional exact wallet",type:CASH,currency:"EUR",initialBalance:"9007199254740993"}){id initialBalance}}`}, id))
	must(request(first, "/databases/create", map[string]string{"name": "Protected fixture", "mode": "pin", "pin": "0123"}, id))
	list := must(request(first, "/databases", nil, id))
	var target string
	for _, raw := range list["databases"].([]any) {
		l := raw.(map[string]any)
		if l["name"] == "Protected fixture" {
			target = l["id"].(string)
		}
	}
	if target == "" {
		t.Fatal("provisioned ledger missing")
	}
	if reply := request(first, "/databases/select", map[string]string{"id": target, "pin": "9999"}, id); reply.Status != 401 {
		t.Fatal("wrong PIN accepted")
	}
	must(request(first, "/databases/select", map[string]string{"id": target, "pin": "0123"}, id))
	if reply := request(first, "/graphql", map[string]string{"query": "{accounts{id}}"}, id); reply.Status != 409 {
		t.Fatal("stale ledger write scope accepted")
	}
	var superuser, createdb bool
	if err := first.app.Pool.QueryRow(context.Background(), `SELECT rolsuper,rolcreatedb FROM pg_roles WHERE rolname=current_user`).Scan(&superuser, &createdb); err != nil || superuser || createdb {
		t.Fatal("financial role has elevated privileges")
	}
	// A second sidecar cannot share this live cluster.
	if other, err := desktop.StartPostgres(context.Background(), dir, binaries); err == nil {
		other.Close()
		t.Fatal("data-directory lock was bypassed")
	}
	stop(first)
	second := start()
	defer stop(second)
	status = must(request(second, "/auth/status", nil, ""))
	if status["databaseId"] != target || status["unlocked"] != false || status["pinEnabled"] != true {
		t.Fatalf("selection or PIN did not survive restart: %v", status)
	}
	must(request(second, "/auth/unlock", map[string]string{"pin": "0123"}, target))
	must(request(second, "/databases/select", map[string]string{"id": id}, target))
	reply := must(request(second, "/graphql", map[string]string{"query": "{accounts{name initialBalance}}"}, id))
	accounts := reply["data"].(map[string]any)["accounts"].([]any)
	if len(accounts) != 1 || accounts[0].(map[string]any)["initialBalance"] != "9007199254740993" {
		t.Fatal("exact money did not survive managed database restart")
	}
}
