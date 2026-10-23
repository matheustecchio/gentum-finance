package desktop

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBridgeKeepsSessionsPrivateAndPersistsOnlySelection(t *testing.T) {
	var seenCookies []string
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && (r.Header.Get("Origin") != Origin || r.Header.Get("Content-Type") != "application/json") {
			t.Error("missing trusted request context")
		}
		seenCookies = append(seenCookies, r.Header.Get("Cookie"))
		http.SetCookie(w, &http.Cookie{Name: "gentum_session", Value: "private-auth-session", Path: "/"})
		http.SetCookie(w, &http.Cookie{Name: "gentum_database_session", Value: strings.Repeat("a", 72), Path: "/"})
		w.Header().Set("Retry-After", "5")
		w.Write([]byte(`{"ok":true}`))
	})
	dir := t.TempDir()
	b, err := NewBridge(handler, dir)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		reply := b.Do(context.Background(), Request{ID: uint64(i + 1), Method: "POST", Path: "/auth/open", Body: "{}"})
		if reply.Status != 200 || reply.Headers["Retry-After"] != "5" {
			t.Fatalf("unexpected response: %v", reply)
		}
		for name := range reply.Headers {
			if strings.EqualFold(name, "Set-Cookie") {
				t.Fatal("session leaked to renderer")
			}
		}
	}
	if !strings.Contains(seenCookies[1], "private-auth-session") {
		t.Fatal("session was not retained privately")
	}
	saved, err := os.ReadFile(filepath.Join(dir, "selection"))
	if err != nil || string(saved) != strings.Repeat("a", 72) {
		t.Fatal("selection did not persist")
	}
	restarted, err := NewBridge(handler, dir)
	if err != nil {
		t.Fatal(err)
	}
	restarted.Do(context.Background(), Request{Method: "GET", Path: "/auth/status"})
	if strings.Contains(seenCookies[2], "private-auth-session") || !strings.Contains(seenCookies[2], "gentum_database_session") {
		t.Fatal("restart must retain selection but require a new authentication session")
	}
}
func TestBridgeRejectsUntrustedOperationsBeforeDispatch(t *testing.T) {
	calls := 0
	b, err := NewBridge(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls++ }), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, in := range []Request{
		{Method: "POST", Path: "http://attacker.test/graphql", Body: "{}"},
		{Method: "POST", Path: "/graphql?query=x", Body: "{}"},
		{Method: "GET", Path: "/graphql"},
		{Method: "POST", Path: "/auth/open", Body: "not-json"},
		{Method: "POST", Path: "/auth/open", Body: "{}", Headers: map[string]string{"Cookie": "forged"}},
		{Method: "POST", Path: "/auth/open", Body: "{}", Headers: map[string]string{"Origin": "forged"}},
		{Method: "GET", Path: "/auth/status", Body: "{}"},
	} {
		if reply := b.Do(context.Background(), in); reply.Status < 400 {
			t.Fatalf("accepted untrusted operation: %v", in)
		}
	}
	if calls != 0 {
		t.Fatal("untrusted operation reached application handler")
	}
}
