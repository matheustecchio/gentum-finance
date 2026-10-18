# Development

## Full stack

Docker Engine and Compose v2 with `up --wait` are sufficient:

```bash
./gentum start
./gentum status
./gentum stop
./gentum logs
```

Open http://localhost:5173 and choose **Use without a PIN** or **Protect with a PIN**. No email or online account is needed. Save the recovery code before continuing with a PIN. If old profiles exist, **Create a new wallet** leaves their data stored separately; **Use an existing profile** requires its old email/password once.

`status` shows container health and the published address. `stop` preserves data; `start` rebuilds, starts services and waits for health checks. `logs` shows recent service logs. The launcher does not open a browser automatically. Only the frontend publishes a loopback port; Go and PostgreSQL stay on the internal Compose network. Use the printed `localhost` address: a different origin, including `127.0.0.1`, is rejected by the default configuration.

### Configuration and data

Copy [`.env.example`](../.env.example) to `.env` to override the port, database settings or volume name. For example, `GENTUM_PORT=5180 ./gentum start` uses http://localhost:5180. The database defaults remain `gentum`, `gentum_dev_only` and `gentum_finance`. Credentials must match an initialized volume; changing `.env` does not change an existing PostgreSQL role password.

Data lives in the persistent `gentum-finance_gentum-postgres-data` volume unless configured otherwise. Stopping, restarting, rebuilding and ordinary container recreation preserve it. Removing the volume or running `docker compose down -v` deletes data. Back up important data before upgrades. CSV export covers transaction interchange, not a complete database backup.

### Wallet workflow and limits

