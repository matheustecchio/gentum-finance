package finance

import "context"

type WealthCalendar struct {
	WealthHistory
	Start    string `json:"start"`
	End      string `json:"end"`
	Previous string `json:"previous"`
	Next     string `json:"next"`
}

// Calendar navigation changes the observation range, never the current balance.
func (s Service) WealthCalendar(ctx context.Context, f CashFlowFilter) (WealthCalendar, error) {
	today := s.reportingToday()
	if f.Anchor == "" {
		f.Anchor = today
	}
	if _, err := date(f.Anchor); err != nil || f.Anchor > today || f.WeekStart < 0 || f.WeekStart > 1 {
		return WealthCalendar{}, invalid("Choose a supported calendar period")
	}
	valid := map[string]bool{"week": true, "month": true, "quarter": true, "halfYear": true, "year": true, "fiveYears": true, "all": true, "custom": true}
	if !valid[f.Period] {
		return WealthCalendar{}, invalid("Choose a calendar period")
	}
	if f.Period == "all" {
		h, err := s.WealthHistory(ctx, FlowFilter{Grouping: "all"})
		start := today
		if len(h.Buckets) > 0 {
			start = h.Buckets[0].Start
		}
		return WealthCalendar{WealthHistory: h, Start: start, End: today}, err
	}
	if f.Period == "custom" {
		if err := validateSpending(f.Start, f.End, today); err != nil {
			return WealthCalendar{}, err
		}
	}
	page := cashFlowCalendar(f, today, today)
	end := page.End
	if end > today {
		end = today
	}
	h, err := s.WealthHistory(ctx, FlowFilter{Grouping: "custom", Start: page.Start, End: end})
	return WealthCalendar{WealthHistory: h, Start: page.Start, End: page.End, Previous: page.Previous, Next: page.Next}, err
}
