package security

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
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

type attempt struct {
	count int
	until time.Time
}

var attempts = struct {
	sync.Mutex
	values map[string]attempt
}{values: map[string]attempt{}}
var passwordSlots = make(chan struct{}, 4)

func allowAttempt(remote string) bool {
	host, _, _ := net.SplitHostPort(remote)
	attempts.Lock()
	defer attempts.Unlock()
	now := time.Now()
	for k, v := range attempts.values {
		if now.After(v.until) {
			delete(attempts.values, k)
		}
	}
	v := attempts.values[host]
	if v.until.IsZero() {
		v.until = now.Add(time.Minute)
	}
	if v.count >= 20 || len(attempts.values) > 1024 {
		return false
	}
	v.count++
	attempts.values[host] = v
	return true
}

type Auth struct {
	Pool   *pgxpool.Pool
	Origin string
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
		if r.Method != http.MethodGet {
			if r.Header.Get("Origin") != a.Origin || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				http.Error(w, "Origin and JSON content type required", 403)
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/auth/") {
			a.handle(w, r)
			return
		}
		id, err := a.identity(r)
		if err != nil {
			http.Error(w, "Authentication required", 401)
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
	err = a.Pool.QueryRow(r.Context(), `SELECT user_id::text FROM user_session WHERE token_hash=$1 AND expires_at>now()`, hash(c.Value)).Scan(&id)
	return id, err
}
func (a Auth) handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path == "/auth/me" && r.Method == "GET" {
		id, err := a.identity(r)
		if err != nil {
			http.Error(w, "Authentication required", 401)
			return
		}
		var email string
		a.Pool.QueryRow(r.Context(), `SELECT email FROM gentum_user WHERE id=$1`, id).Scan(&email)
		json.NewEncoder(w).Encode(map[string]string{"email": email})
		return
	}
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	if r.URL.Path == "/auth/logout" {
		if c, err := r.Cookie("gentum_session"); err == nil {
			a.Pool.Exec(r.Context(), `DELETE FROM user_session WHERE token_hash=$1`, hash(c.Value))
		}
		http.SetCookie(w, &http.Cookie{Name: "gentum_session", Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
		w.Write([]byte(`{}`))
		return
	}
	if r.URL.Path != "/auth/register" && r.URL.Path != "/auth/login" {
		http.NotFound(w, r)
		return
	}
	if !allowAttempt(r.RemoteAddr) {
		http.Error(w, "Too many attempts; try again in a minute", 429)
		return
	}
	select {
	case passwordSlots <- struct{}{}:
		defer func() { <-passwordSlots }()
	default:
		http.Error(w, "Authentication busy; try again", 429)
		return
	}
	var input struct{ Email, Password string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		http.Error(w, "Invalid request", 400)
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if len(input.Email) > 320 || !strings.Contains(input.Email, "@") || utf8.RuneCountInString(input.Password) < 12 || len(input.Password) > 256 {
		http.Error(w, "Use an email and a password of 12–256 characters", 400)
		return
	}
	var id, salt, stored string
	if r.URL.Path == "/auth/register" {
		id = ID()
		salt = ID()
		key, _ := pbkdf2.Key(sha256.New, input.Password, []byte(salt), 600000, 32)
		stored = hex.EncodeToString(key)
		_, err := a.Pool.Exec(r.Context(), `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at,password_salt,password_hash) VALUES($1,$2,'Local user','EUR',now(),now(),$3,$4)`, id, input.Email, salt, stored)
		if err != nil {
			http.Error(w, "Unable to register this email", 400)
			return
		}
	} else {
		err := a.Pool.QueryRow(r.Context(), `SELECT id::text,password_salt,password_hash FROM gentum_user WHERE email=$1 AND password_hash IS NOT NULL`, input.Email).Scan(&id, &salt, &stored)
		if err != nil {
			salt = "dummy-salt"
			stored = strings.Repeat("0", 64)
		}
		key, _ := pbkdf2.Key(sha256.New, input.Password, []byte(salt), 600000, 32)
		if subtle.ConstantTimeCompare([]byte(hex.EncodeToString(key)), []byte(stored)) != 1 || id == "" {
			http.Error(w, "Invalid email or password", 401)
			return
		}
	}
	// Independent random token; only its digest is persisted.
	token := ID() + ID()
	_, err := a.Pool.Exec(r.Context(), `INSERT INTO user_session(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours')`, hash(token), id)
	if err != nil {
		http.Error(w, "Unable to create session", 500)
		return
	}
	a.Pool.Exec(r.Context(), `DELETE FROM user_session WHERE expires_at<now()`)
	http.SetCookie(w, &http.Cookie{Name: "gentum_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 86400})
	w.Write([]byte(`{}`))
}