- **Settings** holds the primary currency, accounts, categories, PIN and recovery controls. Account and category creation use dismissible modals. An incomplete wallet offers setup guidance that can be dismissed with **Configure later** for the current visit.
- Accounts support current, savings, cash and credit-card types in EUR, GBP, USD and BRL. Record dated income and expenses through **Add transaction**. **Transactions** shows 10 entries per page with inclusive date and category/subcategory filters. Reporting month changes dashboard totals, not transaction history.
- Categories have one optional subcategory level. New wallets receive starter categories; existing wallets can add missing defaults without reclassifying records. Deletion requires confirmation and is limited to unused categories with no children or references. Root budgets include child spending; child budgets remain separate limits.
- Overview shows Total Wealth in the saved primary currency, plus native-currency cash flow and category spending. Chart inspection supports pointer, touch and keyboard. Cash Flow loads older history continuously and stops at the current Europe/Dublin month. See [reporting rules](api/graphql.md) for coverage, exchange rates and unavailable values.
- Recurring income and expenses are created only by **Run due transactions**, through today's UTC date. Runs are idempotent, handle month ends and can be stopped. There is no scheduled background execution.
- CSV imports are all-or-nothing and additive: importing twice creates duplicate entries. Export downloads a ZIP with one CSV per account across all history. See the [CSV contract](api/finance.md#csv-interchange) for headers, account selection, legacy files and spreadsheet-safe descriptions.
- This MVP does not offer transaction editing/deletion or automatic bank connections.

### Local access

Settings can enable, change or disable PIN protection and copy/download replacement recovery codes. Creating, changing or recovering a PIN replaces the code and revokes previous sessions while preserving wallet data. If both PIN and recovery code are lost, this version has no supported recovery flow. Use **Lock now** before leaving a protected wallet unattended; browser session restoration may retain access.

The app is intended for trusted loopback use. Do not expose Compose services publicly. Database credentials are local defaults, and the application does not encrypt data at rest. The PIN is an app lock, not protection against someone who controls the computer. See [architecture](architecture.md) and [the local-access decision](decisions/0005-local-profile-and-optional-pin.md) for the security design.

### Build version

The sidebar displays the installed build version from `frontend/package.json`. Vite embeds it at build time, so it works offline and stays unchanged until the app is rebuilt. The development server adds `(dev)`; production builds show only `v<version>`. Missing or invalid version metadata stops the build.

## Host development

Use Go 1.26.9+ and Node.js 20.19+ (Node 22 is used by Docker and CI). Use a dedicated disposable PostgreSQL database for tests. To expose PostgreSQL for host development, use your own database or an explicit temporary Compose override binding its port only to `127.0.0.1`. The default Compose configuration deliberately does not publish it.

```bash
cd backend
go test -race ./...
go vet ./...
GENTUM_TEST_DATABASE_URL=postgres://gentum:gentum_test_only@localhost:55439/gentum_test?sslmode=disable go test -race -tags=integration -coverprofile=coverage.out ./...
go build -o bin/gentum ./cmd/server
GENTUM_DATABASE_URL=postgres://gentum:gentum_dev_only@localhost:5432/gentum_finance?sslmode=disable go run ./cmd/server
```

The backend defaults to `127.0.0.1:8080` and `GENTUM_FRONTEND_ORIGIN=http://localhost:5173`. In Docker, `GENTUM_DATABASE_HOST`, `GENTUM_DATABASE_NAME`, `GENTUM_DATABASE_USERNAME`, `GENTUM_DATABASE_PASSWORD` are discrete overrides, avoiding URL escaping issues. HTTP has bounded read/write/header timeouts; embedded migrations run atomically at startup with checksum verification.

```bash
cd frontend
npm ci
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run dev
```

Vite proxies `/auth` and `/graphql` to the host backend. Browse using `localhost` to match Origin validation.

## Real stack checks

With the full Compose stack running:

```bash
cd frontend
npx playwright install --with-deps chromium
npm run test:e2e
cd ..
node --test scripts/persistence-client.test.mjs
node scripts/check-persistence.mjs
```

`GENTUM_E2E_URL` overrides the browser/check base URL; it must match the configured Origin. `GENTUM_CHROME_PATH` optionally points Playwright to an already-installed Chrome executable. The browser suite verifies optional PIN setup, recovery-code acknowledgement, wrong/correct unlock, lock isolation, PIN change, recovery, disabling protection, exact cents, transfers, budgets, recurrence and CSV. The persistence script invokes the real launcher status/stop/start and verifies local access and exact account cents survive. Both create fictional data in the single local wallet: run them only against a disposable stack and set `GENTUM_VERIFICATION_FIXTURE=1`. They must not target your normal database.

For an isolated local run, export these variables in the shell before starting the launcher and keep them set for browser and persistence checks:

```bash
export COMPOSE_PROJECT_NAME=gentum-verification
export GENTUM_PORT=5187
export GENTUM_DATABASE_VOLUME=gentum-verification-data
export GENTUM_E2E_URL=http://localhost:5187
export GENTUM_VERIFICATION_FIXTURE=1
./gentum start
(cd frontend && npm run test:e2e)
node scripts/check-persistence.mjs
./gentum stop
```

Use a fresh, disposable verification volume for a fresh E2E run. Do not remove an existing data volume to rerun tests. CI uses disposable runners and a dedicated verification volume. Persistence requests close their HTTP connections explicitly so launcher restarts do not reuse stale sockets; financial writes are never automatically retried.

CI runs five parallel jobs on pull requests and pushes to main: backend vet/build, backend race/integration coverage, frontend build/typecheck, frontend unit coverage and real browser/persistence checks. A workflow file does not configure branch protection; see [the Git workflow](workflow.md) for that distinction.

Backend integration tests isolate schemas in the configured test database and cover migration adoption/checksum/rollback, session revocation/expiry, cross-user references, exact amounts above JavaScript's safe integer range, account overflow, monthly budget actuals, recurring idempotence and CSV atomicity. Never point tests at production data. Coverage is reported as a baseline; no percentage gate is enforced.

## Troubleshooting

- Docker permission error: ensure your user can access the Docker daemon through your operating system's normal setup.
- Port in use: set `GENTUM_PORT` in `.env`, then run `./gentum start` again.
- Authentication origin rejection: open the exact printed `http://localhost:PORT` URL.
- Database authentication failure after changing configuration: restore credentials matching the existing volume; do not delete a volume to fix a password mismatch.
- Migration rejects fractional cents or checksums: preserve the database and investigate; do not edit applied migration files or bypass checks.
