package finance

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RateStore persists only public reference quotes in the local ledger database.
type RateStore interface {
	LoadRates(context.Context) ([]Rate, error)
	SaveRates(context.Context, []Rate) error
}
type PostgresRateStore struct{ Pool *pgxpool.Pool }

func (s PostgresRateStore) LoadRates(ctx context.Context) ([]Rate, error) {
	var raw []byte
	err := s.Pool.QueryRow(ctx, `SELECT rates FROM reference_rate_cache WHERE singleton=true`).Scan(&raw)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var rates []Rate
	err = json.Unmarshal(raw, &rates)
	return rates, err
}
func (s PostgresRateStore) SaveRates(ctx context.Context, rates []Rate) error {
	raw, err := json.Marshal(rates)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO reference_rate_cache(singleton,rates) VALUES(true,$1::jsonb) ON CONFLICT(singleton) DO UPDATE SET rates=excluded.rates`, raw)
	return err
}
