package finance

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type WealthHistory struct {
	Overview
	Buckets    []FlowBucket `json:"buckets"`
	HasEarlier bool         `json:"hasEarlier"`
}
type wealthHistoryData struct {
	overviewData
	Buckets    []FlowBucket
	HasEarlier bool
}
type wealthHistoryRepository interface {
	WealthHistory(context.Context, string, FlowFilter, string) (wealthHistoryData, error)
}

func (s Service) WealthHistory(ctx context.Context, f FlowFilter) (WealthHistory, error) {
	valid := map[string]bool{"week": true, "month": true, "quarter": true, "halfYear": true, "year": true, "fiveYears": true, "all": true, "custom": true}
	today := s.reportingToday()
	if !valid[f.Grouping] || f.WeekEnd < 0 || f.WeekEnd > 6 {
		return WealthHistory{}, invalid("Choose a grouping and week-ending day")
	}
	if f.Before != "" {
		if _, err := date(f.Before); err != nil || f.Before < "1900-01-01" || f.Before > today {
			return WealthHistory{}, invalid("Choose a supported history boundary")
		}
	}
	if f.Grouping == "custom" {
		if err := validateSpending(f.Start, f.End, today); err != nil {
			return WealthHistory{}, err
		}
	}
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return WealthHistory{}, err
	}
	repo, ok := s.Repository.(wealthHistoryRepository)
	if !ok {
		return WealthHistory{}, invalid("Wealth history unavailable")
	}
	d, err := repo.WealthHistory(ctx, user, f, today)
	if err != nil {
		return WealthHistory{}, err
	}
	now := time.Now().UTC()
	if s.Now != nil {
		now = s.Now().UTC()
	}
	out, err := s.convertOverview(ctx, d.overviewData, now)
	out.Today = today
	out.Change30, out.ChangeError = "", ""
	return WealthHistory{Overview: out, Buckets: d.Buckets, HasEarlier: d.HasEarlier}, err
}

