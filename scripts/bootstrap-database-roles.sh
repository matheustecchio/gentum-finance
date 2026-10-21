#!/bin/sh
# Runs on every local stack startup, including existing PostgreSQL volumes.
set -eu
export PGPASSWORD="$GENTUM_DATABASE_PASSWORD"
psql -v ON_ERROR_STOP=1 -h postgres -U "$GENTUM_DATABASE_USERNAME" -d "$GENTUM_DATABASE_NAME" \
  -v runtime_password="$GENTUM_DATABASE_PASSWORD" -v provision_password="$GENTUM_PROVISION_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE gentum_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gentum_runtime') \gexec
SELECT 'CREATE ROLE gentum_provision LOGIN NOSUPERUSER CREATEDB NOCREATEROLE' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gentum_provision') \gexec
SELECT format('ALTER ROLE gentum_runtime PASSWORD %L', :'runtime_password') \gexec
SELECT format('ALTER ROLE gentum_provision PASSWORD %L', :'provision_password') \gexec
GRANT gentum_runtime TO gentum_provision;
-- Transfer only application-owned objects in this database, not PostgreSQL catalogs.
SELECT format('ALTER TABLE %I.%I OWNER TO gentum_runtime', schemaname, tablename) FROM pg_tables WHERE schemaname='public' \gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO gentum_runtime', sequence_schema, sequence_name) FROM information_schema.sequences WHERE sequence_schema='public' \gexec
SELECT format('ALTER DATABASE %I OWNER TO gentum_runtime', current_database()) \gexec
ALTER SCHEMA public OWNER TO gentum_runtime;
SQL
