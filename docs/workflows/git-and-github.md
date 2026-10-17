# Git and GitHub workflow

This workflow keeps `main` reviewable and preserves unrelated local work. It applies to application code, configuration, tests, and documentation.

## Workflow summary

```text
Issue or scoped task
        |
        v
Current main → descriptive branch → focused commits → local verification
                                                   |
                                                   v
                                      pull request against main
                                                   |
                                                   v
                                      checks + review + updates
                                                   |
                                                   v
                                         owner-approved merge
                                                   |
                                                   v
                                          delete feature branch
```

## 1. Define the change

Search open and closed Issues and pull requests before starting. Open or reference an Issue for a bug, feature, or architecture change that benefits from discussion. Keep secrets, credentials, security vulnerabilities, and real financial data out of public Issues.

## 2. Create a branch

Start from an up-to-date `main`:

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description
```

Use `feature/`, `fix/`, `docs/`, or `chore/` followed by a short kebab-case description. Do not commit directly to `main`.

Before switching or pulling, inspect `git status --short`. Preserve existing work and never use destructive reset, checkout, or clean operations to force the worktree into another state.

## 3. Implement and verify

Keep the branch limited to one coherent outcome. Stage explicit paths and split substantial work into focused commits. Use concise imperative commit messages.

Run the checks listed in [CONTRIBUTING.md](../../CONTRIBUTING.md). Record exact results and clearly identify checks that were skipped, blocked, or unavailable.

## 4. Push safely

Push the named branch without force:

```bash
git push -u origin feature/short-description
```

Do not force-push, rewrite published history, or push directly to `main`. Pushing changes remote state and requires explicit authorization when an automated coding agent performs it.

## 5. Open or update the pull request

Before opening a pull request, check whether the branch already has one. Update the existing pull request rather than creating a duplicate.

Target `main` and complete `.github/PULL_REQUEST_TEMPLATE.md`. The pull request should explain the outcome, link Issues, list exact verification, identify unavailable checks, describe migrations and security impact, and name synchronized documentation.

Use a draft pull request for early feedback. Mark it ready only when the requested outcome is complete and relevant local checks pass.

## 6. Review and checks

Reviewers should verify:

- behavior and tests match the stated outcome;
- financial values never use floating point;
- user ownership is decided and enforced server-side;
- migrations are append-only, checksummed SQL and preserve existing data;
- GraphQL, frontend documents, and API documentation remain synchronized;
- no secrets, production data, debug output, or generated noise entered the diff;
- skipped or blocked validation is not represented as passing.

Address review with focused follow-up commits. Do not merge while required work or failing checks remain.

## 7. Merge and clean up

The repository owner selects the merge method and performs or authorizes the merge. GitHub currently allows merge commits, squash merges, and rebase merges; the repository does not yet enforce one method. Do not create a merge commit or merge into `main` from an automated coding session unless explicitly requested.

After merge, delete the remote and local feature branch when it is no longer needed. GitHub does not currently delete merged branches automatically.

## GitHub enforcement history

Verified on 2026-08-30 for `matheustecchio/ledger-app`:

- the repository is public and `main` is the default branch;
- GitHub Issues are enabled and Discussions are disabled;
- `main` has no branch protection rule;
- no repository rulesets or GitHub Actions workflows are configured;
- all three GitHub merge methods are enabled;
- automatic branch deletion after merge is disabled;
- secret scanning and push protection are enabled;
- private vulnerability reporting and Dependabot security updates are disabled.

These are observations, not guarantees. Re-check GitHub before claiming a check, approval, merge strategy, or security mechanism is enforced. This MVP adds `.github/workflows/ci.yml` with five parallel jobs: `backend-checks` (Go vet and build), `backend-tests` (race detection, coverage, and PostgreSQL integration), `frontend-checks` (build, including type checking), `frontend-tests` (unit tests with coverage), and `end-to-end` (persistence client tests, Playwright, and persistence checks against the Compose stack) for pull requests and pushes to main. It validates real PostgreSQL and Docker browser/persistence flows. A workflow does not configure branch protection; the historical settings above are not a current enforcement claim.

## Recommended GitHub hardening

The following changes require separate maintainer approval because they alter remote repository policy:

1. Require the new CI jobs in the selected branch-protection policy after confirming their remote runs.
2. Protect `main` or add a ruleset requiring pull requests and successful CI checks.
3. Decide whether approving reviews are mandatory.
4. Select a preferred merge method and enable automatic branch deletion if desired.
5. Enable private vulnerability reporting before publishing `SECURITY.md`.
6. Enable Dependabot security updates after deciding how dependency pull requests will be reviewed.
