-- Milestone 3 completion: risk scoring, device trust, location history
--
-- The model moved from coordinate-based geo features to country/city consistency
-- when the RBA dataset turned out to have no lat/lon. login_events never followed,
-- so there is nowhere to compute is_known_country / is_known_city from.

ALTER TABLE login_events ADD COLUMN IF NOT EXISTS country VARCHAR(2);
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS city VARCHAR(100);

-- Devices a user has verified via step-up. "Seen before" is not the same as
-- "trusted": a device becomes trusted only after passing a challenge, or by being
-- the device used at registration (already OTP-verified at that point).
CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint VARCHAR(255) NOT NULL,
  device_label VARCHAR(100),
  trusted_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, device_fingerprint)
);

-- anomaly_scores records what the model said; these columns record what the
-- system then did, and whether the model governed the decision at all.
ALTER TABLE anomaly_scores ADD COLUMN IF NOT EXISTS action VARCHAR(20);
ALTER TABLE anomaly_scores ADD COLUMN IF NOT EXISTS governed_by VARCHAR(20);
ALTER TABLE anomaly_scores ADD COLUMN IF NOT EXISTS cold_start BOOLEAN DEFAULT FALSE;
ALTER TABLE anomaly_scores ADD COLUMN IF NOT EXISTS model_available BOOLEAN DEFAULT TRUE;
ALTER TABLE anomaly_scores ADD COLUMN IF NOT EXISTS features JSONB;

CREATE INDEX IF NOT EXISTS idx_login_events_user_success
  ON login_events (user_id, was_successful, login_time DESC);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_lookup
  ON trusted_devices (user_id, device_fingerprint);
