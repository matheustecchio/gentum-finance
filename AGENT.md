# Gentum Finance repository guidance

## Project and paths

Gentum Finance is a local-first, web-based Go/GraphQL and React personal-finance application implemented as a modular monolith. Treat it as early-stage software and never use real credentials or financial data in tests or examples.

- `backend/internal/<module>/`: domain-oriented backend modules
- `backend/internal/api/`: GraphQL schema and HTTP transport
- `backend/internal/database/migrations/`: embedded, append-only SQL migrations
- `frontend/src/features/`: feature-owned React UI and GraphQL documents
- `docs/`: architecture, API, and decision records

Do not edit dependencies, build output, coverage output, generated bundles, or tool caches.

## Architecture rules

- Keep GraphQL resolvers thin: map input, call an application service, and map output.
- Keep domain types independent of HTTP, SQL, and frontend concerns.
- Implement persistence behind domain repository interfaces.
- Organize new code by domain module; do not add repository-wide controller/service/repository/entity packages.
- Use Go `int64` and PostgreSQL `BIGINT` for money in cents. GraphQL `Cents` uses integer strings; the UI converts decimal text with `BigInt`. Never use floating point for financial amounts.
- Use date-only values for financial dates and UTC `time.Time` for system timestamps.
- Derive the owning user ID server-side and scope every repository query by it. Never accept ownership from a client input.
- Treat transfers as linked transfers, not unrelated income and expense records.
- Change database schemas only through a new embedded SQL migration. Never edit applied migrations; preserve checksums and legacy Flyway adoption.
- Keep backend financial calculations authoritative.
- Preserve the browser-based, local-first delivery model. Keep application services and data on the user's machine by default, and bind development services to the loopback interface.
- Do not introduce Electron, Tauri, cloud hosting, or an embedded-database replacement without an accepted ADR that changes the product direction.

The runtime uses verified cookie sessions through the `CurrentUserProvider` seam. Keep all financial routes authenticated, enforce mutation Origin/JSON checks and retain ownership scoping. The legacy development provider is used only by compatibility tests; never wire it into the server. Keep local HTTP services on trusted loopback.

## Commands and validation

Use Go 1.26.9 or newer and Node.js 20.19 or newer. Use go.mod/go.sum and the npm lockfile.

Backend commands from `backend/`:

```bash
go test -race ./...
go vet ./...
GENTUM_TEST_DATABASE_URL=postgres://... go test -tags=integration ./...
go test -coverprofile=coverage.out ./...
go build -o bin/gentum ./cmd/server
```

Frontend commands from `frontend/`:

```bash
npm ci
npm run typecheck
npm test
npm run test:coverage
npm run build
```

For backend code or schema changes, run unit tests and PostgreSQL integration tests. For frontend code, run type checking, unit tests, and the production build. Run both sides for GraphQL contract changes. Run the full relevant suite before committing. Run the enabled Playwright journey against the full Compose stack and `node scripts/check-persistence.mjs` for delivery changes.

No coverage threshold exists yet; use the generated reports as a baseline and add meaningful behavioral tests with new work.

For documentation-only changes, verify links and commands against executable configuration, confirm `AGENT.md` and `CLAUDE.md` remain equivalent, and run `git diff --check`. Do not run expensive application tests unless a documentation claim needs runtime verification.

## Documentation synchronization

- Update `docs/api/` and frontend GraphQL documents with schema contract changes.
- Update `docs/architecture/overview.md` and add an ADR for significant boundary or technology decisions.
- Keep `docs/decisions/0002-local-first-web-application.md` synchronized with changes to local delivery, service startup, persistence location, desktop packaging, or hosting direction.
- Update `README.md` when prerequisites, commands, configuration, status, or user-visible scope changes.
- Update `CONTRIBUTING.md`, `docs/workflows/git-and-github.md`, and GitHub templates together when contribution or review policy changes.
- Re-check remote GitHub settings before documenting branch protection, required checks, merge policy, or security reporting as enforced.
- Keep `AGENT.md` and `CLAUDE.md` substantively identical.

## Git and pull-request workflow

Inspect status and the current branch before editing. Preserve unrelated work and do not commit directly to `main`.

When commits are requested:

1. Create a descriptive `feature/`, `fix/`, `docs/`, or `chore/` branch.
2. Stage explicit paths and split substantial work into focused logical commits.
3. Write concise commit messages in imperative mood.
4. Run the checks required by `CONTRIBUTING.md` before committing.
5. Push only with explicit authorization. Never force-push or rewrite published history.
6. Before opening a pull request, check for an existing PR from the branch and update it instead of creating a duplicate.
7. Target `main`, complete `.github/PULL_REQUEST_TEMPLATE.md`, and report exact passing, blocked, skipped, or unavailable checks.
8. Leave review and merge to the repository owner unless explicitly asked to perform them.

Do not claim GitHub enforcement merely because project policy requires a check. Confirm that the corresponding workflow and branch rule exist remotely. Do not create merge commits, merge into `main`, publish, deploy, release, or run production migrations without explicit authorization.

## Safety

Never add `.env`, secrets, bank credentials, tokens, private keys, production data, or sensitive URLs. Do not weaken validation, authorization, CSRF, CORS, migration validation, or tests to make a check pass.
