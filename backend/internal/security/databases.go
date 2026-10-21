package security

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ledger struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Physical   string `json:"-"`
	PINEnabled bool   `json:"pinEnabled"`
	pool       *pgxpool.Pool
	handler    http.Handler
}

// Databases keeps installation metadata separate from the selected financial pool.
type Databases struct {
	Registry  *pgxpool.Pool
	Provision *pgxpool.Pool
	Config    *pgxpool.Config
	Origin    string
	Build     func(*pgxpool.Pool) (http.Handler, error)
	Migrate   func(context.Context, *pgxpool.Pool) error
	mu        sync.Mutex
	ledgers   map[string]*ledger
	defaultID string
}

func (d *Databases) Initialize(ctx context.Context) error {
	d.ledgers = map[string]*ledger{}
	_, err := d.Registry.Exec(ctx, `INSERT INTO local_database(id,name,physical_name,is_default) VALUES($1,'My database',current_database(),true) ON CONFLICT DO NOTHING`, ID())
	if err != nil {
		return err
	}
	rows, err := d.Registry.Query(ctx, `SELECT id::text,name,physical_name,is_default FROM local_database ORDER BY is_default DESC,name`)
	if err != nil {
		return err
	}
	type entry struct {
		l   ledger
		def bool
	}
	var entries []entry
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.l.ID, &e.l.Name, &e.l.Physical, &e.def); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, e)
	}
	rows.Close()
	if rows.Err() != nil {
		return rows.Err()
	}
	for _, e := range entries {
		l := e.l
		if e.def {
			d.defaultID = l.ID
		}
		cfg := d.Config.Copy()
		cfg.ConnConfig.Database = l.Physical
		l.pool, err = pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			return err
		}
		if err = d.Migrate(ctx, l.pool); err != nil {
			return err
		}
		l.handler, err = d.Build(l.pool)
		if err != nil {
			return err
		}
		d.ledgers[l.ID] = &l
	}
	return nil
}
func (d *Databases) Close() {
	for _, l := range d.ledgers {
		if l.pool != d.Registry {
			l.pool.Close()
		}
	}
}
func (d *Databases) Middleware() http.Handler { return http.HandlerFunc(d.serve) }
func (d *Databases) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Path == "/healthz" {
		Auth{Pool: d.Registry, Origin: d.Origin}.Middleware(nil).ServeHTTP(w, r)
		return
	}
	if r.Method != "GET" && (r.Header.Get("Origin") != d.Origin || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json")) {
		http.Error(w, "Origin and JSON content type required", 403)
		return
	}
	cookie, err := r.Cookie("gentum_database_session")
	token := ""
	if err == nil {
		token = cookie.Value
	}
	if len(token) != 72 {
		token = ID() + ID()
	}
	tx, err := d.Registry.Begin(r.Context())
	if err != nil {
		http.Error(w, "Database registry unavailable", 503)
		return
	}
	defer tx.Rollback(r.Context())
	// A transaction-level lock works across server processes and keeps switches behind in-flight writes.
	if _, err = tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(hashtextextended($1,73195023))`, token); err != nil {
		http.Error(w, "Database registry unavailable", 503)
		return
	}
	id := d.defaultID
	err = tx.QueryRow(r.Context(), `SELECT database_id::text FROM local_database_selection WHERE token_hash=$1`, hash(token)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		id = d.defaultID
		_, err = tx.Exec(r.Context(), `INSERT INTO local_database_selection(token_hash,database_id) VALUES($1,$2)`, hash(token), id)
	}
	if err != nil {
		http.Error(w, "Database selection unavailable", 503)
		return
	}
	d.mu.Lock()
	var l *ledger
	if stored := d.ledgers[id]; stored != nil {
		snapshot := *stored
		l = &snapshot
	}
	d.mu.Unlock()
	if l == nil {
		http.Error(w, "Database unavailable", 503)
		return
	}
	if err = tx.QueryRow(r.Context(), `SELECT name FROM local_database WHERE id=$1`, id).Scan(&l.Name); err != nil {
		http.Error(w, "Database unavailable", 503)
		return
	}
	// Bind every operation except initial discovery to the selection the browser observed.
	if r.URL.Path != "/auth/status" && r.Header.Get("X-Gentum-Database") != id {
		http.Error(w, "Database changed. Refresh before continuing.", 409)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "gentum_database_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 31536000})
	var reply *httptest.ResponseRecorder
	if strings.HasPrefix(r.URL.Path, "/databases") {
		reply = httptest.NewRecorder()
		d.manage(reply, r, l, tx, token)
	} else {
		reply = httptest.NewRecorder()
		// Persistent installation-wide counters are independent of every financial database.
		protected := r.Method == "POST" && strings.HasPrefix(r.URL.Path, "/auth/") && r.URL.Path != "/auth/open" && r.URL.Path != "/auth/lock"
		if protected {
			if _, err = tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(73195024)`); err != nil {
				http.Error(w, "Access unavailable", 503)
				return
			}
			if !installationAllowed(r.Context(), tx, reply) {
				copyReply(w, reply)
				return
			}
		}
		verifiedPINChange := false
		if r.URL.Path == "/auth/pin" || r.URL.Path == "/auth/disable-pin" {
			if before, readErr := readAccess(r.Context(), l.pool); readErr == nil {
				verifiedPINChange = before.PINHash != ""
			}
		}
		Auth{Pool: l.pool, Origin: d.Origin}.Middleware(l.handler).ServeHTTP(reply, r)
		if protected && reply.Code == 401 {
			if !d.recordFailure(r.Context(), tx) {
				http.Error(w, "Access unavailable", 503)
				return
			}
		}
		if reply.Code == 200 && (r.URL.Path == "/auth/unlock" || r.URL.Path == "/auth/recover" || verifiedPINChange) {
			if _, err = tx.Exec(r.Context(), `DELETE FROM local_installation_attempt WHERE purpose='installation'`); err != nil {
				http.Error(w, "Access unavailable", 503)
				return
			}
		}
		if r.URL.Path == "/auth/status" && reply.Code == 200 {
			var status map[string]any
			if json.Unmarshal(reply.Body.Bytes(), &status) == nil {
				status["databaseId"] = l.ID
				status["databaseName"] = l.Name
				reply.Body.Reset()
				json.NewEncoder(reply.Body).Encode(status)
			}
		}
	}
	if err = tx.Commit(r.Context()); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		http.Error(w, "Unable to save database selection", 503)
		return
	}
	copyReply(w, reply)
}
func copyReply(w http.ResponseWriter, r *httptest.ResponseRecorder) {
	for k, vs := range r.Header() {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(r.Code)
	w.Write(r.Body.Bytes())
}
func (d *Databases) recordFailure(ctx context.Context, tx pgx.Tx) bool {
	var n int
	err := tx.QueryRow(ctx, `INSERT INTO local_installation_attempt(purpose,failures) VALUES('installation',1) ON CONFLICT(purpose) DO UPDATE SET failures=LEAST(local_installation_attempt.failures+1,100) RETURNING failures`).Scan(&n)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE local_installation_attempt SET retry_at=now()+$1*interval '1 second' WHERE purpose='installation'`, int(retryDelay(n).Seconds()))
	}
	return err == nil
}

type databaseInput struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Mode         string `json:"mode"`
	PIN          string `json:"pin"`
	RecoveryCode string `json:"recoveryCode"`
}

func (d *Databases) manage(w http.ResponseWriter, r *http.Request, current *ledger, tx pgx.Tx, token string) {
	if _, err := (Auth{Pool: current.pool}).identity(r); err != nil {
		http.Error(w, "Unlock your local wallet", 401)
		return
	}
	if r.URL.Path == "/databases" && r.Method == "GET" {
		rows, err := tx.Query(r.Context(), `SELECT id::text,name FROM local_database ORDER BY lower(name)`)
		if err != nil {
			http.Error(w, "Unable to list databases", 503)
			return
		}
		var list []ledger
		for rows.Next() {
			var l ledger
			if rows.Scan(&l.ID, &l.Name) != nil {
				rows.Close()
				http.Error(w, "Unable to list databases", 503)
				return
			}
			list = append(list, l)
		}
		rows.Close()
		if rows.Err() != nil {
			http.Error(w, "Unable to list databases", 503)
			return
		}
		for i := range list {
			d.mu.Lock()
			l := d.ledgers[list[i].ID]
			d.mu.Unlock()
			if l != nil {
				p, err := readAccess(r.Context(), l.pool)
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					http.Error(w, "Database unavailable", 503)
					return
				}
				list[i].PINEnabled = p.PINHash != ""
			}
		}
		respond(w, map[string]any{"activeId": current.ID, "databases": list})
		return
	}
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	var in databaseInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	var extra any
	if dec.Decode(&in) != nil || dec.Decode(&extra) != io.EOF {
		http.Error(w, "Invalid request", 400)
		return
	}
	if r.URL.Path == "/databases/select" {
		d.selectDatabase(w, r, current, tx, token, in)
		return
	}
	if r.URL.Path != "/databases/create" && r.URL.Path != "/databases/rename" {
		http.NotFound(w, r)
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 100 {
		http.Error(w, "Use a database name between 1 and 100 characters", 400)
		return
	}
	// Serialize name checks and creation across sessions.
	if _, err := tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(73195025)`); err != nil {
		http.Error(w, "Database registry unavailable", 503)
		return
	}
	var duplicate bool
	if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM local_database WHERE lower(name)=lower($1) AND id::text<>$2)`, in.Name, in.ID).Scan(&duplicate); err != nil {
		http.Error(w, "Database registry unavailable", 503)
		return
	}
	if duplicate {
		http.Error(w, "A database with this name already exists", 400)
		return
	}
	if r.URL.Path == "/databases/rename" {
		tag, err := tx.Exec(r.Context(), `UPDATE local_database SET name=$1 WHERE id::text=$2`, in.Name, in.ID)
		if err != nil {
			http.Error(w, "Unable to rename database", 503)
			return
		}
		if tag.RowsAffected() == 0 {
			http.Error(w, "Database not found", 404)
			return
		}
		respond(w, map[string]string{})
		return
	}
	d.createDatabase(w, r, tx, in)
}
func (d *Databases) selectDatabase(w http.ResponseWriter, r *http.Request, current *ledger, tx pgx.Tx, token string, in databaseInput) {
	if current.ID == in.ID {
		respond(w, map[string]string{})
		return
	}
	d.mu.Lock()
	target := d.ledgers[in.ID]
	d.mu.Unlock()
	if target == nil {
		http.Error(w, "Database not found", 404)
		return
	}
	if _, err := tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(73195024)`); err != nil {
		http.Error(w, "Access unavailable", 503)
		return
	}
	if !installationAllowed(r.Context(), tx, w) {
		return
	}
	p, err := readAccess(r.Context(), target.pool)
	if err != nil {
		http.Error(w, "Target database unavailable", 503)
		return
	}
	path := "/auth/open"
	if p.PINHash != "" {
		path = "/auth/unlock"
	}
	req := r.Clone(r.Context())
	u := *r.URL
	req.URL = &u
	req.URL.Path = path
	if in.RecoveryCode != "" {
		req.URL.Path = "/auth/recover"
	}
	req.Body = io.NopCloser(strings.NewReader(fmt.Sprintf(`{"pin":%q,"recoveryCode":%q}`, in.PIN, in.RecoveryCode)))
	reply := httptest.NewRecorder()
	Auth{Pool: target.pool, Origin: d.Origin}.handle(reply, req)
	if reply.Code != 200 {
		if reply.Code == 401 && !d.recordFailure(r.Context(), tx) {
			http.Error(w, "Access unavailable", 503)
			return
		}
		copyReply(w, reply)
		return
	}
	if p.PINHash != "" {
		if _, err = tx.Exec(r.Context(), `DELETE FROM local_installation_attempt WHERE purpose='installation'`); err != nil {
			http.Error(w, "Access unavailable", 503)
			return
		}
	}
	if _, err = tx.Exec(r.Context(), `UPDATE local_database_selection SET database_id=$1 WHERE token_hash=$2`, target.ID, hash(token)); err != nil {
		http.Error(w, "Unable to select database", 503)
		return
	}
	copyReply(w, reply)
}

