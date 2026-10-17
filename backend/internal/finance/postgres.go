package finance

import (
	"context"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"math/big"
	"strconv"
	"strings"
	"time"
)

type PostgresRepository struct{ Pool *pgxpool.Pool }
type queryer interface {
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
}

func rows(ctx context.Context, q queryer, sql string, keys []string, args ...interface{}) ([]Row, error) {
	rs, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	out := []Row{}
	for rs.Next() {
		values, err := rs.Values()
		if err != nil {
			return nil, err
		}
		r := Row{}
		for i, v := range values {
			if v != nil {
				r[keys[i]] = v.(string)
			} else {
				r[keys[i]] = ""
			}
		}
		out = append(out, r)
	}
	return out, rs.Err()
}
func (r PostgresRepository) Snapshot(ctx context.Context, user, month string) (Snapshot, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback(ctx)
	s, err := snapshot(ctx, tx, user, month)
	if err != nil {
		return s, err
	}
	return s, tx.Commit(ctx)
}
func snapshot(ctx context.Context, q queryer, user, month string) (s Snapshot, err error) {
	s.Accounts, err = rows(ctx, q, `SELECT a.id::text,a.name,a.type,a.currency,a.initial_balance::text,(a.initial_balance::numeric+COALESCE(sum(CASE WHEN e.kind IN ('INCOME','TRANSFER_IN') THEN e.amount::numeric ELSE -e.amount::numeric END),0))::text FROM account a LEFT JOIN entry e ON e.user_id=a.user_id AND e.account_id=a.id WHERE a.user_id=$1 GROUP BY a.id ORDER BY a.created_at,a.id`, []string{"id", "name", "type", "currency", "initialBalance", "balance"}, user)
	if err != nil {
		return
	}
	for _, a := range s.Accounts {
		if _, err = checked(a["balance"]); err != nil {
			return
		}
	}
	s.Categories, err = rows(ctx, q, `SELECT id::text,name,kind FROM category WHERE user_id=$1 ORDER BY kind,name,id`, []string{"id", "name", "kind"}, user)
	if err != nil {
		return
	}
	s.Entries, err = rows(ctx, q, `SELECT e.id::text,e.account_id::text,e.category_id::text,e.kind,e.amount::text,e.description,to_char(e.entry_date,'YYYY-MM-DD'),a.currency,e.transfer_id::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 ORDER BY e.entry_date DESC,e.created_at DESC,e.id`, []string{"id", "accountId", "categoryId", "kind", "amount", "description", "date", "currency", "transferId"}, user)
	if err != nil {
		return
	}
	s.Budgets, err = rows(ctx, q, `SELECT b.id::text,b.category_id::text,b.currency,to_char(b.month,'YYYY-MM'),b.amount::text,COALESCE((SELECT sum(e.amount::numeric) FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=b.user_id AND e.category_id=b.category_id AND e.kind='EXPENSE' AND a.currency=b.currency AND date_trunc('month',e.entry_date)=b.month),0)::text FROM budget b WHERE b.user_id=$1 AND b.month=$2::date ORDER BY b.currency,b.category_id`, []string{"id", "categoryId", "currency", "month", "amount", "spent"}, user, month+"-01")
	if err != nil {
		return
	}
	for _, b := range s.Budgets {
		if _, err = checked(b["spent"]); err != nil {
			return
		}
	}
	s.Recurring, err = rows(ctx, q, `SELECT id::text,account_id::text,category_id::text,kind,amount::text,description,to_char(next_date,'YYYY-MM-DD'),active::text FROM recurring WHERE user_id=$1 ORDER BY next_date,id`, []string{"id", "accountId", "categoryId", "kind", "amount", "description", "nextDate", "active"}, user)
	if err != nil {
		return
	}
	s.Totals, err = rows(ctx, q, `SELECT a.currency,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='INCOME'),0)::text,COALESCE(sum(e.amount::numeric) FILTER(WHERE e.kind='EXPENSE'),0)::text FROM account a LEFT JOIN entry e ON e.account_id=a.id AND e.user_id=a.user_id AND date_trunc('month',e.entry_date)=$2::date WHERE a.user_id=$1 GROUP BY a.currency ORDER BY a.currency`, []string{"currency", "income", "expense"}, user, month+"-01")
	if err != nil {
		return
	}
	for _, t := range s.Totals {
		income, _ := new(big.Int).SetString(t["income"], 10)
		expense, _ := new(big.Int).SetString(t["expense"], 10)
		t["net"] = new(big.Int).Sub(income, expense).String()
		for _, key := range []string{"income", "expense"} {
			if _, err = checked(t[key]); err != nil {
				return
			}
		}
	}
	return
}
func (r PostgresRepository) Execute(ctx context.Context, user, action string, in Row) (string, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	// Serialize writes for one owner, including imports, transfers and recurring runs.
	if _, err = tx.Exec(ctx, `SELECT id FROM gentum_user WHERE id=$1 FOR UPDATE`, user); err != nil {
		return "", err
	}
	result := "Saved"
	switch action {
	case "category":
		name := strings.TrimSpace(in["name"])
		if len([]rune(name)) < 1 || len([]rune(name)) > 100 {
			return "", invalid("Category name must contain 1–100 characters")
		}
		if in["kind"] != "INCOME" && in["kind"] != "EXPENSE" {
			return "", invalid("Choose income or expense")
		}
		_, err = tx.Exec(ctx, `INSERT INTO category(id,user_id,name,kind) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,name,kind) DO NOTHING`, newID(), user, name, in["kind"])
	case "transaction":
		err = insertEntry(ctx, tx, user, in, "", "")
	case "transfer":
		err = transfer(ctx, tx, user, in)
	case "budget":
		if !validMonth(in["month"]) {
			return "", invalid("Use YYYY-MM")
		}
		var amount int64
		amount, err = positive(in["amount"])
		if err != nil {
			return "", err
		}
		var kind string
		err = tx.QueryRow(ctx, `SELECT kind FROM category WHERE user_id=$1 AND id=$2`, user, in["categoryId"]).Scan(&kind)
		if err != nil || kind != "EXPENSE" {
			return "", invalid("Choose your expense category")
		}
		_, err = tx.Exec(ctx, `INSERT INTO budget(id,user_id,category_id,currency,month,amount) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,category_id,currency,month) DO UPDATE SET amount=excluded.amount`, newID(), user, in["categoryId"], in["currency"], in["month"]+"-01", amount)
	case "recurring":
		var t time.Time
		t, err = date(in["date"])
		if err != nil {
			return "", err
		}
		var amount int64
		amount, err = validateEntry(ctx, tx, user, in)
		if err != nil {
			return "", err
		}
		_, err = tx.Exec(ctx, `INSERT INTO recurring(id,user_id,account_id,category_id,kind,amount,description,next_date,anchor_day) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, newID(), user, in["accountId"], in["categoryId"], in["kind"], amount, in["description"], t, t.Day())
	case "stopRecurring":
		res, e := tx.Exec(ctx, `UPDATE recurring SET active=false WHERE user_id=$1 AND id=$2`, user, in["id"])
		err = e
		if e == nil && res.RowsAffected() != 1 {
			err = invalid("Schedule not found")
		}
	case "runDue":
		today := time.Now().UTC().Format("2006-01-02")
		var schedules []Row
		schedules, err = rows(ctx, tx, `SELECT id::text,account_id::text,category_id::text,kind,amount::text,description,to_char(next_date,'YYYY-MM-DD'),anchor_day::text FROM recurring WHERE user_id=$1 AND active AND next_date<=$2::date ORDER BY next_date,id FOR UPDATE`, []string{"id", "accountId", "categoryId", "kind", "amount", "description", "date", "anchorDay"}, user, today)
		if err != nil {
			return "", err
		}
		count := 0
		for _, s := range schedules {
			t, _ := date(s["date"])
			anchor, _ := strconv.Atoi(s["anchorDay"])
			for t.Format("2006-01-02") <= today {
				if count >= 1000 {
					return "", invalid("More than 1000 due occurrences; stop outdated schedules first")
				}
				s["date"] = t.Format("2006-01-02")
				if err = insertEntry(ctx, tx, user, s, s["id"], ""); err != nil {
					return "", err
				}
				count++
				t = nextMonth(t, anchor)
			}
			if _, err = tx.Exec(ctx, `UPDATE recurring SET next_date=$1 WHERE user_id=$2 AND id=$3`, t, user, s["id"]); err != nil {
				return "", err
			}
		}
		result = "Created " + strconv.Itoa(count) + " due transactions"
	case "import":
		var data []Row
		data, err = parseCSV(in["csv"])
		if err != nil {
			return "", err
		}
		for _, row := range data {
			row["accountId"] = row["account_id"]
			row["categoryId"] = row["category_id"]
			row["amount"] = row["amount_cents"]
			if err = insertEntry(ctx, tx, user, row, "", ""); err != nil {
				return "", err
			}
		}
		result = "Imported " + strconv.Itoa(len(data)) + " transactions"
	case "export":
		var s Snapshot
		s, err = snapshot(ctx, tx, user, time.Now().UTC().Format("2006-01"))
		result = exportCSV(s.Entries)
	default:
		return "", invalid("Unknown finance action")
	}
	if err != nil {
		return "", err
	}
	if action != "export" {
		if err = checkBalances(ctx, tx, user); err != nil {
			return "", err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return result, nil
}
func validateEntry(ctx context.Context, tx pgx.Tx, user string, in Row) (int64, error) {
	amount, err := positive(in["amount"])
	if err != nil {
		return 0, err
	}
	if _, err = date(in["date"]); err != nil {
		return 0, err
	}
	if _, err = description(in["description"]); err != nil {
		return 0, err
	}
	if in["kind"] != "INCOME" && in["kind"] != "EXPENSE" {
		return 0, invalid("Choose income or expense")
	}
	var count int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM account a,category c WHERE a.user_id=$1 AND a.id=$2 AND NOT a.archived AND c.user_id=$1 AND c.id=$3 AND c.kind=$4`, user, in["accountId"], in["categoryId"], in["kind"]).Scan(&count)
	if err != nil || count != 1 {
		return 0, invalid("Choose your account and a category matching the transaction kind")
	}
	return amount, nil
}
func insertEntry(ctx context.Context, tx pgx.Tx, user string, in Row, recurring, transferID string) error {
	amount, err := validateEntry(ctx, tx, user, in)
	if err != nil {
		return err
	}
	var schedule interface{}
	if recurring != "" {
		schedule = recurring
	}
	_, err = tx.Exec(ctx, `INSERT INTO entry(id,user_id,account_id,category_id,kind,amount,description,entry_date,recurring_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(recurring_id,entry_date) DO NOTHING`, newID(), user, in["accountId"], in["categoryId"], in["kind"], amount, strings.TrimSpace(in["description"]), in["date"], schedule)
	return err
}
func transfer(ctx context.Context, tx pgx.Tx, user string, in Row) error {
	amount, err := positive(in["amount"])
	if err != nil {
		return err
	}
	if _, err = date(in["date"]); err != nil {
		return err
	}
	if _, err = description(in["description"]); err != nil {
		return err
	}
	if in["fromId"] == in["toId"] {
		return invalid("Choose different accounts")
	}
	var count int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM account a,account b WHERE a.user_id=$1 AND b.user_id=$1 AND a.id=$2 AND b.id=$3 AND NOT a.archived AND NOT b.archived AND a.currency=b.currency`, user, in["fromId"], in["toId"]).Scan(&count)
	if err != nil || count != 1 {
		return invalid("Transfer requires two of your accounts in the same currency")
	}
	id := newID()
	for i, account := range []string{in["fromId"], in["toId"]} {
		kind := "TRANSFER_OUT"
		if i == 1 {
			kind = "TRANSFER_IN"
		}
		_, err = tx.Exec(ctx, `INSERT INTO entry(id,user_id,account_id,kind,amount,description,entry_date,transfer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, newID(), user, account, kind, amount, in["description"], in["date"], id)
		if err != nil {
			return err
		}
	}
	return nil
}
func checkBalances(ctx context.Context, tx pgx.Tx, user string) error {
	values, err := rows(ctx, tx, `SELECT (a.initial_balance::numeric+COALESCE(sum(CASE WHEN e.kind IN ('INCOME','TRANSFER_IN') THEN e.amount::numeric ELSE -e.amount::numeric END),0))::text FROM account a LEFT JOIN entry e ON e.account_id=a.id AND e.user_id=a.user_id WHERE a.user_id=$1 GROUP BY a.id`, []string{"balance"}, user)
	if err != nil {
		return err
	}
	for _, v := range values {
		if _, err = checked(v["balance"]); err != nil {
			return err
		}
	}
	totals, err := rows(ctx, tx, `SELECT sum(e.amount::numeric)::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') GROUP BY a.currency,date_trunc('month',e.entry_date),e.kind`, []string{"amount"}, user)
	if err != nil {
		return err
	}
	for _, total := range totals {
		if _, err = checked(total["amount"]); err != nil {
			return err
		}
	}

	return nil
}
