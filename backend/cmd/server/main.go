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
	origin := env("GENTUM_FRONTEND_ORIGIN", "http://localhost:5173")
	build := func(pool *pgxpool.Pool) (http.Handler, error) {
		return api.NewHandler(account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: security.SessionUser{}}, origin, finance.Service{Rates: &finance.ECBRates{}, Repository: finance.PostgresRepository{Pool: pool}, CurrentUser: security.SessionUser{}})
	}
	var provision *pgxpool.Pool
	if url := os.Getenv("GENTUM_PROVISION_DATABASE_URL"); url != "" {
		provision, err = pgxpool.New(startup, url)
		if err != nil {
			return errors.New("invalid provisioner configuration")
		}
		defer provision.Close()
	} else if username := os.Getenv("GENTUM_PROVISION_USERNAME"); username != "" {
		pc := config.Copy()
		pc.ConnConfig.User = username
		pc.ConnConfig.Password = os.Getenv("GENTUM_PROVISION_PASSWORD")
		provision, err = pgxpool.NewWithConfig(startup, pc)
		if err != nil {
			return errors.New("invalid provisioner configuration")
		}
		defer provision.Close()
	}
	var superuser, createdb bool
	if err = pool.QueryRow(startup, `SELECT rolsuper,rolcreatedb FROM pg_roles WHERE rolname=current_user`).Scan(&superuser, &createdb); err != nil {
		return err
	}
	if superuser || createdb {
		return errors.New("financial database role must not have SUPERUSER or CREATEDB; run the local role bootstrap")
	}
	registry := &security.Databases{Registry: pool, Provision: provision, Config: config, Origin: origin, Build: build, Migrate: database.Migrate}
	if err = registry.Initialize(startup); err != nil {
		return err
	}
	defer registry.Close()
	server := &http.Server{Addr: net.JoinHostPort(host, env("GENTUM_SERVER_PORT", "8080")), Handler: registry.Middleware(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second}
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
