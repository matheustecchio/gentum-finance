# Finance MVP API and CSV contract

> Desktop transport: these operation paths and GraphQL contracts are dispatched in memory through private Tauri-to-Go IPC. They are not public HTTP endpoints. HTTP is available only in the explicitly gated acceptance-test fixture.


Financial routes require a verified session in both direct-access and PIN modes. All POSTs require `Origin` equal to the configured frontend origin and `Content-Type: application/json`. Access request bodies are limited to 4 KiB and reject unknown fields. Responses use `Cache-Control: no-store`.

| Route | Request and behavior |
| --- | --- |
| `GET /auth/status` | Returns `setupRequired`, `existingProfilesAvailable`, `pinEnabled`, and `unlocked`; never returns PINs or recovery hashes. |
| `POST /auth/setup` | `{ "source": "new", "mode": "open" }` or `{ "source": "new", "mode": "pin", "pin": "0123" }` creates a new empty wallet without credentials, regardless of existing profiles. To adopt old data, explicitly send `"source": "existing"` with the old `email` and `password`. Source is required. Creates the installation's local access configuration exactly once and opens a session. |
| `POST /auth/open` | `{}` obtains a session only when PIN protection is disabled. |
| `POST /auth/unlock` | `{ "pin": "0123" }` verifies the PIN and opens a session. |
| `POST /auth/lock` | `{}` requires an unlocked PIN-protected session and revokes all sessions. |
| `POST /auth/pin` | `{ "pin": "2345", "currentPin": "0123" }` requires a session. Current PIN is required only when protection is already enabled. Rotates recovery code and all sessions. |
| `POST /auth/disable-pin` | `{ "currentPin": "0123" }` requires a session and current PIN; removes PIN/recovery hashes and rotates sessions. |
| `POST /auth/recover` | `{ "recoveryCode": "YOUR-SAVED-CODE", "pin": "5678" }` replaces a forgotten PIN, rotates recovery code and all sessions, and preserves wallet data. |

PIN creation/change/recovery returns `{ "recoveryCode": "..." }` exactly once. Other successful access POSTs return `{}`. Codes are random 160-bit Base32 strings grouped with hyphens; recovery accepts lowercase and omitted hyphens. PINs must be strings of exactly four ASCII digits, including leading zeros. Session cookies are browser-session cookies; server expiry is 24 hours. `Lock now` revokes them even in other browsers. Old registration, password-login, logout, and `/auth/me` routes are no longer supported.

Errors use HTTP 400 for invalid input, 401 for failed verification or missing session, 409 for setup state conflicts, 429 for throttling, and 503 for database failures. After five failed verifications, waits grow from one minute to a maximum of 16 minutes, persisted across restarts and shared by all clients. A throttled response includes `Retry-After` seconds. PIN, recovery, and legacy adoption use separate counters; valid recovery clears them all. The PIN does not encrypt data at rest.

GraphQL retains `accounts` and `createAccount(input: CreateAccountInput!)`. Opening balance is a `Cents` integer string. No API accepts a client-supplied user ID.

## Wallet snapshot

```graphql
query Finance($month: String!) { finance(month: $month) }
```

`month` is `YYYY-MM`. `finance` returns a `FinanceData` JSON scalar object with these arrays (all field values below are strings):

| Array | Fields |
| --- | --- |
| accounts | id, name, type, currency, archived, initialBalance, balance |
| categories | id, name, kind, color, parentId, path |
| entries | id, accountId, categoryId, kind, amount, description, date, currency, transferId |
| budgets | id, categoryId, currency, month, amount, spent |
| breakdown | categoryId, currency, direct, total (monthly cents) |
| recurring | id, accountId, categoryId, kind, amount, description, nextDate, active, frequency, mode, anchorDay, anchorMonth |
| occurrences | id (empty for projections), recurringId, date, accountId, categoryId, kind, amount, description, status, entryId |
| totals | currency, income, expense, net |

