# Gentum Finance

A local-first personal-finance web application with a Go/GraphQL backend, React frontend and PostgreSQL database. All three services run on your machine in Docker.

## Start locally

Install Docker Engine with Docker Compose v2 (including `up --wait`), then run:

```bash
./gentum start
```

Open **http://localhost:5173** and choose **Use without a PIN** or **Protect with a PIN**. No email or online account is needed. If you choose a four-digit PIN, save the recovery code before continuing. Use fictional data while evaluating this early MVP. If old profiles exist, **Create a new wallet** starts fresh without credentials and leaves their data stored separately. Choose **Use an existing profile** only to continue with an old profile, which requires its old email/password once.

```bash
./gentum status # container health and published address
./gentum stop   # stop services; preserve database data
./gentum start  # rebuild/start and wait for health checks
./gentum logs   # recent service logs
```

The frontend binds only to `127.0.0.1`; backend and database ports are internal to the Compose network. Use `localhost` in your browser: requests from a different origin, including `127.0.0.1`, are rejected. The launcher does not open a browser automatically.

Docker stores data in the persistent `gentum-finance_gentum-postgres-data` volume. Stopping, restarting, rebuilding and ordinary container recreation preserve it. Do not remove the volume or use `docker compose down -v` unless you intend to delete the data. Back up important data before upgrades; CSV export is a transaction interchange format, not a complete database backup.

To override the port or existing database settings, copy [.env.example](.env.example) to `.env` and edit it. Compose preserves the prior database defaults (`gentum`, `gentum_dev_only`, `gentum_finance`) and configurable volume name. Credentials must match an already initialized volume; changing `.env` does not change an existing PostgreSQL role password. `GENTUM_PORT=5180 ./gentum start` uses http://localhost:5180.

## Features

- A local profile without registration, optional four-digit PIN, Lock now, and recovery-code reset.
- Settings contains a primary-currency preference, Your accounts and Your categories, with creation forms in accessible, dismissible modals. It also keeps PIN and recovery controls.
- Incomplete wallets receive a setup invitation after loading. Open Settings or choose Configure later to dismiss it for the current app visit.
- Settings can enable, change, or disable the PIN; copy/download replacement recovery codes.
- Current, savings, cash and credit-card accounts in EUR, GBP, USD or BRL.
- Income/expense categories and date-only transactions with descriptions. Record income and expenses in **Add transaction**, the gold plus action in the navigation.
- **Transactions** shows the latest 10 entries across all dates, with older/newer pages, inclusive date filters, and root/subcategory filters. Reporting month affects dashboard totals, not history.
- Delete unused categories from **Settings**, after confirmation. Categories with children or references from transactions, budgets or schedules cannot be deleted.
- Atomic linked transfers between accounts in the same currency.
- Total Wealth in your primary currency, with dated ECB reference rates, a 30-day observation chart and signed change when history is available. Daily observations start when you open Overview; earlier balances and missing days are not invented.
- Monthly grouped cash-flow bars (income, expenses and signed net), with drag/swipe, keyboard and button navigation through history. Monthly spending bars show category names and amounts on hover, tap and focus.
- A saved primary currency in Settings. Original account balances and cash-flow reporting stay in their native currencies.
- Monthly category budgets with actual spending and percentage used.
- Monthly recurring income/expense schedules, explicit **Run due transactions**, idempotent occurrences, month-end handling and stopping schedules.
- Validated, all-or-nothing CSV import and spreadsheet-safe CSV export.

Money uses signed `int64`/PostgreSQL `BIGINT` integer cents: **100 = 1.00**. The browser converts decimal text with `BigInt`; GraphQL transports money as exact integer strings. Overflowing balances and monthly totals are rejected atomically. Transfers require the same currency; Total Wealth uses exact reference-rate conversion and rounds the combined amount once to cents, ties away from zero. Both comparison dates use the same latest rates; the change excludes market movements. Missing or more than seven-day-old rates make the total unavailable. Opening balances and transfers do not count as income or spending.

This MVP supports creating records and stopping recurring schedules. Editing/deleting transactions, automatic bank connections and scheduled background execution are not included. Recurring entries are created only when you press **Run due transactions**, through today's UTC date. Imports are not deduplicated: importing twice creates two sets of entries.

## Security and operation

PINs use PBKDF2-SHA256 with individual salts and 600,000 iterations. Recovery codes contain 160 random bits and are stored only as SHA-256 digests. Creating, changing, or recovering a PIN generates a new recovery code and revokes previous sessions. Recovery preserves the wallet; previous recovery codes stop working. If both PIN and recovery code are lost, there is no supported recovery flow in this version.

Session tokens are random, stored as hashes, HttpOnly and SameSite Strict. Cookies last for the browser session, with a 24-hour server expiry; reloads and browser session restoration may retain them, so use **Lock now** before leaving a protected wallet unattended. Mutations require the exact configured Origin and JSON content type. Failed PIN/recovery/adoption attempts use persistent, installation-wide progressive waits after five failures, capped at 16 minutes. Hashing concurrency is bounded. Ownership remains server-derived and enforced in queries and composite foreign keys, including direct-access mode.

Local HTTP cookies intentionally lack `Secure` for loopback HTTP. The application is intended for trusted local use; do not expose Compose services to a public network. Database credentials are local defaults, and data at rest is not encrypted by the application. The PIN is a casual-access app lock, not protection against someone who controls this computer. See [the local access decision](docs/decisions/0005-local-profile-and-optional-pin.md).

## Development and validation

See [development](docs/development.md), [architecture](docs/architecture/overview.md), [API and CSV contract](docs/api/finance.md), [contributing](CONTRIBUTING.md) and [repository guidance](AGENT.md).

CI runs Go race/integration tests against PostgreSQL, Go vet/build, frontend type checking/unit coverage/build, a real Docker browser journey and a launcher stop/start persistence check on every pull request. A workflow file defines checks; repository branch rules are a separate remote configuration.

### Categories and portable CSV

Income and expense categories support one optional subcategory level and readable paths. New wallets receive a small starter catalog; existing wallets can use **Add starter categories** without changing existing classifications. The overview shows monthly root and child totals by currency, including direct root entries. Root budgets include child spending; child budgets remain independent limits.

CSV imports use `date,kind,category_id,amount_cents,description` and the selected account shown in **Import & export**. Legacy six-column files retain their per-row accounts. Export downloads all transaction history in a ZIP with a separate CSV per account, named by account and currency. See the [finance API contract](docs/api/finance.md) for validation and compatibility details.
