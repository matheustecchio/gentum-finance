package finance

import (
	"context"
	"testing"
	"time"
)

func TestWealthBucketsCalendarAndLongRanges(t *testing.T) {
	for _, tc := range []struct{ group, start string }{{"week", "2026-10-19"}, {"month", "2026-10-01"}, {"quarter", "2026-10-01"}, {"halfYear", "2026-07-01"}, {"year", "2026-01-01"}, {"fiveYears", "2025-01-01"}} {
		buckets, earlier := wealthBuckets(FlowFilter{Grouping: tc.group}, "1900-01-01", "2026-10-21")
		if len(buckets) != 8 || !earlier || buckets[7].Start != tc.start || buckets[7].End != "2026-10-21" {
			t.Fatal(tc, buckets, earlier)
		}
		prev, _ := wealthBuckets(FlowFilter{Grouping: tc.group, Before: buckets[0].Start}, "1900-01-01", "2026-10-21")
		if prev[len(prev)-1].End >= buckets[0].Start {
			t.Fatal("overlapping pages", buckets, prev)
		}
	}
	buckets, earlier := wealthBuckets(FlowFilter{Grouping: "all"}, "2016-01-01", "2026-10-21")
	if earlier || len(buckets) != 130 || buckets[0].Start != "2016-01-01" || buckets[129].End != "2026-10-21" {
		t.Fatal(buckets, earlier)
	}
	buckets, _ = wealthBuckets(FlowFilter{Grouping: "custom", Start: "2024-02-28", End: "2024-03-01"}, "2026-10-21", "2026-10-21")
	if len(buckets) != 3 || buckets[1].End != "2024-02-29" {
		t.Fatal(buckets)
	}
	buckets, earlier = wealthBuckets(FlowFilter{Grouping: "week"}, "1900-01-01", "1900-01-01")
	if earlier || len(buckets) != 1 || buckets[0].Start != "1900-01-01" {
		t.Fatal(buckets, earlier)
	}
}
func TestWealthHistoryRejectsInvalidFilters(t *testing.T) {
	s := Service{Now: func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }}
	for _, f := range []FlowFilter{{Grouping: "fourMonths"}, {Grouping: "bad"}, {Grouping: "week", WeekEnd: 7}, {Grouping: "week", Before: "2026-10-22"}, {Grouping: "custom", Start: "2026-02-30", End: "2026-03-01"}, {Grouping: "custom", Start: "2026-10-22", End: "2026-10-21"}} {
		if _, err := s.WealthHistory(context.Background(), f); err == nil {
			t.Fatal("accepted invalid filter", f)
		}
	}
}

type wealthFixture struct {
	Repository
	data   wealthHistoryData
	user   string
	filter FlowFilter
	today  string
}

func (r *wealthFixture) WealthHistory(_ context.Context, user string, f FlowFilter, today string) (wealthHistoryData, error) {
	r.user = user
	r.filter = f
	r.today = today
	return r.data, nil
}
func TestWealthHistoryOwnerExactConversionAndDublinDay(t *testing.T) {
	r := &wealthFixture{data: wealthHistoryData{overviewData: overviewData{Currency: "EUR", Observations: []Row{{"date": "2016-01-31", "EUR": "9007199254740993"}, {"date": "2026-10-18", "EUR": "100"}}}, Buckets: []FlowBucket{{Start: "2016-01-01", End: "2016-01-31"}}, HasEarlier: true}}
	s := Service{Repository: r, CurrentUser: overviewOwner("owned"), Now: func() time.Time { return referenceDay }}
	out, err := s.WealthHistory(context.Background(), FlowFilter{Grouping: "all"})
	if err != nil || r.user != "owned" || out.Wealth[0]["amount"] != "9007199254740993" || !out.HasEarlier {
		t.Fatal(out, err, r)
	}
	r.data.Observations = []Row{{"date": "2026-10-18", "USD": "125", "EUR": "100"}}
	s.Rates = fixtureRates{}
	out, err = s.WealthHistory(context.Background(), FlowFilter{Grouping: "week"})
	if err != nil || out.Wealth[0]["amount"] != "200" || !out.Converted || out.RateDate != "2026-10-16" {
		t.Fatal(out, err)
	}
	s.Rates = nil
	out, err = s.WealthHistory(context.Background(), FlowFilter{Grouping: "week"})
	if err != nil || len(out.Wealth) != 0 || out.RateError == "" {
		t.Fatal(out, err)
	}
	s.Now = func() time.Time { return time.Date(2026, 6, 30, 23, 30, 0, 0, time.UTC) }
	_, _ = s.WealthHistory(context.Background(), FlowFilter{Grouping: "week"})
	if r.today != "2026-07-01" {
		t.Fatal(r.today)
	}
}
