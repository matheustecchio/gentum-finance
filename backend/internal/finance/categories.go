package finance

import (
	"context"
	"math/big"
	"regexp"
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

var starterCatalog = []struct{ kind, name string }{
	{"INCOME", "Income"},
	{"INCOME", "Wages"},
	{"INCOME", "Interest/dividends"},
	{"INCOME", "Miscellaneous"},
	{"EXPENSE", "Daily Living"},
	{"EXPENSE", "Groceries"},
	{"EXPENSE", "Dining out"},
	{"EXPENSE", "Well-being"},
	{"EXPENSE", "Clothes"},
	{"EXPENSE", "Recreation"},
	{"EXPENSE", "Gifts"},
	{"EXPENSE", "Medical Expenses"},
	{"EXPENSE", "Health dues"},
	{"EXPENSE", "Medicines"},
	{"EXPENSE", "Bills & Subscriptions"},
	{"EXPENSE", "Phone plan"},
	{"EXPENSE", "Digital subscriptions"},
	{"EXPENSE", "Education"},
	{"EXPENSE", "Home"},
	{"EXPENSE", "Rent"},
	{"EXPENSE", "Tools & Equipment"},
	{"EXPENSE", "Furniture & Repairs"},
	{"EXPENSE", "Services"},
	{"EXPENSE", "Utilities"},
	{"EXPENSE", "Transportation"},
	{"EXPENSE", "Public transportation"},
	{"EXPENSE", "Gas & Fuel"},
	{"EXPENSE", "Insurance"},
	{"EXPENSE", "Repairs"},
	{"EXPENSE", "Car Wash & Services"},
	{"EXPENSE", "Parking & Tolls"},
	{"EXPENSE", "Vacations"},
}

// AddStarterCategories is called only while creating a new, uncommitted owner.
// Existing ledgers are never backfilled or changed by the starter catalog.
func AddStarterCategories(ctx context.Context, tx pgx.Tx, user string) error {
	for _, category := range starterCatalog {
		if _, err := tx.Exec(ctx, `INSERT INTO category(id,user_id,name,kind) VALUES($1,$2,$3,$4)`, newID(), user, category.name, category.kind); err != nil {
			return err
		}
	}
	return nil
}

func renameCategory(ctx context.Context, tx pgx.Tx, user string, in Row) error {
	name := strings.TrimSpace(in["name"])
	if len([]rune(name)) < 1 || len([]rune(name)) > 100 {
		return invalid("Category name must contain 1–100 characters")
	}
	var duplicate bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM category other WHERE other.user_id=c.user_id AND other.id<>c.id AND other.kind=c.kind AND other.parent_id IS NOT DISTINCT FROM c.parent_id AND lower(btrim(other.name))=lower($3)) FROM category c WHERE c.user_id=$1 AND c.id::text=$2 FOR UPDATE OF c`, user, in["id"], name).Scan(&duplicate)
	if err == pgx.ErrNoRows {
		return invalid("Category not found")
	}
	if err != nil {
		return err
	}
	if duplicate {
		return invalid("A category with this name already exists in this group")
	}
	_, err = tx.Exec(ctx, `UPDATE category SET name=$3 WHERE user_id=$1 AND id::text=$2`, user, in["id"], name)
	return err
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

var categoryColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func updateCategoryColor(ctx context.Context, tx pgx.Tx, user string, in Row) error {
	if !categoryColorPattern.MatchString(in["color"]) {
		return invalid("Choose a color in #RRGGBB format")
	}
	result, err := tx.Exec(ctx, `UPDATE category SET color=$3 WHERE user_id=$1 AND id::text=$2`, user, in["id"], strings.ToLower(in["color"]))
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return invalid("Category not found")
	}
	return nil
}
