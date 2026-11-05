const pool = require('../config/db');

/** Has this user verified this device before? */
async function isTrusted(userId, fingerprint) {
  if (!fingerprint) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM trusted_devices WHERE user_id = $1 AND device_fingerprint = $2`,
    [userId, fingerprint]
  );
  return rows.length > 0;
}

/**
 * Mark a device trusted. Called after registration (the device completed an OTP)
 * and after a successful step-up, so a user is challenged once per device rather
 * than once per login
 */
async function trust(userId, fingerprint, label = null) {
  if (!fingerprint) return;
  await pool.query(
    `INSERT INTO trusted_devices (user_id, device_fingerprint, device_label)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, device_fingerprint)
     DO UPDATE SET last_seen_at = NOW()`,
    [userId, fingerprint, label]
  );
}

async function touch(userId, fingerprint) {
  if (!fingerprint) return;
  await pool.query(
    `UPDATE trusted_devices SET last_seen_at = NOW()
     WHERE user_id = $1 AND device_fingerprint = $2`,
    [userId, fingerprint]
  );
}

async function list(userId) {
  const { rows } = await pool.query(
    `SELECT id, device_fingerprint, device_label, trusted_at, last_seen_at
     FROM trusted_devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
    [userId]
  );
  return rows;
}

async function revoke(userId, deviceId) {
  const { rowCount } = await pool.query(
    `DELETE FROM trusted_devices WHERE id = $1 AND user_id = $2`,
    [deviceId, userId]
  );
  return rowCount > 0;
}

module.exports = { isTrusted, trust, touch, list, revoke };