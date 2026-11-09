-- Module 4: session anomaly detection (impossible travel, API velocity, notifications)

-- Where the session was last seen. Updated on token refresh when the client IP
-- geolocates; the impossible-travel checks compare against it.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_ip VARCHAR(45);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;

-- session_status = 'flagged' already exists; record why and when.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS flagged_reason VARCHAR(50);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMP;

-- Security notifications: the in-app inbox plus the outcome of SMS delivery.
-- 'suppressed' means the per-event cooldown held the SMS back; the inbox row
-- is still written so every occurrence is visible to the user.
-- user_id is the recipient; subject_user_id is the account the event concerns
-- (the same for owner alerts, different for administrator alerts).
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'medium', 'high', 'critical')),
  message TEXT NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'sms',
  delivery_status VARCHAR(20) NOT NULL
    CHECK (delivery_status IN ('sent', 'failed', 'suppressed', 'skipped', 'dev_logged')),
  delivery_error VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  read_at TIMESTAMP
);

-- For databases that ran an earlier draft of this migration
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_seen
  ON sessions (user_id, (COALESCE(last_seen_at, created_at)) DESC);
