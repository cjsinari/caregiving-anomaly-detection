const { z } = require('zod');
const pool = require('../config/db');
const { toE164 } = require('../utils/phone');
const { parse } = require('../utils/validate');
const { issueOtp, verifyOtp } = require('../utils/otp');
const { logEvent } = require('../utils/audit');
const sessionStore = require('../services/sessionStore');
const notifier = require('../services/notifier');
const pushTokens = require('../services/pushTokens');
const { categoriesFor, alwaysOnFor } = require('../data/notificationCategories');

/*
 * The signed-in person's own account: issue #46.
 *
 *   PATCH /auth/me                     their name
 *   POST  /auth/me/phone/request       start changing their phone number
 *   POST  /auth/me/phone/verify        finish it, with two codes
 *   GET   /auth/me/preferences         which pushes they want
 *   PUT   /auth/me/preferences
 *   POST  /auth/push-tokens            register this device for pushes
 *   DELETE /auth/push-tokens           stop pushing to it
 *
 * Every route runs behind verifyToken, so `req.user` is the caller and every
 * change is to the caller's own row. There is no route here that takes a user
 * id: an endpoint that accepts "whose account" is an endpoint that can be
 * pointed at somebody else's.
 *
 * ── There is no password to change ──
 *
 * Issue #46 mentions a password-change screen. This platform has no passwords
 * -- sign-in is strictly by SMS code (#42), recovery by a code to a second
 * contact (#43) -- so there is nothing for that screen to change. The
 * credential is the phone number, and changing *that* is what the phone
 * routes below do, with the care a credential change deserves.
 *
 * ── Why a wrong code is a 422 here and not a 401 ──
 *
 * The sign-in routes answer a wrong code with 401, which is right for them:
 * they are unauthenticated. These routes are authenticated, and the app reads
 * a 401 on an authenticated call as "your access token expired" -- it
 * refreshes the session and replays the request. Replaying a code check
 * spends a second attempt of the five on a code the person typed once, and
 * rotates their session for no reason. 422 says what is true: the session is
 * fine, the code is not.
 */

const OTP_FIELD = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');

/** The shape every account response shares with GET /auth/me. */
async function loadMe(userId) {
  const { rows } = await pool.query(
    `SELECT id, full_name, phone_number, email, backup_email, role, account_status, verification_status
     FROM users WHERE id = $1`,
    [userId]
  );
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id,
    fullName: u.full_name,
    phoneNumber: u.phone_number,
    email: u.email,
    backupEmail: u.backup_email,
    role: u.role,
    accountStatus: u.account_status,
    verificationStatus: u.verification_status,
  };
}

/* ─────────────────────────── name ─────────────────────────── */

const profileSchema = z.object({
  // The same rule registration applies, so an edit cannot produce a name
  // registration would have refused.
  fullName: z.string().trim().min(2).max(100),
}).strict();

/** PATCH /auth/me */
async function updateProfile(req, res) {
  const data = parse(profileSchema, req.body, res);
  if (!data) return;
  try {
    const { rowCount } = await pool.query(
      `UPDATE users SET full_name = $2, updated_at = NOW() WHERE id = $1`,
      [req.user.id, data.fullName]
    );
    if (!rowCount) return res.status(404).json({ error: 'Account not found.' });

    // The field changed is recorded, not its value: the audit trail is read
    // by administrators and has no need of the name itself.
    await logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'profile_updated',
      severity: 'info', actorType: 'user', resourceType: 'account', resourceId: req.user.id,
      action: 'update', decision: 'allow', ip: req.ip, detail: { fields: ['fullName'] },
    });

    return res.status(200).json({ user: await loadMe(req.user.id) });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ error: 'Could not save your details. Please try again.' });
  }
}

/* ─────────────────────────── phone number ─────────────────────────── */

