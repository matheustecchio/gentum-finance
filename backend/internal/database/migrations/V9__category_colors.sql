ALTER TABLE category ADD COLUMN color VARCHAR(7) NOT NULL DEFAULT '#467644' CHECK (color ~ '^#[0-9a-fA-F]{6}$');
UPDATE category SET color = '#' || substr(md5(id::text), 1, 6);
ALTER TABLE category ALTER COLUMN color SET DEFAULT ('#' || substr(md5(random()::text), 1, 6));
