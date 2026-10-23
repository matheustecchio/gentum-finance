// Package finance owns the local ledger, schedules, budgets and portable CSV contract.
package finance

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/csv"
	"fmt"
	"io"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Row map[string]string
type Snapshot struct {
	Breakdown  []Row `json:"breakdown"`
	Accounts   []Row `json:"accounts"`
	Categories []Row `json:"categories"`
	Entries    []Row `json:"entries"`
	Budgets    []Row `json:"budgets"`
	Recurring  []Row `json:"recurring"`
	Totals     []Row `json:"totals"`
}
type Repository interface {
	Snapshot(context.Context, string, string) (Snapshot, error)
	Execute(context.Context, string, string, Row) (string, error)
}
type Service struct {
	Rates       RateSource
	Now         func() time.Time
	Repository  Repository
	CurrentUser interface {
		UserID(context.Context) (string, error)
	}
}

func (s Service) Snapshot(ctx context.Context, month string) (Snapshot, error) {
	if !validMonth(month) {
		return Snapshot{}, invalid("Use a month as YYYY-MM")
	}
	id, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	return s.Repository.Snapshot(ctx, id, month)
}
func (s Service) Execute(ctx context.Context, action string, input Row) (string, error) {
	id, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return "", err
	}
	return s.Repository.Execute(ctx, id, action, input)
}
func validMonth(s string) bool {
	t, e := time.Parse("2006-01", s)
	return e == nil && t.Format("2006-01") == s
}
func date(s string) (time.Time, error) {
	t, e := time.Parse("2006-01-02", s)
	if e != nil || t.Year() < 1900 || t.Year() > 9998 {
		return time.Time{}, invalid("Use a date between 1900 and 9998 as YYYY-MM-DD")
	}
	return t, nil
}
func positive(s string) (int64, error) {
	if !regexp.MustCompile(`^[1-9][0-9]*$`).MatchString(s) {
		return 0, invalid("Amount must be positive integer cents")
	}
	v, e := strconv.ParseInt(s, 10, 64)
	if e != nil {
		return 0, invalid("Amount exceeds integer cents range")
	}
	return v, nil
}
func checked(s string) (string, error) {
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || !n.IsInt64() {
		return "", invalid("Result exceeds integer cents range")
	}
	return n.String(), nil
}
func description(s string) (string, error) {
	s = strings.TrimSpace(s)
	if len([]rune(s)) > 200 {
		return "", invalid("Description must be at most 200 characters")
	}
	return s, nil
}
func nextMonth(t time.Time, day int) time.Time {
	first := time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1).Day()
	if day > last {
		day = last
	}
	return first.AddDate(0, 0, day-1)
}

const MaxImportRows = 100000
const MaxImportBytes = 32 * 1024 * 1024

var csvHeader = []string{"date", "kind", "category_id", "amount_cents", "description"}
var legacyCSVHeader = []string{"date", "account_id", "category_id", "kind", "amount_cents", "description"}

func parseCSV(raw string) ([]Row, error) {
	if len(raw) > MaxImportBytes {
		return nil, invalid("Use a CSV of at most 32 MiB")
	}
	r := csv.NewReader(strings.NewReader(raw))
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if err != nil || (strings.Join(header, ",") != strings.Join(csvHeader, ",") && strings.Join(header, ",") != strings.Join(legacyCSVHeader, ",")) {
		return nil, csvRecordError(1, invalid("Use the documented CSV header"))
	}
	r.FieldsPerRecord = len(header)
	var rows []Row
	for {
		values, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, csvRecordError(len(rows)+2, invalid("Malformed CSV record: "+err.Error()))
		}
		if len(rows) >= MaxImportRows {
			return nil, csvRecordError(len(rows)+2, invalid("Import supports up to 100000 rows"))
		}
		row := Row{}
		for i, key := range header {
			row[key] = values[i]
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return nil, invalid("CSV must contain a transaction")
	}
	return rows, nil
}
func safeCell(s string) string {
	trim := strings.TrimLeft(s, " \t\r\n")
	if strings.HasPrefix(s, "'") || strings.ContainsAny(s[:min(len(s), 1)], "\t\r\n") || strings.HasPrefix(trim, "=") || strings.HasPrefix(trim, "+") || strings.HasPrefix(trim, "-") || strings.HasPrefix(trim, "@") {
		return "'" + s
	}
	return s
}
func exportCSV(entries []Row) string {
	var b strings.Builder
	w := csv.NewWriter(&b)
	w.Write(csvHeader)
	for _, e := range entries {
		if e["kind"] != "INCOME" && e["kind"] != "EXPENSE" {
			continue
		}
		values := []string{e["date"], e["kind"], e["categoryId"], e["amount"], safeCell(e["description"])}
		w.Write(values)
	}
	w.Flush()
	return b.String()
}
func newID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type ValidationError string

func (e ValidationError) Error() string { return string(e) }
func invalid(s string) error            { return ValidationError(s) }

// exportAccounts returns one CSV per account in a ZIP; all dates are retained.
// An ordinal keeps even duplicate account names distinct without exposing IDs.
func exportAccounts(accounts, entries []Row) (string, error) {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for i, a := range accounts {
		name := strings.Map(func(r rune) rune {
			if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
				return r
			}
			return '_'
		}, a["name"])
		f, err := z.Create(fmt.Sprintf("%02d-%s-%s.csv", i+1, name, a["currency"]))
		if err != nil {
			return "", err
		}
		subset := []Row{}
		for _, e := range entries {
			if e["accountId"] == a["id"] {
				subset = append(subset, e)
			}
		}
		if _, err = io.WriteString(f, exportCSV(subset)); err != nil {
			return "", err
		}
	}
	if err := z.Close(); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b.Bytes()), nil
}