Accounts, categories, entries and recurring schedules cover all dates; budgets and totals use the requested month. Empty optional IDs are empty strings. Money is canonical integer cents; `active` is `"true"` or `"false"`. Accounts contain current all-date balances. Totals exclude opening balances and transfers. The JSON scalar is an explicit MVP boundary; clients request the complete owned snapshot rather than arbitrary nested selections.

## Commands

```graphql
mutation Execute($action: String!, $input: FinanceInput!) {
  executeFinance(action: $action, input: $input)
}
```

All input fields are strings. Successful commands return a status string; export returns a base64-encoded ZIP containing one CSV per account. Validation or database errors return a safe GraphQL error and roll back the entire command.

| action | input fields |
| --- | --- |
| category | name (1–100 characters), kind (`INCOME` or `EXPENSE`), parentId (optional owned root of the same kind) |
| renameCategory | id (owned category), name (trimmed, 1–100 characters; unique within kind and parent) |
| editTransaction | id, categoryId, amount (positive cents), date, description (optional); stored account and kind stay fixed |
| transaction | accountId, categoryId, kind, amount (positive cents), date, description (optional; up to 200 characters) |
| transfer | fromId, toId, amount, date, description (optional) |
| budget | categoryId (expense), currency, month (`YYYY-MM`), amount; upserts the same category/currency/month |
| recurring | transaction fields plus frequency (`weekly`, `fortnightly`, `monthly`, `yearly`; default monthly), mode (`manual`, `automatic`; default manual); date is the first occurrence |
| editRecurring | id plus complete recurring fields; date is the next unprocessed occurrence |
| stopRecurring / resumeRecurring | id; preserves pending items and history; resume includes missed dates |
| processRecurring | empty input; creates due occurrences through today (UTC), posts automatic schedules and leaves manual items pending; at most 1000 per action |
| confirmOccurrence | occurrenceId; optional amount/description corrections; posts a pending item |
| editOccurrence | occurrenceId, amount, description; adjusts a pending item without posting |
| skipOccurrence | occurrenceId; skips a pending item |
| linkOccurrence | occurrenceId, entryId; links a pending/posted occurrence to an unlinked entry with the same account/kind; replaces a generated entry atomically |
| runDue | deprecated compatibility action; explicitly posts due manual items as well as automatic schedules; absent from the UI |
| import | csv, accountId (required for the standard five-column format) |
| export | empty input |

Dates are strict `YYYY-MM-DD`, years 1900–9998. Transfers require distinct owned accounts with matching currencies; both linked entries commit together. Categories must match the transaction kind. Recurrence keeps the original day of month, clamps short months and restores the day in longer months. Each schedule/date is unique; repeated and concurrent runs cannot duplicate occurrences. Stopping a schedule preserves its existing entries and pending occurrences. Yearly leap-day schedules return to February 29 in leap years. Series edits preserve anchor days when the date and frequency stay unchanged. Editing cannot rewind across a processed date. Existing schedules migrate to manual confirmation. Occurrence statuses are `pending`, `posted`, `linked`, `skipped`, or a projected `upcoming`. Pending items cover all dates; recent history covers 90 days, and upcoming projections cover 90 days (up to 14 per series).

Writes are serialized per user. PostgreSQL numeric aggregates are checked against signed int64 bounds before commits. Overflow rejects the entire action, including import or a recurring batch. Negative account balances are allowed. Ledger writes never convert currencies. The separate [Overview endpoint](graphql.md) estimates Total Wealth in the primary currency using dated reference rates.

## Category hierarchy and starter catalog

Categories have two levels. Transactions and schedules reference one root or child ID; `path` is the readable `Parent / Child` label. Names are unique after trimming and case normalization within kind and parent. Existing flat categories retain their IDs as roots, including any legacy case variants; new conflicting siblings are rejected. Foreign parents, mismatched kinds, self references and third levels are rejected. Renaming retains the category ID, kind, parent and color. Reparenting is not offered.

New local wallets receive 32 independent root categories during creation in the same transaction, in both access modes and additional databases. Existing categories and hierarchies are unchanged. Reads and restarts never install defaults or restore deleted defaults. The obsolete `starterCategories` action is rejected.

