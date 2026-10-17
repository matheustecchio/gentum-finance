-- Support bounded chronological browsing without loading ledger history.
CREATE INDEX entry_history_order ON entry(user_id, entry_date DESC, created_at DESC, id DESC);
