const crypto = require('crypto');
const pool = require('../config/db');
const { sendOTP } = require('./sms');

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES) || 5; // FR02
const MAX_REQUESTS = 3;        // FR03: max OTP requests per phone...
const WINDOW_MINUTES = 15;     // ...within this window
const MAX_ATTEMPTS = 5;        // FR04: wrong guesses allowed per OTP

// Dev mode prints the OTP to the console because the Africa's Talking sandbox
// does not deliver real SMS. Disabled whenever NODE_ENV=production.
const DEV_MODE = process.env.OTP_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';

/** Cryptographically secure 6-digit code (keeps leading zeros). */
const generateOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * HMAC-SHA256 keyed with a server secret and bound to phone + purpose.
 * A plain hash of a 6-digit code could be brute-forced offline from a DB leak;
 * the secret key prevents that (NFR06).
 */
function hashOtp(phone, purpose, code) {
  return crypto
    .createHmac('sha256', process.env.OTP_SECRET)
    .update(`${phone}:${purpose}:${code}`)
    .digest('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Create and send a new OTP. Enforces the per-phone rate limit using the otps
 * table itself, so the limit survives restarts and does not depend on Redis.
 * Returns { ok: true } | { ok: false, reason: 'rate_limited' | 'delivery_failed' }
 */
async function issueOtp(phone, purpose) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM otps
     WHERE phone_number = $1 AND created_at > NOW() - make_interval(mins => $2::int)`,
    [phone, WINDOW_MINUTES]
  );
  if (rows[0].n >= MAX_REQUESTS) return { ok: false, reason: 'rate_limited' };

  const code = generateOtp();

  // Only the newest code for this phone + purpose may be used
  await pool.query(
    `UPDATE otps SET is_used = TRUE WHERE phone_number = $1 AND purpose = $2 AND is_used = FALSE`,
    [phone, purpose]
  );
  await pool.query(
    `INSERT INTO otps (phone_number, otp_code, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4::int))`,
    [phone, hashOtp(phone, purpose, code), purpose, OTP_TTL_MINUTES]
  );

  if (DEV_MODE) console.log(`[DEV] OTP for ${phone} (${purpose}): ${code}`);

  try {
    await sendOTP(phone, code);
  } catch (err) {
    console.error('SMS delivery failed:', err.message); // NFR10: log, don't crash
    if (!DEV_MODE) return { ok: false, reason: 'delivery_failed' };
  }
  return { ok: true };
}

/**
 * Check a submitted code. Every check consumes an attempt (atomically, in SQL),
 * the code is single-use, and it is burned after MAX_ATTEMPTS wrong guesses.
 * Returns { ok: true } | { ok: false, reason: 'invalid_or_expired' | 'wrong_code' | 'too_many_attempts', attemptsLeft? }
 */
async function verifyOtp(phone, purpose, code) {
  const { rows } = await pool.query(
    `SELECT id, otp_code FROM otps
     WHERE phone_number = $1 AND purpose = $2 AND is_used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose]
  );
  if (!rows.length) return { ok: false, reason: 'invalid_or_expired' };
  const otp = rows[0];

  const bump = await pool.query(
    `UPDATE otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
    [otp.id]
  );
  const attempts = bump.rows[0].attempts;

  if (attempts > MAX_ATTEMPTS) {
    await pool.query(`UPDATE otps SET is_used = TRUE WHERE id = $1`, [otp.id]);
    return { ok: false, reason: 'too_many_attempts' };
  }

  if (!safeEqual(otp.otp_code, hashOtp(phone, purpose, code))) {
    if (attempts >= MAX_ATTEMPTS) {
      await pool.query(`UPDATE otps SET is_used = TRUE WHERE id = $1`, [otp.id]);
      return { ok: false, reason: 'too_many_attempts' };
    }
    return { ok: false, reason: 'wrong_code', attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  // Single-use: the UPDATE only succeeds for the first request that consumes it
  const consumed = await pool.query(
    `UPDATE otps SET is_used = TRUE WHERE id = $1 AND is_used = FALSE RETURNING id`,
    [otp.id]
  );
  if (!consumed.rowCount) return { ok: false, reason: 'invalid_or_expired' };
  return { ok: true };
}

module.exports = { issueOtp, verifyOtp, MAX_ATTEMPTS };