| Kind | Root categories |
| --- | --- |
| Income | Income; Wages; Interest/dividends; Miscellaneous |
| Expense | Daily Living; Groceries; Dining out; Well-being; Clothes; Recreation; Gifts; Medical Expenses; Health dues; Medicines; Bills & Subscriptions; Phone plan; Digital subscriptions; Education; Home; Rent; Tools & Equipment; Furniture & Repairs; Services; Utilities; Transportation; Public transportation; Gas & Fuel; Insurance; Repairs; Car Wash & Services; Parking & Tolls; Vacations |

`renameCategory` changes only the name under the owner write lock. Duplicate normalized siblings and foreign IDs are rejected. Transactions, budgets and recurring schedules retain their category IDs; refreshed paths include renamed parents. Settings offers a prefilled **Edit category** dialog with **Save changes** and **Cancel**. Each pencil button is named **Edit <category>** for assistive technology.

Monthly `breakdown` separates currencies and reports `direct` entries and `total` including immediate children exactly once. The Overview uses the inclusive date-range `analytics` query documented in [graphql.md](graphql.md). Its spending bars show direct expense amounts for each root and child path, without double-counting child amounts. Income, expense and net exclude opening balances and transfers. A root expense budget includes its direct spending and children; a child budget includes only that child. Overlapping budgets are independent limits and are never summed into a combined budget total. All sums retain exact integer cents.

## CSV interchange

The standard UTF-8 CSV uses this exact header and integer cents:

```csv
date,kind,category_id,amount_cents,description
2026-10-17,EXPENSE,<category-id>,29,Coffee
```

Send the destination as `accountId` alongside `csv` in the `import` action. The selected account's currency applies to every row. The owner comes from the authenticated session; the account must belong to that owner and must not be archived. A single eligible account is selected automatically; multiple accounts require an explicit choice. Without an eligible account, create one first. Category IDs and full paths remain visible in **Import & export**, alongside the standard template. A child ID already identifies its parent.

The compatibility parser also accepts this legacy header:

```csv
date,account_id,category_id,kind,amount_cents,description
```

Legacy rows retain their own validated account references; the selected destination is ignored for legacy files, including files spanning several accounts. The two headers cannot be mixed within a file.

Only `INCOME` and `EXPENSE` are accepted. An empty file, invalid date, nonpositive/out-of-range amount, malformed row, mismatched category kind, foreign/ineligible account or foreign category rejects every row. The desktop import workflow accepts up to 100,000 transactions and 32 MiB of UTF-8 CSV. GraphQL accepts at most 64 MiB of JSON, including encoding overhead. Overflow rolls back the complete import. The legacy synchronous `import` action remains additive; the desktop uses the durable operation described below to prevent duplicate retries.

### Multi-account export decision

The user selected **separate files per account, preserving all history** for issue #7. `export` returns a base64-encoded ZIP downloaded as `gentum-transactions.zip`. Each account has one five-column CSV, named with an ordinal, sanitized account name and currency. Ordinals distinguish duplicate names without exposing account IDs. All owned accounts, including archived accounts, and all income/expense dates are included, independently of reporting month or UI filters. Empty accounts produce header-only files. Currency is fixed per account and recorded in the filename. Import each CSV into its corresponding selected account.

Transfers, budgets and schedules are excluded. Formula-looking descriptions (including whitespace-prefixed `=`, `+`, `-`, `@`, control prefixes or an existing apostrophe) receive a leading apostrophe. That apostrophe remains on reimport. Category IDs remain references to the original profile; this is portable transaction interchange, not a full backup.

## Bounded transaction history

The app uses `financeSummary(month: String!)` for accounts, categories, budgets,
schedules, monthly category breakdown and totals. It returns the same snapshot
shape with an empty `entries` array and does not query entry history. Existing
`finance(month: String!)` consumers retain their full-history snapshot contract.
CSV exports continue to use all owned history, independently of these queries.

```graphql
query History($start: String, $end: String, $categoryId: String,
              $subcategoryId: String, $after: String, $limit: Int, $page: Int) {
  entryHistory(start: $start, end: $end, categoryId: $categoryId,
               subcategoryId: $subcategoryId, after: $after, limit: $limit, page: $page)
}
```

