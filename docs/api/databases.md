# Local databases

> Desktop transport: these operation paths and GraphQL contracts are dispatched in memory through private Tauri-to-Go IPC. They are not public HTTP endpoints. HTTP is available only in the explicitly gated acceptance-test fixture.


All routes use same-origin HttpOnly cookies. POST requires the configured Origin and application/json. GET /auth/status discovers `databaseId` and `databaseName` alongside existing access status. Every subsequent operation except status includes `X-Gentum-Database: <databaseId>`. A stale or missing selection header returns 409 before any financial operation. Health checks are exempt. Refresh status and clear old forms/caches before retrying.

The persistent `gentum_database_session` cookie identifies browser selection; the separate `gentum_session` cookie authenticates inside the selected database and expires server-side after 24 hours. Clearing browser cookies restores the original default selection.

- GET /databases returns `{activeId, databases: [{id, name, pinEnabled}]}` for an authenticated current database.
- POST /databases/create accepts `{name, mode: "open" | "pin", pin?}`. Returns `{}` or `{recoveryCode}` without selecting the new database. The caller must save a returned code before continuing.
- POST /databases/rename accepts `{id, name}` and returns `{}`. Only the display name changes.
- POST /databases/select accepts `{id, pin?}`. A protected target requires its own PIN. `{id, recoveryCode, pin}` recovers a target with a replacement PIN and returns `{recoveryCode}`. Successful selection creates a new target session; failure leaves the current selection usable. Selecting the active database is a no-op.

Trim display names and allow 1 through 100 Unicode characters. Reject blank or case-insensitive duplicate names with 400. IDs and physical PostgreSQL identifiers are generated server-side; never derive physical names from display text. Missing targets return 404, invalid credentials 401, persistent lockout 429 with Retry-After, unavailable storage or provisioning 503. A global lockout covers all targets and survives creation and server restart.

Every financial GraphQL request and CSV operation uses the selected pool. PIN changes, recovery and lock revoke sessions only in that physical database. The original database also holds registry metadata and installation-wide access counters. Existing local access and records remain untouched on registry initialization; legacy owners are not automatically adopted.
