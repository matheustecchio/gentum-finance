# Development and verification

## Source layout

- `frontend/`: React interface, shown only inside the desktop application in production.
- `backend/`: Go application/domain code, PostgreSQL persistence and private desktop transport.
- `desktop/`: Tauri shell, capabilities, resources and native package configuration.
- `website/`: independent static product/download page.
- `docs/`: decisions and development/API documentation.

Use Go 1.26.9+, Node.js 20.19+, Python 3.12+, Rust stable, a C compiler, make, Perl, Bison, Flex, patchelf and the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/). The initial packaging target is Linux x86_64 on Ubuntu 24.04-compatible systems. Build and validate separately for distributions with older system libraries. Other platforms fail preparation explicitly until verified binaries and native validation exist.

```bash
npm --prefix frontend ci
./gentum dev
./gentum build
```

Both desktop commands prepare the sidecar and bundled PostgreSQL before starting Tauri. Preparation downloads the official source archive at build time, verifies SHA-256 and builds a minimal local PostgreSQL runtime. A verified build is cached for later runs. An existing verified archive can be supplied with `GENTUM_POSTGRES_SOURCE_ARCHIVE=/absolute/path/to/postgresql-17.11.tar.bz2`. `GO` can select a Go executable and `GOCACHE` can select a writable cache. Rust uses the checked-in Cargo lockfile.

The development Vite server binds only to loopback and serves UI assets; it has no wallet API proxy. Financial requests still use native IPC. A production bundle opened in an ordinary browser displays a desktop-only message.

## Local storage

Tauri selects the platform application data directory. On Linux it is normally `~/.local/share/com.gentum.finance` (or under `$XDG_DATA_HOME`). It contains PostgreSQL 17 data, generated credentials, a selection token, a lock file and a private log. Never commit or share this directory. Normal application exit stops its managed processes and preserves data. PIN-protected wallets require a fresh unlock on restart.

No code adopts or deletes the old Docker volume. There is no automatic full-ledger migration from the retired browser application. Backups and any full-database transfer need an explicit offline procedure; CSV transaction files do not include the complete ledger state.

## Checks

```bash
cd backend
go test -race ./...
go vet ./...
go build -o bin/gentum-backend ./cmd/desktop
# Existing database integration suites need a disposable privileged PostgreSQL URL:
GENTUM_TEST_DATABASE_URL=postgres://... go test -race -tags=integration ./...
# Native managed runtime suite uses bundled binaries and disposable data:
GENTUM_DESKTOP_POSTGRES_DIR=/absolute/path/to/desktop/resources/postgres go test -race -tags=integration ./internal/desktop
```

From the repository root:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
cargo test --locked --manifest-path desktop/Cargo.toml
node scripts/desktop-check.mjs
node scripts/check-browser.mjs
node scripts/native-smoke.mjs
python3 website/build.py
git diff --check
```

Prepare desktop resources before the IPC and browser checks. The native smoke test requires `tauri-driver`, `WebKitWebDriver` and Xvfb plus a built `.deb`; it extracts the installer to temporary storage and uses fictional application data. It does not install the package system-wide. Refer to the script for executable path overrides. Native export dialogs require an interactive desktop for manual confirmation.

The IPC check covers PIN setup, private cookies, restart persistence, PIN relocking and clean database shutdown. The managed-runtime integration test covers exact cents beyond JavaScript's safe integer range, physical ledger creation/selection, stale-scope rejection, role separation and restart persistence.

The browser suite runs **only a test-mode frontend bundle** and `backend/cmd/test-server`, gated by `GENTUM_VERIFICATION_FIXTURE=1`, with a bundled disposable PostgreSQL cluster. This preserves browser component/interaction coverage. Neither the HTTP harness nor its frontend bundle is distributed. The native smoke test verifies the actual Tauri-to-Go path.

## Public site

`python3 website/build.py` validates and builds `website/dist/`. It is static and contains no financial application runtime. Hosting and public release publication are separate authorized operations. Keep download availability truthful until an installer is released.