`entryHistory` returns `{entries, nextCursor, hasEntries, totalCount}` through the existing
`FinanceData` scalar. `limit` accepts 10 (default), 25, 50 or 100 entries. `page` selects a one-based numbered page, up to 1,000,000, and cannot be combined with `after`. Omit `page` to retain cursor pagination. `totalCount` counts matching owned entries before pagination, in the same read snapshot as the rows. Entries are ordered by financial date,
creation timestamp and ID, all descending. An empty `nextCursor` marks the last
page. Pass the opaque cursor as `after` for older entries; clients retain earlier
cursors for newer pages. Cursors are bound to the active filters; reset them after
filter changes or writes. They are not snapshot tokens: concurrent writes may
change the result set. An unchanged ledger has no page duplicates or omissions.

All filters combine with AND. Dates are optional inclusive date-only bounds;
invalid dates and reversed ranges are rejected. There is no implicit month filter.
A category must be an owned root and includes direct entries and all children.
A subcategory must be its owned child and narrows to that child. Without a category
filter, linked transfer legs are included. `hasEntries` describes the owned ledger
independently of filters, distinguishing an empty ledger from no matching entries.
Money remains integer cents encoded as strings. Errors do not expose SQL details.

`executeFinance(action: "deleteCategory", input: {id: "..."})` deletes only an
owned category with no children and no references from entries, budgets or any
recurring schedules, including stopped schedules. The owner write lock serializes
reference checks and deletion with other application writes; foreign keys also
prevent concurrent database writes from leaving dangling references. No financial
record is cascaded or reassigned. The app requires confirmation naming the category.
Deletion is allowed for starter categories. Reads and restarts never restore them.

The dedicated **Add transaction** screen preserves income/expense entry behavior.
**Transactions** contains only history, filters and pages; visiting it after saving
requests fresh history while retaining filters. The distinct plus action keeps its
text, selected state and keyboard focus on desktop and narrow navigation.

Category colors are persisted as `#RRGGBB` strings. Each existing or new category receives an initial color. Use `executeFinance(action: "categoryColor", input: {id: "...", color: "#336699"})` to update an owned category. Invalid colors and missing or foreign category IDs are rejected.

### Transaction corrections

`editTransaction` updates an existing owned income or expense atomically. Transfers and recurring-generated entries are rejected. Account and kind are always taken from the stored entry. Invalid corrections, foreign references and financial overflow roll back without changes. Balances, monthly totals, budgets, cash flow and wealth history derive from the corrected entry. History includes `recurringId` so the UI can hide editing for generated entries. No deletion or audit history is provided.

### Import preview and confirmation

`previewImport(input: FinanceInput!): FinanceData` is an authenticated read-only query. Pass `csv` and the destination `accountId` using the same contract as `import`. It returns `{count, transactions, errors, errorCount}`. `count` and `errorCount` cover the whole file. At most 50 sample transactions and 50 error details are returned. Transactions contain CSV record number (header is record 1), date, kind, exact integer-string amount, currency, account ID/name, category ID/path and description. Semantic errors contain `record` and `message`; malformed CSV errors identify the record in the query error. Multiple physical lines inside a quoted field still form one CSV record.

Preview writes nothing and checks the existing five-column and legacy six-column formats, supported dates, positive int64 cents, kind, owned eligible accounts, matching owned categories, the 100,000-transaction limit and financial range limits. The UI blocks confirmation when errors exist and invalidates the preview after content or destination changes. The import worker always validates again inside its serialized transaction, so changes after preview cannot authorize invalid writes. Any failure rolls back the full import.

The UI immediately guards pending confirmation, including repeated clicks before React rerenders. Preview is read-only and does not reserve or insert financial entries.

### Durable CSV import operations

`csvImport(action: String!, input: FinanceInput!): FinanceData` requires the same authenticated owner, Origin/JSON checks and selected physical database as other financial operations. Actions are `start`, `status` and `cancel`. Every call includes a client-generated UUID in `input.id`. `start` also receives `csv` and `accountId`; the five-column and legacy six-column formats keep their existing account semantics.

