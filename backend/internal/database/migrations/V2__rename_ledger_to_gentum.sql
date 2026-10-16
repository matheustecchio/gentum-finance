-- Preserve V1 checksums for existing installations.
ALTER TABLE ledger_user RENAME TO gentum_user;
ALTER TABLE gentum_user RENAME CONSTRAINT ledger_user_pkey TO gentum_user_pkey;
ALTER TABLE gentum_user RENAME CONSTRAINT ledger_user_email_key TO gentum_user_email_key;

UPDATE gentum_user
SET email = 'developer@gentum.local', display_name = 'Gentum Finance Developer'
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND email = 'developer@ledger.local'
  AND display_name = 'Ledger Developer';
