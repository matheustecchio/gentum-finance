# ADR 0003: Use Go and integer cents

- Status: accepted
- Date: 2026-10-16

## Context

The owner prefers Go for continued development and has decided that monetary amounts use integer cents: one euro equals 100. The current scope contains only account creation and listing, so the backend can be replaced before additional domains increase migration cost.

## Decision

Replace Java, Spring Boot, JPA, Gradle, and Flyway runtime dependencies with Go, the standard-library HTTP server, graphql-go, pgx, and embedded append-only SQL migrations. Retain React, GraphQL, PostgreSQL, domain modules, server-side ownership, and the local-first browser delivery model.

Use `int64` in Go and `BIGINT` in PostgreSQL for monetary minor units. The supported currencies (EUR, GBP, USD, BRL) all use two decimal places. GraphQL exposes a `Cents` scalar serialized as a canonical signed integer string, preserving the complete int64 range in JavaScript. JSON numeric money values are rejected. The UI parses decimal text using `BigInt`, validates range and at most two fractional digits, and formats cents for display. Backend validation and all future financial calculations remain authoritative.

Preserve V1 and V2 migration bytes. Adopt existing successful Flyway entries only after checking their CRC32 checksums; track Go migrations with SHA-256 checksums. Run migrations transactionally under a database advisory lock. V3 converts existing major-unit decimal balances to cents and rejects fractional cents instead of rounding. No existing database volume is removed or reset.

## Consequences

- Java is no longer required to develop or run the backend.
- The API field name `initialBalance` remains, but its unit changes from major-unit decimal text to integer cents. Deploy the matching frontend and backend together.
- The old Spring GraphiQL page is removed; POST GraphQL and introspection remain available to local clients.
- Authentication is still pending. The server refuses non-loopback binding while the fixed development identity is installed.
- Currencies with other minor-unit scales need a separate product and data-contract decision.
- Future percentage calculations, divisions, and currency conversions need explicit rounding and overflow rules before implementation.
- Container-network exposure and a one-command full-stack launcher remain follow-up work after real authentication; the backend Dockerfile alone does not implement those features.
