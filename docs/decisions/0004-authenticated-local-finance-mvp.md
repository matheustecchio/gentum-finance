# ADR 0004: Authenticated local finance MVP

Status: Accepted

## Context

A functional local MVP needs browser profiles, a persistent ledger, plans and portable transactions while preserving exact cents and ownership. The user explicitly requested accounts, categories, income/expenses, transfers, dashboard, budgets, recurrence, import/export and a single local startup command.

## Decision

Use verified cookie sessions with local registration/login/logout, PBKDF2-SHA256 passwords and no fixed runtime identity. Publish only the loopback frontend through nginx; keep Go and PostgreSQL internal. `./gentum start/status/stop/logs` manages Compose without deleting its named data volume.

Use atomic linked same-currency transfers and monthly per-category/currency budgets. Monthly recurring schedules are materialized through an explicit Run due action; unique schedule/date keys and per-user write serialization make repeated or concurrent runs idempotent. Preserve original month-end anchor days. No background scheduler is required for this MVP.

Use an exact-cents CSV template with owned account/category IDs, validation and all-or-nothing import. Export ordinary income/expense transactions with formula-safe text. Imports are additive, and CSV is not a full backup.

Expose the complete finance snapshot as a documented GraphQL JSON scalar with string cents and a constrained string-input command object. Keep the existing typed account contract and repository interfaces. This trades nested GraphQL selection for a small explicit MVP contract; client and backend tests cover it together.

## Consequences

Profiles isolate data on a shared local instance. Existing development-user records are retained without being silently assigned to a new profile. Local HTTP cookies lack Secure and the app must remain on trusted loopback. No cross-currency conversions, automatic bank integrations, record editing/deletion, password recovery or automatic recurring execution are included. Tests run against real PostgreSQL, full Docker/browser flows and launcher restart persistence in CI.
