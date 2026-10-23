// Test-server serves disposable browser acceptance fixtures, never the installed app.
package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"gentum.finance/backend/internal/application"
	"gentum.finance/backend/internal/desktop"
)

func run() error {
	if os.Getenv("GENTUM_VERIFICATION_FIXTURE") != "1" {
		return errors.New("test-server requires GENTUM_VERIFICATION_FIXTURE=1; use the desktop application")
	}
	data := os.Getenv("GENTUM_TEST_DATA_DIR")
	binaries := os.Getenv("GENTUM_DESKTOP_POSTGRES_DIR")
	assets := os.Getenv("GENTUM_TEST_FRONTEND_DIR")
	if data == "" || binaries == "" || assets == "" {
		return errors.New("fixture requires explicit data, bundled PostgreSQL and test frontend paths")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	startup, stop := context.WithTimeout(ctx, 60*time.Second)
	defer stop()
	postgres, err := desktop.StartPostgres(startup, data, binaries)
	if err != nil {
		return err
	}
	defer postgres.Close()
	port := os.Getenv("GENTUM_TEST_PORT")
	if port == "" {
		port = "5213"
	}
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", port))
	if err != nil {
		return err
	}
	defer listener.Close()
	origin := "http://" + listener.Addr().String()
	app, err := application.Open(startup, postgres.Config, postgres.Provision, origin)
	if err != nil {
		return err
	}
	defer app.Close()
	if os.Getenv("GENTUM_TEST_LEGACY_PROFILE") == "1" {
		_, err = app.Pool.Exec(startup, `INSERT INTO gentum_user(id,email,display_name,base_currency,created_at,updated_at,password_salt,password_hash) VALUES('00000000-0000-0000-0000-000000009999','legacy-fixture@example.test','Legacy fixture','EUR',now(),now(),'fixture-salt','fixture-hash') ON CONFLICT DO NOTHING`)
		if err != nil {
			return err
		}
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/graphql" || strings.HasPrefix(r.URL.Path, "/auth/") || strings.HasPrefix(r.URL.Path, "/databases") || r.URL.Path == "/healthz" {
			app.Handler().ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'")
		clean := filepath.Clean("/" + r.URL.Path)
		if _, err := os.Stat(filepath.Join(assets, clean)); err != nil {
			http.ServeFile(w, r, filepath.Join(assets, "index.html"))
			return
		}
		http.FileServer(http.Dir(assets)).ServeHTTP(w, r)
	})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	fmt.Println("Fixture ready:", origin)
	select {
	case err = <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		return server.Shutdown(shutdown)
	}
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
