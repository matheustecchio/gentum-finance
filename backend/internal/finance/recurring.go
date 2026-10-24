package finance

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func nextOccurrence(t time.Time, frequency string, day, month int) time.Time {
	switch frequency {
	case "weekly":
		return t.AddDate(0, 0, 7)
	case "fortnightly":
		return t.AddDate(0, 0, 14)
	case "yearly":
		first := time.Date(t.Year()+1, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
		return first.AddDate(0, 0, min(day, first.AddDate(0, 1, -1).Day())-1)
	default:
		return nextMonth(t, day)
	}
}

func saveRecurring(ctx context.Context, tx pgx.Tx, user, action string, in Row) error {
	if in["frequency"] == "" {
		in["frequency"] = "monthly"
	}
	if in["mode"] == "" {
		in["mode"] = "manual"
	}
	switch in["frequency"] {
	case "weekly", "fortnightly", "monthly", "yearly":
	default:
		return invalid("Choose a supported frequency")
	}
	if in["mode"] != "manual" && in["mode"] != "automatic" {
		return invalid("Choose automatic entry or confirmation")
	}
	t, err := date(in["date"])
	if err != nil {
		return err
	}
	amount, err := validateEntry(ctx, tx, user, in)
	if err != nil {
		return err
	}
	if action == "recurring" {
		_, err = tx.Exec(ctx, `INSERT INTO recurring(id,user_id,account_id,category_id,kind,amount,description,next_date,anchor_day,anchor_month,frequency,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, newID(), user, in["accountId"], in["categoryId"], in["kind"], amount, strings.TrimSpace(in["description"]), t, t.Day(), int(t.Month()), in["frequency"], in["mode"])
		return err
	}
	// Pending occurrences are frozen snapshots. Editing the series affects only
	// dates not processed yet and cannot rewind across an existing occurrence.
	anchorDay, anchorMonth := t.Day(), int(t.Month())
	var previousDate, previousFrequency string
	var previousDay, previousMonth int
	err = tx.QueryRow(ctx, `SELECT next_date::text,frequency,anchor_day,anchor_month FROM recurring WHERE user_id=$1 AND id::text=$2`, user, in["id"]).Scan(&previousDate, &previousFrequency, &previousDay, &previousMonth)
	if err != nil {
		return invalid("Schedule not found")
	}
	if previousDate == in["date"] && previousFrequency == in["frequency"] {
		anchorDay, anchorMonth = previousDay, previousMonth
	}
	var latest string
	err = tx.QueryRow(ctx, `SELECT COALESCE(max(due_date)::text,'') FROM recurring_occurrence WHERE user_id=$1 AND recurring_id::text=$2`, user, in["id"]).Scan(&latest)
	if err != nil {
		return err
	}
	if latest != "" && in["date"] <= latest {
		return invalid("Next occurrence must be after the last processed date. Edit a pending occurrence separately")
	}
	res, err := tx.Exec(ctx, `UPDATE recurring SET account_id=$3,category_id=$4,kind=$5,amount=$6,description=$7,next_date=$8,anchor_day=$9,anchor_month=$10,frequency=$11,mode=$12 WHERE user_id=$1 AND id::text=$2`, user, in["id"], in["accountId"], in["categoryId"], in["kind"], amount, strings.TrimSpace(in["description"]), t, anchorDay, anchorMonth, in["frequency"], in["mode"])
	if err == nil && res.RowsAffected() != 1 {
		return invalid("Schedule not found")
	}
	return err
}

const occurrenceColumns = `o.id::text,o.recurring_id::text,to_char(o.due_date,'YYYY-MM-DD'),o.account_id::text,o.category_id::text,o.kind,o.amount::text,o.description,o.status,o.entry_id::text`

var occurrenceKeys = []string{"id", "recurringId", "date", "accountId", "categoryId", "kind", "amount", "description", "status", "entryId"}

func recurringOccurrences(ctx context.Context, q queryer, user string, schedules []Row, now time.Time) ([]Row, error) {
	out, err := rows(ctx, q, `SELECT `+occurrenceColumns+` FROM recurring_occurrence o WHERE o.user_id=$1 AND (o.status='pending' OR o.due_date >= $2::date - 90) ORDER BY o.due_date,o.id`, occurrenceKeys, user, now.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	horizon := now.AddDate(0, 0, 90).Format("2006-01-02")
	for _, s := range schedules {
		if s["active"] != "true" {
			continue
		}
		t, _ := date(s["nextDate"])
		day, _ := strconv.Atoi(s["anchorDay"])
		month, _ := strconv.Atoi(s["anchorMonth"])
		for count := 0; count < 14 && t.Format("2006-01-02") <= horizon; count++ {
			item := Row{}
			for k, v := range s {
				item[k] = v
			}
			item["id"] = ""
			item["recurringId"] = s["id"]
			item["date"] = t.Format("2006-01-02")
			item["status"] = "upcoming"
			out = append(out, item)
			t = nextOccurrence(t, s["frequency"], day, month)
		}
	}
	return out, nil
}

func processRecurring(ctx context.Context, tx pgx.Tx, user string, now time.Time, legacy bool) error {
	today := now.Format("2006-01-02")
	schedules, err := rows(ctx, tx, `SELECT id::text,account_id::text,category_id::text,kind,amount::text,description,to_char(next_date,'YYYY-MM-DD'),anchor_day::text,anchor_month::text,frequency,mode FROM recurring WHERE user_id=$1 AND active AND next_date<=$2::date ORDER BY next_date,id FOR UPDATE`, []string{"id", "accountId", "categoryId", "kind", "amount", "description", "date", "anchorDay", "anchorMonth", "frequency", "mode"}, user, today)
	if err != nil {
		return err
	}
	count := 0
	for _, s := range schedules {
		t, _ := date(s["date"])
		day, _ := strconv.Atoi(s["anchorDay"])
		month, _ := strconv.Atoi(s["anchorMonth"])
		for t.Format("2006-01-02") <= today && count < 1000 {
			due := t.Format("2006-01-02")
			id := newID()
			_, err = tx.Exec(ctx, `INSERT INTO recurring_occurrence(id,user_id,recurring_id,due_date,account_id,category_id,kind,amount,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(recurring_id,due_date) DO NOTHING`, id, user, s["id"], due, s["accountId"], s["categoryId"], s["kind"], s["amount"], s["description"])
			if err != nil {
				return err
			}
			var status string
			err = tx.QueryRow(ctx, `SELECT id::text,status FROM recurring_occurrence WHERE user_id=$1 AND recurring_id=$2 AND due_date=$3`, user, s["id"], due).Scan(&id, &status)
			if err != nil {
				return err
			}
			if status == "pending" {
				// An imported/manual record may already exist before the app catches up.
				candidates, e := rows(ctx, tx, `SELECT e.id::text FROM entry e WHERE e.user_id=$1 AND e.recurring_id IS NULL AND e.account_id::text=$2 AND e.category_id::text=$3 AND e.kind=$4 AND e.amount=$5 AND lower(btrim(e.description))=lower(btrim($6)) AND btrim($6)<>'' AND e.entry_date BETWEEN $7::date-3 AND $7::date+3 AND NOT EXISTS(SELECT 1 FROM recurring_occurrence o WHERE o.entry_id=e.id) LIMIT 2`, []string{"id"}, user, s["accountId"], s["categoryId"], s["kind"], s["amount"], s["description"], due)
				if e != nil {
					return e
				}
				// Ambiguous records require review, even for an automatic schedule.
				if len(candidates) == 1 {
					err = linkOccurrence(ctx, tx, user, id, candidates[0]["id"])
				} else if len(candidates) == 0 && (s["mode"] == "automatic" || legacy) {
					err = postOccurrence(ctx, tx, user, id)
				}
				if err != nil {
					return err
				}
			}
			count++
			t = nextOccurrence(t, s["frequency"], day, month)
		}
		_, err = tx.Exec(ctx, `UPDATE recurring SET next_date=$3 WHERE user_id=$1 AND id=$2`, user, s["id"], t)
		if err != nil {
			return err
		}
		if count >= 1000 {
			break
		}
	}
	return nil
}

func occurrence(ctx context.Context, tx pgx.Tx, user, id string) (Row, error) {
	items, err := rows(ctx, tx, `SELECT `+occurrenceColumns+` FROM recurring_occurrence o WHERE o.user_id=$1 AND o.id::text=$2 FOR UPDATE`, occurrenceKeys, user, id)
	if err != nil {
		return nil, err
	}
	if len(items) != 1 {
		return nil, invalid("Occurrence not found")
	}
	return items[0], nil
}
func postOccurrence(ctx context.Context, tx pgx.Tx, user, id string) error {
	o, err := occurrence(ctx, tx, user, id)
	if err != nil {
		return err
	}
	if o["status"] != "pending" {
		return invalid("Only pending occurrences can be confirmed")
	}
	amount, err := validateEntry(ctx, tx, user, o)
	if err != nil {
		return err
	}
	entry := newID()
	_, err = tx.Exec(ctx, `INSERT INTO entry(id,user_id,account_id,category_id,kind,amount,description,entry_date,recurring_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, entry, user, o["accountId"], o["categoryId"], o["kind"], amount, o["description"], o["date"], o["recurringId"])
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE recurring_occurrence SET status='posted',entry_id=$3 WHERE user_id=$1 AND id::text=$2`, user, id, entry)
	return err
}
func linkOccurrence(ctx context.Context, tx pgx.Tx, user, id, entry string) error {
	o, err := occurrence(ctx, tx, user, id)
	if err != nil {
		return err
	}
	if o["status"] != "pending" && o["status"] != "posted" {
		return invalid("Only pending or posted occurrences can be linked")
	}
	var amount, desc, day, kind, account, category string
	err = tx.QueryRow(ctx, `SELECT amount::text,description,entry_date::text,kind,account_id::text,category_id::text FROM entry WHERE user_id=$1 AND id::text=$2 AND recurring_id IS NULL AND transfer_id IS NULL AND NOT EXISTS(SELECT 1 FROM recurring_occurrence WHERE entry_id=entry.id) FOR UPDATE`, user, entry).Scan(&amount, &desc, &day, &kind, &account, &category)
	if err != nil {
		return invalid("Choose an unlinked transaction in this account")
	}
	if account != o["accountId"] || kind != o["kind"] {
		return invalid("Transaction account and kind must match the occurrence")
	}
	// Keep the actual transaction's date, category and amount authoritative.
	_, err = tx.Exec(ctx, `UPDATE recurring_occurrence SET status='linked',entry_id=$3,amount=$4,description=$5,category_id=$6 WHERE user_id=$1 AND id::text=$2`, user, id, entry, amount, desc, category)
	if err != nil {
		return err
	}
	if o["entryId"] != "" {
		_, err = tx.Exec(ctx, `DELETE FROM entry WHERE user_id=$1 AND id::text=$2 AND recurring_id::text=$3`, user, o["entryId"], o["recurringId"])
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE entry SET recurring_id=$3 WHERE user_id=$1 AND id::text=$2`, user, entry, o["recurringId"])
	return err
}
func updateOccurrence(ctx context.Context, tx pgx.Tx, user, action string, in Row) error {
	o, err := occurrence(ctx, tx, user, in["occurrenceId"])
	if err != nil {
		return err
	}
	if action == "linkOccurrence" {
		return linkOccurrence(ctx, tx, user, o["id"], in["entryId"])
	}
	if o["status"] != "pending" {
		return invalid("Only pending occurrences can be changed")
	}
	if action == "skipOccurrence" {
		_, err = tx.Exec(ctx, `UPDATE recurring_occurrence SET status='skipped' WHERE user_id=$1 AND id::text=$2`, user, o["id"])
		return err
	}
	if action == "editOccurrence" || in["amount"] != "" {
		if in["amount"] != "" {
			o["amount"] = in["amount"]
		}
		if _, ok := in["description"]; ok {
			o["description"] = in["description"]
		}
		if _, err = positive(o["amount"]); err != nil {
			return err
		}
		if _, err = description(o["description"]); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE recurring_occurrence SET amount=$3,description=$4 WHERE user_id=$1 AND id::text=$2`, user, o["id"], o["amount"], strings.TrimSpace(o["description"]))
		if err != nil {
			return err
		}
	}
	if action == "confirmOccurrence" {
		return postOccurrence(ctx, tx, user, o["id"])
	}
	return nil
}