/*
 * Changing the phone number is changing how this account signs in, so it is
 * confirmed by two codes, sent at the same moment:
 *
 *   one to the number on the account now -- proving that the person who owns
 *   the account wants this. Without it, anyone holding a stolen session could
 *   move the account onto their own number and lock the owner out for good:
 *   the owner's next sign-in would send its code to the thief.
 *
 *   one to the new number -- proving the person can receive on it. Without
 *   it, a typo moves the account onto a stranger's phone, and the owner's next
 *   sign-in sends its code to that stranger.
 *
 * A code arriving unasked on the current number is also the owner's alarm: it
 * says somebody is trying, before anything has changed.
 *
 * Someone who has lost the old number entirely uses account recovery (#43) to
 * get back in first; that route is designed for exactly that situation.
 */

const phoneRequestSchema = z.object({ phoneNumber: z.string().min(9).max(20) }).strict();
const phoneVerifySchema = z.object({
  phoneNumber: z.string().min(9).max(20),
  currentCode: OTP_FIELD,
  newCode: OTP_FIELD,
}).strict();

function asE164(raw, res) {
  try {
    return toE164(raw);
  } catch {
    res.status(400).json({
      error: 'Enter a valid mobile number.',
      code: 'VALIDATION_ERROR',
      details: [{ field: 'phoneNumber', message: 'Enter a valid mobile number' }],
    });
    return null;
  }
}

async function phoneInUse(phone, userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM users WHERE phone_number = $1 AND id <> $2 LIMIT 1',
    [phone, userId]
  );
  return rows.length > 0;
}

/** POST /auth/me/phone/request */
async function requestPhoneChange(req, res) {
  const data = parse(phoneRequestSchema, req.body, res);
  if (!data) return;
  const next = asE164(data.phoneNumber, res);
  if (!next) return;

  try {
    const me = await loadMe(req.user.id);
    if (!me) return res.status(404).json({ error: 'Account not found.' });

    if (next === me.phoneNumber) {
      return res.status(400).json({
        error: 'That is already the number on your account.',
        code: 'PHONE_UNCHANGED',
        details: [{ field: 'phoneNumber', message: 'That is already your number' }],
      });
    }
    /*
     * Said plainly. Registration already answers ALREADY_REGISTERED for a
     * taken number, so this reveals nothing that endpoint does not; and the
     * alternative -- pretending to send a code that never arrives -- strands
     * a real person who typed a number they own on another account.
     */
    if (await phoneInUse(next, req.user.id)) {
      return res.status(409).json({
        error: 'That number is already used by another account.',
        code: 'PHONE_IN_USE',
        details: [{ field: 'phoneNumber', message: 'Already used by another account' }],
      });
    }

    const toCurrent = await issueOtp(me.phoneNumber, 'phone_change');
    if (!toCurrent.ok) return issueFailure(res, toCurrent.reason);
    const toNew = await issueOtp(next, 'phone_change');
    if (!toNew.ok) return issueFailure(res, toNew.reason);

    await logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'phone_change_requested',
      severity: 'medium', actorType: 'user', resourceType: 'account', resourceId: req.user.id,
      action: 'request', decision: 'allow', ip: req.ip,
      detail: { to: notifier.maskPhone(next) },
      explanation: 'A phone number change was started. Codes were sent to the current number and to the new one.',
    });

    return res.status(200).json({
      message: 'We have sent a code to your current number and another to the new one.',
      currentNumber: notifier.maskPhone(me.phoneNumber),
      newNumber: notifier.maskPhone(next),
    });
  } catch (err) {
    console.error('requestPhoneChange error:', err);
    return res.status(500).json({ error: 'Could not start the change. Please try again.' });
  }
}

function issueFailure(res, reason) {
  if (reason === 'rate_limited') {
    return res.status(429).json({
      error: 'Too many codes requested. Please try again in 15 minutes.',
      code: 'OTP_RATE_LIMITED',
      retryAfterSeconds: 15 * 60,
    });
  }
  return res.status(503).json({
    error: 'We could not send the verification codes. Please try again shortly.',
    code: 'OTP_DELIVERY_FAILED',
  });
}

/*
 * One failed code. 422, never 401 -- see the note at the top of this file.
 *
 * Unlike sign-in, five wrong guesses do not lock the account. They burn the
 * code (verifyOtp does that) and the person starts again. Locking would hand
 * a session thief a way to lock the owner out of signing in just by guessing
 * wrong on purpose.
 */
