package security

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type userKey struct{}
type SessionUser struct{}

func (SessionUser) UserID(ctx context.Context) (string, error) {
	id, _ := ctx.Value(userKey{}).(string)
	if id == "" {
		return "", errors.New("Authentication required")
	}
	return id, nil
}
func ID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	s := hex.EncodeToString(b)
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}
func hash(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func pinValid(pin string) bool {
	if len(pin) != 4 {
		return false
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
func passwordHash(secret, salt string) string {
	key, err := pbkdf2.Key(sha256.New, secret, []byte(salt), 600000, 32)
	if err != nil {
		panic(err)
	}
	return hex.EncodeToString(key)
}
func matches(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
func recoveryCode() string {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	raw := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
	groups := make([]string, 0, 8)
	for i := 0; i < len(raw); i += 4 {
		groups = append(groups, raw[i:i+4])
	}
	return strings.Join(groups, "-")
}
func normalizeRecovery(code string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
}

var passwordSlots = make(chan struct{}, 4)

type Auth struct {
	Pool   *pgxpool.Pool
	Origin string
}
type access struct{ UserID, Salt, PINHash, RecoveryHash string }
type accessInput struct {
	Mode         string `json:"mode"`
	Source       string `json:"source"`
	PIN          string `json:"pin"`
	CurrentPIN   string `json:"currentPin"`
	RecoveryCode string `json:"recoveryCode"`
	Email        string `json:"email"`
	Password     string `json:"password"`
}

func (a Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/healthz" {
			ctx, cancel := context.WithTimeout(r.Context(), time.Second)
			defer cancel()
			if a.Pool.Ping(ctx) != nil {
				http.Error(w, "unavailable", 503)
				return
			}
			w.Write([]byte("ok"))
			return
		}
		if r.Method != http.MethodGet && (r.Header.Get("Origin") != a.Origin || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json")) {
			http.Error(w, "Origin and JSON content type required", 403)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/auth/") {
			a.handle(w, r)
			return
		}
		id, err := a.identity(r)
		if err != nil {
			http.Error(w, "Unlock your local wallet", 401)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, id)))
	})
}
func (a Auth) identity(r *http.Request) (string, error) {
	c, err := r.Cookie("gentum_session")
	if err != nil {
		return "", err
	}
	var id string
	err = a.Pool.QueryRow(r.Context(), `SELECT s.user_id::text FROM user_session s JOIN local_access l ON l.user_id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, hash(c.Value)).Scan(&id)
	return id, err
}
func readAccess(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (access, error) {
	var p access
	err := q.QueryRow(ctx, `SELECT user_id::text,pin_salt,pin_hash,recovery_hash FROM local_access WHERE singleton`).Scan(&p.UserID, &p.Salt, &p.PINHash, &p.RecoveryHash)
	return p, err
}
func respond(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}
func (a Auth) status(w http.ResponseWriter, r *http.Request) {
	p, err := readAccess(r.Context(), a.Pool)
	if errors.Is(err, pgx.ErrNoRows) {
		var legacy bool
		if a.Pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM gentum_user WHERE password_hash IS NOT NULL)`).Scan(&legacy) != nil {
			http.Error(w, "Unable to read local access", 503)
			return
		}
		respond(w, map[string]any{"setupRequired": true, "existingProfilesAvailable": legacy, "pinEnabled": false, "unlocked": false})
		return
	}
	if err != nil {
		http.Error(w, "Unable to read local access", 503)
		return
	}
	_, err = a.identity(r)
	respond(w, map[string]any{"setupRequired": false, "existingProfilesAvailable": false, "pinEnabled": p.PINHash != "", "unlocked": err == nil})
}
func decodeInput(w http.ResponseWriter, r *http.Request) (accessInput, bool) {
	var in accessInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil {
		http.Error(w, "Invalid request", 400)
		return in, false
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		http.Error(w, "Invalid request", 400)
		return in, false
	}
	return in, true
}
func retryDelay(failures int) time.Duration {
	if failures < 5 {
		return 0
	}
	exponent := failures - 5
	if exponent > 4 {
		exponent = 4
	}
	return time.Duration(1<<exponent) * time.Minute
}

