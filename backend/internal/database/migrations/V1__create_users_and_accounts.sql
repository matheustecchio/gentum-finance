CREATE TABLE ledger_user (
    id UUID PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    base_currency VARCHAR(3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE account (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES ledger_user (id),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(32) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    initial_balance NUMERIC(19, 4) NOT NULL,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT account_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT account_currency_iso_shape CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX account_user_id_created_at_idx ON account (user_id, created_at);

INSERT INTO ledger_user (
    id,
    email,
    display_name,
    base_currency,
    created_at,
    updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'developer@ledger.local',
    'Ledger Developer',
    'EUR',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
