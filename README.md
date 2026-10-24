# Gentum Finance

A desktop personal-finance application that keeps your ledgers on your computer. Track accounts, transactions, transfers, budgets and spending without an online account.

## Desktop application

React runs inside a Tauri window. Go owns the financial rules and starts a bundled PostgreSQL database. The installed application requires no Docker, Go, Node.js, Rust or separate PostgreSQL installation. Native GTK/WebKit system libraries are normal Linux package prerequisites.

The initial installer target is **Linux x86_64 (.deb)**, validated on Ubuntu 24.04-compatible systems. This repository builds the installer; no public release or website deployment is implied. Windows, macOS and ARM packages are not yet supported.

Features include dated Analytics with income/spending/cash-flow and wealth charts, transaction corrections, separate local ledgers, optional PIN protection, recurrence, budgets, CSV previews/import with up to 100,000 records, progress, cancellation and full rollback, and native file export.

Recurring schedules support weekly, every-two-weeks, monthly and yearly income or expenses. Choose automatic entry or confirmation, review upcoming and overdue items, adjust or skip an occurrence, and edit future occurrences. The app processes due dates while open and catches up on the next launch. CSV import links unique matching recurring charges to avoid counting them twice. See the [recurring decision](docs/decisions/0010-recurring-occurrences.md).

This is an early MVP. Use fictional data while evaluating it. The PIN is an app lock, not database encryption.

## Build from source

Use Go 1.26.9+, Node.js 20.19+, Python 3.12+, Rust stable, a C compiler, make, Perl, Bison, Flex, patchelf and the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/). On Debian/Ubuntu these include WebKitGTK 4.1, GTK 3, Ayatana AppIndicator, librsvg and OpenSSL development packages.

```bash
npm --prefix frontend ci
./gentum build
```

The build verifies and builds the official pinned PostgreSQL source archive, compiles the Go sidecar and packages local assets. The `.deb` is written under `desktop/target/release/bundle/deb/`. Install the package using your distribution's package installer, then open Gentum Finance from the application menu. The first launch initializes its local data without downloading a runtime.

For development, use `./gentum dev`. Build the public site with `./gentum website`; the static output is `website/dist/`.

## Existing browser installations

The browser runtime and Docker launcher have been retired. Existing Docker volumes are **not modified or imported automatically**. Keep the previous installation and backups until a separate full-ledger migration is reviewed. CSV transaction import is not a complete database backup/restore mechanism.

## Documentation

- [Development and verification](docs/development.md)
- [Architecture](docs/architecture.md)
- [Desktop decision and storage](docs/decisions/0009-tauri-desktop-application.md)
- [Interface design](docs/design.md)
- [Financial API and CSV contract](docs/api/finance.md)
- [Public website](website/README.md)
- [Contributing](CONTRIBUTING.md)
