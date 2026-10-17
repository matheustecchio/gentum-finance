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
	Change30  string `json:"change30"`
	Currency  string `json:"currency"`
	Today     string `json:"today"`
	Wealth    []Row  `json:"wealth"`
	Flows     []Row  `json:"flows"`
	RateDate  string `json:"rateDate"`
	RateError string `json:"rateError"`
	Converted bool   `json:"converted"`
}
type overviewData struct {
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
	out := Overview{Currency: d.Currency, Today: now.Format("2006-01-02"), Wealth: []Row{}, Flows: d.Flows}
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
		out.Change30, _ = checked(new(big.Int).Sub(a, b).String())
	}
	return out, nil
}
func (r PostgresRepository) Overview(ctx context.Context, user, month string, now time.Time) (overviewData, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return overviewData{}, err
	}
	defer tx.Rollback(ctx)
	d := overviewData{Observations: []Row{}, Flows: []Row{}}
	// Serialize observations and preference changes against normal ledger writes.
	if err = tx.QueryRow(ctx, `SELECT base_currency FROM gentum_user WHERE id=$1 FOR UPDATE`, user).Scan(&d.Currency); err != nil {
		return d, err
	}
	balances, err := rows(ctx, tx, `SELECT a.currency,(sum(a.initial_balance::numeric)+COALESCE(sum(e.delta),0))::text FROM account a LEFT JOIN (SELECT account_id,sum(CASE WHEN kind IN ('INCOME','TRANSFER_IN') THEN amount::numeric ELSE -amount::numeric END) delta FROM entry WHERE user_id=$1 GROUP BY account_id) e ON e.account_id=a.id WHERE a.user_id=$1 GROUP BY a.currency`, []string{"currency", "amount"}, user)
	if err != nil {
		return d, err
	}
	native := Row{}
	for _, b := range balances {
		native[b["currency"]] = b["amount"]
	}
	raw, err := json.Marshal(native)
	if err != nil {
		return d, err
	}
	today := now.Format("2006-01-02")
	if _, err = tx.Exec(ctx, `INSERT INTO wealth_observation(user_id,observed_on,balances) VALUES($1,$2,$3) ON CONFLICT(user_id,observed_on) DO UPDATE SET balances=excluded.balances,observed_at=now()`, user, today, raw); err != nil {
		return d, err
	}
	observations, err := rows(ctx, tx, `SELECT to_char(observed_on,'YYYY-MM-DD'),balances::text FROM wealth_observation WHERE user_id=$1 AND observed_on BETWEEN $2::date-30 AND $2::date ORDER BY observed_on`, []string{"date", "balances"}, user, today)
	if err != nil {
		return d, err
	}
	for _, o := range observations {
		var b Row
		if err = json.Unmarshal([]byte(o["balances"]), &b); err != nil {
			return d, err
		}
		b["date"] = o["date"]
		d.Observations = append(d.Observations, b)
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
