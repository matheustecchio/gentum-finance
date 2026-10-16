package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/api"
	"gentum.finance/backend/internal/database"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
	"github.com/jackc/pgx/v5/pgxpool"
)

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	host := env("GENTUM_SERVER_ADDRESS", "127.0.0.1")
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	config, err := pgxpool.ParseConfig(env("GENTUM_DATABASE_URL", "postgres://gentum:gentum_dev_only@localhost:5432/gentum_finance?sslmode=disable"))
	if err != nil {
		return errors.New("invalid database configuration")
	}
	if dbHost := os.Getenv("GENTUM_DATABASE_HOST"); dbHost != "" {
		config.ConnConfig.Host = dbHost
		config.ConnConfig.Database = env("GENTUM_DATABASE_NAME", "gentum_finance")
		config.ConnConfig.User = env("GENTUM_DATABASE_USERNAME", "gentum")
		config.ConnConfig.Password = env("GENTUM_DATABASE_PASSWORD", "gentum_dev_only")
	}
	pool, err := pgxpool.NewWithConfig(startup, config)
	if err != nil {
		return errors.New("invalid database configuration")
	}
	defer pool.Close()
	if err = pool.Ping(startup); err != nil {
		return errors.New("database unavailable; check local PostgreSQL configuration")
	}
	if err = database.Migrate(startup, pool); err != nil {
		return err
	}
	handler, err := api.NewHandler(account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: security.SessionUser{}}, env("GENTUM_FRONTEND_ORIGIN", "http://localhost:5173"), finance.Service{Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: security.SessionUser{}})
	if err != nil {
		return err
	}
	server := &http.Server{Addr: net.JoinHostPort(host, env("GENTUM_SERVER_PORT", "8080")), Handler: security.Auth{Pool: pool, Origin: env("GENTUM_FRONTEND_ORIGIN", "http://localhost:5173")}.Middleware(handler), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	done := make(chan error, 1)
	go func() { slog.Info("Gentum Finance listening", "address", server.Addr); done <- server.ListenAndServe() }()
	select {
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
func main() {
	if err := run(); err != nil {
		slog.Error("startup failed", "error", err)
		os.Exit(1)
	}
}
