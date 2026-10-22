package finance

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"math/big"
	"strconv"
)

type ImportPreview struct {
	Transactions []Row `json:"transactions"`
	Errors       []Row `json:"errors"`
	Count        int   `json:"count"`
}
type importPreviewRepository interface {
	PreviewImport(context.Context, string, Row) (ImportPreview, error)
}

func (s Service) PreviewImport(ctx context.Context, input Row) (ImportPreview, error) {
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return ImportPreview{}, err
	}
	repo, ok := s.Repository.(importPreviewRepository)
	if !ok {
		return ImportPreview{}, invalid("Import preview unavailable")
	}
	return repo.PreviewImport(ctx, user, input)
}
func importRow(row Row, account string) Row {
	if legacy, ok := row["account_id"]; ok {
		row["accountId"] = legacy
	} else {
		row["accountId"] = account
	}
	row["categoryId"] = row["category_id"]
	row["amount"] = row["amount_cents"]
	return row
}
func (r PostgresRepository) PreviewImport(ctx context.Context, user string, input Row) (ImportPreview, error) {
	preview := ImportPreview{Transactions: []Row{}, Errors: []Row{}}
	data, err := parseCSV(input["csv"])
	if err != nil {
		return preview, err
	}
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return preview, err
	}
	defer tx.Rollback(ctx)
	snap, err := snapshotData(ctx, tx, user, "2000-01", false)
	if err != nil {
		return preview, err
	}
	accounts, categories := map[string]Row{}, map[string]Row{}
	balances := map[string]*big.Int{}
	for _, a := range snap.Accounts {
		accounts[a["id"]] = a
		balances[a["id"]], _ = new(big.Int).SetString(a["balance"], 10)
	}
	for _, c := range snap.Categories {
		categories[c["id"]] = c
	}
	// Simulate all additions using the same range limits as the atomic write.
	totals, err := rows(ctx, tx, `SELECT a.currency,to_char(e.entry_date,'YYYY-MM'),e.kind,sum(e.amount::numeric)::text FROM entry e JOIN account a ON a.id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=$1 AND e.kind IN ('INCOME','EXPENSE') GROUP BY a.currency,to_char(e.entry_date,'YYYY-MM'),e.kind`, []string{"currency", "month", "kind", "amount"}, user)
	if err != nil {
		return preview, err
	}
	monthly := map[string]*big.Int{}
	for _, t := range totals {
		monthly[t["currency"]+t["month"]+t["kind"]], _ = new(big.Int).SetString(t["amount"], 10)
	}
	preview.Count = len(data)
	for i, raw := range data {
		row := importRow(raw, input["accountId"])
		record := strconv.Itoa(i + 2)
		amount, e := validateEntryValues(row)
		a, c := accounts[row["accountId"]], categories[row["categoryId"]]
		if e == nil && (a == nil || a["archived"] == "true" || c == nil || c["kind"] != row["kind"]) {
			e = invalid("Choose your account and a category matching the transaction kind")
		}
		if e != nil {
			preview.Errors = append(preview.Errors, Row{"record": record, "message": e.Error()})
			continue
		}
		delta := big.NewInt(amount)
		if row["kind"] == "EXPENSE" {
			delta.Neg(delta)
		}
		balance := balances[a["id"]]
		balance.Add(balance, delta)
		key := a["currency"] + row["date"][:7] + row["kind"]
		if monthly[key] == nil {
			monthly[key] = new(big.Int)
		}
		monthly[key].Add(monthly[key], big.NewInt(amount))
		if !monthly[key].IsInt64() {
			preview.Errors = append(preview.Errors, Row{"record": record, "message": "Import exceeds integer cents range"})
		}
		preview.Transactions = append(preview.Transactions, Row{"record": record, "accountId": a["id"], "account": a["name"], "categoryId": c["id"], "category": c["path"], "currency": a["currency"], "date": row["date"], "kind": row["kind"], "amount": row["amount"], "description": row["description"]})
	}
	for id, balance := range balances {
		if !balance.IsInt64() {
			preview.Errors = append(preview.Errors, Row{"record": lastAccountRecord(preview.Transactions, id), "message": "Import exceeds account balance range"})
		}
	}
	return preview, tx.Commit(ctx)
}

func csvRecordError(record int, err error) error {
	var validation ValidationError
	if errors.As(err, &validation) {
		return invalid(fmt.Sprintf("CSV record %d: %s", record, validation))
	}
	return err
}

func lastAccountRecord(transactions []Row, id string) string {
	for i := len(transactions) - 1; i >= 0; i-- {
		if transactions[i]["accountId"] == id {
			return transactions[i]["record"]
		}
	}
	return ""
}
