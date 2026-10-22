package finance

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

var referenceDay = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

func testRates() []Rate {
	return []Rate{{"2026-10-16", "EUR", "USD", json.Number("1.25")}, {"2026-10-16", "EUR", "GBP", json.Number("0.8")}, {"2026-10-16", "EUR", "BRL", json.Number("5")}}
}
func TestConvertedTotalExactRoundingAndOverflow(t *testing.T) {
	rates, _, err := rateTable(testRates(), referenceDay)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		balances     Row
		target, want string
	}{
		{Row{"EUR": "100", "USD": "125", "GBP": "80", "BRL": "500"}, "EUR", "400"},
		{Row{"EUR": "1"}, "BRL", "5"},
		{Row{"USD": "1"}, "EUR", "1"},
		{Row{"EUR": "1"}, "USD", "1"},
		{Row{"EUR": "2"}, "USD", "3"},
		{Row{"EUR": "-2"}, "USD", "-3"},
		{Row{"EUR": "9007199254740993"}, "EUR", "9007199254740993"},
		{Row{"EUR": "100", "USD": "-125"}, "EUR", "0"},
	} {
		got, e := convertedTotal(tc.balances, tc.target, rates)
		if e != nil || got != tc.want {
			t.Fatalf("%v to %s: %s %v want %s", tc.balances, tc.target, got, e, tc.want)
		}
	}
	for _, b := range []Row{{"EUR": "9223372036854775807", "USD": "125"}, {"XYZ": "100"}, {"EUR": "oops"}} {
		if _, err := convertedTotal(b, "EUR", rates); err == nil {
			t.Fatal("accepted invalid/overflow total", b)
		}
	}
}
func TestRateValidation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func([]Rate) []Rate
	}{
		{"stale", func(r []Rate) []Rate { r[0].Date = "2026-10-01"; return r }},
		{"future", func(r []Rate) []Rate { r[0].Date = "2026-10-19"; return r }},
		{"zero", func(r []Rate) []Rate { r[0].Value = "0"; return r }},
		{"negative", func(r []Rate) []Rate { r[0].Value = "-1"; return r }},
		{"missing", func(r []Rate) []Rate { return r[:2] }},
		{"duplicate", func(r []Rate) []Rate { return append(r, r[0]) }},
		{"different dates", func(r []Rate) []Rate { r[0].Date = "2026-10-15"; return r }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := rateTable(tc.mutate(testRates()), referenceDay); err == nil {
				t.Fatal("accepted invalid rates")
			}
		})
	}
}
func TestECBRequestCacheAndFailure(t *testing.T) {
	count := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		if r.URL.RawQuery != "base=EUR&quotes=GBP,USD,BRL" {
			t.Error("unexpected data sent", r.URL)
		}
		json.NewEncoder(w).Encode(testRates())
	}))
	defer server.Close()
	source := &ECBRates{URL: server.URL + "?base=EUR&quotes=GBP,USD,BRL"}
	for i := 0; i < 2; i++ {
		if _, err := source.Rates(context.Background(), referenceDay); err != nil {
			t.Fatal(err)
		}
	}
	if count != 1 {
		t.Fatal("cache missed", count)
	}
	source.URL = server.URL + "/wrong"
	source.fetched = referenceDay.Add(-2 * time.Hour)
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer bad.Close()
	source.URL = bad.URL
	if _, cached, err := source.RatesWithStatus(context.Background(), referenceDay); err != nil || !cached {
		t.Fatal("valid fallback unavailable", err)
	}
	if _, _, err := source.RatesWithStatus(context.Background(), referenceDay.AddDate(0, 0, 8)); err == nil {
		t.Fatal("accepted expired fallback")
	}
}

type overviewFixture struct {
	Repository
	data overviewData
	user string
}

func (r *overviewFixture) Overview(_ context.Context, user, _ string, _ time.Time) (overviewData, error) {
	r.user = user
	return r.data, nil
}

type overviewOwner string

func (o overviewOwner) UserID(context.Context) (string, error) { return string(o), nil }

type fixtureRates struct{}

func (fixtureRates) Rates(context.Context, time.Time) ([]Rate, error) { return testRates(), nil }
func TestOverviewRevaluesBothDatesAndComputesDeltaOnBackend(t *testing.T) {
	repo := &overviewFixture{data: overviewData{Currency: "USD", Observations: []Row{{"date": "2026-09-18", "EUR": "10000", "USD": "12500"}, {"date": "2026-10-18", "EUR": "10000", "USD": "10000"}}, Flows: []Row{}}}
	s := Service{Repository: repo, CurrentUser: overviewOwner("owned"), Rates: fixtureRates{}, Now: func() time.Time { return referenceDay }}
	o, err := s.Overview(context.Background(), "2026-10")
	if err != nil || repo.user != "owned" || len(o.Wealth) != 2 || o.Wealth[0]["amount"] != "25000" || o.Wealth[1]["amount"] != "22500" || o.Change30 != "-2500" || o.RateDate != "2026-10-16" {
		t.Fatalf("unexpected converted overview %+v %v", o, err)
	}
	repo.data.Currency = "EUR"
	o, err = s.Overview(context.Background(), "2026-10")
	if err != nil || o.Change30 != "-2000" || o.Wealth[0]["amount"] != "20000" {
		t.Fatalf("currency change failed %+v %v", o, err)
	}
	repo.data.Observations = repo.data.Observations[1:]
	o, err = s.Overview(context.Background(), "2026-10")
	if err != nil || o.Change30 != "" {
		t.Fatalf("invented baseline %+v %v", o, err)
	}
	s.Rates = nil
	o, err = s.Overview(context.Background(), "2026-10")
	if err != nil || len(o.Wealth) != 0 || o.RateError == "" {
		t.Fatalf("partial total exposed %+v %v", o, err)
	}
}

func TestOverviewDeltaOverflowKeepsCurrentWealthWithExplanation(t *testing.T) {
	repo := &overviewFixture{data: overviewData{Currency: "EUR", Observations: []Row{{"date": "2026-09-18", "EUR": "-1"}, {"date": "2026-10-18", "EUR": "9223372036854775807"}}}}
	s := Service{Repository: repo, CurrentUser: overviewOwner("owned"), Now: func() time.Time { return referenceDay }}
	out, err := s.Overview(context.Background(), "2026-10")
	if err != nil || out.Change30 != "" || out.ChangeError == "" || len(out.Wealth) != 2 || out.Wealth[1]["amount"] != "9223372036854775807" || out.RateError != "" {
		t.Fatalf("silent difference overflow: %+v %v", out, err)
	}
}
