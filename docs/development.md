# Development

## Full stack

Docker Engine and Compose v2 with `up --wait` are sufficient:

```bash
./gentum start
./gentum status
./gentum stop
```

Open http://localhost:5173 and choose direct access or a PIN for your local wallet. `.env` overrides the optional port, database name/user/password and persistent volume. Keep credentials consistent with initialized volumes. Backend/PostgreSQL are internal; the frontend is the only published loopback port. The launcher waits for all service health checks and never deletes data.

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

Backend integration tests isolate schemas in the configured test database and cover migration adoption/checksum/rollback, session revocation/expiry, cross-user references, exact amounts above JavaScript's safe integer range, account overflow, monthly budget actuals, recurring idempotence and CSV atomicity. Never point tests at production data. Coverage is reported as a baseline; no percentage gate is enforced.

## Troubleshooting

- Docker permission error: ensure your user can access the Docker daemon through your operating system's normal setup.
- Port in use: set `GENTUM_PORT` in `.env`, then run `./gentum start` again.
- Authentication origin rejection: open the exact printed `http://localhost:PORT` URL.
- Database authentication failure after changing configuration: restore credentials matching the existing volume; do not delete a volume to fix a password mismatch.
- Migration rejects fractional cents or checksums: preserve the database and investigate; do not edit applied migration files or bypass checks.
