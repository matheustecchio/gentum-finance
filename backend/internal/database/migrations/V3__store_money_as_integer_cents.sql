-- Never silently round pre-existing financial data.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM account WHERE initial_balance * 100 <> trunc(initial_balance * 100)) THEN
        RAISE EXCEPTION 'Cannot convert balances containing fractions of a cent; resolve them explicitly before migration';
    END IF;
END $$;

ALTER TABLE account ALTER COLUMN initial_balance TYPE BIGINT USING (initial_balance * 100)::BIGINT;
