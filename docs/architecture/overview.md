# Architecture

Gentum Finance is a local-first modular monolith: React browser UI → same-origin nginx → Go GraphQL/application services → PostgreSQL. Docker Compose runs the three services locally; only nginx publishes a loopback port.

- `backend/internal/account`: account domain, service and PostgreSQL repository behind an interface.
- `backend/internal/finance`: wallet snapshot/command service and repository interface, PostgreSQL implementation, exact money/date/CSV rules.
- `backend/internal/security`: verified session identity, local profile selection, optional PIN/recovery transport and session handling.
- `backend/internal/api`: GraphQL transport and thin account/finance resolvers.
- `backend/internal/database`: embedded append-only migrations and legacy Flyway adoption.
- `frontend/src/features/finance`: authenticated feature navigation, forms, dashboard and typed snapshot client.
- `frontend/src/features/accounts/money.ts`: exact decimal-to-cents conversion and display using BigInt.

Ownership is obtained from the verified session context. Resource queries and composite foreign keys scope records by owner. A per-owner database row lock serializes financial writes, imports and recurring runs. Linked transfer entries and CSV imports are atomic. Reads use repeatable-read snapshots. PostgreSQL numeric aggregates avoid intermediate BIGINT overflow and are checked before returning or committing; supported money remains signed int64 cents.

GraphQL preserves typed accounts and uses the documented `FinanceData` JSON scalar for the complete finance snapshot plus a constrained `FinanceInput` command object. Monthly report totals and budget spending are authoritative backend values. Currency totals remain separate. No exchange-rate assumptions are introduced.

The browser talks only to same-origin routes. Cookie sessions use hashed opaque tokens, browser-session cookies and 24-hour server expiry. Local setup selects one wallet, with direct access or optional four-digit PIN. PIN derivation uses PBKDF2-SHA256; recovery codes are randomly generated and stored as digests. Locking and protection changes revoke previous sessions. Attempt counters and progressive waits are persisted in PostgreSQL. Mutation Origin checks and JSON-only requests protect against CSRF; response CSP and frame restrictions reduce browser exposure. Local HTTP omits Secure cookies intentionally. This architecture is intended for trusted loopback operation, without public hosting or bank credentials.

Migrations preserve the original V1/V2 files, convert legacy exact hundredths to BIGINT cents in V3 and add authenticated finance tables in V4. V5 adds one local-access configuration and persistent attempt counters. New wallets use a fresh server-generated owner. Existing password profiles require credential verification only when adoption is explicitly selected; all other owners remain separate. See [ADR 0005](../decisions/0005-local-profile-and-optional-pin.md). PostgreSQL data persists in the configured named volume across launcher restarts.

See [local-first delivery](../decisions/0002-local-first-web-application.md), [Go and cents](../decisions/0003-go-backend-and-integer-cents.md), [MVP boundaries](../decisions/0004-authenticated-local-finance-mvp.md) and [API](../api/finance.md).

Overview reconstructs owner-scoped native-currency daily balances from opening balances and dated ledger entries in a read-only PostgreSQL transaction. Coverage rules omit unsupported complete totals before undated openings; future entries are excluded. The backend optionally requests ECB reference rates from Frankfurter over HTTPS, sending only currency codes and caching rates for one hour. Exact rational conversion, overflow checks and 30-day differences stay in the finance service. This optional external dependency does not move ledger data off the local machine. See [the Overview API](../api/graphql.md).
