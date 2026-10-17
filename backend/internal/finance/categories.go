package finance

import (
	"context"
	"math/big"
	"strings"

	"github.com/jackc/pgx/v5"
)

func createCategory(ctx context.Context, tx pgx.Tx, user string, in Row) error {
	name := strings.TrimSpace(in["name"])
	if len([]rune(name)) < 1 || len([]rune(name)) > 100 {
		return invalid("Category name must contain 1–100 characters")
	}
	if in["kind"] != "INCOME" && in["kind"] != "EXPENSE" {
		return invalid("Choose income or expense")
	}
	var parent interface{}
	if in["parentId"] != "" {
		var valid bool
		err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM category WHERE user_id=$1 AND id::text=$2 AND kind=$3 AND parent_id IS NULL)`, user, in["parentId"], in["kind"]).Scan(&valid)
		if err != nil {
			return err
		}
		if !valid {
			return invalid("Choose your root category with the same kind")
		}
		parent = in["parentId"]
	}
	var duplicate bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM category WHERE user_id=$1 AND kind=$2 AND parent_id IS NOT DISTINCT FROM $3::uuid AND lower(btrim(name))=lower($4))`, user, in["kind"], parent, name).Scan(&duplicate); err != nil {
		return err
	}
	if duplicate {
		return invalid("A category with this name already exists in this group")
	}
	_, err := tx.Exec(ctx, `INSERT INTO category(id,user_id,name,kind,parent_id) VALUES($1,$2,$3,$4,$5)`, newID(), user, name, in["kind"], parent)
	return err
}

var starterCatalog = []struct {
	kind, name string
	children   []string
}{
	{"INCOME", "Income", []string{"Wages", "Interest/dividends", "Miscellaneous"}},
	{"EXPENSE", "Daily Living", []string{"Groceries", "Dining out", "Well-being", "Clothes", "Recreation", "Gifts"}},
	{"EXPENSE", "Medical Expenses", []string{"Health dues", "Medicines"}},
	{"EXPENSE", "Bills & Subscriptions", []string{"Phone plan", "Digital subscriptions"}},
	{"EXPENSE", "Education", nil},
	{"EXPENSE", "Home", []string{"Rent", "Tools & Equipment", "Furniture & Repairs", "Services", "Utilities"}},
	{"EXPENSE", "Transportation", []string{"Public transportation", "Gas & Fuel", "Insurance", "Repairs", "Car Wash & Services", "Parking & Tolls"}},
	{"EXPENSE", "Vacations", []string{"Transport", "Accommodations", "Food", "Shopping", "Pet boarding", "Rental car"}},
}

// AddStarterCategories is explicit for existing profiles and called once during new profile creation.
// The caller holds the owner's write lock or is creating an uncommitted owner.
func AddStarterCategories(ctx context.Context, tx pgx.Tx, user string) error {
	ensure := func(name, kind string, parent interface{}) (string, error) {
		var id string
		err := tx.QueryRow(ctx, `SELECT id::text FROM category WHERE user_id=$1 AND kind=$2 AND parent_id IS NOT DISTINCT FROM $3::uuid AND lower(btrim(name))=lower($4) ORDER BY id LIMIT 1`, user, kind, parent, name).Scan(&id)
		if err == nil {
			return id, nil
		}
		if err != pgx.ErrNoRows {
			return "", err
		}
		id = newID()
		_, err = tx.Exec(ctx, `INSERT INTO category(id,user_id,name,kind,parent_id) VALUES($1,$2,$3,$4,$5)`, id, user, name, kind, parent)
		return id, err
	}
	for _, root := range starterCatalog {
		id, err := ensure(root.name, root.kind, nil)
		if err != nil {
			return err
		}
		for _, child := range root.children {
			if _, err = ensure(child, root.kind, id); err != nil {
				return err
			}
		}
	}
	return nil
}

// categoryBreakdown rolls each direct sum into its root once, separately per currency.
func categoryBreakdown(categories, direct []Row) ([]Row, error) {
	byID := map[string]Row{}
	sums := map[string]Row{}
	order := []string{}
	for _, c := range categories {
		byID[c["id"]] = c
	}
	ensure := func(id, currency string) Row {
		key := id + ":" + currency
		if sums[key] == nil {
			sums[key] = Row{"categoryId": id, "currency": currency, "direct": "0", "total": "0"}
			order = append(order, key)
		}
		return sums[key]
	}
	add := func(row Row, key, value string) error {
		a, _ := new(big.Int).SetString(row[key], 10)
		b, _ := new(big.Int).SetString(value, 10)
		v, err := checked(new(big.Int).Add(a, b).String())
		if err == nil {
			row[key] = v
		}
		return err
	}
	for _, d := range direct {
		row := ensure(d["categoryId"], d["currency"])
		if err := add(row, "direct", d["direct"]); err != nil {
			return nil, err
		}
		if err := add(row, "total", d["direct"]); err != nil {
			return nil, err
		}
		if parent := byID[d["categoryId"]]["parentId"]; parent != "" {
			if err := add(ensure(parent, d["currency"]), "total", d["direct"]); err != nil {
				return nil, err
			}
		}
	}
	out := []Row{}
	for _, key := range order {
		out = append(out, sums[key])
	}
	return out, nil
}
