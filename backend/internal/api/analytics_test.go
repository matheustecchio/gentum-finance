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

func (r *analyticsRepository) FlowHistory(_ context.Context, user string, f finance.FlowFilter, today string) (finance.FlowHistory, error) {
	r.user = user
	r.start = f.Grouping
	r.end = today
	return finance.FlowHistory{Buckets: []finance.FlowBucket{{Start: "2026-10-19", End: today}}, Flows: []finance.Row{{"month": "2026-10-19", "currency": "EUR", "income": "9007199254740993", "expense": "0", "net": "9007199254740993"}}}, nil
}
func (r *analyticsRepository) Spending(_ context.Context, user, start, end string) ([]finance.Row, error) {
	r.user = user
	r.start = start
	r.end = end
	return []finance.Row{{"categoryId": "owned", "currency": "EUR", "direct": "9007199254740993"}}, nil
}
func TestGroupedHistoryAndSpendingGraphQLContract(t *testing.T) {
	repo := &analyticsRepository{}
	s := finance.Service{Repository: repo, CurrentUser: identity("owner"), Now: func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }}
	h, err := NewHandler(account.Service{Repository: &memoryRepository{}, CurrentUser: identity("owner")}, "http://localhost:5173", s)
	if err != nil {
		t.Fatal(err)
	}
	result := execute(t, h, `{flowHistory(grouping:"week",weekEnd:0)}`, nil)
	if result["errors"] != nil || repo.user != "owner" || repo.start != "week" {
		t.Fatal(result, repo)
	}
	history := result["data"].(map[string]interface{})["flowHistory"].(map[string]interface{})
	if history["buckets"].([]interface{})[0].(map[string]interface{})["end"] != "2026-10-21" {
		t.Fatal(result)
	}
	result = execute(t, h, `{categorySpending(start:"2010-01-01",end:"2026-10-21")}`, nil)
	if result["errors"] != nil || repo.start != "2010-01-01" {
		t.Fatal(result, repo)
	}
	for _, query := range []string{`{wealthHistory(grouping:"bad")}`, `{wealthHistory(grouping:"week",weekEnd:7)}`, `{wealthHistory(grouping:"week",before:"2026-10-22")}`, `{wealthHistory(grouping:"custom",start:"2026-10-22",end:"2026-10-21")}`, `{flowHistory(grouping:"bad")}`, `{flowHistory(grouping:"week",weekEnd:7)}`, `{flowHistory(grouping:"week",before:"2026-10-22")}`, `{categorySpending(start:"2026-10-22",end:"2026-10-21")}`} {
		repo.user = ""
		result = execute(t, h, query, nil)
		if result["errors"] == nil || repo.user != "" {
			t.Fatal("invalid filter accepted", result)
		}
	}
}

func (r *analyticsRepository) CashFlowPage(_ context.Context, user string, f finance.CashFlowFilter, today string) (finance.CashFlowPage, error) {
	r.user, r.start, r.end = user, f.Period, f.Selected
	return finance.CashFlowPage{Start: "2026-10-19", End: "2026-10-25", Today: today, Buckets: []finance.FlowBucket{{Start: "2026-10-19", End: "2026-10-19"}}, Flows: []finance.Row{}, Breakdown: []finance.Row{{"categoryId": "owned", "name": "Salary", "currency": "EUR", "kind": "INCOME", "amount": "9007199254740993", "count": "2"}}}, nil
}
func TestCalendarAnalyticsGraphQLContract(t *testing.T) {
	repo := &analyticsRepository{}
	svc := finance.Service{Repository: repo, CurrentUser: identity("owner"), Now: func() time.Time { return time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC) }}
	h, err := NewHandler(account.Service{Repository: &memoryRepository{}, CurrentUser: identity("owner")}, "http://localhost:5173", svc)
	if err != nil {
		t.Fatal(err)
	}
	result := execute(t, h, `{cashFlowPage(period:"week",weekStart:1,selected:"2026-10-19",categoryId:"owned")}`, nil)
	if result["errors"] != nil || repo.user != "owner" || repo.end != "2026-10-19" {
		t.Fatal(result, repo)
	}
	page := result["data"].(map[string]interface{})["cashFlowPage"].(map[string]interface{})
	if page["totals"].([]interface{})[0].(map[string]interface{})["income"] != "9007199254740993" {
		t.Fatal(page)
	}
	for _, q := range []string{`{cashFlowPage(period:"bad")}`, `{cashFlowPage(period:"week",weekStart:7)}`, `{cashFlowPage(period:"year",anchor:"2026-10-22")}`, `{cashFlowPage(period:"custom",start:"2026-10-22",end:"2026-10-21")}`, `{cashFlowPage(period:"week",selected:"2026-02-30")}`, `{wealthCalendar(period:"bad")}`, `{wealthCalendar(period:"week",weekStart:7)}`, `{wealthCalendar(period:"week",anchor:"2026-10-22")}`} {
		repo.user = ""
		result = execute(t, h, q, nil)
		if result["errors"] == nil || repo.user != "" {
			t.Fatal("invalid calendar request accepted", q, result)
		}
	}
}
