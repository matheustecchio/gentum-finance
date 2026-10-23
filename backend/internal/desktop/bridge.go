// Package desktop provides private process transport and a managed local database.
package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const Origin = "http://gentum.internal"
const MaxMessage = 4 * 1024 * 1024

type Request struct {
	ID      uint64            `json:"id"`
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body,omitempty"`
}
type Response struct {
	ID      uint64            `json:"id"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

var routes = map[string]string{
	"/graphql": "POST", "/auth/status": "GET", "/auth/setup": "POST", "/auth/open": "POST",
	"/auth/unlock": "POST", "/auth/lock": "POST", "/auth/pin": "POST", "/auth/disable-pin": "POST", "/auth/recover": "POST",
	"/databases": "GET", "/databases/create": "POST", "/databases/rename": "POST", "/databases/select": "POST", "/healthz": "GET",
}
var selectionShape = regexp.MustCompile(`^[0-9a-f-]{72}$`)

type Bridge struct {
	handler       http.Handler
	jar           *cookiejar.Jar
	origin        *url.URL
	selectionPath string
	selection     string
	mu            sync.Mutex
}

func NewBridge(handler http.Handler, dataDir string) (*Bridge, error) {
	jar, _ := cookiejar.New(nil)
	origin, _ := url.Parse(Origin)
	b := &Bridge{handler: handler, jar: jar, origin: origin, selectionPath: filepath.Join(dataDir, "selection")}
	raw, err := os.ReadFile(b.selectionPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, errors.New("unable to read database selection")
	}
	if len(raw) > 0 {
		if !selectionShape.Match(raw) {
			return nil, errors.New("invalid saved database selection")
		}
		b.selection = string(raw)
		jar.SetCookies(origin, []*http.Cookie{{Name: "gentum_database_session", Value: string(raw), Path: "/"}})
	}
	return b, nil
}
func (b *Bridge) Do(ctx context.Context, in Request) Response {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := Response{ID: in.ID, Headers: map[string]string{}}
	fail := func(status int, message string) Response { out.Status = status; out.Body = message; return out }
	method, exists := routes[in.Path]
	if !exists {
		return fail(404, "Unknown desktop operation")
	}
	if in.Method != method {
		return fail(405, "Method not allowed")
	}
	if len(in.Body) > MaxMessage {
		return fail(413, "Request too large")
	}
	if in.Method == "POST" && !json.Valid([]byte(in.Body)) {
		return fail(400, "A JSON request body is required")
	}
	if in.Method == "GET" && in.Body != "" {
		return fail(400, "Unexpected request body")
	}
	for name := range in.Headers {
		if !strings.EqualFold(name, "Content-Type") && !strings.EqualFold(name, "X-Gentum-Database") {
			return fail(400, "Unsupported desktop header")
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	req := httptest.NewRequestWithContext(ctx, in.Method, Origin+in.Path, strings.NewReader(in.Body))
	req.Header.Set("Origin", Origin)
	if in.Method == "POST" {
		req.Header.Set("Content-Type", "application/json")
	}
	for name, value := range in.Headers {
		if strings.EqualFold(name, "X-Gentum-Database") {
			req.Header.Set("X-Gentum-Database", value)
		}
	}
	for _, cookie := range b.jar.Cookies(b.origin) {
		req.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	b.handler.ServeHTTP(recorder, req)
	result := recorder.Result()
	defer result.Body.Close()
	cookies := result.Cookies()
	b.jar.SetCookies(b.origin, cookies)
	for _, cookie := range cookies {
		if cookie.Name == "gentum_database_session" && cookie.Value != b.selection {
			if !selectionShape.MatchString(cookie.Value) {
				return fail(503, "Invalid database selection")
			}
			if err := privateWrite(b.selectionPath, []byte(cookie.Value)); err != nil {
				return fail(503, "Unable to save database selection")
			}
			b.selection = cookie.Value
		}
	}
	for _, name := range []string{"Content-Type", "Retry-After"} {
		if value := result.Header.Get(name); value != "" {
			out.Headers[name] = value
		}
	}
	body, err := io.ReadAll(io.LimitReader(result.Body, 16*MaxMessage+1))
	if err != nil || len(body) > 16*MaxMessage {
		return fail(503, "Desktop response unavailable")
	}
	out.Status = result.StatusCode
	out.Body = string(body)
	return out
}
func privateWrite(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".gentum-write-*")
	if err != nil {
		return err
	}
	temp := file.Name()
	defer os.Remove(temp)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(temp, path)
}
