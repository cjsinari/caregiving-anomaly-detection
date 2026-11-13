-- Account recovery (issue #43)
--
-- Recovery reuses the existing otps table rather than adding one: a recovery
-- code is an OTP, it is bound to the same account, and it must share the same
-- rate limit and attempt counter as every other code for that account. A
-- separate table would have handed an attacker a second, independent budget of
-- guesses against the same user.
--
-- So the only thing that is new is a purpose value: 'recovery'.
--
-- Idempotent, and safe whether or not the live table constrains `purpose`.
-- The original otps table predates the migrations kept in this folder, so
-- whether it carries a CHECK on that column cannot be read from this repo.
-- This finds out at run time instead of assuming.

BEGIN;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  -- Any CHECK constraint on otps that mentions the purpose column.
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'otps'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%purpose%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE otps DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Dropped the existing purpose constraint (%) to add the recovery purpose.', constraint_name;
  END IF;
END $$;

-- Re-stated explicitly, so the set of purposes is visible in one place and a
-- typo in application code fails loudly at the database rather than silently
-- creating codes that nothing will ever look for.
--
-- NOT VALID: existing rows are not re-checked. They were written by code that
-- only ever used these values, and validating a large otps table would hold a
-- lock for no benefit. New rows are checked from here on.
ALTER TABLE otps
  ADD CONSTRAINT otps_purpose_check
  CHECK (purpose IN ('login', 'registration', 'step_up', 'recovery'))
  NOT VALID;

COMMIT;

-- Environment, for the email channel this issue introduces. Recovery exists for
-- someone who cannot receive an SMS, so a recovery code that can only be texted
-- is no recovery at all.
--
--   SMTP_HOST=smtp.example.com
--   SMTP_PORT=587                      -- 465 switches to implicit TLS
--   SMTP_USER=...                      -- omit both to send unauthenticated
--   SMTP_PASS=...
--   SMTP_FROM=LindaCare <no-reply@lindacare.co.ke>
--
-- With SMTP_HOST unset, or with OTP_DEV_MODE=true, the code is printed to the
-- console instead of sent, exactly as SMS already is. The whole recovery flow
-- therefore runs locally with no mail account.
