package finance

import (
	"context"
	"math/big"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

type CashFlowFilter struct {
	Period, Anchor, Start, End string
	Selected, CategoryID       string
	WeekStart                  int
	Offset                     int
}
type CashFlowPage struct {
	Start                 string       `json:"start"`
	End                   string       `json:"end"`
	Today                 string       `json:"today"`
	Grouping              string       `json:"grouping"`
	Previous              string       `json:"previous"`
	Next                  string       `json:"next"`
	Buckets               []FlowBucket `json:"buckets"`
	Flows                 []Row        `json:"flows"`
	Totals                []Row        `json:"totals"`
	Incoming              []Row        `json:"incoming"`
	Outgoing              []Row        `json:"outgoing"`
	SelectedStart         string       `json:"selectedStart"`
	SelectedEnd           string       `json:"selectedEnd"`
	Entries               []Row        `json:"entries"`
	NextOffset            int          `json:"nextOffset"`
	TrendBuckets          []FlowBucket `json:"trendBuckets"`
	ComparisonUnavailable bool         `json:"comparisonUnavailable"`
	ComparisonTotals      []Row        `json:"comparisonTotals"`
	ComparisonBuckets     []FlowBucket `json:"comparisonBuckets"`
	ComparisonFlows       []Row        `json:"comparisonFlows"`
	TrendFlows            []Row        `json:"trendFlows"`
	Breakdown             []Row        `json:"-"`
}
type cashFlowPageRepository interface {
	CashFlowPage(context.Context, string, CashFlowFilter, string) (CashFlowPage, error)
}

func (s Service) CashFlowPage(ctx context.Context, f CashFlowFilter) (CashFlowPage, error) {
	valid := map[string]bool{"week": true, "month": true, "quarter": true, "halfYear": true, "year": true, "fiveYears": true, "all": true, "custom": true}
	today := s.reportingToday()
	if f.Offset < 0 || f.Offset%50 != 0 {
		return CashFlowPage{}, invalid("Choose a valid transaction page")
	}
	if !valid[f.Period] || (f.WeekStart != 0 && f.WeekStart != 1) {
		return CashFlowPage{}, invalid("Choose a period and Sunday or Monday week start")
	}
	if f.Anchor == "" {
		f.Anchor = today
	}
	if _, err := date(f.Anchor); err != nil || f.Anchor < "1900-01-01" || f.Anchor > today {
		return CashFlowPage{}, invalid("Choose a supported period date")
	}
	if f.Period == "custom" {
		if err := validateSpending(f.Start, f.End, today); err != nil {
			return CashFlowPage{}, err
		}
	}
	if f.Selected != "" {
		if _, err := date(f.Selected); err != nil || f.Selected > today {
			return CashFlowPage{}, invalid("Choose an available chart date")
		}
	}
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return CashFlowPage{}, err
	}
	repo, ok := s.Repository.(cashFlowPageRepository)
	if !ok {
		return CashFlowPage{}, invalid("Cash flow unavailable")
	}
	out, err := repo.CashFlowPage(ctx, user, f, today)
	if err != nil {
		return CashFlowPage{}, err
	}
	if err = completeCashFlowPage(&out); err != nil {
		return CashFlowPage{}, err
	}
	return out, nil
}
func cashFlowCalendar(f CashFlowFilter, earliest, today string) CashFlowPage {
	anchor, _ := date(f.Anchor)
	start := bucketStart(anchor, f.Period, (f.WeekStart+6)%7)
	end := nextBucket(start, f.Period).AddDate(0, 0, -1)
	if f.Period == "all" {
		start, _ = date(earliest)
		end, _ = date(today)
	}
	if f.Period == "custom" {
		start, _ = date(f.Start)
		end, _ = date(f.End)
	}
	minimum, _ := date("1900-01-01")
	if start.Before(minimum) {
		start = minimum
	}
	out := CashFlowPage{Start: start.Format("2006-01-02"), End: end.Format("2006-01-02"), Today: today, Buckets: []FlowBucket{}, Flows: []Row{}, Totals: []Row{}, Incoming: []Row{}, Outgoing: []Row{}}
	if f.Period != "all" && f.Period != "custom" {
		if start.After(minimum) {
			out.Previous = start.AddDate(0, 0, -1).Format("2006-01-02")
		}
		next := end.AddDate(0, 0, 1).Format("2006-01-02")
		if next <= today {
			out.Next = next
		}
	}
	grouping := "day"
	if f.Period == "month" || f.Period == "quarter" || f.Period == "halfYear" || f.Period == "year" {
		grouping = "month"
	}
	if f.Period == "fiveYears" {
		grouping = "year"
	}
	if f.Period == "all" || f.Period == "custom" {
		if end.Sub(start) > 62*24*time.Hour {
			grouping = "month"
		}
		if end.Sub(start) > 5*366*24*time.Hour {
			grouping = "year"
		}
	}
	out.Grouping = grouping
	out.SelectedStart, out.SelectedEnd = out.Start, out.End
	out.Entries = []Row{}
	for cursor := start; !cursor.After(end); {
		next := cursor.AddDate(0, 0, 1)
		if grouping == "month" {
			next = time.Date(cursor.Year(), cursor.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		}
		if grouping == "year" {
			next = time.Date(cursor.Year()+1, 1, 1, 0, 0, 0, 0, time.UTC)
		}
		last := next.AddDate(0, 0, -1)
		if last.After(end) {
			last = end
		}
		out.Buckets = append(out.Buckets, FlowBucket{Start: cursor.Format("2006-01-02"), End: last.Format("2006-01-02")})
		cursor = next
	}
	return out
}
func completeCashFlowPage(out *CashFlowPage) error {
	out.Totals, out.Incoming, out.Outgoing = []Row{}, []Row{}, []Row{}
	for _, series := range [][]Row{out.ComparisonTotals, out.ComparisonFlows} {
		for _, row := range series {
			for _, key := range []string{"income", "expense", "cumulativeIncome", "cumulativeExpense"} {
				if row[key] != "" {
					if _, err := checked(row[key]); err != nil {
						out.ComparisonUnavailable = true
					}
				}
			}
		}
	}
	if out.ComparisonUnavailable {
		out.ComparisonTotals, out.ComparisonFlows, out.ComparisonBuckets = []Row{}, []Row{}, []FlowBucket{}
	}

	totals := map[string]map[string]*big.Int{}
	for _, r := range out.Breakdown {
		value, ok := new(big.Int).SetString(r["amount"], 10)
		if !ok || value.Sign() < 0 {
			return invalid("Invalid cash flow amount")
		}
		if _, err := checked(r["amount"]); err != nil {
			return err
		}
		if totals[r["currency"]] == nil {
			totals[r["currency"]] = map[string]*big.Int{"INCOME": new(big.Int), "EXPENSE": new(big.Int)}
		}
		if r["kind"] != "INCOME" && r["kind"] != "EXPENSE" {
			return invalid("Invalid cash flow kind")
		}
		totals[r["currency"]][r["kind"]].Add(totals[r["currency"]][r["kind"]], value)
	}
	currencies := []string{}
	for currency := range totals {
		currencies = append(currencies, currency)
	}
	sort.Strings(currencies)
	for _, currency := range currencies {
		sums := totals[currency]
		net := new(big.Int).Sub(sums["INCOME"], sums["EXPENSE"])
		row := Row{"currency": currency, "income": sums["INCOME"].String(), "expense": sums["EXPENSE"].String(), "net": net.String()}
		for _, key := range []string{"income", "expense", "net"} {
			if _, err := checked(row[key]); err != nil {
				return err
			}
		}
		count := int64(len(out.Buckets))
		if out.SelectedStart != "" && (out.SelectedStart != out.Start || out.SelectedEnd != out.End) {
			count = 1
		}
		if count < 1 {
			count = 1
		}
		for _, key := range []string{"income", "expense"} {
			average := new(big.Int).Add(new(big.Int).Set(sums[map[string]string{"income": "INCOME", "expense": "EXPENSE"}[key]]), big.NewInt(count/2))
			row[key+"Average"] = average.Div(average, big.NewInt(count)).String()
			if out.Previous != "" && !out.ComparisonUnavailable {
				old := new(big.Int)
				for _, r := range out.ComparisonTotals {
					if r["currency"] == currency {
						old.SetString(r[key], 10)
					}
				}
				current, _ := new(big.Int).SetString(row[key], 10)
				change := new(big.Int).Sub(current, old).String()
				if _, e := checked(change); e == nil {
					row[key+"Change"] = change
				}
			}
		}
		out.Totals = append(out.Totals, row)
	}
	for _, r := range out.Breakdown {
		value, _ := new(big.Int).SetString(r["amount"], 10)
		total := totals[r["currency"]][r["kind"]]
		r["percentage"] = "0%"
		if total.Sign() > 0 {
			scaled := new(big.Int).Mul(value, big.NewInt(100))
			if value.Sign() > 0 && scaled.Cmp(total) < 0 {
				r["percentage"] = "<1%"
			} else {
				scaled.Add(scaled, new(big.Int).Div(new(big.Int).Set(total), big.NewInt(2)))
				r["percentage"] = scaled.Div(scaled, total).String() + "%"
			}
		}
		if r["kind"] == "INCOME" {
			out.Incoming = append(out.Incoming, r)
		} else {
			out.Outgoing = append(out.Outgoing, r)
		}
	}
	for _, rows := range [][]Row{out.Incoming, out.Outgoing} {
		sort.SliceStable(rows, func(i, j int) bool {
			a, _ := new(big.Int).SetString(rows[i]["amount"], 10)
			b, _ := new(big.Int).SetString(rows[j]["amount"], 10)
			if rows[i]["currency"] != rows[j]["currency"] {
				return rows[i]["currency"] < rows[j]["currency"]
			}
			if a.Cmp(b) == 0 {
				return rows[i]["name"] < rows[j]["name"]
			}
			return a.Cmp(b) > 0
		})
	}
	for _, row := range append(append([]Row{}, out.Flows...), out.TrendFlows...) {
		for _, key := range []string{"income", "expense", "cumulativeIncome", "cumulativeExpense"} {
			if row[key] == "" {
				continue
			}
			if _, err := checked(row[key]); err != nil {
				return err
			}
		}
	}
	return nil
}
func (r PostgresRepository) CashFlowPage(ctx context.Context, user string, f CashFlowFilter, today string) (CashFlowPage, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return CashFlowPage{}, err
	}
	defer tx.Rollback(ctx)
	earliest := today
	if f.Period == "all" {
		if err = tx.QueryRow(ctx, `SELECT COALESCE(to_char(min(entry_date),'YYYY-MM-DD'),$2::text) FROM entry WHERE user_id=$1 AND kind IN ('INCOME','EXPENSE') AND entry_date<=$2::date`, user, today).Scan(&earliest); err != nil {
			return CashFlowPage{}, err
		}
	}
	out := cashFlowCalendar(f, earliest, today)
	out.ComparisonTotals, out.ComparisonBuckets, out.ComparisonFlows = []Row{}, []FlowBucket{}, []Row{}
	if f.Selected != "" {
		found := false
		for _, b := range out.Buckets {
			if b.Start == f.Selected {
				out.SelectedStart, out.SelectedEnd = b.Start, b.End
				found = true
				break
			}
		}
		if !found {
			return out, invalid("Choose a date in the visible period")
		}
	}
	starts, ends := []string{}, []string{}
	for _, b := range out.Buckets {
		starts = append(starts, b.Start)
		ends = append(ends, b.End)
	}
	out.Flows, err = rows(ctx, tx, `WITH buckets AS (SELECT * FROM unnest($2::text[],$3::text[]) AS b(start_date,end_date)) SELECT b.start_date,a.currency,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='INCOME'),0)::text,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='EXPENSE'),0)::text FROM buckets b JOIN entry e ON e.entry_date BETWEEN b.start_date::date AND b.end_date::date AND e.entry_date<=$4::date AND e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') AND ($5::text='' OR e.category_id::text=$5) JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id GROUP BY b.start_date,a.currency ORDER BY b.start_date,a.currency`, []string{"month", "currency", "income", "expense"}, user, starts, ends, today, f.CategoryID)
	if err != nil {
		return out, err
	}
	trend := f
	trend.Period, trend.Start, trend.End = "custom", out.Start, out.End
	trendPage := cashFlowCalendar(trend, earliest, today)
	out.TrendBuckets = trendPage.Buckets
	trendStarts, trendEnds := []string{}, []string{}
	for _, b := range out.TrendBuckets {
		trendStarts = append(trendStarts, b.Start)
		trendEnds = append(trendEnds, b.End)
	}
	out.TrendFlows, err = cashTrend(ctx, tx, user, trendStarts, trendEnds, today, f.CategoryID)
	if err != nil {
		return out, err
	}
	out.Breakdown, err = rows(ctx, tx, `SELECT c.id::text,CASE WHEN p.id IS NULL THEN c.name ELSE p.name||' / '||c.name END,c.color,a.currency,e.kind,sum(e.amount::numeric)::text,count(*)::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id JOIN category c ON c.id=e.category_id AND c.user_id=e.user_id LEFT JOIN category p ON p.id=c.parent_id AND p.user_id=c.user_id WHERE e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') AND e.entry_date BETWEEN $2::date AND $3::date AND e.entry_date<=$4::date AND ($5::text='' OR e.category_id::text=$5) GROUP BY c.id,p.id,p.name,a.currency,e.kind`, []string{"categoryId", "name", "color", "currency", "kind", "amount", "count"}, user, out.SelectedStart, out.SelectedEnd, today, f.CategoryID)
	if err != nil {
		return out, err
	}
	if out.Previous != "" && !out.ComparisonUnavailable {
		priorFilter := f
		priorFilter.Anchor = out.Previous
		priorFilter.Selected = ""
		prior := cashFlowCalendar(priorFilter, earliest, today)
		comparisonStart, comparisonEnd := prior.Start, prior.End
		if f.Selected != "" {
			for i, b := range out.Buckets {
				if b.Start == f.Selected && i < len(prior.Buckets) {
					comparisonStart, comparisonEnd = prior.Buckets[i].Start, prior.Buckets[i].End
				}
			}
		}
		out.ComparisonTotals, err = rows(ctx, tx, `SELECT a.currency,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='INCOME'),0)::text,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='EXPENSE'),0)::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') AND e.entry_date BETWEEN $2::date AND $3::date AND e.entry_date<=$4::date AND ($5::text='' OR e.category_id::text=$5) GROUP BY a.currency`, []string{"currency", "income", "expense"}, user, comparisonStart, comparisonEnd, today, f.CategoryID)
		if err != nil {
			return out, err
		}
		priorFilter.Period, priorFilter.Start, priorFilter.End = "custom", prior.Start, prior.End
		priorTrend := cashFlowCalendar(priorFilter, earliest, today)
		out.ComparisonBuckets = priorTrend.Buckets
		ps, pe := []string{}, []string{}
		for _, b := range priorTrend.Buckets {
			ps = append(ps, b.Start)
			pe = append(pe, b.End)
		}
		out.ComparisonFlows, err = cashTrend(ctx, tx, user, ps, pe, today, f.CategoryID)
		if err != nil {
			return out, err
		}
	}

	if f.CategoryID != "" {
		out.Entries, err = rows(ctx, tx, `SELECT e.id::text,to_char(e.entry_date,'YYYY-MM-DD'),e.description,e.amount::text,e.kind,a.currency,a.name FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') AND e.entry_date BETWEEN $2::date AND $3::date AND e.entry_date<=$4::date AND e.category_id::text=$5 ORDER BY e.entry_date DESC,e.created_at DESC,e.id LIMIT 51 OFFSET $6`, []string{"id", "date", "description", "amount", "kind", "currency", "account"}, user, out.SelectedStart, out.SelectedEnd, today, f.CategoryID, f.Offset)
		if err != nil {
			return out, err
		}
		if len(out.Entries) > 50 {
			out.Entries = out.Entries[:50]
			out.NextOffset = f.Offset + 50
		}
	}
	return out, tx.Commit(ctx)
}

func cashTrend(ctx context.Context, tx pgx.Tx, user string, starts, ends []string, today, category string) ([]Row, error) {
	return rows(ctx, tx, `WITH buckets AS (SELECT * FROM unnest($2::text[],$3::text[]) AS b(start_date,end_date)), flows AS (SELECT b.start_date,a.currency,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='INCOME'),0) income,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='EXPENSE'),0) expense FROM buckets b JOIN entry e ON e.entry_date BETWEEN b.start_date::date AND b.end_date::date AND e.entry_date<=$4::date AND e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') AND ($5::text='' OR e.category_id::text=$5) JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id GROUP BY b.start_date,a.currency) SELECT start_date,currency,income::text,expense::text,sum(income) OVER(PARTITION BY currency ORDER BY start_date)::text,sum(expense) OVER(PARTITION BY currency ORDER BY start_date)::text FROM flows ORDER BY start_date,currency`, []string{"month", "currency", "income", "expense", "cumulativeIncome", "cumulativeExpense"}, user, starts, ends, today, category)
}