// Called inside the serialized access transaction, so concurrent clients share a limit.
func attemptAllowed(ctx context.Context, tx pgx.Tx, purpose string, w http.ResponseWriter) bool {
	var seconds int
	err := tx.QueryRow(ctx, `SELECT GREATEST(0,ceil(EXTRACT(EPOCH FROM retry_at-now())))::int FROM local_access_attempt WHERE purpose=$1`, purpose).Scan(&seconds)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Unable to verify access", 503)
		return false
	}
	if seconds > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		http.Error(w, "Too many attempts. Wait before trying again.", 429)
		return false
	}
	return true
}
func rejectAttempt(ctx context.Context, tx pgx.Tx, purpose string, w http.ResponseWriter) {
	var failures int
	err := tx.QueryRow(ctx, `INSERT INTO local_access_attempt(purpose,failures) VALUES($1,1) ON CONFLICT(purpose) DO UPDATE SET failures=LEAST(local_access_attempt.failures+1,100) RETURNING failures`, purpose).Scan(&failures)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE local_access_attempt SET retry_at=now()+$2*interval '1 second' WHERE purpose=$1`, purpose, int(retryDelay(failures).Seconds()))
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		http.Error(w, "Unable to verify access", 503)
		return
	}
	http.Error(w, "Invalid PIN or recovery credentials", 401)
}
func clearAttempts(ctx context.Context, tx pgx.Tx, purpose string) error {
	_, err := tx.Exec(ctx, `DELETE FROM local_access_attempt WHERE purpose=$1`, purpose)
	return err
}
func (a Auth) handle(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/auth/status" && r.Method == http.MethodGet {
		a.status(w, r)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/auth/")
	switch path {
	case "setup", "open", "unlock", "lock", "pin", "disable-pin", "recover":
	default:
		http.NotFound(w, r)
		return
	}
	in, ok := decodeInput(w, r)
	if !ok {
		return
	}
	select {
	case passwordSlots <- struct{}{}:
		defer func() { <-passwordSlots }()
	default:
		http.Error(w, "Local access busy. Try again.", 429)
		return
	}
	ctx := r.Context()
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		http.Error(w, "Local database unavailable", 503)
		return
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73195022)`); err != nil {
		http.Error(w, "Local database unavailable", 503)
		return
	}
	p, err := readAccess(ctx, tx)
	if path == "setup" {
		if err == nil {
			http.Error(w, "Local wallet already configured", 409)
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Unable to configure local access", 503)
			return
		}
		a.setup(w, r, tx, in)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Set up your local wallet first", 409)
		return
	}
	if err != nil {
		http.Error(w, "Local database unavailable", 503)
		return
	}
	// Read the session under the same lock as revocations and PIN changes.
	sessionID := ""
	if c, e := r.Cookie("gentum_session"); e == nil {
		tx.QueryRow(ctx, `SELECT user_id::text FROM user_session WHERE token_hash=$1 AND expires_at>now()`, hash(c.Value)).Scan(&sessionID)
	}
	authorized := sessionID == p.UserID
	if path == "lock" || path == "pin" || path == "disable-pin" {
		if !authorized {
			http.Error(w, "Unlock your local wallet", 401)
			return
		}
	}
	result := map[string]string{}
	revoke := false
	switch path {
	case "open":
		if p.PINHash != "" {
			http.Error(w, "PIN required", 401)
			return
		}
	case "unlock":
		if p.PINHash == "" {
			http.Error(w, "PIN is not enabled", 400)
			return
		}
		if !attemptAllowed(ctx, tx, "pin", w) {
			return
		}
		if !pinValid(in.PIN) || !matches(passwordHash(in.PIN, p.Salt), p.PINHash) {
			rejectAttempt(ctx, tx, "pin", w)
			return
		}
		err = clearAttempts(ctx, tx, "pin")
	case "lock":
		if p.PINHash == "" {
			http.Error(w, "Enable a PIN before locking", 400)
			return
		}
		_, err = tx.Exec(ctx, `DELETE FROM user_session`)
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			http.Error(w, "Unable to lock wallet", 503)
			return
		}
		http.SetCookie(w, sessionCookie("", -1))
		respond(w, result)
		return
	case "pin", "disable-pin":
		if p.PINHash != "" {
			if !attemptAllowed(ctx, tx, "pin", w) {
				return
			}
			if !pinValid(in.CurrentPIN) || !matches(passwordHash(in.CurrentPIN, p.Salt), p.PINHash) {
				rejectAttempt(ctx, tx, "pin", w)
				return
			}
			err = clearAttempts(ctx, tx, "pin")
			if err != nil {
				break
			}
		}
		if path == "disable-pin" {
			_, err = tx.Exec(ctx, `UPDATE local_access SET pin_salt='',pin_hash='',recovery_hash=''`)
		} else {
			result, err = savePIN(ctx, tx, in.PIN)
		}
		revoke = true
	case "recover":
		if p.PINHash == "" {
			http.Error(w, "PIN is not enabled", 400)
			return
		}
		if !attemptAllowed(ctx, tx, "recovery", w) {
			return
		}
		if !matches(hash(normalizeRecovery(in.RecoveryCode)), p.RecoveryHash) {
			rejectAttempt(ctx, tx, "recovery", w)
			return
		}
		if !pinValid(in.PIN) {
			http.Error(w, "Use exactly four digits for your PIN", 400)
			return
		}
		result, err = savePIN(ctx, tx, in.PIN)
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM local_access_attempt`)
		}
		revoke = true
	}
	if err != nil {
		if errors.Is(err, errPIN) {
			http.Error(w, err.Error(), 400)
		} else {
			http.Error(w, "Unable to update local access", 503)
		}
		return
	}
	a.finish(w, r, tx, p.UserID, result, revoke)
}

var errPIN = errors.New("Use exactly four digits for your PIN")

func savePIN(ctx context.Context, tx pgx.Tx, pin string) (map[string]string, error) {
	if !pinValid(pin) {
		return nil, errPIN
	}
	salt, code := ID(), recoveryCode()
	_, err := tx.Exec(ctx, `UPDATE local_access SET pin_salt=$1,pin_hash=$2,recovery_hash=$3`, salt, passwordHash(pin, salt), hash(normalizeRecovery(code)))
	return map[string]string{"recoveryCode": code}, err
}
func (a Auth) setup(w http.ResponseWriter, r *http.Request, tx pgx.Tx, in accessInput) {
	if in.Mode != "open" && in.Mode != "pin" {
		http.Error(w, "Choose open access or PIN protection", 400)
		return
	}
	if in.Mode == "pin" && !pinValid(in.PIN) {
		http.Error(w, errPIN.Error(), 400)
		return
	}
	ctx := r.Context()
	if in.Source != "new" && in.Source != "existing" {
		http.Error(w, "Choose a new wallet or an existing profile", 400)
		return
	}
	id := ID()
	if in.Source == "existing" {
		if !attemptAllowed(ctx, tx, "legacy", w) {
			return
		}
		var salt, stored string
		err := tx.QueryRow(ctx, `SELECT id::text,password_salt,password_hash FROM gentum_user WHERE email=$1 AND password_hash IS NOT NULL`, strings.ToLower(strings.TrimSpace(in.Email))).Scan(&id, &salt, &stored)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Unable to read existing profiles", 503)
			return
		}
		if err != nil {
			salt = "dummy-salt"
			stored = strings.Repeat("0", 64)
		}
		if !matches(passwordHash(in.Password, salt), stored) || err != nil {
			rejectAttempt(ctx, tx, "legacy", w)
			return
		}
	} else {
		// A new wallet owns a new identity; never claim or merge another profile.
		_, err := tx.Exec(ctx, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at) VALUES($1,$2,'Local wallet','EUR',now(),now())`, id, id+"@local.invalid")
		if err != nil {
			http.Error(w, "Unable to create local wallet", 503)
			return
		}
	}
	_, err := tx.Exec(ctx, `INSERT INTO local_access(singleton,user_id) VALUES(TRUE,$1)`, id)
	result := map[string]string{}
	if err == nil && in.Mode == "pin" {
		result, err = savePIN(ctx, tx, in.PIN)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `DELETE FROM local_access_attempt`)
	}
	if err != nil {
		http.Error(w, "Unable to configure local access", 503)
		return
	}
	a.finish(w, r, tx, id, result, true)
}
func sessionCookie(token string, maxAge int) *http.Cookie {
	return &http.Cookie{Name: "gentum_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: maxAge}
}
func (a Auth) finish(w http.ResponseWriter, r *http.Request, tx pgx.Tx, id string, result any, revoke bool) {
	ctx := r.Context()
	var err error
	if revoke {
		_, err = tx.Exec(ctx, `DELETE FROM user_session`)
	}
	token := ID() + ID()
	if err == nil {
		_, err = tx.Exec(ctx, `DELETE FROM user_session WHERE expires_at<now()`)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO user_session(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours')`, hash(token), id)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		http.Error(w, "Unable to open local wallet", 503)
		return
	}
	// Browser-session cookie: no persistent login; server-side expiry is 24 hours.
	http.SetCookie(w, sessionCookie(token, 0))
	respond(w, result)
}
