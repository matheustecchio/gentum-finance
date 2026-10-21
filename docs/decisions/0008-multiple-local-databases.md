# 0008: Multiple local PostgreSQL databases

Accepted for issue #33.

Keep a registry in the original configured database. Register that database without adopting any legacy owner. Each additional ledger uses a generated physical database name and the same append-only migrations. Display names never enter SQL identifiers. Publish a registry entry only after migration and local-access setup succeed.

Use a separate provisioning connection with CREATEDB and membership in the financial role. Financial connections must not have CREATEDB or superuser privileges. PostgreSQL owns persistence in the existing local volume. Provisioning credentials stay on the server.

A persistent random HttpOnly cookie identifies a browser's selected registry entry. The existing expiring session cookie is validated inside that selected physical database. Switching obtains a new session from the target before changing selection. Browser operations are serialized with a PostgreSQL advisory lock, and clients bind requests to X-Gentum-Database so stale writes fail with 409. Installation-wide authentication failure counters live in the original database and survive switches and restarts.

Open and migrate registered databases at startup. An unavailable registered database blocks startup rather than serving an old schema. No database deletion, cloning, external adoption, or encryption is included.