function codeFailure(res, result, field) {
  const which = field === 'currentCode' ? 'from your current number' : 'from your new number';
  if (result.reason === 'too_many_attempts') {
    return res.status(429).json({
      error: 'Too many incorrect codes. Please start the change again.',
      code: 'OTP_EXHAUSTED',
      details: [{ field, message: 'Too many attempts' }],
    });
  }
  if (result.reason === 'wrong_code') {
    return res.status(422).json({
      error: `The code ${which} is not right.`,
      code: 'OTP_INCORRECT',
      attemptsLeft: result.attemptsLeft,
      details: [{ field, message: 'Incorrect code' }],
    });
  }
  return res.status(422).json({
    error: `The code ${which} has expired. Please start the change again.`,
    code: 'OTP_INVALID',
    details: [{ field, message: 'Expired or already used' }],
  });
}

/** POST /auth/me/phone/verify */
async function verifyPhoneChange(req, res) {
  const data = parse(phoneVerifySchema, req.body, res);
  if (!data) return;
  const next = asE164(data.phoneNumber, res);
  if (!next) return;

  try {
    const me = await loadMe(req.user.id);
    if (!me) return res.status(404).json({ error: 'Account not found.' });

    // The current number first: it is the one that proves this is the owner.
    const current = await verifyOtp(me.phoneNumber, 'phone_change', data.currentCode);
    if (!current.ok) {
      await logEvent({ userId: req.user.id, sessionId: req.user.sessionId, eventType: 'otp_failed',
        severity: 'info', detail: { purpose: 'phone_change', which: 'current', reason: current.reason } });
      return codeFailure(res, current, 'currentCode');
    }
    const fresh = await verifyOtp(next, 'phone_change', data.newCode);
    if (!fresh.ok) {
      await logEvent({ userId: req.user.id, sessionId: req.user.sessionId, eventType: 'otp_failed',
        severity: 'info', detail: { purpose: 'phone_change', which: 'new', reason: fresh.reason } });
      return codeFailure(res, fresh, 'newCode');
    }

    try {
      await pool.query(
        `UPDATE users SET phone_number = $2, phone_verified = TRUE, updated_at = NOW() WHERE id = $1`,
        [req.user.id, next]
      );
    } catch (err) {
      // Taken between the request and now. The unique index is the authority.
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'That number is already used by another account.',
          code: 'PHONE_IN_USE',
          details: [{ field: 'phoneNumber', message: 'Already used by another account' }],
        });
      }
      throw err;
    }

    /*
     * Every other session ends. They were signed in against the old number,
     * and if the old number is why this change is happening -- a lost phone,
     * a SIM that was swapped -- a session on that phone is exactly the one
     * that must not survive. The session that made the change stays: it has
     * just proved itself with both numbers.
     */
    const ended = await sessionStore.revokeOthersForUser(req.user.id, req.user.sessionId);
    for (const sessionId of ended) {
      // eslint-disable-next-line no-await-in-loop
      await pushTokens.revokeForSession(sessionId);
    }

    await logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'phone_changed',
      severity: 'medium', actorType: 'user', resourceType: 'account', resourceId: req.user.id,
      action: 'update', decision: 'allow', ip: req.ip,
      detail: { from: notifier.maskPhone(me.phoneNumber), to: notifier.maskPhone(next), sessionsEnded: ended.length },
      explanation: 'The phone number on this account was changed after codes to both the old and new numbers were confirmed. Other sessions were ended.',
    });
    // To the OLD number: see the phone_changed template for why.
    notifier.notify(req.user.id, 'phone_changed', {
      sendTo: me.phoneNumber,
      newNumber: notifier.maskPhone(next),
    });

    return res.status(200).json({ user: await loadMe(req.user.id), sessionsEnded: ended.length });
  } catch (err) {
    console.error('verifyPhoneChange error:', err);
    return res.status(500).json({ error: 'Could not change your number. Please try again.' });
  }
}

/* ─────────────────────────── notification preferences ─────────────────────────── */

/** The stored object, completed so every category for the role has a value. */
function resolvePrefs(role, stored) {
  const categories = categoriesFor(role);
  const muted = stored?.muted || {};
  return {
    push: stored?.push !== false,
    categories: categories.map((c) => ({ ...c, enabled: muted[c.key] !== true })),
    alwaysOn: alwaysOnFor(role),
  };
}

