//go:build integration

package database

import (
	"context"
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/api"
	"gentum.finance/backend/internal/security"
	"github.com/jackc/pgx/v5/pgxpool"
)

const localOrigin = "http://localhost:5173"

type accessClient struct {
	t       *testing.T
	pool    *pgxpool.Pool
	handler http.Handler
	cookie  *http.Cookie
}

func newAccessClient(t *testing.T) *accessClient {
	t.Helper()
	pool := testPool(t)
	if err := Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	handler, err := api.NewHandler(account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: security.SessionUser{}}, localOrigin)
	if err != nil {
		t.Fatal(err)
	}
	return &accessClient{t: t, pool: pool, handler: security.Auth{Pool: pool, Origin: localOrigin}.Middleware(handler)}
}
func (c *accessClient) call(path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	method := "POST"
	if body == "" {
		method = "GET"
	}
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Origin", localOrigin)
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	return w
}
func (c *accessClient) expect(path, body string, code int) *httptest.ResponseRecorder {
	c.t.Helper()
	w := c.call(path, body, c.cookie)
	if w.Code != code {
		c.t.Fatalf("%s: got %d want %d: %s", path, w.Code, code, w.Body.String())
	}
	if code == 200 {
		for _, cookie := range w.Result().Cookies() {
			c.cookie = cookie
		}
	}
	return w
}
func codeFrom(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var result struct{ RecoveryCode string }
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || len(result.RecoveryCode) != 39 {
		t.Fatal("missing recovery code")
	}
	return result.RecoveryCode
}
func TestLocalPINRecoveryAndRevocation(t *testing.T) {
	c := newAccessClient(t)
	if !strings.Contains(c.expect("/auth/status", "", 200).Body.String(), `"setupRequired":true`) {
		t.Fatal("expected setup")
	}
	c.expect("/graphql", `{"query":"{accounts{id}}"}`, 401)
	c.expect("/auth/setup", `{"mode":"pin","pin":"123"}`, 400)
	code := codeFrom(t, c.expect("/auth/setup", `{"mode":"pin","pin":"0123"}`, 200))
	if !c.cookie.HttpOnly || c.cookie.SameSite != http.SameSiteStrictMode || c.cookie.MaxAge != 0 {
		t.Fatal("unsafe cookie")
	}
	c.expect("/auth/setup", `{"mode":"open"}`, 409)
	c.expect("/auth/register", `{}`, 404)
	c.expect("/auth/login", `{}`, 404)
	c.expect("/graphql", `{"query":"mutation{createAccount(input:{name:\"Private\",type:CASH,currency:\"EUR\",initialBalance:\"29\"}){id}}"}`, 200)
	var stored string
	if err := c.pool.QueryRow(context.Background(), `SELECT pin_hash||recovery_hash FROM local_access`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored, code) || len(stored) != 128 {
		t.Fatal("secret storage")
	}
	old := c.cookie
	c.expect("/auth/lock", `{}`, 200)
	if w := c.call("/graphql", `{"query":"{accounts{id}}"}`, old); w.Code != 401 {
		t.Fatal("lock did not revoke sessions")
	}
	c.expect("/auth/open", `{}`, 401)
	c.expect("/auth/pin", `{"pin":"4321"}`, 401)
	c.expect("/auth/unlock", `{"pin":"9999"}`, 401)
	c.expect("/auth/unlock", `{"pin":"0123"}`, 200)
	old = c.cookie
	c.expect("/auth/pin", `{"currentPin":"9999","pin":"4321"}`, 401)
	changed := codeFrom(t, c.expect("/auth/pin", `{"currentPin":"0123","pin":"4321"}`, 200))
	if w := c.call("/graphql", `{"query":"{accounts{id}}"}`, old); w.Code != 401 {
		t.Fatal("PIN change did not revoke sessions")
	}
	c.expect("/auth/lock", `{}`, 200)
	c.expect("/auth/unlock", `{"pin":"0123"}`, 401)
	c.expect("/auth/recover", `{"recoveryCode":"`+code+`","pin":"5678"}`, 401)
	reset := codeFrom(t, c.expect("/auth/recover", `{"recoveryCode":"`+strings.ToLower(changed)+`","pin":"5678"}`, 200))
	if changed == reset {
		t.Fatal("recovery code reused")
	}
	c.expect("/auth/recover", `{"recoveryCode":"`+changed+`","pin":"0000"}`, 401)
	c.expect("/auth/disable-pin", `{"currentPin":"4321"}`, 401)
	c.expect("/auth/disable-pin", `{"currentPin":"5678"}`, 200)
	c.cookie = nil
	c.expect("/auth/open", `{}`, 200)
	w := c.expect("/graphql", `{"query":"{accounts{id initialBalance}}"}`, 200)
	if !strings.Contains(w.Body.String(), `"initialBalance":"29"`) {
		t.Fatal("recovery lost exact cents", w.Body.String())
	}
	c.pool.Exec(context.Background(), `UPDATE user_session SET expires_at=now()-interval '1 second'`)
	c.expect("/graphql", `{"query":"{accounts{id}}"}`, 401)
}
func TestOpenAccessStillRequiresSameOriginSession(t *testing.T) {
	c := newAccessClient(t)
	r := httptest.NewRequest("POST", "/auth/setup", strings.NewReader(`{"mode":"open"}`))
	r.Header.Set("Origin", "http://evil.test")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("accepted foreign origin")
	}
	c.expect("/auth/setup", `{"mode":"open"}`, 200)
	c.cookie = nil
	c.expect("/graphql", `{"query":"{accounts{id}}"}`, 401)
	c.expect("/auth/open", `{}`, 200)
	c.expect("/auth/lock", `{}`, 400)
	c.expect("/graphql", `{"query":"{accounts{id}}"}`, 200)
	c.expect("/auth/pin", `{"pin":"12345"}`, 400)
	c.expect("/auth/pin", `{"pin":"1234","userId":"foreign"}`, 400)
	codeFrom(t, c.expect("/auth/pin", `{"pin":"1234"}`, 200))
}
func TestPINAttemptsArePersistentAndInstallationWide(t *testing.T) {
	c := newAccessClient(t)
	c.expect("/auth/setup", `{"mode":"pin","pin":"1234"}`, 200)
	c.expect("/auth/lock", `{}`, 200)
	for i := 0; i < 5; i++ {
		c.expect("/auth/unlock", `{"pin":"9999"}`, 401)
	}
	// A fresh middleware instance and missing cookie cannot reset the counter.
	c.handler = security.Auth{Pool: c.pool, Origin: localOrigin}.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	c.cookie = nil
	w := c.expect("/auth/unlock", `{"pin":"1234"}`, 429)
	if w.Header().Get("Retry-After") == "" {
		t.Fatal("missing retry delay")
	}
	c.pool.Exec(context.Background(), `UPDATE local_access_attempt SET retry_at=now()-interval '1 second'`)
	c.expect("/auth/unlock", `{"pin":"9999"}`, 401)
	var failures int
	c.pool.QueryRow(context.Background(), `SELECT failures FROM local_access_attempt WHERE purpose='pin'`).Scan(&failures)
	if failures != 6 {
		t.Fatal("lost progressive failures")
	}
	c.pool.Exec(context.Background(), `UPDATE local_access_attempt SET retry_at=now()-interval '1 second'`)
	c.expect("/auth/unlock", `{"pin":"1234"}`, 200)
	var count int
	c.pool.QueryRow(context.Background(), `SELECT count(*) FROM local_access_attempt WHERE purpose='pin'`).Scan(&count)
	if count != 0 {
		t.Fatal("successful unlock did not clear failures")
	}
}
func TestExistingProfileAdoptionRequiresPasswordAndPreservesOwners(t *testing.T) {
	c := newAccessClient(t)
	ctx := context.Background()
	id := security.ID()
	salt := security.ID()
	key, _ := pbkdf2.Key(sha256.New, "fictional-password", []byte(salt), 600000, 32)
	_, err := c.pool.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at,password_salt,password_hash) VALUES($1,'old@example.test','Old profile','EUR',now(),now(),$2,$3)`, id, salt, hex.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.pool.Exec(ctx, `INSERT INTO account(id,user_id,name,type,currency,initial_balance,created_at,updated_at) VALUES($1,$2,'Existing','CASH','EUR',29,now(),now())`, security.ID(), id)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c.expect("/auth/status", "", 200).Body.String(), `"legacyRequired":true`) {
		t.Fatal("legacy credentials not required")
	}
	c.expect("/auth/setup", `{"mode":"open"}`, 401)
	c.expect("/auth/setup", `{"mode":"open","email":"old@example.test","password":"wrong"}`, 401)
	c.expect("/auth/setup", `{"mode":"open","email":"old@example.test","password":"fictional-password"}`, 200)
	w := c.expect("/graphql", `{"query":"{accounts{id initialBalance}}"}`, 200)
	if !strings.Contains(w.Body.String(), `"initialBalance":"29"`) {
		t.Fatal("existing owner data lost")
	}
	var owner string
	c.pool.QueryRow(ctx, `SELECT user_id::text FROM local_access`).Scan(&owner)
	if owner != id {
		t.Fatal("wrong owner adopted")
	}
	var users int
	c.pool.QueryRow(ctx, `SELECT count(*) FROM gentum_user`).Scan(&users)
	if users != 2 {
		t.Fatal("legacy users deleted")
	}
}
func TestConcurrentSetupChoosesOnlyOneLocalProfile(t *testing.T) {
	c := newAccessClient(t)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- c.call("/auth/setup", `{"mode":"open"}`, nil).Code }()
	}
	wg.Wait()
	close(codes)
	successes, conflicts := 0, 0
	for code := range codes {
		if code == 200 {
			successes++
		}
		if code == 409 {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatal("setup race", successes, conflicts)
	}
}