func (d *Databases) createDatabase(w http.ResponseWriter, r *http.Request, tx pgx.Tx, in databaseInput) {
	if d.Provision == nil {
		http.Error(w, "Configure a separate database provisioner to create databases", 503)
		return
	}
	if in.Mode != "open" && in.Mode != "pin" {
		http.Error(w, "Choose open access or PIN protection", 400)
		return
	}
	if in.Mode == "pin" && !pinValid(in.PIN) {
		http.Error(w, errPIN.Error(), 400)
		return
	}
	id := ID()
	physical := "gentum_" + strings.ReplaceAll(id, "-", "")
	sql := `CREATE DATABASE ` + pgx.Identifier{physical}.Sanitize() + ` OWNER ` + pgx.Identifier{d.Config.ConnConfig.User}.Sanitize()
	if _, err := d.Provision.Exec(r.Context(), sql); err != nil {
		http.Error(w, "Unable to provision database. Check provisioner permissions and local capacity.", 503)
		return
	}
	cfg := d.Config.Copy()
	cfg.ConnConfig.Database = physical
	pool, err := pgxpool.NewWithConfig(r.Context(), cfg)
	published := false
	defer func() {
		if !published {
			if pool != nil {
				pool.Close()
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			d.Provision.Exec(ctx, `DROP DATABASE `+pgx.Identifier{physical}.Sanitize())
		}
	}()
	if err == nil {
		err = d.Migrate(r.Context(), pool)
	}
	if err != nil {
		http.Error(w, "Unable to initialize database", 503)
		return
	}
	req := r.Clone(r.Context())
	u := *r.URL
	u.Path = "/auth/setup"
	req.URL = &u
	body, _ := json.Marshal(map[string]string{"mode": in.Mode, "source": "new", "pin": in.PIN})
	req.Body = io.NopCloser(strings.NewReader(string(body)))
	reply := httptest.NewRecorder()
	Auth{Pool: pool, Origin: d.Origin}.handle(reply, req)
	if reply.Code != 200 {
		copyReply(w, reply)
		return
	}
	handler, err := d.Build(pool)
	if err != nil {
		http.Error(w, "Unable to initialize database", 503)
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO local_database(id,name,physical_name) VALUES($1,$2,$3)`, id, in.Name, physical); err != nil {
		http.Error(w, "Unable to register database", 503)
		return
	}
	// Commit registration before publishing the pool in memory.
	if err = tx.Commit(r.Context()); err != nil {
		http.Error(w, "Unable to register database", 503)
		return
	}
	d.mu.Lock()
	d.ledgers[id] = &ledger{ID: id, Name: in.Name, Physical: physical, pool: pool, handler: handler}
	d.mu.Unlock()
	published = true
	// Creation does not switch or replace the current authentication cookie.
	w.Header().Set("Content-Type", "application/json")
	w.Write(reply.Body.Bytes())
}

func installationAllowed(ctx context.Context, tx pgx.Tx, w http.ResponseWriter) bool {
	var seconds int
	err := tx.QueryRow(ctx, `SELECT GREATEST(0,ceil(EXTRACT(EPOCH FROM retry_at-now())))::int FROM local_installation_attempt WHERE purpose='installation'`).Scan(&seconds)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Unable to verify installation access", 503)
		return false
	}
	if seconds > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		http.Error(w, "Too many attempts. Wait before trying again.", 429)
		return false
	}
	return true
}
