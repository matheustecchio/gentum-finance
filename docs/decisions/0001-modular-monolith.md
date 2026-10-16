# ADR 0001: Use a domain-oriented modular monolith

- Status: accepted; backend technology and money representation superseded by ADR 0003
- Date: 2026-08-30

## Context

Gentum Finance needs to demonstrate Java, Spring, GraphQL, PostgreSQL, and React while remaining understandable and inexpensive to operate. The MVP domains will interact frequently and do not yet have independent scaling, deployment, or ownership needs.

## Decision

Use a monorepo with one React frontend and one deployable Spring Boot backend. Organize backend code by domain module, and within a module direct dependencies from GraphQL to application to domain to an infrastructure adapter. Persist all modules in one PostgreSQL database whose schema is managed by Flyway.

Start with an account vertical slice before implementing other domains. Use interfaces at boundaries that provide real separation, such as the domain repository and current-user provider, without creating an interface for every class.

## Consequences

- A complete feature can be traced through one repository and deployed as one backend.
- Domain boundaries are explicit enough to test and evolve independently.
- Transactions across modules remain straightforward.
- Modules share a runtime and database, so boundaries require code review rather than network isolation.
- A service extraction is possible later, but only a demonstrated operational need should justify it.

Microservices, Kafka, and Kubernetes are explicitly deferred.

## Technology update

[ADR 0003](0003-go-backend-and-integer-cents.md) replaces Java/Spring/Flyway with Go and embedded SQL migrations. The modular-monolith and local-first decisions remain in force.
