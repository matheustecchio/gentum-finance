-- Public ECB quotes only. Every loaded set is validated before use.
CREATE TABLE reference_rate_cache (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    rates JSONB NOT NULL
);
