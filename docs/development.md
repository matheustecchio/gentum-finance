# Development

## Full stack

Docker Engine and Compose v2 with `up --wait` are sufficient:

```bash
./gentum start
./gentum status
./gentum stop
```

Open http://localhost:5173 and register a fictional profile. `.env` overrides the optional port, database name/user/password and persistent volume. Keep credentials consistent with initialized volumes. Backend/PostgreSQL are internal; the frontend is the only published loopback port. The launcher waits for all service health checks and never deletes data.

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
node scripts/check-persistence.mjs
```

`GENTUM_E2E_URL` overrides the browser/check base URL; it must match the configured Origin. `GENTUM_CHROME_PATH` optionally points Playwright to an already-installed Chrome executable. The browser suite creates fictional profiles and verifies actual cookies, accounts, cents, transactions, linked transfers, budgets, idempotent recurrence, atomic CSV validation/export, re-login and unauthenticated isolation. The persistence script invokes the real launcher status/stop/start and verifies a profile and exact account amount survive. These fixtures remain in the local database under separate fictional profiles and do not appear in other users' ledgers.

Backend integration tests isolate schemas in the configured test database and cover migration adoption/checksum/rollback, session revocation/expiry, cross-user references, exact amounts above JavaScript's safe integer range, account overflow, monthly budget actuals, recurring idempotence and CSV atomicity. Never point tests at production data. Coverage is reported as a baseline; no percentage gate is enforced.

## Troubleshooting

- Docker permission error: ensure your user can access the Docker daemon through your operating system's normal setup.
- Port in use: set `GENTUM_PORT` in `.env`, then run `./gentum start` again.
- Authentication origin rejection: open the exact printed `http://localhost:PORT` URL.
- Database authentication failure after changing configuration: restore credentials matching the existing volume; do not delete a volume to fix a password mismatch.
- Migration rejects fractional cents or checksums: preserve the database and investigate; do not edit applied migration files or bypass checks.
