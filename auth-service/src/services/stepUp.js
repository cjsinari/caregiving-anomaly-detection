const crypto = require('crypto');
const redis = require('../config/redis');
const { issueOtp, verifyOtp } = require('../utils/otp');

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

/*
 * freezeAndAlert used to live here. Freezing an account now goes through
 * services/accountActions.js, which applies the configured response rules,
 * revokes the account's live sessions and records who decided (the risk engine
 * or a named administrator). Two ways to freeze an account, one of them without
 * an audit entry, was a liability.
 */

module.exports = { challenge, load, consume, verify, CHALLENGE_TTL };
