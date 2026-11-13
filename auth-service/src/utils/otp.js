const crypto = require('crypto');
const pool = require('../config/db');
const { sendOTP } = require('./sms');
const { sendOtpEmail } = require('./mailer');

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES) || 5; // FR02
const MAX_REQUESTS = 3;        // FR03: max OTP requests per phone...
const WINDOW_MINUTES = 15;     // ...within this window
const MAX_ATTEMPTS = 5;        // FR04: wrong guesses allowed per OTP

// Dev mode prints the OTP to the console INSTEAD of sending it, and is
// disabled whenever NODE_ENV=production.
//
// This comment used to say the code was printed "because the Africa's Talking
// sandbox does not deliver real SMS". That assumption was wrong and it is what
// hid the bug below: the configured account delivers, so every development
// sign-in was both printing the code and paying to text it to the number's real
// owner.
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
 * Returns { ok: true, channel } | { ok: false, reason: 'rate_limited' | 'delivery_failed' }
 *
 * -- The channel, and why the code is still keyed on the phone number --
 *
 * `channel` decides where the code is delivered; it does not change what the
 * code is bound to. The otps row stays keyed on the account's phone number,
 * because that is the account's identity here and because it keeps one rate
 * limit, one attempt counter and one "newest code wins" rule per account
 * however the code was delivered. Keying an emailed code on the email address
 * instead would hand someone two independent budgets of attempts against the
 * same account.
 *
 * This matters for recovery, where the phone is exactly what the person no
 * longer has: the code is bound to their number and sent to their inbox.
 */
async function issueOtp(phone, purpose, { channel = 'sms', email = null } = {}) {
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

  /*
   * In development the code goes to the console INSTEAD of being sent, not as
   * well as.
   *
   * It used to be as well as: DEV_MODE printed the code and then fell through
   * to sendOTP regardless, so every local sign-in and every test run sent a
   * real SMS through Africa's Talking — costing money per message and
   * delivering a verification code to whoever actually owns that number. A
   * seeded test account on a plausible-looking number is still somebody's
   * number.
   *
   * services/notifier.js already worked this way (`DEV_MODE ? devTransport :
   * smsTransport`), so the security alerts were correctly suppressed while the
   * OTPs were not — the inconsistency is what hid it.
   *
   * Returning ok here keeps the dev contract unchanged: DEV_MODE already
   * treated a delivery failure as success, because the code was on the console
   * either way.
   */
  if (DEV_MODE) {
    /*
     * The channel goes after the code, not inside the brackets.
     *
     * runtest.js scrapes this line to drive the end-to-end suite, with
     * /\[DEV\] OTP for (\S+) \((\w+)\): (\d{6})/. Putting the channel in the
     * bracketed group breaks that match, and the whole suite then fails on a
     * missing OTP rather than on anything real.
     */
    console.log(`[DEV] OTP for ${phone} (${purpose}): ${code}`
      + ` via ${channel}${email ? ` to ${email}` : ''}`);
    return { ok: true, channel };
  }

  try {
    if (channel === 'email') {
      /*
       * No address is a configuration fault, not a delivery failure, and it
       * must not fall back to SMS. The caller chose email because the person
       * cannot receive a text; texting the code to the number they have lost
       * would send a working credential to whoever holds that SIM now.
       */
      if (!email) throw new Error('an email channel was requested with no address');
      await sendOtpEmail(email, code, purpose);
    } else {
      await sendOTP(phone, code);
    }
  } catch (err) {
    // NFR10: log, don't crash.
    console.error(`OTP delivery failed over ${channel}:`, err.message);
    return { ok: false, reason: 'delivery_failed' };
  }
  return { ok: true, channel };
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
