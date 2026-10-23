# ADR 0009: Deliver Gentum as a Tauri desktop application

- Status: accepted by the product owner
- Date: 2026-10-23
- Supersedes: the browser delivery and Docker runtime in ADR 0002

## Decision

Deliver one local desktop application. Keep the React interface, Go application services, GraphQL contracts, integer-cent calculations and PostgreSQL repositories. Tauri owns the application window and starts the bundled Go sidecar. The sidecar starts a private PostgreSQL 17 cluster from bundled binaries. Initial packaging supports Linux x86_64 only.

The renderer calls restricted Tauri commands. Rust and Go exchange bounded JSON messages through inherited stdin/stdout pipes. Go adapts these messages to the existing handler interfaces in memory. There is no application HTTP listener, nginx runtime or browser version in the installed product. PostgreSQL listens on an ephemeral IPv4 loopback port with generated credentials; it is not an application web endpoint.

Go retains authentication cookies in memory and persists only the database-selection token in the private application directory. PIN-protected ledgers require a fresh unlock after restart. The financial role has neither SUPERUSER nor CREATEDB. A separate provisioner creates ledgers. Existing Origin, JSON, ownership, session, PIN-recovery, stale-selection and throttling checks remain in the handler pipeline. The trusted internal Origin is supplied by the process adapter, never the renderer.

## Storage and lifecycle

Tauri supplies its platform-specific local data directory. On Linux this is normally `$XDG_DATA_HOME/com.gentum.finance` or `~/.local/share/com.gentum.finance`. It contains `postgres-17/`, generated database credentials, the selected-ledger token, the runtime lock and a private PostgreSQL log. Directory permissions are 0700 and secret files 0600. An advisory lock prevents two sidecars using the same directory. Normal exit closes stdin, stops the sidecar and shuts PostgreSQL down without deleting data.

The package includes PostgreSQL 17.11 built from the SHA-256-pinned official source archive. Its minimal build excludes TLS, ICU, compression, XML and readline dependencies. SCRAM authentication stays enabled on private loopback connections. The upstream PostgreSQL license is included. Downloads occur while building, never at first launch. The build manifest records the source, version, target and checksum. A different PostgreSQL major version or partial data directory is rejected instead of being reset. Future database upgrades need an explicit migration procedure.

## Public website and testing

`website/` is a separate static product and download page. It has no wallet runtime, database access, account or financial API. Download availability must reflect published installers; building this change does not publish a release or deploy the website.

`backend/cmd/test-server` is a disposable, explicitly gated HTTP acceptance-test harness. It serves a test-mode frontend build against fictional bundled PostgreSQL data. This binary and test frontend are excluded from desktop packaging. It preserves browser regression coverage while native smoke tests exercise the actual installer and Tauri IPC.

## Compatibility and limits

The former Docker volumes are not modified, adopted or deleted. The desktop application starts with its own local cluster. Automatic migration of existing Docker ledgers is not included; keep the old installation and its backups until a separately reviewed migration is available. CSV import remains available for supported transaction records, but is not a full backup/restore format.

Linux x86_64 Debian packaging is the validated initial target. Windows, macOS, ARM, signed updates, public releases, automatic upgrades and cloud synchronization are outside this implementation. Rust is limited to process/window integration and native export dialogs; financial rules remain in Go. The PIN remains an app lock, not database encryption.
