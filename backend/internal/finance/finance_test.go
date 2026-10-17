package finance

import (
	"strings"
	"testing"
	"time"
)

func TestExactMoneyAndOverflow(t *testing.T) {
	for _, s := range []string{"1", "29", "9007199254740993", "9223372036854775807"} {
		if _, e := positive(s); e != nil {
			t.Fatal(s, e)
		}
	}
	for _, s := range []string{"0", "-1", "0.29", "1e3", "01", "9223372036854775808"} {
		if _, e := positive(s); e == nil {
			t.Fatal("accepted", s)
		}
	}
	if _, e := checked("-9223372036854775809"); e == nil {
		t.Fatal("accepted aggregate overflow")
	}
}
func TestRecurringMonthEnd(t *testing.T) {
	d, _ := date("2024-01-31")
	d = nextMonth(d, 31)
	if d.Format("2006-01-02") != "2024-02-29" {
		t.Fatal(d)
	}
	d = nextMonth(d, 31)
	if d.Format("2006-01-02") != "2024-03-31" {
		t.Fatal(d)
	}
	if _, e := date("2026-02-29"); e == nil {
		t.Fatal("accepted invalid date")
	}
	if nextMonth(time.Date(2025, 1, 30, 0, 0, 0, 0, time.UTC), 30).Day() != 28 {
		t.Fatal("month end")
	}
}
func TestCSVValidationAndFormulaEscaping(t *testing.T) {
	header := strings.Join(csvHeader, ",") + "\n"
	for _, raw := range []string{"", header, header + "bad,row\n", "date,amount\n"} {
		if _, e := parseCSV(raw); e == nil {
			t.Fatal("accepted invalid CSV")
		}
	}
	rows, e := parseCSV(header + "2026-10-16,EXPENSE,category,29,\"quoted, value\"\n")
	if e != nil || rows[0]["description"] != "quoted, value" {
		t.Fatal(rows, e)
	}
	for _, text := range []string{"=SUM(1,2)", " +cmd", "-cmd", "@cmd", "\tformula", "'literal"} {
		out := exportCSV([]Row{{"kind": "EXPENSE", "description": text, "amount": "29"}})
		if !strings.Contains(out, "'"+text) {
			t.Fatal(out)
		}
	}
}
