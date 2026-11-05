-- Step 2 migration: hashed OTPs, attempt counting, phone verification, consent, temporary lock

-- OTPs are stored as HMAC-SHA256 hex digests (64 chars), never as plaintext (NFR06)
ALTER TABLE otps ALTER COLUMN otp_code TYPE VARCHAR(64);
ALTER TABLE otps ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP;      -- Kenya DPA 2019 consent (NFR09)
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;    -- temporary lockout after failed OTPs (FR04)

-- Indexes for the lookups used by OTP rate limiting, session checks and (next step) login velocity
CREATE INDEX IF NOT EXISTS idx_otps_lookup ON otps (phone_number, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions (user_id, session_status);
CREATE INDEX IF NOT EXISTS idx_login_events_user_time ON login_events (user_id, login_time DESC);