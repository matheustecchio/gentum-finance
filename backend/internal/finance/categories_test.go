package finance

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"io"
	"strings"
	"testing"
)

func TestCategoryBreakdownExactRollup(t *testing.T) {
	categories := []Row{{"id": "root"}, {"id": "child", "parentId": "root"}, {"id": "other"}}
	result, err := categoryBreakdown(categories, []Row{
		{"categoryId": "root", "currency": "EUR", "direct": "29"},
		{"categoryId": "child", "currency": "EUR", "direct": "9007199254740993"},
		{"categoryId": "child", "currency": "USD", "direct": "17"},
		{"categoryId": "other", "currency": "EUR", "direct": "3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range result {
		if r["categoryId"] == "root" && r["currency"] == "EUR" && (r["total"] != "9007199254741022" || r["direct"] != "29") {
			t.Fatal(r)
		}
		if r["categoryId"] == "root" && r["currency"] == "USD" && r["total"] != "17" {
			t.Fatal(r)
		}
	}
	if _, err = categoryBreakdown(categories, []Row{{"categoryId": "root", "currency": "EUR", "direct": "9223372036854775807"}, {"categoryId": "child", "currency": "EUR", "direct": "1"}}); err == nil {
		t.Fatal("accepted overflow")
	}
}

func TestCSVFormats(t *testing.T) {
	for _, raw := range []string{
		"date,kind,category_id,amount_cents,description\n2026-10-17,EXPENSE,c,29,New\n",
		"date,account_id,category_id,kind,amount_cents,description\n2026-10-17,a,c,EXPENSE,29,Legacy\n",
	} {
		r, err := parseCSV(raw)
		if err != nil || len(r) != 1 || r[0]["category_id"] != "c" {
			t.Fatal(r, err)
		}
	}
}

func TestAccountExportPreservesAssociationWithoutIDs(t *testing.T) {
	encoded, err := exportAccounts([]Row{{"id": "secret-a", "name": "Same / name", "currency": "EUR"}, {"id": "secret-b", "name": "Same / name", "currency": "USD"}, {"id": "empty", "name": "Empty", "currency": "GBP"}}, []Row{
		{"accountId": "secret-a", "categoryId": "child", "kind": "EXPENSE", "date": "2020-01-01", "amount": "9007199254740993", "description": "=formula"},
		{"accountId": "secret-b", "categoryId": "root", "kind": "INCOME", "date": "2026-10-17", "amount": "29", "description": "Other"},
		{"accountId": "secret-a", "kind": "TRANSFER_OUT", "amount": "10", "description": "Excluded"},
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 3 {
		t.Fatal(len(archive.File))
	}
	for i, file := range archive.File {
		f, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			t.Fatal(err)
		}
		text := string(raw)
		if strings.Contains(text, "secret-") || strings.Contains(text, "Excluded") || !strings.HasPrefix(text, "date,kind,category_id,amount_cents,description\n") {
			t.Fatal(text)
		}
		if i == 0 && (!strings.Contains(file.Name, "EUR") || !strings.Contains(text, "9007199254740993") || !strings.Contains(text, "'=formula") || strings.Contains(text, "Other")) {
			t.Fatal(file.Name, text)
		}
		if i == 1 && (!strings.Contains(file.Name, "USD") || !strings.Contains(text, "Other") || strings.Contains(text, "9007199254740993")) {
			t.Fatal(file.Name, text)
		}
		if i == 2 && text != strings.Join(csvHeader, ",")+"\n" {
			t.Fatal(text)
		}
	}
}

func TestFlatStarterCatalog(t *testing.T) {
	income := "Income;Wages;Interest/dividends;Miscellaneous"
	expense := "Daily Living;Groceries;Dining out;Well-being;Clothes;Recreation;Gifts;Medical Expenses;Health dues;Medicines;Bills & Subscriptions;Phone plan;Digital subscriptions;Education;Home;Rent;Tools & Equipment;Furniture & Repairs;Services;Utilities;Transportation;Public transportation;Gas & Fuel;Insurance;Repairs;Car Wash & Services;Parking & Tolls;Vacations"
	expected := map[string]bool{}
	for kind, names := range map[string]string{"INCOME": income, "EXPENSE": expense} {
		for _, name := range strings.Split(names, ";") {
			expected[kind+":"+name] = true
		}
	}
	if len(starterCatalog) != len(expected) {
		t.Fatalf("starter count %d, want %d", len(starterCatalog), len(expected))
	}
	for _, category := range starterCatalog {
		key := category.kind + ":" + category.name
		if !expected[key] {
			t.Fatalf("unexpected or repeated starter %s", key)
		}
		delete(expected, key)
	}
	if len(expected) != 0 {
		t.Fatal("missing starter categories", expected)
	}
}