/** GET /auth/me/preferences */
async function getPreferences(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT role, notification_prefs FROM users WHERE id = $1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found.' });
    return res.status(200).json({ preferences: resolvePrefs(rows[0].role, rows[0].notification_prefs) });
  } catch (err) {
    console.error('getPreferences error:', err);
    return res.status(500).json({ error: 'Could not load your notification settings.' });
  }
}

const prefsSchema = z.object({
  push: z.boolean().optional(),
  categories: z.record(z.string(), z.boolean()).optional(),
}).strict();

/** PUT /auth/me/preferences */
async function updatePreferences(req, res) {
  const data = parse(prefsSchema, req.body, res);
  if (!data) return;
  try {
    const { rows } = await pool.query(
      'SELECT role, notification_prefs FROM users WHERE id = $1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found.' });
    const { role } = rows[0];

    const allowed = new Set(categoriesFor(role).map((c) => c.key));
    const always = alwaysOnFor(role);
    const requested = data.categories || {};

    /*
     * Anything that is not a category for this role is refused by name. That
     * covers the never-mutable ones -- an incident, an account notice -- and a
     * caregiver sending a family category, or the reverse. Silently ignoring
     * them would let a client believe it had muted incidents.
     */
    const refused = Object.keys(requested).filter((k) => !allowed.has(k));
    if (refused.length) {
      return res.status(400).json({
        error: refused.some((k) => always.includes(k))
          ? 'Incidents and account security notices cannot be switched off.'
          : 'Unknown notification category.',
        code: 'CATEGORY_NOT_ALLOWED',
        details: refused.map((k) => ({ field: `categories.${k}`, message: 'Not allowed' })),
      });
    }

    const current = rows[0].notification_prefs || {};
    const muted = { ...(current.muted || {}) };
    Object.entries(requested).forEach(([key, enabled]) => {
      if (enabled) delete muted[key];
      else muted[key] = true;
    });
    const next = { ...current, muted, ...(data.push !== undefined && { push: data.push }) };

    await pool.query('UPDATE users SET notification_prefs = $2 WHERE id = $1', [req.user.id, next]);
    return res.status(200).json({ preferences: resolvePrefs(role, next) });
  } catch (err) {
    console.error('updatePreferences error:', err);
    return res.status(500).json({ error: 'Could not save your notification settings.' });
  }
}

/* ─────────────────────────── push tokens ─────────────────────────── */

const pushSchema = z.object({
  token: z.string().min(10).max(512),
  provider: z.enum(pushTokens.PROVIDERS),
  platform: z.enum(pushTokens.PLATFORMS),
}).strict();

/** POST /auth/push-tokens */
async function registerPushToken(req, res) {
  const data = parse(pushSchema, req.body, res);
  if (!data) return;
  try {
    await pushTokens.register({
      userId: req.user.id, sessionId: req.user.sessionId,
      token: data.token, provider: data.provider, platform: data.platform,
    });
    return res.status(200).json({ registered: true });
  } catch (err) {
    console.error('registerPushToken error:', err);
    return res.status(500).json({ error: 'Could not register this device for notifications.' });
  }
}

const unregisterSchema = z.object({ token: z.string().min(10).max(512) }).strict();

/** DELETE /auth/push-tokens */
async function unregisterPushToken(req, res) {
  const data = parse(unregisterSchema, req.body, res);
  if (!data) return;
  try {
    await pushTokens.unregister({ userId: req.user.id, token: data.token });
    // 200 whether or not it was registered: the outcome the caller wants --
    // "this device gets no pushes for me" -- is true either way.
    return res.status(200).json({ registered: false });
  } catch (err) {
    console.error('unregisterPushToken error:', err);
    return res.status(500).json({ error: 'Could not update this device.' });
  }
}

module.exports = {
  updateProfile,
  requestPhoneChange,
  verifyPhoneChange,
  getPreferences,
  updatePreferences,
  registerPushToken,
  unregisterPushToken,
  // exported for tests
  resolvePrefs,
};
