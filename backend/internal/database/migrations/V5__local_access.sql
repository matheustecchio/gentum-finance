-- One explicitly configured local ledger per installation. Existing owners remain intact.
CREATE TABLE local_access (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    user_id UUID NOT NULL UNIQUE REFERENCES gentum_user(id),
    pin_salt TEXT NOT NULL DEFAULT '',
    pin_hash TEXT NOT NULL DEFAULT '',
    recovery_hash TEXT NOT NULL DEFAULT '',
    CHECK ((pin_hash = '' AND pin_salt = '' AND recovery_hash = '') OR
           (pin_hash <> '' AND pin_salt <> '' AND recovery_hash <> ''))
);

-- Installation-wide counters survive browser and server restarts.
CREATE TABLE local_access_attempt (
    purpose TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
    retry_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
