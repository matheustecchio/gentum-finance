package finance

import (
	"context"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// budgetPeriod keeps the original calendar anchor after short months and leap years.
func budgetPeriod(anchor, at time.Time, frequency string) (time.Time, time.Time) {
	var start, next time.Time
	switch frequency {
	case "weekly":
		days := int((at.Unix() - anchor.Unix()) / 86400)
		if days < 0 {
			days -= 6
		}
		start = anchor.AddDate(0, 0, (days/7)*7)
		next = start.AddDate(0, 0, 7)
	case "monthly", "yearly":
		months := (at.Year()-anchor.Year())*12 + int(at.Month()-anchor.Month())
		if frequency == "yearly" {
			months = (at.Year() - anchor.Year()) * 12
		}
		start = anchoredBudgetDate(anchor, months)
		step := 1
		if frequency == "yearly" {
			step = 12
		}
		if start.After(at) {
			months -= step
			start = anchoredBudgetDate(anchor, months)
		}
		next = anchoredBudgetDate(anchor, months+step)
	default:
		return anchor, time.Time{}
	}
	return start, next.AddDate(0, 0, -1)
}
func anchoredBudgetDate(anchor time.Time, months int) time.Time {
	first := time.Date(anchor.Year(), anchor.Month()+time.Month(months), 1, 0, 0, 0, 0, time.UTC)
	day := min(anchor.Day(), first.AddDate(0, 1, -1).Day())
	return first.AddDate(0, 0, day-1)
}

func budgetSnapshot(ctx context.Context, q queryer, user, month string) ([]Row, error) {
	plans, err := rows(ctx, q, `SELECT id::text,series_id::text,name,currency,amount::text,frequency,start_date::text,effective_date::text,COALESCE(until_date::text,''),array_to_string(category_ids,','),array_to_string(account_ids,','),alert::text FROM budget_plan WHERE user_id=$1 ORDER BY name,effective_date`, []string{"id", "seriesId", "name", "currency", "amount", "frequency", "planStartDate", "effectiveDate", "stopDate", "categoryIds", "accountIds", "alert"}, user)
	if err != nil {
		return nil, err
	}
	first, _ := time.Parse("2006-01", month)
	last := first.AddDate(0, 1, -1)
	out := []Row{}
	for _, p := range plans {
		anchor, _ := date(p["planStartDate"])
		effective, _ := date(p["effectiveDate"])
		if effective.After(last) {
			continue
		}
		latest := true
		for _, other := range plans {
			if other["seriesId"] == p["seriesId"] && other["effectiveDate"] > p["effectiveDate"] {
				latest = false
			}
		}
		var until time.Time
		if p["stopDate"] != "" {
			until, _ = date(p["stopDate"])
		}
		start, end := budgetPeriod(anchor, first, p["frequency"])
		if p["frequency"] == "once" {
			end = until
		}
		for !start.After(last) {
			if !end.Before(first) && !start.Before(effective) && (until.IsZero() || !start.After(until)) {
				actualEnd := end
				if !until.IsZero() && until.Before(actualEnd) {
					actualEnd = until
				}
				stats, e := rows(ctx, q, `SELECT COALESCE(sum(e.amount::numeric),0)::text,COALESCE(string_agg(e.id::text,',' ORDER BY e.entry_date,e.id),'') FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.kind='EXPENSE' AND a.currency=$2 AND e.entry_date BETWEEN $3::date AND $4::date AND ($5='' OR e.category_id=ANY(string_to_array($5,',')::uuid[]) OR e.category_id IN (SELECT id FROM category WHERE user_id=$1 AND parent_id=ANY(string_to_array($5,',')::uuid[]))) AND ($6='' OR e.account_id=ANY(string_to_array($6,',')::uuid[]))`, []string{"spent", "entryIds"}, user, p["currency"], start.Format("2006-01-02"), actualEnd.Format("2006-01-02"), p["categoryIds"], p["accountIds"])
				if e != nil {
					return nil, e
				}
				row := Row{}
				for k, v := range p {
					row[k] = v
				}
				for k, v := range stats[0] {
					row[k] = v
				}
				row["startDate"] = start.Format("2006-01-02")
				row["endDate"] = actualEnd.Format("2006-01-02")
				row["nextDate"] = end.AddDate(0, 0, 1).Format("2006-01-02")
				amount, _ := new(big.Int).SetString(p["amount"], 10)
				spent, _ := new(big.Int).SetString(row["spent"], 10)
				row["remaining"] = new(big.Int).Sub(amount, spent).String()
				row["active"] = "true"
				row["latestVersion"] = "true"
				if !latest {
					row["latestVersion"] = "false"
				}
				if p["frequency"] == "once" || (p["stopDate"] != "" && latest) {
					row["active"] = "false"
				}
				// Compatibility fields remain available for older clients.
				row["month"] = month
				row["categoryId"] = strings.Split(p["categoryIds"], ",")[0]
				out = append(out, row)
			}
			if p["frequency"] == "once" {
				break
			}
			start, end = budgetPeriod(anchor, end.AddDate(0, 0, 1), p["frequency"])
		}
	}
	return out, nil
}

func budgetIDs(ctx context.Context, tx pgx.Tx, user, raw, table, currency string) ([]string, error) {
	ids := []string{}
	seen := map[string]bool{}
	if raw == "" {
		return ids, nil
	}
	for _, id := range strings.Split(raw, ",") {
		if seen[id] {
			continue
		}
		seen[id] = true
		var ok bool
		query := `SELECT EXISTS(SELECT 1 FROM category WHERE user_id=$1 AND id::text=$2 AND kind='EXPENSE')`
		args := []interface{}{user, id}
		if table == "account" {
			query = `SELECT EXISTS(SELECT 1 FROM account WHERE user_id=$1 AND id::text=$2 AND currency=$3)`
			args = append(args, currency)
		}
		if err := tx.QueryRow(ctx, query, args...).Scan(&ok); err != nil {
			return nil, err
		}
		if !ok {
			return nil, invalid("Choose your expense categories and accounts in the budget currency")
		}
		ids = append(ids, id)
		if len(ids) > 1000 {
			return nil, invalid("Choose at most 1000 categories or accounts")
		}
	}
	sort.Strings(ids)
	return ids, nil
}

func saveBudget(ctx context.Context, tx pgx.Tx, user string, in Row) error {
	name := strings.TrimSpace(in["name"])
	if len([]rune(name)) < 1 || len([]rune(name)) > 100 {
		return invalid("Use a budget name of 1 to 100 characters")
	}
	amount, err := positive(in["amount"])
	if err != nil {
		return err
	}
	switch in["currency"] {
	case "EUR", "GBP", "USD", "BRL":
	default:
		return invalid("Choose a supported currency")
	}
	switch in["frequency"] {
	case "weekly", "monthly", "yearly", "once":
	default:
		return invalid("Choose a budget period")
	}
	if in["alert"] != "true" && in["alert"] != "false" {
		return invalid("Choose whether budget alerts are enabled")
	}
	anchor, err := date(in["date"])
	if err != nil {
		return err
	}
	effective := anchor
	var until *time.Time
	if in["frequency"] == "once" {
		end, e := date(in["endDate"])
		if e != nil {
			return e
		}
		if end.Before(anchor) {
			return invalid("End date must follow the start date")
		}
		until = &end
	}
	categories, err := budgetIDs(ctx, tx, user, in["categoryIds"], "category", in["currency"])
	if err != nil {
		return err
	}
	accounts, err := budgetIDs(ctx, tx, user, in["accountIds"], "account", in["currency"])
	if err != nil {
		return err
	}
	id := in["id"]
	series := id
	if id != "" {
		var oldStart, oldEffective time.Time
		var oldUntil *time.Time
		var frequency string
		err = tx.QueryRow(ctx, `SELECT series_id::text,start_date,effective_date,until_date,frequency FROM budget_plan WHERE user_id=$1 AND id::text=$2`, user, id).Scan(&series, &oldStart, &oldEffective, &oldUntil, &frequency)
		if err != nil {
			return invalid("Budget not found")
		}
		effective, err = date(in["effectiveDate"])
		if err != nil {
			return err
		}
		boundary, _ := budgetPeriod(oldStart, effective, frequency)
		if effective.Before(oldEffective) || !boundary.Equal(effective) || (oldUntil != nil && effective.After(*oldUntil)) {
			return invalid("Choose a period start within this budget version")
		}
		// Keep period identity stable. A different recurrence is a new budget.
		if frequency != in["frequency"] || !anchor.Equal(oldStart) {
			return invalid("Keep the original start date and frequency when editing")
		}
		anchor = oldStart
		var later bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM budget_plan WHERE user_id=$1 AND series_id=$2 AND effective_date>$3)`, user, series, oldEffective).Scan(&later); err != nil {
			return err
		}
		if later {
			return invalid("Edit the latest budget version to preserve later changes")
		}
		if frequency != "once" {
			until = oldUntil
		}
		if !effective.Equal(oldEffective) {
			if _, err = tx.Exec(ctx, `UPDATE budget_plan SET until_date=$3::date-1 WHERE user_id=$1 AND id::text=$2`, user, id, effective); err != nil {
				return err
			}
			id = newID()
		}
	} else {
		id = newID()
		series = id
	}
	_, err = tx.Exec(ctx, `INSERT INTO budget_plan(id,series_id,user_id,name,currency,amount,frequency,start_date,effective_date,until_date,category_ids,account_ids,alert) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET name=excluded.name,currency=excluded.currency,amount=excluded.amount,until_date=excluded.until_date,category_ids=excluded.category_ids,account_ids=excluded.account_ids,alert=excluded.alert`, id, series, user, name, in["currency"], amount, in["frequency"], anchor, effective, until, categories, accounts, in["alert"] == "true")
	return err
}
func changeBudget(ctx context.Context, tx pgx.Tx, user, action string, in Row) error {
	var series string
	if err := tx.QueryRow(ctx, `SELECT series_id::text FROM budget_plan WHERE user_id=$1 AND id::text=$2`, user, in["id"]).Scan(&series); err != nil {
		return invalid("Budget not found")
	}
	if action == "deleteBudget" {
		if _, err := tx.Exec(ctx, `DELETE FROM budget WHERE user_id=$1 AND id::text=$2`, user, series); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM budget_plan WHERE user_id=$1 AND series_id=$2`, user, series)
		return err
	}
	end, err := date(in["date"])
	if err != nil {
		return err
	}
	var anchor, effective time.Time
	var frequency string
	var until *time.Time
	if err = tx.QueryRow(ctx, `SELECT start_date,effective_date,frequency,until_date FROM budget_plan WHERE user_id=$1 AND id::text=$2`, user, in["id"]).Scan(&anchor, &effective, &frequency, &until); err != nil {
		return err
	}
	_, periodEnd := budgetPeriod(anchor, end, frequency)
	if frequency == "once" || end.Before(effective) || !end.Equal(periodEnd) || (until != nil && end.After(*until)) {
		return invalid("Stop at the end of an existing recurring budget period")
	}
	if _, err = tx.Exec(ctx, `DELETE FROM budget_plan WHERE user_id=$1 AND series_id=$2 AND effective_date>$3`, user, series, end); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE budget_plan SET until_date=$3 WHERE user_id=$1 AND series_id=$2 AND effective_date<=$3 AND (until_date IS NULL OR until_date>$3)`, user, series, end)
	return err
}
func saveLegacyBudget(ctx context.Context, tx pgx.Tx, user string, in Row) error {
	if !validMonth(in["month"]) {
		return invalid("Use YYYY-MM")
	}
	amount, err := positive(in["amount"])
	if err != nil {
		return err
	}
	var name string
	if err = tx.QueryRow(ctx, `SELECT name FROM category WHERE user_id=$1 AND id::text=$2 AND kind='EXPENSE'`, user, in["categoryId"]).Scan(&name); err != nil {
		return invalid("Choose your expense category")
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO budget(id,user_id,category_id,currency,month,amount) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,category_id,currency,month) DO UPDATE SET amount=excluded.amount RETURNING id::text`, newID(), user, in["categoryId"], in["currency"], in["month"]+"-01", amount).Scan(&id)
	if err != nil {
		return err
	}
	start, _ := time.Parse("2006-01", in["month"])
	_, err = tx.Exec(ctx, `INSERT INTO budget_plan(id,series_id,user_id,name,currency,amount,frequency,start_date,effective_date,until_date,category_ids) VALUES($1,$1,$2,$3,$4,$5,'once',$6,$6,$7,ARRAY[$8::uuid]) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount`, id, user, name, in["currency"], amount, start, start.AddDate(0, 1, -1), in["categoryId"])
	return err
}
