package finance

import (
	"context"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

type FlowBucket struct {
	Start string `json:"start"`
	End   string `json:"end"`
}
type FlowHistory struct {
	Buckets    []FlowBucket `json:"buckets"`
	Flows      []Row        `json:"flows"`
	HasEarlier bool         `json:"hasEarlier"`
}
type FlowFilter struct {
	Grouping, Before, Start, End string
	WeekEnd                      int
}
type flowHistoryRepository interface {
	FlowHistory(context.Context, string, FlowFilter, string) (FlowHistory, error)
	Spending(context.Context, string, string, string) ([]Row, error)
}

func (s Service) reportingToday() string {
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	loc, _ := time.LoadLocation("Europe/Dublin")
	return now.In(loc).Format("2006-01-02")
}
func bucketStart(t time.Time, grouping string, weekEnd int) time.Time {
	y, m, _ := t.Date()
	if grouping == "week" {
		return t.AddDate(0, 0, -(int(t.Weekday())-((weekEnd+1)%7)+7)%7)
	}
	months := map[string]int{"month": 1, "quarter": 3, "fourMonths": 4, "halfYear": 6, "year": 12}
	if grouping == "fiveYears" {
		return time.Date(y-y%5, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	n := months[grouping]
	if n == 0 {
		n = 1
	}
	return time.Date(y, time.Month((int(m)-1)/n*n+1), 1, 0, 0, 0, 0, time.UTC)
}
func nextBucket(t time.Time, grouping string) time.Time {
	if grouping == "week" {
		return t.AddDate(0, 0, 7)
	}
	n := map[string]int{"month": 1, "quarter": 3, "fourMonths": 4, "halfYear": 6, "year": 12, "fiveYears": 60}[grouping]
	return t.AddDate(0, n, 0)
}
func (s Service) FlowHistory(ctx context.Context, f FlowFilter) (FlowHistory, error) {
	valid := map[string]bool{"week": true, "month": true, "quarter": true, "fourMonths": true, "halfYear": true, "year": true, "fiveYears": true, "all": true, "custom": true}
	if !valid[f.Grouping] || f.WeekEnd < 0 || f.WeekEnd > 6 {
		return FlowHistory{}, invalid("Choose a grouping and week-ending day")
	}
	today := s.reportingToday()
	if f.Before != "" {
		if _, err := date(f.Before); err != nil || f.Before < "1900-01-01" || f.Before > today {
			return FlowHistory{}, invalid("Choose a supported history boundary")
		}
	}
	if f.Grouping == "custom" {
		if err := validateSpending(f.Start, f.End, today); err != nil {
			return FlowHistory{}, err
		}
	}
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return FlowHistory{}, err
	}
	repo, ok := s.Repository.(flowHistoryRepository)
	if !ok {
		return FlowHistory{}, invalid("Cash flow unavailable")
	}
	return repo.FlowHistory(ctx, user, f, today)
}
func validateSpending(start, end, today string) error {
	if _, err := date(start); err != nil {
		return err
	}
	if _, err := date(end); err != nil {
		return err
	}
	if start < "1900-01-01" || start > end || end > today {
		return invalid("Choose ordered dates through today")
	}
	return nil
}
func (s Service) Spending(ctx context.Context, start, end string) (Analytics, error) {
	if err := validateSpending(start, end, s.reportingToday()); err != nil {
		return Analytics{}, err
	}
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return Analytics{}, err
	}
	repo, ok := s.Repository.(flowHistoryRepository)
	if !ok {
		return Analytics{}, invalid("Categories unavailable")
	}
	breakdown, err := repo.Spending(ctx, user, start, end)
	return Analytics{Breakdown: breakdown, Flows: []Row{}}, err
}
func (r PostgresRepository) Spending(ctx context.Context, user, start, end string) ([]Row, error) {
	result, err := rows(ctx, r.Pool, `SELECT e.category_id::text,a.currency,sum(e.amount::numeric)::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.kind='EXPENSE' AND e.entry_date BETWEEN $2::date AND $3::date GROUP BY e.category_id,a.currency ORDER BY e.category_id,a.currency`, []string{"categoryId", "currency", "direct"}, user, start, end)
	if err != nil {
		return nil, err
	}
	for _, b := range result {
		if _, err = checked(b["direct"]); err != nil {
			return nil, err
		}
	}
	return result, nil
}
func (r PostgresRepository) FlowHistory(ctx context.Context, user string, f FlowFilter, today string) (FlowHistory, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return FlowHistory{}, err
	}
	defer tx.Rollback(ctx)
	earliest := today
	if err = tx.QueryRow(ctx, `SELECT COALESCE(to_char(min(entry_date),'YYYY-MM-DD'),$2) FROM entry WHERE user_id=$1 AND kind IN ('INCOME','EXPENSE') AND entry_date<=$2::date`, user, today).Scan(&earliest); err != nil {
		return FlowHistory{}, err
	}
	if earliest < "1900-01-01" {
		earliest = "1900-01-01"
	}
	out := FlowHistory{Buckets: []FlowBucket{}, Flows: []Row{}}
	if f.Grouping == "all" {
		out.Buckets = append(out.Buckets, FlowBucket{earliest, today})
	} else if f.Grouping == "custom" {
		a, _ := date(f.Start)
		b, _ := date(f.End)
		daily := b.Sub(a) <= 62*24*time.Hour
		for cursor := a; !cursor.After(b); {
			next := cursor.AddDate(0, 0, 1)
			if !daily {
				next = time.Date(cursor.Year(), cursor.Month()+1, 1, 0, 0, 0, 0, time.UTC)
			}
			end := next.AddDate(0, 0, -1).Format("2006-01-02")
			if end > f.End {
				end = f.End
			}
			out.Buckets = append(out.Buckets, FlowBucket{cursor.Format("2006-01-02"), end})
			cursor = next
		}
	} else {
		stop, _ := date(today)
		if f.Before != "" {
			stop, _ = date(f.Before)
			stop = stop.AddDate(0, 0, -1)
		}
		first, _ := date(earliest)
		first = bucketStart(first, f.Grouping, f.WeekEnd)
		cursor := bucketStart(stop, f.Grouping, f.WeekEnd)
		minimum, _ := date("1900-01-01")
		for len(out.Buckets) < 8 && nextBucket(cursor, f.Grouping).After(minimum) {
			end := nextBucket(cursor, f.Grouping).AddDate(0, 0, -1).Format("2006-01-02")
			if end > stop.Format("2006-01-02") {
				end = stop.Format("2006-01-02")
			}
			start := cursor.Format("2006-01-02")
			if start < "1900-01-01" {
				start = "1900-01-01"
			}
			out.Buckets = append([]FlowBucket{{start, end}}, out.Buckets...)
			previous := bucketStart(cursor.AddDate(0, 0, -1), f.Grouping, f.WeekEnd)
			if previous.Before(first) {
				break
			}
			cursor = previous
		}
		firstDate := first.Format("2006-01-02")
		if firstDate < "1900-01-01" {
			firstDate = "1900-01-01"
		}
		out.HasEarlier = len(out.Buckets) > 0 && out.Buckets[0].Start > firstDate
	}
	if len(out.Buckets) == 0 {
		return out, tx.Commit(ctx)
	}
	starts, ends := []string{}, []string{}
	for _, b := range out.Buckets {
		starts = append(starts, b.Start)
		ends = append(ends, b.End)
	}
	out.Flows, err = rows(ctx, tx, `WITH buckets AS (SELECT * FROM unnest($2::text[],$3::text[]) AS b(start_date,end_date)) SELECT b.start_date,a.currency,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='INCOME'),0)::text,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='EXPENSE'),0)::text FROM buckets b JOIN entry e ON e.entry_date BETWEEN b.start_date::date AND b.end_date::date AND e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id GROUP BY b.start_date,a.currency ORDER BY b.start_date,a.currency`, []string{"month", "currency", "income", "expense"}, user, starts, ends)
	if err != nil {
		return out, err
	}
	for _, f := range out.Flows {
		a, _ := new(big.Int).SetString(f["income"], 10)
		b, _ := new(big.Int).SetString(f["expense"], 10)
		f["net"] = new(big.Int).Sub(a, b).String()
		for _, k := range []string{"income", "expense", "net"} {
			if _, err = checked(f[k]); err != nil {
				return out, err
			}
		}
	}
	return out, tx.Commit(ctx)
}
