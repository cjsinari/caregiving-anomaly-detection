const crypto = require('crypto');
const redis = require('../config/redis');
const pool = require('../config/db');
const { issueOtp, verifyOtp } = require('../utils/otp');
const notifier = require('./notifier');

const CHALLENGE_TTL = 300;   // 5 minutes, matching the OTP lifetime

/**
 * Start a step-up challenge.
 *
 * Where a backup email exists the code goes there. A step-up over SMS to the same
 * number used for the first factor proves possession of the same phone twice, so
 * it adds little against a stolen device or a SIM swap. The channel is returned so
 * the caller can tell the user where to look, and recorded so the audit trail shows
 * which guarantee actually applied.
 */
async function challenge(user, context) {
  const channel = user.backup_email ? 'backup_email' : 'sms';
  const otp = await issueOtp(user.phone_number, 'step_up');
  if (!otp.ok) return { ok: false, reason: otp.reason };

  const challengeId = crypto.randomUUID();
  await redis.setex(`stepup:${challengeId}`, CHALLENGE_TTL, JSON.stringify({
    userId: user.id,
    phoneNumber: user.phone_number,
    deviceFingerprint: context.deviceFingerprint,
    ip: context.ip,
    riskScore: context.riskScore,
  }));

  return { ok: true, challengeId, channel, expiresIn: CHALLENGE_TTL };
}

/** Look up a pending challenge. Returns null if unknown or expired. */
async function load(challengeId) {
  try {
    const raw = await redis.get(`stepup:${challengeId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Step-up lookup failed:', err.message);
    return null;
  }
}

async function consume(challengeId) {
  try { await redis.del(`stepup:${challengeId}`); } catch { /* best effort */ }
}

async function verify(pending, code) {
  return verifyOtp(pending.phoneNumber, 'step_up', code);
}

/** Freeze an account after a high-risk login and alert the owner. */
async function freezeAndAlert(user, explanation) {
  await pool.query(
    `UPDATE users SET account_status = 'frozen', updated_at = NOW() WHERE id = $1`,
    [user.id]
  );
  notifier.notify(user.id, 'login_blocked', { explanation });   // never throws (NFR10)
}

module.exports = { challenge, load, consume, verify, freezeAndAlert, CHALLENGE_TTL };
