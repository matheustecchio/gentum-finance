package finance

import (
	"testing"
	"time"
)

func TestBudgetCalendarPeriods(t *testing.T) {
	for _, tt := range []struct{ anchor, at, frequency, start, end string }{
		{"2026-01-31", "2026-02-28", "monthly", "2026-02-28", "2026-03-30"},
		{"2026-01-31", "2026-03-31", "monthly", "2026-03-31", "2026-04-29"},
		{"2024-02-29", "2025-02-28", "yearly", "2025-02-28", "2026-02-27"},
		{"2024-02-29", "2028-02-29", "yearly", "2028-02-29", "2029-02-27"},
		{"2026-10-05", "2026-10-01", "weekly", "2026-09-28", "2026-10-04"},
		{"1900-01-01", "9998-12-01", "weekly", "9998-11-30", "9998-12-06"},
	} {
		t.Run(tt.anchor+tt.at+tt.frequency, func(t *testing.T) {
			a, _ := time.Parse("2006-01-02", tt.anchor)
			at, _ := time.Parse("2006-01-02", tt.at)
			start, end := budgetPeriod(a, at, tt.frequency)
			if start.Format("2006-01-02") != tt.start || end.Format("2006-01-02") != tt.end {
				t.Fatalf("got %s %s", start, end)
			}
		})
	}
}
