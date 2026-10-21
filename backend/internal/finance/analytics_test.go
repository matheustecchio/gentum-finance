package finance

import (
	"context"
	"testing"
	"time"
)

func TestAnalyticsDateBounds(t *testing.T) {
	for _, tc := range []struct {
		start, end string
		valid      bool
	}{
		{"2024-02-29", "2024-03-01", true},
		{"2026-10-21", "2026-10-21", true},
		{"2021-01-01", "2026-01-01", true},
		{"2023-02-29", "2023-03-01", false},
		{"2026-10-22", "2026-10-21", false},
		{"1899-12-31", "1900-01-01", false},
		{"2020-01-01", "2026-01-01", false},
		{"", "2026-01-01", false},
	} {
		if err := validateAnalytics(tc.start, tc.end); (err == nil) != tc.valid {
			t.Errorf("%+v: %v", tc, err)
		}
	}
}

type analyticsOwner string

func (u analyticsOwner) UserID(context.Context) (string, error) { return string(u), nil }

type analyticsFake struct {
	Repository
	user, start, end string
}

func (r *analyticsFake) Analytics(_ context.Context, user, start, end string) (Analytics, error) {
	r.user, r.start, r.end = user, start, end
	return Analytics{Flows: []Row{}, Breakdown: []Row{}}, nil
}
func TestAnalyticsUsesAuthenticatedOwnerAndRejectsFuture(t *testing.T) {
	repo := &analyticsFake{}
	s := Service{Repository: repo, CurrentUser: analyticsOwner("owned"), Now: func() time.Time { return time.Date(2026, 6, 30, 23, 30, 0, 0, time.UTC) }}
	if _, err := s.Analytics(context.Background(), "2026-06-30", "2026-07-01"); err != nil {
		t.Fatal(err)
	}
	if repo.user != "owned" || repo.start != "2026-06-30" || repo.end != "2026-07-01" {
		t.Fatal(repo)
	}
	repo.user = ""
	if _, err := s.Analytics(context.Background(), "2026-07-01", "2026-07-02"); err == nil || repo.user != "" {
		t.Fatal("future range reached repository")
	}
}
