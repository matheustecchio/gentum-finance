# ADR 0005: Local profile with an optional PIN

Status: Accepted

## Context

Gentum's immediate scope is free, open-source financial tracking on one person's own machine. An email registration flow adds unnecessary steps. A paid hosted synchronization service may be considered later; no cloud account, sync engine, billing, or hosting is included in this change.

## Decision

Use one configured local ledger per installation. On first opening, choose direct access or a four-digit PIN. Direct access opens automatically on later visits. PIN protection can be enabled, changed, or disabled in Settings; changing or disabling it requires the current PIN. Lock now revokes all browser sessions for the installation. Other open tabs refresh their state on access-change events or when focused; subsequent financial requests from revoked sessions are rejected.

Keep server-issued, hashed, HttpOnly, SameSite Strict session cookies and server-derived ownership even in direct-access mode. Direct access obtains a session through a same-origin JSON POST. PIN sessions use a browser-session cookie, expire server-side after 24 hours, and may remain available across page reloads or browser session restoration. Users should use Lock now before leaving a protected ledger unattended. A PIN protects casual access through the application; it does not encrypt the database, resist an attacker controlling the operating system, or secure an exposed server. Keep the Compose frontend on loopback and Go/PostgreSQL internal.

Store PINs with individual salts and PBKDF2-SHA256, 600,000 iterations. Bound hashing concurrency. Store installation-wide failed-attempt counters and retry times in PostgreSQL, serialized with access changes. After five failures, wait one minute; subsequent failures double the wait up to 16 minutes. Correct PIN verification resets its counter. Recovery and legacy adoption have separate counters. This protects all clients together and survives service restarts.

Generate a random 160-bit recovery code when a PIN is created, changed, or recovered. Display it once with copy/download options and acknowledgement before entering the ledger. Store only its SHA-256 digest. Recovery requires the code and a new four-digit PIN, preserves financial records, revokes every previous session, and generates a replacement recovery code. Previous codes stop working. Do not use security questions, email recovery, or a hidden application bypass. If both PIN and recovery code are lost, this version has no supported reset flow; a local administrator can still access the unencrypted PostgreSQL database.

## Existing data

V5 adds configuration and persistent attempt tables without modifying applied migrations or deleting owners or financial records. When password profiles already exist, first setup requires one existing email/password to select that owner. The chosen owner and all of its ledger records remain unchanged; other owners remain stored separately and are not merged or selectable through this single-profile UI. Export or back up other profiles before upgrading if continued UI access to them is needed. When no password profiles exist, setup explicitly adopts the original local development owner, preserving any records associated with it. The runtime resolves ownership through the configured local profile and verified sessions, not the development identity provider.

Legacy registration/login/logout endpoints are removed. Old sessions cannot authorize financial access until setup selects a local profile, and setup revokes them all. Legacy credentials are used only during initial adoption; later authentication uses optional PIN protection.

## Consequences

The app works locally without an online identity or subscription. Authentication transport changes; the GraphQL finance and integer-cent contracts remain unchanged. Tests cover PIN validation, persistent throttling, concurrent setup, session revocation, recovery-code rotation, data preservation, browser flows, and launcher restart persistence. Browser and persistence tests require an explicitly disposable stack because they now share the installation's single local ledger.
