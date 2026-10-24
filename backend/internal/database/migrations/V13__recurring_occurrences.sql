ALTER TABLE recurring ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','fortnightly','monthly','yearly'));
ALTER TABLE recurring ADD COLUMN mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','automatic'));
ALTER TABLE recurring ADD COLUMN anchor_month INT NOT NULL DEFAULT 1 CHECK (anchor_month BETWEEN 1 AND 12);
UPDATE recurring SET anchor_month=extract(month FROM next_date);

ALTER TABLE entry ADD CONSTRAINT entry_owner_key UNIQUE(user_id,id);
CREATE TABLE recurring_occurrence (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL,
 recurring_id UUID NOT NULL,
 due_date DATE NOT NULL,
 account_id UUID NOT NULL,
 category_id UUID NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('INCOME','EXPENSE')),
 amount BIGINT NOT NULL CHECK (amount>0),
 description VARCHAR(200) NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','skipped','linked')),
 entry_id UUID UNIQUE,
 FOREIGN KEY(user_id,entry_id) REFERENCES entry(user_id,id),
 UNIQUE(recurring_id,due_date),
 UNIQUE(user_id,id),
 FOREIGN KEY(user_id,recurring_id) REFERENCES recurring(user_id,id),
 FOREIGN KEY(user_id,account_id) REFERENCES account(user_id,id),
 FOREIGN KEY(user_id,category_id) REFERENCES category(user_id,id),
 CHECK ((status IN ('posted','linked')) = (entry_id IS NOT NULL))
);
CREATE INDEX recurring_occurrence_owner_status ON recurring_occurrence(user_id,status,due_date);
INSERT INTO recurring_occurrence(id,user_id,recurring_id,due_date,account_id,category_id,kind,amount,description,status,entry_id)
 SELECT id,user_id,recurring_id,entry_date,account_id,category_id,kind,amount,description,'posted',id FROM entry WHERE recurring_id IS NOT NULL;

-- Actual bank dates may be shared by distinct scheduled occurrences.
-- Idempotency now belongs to recurring_occurrence(recurring_id,due_date).
ALTER TABLE entry DROP CONSTRAINT entry_recurring_id_entry_date_key;
