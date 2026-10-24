package finance

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Only a unique exact account/category/kind/amount/description match within
// three calendar days is associated automatically. Each occurrence is consumed
// at most once per file. Ambiguity rejects the import rather than hiding money.
type recurringMatcher struct {
	byKey map[string][]Row
	used  map[string]bool
}

func recurringKey(r Row) string {
	return strings.Join([]string{r["accountId"], r["categoryId"], r["kind"], r["amount"], strings.ToLower(strings.TrimSpace(r["description"]))}, "\x00")
}
func newRecurringMatcher(ctx context.Context, q queryer, user string) (*recurringMatcher, error) {
	items, err := rows(ctx, q, `SELECT `+occurrenceColumns+` FROM recurring_occurrence o WHERE o.user_id=$1 AND o.status IN ('pending','posted')`, occurrenceKeys, user)
	if err != nil {
		return nil, err
	}
	m := &recurringMatcher{byKey: map[string][]Row{}, used: map[string]bool{}}
	for _, o := range items {
		key := recurringKey(o)
		m.byKey[key] = append(m.byKey[key], o)
	}
	return m, nil
}
func (m *recurringMatcher) match(in Row) (Row, error) {
	if strings.TrimSpace(in["description"]) == "" {
		return nil, nil
	}
	day, err := date(in["date"])
	if err != nil {
		return nil, err
	}
	var found Row
	for _, o := range m.byKey[recurringKey(in)] {
		due, _ := date(o["date"])
		if m.used[o["id"]] || day.Before(due.AddDate(0, 0, -3)) || day.After(due.AddDate(0, 0, 3)) {
			continue
		}
		if found != nil {
			return nil, invalid("Multiple recurring occurrences match. Link or skip the relevant occurrence before importing")
		}
		found = o
	}
	if found != nil {
		m.used[found["id"]] = true
	}
	return found, nil
}
func importRecurringMatch(ctx context.Context, tx pgx.Tx, user string, in, o Row) error {
	entry := o["entryId"]
	if entry == "" {
		entry = newID()
		_, err := tx.Exec(ctx, `INSERT INTO entry(id,user_id,account_id,category_id,kind,amount,description,entry_date,recurring_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, entry, user, in["accountId"], in["categoryId"], in["kind"], in["amount"], strings.TrimSpace(in["description"]), in["date"], o["recurringId"])
		if err != nil {
			return err
		}
	} else {
		// Replace the generated record's date/details with the imported reality.
		_, err := tx.Exec(ctx, `UPDATE entry SET entry_date=$3,description=$4 WHERE user_id=$1 AND id::text=$2`, user, entry, in["date"], strings.TrimSpace(in["description"]))
		if err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `UPDATE recurring_occurrence SET status='linked',entry_id=$3 WHERE user_id=$1 AND id::text=$2`, user, o["id"], entry)
	return err
}
