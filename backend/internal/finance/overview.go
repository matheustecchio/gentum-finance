package finance

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

type Overview struct {
	HistoryNote string `json:"historyNote"`
	ChangeError string `json:"changeError"`
	Change30    string `json:"change30"`
	Currency    string `json:"currency"`
	Today       string `json:"today"`
	Wealth      []Row  `json:"wealth"`
	Flows       []Row  `json:"flows"`
	RateDate    string `json:"rateDate"`
	RateError   string `json:"rateError"`
	Converted   bool   `json:"converted"`
}
type overviewData struct {
	HistoryNote  string
	Currency     string
	Observations []Row
	Flows        []Row
}
type overviewRepository interface {
	Overview(context.Context, string, string, time.Time) (overviewData, error)
}

type Rate struct {
	Date  string      `json:"date"`
	Base  string      `json:"base"`
	Quote string      `json:"quote"`
	Value json.Number `json:"rate"`
}
type RateSource interface {
	Rates(context.Context, time.Time) ([]Rate, error)
}

// ECB reference rates are estimates, not executable bank quotes. Only currency
// codes are requested; no ledger balances, names, or user IDs leave this process.
type ECBRates struct {
	mu      sync.Mutex
	rates   []Rate
	fetched time.Time
	Client  *http.Client
	URL     string
}

func (e *ECBRates) Rates(ctx context.Context, now time.Time) ([]Rate, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.rates) > 0 && now.Sub(e.fetched) < time.Hour {
		return e.rates, nil
	}
	client := e.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	url := e.URL
	if url == "" {
		url = "https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=GBP,USD,BRL"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("rate provider unavailable")
	}
	var rates []Rate
	decoder := json.NewDecoder(io.LimitReader(res.Body, 65536))
	decoder.UseNumber()
	if err = decoder.Decode(&rates); err != nil {
		return nil, err
	}
	if _, _, err = rateTable(rates, now); err != nil {
		return nil, err
	}
	e.rates = rates
	e.fetched = now
	return rates, nil
}
func rateTable(rates []Rate, now time.Time) (map[string]*big.Rat, string, error) {
	table := map[string]*big.Rat{"EUR": big.NewRat(1, 1)}
	stamp := ""
	for _, r := range rates {
		day, err := time.Parse("2006-01-02", r.Date)
		if !regexp.MustCompile(`^[0-9]{1,12}(\.[0-9]{1,12})?$`).MatchString(string(r.Value)) {
			return nil, "", invalid("Invalid reference rate")
		}
		value, ok := new(big.Rat).SetString(string(r.Value))
		if err != nil || !ok || value.Sign() <= 0 || r.Base != "EUR" || day.After(now) || now.Sub(day) > 7*24*time.Hour {
			return nil, "", invalid("Missing or outdated exchange rates")
		}
		if r.Quote != "GBP" && r.Quote != "USD" && r.Quote != "BRL" {
			return nil, "", invalid("Unsupported reference currency")
		}
		if _, exists := table[r.Quote]; exists {
			return nil, "", invalid("Duplicate reference rate")
		}
		if stamp != "" && stamp != r.Date {
			return nil, "", invalid("Inconsistent rate dates")
		}
		stamp = r.Date
		table[r.Quote] = value
	}
	if len(table) != 4 {
		return nil, "", invalid("Incomplete exchange rates")
	}
	return table, stamp, nil
}

