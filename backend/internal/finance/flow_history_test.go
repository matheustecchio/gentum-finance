package finance

import (
	"testing"
	"time"
)

func TestCashFlowCalendarBuckets(t *testing.T) {
	for _, tc := range []struct {
		day, group, start, next string
		weekEnd                 int
	}{
		{"2026-10-21", "week", "2026-10-19", "2026-10-26", 0},
		{"2026-10-21", "week", "2026-10-15", "2026-10-22", 3},
		{"2026-01-01", "week", "2025-12-29", "2026-01-05", 0},
		{"2024-02-29", "month", "2024-02-01", "2024-03-01", 0},
		{"2026-10-21", "quarter", "2026-10-01", "2027-01-01", 0},
		{"2026-08-31", "fourMonths", "2026-05-01", "2026-09-01", 0},
		{"2026-10-21", "halfYear", "2026-07-01", "2027-01-01", 0},
		{"2026-10-21", "year", "2026-01-01", "2027-01-01", 0},
		{"2026-10-21", "fiveYears", "2025-01-01", "2030-01-01", 0},
	} {
		day, _ := date(tc.day)
		start := bucketStart(day, tc.group, tc.weekEnd)
		if start.Format("2006-01-02") != tc.start || nextBucket(start, tc.group).Format("2006-01-02") != tc.next {
			t.Fatalf("%+v: %v", tc, start)
		}
	}
}
func TestCategorySpendingRangeSupportsOldHistory(t *testing.T) {
	if err := validateSpending("1900-01-01", "2026-10-21", "2026-10-21"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range [][2]string{{"2026-02-30", "2026-10-21"}, {"2026-10-22", "2026-10-21"}, {"2026-10-21", "2026-10-22"}, {"1899-12-31", "2026-10-21"}} {
		if err := validateSpending(tc[0], tc[1], "2026-10-21"); err == nil {
			t.Fatal("accepted invalid bounds", tc)
		}
	}
	now := time.Date(2026, 6, 30, 23, 30, 0, 0, time.UTC)
	s := Service{Now: func() time.Time { return now }}
	if s.reportingToday() != "2026-07-01" {
		t.Fatal(s.reportingToday())
	}
}
