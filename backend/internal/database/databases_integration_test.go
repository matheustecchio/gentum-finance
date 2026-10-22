//go:build integration

package database

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"gentum.finance/backend/internal/security"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPhysicalDatabaseSelectionAndIsolation(t *testing.T) {
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, os.Getenv("GENTUM_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	physical := "gentum_registry_" + strings.ReplaceAll(security.ID(), "-", "")
	if _, err = admin.Exec(ctx, `CREATE DATABASE `+pgx.Identifier{physical}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	cfg := admin.Config().Copy()
	cfg.ConnConfig.Database = physical
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err = Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var registry *security.Databases
	build := func(p *pgxpool.Pool) (http.Handler, error) {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var name string
			if err := p.QueryRow(r.Context(), `SELECT current_database()`).Scan(&name); err != nil {
				http.Error(w, "unavailable", 503)
				return
			}
			w.Write([]byte(name))
		}), nil
	}
	registry = &security.Databases{Registry: pool, Provision: admin, Config: cfg, Origin: localOrigin, Build: build, Migrate: Migrate}
	if err = registry.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	defer func() {
		registry.Close()
		rows, _ := pool.Query(ctx, `SELECT physical_name FROM local_database WHERE NOT is_default`)
		var names []string
		if rows != nil {
			for rows.Next() {
				var n string
				rows.Scan(&n)
				names = append(names, n)
			}
			rows.Close()
		}
		pool.Close()
		for _, n := range append(names, physical) {
			admin.Exec(ctx, `DROP DATABASE `+pgx.Identifier{n}.Sanitize()+` WITH (FORCE)`)
		}
	}()
	assertFlatCatalog := func(name string) {
		t.Helper()
		var physicalName string
		if err := pool.QueryRow(ctx, `SELECT physical_name FROM local_database WHERE name=$1`, name).Scan(&physicalName); err != nil {
			t.Fatal(err)
		}
		catalogConfig := cfg.Copy()
		catalogConfig.ConnConfig.Database = physicalName
		catalogPool, err := pgxpool.NewWithConfig(ctx, catalogConfig)
		if err != nil {
			t.Fatal(err)
		}
		defer catalogPool.Close()
		var count, children int
		if err := catalogPool.QueryRow(ctx, `SELECT count(*),count(*) FILTER (WHERE parent_id IS NOT NULL) FROM category WHERE user_id=(SELECT user_id FROM local_access)`).Scan(&count, &children); err != nil || count != 32 || children != 0 {
			t.Fatal("additional database starter catalog", count, children, err)
		}
	}
	jar := map[string]*http.Cookie{}
	active := ""
	call := func(path, body string) *httptest.ResponseRecorder {
		method := "POST"
		if body == "" {
			method = "GET"
		}
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Origin", localOrigin)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Gentum-Database", active)
		for _, c := range jar {
			req.AddCookie(c)
		}
		reply := httptest.NewRecorder()
		registry.Middleware().ServeHTTP(reply, req)
		for _, c := range reply.Result().Cookies() {
			jar[c.Name] = c
		}
		return reply
	}
	status := call("/auth/status", "")
	var st map[string]any
	json.Unmarshal(status.Body.Bytes(), &st)
	active = st["databaseId"].(string)
	original := active
	if r := call("/auth/setup", `{"source":"new","mode":"open"}`); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	r := call("/databases/create", `{"name":"Second","mode":"pin","pin":"0123"}`)
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	assertFlatCatalog("Second")
	var created map[string]string
	json.Unmarshal(r.Body.Bytes(), &created)
	if created["recoveryCode"] == "" {
		t.Fatal("missing recovery code")
	}
	if r := call("/databases/create", `{"name":" second ","mode":"open"}`); r.Code != 400 {
		t.Fatal("duplicate name", r.Code)
	}
	r = call("/databases", "")
	var list struct {
		Databases []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
	}
	json.Unmarshal(r.Body.Bytes(), &list)
	target := ""
	for _, l := range list.Databases {
		if l.Name == "Second" {
			target = l.ID
		}
	}
	if target == "" {
		t.Fatal(r.Body.String())
	}
	r = call("/databases/select", `{"id":"`+target+`","pin":"9999"}`)
	if r.Code != 401 {
		t.Fatal(r.Code, r.Body.String())
	}
	if r = call("/graphql", `{}`); r.Body.String() != physical {
		t.Fatal("failed unlock changed original", r.Code, r.Body.String())
	}
	r = call("/databases/select", `{"id":"`+target+`","pin":"0123"}`)
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	if r = call("/graphql", `{}`); r.Code != 409 {
		t.Fatal("stale write accepted", r.Code)
	}
	active = target
	r = call("/graphql", `{}`)
	if r.Code != 200 || r.Body.String() == physical {
		t.Fatal("not physically isolated", r.Code, r.Body.String())
	}
	if r = call("/databases/rename", `{"id":"`+target+`","name":"Work"}`); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	// Restart the routing layer without replacing the browser cookies.
	registry.Close()
	registry = &security.Databases{Registry: pool, Provision: admin, Config: cfg, Origin: localOrigin, Build: build, Migrate: Migrate}
	if err = registry.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	r = call("/auth/status", "")
	json.Unmarshal(r.Body.Bytes(), &st)
	if st["databaseId"] != target || st["databaseName"] != "Work" || st["unlocked"] != true {
		t.Fatal("selection lost", r.Body.String())
	}
	if r = call("/databases/select", `{"id":"`+original+`"}`); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	active = original

	// Recovery of a nonselected target rotates only its protection and session.
	recoverBody, _ := json.Marshal(map[string]string{"id": target, "pin": "0456", "recoveryCode": created["recoveryCode"]})
	if r = call("/databases/select", string(recoverBody)); r.Code != 200 {
		t.Fatal("target recovery", r.Code, r.Body.String())
	}
	var replacement map[string]string
	json.Unmarshal(r.Body.Bytes(), &replacement)
	if replacement["recoveryCode"] == "" || replacement["recoveryCode"] == created["recoveryCode"] {
		t.Fatal("target recovery did not rotate code")
	}
	active = target
	if r = call("/databases/select", `{"id":"`+original+`"}`); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	active = original
	if r = call("/databases/select", `{"id":"`+target+`","pin":"0123"}`); r.Code != 401 {
		t.Fatal("old target PIN survived recovery", r.Code)
	}
	if r = call("/databases/select", `{"id":"`+target+`","pin":"0456"}`); r.Code != 200 {
		t.Fatal("replacement target PIN", r.Code, r.Body.String())
	}
	active = target
	if r = call("/databases/select", `{"id":"`+original+`"}`); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	active = original
	registry.Provision = nil
	if r = call("/databases/create", `{"name":"Unavailable","mode":"open"}`); r.Code != 503 {
		t.Fatal("provision failure", r.Code)
	}
	registry.Provision = admin
	if r = call("/graphql", `{}`); r.Body.String() != physical {
		t.Fatal("provision failure changed selection", r.Body.String())
	}
	// Failures are installation-wide even after switching and creating another database.
	for i := 0; i < 5; i++ {
		r = call("/databases/select", `{"id":"`+target+`","pin":"9999"}`)
		if r.Code != 401 {
			t.Fatal("attempt", i, r.Code, r.Body.String())
		}
	}
	if r = call("/databases/select", `{"id":"`+target+`","pin":"0123"}`); r.Code != 429 {
		t.Fatal("throttle bypass", r.Code, r.Body.String())
	}
	if r = call("/databases/create", `{"name":"Third","mode":"open"}`); r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	assertFlatCatalog("Third")
	if r = call("/databases/select", `{"id":"`+target+`","pin":"0123"}`); r.Code != 429 {
		t.Fatal("create reset throttle", r.Code, r.Body.String())
	}
}