// Convert the aggregate exactly, then round once to cents, ties away from zero.
func convertedTotal(balances Row, target string, rates map[string]*big.Rat) (string, error) {
	sum := new(big.Rat)
	for currency, amount := range balances {
		n, ok := new(big.Int).SetString(amount, 10)
		if !ok {
			return "", invalid("Invalid observation")
		}
		if n.Sign() == 0 {
			continue
		}
		from, to := rates[currency], rates[target]
		if from == nil || to == nil {
			return "", invalid("Missing exchange rate")
		}
		value := new(big.Rat).Mul(new(big.Rat).SetInt(n), new(big.Rat).Quo(to, from))
		sum.Add(sum, value)
	}
	abs := new(big.Int).Abs(sum.Num())
	q, r := new(big.Int), new(big.Int)
	q.QuoRem(abs, sum.Denom(), r)
	if new(big.Int).Lsh(r, 1).Cmp(sum.Denom()) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	if sum.Sign() < 0 {
		q.Neg(q)
	}
	return checked(q.String())
}
func (s Service) Overview(ctx context.Context, month string) (Overview, error) {
	if !validMonth(month) || month < "1900-01" || month > "9998-12" {
		return Overview{}, invalid("Use a supported month")
	}
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return Overview{}, err
	}
	repo, ok := s.Repository.(overviewRepository)
	if !ok {
		return Overview{}, invalid("Overview unavailable")
	}
	now := time.Now().UTC()
	if s.Now != nil {
		now = s.Now().UTC()
	}
	d, err := repo.Overview(ctx, user, month, now)
	if err != nil {
		return Overview{}, err
	}
	out := Overview{HistoryNote: d.HistoryNote, Currency: d.Currency, Today: now.Format("2006-01-02"), Wealth: []Row{}, Flows: d.Flows}
	needsRates := false
	for _, o := range d.Observations {
		for currency, amount := range o {
			if currency != "date" && currency != d.Currency && amount != "0" {
				needsRates = true
			}
		}
	}
	table := map[string]*big.Rat{d.Currency: big.NewRat(1, 1)}
	if needsRates {
		out.Converted = true
		if s.Rates == nil {
			out.RateError = "Exchange rates unavailable"
			return out, nil
		}
		rates, e := s.Rates.Rates(ctx, now)
		if e == nil {
			table, out.RateDate, e = rateTable(rates, now)
		}
		if e != nil {
			out.RateError = "Exchange rates unavailable or more than 7 days old. Retry later."
			return out, nil
		}
	}
	for _, o := range d.Observations {
		balances := Row{}
		for k, v := range o {
			if k != "date" {
				balances[k] = v
			}
		}
		value, e := convertedTotal(balances, d.Currency, table)
		if e != nil {
			out.RateError = "Wealth exceeds the supported amount or a rate is missing"
			out.Wealth = []Row{}
			return out, nil
		}
		out.Wealth = append(out.Wealth, Row{"date": o["date"], "amount": value})
	}
	baseline := ""
	current := ""
	for _, w := range out.Wealth {
		if w["date"] == now.AddDate(0, 0, -30).Format("2006-01-02") {
			baseline = w["amount"]
		}
		if w["date"] == out.Today {
			current = w["amount"]
		}
	}
	if baseline != "" && current != "" {
		a, _ := new(big.Int).SetString(current, 10)
		b, _ := new(big.Int).SetString(baseline, 10)
		var changeErr error
		out.Change30, changeErr = checked(new(big.Int).Sub(a, b).String())
		if changeErr != nil {
			out.ChangeError = "30-day change unavailable: the difference exceeds the supported amount."
		}
	}
	return out, nil
}
func (r PostgresRepository) Overview(ctx context.Context, user, month string, now time.Time) (overviewData, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return overviewData{}, err
	}
	defer tx.Rollback(ctx)
	d := overviewData{Observations: []Row{}, Flows: []Row{}}
	// This query is read-only: reconstruct the ledger as of each UTC date.
	if err = tx.QueryRow(ctx, `SELECT base_currency FROM gentum_user WHERE id=$1`, user).Scan(&d.Currency); err != nil {
		return d, err
	}
	today := now.Format("2006-01-02")
	history, err := rows(ctx, tx, `
 WITH account_history AS (
   SELECT a.id,a.currency,a.initial_balance,(a.created_at AT TIME ZONE 'UTC')::date created_on,
     min(e.entry_date) FILTER(WHERE e.entry_date <= $2::date) first_entry,
     count(e.id) FILTER(WHERE e.entry_date <= $2::date) posted_count
   FROM account a LEFT JOIN entry e ON e.account_id=a.id AND e.user_id=a.user_id
   WHERE a.user_id=$1 GROUP BY a.id
 ), coverage AS (
   SELECT GREATEST($2::date-30, COALESCE(max(LEAST(created_on,COALESCE(first_entry,created_on))) FILTER(WHERE initial_balance<>0),$2::date-30)) starts,
     COALESCE(sum(posted_count),0)>0 has_entries FROM account_history
 ), days AS (
   SELECT d::date AS as_on FROM coverage CROSS JOIN LATERAL generate_series(coverage.starts,$2::date,interval '1 day') d
   WHERE coverage.has_entries OR d::date=$2::date
 ), opening AS (
   SELECT currency,sum(initial_balance::numeric) amount FROM account_history GROUP BY currency
 ), movements AS (
   SELECT a.currency,e.entry_date,sum(CASE WHEN e.kind IN ('INCOME','TRANSFER_IN') THEN e.amount::numeric ELSE -e.amount::numeric END) delta
   FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id
   WHERE e.user_id=$1 AND e.entry_date <= $2::date GROUP BY a.currency,e.entry_date
 )
 SELECT to_char(days.as_on,'YYYY-MM-DD'),opening.currency,(opening.amount+COALESCE(sum(m.delta),0))::text
 FROM days CROSS JOIN opening LEFT JOIN movements m ON m.currency=opening.currency AND m.entry_date<=days.as_on
 GROUP BY days.as_on,opening.currency,opening.amount ORDER BY days.as_on,opening.currency
 `, []string{"date", "currency", "amount"}, user, today)
	if err != nil {
		return d, err
	}
	for _, h := range history {
		if len(d.Observations) == 0 || d.Observations[len(d.Observations)-1]["date"] != h["date"] {
			d.Observations = append(d.Observations, Row{"date": h["date"]})
		}
		d.Observations[len(d.Observations)-1][h["currency"]] = h["amount"]
	}
	if len(d.Observations) == 0 {
		d.Observations = append(d.Observations, Row{"date": today})
	}
	d.HistoryNote = "Reconstructed from opening balances and dated ledger entries. Future-dated entries and unposted schedules are excluded."
	if len(d.Observations) < 31 {
		d.HistoryNote += " Earlier balances are unavailable where opening dates or dated activity are missing."
	}

	d.Flows, err = rows(ctx, tx, `SELECT to_char(date_trunc('month',e.entry_date),'YYYY-MM'),a.currency,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='INCOME'),0)::text,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='EXPENSE'),0)::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') AND e.entry_date>=($2::date-interval '5 months') AND e.entry_date<($2::date+interval '1 month') GROUP BY 1,a.currency ORDER BY 1,a.currency`, []string{"month", "currency", "income", "expense"}, user, month+"-01")
	if err != nil {
		return d, err
	}
	for _, f := range d.Flows {
		a, _ := new(big.Int).SetString(f["income"], 10)
		b, _ := new(big.Int).SetString(f["expense"], 10)
		f["net"] = new(big.Int).Sub(a, b).String()
		for _, k := range []string{"income", "expense", "net"} {
			if _, err = checked(f[k]); err != nil {
				return d, err
			}
		}
	}
	return d, tx.Commit(ctx)
}
