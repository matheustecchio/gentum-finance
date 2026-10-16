# Architecture

Gentum Finance is a local-first modular monolith: React browser UI → same-origin nginx → Go GraphQL/application services → PostgreSQL. Docker Compose runs the three services locally; only nginx publishes a loopback port.

- `backend/internal/account`: account domain, service and PostgreSQL repository behind an interface.
- `backend/internal/finance`: ledger snapshot/command service and repository interface, PostgreSQL implementation, exact money/date/CSV rules.
- `backend/internal/security`: verified session identity, authentication transport and password/session handling.
- `backend/internal/api`: GraphQL transport and thin account/finance resolvers.
- `backend/internal/database`: embedded append-only migrations and legacy Flyway adoption.
- `frontend/src/features/finance`: authenticated feature navigation, forms, dashboard and typed snapshot client.
- `frontend/src/features/accounts/money.ts`: exact decimal-to-cents conversion and display using BigInt.

Ownership is obtained from the verified session context. Resource queries and composite foreign keys scope records by owner. A per-owner database row lock serializes financial writes, imports and recurring runs. Linked transfer entries and CSV imports are atomic. Reads use repeatable-read snapshots. PostgreSQL numeric aggregates avoid intermediate BIGINT overflow and are checked before returning or committing; supported money remains signed int64 cents.

GraphQL preserves typed accounts and uses the documented `FinanceData` JSON scalar for the complete finance snapshot plus a constrained `FinanceInput` command object. Monthly report totals and budget spending are authoritative backend values. Currency totals remain separate. No exchange-rate assumptions are introduced.

The browser talks only to same-origin routes. Cookie sessions use hashed opaque tokens, 24-hour expiry and logout revocation; password derivation is PBKDF2-SHA256. Mutation Origin checks and JSON-only requests protect against CSRF; response CSP and frame restrictions reduce browser exposure. Local HTTP omits Secure cookies intentionally. This architecture is intended for trusted loopback operation, without public hosting or bank credentials.

Migrations preserve the original V1/V2 files, convert legacy exact hundredths to BIGINT cents in V3 and add authenticated finance tables in V4. Legacy development-profile records remain unclaimed. PostgreSQL data persists in the configured named volume across launcher restarts.

See [local-first delivery](../decisions/0002-local-first-web-application.md), [Go and cents](../decisions/0003-go-backend-and-integer-cents.md), [MVP boundaries](../decisions/0004-authenticated-local-finance-mvp.md) and [API](../api/finance.md).