The result is `{id, status, total, processed, message}`. Status is `running`, `committed`, `failed` or `cancelled`. The modal polls real progress and shows remaining records. Processed records remain uncommitted until the entire operation passes ownership, value, balance and monthly-total checks. The worker uses COPY in batches of 1,000 within one PostgreSQL transaction, with a ten-minute deadline. Any validation error, timeout or acknowledged cancellation rolls back every entry. Cancellation racing final commit reports whichever outcome won; a committed import is never reported cancelled.

V12 stores operation metadata and request aliases, not CSV contents. Entries and the committed marker are saved in the same transaction. Repeating an operation ID with another file is rejected. Identical CSV bytes plus destination account share a running or completed operation, including when a new request ID is used. Changed CSV bytes are a different import; this is exact-file retry protection, not transaction-level duplicate matching. Failed or cancelled imports can be retried with a new operation ID.

The UI saves the pending ID in local storage under the physical database ID before submitting. After a lost response or remount it queries the recorded result instead of resending entries. Unknown results block another import until checked. After a sidecar restart, a still-running operation without a live worker is marked failed; PostgreSQL has rolled back its unfinished transaction. A committed marker is retained. Operation metadata follows the same local database retention as the ledger.

## Recurring import association

Both synchronous `import` and background CSV jobs use the same matcher as preview. A unique pending/posted occurrence must match account, category, kind, exact cents and a nonempty trimmed case-insensitive description within three days of its due date. Preview adds `recurringMatch` to displayed matching rows and excludes an already-posted charge from balance additions. Import keeps one entry and marks the occurrence linked, adopting the imported date and description. Each occurrence matches only once per file. Multiple candidates reject the whole import with a validation error. Unmatched rows remain normal additions; this is not general duplicate detection.

Due processing also links a uniquely matching unlinked entry before posting. Multiple candidate entries keep the occurrence pending for review. Manual linking permits different amounts/categories/descriptions, retains the actual transaction details, requires the same owned account and kind, and atomically replaces any generated entry. The UI searches within 14 days; the API accepts an owned eligible entry regardless of date. Linked and generated transactions remain protected from ordinary history edits.

## Budget workflows

`saveBudget` accepts `name`, `currency`, positive integer-cent `amount`, `date`
(the original anchor), `frequency` (`weekly`, `monthly`, `yearly`, `once`),
comma-separated `categoryIds` and `accountIds`, and `alert` (`true` or `false`).
One-time plans require inclusive `endDate`. Empty ID lists select all expense
categories/accounts in the chosen currency. Every supplied reference must belong
to the owner; selected accounts must match the currency. Parent categories include
children without counting a transaction twice.

For edits, supply `id` and `effectiveDate` at the current or next period start.
Keep the original anchor and frequency. A new revision preserves earlier periods;
editing a version that already has a successor is rejected. `stopBudget(id,date)`
ends renewal at the inclusive period end and removes later revisions.
`deleteBudget(id)` removes every version of the series without changing entries.

Budget snapshot rows include `id`, `seriesId`, `name`, `currency`, `amount`,
`spent`, `remaining`, `frequency`, `planStartDate`, `effectiveDate`, `stopDate`,
`startDate`, `endDate`, `nextDate`, `categoryIds`, `accountIds`, `alert`,
`active`, `latestVersion` and comma-separated matching `entryIds`.
All periods intersecting the requested month are returned, including weekly
periods that cross month boundaries. Amounts cover the whole displayed period.
Use `(id,startDate)` as the row identity. `active` describes renewal;
one-time budgets do not renew. Older revisions may still belong to a renewing
series. `latestVersion` controls editing even when the successor is in another
month. `month` and `categoryId` remain compatibility fields.

Only recorded expenses count. Imports and confirmed recurring occurrences count;
transfers, income and pending occurrences do not. There is no combined total for
overlapping limits. Alerts are visible status indicators at 75%, 90% and 100%
in the Budgets view, without OS notifications. No rollover or FX conversion is
performed. V14 preserves old monthly limits as one-time plans; the legacy `budget`
command still upserts its category/currency/month limit.
