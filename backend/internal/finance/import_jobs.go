package finance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ImportJob struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Total     int    `json:"total"`
	Processed int    `json:"processed"`
	Message   string `json:"message"`
}
type importJobRepository interface {
	ImportJob(context.Context, string, string, Row) (ImportJob, error)
}

func (s Service) ImportJob(ctx context.Context, action string, in Row) (ImportJob, error) {
	user, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return ImportJob{}, err
	}
	repo, ok := s.Repository.(importJobRepository)
	if !ok {
		return ImportJob{}, invalid("CSV imports unavailable")
	}
	return repo.ImportJob(ctx, user, action, in)
}

// Workers are scoped to the physical pool and authenticated owner. A restarted
// sidecar has no live workers: PostgreSQL rolled back their open transactions.
var importWorkers = struct {
	sync.Mutex
	active map[string]context.CancelFunc
}{active: map[string]context.CancelFunc{}}
var importID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func workerKey(pool *pgxpool.Pool, user, id string) string {
	return fmt.Sprintf("%p/%s/%s", pool, user, id)
}
func readImportJob(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, user, id string) (j ImportJob, err error) {
	err = q.QueryRow(ctx, `SELECT id::text,status,total,processed,message FROM csv_import_job WHERE user_id=$1 AND id=$2`, user, id).Scan(&j.ID, &j.Status, &j.Total, &j.Processed, &j.Message)
	if errors.Is(err, pgx.ErrNoRows) {
		err = invalid("Import operation not found")
	}
	return
}
func (r PostgresRepository) ImportJob(ctx context.Context, user, action string, in Row) (ImportJob, error) {
	id := in["id"]
	requestID := id
	if !importID.MatchString(id) {
		return ImportJob{}, invalid("Use a valid import operation ID")
	}
	importWorkers.Lock()
	defer importWorkers.Unlock()
	if action == "start" {
		data, err := parseCSV(in["csv"])
		if err != nil {
			return ImportJob{}, err
		}
		hash := sha256.Sum256([]byte(in["accountId"] + "\x00" + in["csv"]))
		fingerprint := hex.EncodeToString(hash[:])
		// An operation ID cannot be reused for another payload, even after failure.
		var previous string
		err = r.Pool.QueryRow(ctx, `SELECT j.fingerprint FROM csv_import_job j JOIN csv_import_request q ON q.job_id=j.id AND q.user_id=j.user_id WHERE q.user_id=$1 AND q.request_id=$2`, user, id).Scan(&previous)
		if err == nil {
			if previous != fingerprint {
				return ImportJob{}, invalid("Import operation belongs to another file")
			}
			return r.requestImport(ctx, user, requestID)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return ImportJob{}, err
		}
		// Identical successful files and simultaneous requests share one operation.
		var existing string
		err = r.Pool.QueryRow(ctx, `SELECT id::text FROM csv_import_job WHERE user_id=$1 AND fingerprint=$2 AND status IN ('running','committed')`, user, fingerprint).Scan(&existing)
		if err == nil {
			if _, err = r.Pool.Exec(ctx, `INSERT INTO csv_import_request(user_id,request_id,job_id) VALUES($1,$2,$3)`, user, requestID, existing); err != nil {
				return ImportJob{}, err
			}
			return r.requestImport(ctx, user, requestID)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return ImportJob{}, err
		}
		var running bool
		if err = r.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM csv_import_job WHERE user_id=$1 AND status='running')`, user).Scan(&running); err != nil {
			return ImportJob{}, err
		}
		if running {
			return ImportJob{}, invalid("Another import is running. Check its result before starting a new file")
		}
		intent, err := r.Pool.Begin(ctx)
		if err != nil {
			return ImportJob{}, err
		}
		defer intent.Rollback(ctx)
		if _, err = intent.Exec(ctx, `INSERT INTO csv_import_job(id,user_id,fingerprint,status,total) VALUES($1,$2,$3,'running',$4)`, id, user, fingerprint, len(data)); err != nil {
			return ImportJob{}, err
		}
		if _, err = intent.Exec(ctx, `INSERT INTO csv_import_request(user_id,request_id,job_id) VALUES($1,$2,$3)`, user, requestID, id); err != nil {
			return ImportJob{}, err
		}
		if err = intent.Commit(ctx); err != nil {
			return ImportJob{}, err
		}
		key := workerKey(r.Pool, user, id)
		workerCtx, stop := context.WithTimeout(context.Background(), 10*time.Minute)
		importWorkers.active[key] = stop
		go func() {
			defer stop()
			defer func() { importWorkers.Lock(); delete(importWorkers.active, key); importWorkers.Unlock() }()
			r.runImport(workerCtx, user, id, in["accountId"], data)
		}()
		return ImportJob{ID: id, Status: "running", Total: len(data)}, nil
	}
	if err := r.Pool.QueryRow(ctx, `SELECT job_id::text FROM csv_import_request WHERE user_id=$1 AND request_id=$2`, user, requestID).Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ImportJob{ID: requestID, Status: "failed", Message: "No import operation was started. No transactions saved."}, nil
		}
		return ImportJob{}, err
	}
	if action == "cancel" {
		_, err := r.Pool.Exec(ctx, `UPDATE csv_import_job SET cancel_requested=true,updated_at=now() WHERE user_id=$1 AND id=$2 AND status='running'`, user, id)
		if err != nil {
			return ImportJob{}, err
		}
		if stop := importWorkers.active[workerKey(r.Pool, user, id)]; stop != nil {
			stop()
		}
	} else if action != "status" {
		return ImportJob{}, invalid("Unknown import operation")
	}
	return r.requestImport(ctx, user, requestID)
}
func (r PostgresRepository) requestImport(ctx context.Context, user, requestID string) (ImportJob, error) {
	var id string
	if err := r.Pool.QueryRow(ctx, `SELECT job_id::text FROM csv_import_request WHERE user_id=$1 AND request_id=$2`, user, requestID).Scan(&id); err != nil {
		return ImportJob{}, err
	}
	j, err := r.recoverImport(ctx, user, id)
	j.ID = requestID
	return j, err
}
func (r PostgresRepository) recoverImport(ctx context.Context, user, id string) (ImportJob, error) {
	if importWorkers.active[workerKey(r.Pool, user, id)] == nil {
		// The terminal marker and ledger entries commit together. Only a still-running
		// marker can be declared interrupted; never overwrite a committed result.
		_, err := r.Pool.Exec(ctx, `UPDATE csv_import_job SET status='failed',message='Import interrupted. No transactions saved. You can retry the complete file.',updated_at=now() WHERE user_id=$1 AND id=$2 AND status='running'`, user, id)
		if err != nil {
			return ImportJob{}, err
		}
	}
	return readImportJob(ctx, r.Pool, user, id)
}
func (r PostgresRepository) runImport(ctx context.Context, user, id, account string, data []Row) {
	err := r.writeImport(ctx, user, id, account, data)
	if err == nil {
		return
	}
	// The write transaction has rolled back before the terminal failure is visible.
	cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	status, message := "failed", "Import failed. No transactions saved. Retry the complete file."
	var validation ValidationError
	if errors.As(err, &validation) {
		message = validation.Error() + ". No transactions saved."
	}
	var requested bool
	r.Pool.QueryRow(cleanup, `SELECT cancel_requested FROM csv_import_job WHERE user_id=$1 AND id=$2`, user, id).Scan(&requested)
	if requested || errors.Is(err, errImportCancelled) {
		status = "cancelled"
		message = "Import cancelled. No transactions saved."
	}
	// A lost commit acknowledgement must not turn a successful operation into a
	// reported rollback. This update cannot overwrite the committed marker.
	r.Pool.Exec(cleanup, `UPDATE csv_import_job SET status=$3,message=$4,updated_at=now() WHERE user_id=$1 AND id=$2 AND status='running'`, user, id, status, message)
}

var errImportCancelled = errors.New("import cancelled")

func (r PostgresRepository) writeImport(ctx context.Context, user, id, account string, data []Row) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `SELECT id FROM gentum_user WHERE id=$1 FOR UPDATE`, user); err != nil {
		return err
	}
	// Resolve ownership once per import instead of issuing 100,000 validation queries.
	as, err := rows(ctx, tx, `SELECT id::text FROM account WHERE user_id=$1 AND NOT archived`, []string{"id"}, user)
	if err != nil {
		return err
	}
	cs, err := rows(ctx, tx, `SELECT id::text,kind FROM category WHERE user_id=$1`, []string{"id", "kind"}, user)
	if err != nil {
		return err
	}
	accounts, categories := map[string]bool{}, map[string]string{}
	for _, a := range as {
		accounts[a["id"]] = true
	}
	for _, c := range cs {
		categories[c["id"]] = c["kind"]
	}
	for start := 0; start < len(data); start += 1000 {
		var cancelled bool
		if err = r.Pool.QueryRow(ctx, `SELECT cancel_requested FROM csv_import_job WHERE user_id=$1 AND id=$2`, user, id).Scan(&cancelled); err != nil {
			return err
		}
		if cancelled {
			return errImportCancelled
		}
		end := min(start+1000, len(data))
		batch := make([][]any, 0, end-start)
		for i := start; i < end; i++ {
			row := importRow(data[i], account)
			amount, e := validateEntryValues(row)
			if e == nil && (!accounts[row["accountId"]] || categories[row["categoryId"]] != row["kind"]) {
				e = invalid("Choose your account and a category matching the transaction kind")
			}
			if e != nil {
				return csvRecordError(i+2, e)
			}
			day, _ := date(row["date"])
			batch = append(batch, []any{newID(), user, row["accountId"], row["categoryId"], row["kind"], amount, strings.TrimSpace(row["description"]), day})
		}
		_, err = tx.CopyFrom(ctx, pgx.Identifier{"entry"}, []string{"id", "user_id", "account_id", "category_id", "kind", "amount", "description", "entry_date"}, pgx.CopyFromRows(batch))
		if err != nil {
			return err
		}
		if _, err = r.Pool.Exec(ctx, `UPDATE csv_import_job SET processed=$3,updated_at=now() WHERE user_id=$1 AND id=$2`, user, id, end); err != nil {
			return err
		}
	}
	if err = checkBalances(ctx, tx, user); err != nil {
		return err
	}
	// Lock the operation only at finalization. Cancellation and commit are ordered
	// by this row lock: cancellation either wins, or sees an already committed job.
	var cancelled bool
	if err = tx.QueryRow(ctx, `SELECT cancel_requested FROM csv_import_job WHERE user_id=$1 AND id=$2 FOR UPDATE`, user, id).Scan(&cancelled); err != nil {
		return err
	}
	if cancelled {
		return errImportCancelled
	}
	if _, err = tx.Exec(ctx, `UPDATE csv_import_job SET status='committed',message=$3,updated_at=now() WHERE user_id=$1 AND id=$2`, user, id, fmt.Sprintf("Imported %d transactions", len(data))); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
