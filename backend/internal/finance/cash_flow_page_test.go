package finance

import (
	"context"
	"testing"
	"time"
)

func TestCashFlowCalendarCompletePeriods(t *testing.T) {
	for _, tc := range []struct {
		period, anchor, start, end, grouping string
		count, weekStart                     int
	}{
		{"week", "2026-10-21", "2026-10-19", "2026-10-25", "day", 7, 1},
		{"week", "2026-10-21", "2026-10-18", "2026-10-24", "day", 7, 0},
		{"month", "2024-02-11", "2024-02-01", "2024-02-29", "month", 1, 1},
		{"quarter", "2026-10-21", "2026-10-01", "2026-12-31", "month", 3, 1},
		{"halfYear", "2026-10-21", "2026-07-01", "2026-12-31", "month", 6, 1},
		{"year", "2026-10-21", "2026-01-01", "2026-12-31", "month", 12, 1},
		{"fiveYears", "2026-10-21", "2025-01-01", "2029-12-31", "year", 5, 1},
	} {
		out := cashFlowCalendar(CashFlowFilter{Period: tc.period, Anchor: tc.anchor, WeekStart: tc.weekStart}, "2016-01-01", "2026-10-21")
		if out.Start != tc.start || out.End != tc.end || out.Grouping != tc.grouping || len(out.Buckets) != tc.count {
			t.Fatal(tc, out)
		}
		if tc.period == "year" {
			old := cashFlowCalendar(CashFlowFilter{Period: "year", Anchor: out.Previous, WeekStart: 1}, "2016-01-01", "2026-10-21")
			if old.Start != "2025-01-01" || old.End != "2025-12-31" || old.Next != "2026-01-01" {
				t.Fatal(old)
			}
		}
	}
	current := cashFlowCalendar(CashFlowFilter{Period: "week", Anchor: "2026-10-21", WeekStart: 1}, "2016-01-01", "2026-10-21")
	if current.Next != "" {
		t.Fatal("future page allowed", current)
	}
	first := cashFlowCalendar(CashFlowFilter{Period: "week", Anchor: "1900-01-01", WeekStart: 0}, "1900-01-01", "2026-10-21")
	if first.Start != "1900-01-01" || first.Previous != "" {
		t.Fatal(first)
	}
	custom := cashFlowCalendar(CashFlowFilter{Period: "custom", Anchor: "2026-10-21", Start: "2016-01-02", End: "2026-10-21"}, "2026-10-21", "2026-10-21")
	if len(custom.Buckets) != 11 || custom.Buckets[0].Start != "2016-01-02" || custom.Buckets[10].End != "2026-10-21" || custom.Previous != "" {
		t.Fatal(custom)
	}
}

type cashPageFixture struct {
	Repository
	user   string
	filter CashFlowFilter
	result CashFlowPage
}

func (r *cashPageFixture) CashFlowPage(_ context.Context, user string, f CashFlowFilter, today string) (CashFlowPage, error) {
	r.user = user
	r.filter = f
	return r.result, nil
}
func TestCashFlowPageExactTotalsRankingPercentagesAndValidation(t *testing.T) {
	r := &cashPageFixture{result: CashFlowPage{Breakdown: []Row{
		{"categoryId": "large", "name": "Salary", "currency": "EUR", "kind": "INCOME", "amount": "9007199254740993", "count": "2"},
		{"categoryId": "small", "name": "Other", "currency": "EUR", "kind": "INCOME", "amount": "1", "count": "1"},
		{"categoryId": "expense", "name": "Food", "currency": "EUR", "kind": "EXPENSE", "amount": "123", "count": "3"},
		{"categoryId": "foreign", "name": "Other currency", "currency": "GBP", "kind": "INCOME", "amount": "100", "count": "1"},
	}}}
	s := Service{Repository: r, CurrentUser: overviewOwner("owned"), Now: func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }}
	out, err := s.CashFlowPage(context.Background(), CashFlowFilter{Period: "year", WeekStart: 1})
	if err != nil || r.user != "owned" || r.filter.Anchor != "2026-10-21" || len(out.Totals) != 2 || out.Totals[0]["income"] != "9007199254740994" || out.Totals[0]["net"] != "9007199254740871" || out.Incoming[1]["percentage"] != "<1%" || out.Outgoing[0]["percentage"] != "100%" {
		t.Fatal(out, err)
	}
	for _, f := range []CashFlowFilter{{Period: "bad"}, {Period: "week", WeekStart: 2}, {Period: "year", Anchor: "2026-10-22"}, {Period: "custom", Start: "2026-02-30", End: "2026-03-01"}, {Period: "custom", Start: "2026-10-22", End: "2026-10-21"}} {
		r.user = ""
		if _, err = s.CashFlowPage(context.Background(), f); err == nil || r.user != "" {
			t.Fatal("accepted invalid filter", f, err)
		}
	}
	r.result.Breakdown[0]["amount"] = "9223372036854775807"
	if _, err = s.CashFlowPage(context.Background(), CashFlowFilter{Period: "year"}); err == nil {
		t.Fatal("accepted total overflow")
	}
}

func TestCalendarComparisonsPreserveCurrentValuesOnHistoricalOverflow(t *testing.T) {
	out := CashFlowPage{Previous: "2025-12-31", Start: "2026-01-01", End: "2026-12-31", SelectedStart: "2026-10-01", SelectedEnd: "2026-10-31", Buckets: make([]FlowBucket, 12), Breakdown: []Row{{"currency": "EUR", "kind": "INCOME", "amount": "123", "name": "Salary"}}, ComparisonTotals: []Row{{"currency": "EUR", "income": "9223372036854775808", "expense": "0"}}}
	if err := completeCashFlowPage(&out); err != nil || !out.ComparisonUnavailable || out.Totals[0]["income"] != "123" || out.Totals[0]["incomeAverage"] != "123" || out.Totals[0]["incomeChange"] != "" {
		t.Fatal(out, err)
	}
}
