package finance

import (
	"context"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

// Analytics contains only posted income and expenses in an inclusive date range.
type Analytics struct {
	Flows     []Row `json:"flows"`
	Breakdown []Row `json:"breakdown"`
}
type analyticsRepository interface {
	Analytics(context.Context, string, string, string) (Analytics, error)
}

func validateAnalytics(start, end string) error {
	a, err := date(start)
	if err != nil {
		return err
	}
	b, err := date(end)
	if err != nil {
		return err
	}
	if start < "1900-01-01" || end > "9998-12-31" || a.After(b) || b.After(a.AddDate(5, 0, 0)) {
		return invalid("Choose a date range of up to five years")
	}
	return nil
}
func (s Service) Analytics(ctx context.Context, start, end string) (Analytics, error) {
	if err := validateAnalytics(start, end); err != nil {
		return Analytics{}, err
	}
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return Analytics{}, err
	}
	now := time.Now().UTC()
	if s.Now != nil {
		now = s.Now().UTC()
	}
	location, err := time.LoadLocation("Europe/Dublin")
	if err != nil {
		return Analytics{}, err
	}
	if end > now.In(location).Format("2006-01-02") {
		return Analytics{}, invalid("End date cannot be in the future")
	}
	repo, ok := s.Repository.(analyticsRepository)
	if !ok {
		return Analytics{}, invalid("Analytics unavailable")
	}
	return repo.Analytics(ctx, user, start, end)
}
func (r PostgresRepository) Analytics(ctx context.Context, user, start, end string) (Analytics, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Analytics{}, err
	}
	defer tx.Rollback(ctx)
	out := Analytics{}
	// Short ranges show daily bars; longer ranges show months, clipped to the same bounds.
	out.Flows, err = rows(ctx, tx, `SELECT CASE WHEN $3::date-$2::date<=62 THEN to_char(e.entry_date,'YYYY-MM-DD') ELSE to_char(e.entry_date,'YYYY-MM') END,a.currency,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='INCOME'),0)::text,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='EXPENSE'),0)::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') AND e.entry_date BETWEEN $2::date AND $3::date GROUP BY 1,a.currency ORDER BY 1,a.currency`, []string{"month", "currency", "income", "expense"}, user, start, end)
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
	out.Breakdown, err = rows(ctx, tx, `SELECT e.category_id::text,a.currency,sum(e.amount::numeric)::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.kind='EXPENSE' AND e.entry_date BETWEEN $2::date AND $3::date GROUP BY e.category_id,a.currency ORDER BY e.category_id,a.currency`, []string{"categoryId", "currency", "direct"}, user, start, end)
	if err != nil {
		return out, err
	}
	for _, b := range out.Breakdown {
		if _, err = checked(b["direct"]); err != nil {
			return out, err
		}
	}
	return out, tx.Commit(ctx)
}
