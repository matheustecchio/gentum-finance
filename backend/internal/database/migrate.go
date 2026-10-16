// Package database applies embedded, append-only PostgreSQL migrations.
package database

import (
	"bufio"
	"context"
	"crypto/sha256"
	"embed"
	"fmt"
	"hash/crc32"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Migrate adopts successful Flyway V1/V2 entries only after verifying their
// original checksums. All changes, including adoption, are atomic and serialized.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(73195021)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS gentum_schema_migration (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	var legacy bool
	if err = tx.QueryRow(ctx, `SELECT to_regclass('flyway_schema_history') IS NOT NULL`).Scan(&legacy); err != nil {
		return err
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		versionText := strings.Split(strings.TrimPrefix(entry.Name(), "V"), "__")[0]
		version, err := strconv.Atoi(versionText)
		if err != nil {
			return err
		}
		content, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		checksum := fmt.Sprintf("%x", sha256.Sum256(content))
		var count int
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM gentum_schema_migration WHERE version=$1`, version).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			var stored string
			if err = tx.QueryRow(ctx, `SELECT checksum FROM gentum_schema_migration WHERE version=$1`, version).Scan(&stored); err != nil {
				return err
			}
			if stored != checksum {
				return fmt.Errorf("migration V%d checksum mismatch", version)
			}
			continue
		}
		adopted := false
		if legacy {
			if err = tx.QueryRow(ctx, `SELECT count(*) FROM flyway_schema_history WHERE version=$1`, versionText).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				var success bool
				var stored int32
				if err = tx.QueryRow(ctx, `SELECT success, checksum FROM flyway_schema_history WHERE version=$1`, versionText).Scan(&success, &stored); err != nil {
					return err
				}
				crc := crc32.NewIEEE()
				scanner := bufio.NewScanner(strings.NewReader(strings.TrimPrefix(string(content), "\ufeff")))
				for scanner.Scan() {
					crc.Write(scanner.Bytes())
				}
				if err = scanner.Err(); err != nil {
					return err
				}
				if !success || stored != int32(crc.Sum32()) {
					return fmt.Errorf("legacy migration V%d failed or checksum mismatch", version)
				}
				adopted = true
			}
		}
		if !adopted {
			if _, err = tx.Exec(ctx, string(content)); err != nil {
				return fmt.Errorf("migration V%d: %w", version, err)
			}
		}
		if _, err = tx.Exec(ctx, `INSERT INTO gentum_schema_migration(version,checksum) VALUES ($1,$2)`, version, checksum); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
