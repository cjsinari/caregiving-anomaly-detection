-- Issue #46: the account's own settings, from the mobile app.
--
-- Three additions, each for one thing the app can now do:
--
--   1. A new OTP purpose, 'phone_change'.
--      The phone number is how this account signs in -- sign-in is strictly by
--      SMS code -- so changing it is changing the credential. It is confirmed
--      by two codes: one to the number on the account (proving the person who
--      owns the account wants this) and one to the new number (proving they
--      hold it). See accountController.js for why both are needed.
--
--   2. users.notification_prefs.
--      Which kinds of care notification this person wants pushed to them. On
--      the server rather than only on the phone, because whatever sends the
--      push is on the server and has to be able to read it.
--
--   3. push_tokens.
--      The addresses the platform can push to. Bound to a session as well as
--      to a user, so that ending the session -- a logout, an administrator
--      revoking it, the risk engine flagging it -- is what stops the pushes.
--      A token that outlives the session it was registered under would keep
--      delivering one person's care alerts to a phone that has since been
--      signed out, or handed to somebody else.
--
-- Idempotent: safe to run more than once, and safe whether or not the live
-- otps table already constrains `purpose`.

BEGIN;

-- ── 1. the purpose ──────────────────────────────────────────────────────────

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'otps'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%purpose%'
  LOOP
    EXECUTE format('ALTER TABLE otps DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE otps
  ADD CONSTRAINT otps_purpose_check
  CHECK (purpose IN ('login', 'registration', 'step_up', 'recovery', 'phone_change'));

-- ── 2. notification preferences ─────────────────────────────────────────────

-- An empty object means "everything on". A category only exists in here once
-- somebody has switched it off, so adding a new category later needs no
-- backfill: every existing account simply receives it.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 3. push tokens ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id   UUID REFERENCES sessions(id) ON DELETE SET NULL,
  token        TEXT NOT NULL,
  provider     TEXT NOT NULL CHECK (provider IN ('expo', 'fcm', 'apns')),
  platform     TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ
);

-- One live row per token. A token is a device address, not a person: when the
-- same phone registers under a different account, the old row is revoked and
-- a new one written, rather than two accounts both claiming one handset.
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_live_token
  ON push_tokens (token) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS push_tokens_by_user
  ON push_tokens (user_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS push_tokens_by_session
  ON push_tokens (session_id) WHERE revoked_at IS NULL;

COMMIT;
