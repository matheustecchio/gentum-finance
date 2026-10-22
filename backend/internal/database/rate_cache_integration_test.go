//go:build integration

package database

import (
	"context"
	"encoding/json"
	"gentum.finance/backend/internal/finance"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPersistedReferenceRatesSurviveSourceRestart(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	today := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	quotes := []finance.Rate{{Date: "2026-10-22", Base: "EUR", Quote: "GBP", Value: "0.85"}, {Date: "2026-10-22", Base: "EUR", Quote: "USD", Value: "1.10"}, {Date: "2026-10-22", Base: "EUR", Quote: "BRL", Value: "6.20"}}
	online := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if !online {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(quotes)
	}))
	defer server.Close()
	store := finance.PostgresRateStore{Pool: pool}
	source := &finance.ECBRates{Store: store, URL: server.URL}
	if _, fallback, err := source.RatesWithStatus(ctx, today); err != nil || fallback {
		t.Fatal(fallback, err)
	}
	online = false
	restarted := &finance.ECBRates{Store: store, URL: server.URL}
	got, fallback, err := restarted.RatesWithStatus(ctx, today.Add(2*time.Hour))
	if err != nil || !fallback || len(got) != 3 || got[2].Value != "6.20" {
		t.Fatal(got, fallback, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE reference_rate_cache SET rates='[{"date":"2026-10-22"}]'::jsonb`); err != nil {
		t.Fatal(err)
	}
	invalid := &finance.ECBRates{Store: store, URL: server.URL}
	if _, _, err = invalid.RatesWithStatus(ctx, today); err == nil {
		t.Fatal("accepted invalid persisted JSON")
	}
	if _, err = pool.Exec(ctx, `UPDATE reference_rate_cache SET rates='{}'::jsonb`); err != nil {
		t.Fatal(err)
	}
	malformed := &finance.ECBRates{Store: store, URL: server.URL}
	if _, _, err = malformed.RatesWithStatus(ctx, today); err == nil {
		t.Fatal("accepted wrong JSON shape")
	}
	online = true
	if _, fallback, err = malformed.RatesWithStatus(ctx, today); err != nil || fallback {
		t.Fatal(fallback, err)
	}
}
