-- Observations start when Overview is opened. Never infer earlier balances.
CREATE TABLE wealth_observation (
    user_id UUID NOT NULL REFERENCES gentum_user(id),
    observed_on DATE NOT NULL,
    balances JSONB NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, observed_on)
);
