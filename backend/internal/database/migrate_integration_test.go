//go:build integration

package database

import (
	"context"
	"fmt"
	"hash/crc32"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/api"
	"gentum.finance/backend/internal/security"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("GENTUM_TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("GENTUM_TEST_DATABASE_URL must point to a disposable PostgreSQL database")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("gentum_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close(); admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); admin.Close() })
	return pool
}

func seedLegacy(t *testing.T, pool *pgxpool.Pool, balance string) {
	t.Helper()
	ctx := context.Background()
	content, _ := migrations.ReadFile("migrations/V1__create_users_and_accounts.sql")
	if _, err := pool.Exec(ctx, string(content)); err != nil {
		t.Fatal(err)
	}
	_, err := pool.Exec(ctx, `CREATE TABLE flyway_schema_history(version VARCHAR(50), checksum INTEGER, success BOOLEAN)`)
	if err != nil {
		t.Fatal(err)
	}
	crc := crc32.NewIEEE()
	for _, line := range strings.Split(string(content), "\n") {
		crc.Write([]byte(line))
	}
	if _, err := pool.Exec(ctx, `INSERT INTO flyway_schema_history VALUES ('1',$1,true)`, int32(crc.Sum32())); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO account VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Existing','CASH','EUR',$1,false,now(),now())`, balance); err != nil {
		t.Fatal(err)
	}
}

func TestLegacyMigrationPreservesCents(t *testing.T) {
	pool := testPool(t)
	seedLegacy(t, pool, "425.5000")
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if err := Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	var balance int64
	if err := pool.QueryRow(ctx, `SELECT initial_balance FROM account`).Scan(&balance); err != nil {
		t.Fatal(err)
	}
	if balance != 42550 {
		t.Fatalf("unexpected cents: %d", balance)
	}
	var table string
	if err := pool.QueryRow(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='gentum_user'`).Scan(&table); err != nil {
		t.Fatal(err)
	}
}

func TestMigrationRejectsFractionalCentsAtomically(t *testing.T) {
	pool := testPool(t)
	seedLegacy(t, pool, "0.0001")
	ctx := context.Background()
	if err := Migrate(ctx, pool); err == nil {
		t.Fatal("accepted fractional cent")
	}
	var balance string
	if err := pool.QueryRow(ctx, `SELECT initial_balance::text FROM account`).Scan(&balance); err != nil {
		t.Fatal(err)
	}
	if balance != "0.0001" {
		t.Fatal("balance changed on failed migration")
	}
	var oldExists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('ledger_user') IS NOT NULL`).Scan(&oldExists); err != nil || !oldExists {
		t.Fatal("migration was not atomic", err)
	}
}

func TestLegacyChecksumMismatch(t *testing.T) {
	pool := testPool(t)
	seedLegacy(t, pool, "1.00")
	if _, err := pool.Exec(context.Background(), `UPDATE flyway_schema_history SET checksum=0`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(context.Background(), pool); err == nil {
		t.Fatal("accepted modified migration")
	}
}

func TestPostgresGraphQLRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	service := account.Service{Repository: account.PostgresRepository{Pool: pool}, CurrentUser: security.DevelopmentCurrentUser{}}
	handler, err := api.NewHandler(service, "http://localhost:5173")
	if err != nil {
		t.Fatal(err)
	}
	for _, cents := range []string{"29", "-1", "9223372036854775807", "-9223372036854775808"} {
		query := fmt.Sprintf(`{"query":"mutation{createAccount(input:{name:\"Test\",type:CASH,currency:\"EUR\",initialBalance:\"%s\"}){id initialBalance}}"}`, cents)
		r := httptest.NewRequest("POST", "/graphql", strings.NewReader(query))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != 200 || strings.Contains(w.Body.String(), `"errors"`) || !strings.Contains(w.Body.String(), `"initialBalance":"`+cents+`"`) {
			t.Fatal(w.Body.String())
		}
	}
	accounts, err := service.List(ctx)
	if err != nil || len(accounts) != 4 {
		t.Fatal(accounts, err)
	}
	rows, err := pool.Query(ctx, `SELECT initial_balance FROM account ORDER BY created_at,id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var n int64
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	// Exercise the HTTP response against the same persisted repository.
	r := httptest.NewRequest("POST", "/graphql", strings.NewReader(`{"query":"{accounts{id initialBalance}}"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	body, _ := io.ReadAll(w.Result().Body)
	if strings.Contains(string(body), `"errors"`) || !strings.Contains(string(body), `9223372036854775807`) {
		t.Fatal(string(body))
	}
}

func TestGoMigrationChecksumMismatch(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE gentum_schema_migration SET checksum='modified' WHERE version=1`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, pool); err == nil {
		t.Fatal("accepted modified Go migration")
	}
}

func TestPostgresOwnershipScope(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	repository := account.PostgresRepository{Pool: pool}
	service := account.Service{Repository: repository, CurrentUser: security.DevelopmentCurrentUser{}}
	if _, err := service.Create(ctx, account.Input{Name: "Private", Type: "CASH", Currency: "EUR", InitialBalance: 100}); err != nil {
		t.Fatal(err)
	}
	others, err := repository.List(ctx, "00000000-0000-0000-0000-000000000099")
	if err != nil || len(others) != 0 {
		t.Fatalf("cross-user accounts: %v, %v", others, err)
	}
}

func TestDatabaseRegistryUpgradePreservesCategoryColorsAndAccess(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	// Reconstruct the released V9 schema before adding registry metadata.
	if _, err := pool.Exec(ctx, `DROP TABLE local_database_selection,local_database,local_installation_attempt; DELETE FROM gentum_schema_migration WHERE version=10;
 INSERT INTO category(id,user_id,name,kind,color) VALUES('00000000-0000-0000-0000-000000007777','00000000-0000-0000-0000-000000000001','Upgrade fixture','EXPENSE','#123456');
 INSERT INTO local_access(singleton,user_id,pin_salt,pin_hash,recovery_hash) VALUES(true,'00000000-0000-0000-0000-000000000001','original-salt','original-pin','original-recovery')`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	var color, salt, pin, recovery string
	if err := pool.QueryRow(ctx, `SELECT c.color,l.pin_salt,l.pin_hash,l.recovery_hash FROM category c CROSS JOIN local_access l WHERE c.id='00000000-0000-0000-0000-000000007777'`).Scan(&color, &salt, &pin, &recovery); err != nil {
		t.Fatal(err)
	}
	if color != "#123456" || salt != "original-salt" || pin != "original-pin" || recovery != "original-recovery" {
		t.Fatal("upgrade changed existing category or access settings", color, salt, pin, recovery)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM gentum_schema_migration WHERE version IN (9,10)`).Scan(&count); err != nil || count != 2 {
		t.Fatal("missing migration versions", count, err)
	}
}
