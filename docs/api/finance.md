# Finance MVP API and CSV contract

All application routes require a session except registration, login and health checks. `POST /auth/register` and `/auth/login` accept JSON `{ "email": "fiction@example.test", "password": "fictional-password-123" }`. Registration signs in immediately. `GET /auth/me` returns the current email; `POST /auth/logout` revokes the session. Mutation requests require `Origin` equal to the configured frontend origin and `Content-Type: application/json`.

GraphQL retains `accounts` and `createAccount(input: CreateAccountInput!)`. Opening balance is a `Cents` integer string. No API accepts a client-supplied user ID.

## Ledger snapshot

```graphql
query Finance($month: String!) { finance(month: $month) }
```

`month` is `YYYY-MM`. `finance` returns a `FinanceData` JSON scalar object with these arrays (all field values below are strings):

| Array | Fields |
| --- | --- |
| accounts | id, name, type, currency, initialBalance, balance |
| categories | id, name, kind |
| entries | id, accountId, categoryId, kind, amount, description, date, currency, transferId |
| budgets | id, categoryId, currency, month, amount, spent |
| recurring | id, accountId, categoryId, kind, amount, description, nextDate, active |
| totals | currency, income, expense, net |

Accounts, categories, entries and recurring schedules cover all dates; budgets and totals use the requested month. Empty optional IDs are empty strings. Money is canonical integer cents; `active` is `"true"` or `"false"`. Accounts contain current all-date balances. Totals exclude opening balances and transfers. The JSON scalar is an explicit MVP boundary; clients request the complete owned snapshot rather than arbitrary nested selections.

## Commands

```graphql
mutation Execute($action: String!, $input: FinanceInput!) {
  executeFinance(action: $action, input: $input)
}
```

All input fields are strings. Successful commands return a status string; export returns CSV text. Validation or database errors return a safe GraphQL error and roll back the entire command.

| action | input fields |
| --- | --- |
| category | name (1–100 characters), kind (`INCOME` or `EXPENSE`) |
| transaction | accountId, categoryId, kind, amount (positive cents), date, description (optional; up to 200 characters) |
| transfer | fromId, toId, amount, date, description (optional) |
| budget | categoryId (expense), currency, month (`YYYY-MM`), amount; upserts the same category/currency/month |
| recurring | same fields as transaction; date is the first monthly occurrence |
| stopRecurring | id |
| runDue | empty input; materializes active occurrences through today (UTC), maximum 1000 per action |
| import | csv |
| export | empty input |

Dates are strict `YYYY-MM-DD`, years 1900–9998. Transfers require distinct owned accounts with matching currencies; both linked entries commit together. Categories must match the transaction kind. Recurrence keeps the original day of month, clamps short months and restores the day in longer months. Each schedule/date is unique; repeated and concurrent runs cannot duplicate occurrences. Stopping a schedule preserves its existing entries.

Writes are serialized per user. PostgreSQL numeric aggregates are checked against signed int64 bounds before commits. Overflow rejects the entire action, including import or a recurring batch. Negative account balances are allowed. No currency conversion is performed.

## CSV interchange

Use UTF-8 comma-separated CSV, with this exact header and integer cents (never decimal amounts):

```csv
date,account_id,category_id,kind,amount_cents,description
2026-10-16,REPLACE_WITH_OWN_ACCOUNT_UUID,REPLACE_WITH_OWN_CATEGORY_UUID,EXPENSE,29,Fictional coffee
```

Create your accounts/categories first. Their IDs are shown in **Import & export**, along with a template. IDs must belong to the signed-in user and the category kind must match. Only `INCOME` and `EXPENSE` are accepted. An empty file, invalid date, nonpositive/out-of-range amount, malformed row, wrong category or foreign reference rejects every row. Up to 1000 transactions and a 1 MiB HTTP request are supported; the browser file picker limits files to 500 KB. Reimporting is additive and creates duplicates.

Export contains all owned income/expense entries across all dates and currencies, with exact cents, quoted fields and account/category IDs. Transfers, accounts, budgets and schedules are excluded. Formula-looking descriptions (including whitespace-prefixed `=`, `+`, `-`, `@`, control prefixes or an existing apostrophe) receive a leading apostrophe to prevent spreadsheet execution. That apostrophe is retained on reimport; export is safe interchange rather than a byte-perfect full backup. Recreate account/category IDs appropriately when moving data to another profile.
