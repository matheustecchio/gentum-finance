# Contributing to Gentum Finance

Gentum Finance is an early-stage personal finance application. Contributions should preserve its modular-monolith boundaries, financial correctness rules, and explicit security limitations.

## Before starting

1. Read the [architecture overview](docs/architecture.md) and relevant API or decision record.
2. Search existing GitHub Issues and pull requests before opening duplicates.
3. Use an issue to discuss substantial features, architecture changes, or behavior changes before investing in implementation.
4. Never use real credentials, bank data, or personal financial data in development, tests, screenshots, logs, or examples.

The runtime uses separate physical PostgreSQL databases, each with optional PIN protection and verified cookie sessions, including direct-access mode. Browser selection belongs to the registry and requests bind to its database ID. Keep provisioning privileges separate from the financial role. Preserve session, Origin and ownership checks, and keep the application on trusted loopback.

## Set up the project

Follow the [development guide](docs/development.md) for prerequisites, database startup, application commands, and troubleshooting.

Install frontend dependencies from the committed lockfile:

```bash
cd frontend
npm ci
```

Use Go 1.26.9 or newer and the checked-in go.mod/go.sum for backend work.

## Create a branch

Do not commit directly to `main`. Start from an up-to-date `main` and create a descriptive branch:

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description
```

Use a branch prefix that reflects the work, such as `feature/`, `fix/`, `docs/`, or `chore/`. External contributors may use the same branch naming in a fork.

If the worktree already contains changes, inspect and preserve them before switching branches. Never use destructive checkout, reset, clean, or history rewriting to discard work.

## Make focused changes

- Organize backend code by domain module and preserve the GraphQL → application → domain → infrastructure dependency direction.
- Use Go `int64` and PostgreSQL `BIGINT` for integer cents. Encode GraphQL money as integer strings and convert decimal input only in the UI.
- Derive resource ownership server-side and scope persistence queries to the current user.
- Add database changes as new embedded SQL migrations; do not edit an applied migration.
- Keep frontend code feature-owned and backend financial rules authoritative.
- Add or update tests for changed observable behavior.
- Update the matching API, architecture, development, or README documentation in the same pull request.

See [AGENT.md](AGENT.md) for the complete repository constraints.

## Verify the change

Run checks in the package they apply to:

| Change | Required checks |
| --- | --- |
| Backend Go or configuration | `cd backend && go test -race ./... && go vet ./...` plus PostgreSQL integration tests |
| Database migration or SQL persistence | `cd backend && GENTUM_TEST_DATABASE_URL=postgres://... go test -tags=integration ./...` |
| GraphQL schema or contract | Backend checks, frontend typecheck/test/build, and `docs/api/` review |
| Frontend TypeScript or UI | `cd frontend && npm run typecheck && npm test && npm run build` |
| Test or coverage configuration | Relevant tests plus the relevant coverage command |
| Documentation only | `git diff --check` and manual link/command review |

For the complete backend gate, run:

```bash
cd backend
go test -race ./...
go vet ./...
go build -o bin/gentum ./cmd/server
```

Coverage commands are `go test -coverprofile=coverage.out ./...` in `backend/` and `npm run test:coverage` in `frontend/`. No percentage threshold is currently enforced. Run the enabled Playwright journey against the full Compose stack and `node scripts/check-persistence.mjs` when changing full-stack delivery.

## Commit the work

- Stage explicit paths so unrelated changes are not included.
- Keep each commit to one logical change.
- Write concise commit messages in imperative mood, for example `Add account ownership validation`.
- Do not amend, force-push, or rewrite published history unless a maintainer explicitly requests it.

## Open a pull request

Push the branch and open a pull request against `main`. Before creating one, check whether an open pull request already exists for the branch and update it instead of opening a duplicate.

Complete the repository pull-request template with:

- the problem and resulting behavior;
- linked issues when applicable;
- exact checks run and any unavailable checks;
- migration, GraphQL, security, and compatibility risks;
- documentation updated or intentionally unaffected.

Use a draft pull request when feedback is needed before the work is ready. Keep the branch focused and respond to review with additional commits. Do not merge while checks fail or required work remains.

The repository owner decides when and how to merge. After merge, delete the feature branch when it is no longer needed. See the [Git and GitHub workflow](docs/workflow.md) for the full sequence and current enforcement status.

## Report bugs and propose features

Use the structured GitHub issue forms. Do not put suspected security vulnerabilities, secrets, credentials, or real financial data in a public issue. A private security reporting channel has not yet been established; that is a maintainer policy decision still required before `SECURITY.md` can be published.
