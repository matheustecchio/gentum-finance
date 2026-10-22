package finance

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

// HistoryFilter uses date-only bounds and owned category IDs. After is opaque.
type HistoryFilter struct{ Start, End, CategoryID, SubcategoryID, After string }
type HistoryPage struct {
	Entries    []Row  `json:"entries"`
	NextCursor string `json:"nextCursor"`
	HasEntries bool   `json:"hasEntries"`
}
type historyRepository interface {
	History(context.Context, string, HistoryFilter) (HistoryPage, error)
	Summary(context.Context, string, string) (Snapshot, error)
}
type historyCursor struct {
	Date                              string
	Created                           time.Time
	ID                                string
	Start, End, Category, Subcategory string
}

func validateHistory(f HistoryFilter) error {
	for _, v := range []string{f.Start, f.End} {
		if v != "" {
			if _, err := date(v); err != nil {
				return err
			}
		}
	}
	if f.Start != "" && f.End != "" && f.Start > f.End {
		return invalid("Start date must be on or before end date")
	}
	if f.SubcategoryID != "" && f.CategoryID == "" {
		return invalid("Choose a root category first")
	}
	return nil
}
func (s Service) History(ctx context.Context, f HistoryFilter) (HistoryPage, error) {
	if err := validateHistory(f); err != nil {
		return HistoryPage{}, err
	}
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return HistoryPage{}, err
	}
	r, ok := s.Repository.(historyRepository)
	if !ok {
		return HistoryPage{}, invalid("History unavailable")
	}
	return r.History(ctx, user, f)
}
func (s Service) Summary(ctx context.Context, month string) (Snapshot, error) {
	if !validMonth(month) {
		return Snapshot{}, invalid("Use a month as YYYY-MM")
	}
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	r, ok := s.Repository.(historyRepository)
	if !ok {
		return Snapshot{}, invalid("Summary unavailable")
	}
	return r.Summary(ctx, user, month)
}
func (r PostgresRepository) Summary(ctx context.Context, user, month string) (Snapshot, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback(ctx)
	s, err := snapshotData(ctx, tx, user, month, false)
	if err != nil {
		return s, err
	}
	return s, tx.Commit(ctx)
}
func (r PostgresRepository) History(ctx context.Context, user string, f HistoryFilter) (HistoryPage, error) {
	if err := validateHistory(f); err != nil {
		return HistoryPage{}, err
	}
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return HistoryPage{}, err
	}
	defer tx.Rollback(ctx)
	if f.CategoryID != "" {
		var valid bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM category c WHERE c.user_id=$1 AND c.id::text=$2 AND c.parent_id IS NULL AND ($3='' OR EXISTS(SELECT 1 FROM category child WHERE child.user_id=$1 AND child.parent_id=c.id AND child.id::text=$3)))`, user, f.CategoryID, f.SubcategoryID).Scan(&valid)
		if err != nil {
			return HistoryPage{}, err
		}
		if !valid {
			return HistoryPage{}, invalid("Choose your root category and one of its subcategories")
		}
	}
	var cursor historyCursor
	if f.After != "" {
		raw, e := base64.RawURLEncoding.DecodeString(f.After)
		if e != nil || len(raw) > 2048 || json.Unmarshal(raw, &cursor) != nil || cursor.ID == "" || cursor.Created.IsZero() || cursor.Start != f.Start || cursor.End != f.End || cursor.Category != f.CategoryID || cursor.Subcategory != f.SubcategoryID {
			return HistoryPage{}, invalid("Invalid history cursor; return to the first page")
		}
		if _, e = date(cursor.Date); e != nil {
			return HistoryPage{}, invalid("Invalid history cursor")
		}
	}
	page := HistoryPage{}
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM entry WHERE user_id=$1)`, user).Scan(&page.HasEntries)
	if err != nil {
		return page, err
	}
	// All sort keys descend so a tuple comparison provides deterministic keyset pagination.
	page.Entries, err = rows(ctx, tx, `SELECT e.id::text,e.account_id::text,e.category_id::text,e.kind,e.amount::text,e.description,to_char(e.entry_date,'YYYY-MM-DD'),a.currency,e.transfer_id::text,e.recurring_id::text,e.created_at::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id LEFT JOIN category c ON c.id=e.category_id AND c.user_id=e.user_id WHERE e.user_id=$1 AND ($2='' OR e.entry_date>=NULLIF($2,'')::date) AND ($3='' OR e.entry_date<=NULLIF($3,'')::date) AND ($4='' OR c.id::text=$4 OR c.parent_id::text=$4) AND ($5='' OR c.id::text=$5) AND ($6='' OR (e.entry_date,e.created_at,e.id::text)<(NULLIF($7,'')::date,$8::timestamptz,$6)) ORDER BY e.entry_date DESC,e.created_at DESC,e.id DESC LIMIT 11`, []string{"id", "accountId", "categoryId", "kind", "amount", "description", "date", "currency", "transferId", "recurringId", "createdAt"}, user, f.Start, f.End, f.CategoryID, f.SubcategoryID, cursor.ID, cursor.Date, cursor.Created)
	if err != nil {
		return page, err
	}
	if len(page.Entries) > 10 {
		page.Entries = page.Entries[:10]
		last := page.Entries[9]
		// PostgreSQL's text timestamp format is read back without losing microseconds.
		var created time.Time
		err = tx.QueryRow(ctx, `SELECT created_at FROM entry WHERE user_id=$1 AND id::text=$2`, user, last["id"]).Scan(&created)
		if err != nil {
			return page, err
		}
		raw, _ := json.Marshal(historyCursor{last["date"], created, last["id"], f.Start, f.End, f.CategoryID, f.SubcategoryID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	for _, e := range page.Entries {
		delete(e, "createdAt")
	}
	return page, tx.Commit(ctx)
}
func deleteCategory(ctx context.Context, tx pgx.Tx, user, id string) error {
	var exists, children, entries, budgets, schedules bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM category WHERE user_id=$1 AND id::text=$2),EXISTS(SELECT 1 FROM category WHERE user_id=$1 AND parent_id::text=$2),EXISTS(SELECT 1 FROM entry WHERE user_id=$1 AND category_id::text=$2),EXISTS(SELECT 1 FROM budget WHERE user_id=$1 AND category_id::text=$2),EXISTS(SELECT 1 FROM recurring WHERE user_id=$1 AND category_id::text=$2)`, user, id).Scan(&exists, &children, &entries, &budgets, &schedules)
	if err != nil {
		return err
	}
	if !exists {
		return invalid("Category not found")
	}
	if children {
		return invalid("Remove eligible subcategories first")
	}
	if entries || budgets || schedules {
		return invalid("Category is used by transactions, budgets or schedules (including stopped schedules)")
	}
	_, err = tx.Exec(ctx, `DELETE FROM category WHERE user_id=$1 AND id::text=$2`, user, id)
	return err
}

// editEntry preserves the stored account and kind, regardless of client input.
// Execute holds the owner lock and checks financial ranges before committing.
func editEntry(ctx context.Context, tx pgx.Tx, user string, input Row) error {
	var account, kind string
	err := tx.QueryRow(ctx, `SELECT account_id::text,kind FROM entry WHERE user_id=$1 AND id::text=$2 AND kind IN ('INCOME','EXPENSE') AND transfer_id IS NULL AND recurring_id IS NULL FOR UPDATE`, user, input["id"]).Scan(&account, &kind)
	if err == pgx.ErrNoRows {
		return invalid("Only non-transfer, non-recurring income and expenses can be edited")
	}
	if err != nil {
		return err
	}
	in := Row{"accountId": account, "kind": kind, "categoryId": input["categoryId"], "amount": input["amount"], "date": input["date"], "description": input["description"]}
	amount, err := validateEntry(ctx, tx, user, in)
	if err != nil {
		return err
	}
	text, err := description(in["description"])
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE entry SET category_id=$3,amount=$4,entry_date=$5,description=$6 WHERE user_id=$1 AND id::text=$2`, user, input["id"], in["categoryId"], amount, in["date"], text)
	return err
}
