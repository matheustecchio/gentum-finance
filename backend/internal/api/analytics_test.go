package api

import (
	"context"
	"testing"
	"time"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
)

type analyticsRepository struct {
	finance.Repository
	user, start, end string
}

func (r *analyticsRepository) Analytics(_ context.Context, user, start, end string) (finance.Analytics, error) {
	r.user, r.start, r.end = user, start, end
	return finance.Analytics{Flows: []finance.Row{{"month": start, "currency": "EUR", "income": "9007199254740993", "expense": "0", "net": "9007199254740993"}}, Breakdown: []finance.Row{}}, nil
}
func TestAnalyticsGraphQLContract(t *testing.T) {
	repo := &analyticsRepository{}
	s := finance.Service{Repository: repo, CurrentUser: identity("owner"), Now: func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }}
	handler, err := NewHandler(account.Service{Repository: &memoryRepository{}, CurrentUser: identity("owner")}, "http://localhost:5173", s)
	if err != nil {
		t.Fatal(err)
	}
	query := `query Analytics($start:String!,$end:String!){analytics(start:$start,end:$end)}`
	result := execute(t, handler, query, map[string]interface{}{"start": "2026-10-01", "end": "2026-10-21"})
	if result["errors"] != nil || repo.user != "owner" || repo.start != "2026-10-01" || repo.end != "2026-10-21" {
		t.Fatal(result, repo)
	}
	data := result["data"].(map[string]interface{})["analytics"].(map[string]interface{})
	if data["flows"].([]interface{})[0].(map[string]interface{})["income"] != "9007199254740993" {
		t.Fatal(data)
	}
	for _, bounds := range [][2]string{{"2026-10-22", "2026-10-23"}, {"2026-10-21", "2026-10-20"}, {"2026-02-30", "2026-10-21"}} {
		repo.user = ""
		result = execute(t, handler, query, map[string]interface{}{"start": bounds[0], "end": bounds[1]})
		if result["errors"] == nil || repo.user != "" {
			t.Fatal("invalid range accepted", result)
		}
	}
}
