package finance

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type memoryRateStore struct {
	rates []Rate
	saves int
}

func (s *memoryRateStore) LoadRates(context.Context) ([]Rate, error) {
	return append([]Rate(nil), s.rates...), nil
}
func (s *memoryRateStore) SaveRates(_ context.Context, rates []Rate) error {
	s.saves++
	s.rates = append([]Rate(nil), rates...)
	return nil
}
func TestPersistentRatesFallbackAndRecovery(t *testing.T) {
	ctx := context.Background()
	online := true
	count := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		if !online {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(testRates())
	}))
	defer server.Close()
	store := &memoryRateStore{}
	source := &ECBRates{Store: store, URL: server.URL}
	first, cached, err := source.RatesWithStatus(ctx, referenceDay)
	if err != nil || cached || len(first) != 3 || store.saves != 1 {
		t.Fatal(first, cached, err, store.saves)
	}
	online = false
	if _, cached, err = source.RatesWithStatus(ctx, referenceDay.Add(2*time.Hour)); err != nil || !cached {
		t.Fatal(cached, err)
	}
	// A fresh source has no memory, so only persisted quotes can support fallback.
	restart := &ECBRates{Store: store, URL: server.URL}
	rates, cached, err := restart.RatesWithStatus(ctx, referenceDay.Add(3*time.Hour))
	if err != nil || !cached || len(rates) != 3 {
		t.Fatal(rates, cached, err)
	}
	// Expiration is checked even inside the normal one-hour refresh interval.
	source.fetched = referenceDay.AddDate(0, 0, 8)
	if _, _, err = source.RatesWithStatus(ctx, referenceDay.AddDate(0, 0, 8)); err == nil {
		t.Fatal("accepted expired cached quotes")
	}
	online = true
	if _, cached, err = restart.RatesWithStatus(ctx, referenceDay.Add(4*time.Hour)); err != nil || cached || store.saves != 2 {
		t.Fatal(cached, err, store.saves)
	}
	previous := count
	if _, cached, err = restart.RatesWithStatus(ctx, referenceDay.Add(4*time.Hour+time.Minute)); err != nil || cached || count != previous {
		t.Fatal("fresh cache", cached, err, count)
	}
}
func TestInvalidPersistedRatesStayUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	for _, mode := range []string{"missing", "incomplete", "future", "expired", "zero", "duplicate", "currency"} {
		t.Run(mode, func(t *testing.T) {
			rates := testRates()
			switch mode {
			case "missing":
				rates = nil
			case "incomplete":
				rates = rates[:2]
			case "future":
				for i := range rates {
					rates[i].Date = referenceDay.AddDate(0, 0, 1).Format("2006-01-02")
				}
			case "expired":
				for i := range rates {
					rates[i].Date = referenceDay.AddDate(0, 0, -8).Format("2006-01-02")
				}
			case "zero":
				rates[0].Value = "0"
			case "duplicate":
				rates[1] = rates[0]
			case "currency":
				rates[0].Quote = "XXX"
			}
			source := &ECBRates{Store: &memoryRateStore{rates: rates}, URL: server.URL}
			if _, _, err := source.RatesWithStatus(context.Background(), referenceDay); err == nil {
				t.Fatal("accepted invalid persisted set")
			}
		})
	}
}
func TestOverviewReportsCachedRatesAndUsesSameQuotes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	repo := &overviewFixture{data: overviewData{Currency: "USD", Observations: []Row{{"date": "2026-09-18", "EUR": "10000", "USD": "12500"}, {"date": "2026-10-18", "EUR": "10000", "USD": "10000"}}, Flows: []Row{}}}
	svc := Service{Repository: repo, CurrentUser: overviewOwner("owned"), Rates: &ECBRates{Store: &memoryRateStore{rates: testRates()}, URL: server.URL}, Now: func() time.Time { return referenceDay }}
	result, err := svc.Overview(context.Background(), "2026-10")
	if err != nil || !result.RateCached || result.RateDate != "2026-10-16" || result.Change30 != "-2500" || len(result.Wealth) != 2 {
		t.Fatal(result, err)
	}
	svc.Now = func() time.Time { return referenceDay.AddDate(0, 0, 8) }
	result, err = svc.Overview(context.Background(), "2026-10")
	if err != nil || result.RateError == "" || len(result.Wealth) != 0 {
		t.Fatal(result, err)
	}
}
