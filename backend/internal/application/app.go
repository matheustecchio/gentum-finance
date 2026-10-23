// Package application wires the same financial services for desktop and fixture tests.
package application

import (
	"context"
	"errors"
	"net/http"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/api"
	"gentum.finance/backend/internal/database"
	"gentum.finance/backend/internal/finance"
	"gentum.finance/backend/internal/security"
	"github.com/jackc/pgx/v5/pgxpool"
)

type App struct {
	Pool     *pgxpool.Pool
	Registry *security.Databases
}

func Open(ctx context.Context, config *pgxpool.Config, provision *pgxpool.Pool, origin string) (*App, error) {
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, errors.New("invalid financial database configuration")
	}
	app := &App{Pool: pool}
	ok := false
	defer func() {
		if !ok {
			app.Close()
		}
	}()
	if err = pool.Ping(ctx); err != nil {
		return nil, errors.New("financial database unavailable")
	}
	var superuser, createdb bool
	if err = pool.QueryRow(ctx, `SELECT rolsuper,rolcreatedb FROM pg_roles WHERE rolname=current_user`).Scan(&superuser, &createdb); err != nil {
		return nil, err
	}
	if superuser || createdb {
		return nil, errors.New("financial role must not have SUPERUSER or CREATEDB")
	}
	if err = database.Migrate(ctx, pool); err != nil {
		return nil, err
	}
	build := func(p *pgxpool.Pool) (http.Handler, error) {
		return api.NewHandler(
			account.Service{Repository: account.PostgresRepository{Pool: p}, CurrentUser: security.SessionUser{}}, origin,
			finance.Service{Rates: &finance.ECBRates{Store: finance.PostgresRateStore{Pool: p}}, Repository: finance.PostgresRepository{Pool: p}, CurrentUser: security.SessionUser{}},
		)
	}
	app.Registry = &security.Databases{Registry: pool, Provision: provision, Config: config, Origin: origin, Build: build, Migrate: database.Migrate}
	if err = app.Registry.Initialize(ctx); err != nil {
		return nil, err
	}
	ok = true
	return app, nil
}
func (a *App) Close() {
	if a.Registry != nil {
		a.Registry.Close()
	}
	if a.Pool != nil {
		a.Pool.Close()
	}
}
func (a *App) Handler() http.Handler { return a.Registry.Middleware() }
