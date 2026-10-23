CREATE TABLE csv_import_job (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES gentum_user(id),
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','committed','failed','cancelled')),
    total INTEGER NOT NULL CHECK (total BETWEEN 1 AND 100000),
    processed INTEGER NOT NULL DEFAULT 0,
    cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
    message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,id)
);
CREATE UNIQUE INDEX csv_import_active_file ON csv_import_job(user_id,fingerprint)
    WHERE status IN ('running','committed');
CREATE TABLE csv_import_request (
    user_id UUID NOT NULL,
    request_id UUID NOT NULL,
    job_id UUID NOT NULL,
    FOREIGN KEY(user_id,job_id) REFERENCES csv_import_job(user_id,id),
    PRIMARY KEY(user_id,request_id)
);
