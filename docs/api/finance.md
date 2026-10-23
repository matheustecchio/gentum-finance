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
| recurring | id, accountId, categoryId, kind, amount, description, nextDate, active |
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
| recurring | same fields as transaction; date is the first monthly occurrence |
| stopRecurring | id |
| runDue | empty input; materializes active occurrences through today (UTC), maximum 1000 per action |
| import | csv, accountId (required for the standard five-column format) |
| export | empty input |

Dates are strict `YYYY-MM-DD`, years 1900–9998. Transfers require distinct owned accounts with matching currencies; both linked entries commit together. Categories must match the transaction kind. Recurrence keeps the original day of month, clamps short months and restores the day in longer months. Each schedule/date is unique; repeated and concurrent runs cannot duplicate occurrences. Stopping a schedule preserves its existing entries.

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

Only `INCOME` and `EXPENSE` are accepted. An empty file, invalid date, nonpositive/out-of-range amount, malformed row, mismatched category kind, foreign/ineligible account or foreign category rejects every row. Up to 1000 transactions and a 1 MiB HTTP request are supported; the browser file picker limits files to 500 KB. Imports are additive; reimporting creates duplicates. Overflow rolls back the complete import.

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
              $subcategoryId: String, $after: String) {
  entryHistory(start: $start, end: $end, categoryId: $categoryId,
               subcategoryId: $subcategoryId, after: $after)
}
```

`entryHistory` returns `{entries, nextCursor, hasEntries}` through the existing
`FinanceData` scalar. Pages contain at most 10 entries, ordered by financial date,
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

`previewImport(input: FinanceInput!): FinanceData` is an authenticated read-only query. Pass `csv` and the destination `accountId` using the same contract as `import`. It returns `{count, transactions, errors}`. Transactions contain CSV record number (header is record 1), date, kind, exact integer-string amount, currency, account ID/name, category ID/path and description. Semantic errors contain `record` and `message`; malformed CSV errors identify the record in the query error. Multiple physical lines inside a quoted field still form one CSV record.

Preview writes nothing and checks the existing five-column and legacy six-column formats, supported dates, positive int64 cents, kind, owned eligible accounts, matching owned categories, the 1000-transaction limit and financial range limits. The UI blocks confirmation when errors exist and invalidates the preview after content or destination changes. `import` always validates again inside its serialized transaction, so changes after preview cannot authorize invalid writes. Any failure rolls back the full import.

The UI immediately guards pending confirmation, including repeated clicks before React rerenders, and shows import progress. A failed import is never automatically retried. Success invalidates the preview; intentional reimports require preview and confirmation again and remain additive. Preview does not provide duplicate detection or backend idempotency.
