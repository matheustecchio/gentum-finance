# ADR 0002: Keep Gentum Finance web-based and local-first

- Status: accepted; backend technology and money representation superseded by ADR 0003
- Date: 2026-10-04

## Context

Gentum Finance must keep personal financial data on the user's machine while providing a practical path for continued development. A local database does not require a desktop user interface: a browser client can communicate with backend services that listen only on the local machine.

The existing architecture already uses React, GraphQL, Spring Boot, and PostgreSQL. Packaging it as a desktop application would add a wrapper and distribution lifecycle while still requiring the Java backend and database to be bundled, managed, or replaced.

## Decision

Keep Gentum Finance as a web-based, local-first application:

- React runs in the user's browser.
- Spring Boot exposes GraphQL on the local machine and remains authoritative for validation, ownership, financial behavior, and persistence.
- PostgreSQL runs locally and stores data in a persistent Docker volume.
- Development services bind to the loopback interface by default and must not be exposed to the network while Phase 0 uses an open GraphQL endpoint and fixed development identity.
- Normal local use must not depend on a cloud account or internet connection.

The target user experience is a single command or launcher that starts the database, backend, and frontend and then opens the local application URL. Phase 0 still starts those components separately; implementing full-stack Compose or an equivalent launcher is follow-up work.

Desktop packaging with Electron or Tauri, replacing PostgreSQL with an embedded database, and cloud hosting are not part of the current product direction. Any such change requires a separate ADR because it changes distribution, operations, security, or portfolio goals.

## Consequences

- The project retains its Java, Spring, GraphQL, React, and PostgreSQL learning and portfolio value.
- Financial data remains local by default without requiring a desktop wrapper.
- The same browser frontend can support a future hosted mode if a later decision authorizes one.
- Local startup currently involves multiple processes until the launcher or full-stack Compose milestone is implemented.
- Users still need a supported browser and the local runtime prerequisites during development.
- Backup and restore must operate on local data and will need an explicit user-facing workflow before real financial data is supported.

## Technology update

[ADR 0003](0003-go-backend-and-integer-cents.md) replaces Java/Spring/Flyway with Go and embedded SQL migrations. The modular-monolith and local-first decisions remain in force.

## Functional MVP delivery

The accepted MVP now uses `./gentum start` to build and start nginx/React, Go and PostgreSQL in Docker, waiting for health checks. Only `127.0.0.1:5173` (configurable through `GENTUM_PORT`) is published. Backend and database ports remain internal. `./gentum stop` preserves the configured named database volume, and `./gentum status` reports health. Startup never launches a visible browser or resets data. The printed browser origin is the allowed mutation Origin. See [ADR 0004](0004-authenticated-local-finance-mvp.md).

## Optional local access protection

[ADR 0005](0005-local-profile-and-optional-pin.md) replaces email registration with one local profile and optional PIN protection. The free local application needs no online account. A possible future paid hosted synchronization service is outside the current implementation. Local persistence and loopback delivery remain unchanged.

## Multiple database update

[ADR 0008](0008-multiple-local-databases.md) adds independent physical databases under the same local endpoint. Compose bootstraps financial and provisioning roles before the backend starts, including on existing volumes. All databases and the original registry persist in the existing named PostgreSQL volume. The original configured database remains the registry and default; it is never replaced or automatically adopted into a different owner.