// Presets use the same calendar groups as Cash flow. All/Custom sample daily
// through 63 dates and then month ends, keeping long histories bounded.
func wealthBuckets(f FlowFilter, earliest, today string) ([]FlowBucket, bool) {
	minimum := "1900-01-01"
	if earliest < minimum {
		earliest = minimum
	}
	if f.Grouping == "all" || f.Grouping == "custom" {
		start, end := earliest, today
		if f.Grouping == "custom" {
			start, end = f.Start, f.End
		}
		a, _ := date(start)
		b, _ := date(end)
		daily := b.Sub(a) <= 62*24*time.Hour
		buckets := []FlowBucket{}
		for cursor := a; !cursor.After(b); {
			next := cursor.AddDate(0, 0, 1)
			if !daily {
				next = time.Date(cursor.Year(), cursor.Month()+1, 1, 0, 0, 0, 0, time.UTC)
			}
			last := next.AddDate(0, 0, -1).Format("2006-01-02")
			if last > end {
				last = end
			}
			buckets = append(buckets, FlowBucket{cursor.Format("2006-01-02"), last})
			cursor = next
		}
		return buckets, false
	}
	stop, _ := date(today)
	if f.Before != "" {
		stop, _ = date(f.Before)
		stop = stop.AddDate(0, 0, -1)
	}
	cursor := bucketStart(stop, f.Grouping, f.WeekEnd)
	first, _ := date(earliest)
	first = bucketStart(first, f.Grouping, f.WeekEnd)
	buckets := []FlowBucket{}
	for len(buckets) < 8 && nextBucket(cursor, f.Grouping).Format("2006-01-02") > minimum {
		end := nextBucket(cursor, f.Grouping).AddDate(0, 0, -1).Format("2006-01-02")
		if end > stop.Format("2006-01-02") {
			end = stop.Format("2006-01-02")
		}
		start := cursor.Format("2006-01-02")
		if start < minimum {
			start = minimum
		}
		buckets = append([]FlowBucket{{start, end}}, buckets...)
		previous := bucketStart(cursor.AddDate(0, 0, -1), f.Grouping, f.WeekEnd)
		if previous.Before(first) {
			break
		}
		cursor = previous
	}
	firstDate := first.Format("2006-01-02")
	if firstDate < minimum {
		firstDate = minimum
	}
	return buckets, len(buckets) > 0 && buckets[0].Start > firstDate
}
func (r PostgresRepository) WealthHistory(ctx context.Context, user string, f FlowFilter, today string) (wealthHistoryData, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return wealthHistoryData{}, err
	}
	defer tx.Rollback(ctx)
	d := wealthHistoryData{overviewData: overviewData{Observations: []Row{}, HistoryNote: "End-of-period ledger balances reconstructed from opening balances and dated entries. Missing periods are unavailable. Future entries and unposted schedules are excluded. Current total and account changes remain independent of this chart."}}
	if err = tx.QueryRow(ctx, `SELECT base_currency FROM gentum_user WHERE id=$1`, user).Scan(&d.Currency); err != nil {
		return d, err
	}
	earliest := today
	if err = tx.QueryRow(ctx, `SELECT COALESCE(to_char(min(history_day),'YYYY-MM-DD'),$2::text) FROM (SELECT (created_at AT TIME ZONE 'UTC')::date AS history_day FROM account WHERE user_id=$1 UNION ALL SELECT entry_date FROM entry WHERE user_id=$1 AND entry_date<=$2::date) h WHERE history_day<=$2::date`, user, today).Scan(&earliest); err != nil {
		return d, err
	}
	d.Buckets, d.HasEarlier = wealthBuckets(f, earliest, today)
	dates := []string{}
	for _, b := range d.Buckets {
		dates = append(dates, b.End)
	}
	history, err := rows(ctx, tx, `
 WITH account_history AS (
 SELECT a.id,a.currency,a.initial_balance,(a.created_at AT TIME ZONE 'UTC')::date created_on,
 min(e.entry_date) FILTER(WHERE e.entry_date <= $2::date) first_entry,
 count(e.id) FILTER(WHERE e.entry_date <= $2::date) posted_count
 FROM account a LEFT JOIN entry e ON e.account_id=a.id AND e.user_id=a.user_id WHERE a.user_id=$1 GROUP BY a.id
 ), coverage AS (
 SELECT COALESCE(max(LEAST(created_on,COALESCE(first_entry,created_on))) FILTER(WHERE initial_balance<>0),'1900-01-01'::date) starts,
 COALESCE(sum(posted_count),0)>0 has_entries FROM account_history
 ), days AS (
 SELECT history_day::date as_on FROM unnest($3::text[]) AS endpoints(history_day) CROSS JOIN coverage
 WHERE history_day::date>=coverage.starts AND (coverage.has_entries OR history_day::date=$2::date)
 ), opening AS (
 SELECT currency,sum(initial_balance::numeric) amount FROM account_history GROUP BY currency
 ), movements AS (
 SELECT a.currency,e.entry_date,sum(CASE WHEN e.kind IN ('INCOME','TRANSFER_IN') THEN e.amount::numeric ELSE -e.amount::numeric END) delta
 FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.entry_date<=$2::date GROUP BY a.currency,e.entry_date
 )
 SELECT to_char(days.as_on,'YYYY-MM-DD'),opening.currency,(opening.amount+COALESCE(sum(m.delta),0))::text
 FROM days CROSS JOIN opening LEFT JOIN movements m ON m.currency=opening.currency AND m.entry_date<=days.as_on
 GROUP BY days.as_on,opening.currency,opening.amount ORDER BY days.as_on,opening.currency
 `, []string{"date", "currency", "amount"}, user, today, dates)
	if err != nil {
		return d, err
	}
	for _, h := range history {
		if len(d.Observations) == 0 || d.Observations[len(d.Observations)-1]["date"] != h["date"] {
			d.Observations = append(d.Observations, Row{"date": h["date"]})
		}
		d.Observations[len(d.Observations)-1][h["currency"]] = h["amount"]
	}
	return d, tx.Commit(ctx)
}
