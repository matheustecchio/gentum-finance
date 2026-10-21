-- Only the installation's original database acts as the authoritative registry.
CREATE TABLE local_database (
 id UUID PRIMARY KEY,
 name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100 AND name=btrim(name)),
 physical_name TEXT NOT NULL UNIQUE,
 is_default BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX local_database_name ON local_database(lower(name));
CREATE UNIQUE INDEX local_database_default ON local_database(is_default) WHERE is_default;
CREATE TABLE local_database_selection (
 token_hash TEXT PRIMARY KEY,
 database_id UUID NOT NULL REFERENCES local_database(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE local_installation_attempt (
 purpose TEXT PRIMARY KEY,
 failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
 retry_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
