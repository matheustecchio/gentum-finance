# Architecture

Gentum Finance is a local desktop modular monolith: React in a Tauri window → restricted Rust commands → private Go process messages → Go application services → managed PostgreSQL. The public static website is independent.

The installed product opens no application HTTP listener and requires no Docker. PostgreSQL uses generated credentials and a loopback-only ephemeral port. The initial validated installer targets Linux x86_64. See [ADR 0009](decisions/0009-tauri-desktop-application.md).

## Components

- `backend/internal/account`: account domain, service and PostgreSQL repository behind an interface.
- `backend/internal/finance`: wallet snapshot/command service and repository interface, PostgreSQL implementation, exact money/date/CSV rules.
- `backend/internal/security`: verified session identity, local profile selection, optional PIN/recovery transport and session handling.
- `backend/internal/api`: GraphQL transport and thin account/finance resolvers.
- `backend/internal/database`: embedded append-only migrations and legacy Flyway adoption.
- `frontend/src/features/finance`: authenticated feature navigation, forms, dashboard and typed snapshot client.
- `frontend/src/features/accounts/money.ts`: exact decimal-to-cents conversion and display using BigInt.

## Financial boundaries

Money uses signed Go `int64` and PostgreSQL `BIGINT` integer cents: `100 = 1.00`. GraphQL sends exact integer strings, and the browser converts decimal text with `BigInt`. Overflowing balances and monthly totals reject the whole write.

Ownership is obtained from the verified session context. Resource queries and composite foreign keys scope records by owner. A per-owner database row lock serializes financial writes, imports and recurring runs. Linked transfer entries and CSV imports are atomic. Reads use repeatable-read snapshots. PostgreSQL numeric aggregates avoid intermediate BIGINT overflow and are checked before returning or committing; supported money remains signed int64 cents.

GraphQL preserves typed accounts and uses the documented `FinanceData` JSON scalar for the complete finance snapshot plus a constrained `FinanceInput` command object. Monthly report totals and budget spending are authoritative backend values. Currency totals remain separate. No exchange-rate assumptions are introduced.

## Local access

The renderer invokes `backend_start`, `backend_request` and `save_export` through Tauri. Only the trusted main window has those capabilities. Rust checks operation paths, methods, headers and payload size before writing a correlated JSON line to the bundled Go process. Responses are serialized and bounded by a timeout.

`backend/internal/desktop` dispatches allowed operations to the existing authenticated handlers in memory. It supplies the trusted internal Origin and JSON content type, manages a private cookie jar and returns only safe response headers. Session cookies never reach JavaScript. Only the selected-ledger cookie persists across launches; PIN sessions do not.

The original local database remains the registry, with independent physical ledgers and existing per-ledger PIN/recovery/session behavior. Ownership stays server-derived. The financial role cannot create databases or act as a superuser. A separate provisioner creates ledgers. Installation-wide throttling and stale database-ID checks remain in PostgreSQL. The PIN does not encrypt stored data.

Tauri starts the Go process asynchronously. Go initializes or opens its own PostgreSQL 17 cluster, applies the existing checksum-verified migrations and announces readiness. EOF on the private input pipe triggers shutdown. Closing the application preserves data. The public website and native renderer cannot submit arbitrary shell commands or choose database paths.

## Storage

Migrations preserve the original V1/V2 files, convert legacy exact hundredths to BIGINT cents in V3 and add authenticated finance tables in V4. V5 adds one local-access configuration and persistent attempt counters. New wallets use a fresh server-generated owner. Existing password profiles require credential verification only when adoption is explicitly selected; all other owners remain separate. See [ADR 0005](decisions/0005-local-profile-and-optional-pin.md). Desktop PostgreSQL data persists in the platform application data directory across launches. Legacy Docker volumes remain untouched and are not automatically imported.

See [desktop delivery](decisions/0009-tauri-desktop-application.md), [Go and cents](decisions/0003-go-backend-and-integer-cents.md), [MVP boundaries](decisions/0004-authenticated-local-finance-mvp.md) and [API](api/finance.md).

## Reporting

Overview reconstructs owner-scoped native-currency daily balances from opening balances and dated ledger entries in a read-only PostgreSQL transaction. Coverage rules omit unsupported complete totals before undated openings; future entries are excluded. The backend optionally requests ECB reference rates from Frankfurter over HTTPS, sending only currency codes and caching rates for one hour. Exact rational conversion, overflow checks and 30-day differences stay in the finance service. This optional external dependency does not move ledger data off the local machine. See [the Overview API](api/graphql.md).

See [ADR 0008](decisions/0008-multiple-local-databases.md) for database lifecycle, privileges and session selection.
