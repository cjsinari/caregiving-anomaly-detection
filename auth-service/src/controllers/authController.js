const { z } = require('zod');
const pool = require('../config/db');
const { normalisePhone } = require('../utils/phone');
const { issueOtp, verifyOtp } = require('../utils/otp');
const { logEvent } = require('../utils/audit');
const { sha256, newRefreshToken, signAccessToken, accessTtlSeconds } = require('../utils/tokens');
const sessionStore = require('../services/sessionStore');
const riskEngine = require('../services/riskEngine');
const deviceTrust = require('../services/deviceTrust');
const stepUp = require('../services/stepUp');
const velocity = require('../services/velocity');
const notifier = require('../services/notifier');
const geoVelocity = require('../services/geoVelocity');
const { flagSession, flaggedResponse } = require('../services/sessionAnomaly');
const { locate } = require('../utils/geo');

const LOCK_MINUTES = 15;

// Login validation 
const phoneField = z.string().min(9).max(20);
const otpField = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');
const deviceField = z.string().min(8).max(255);

const registerSchema = z.object({
  phoneNumber: phoneField,
  fullName: z.string().trim().min(2).max(100),
  email: z.string().email().max(255).optional(),
  backupEmail: z.string().email().max(255).optional(),
  role: z.enum(['family', 'caregiver']),      // administrators are pre-provisioned, never self-registered
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent to data processing is required' }) }),
});
const otpRequestSchema = z.object({ phoneNumber: phoneField, purpose: z.enum(['login', 'registration']) });
const verifySchema = z.object({ phoneNumber: phoneField, otp: otpField, deviceFingerprint: deviceField });
const refreshSchema = z.object({ refreshToken: z.string().min(32).max(256) });
const stepUpSchema = z.object({
  challengeId: z.string().uuid(),
  otp: otpField,
  trustDevice: z.boolean().optional().default(true),
  deviceLabel: z.string().max(100).optional(),
});

function parse(schema, body, res) {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  res.status(400).json({
    error: 'Invalid input',
    details: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
  return null;
}

function toE164(input) {
  const phone = normalisePhone(input); // throws on unusable input
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Invalid phone number');
  return phone;
}

// Helpers
const USER_BY_PHONE = `
  SELECT id, phone_number, full_name, role, account_status, phone_verified, backup_email,
         CASE WHEN locked_until > NOW() THEN EXTRACT(EPOCH FROM (locked_until - NOW()))::int ELSE 0 END AS lock_seconds
  FROM users WHERE phone_number = $1`;

const publicUser = (u) => ({ id: u.id, fullName: u.full_name, role: u.role, accountStatus: u.account_status });

async function lockUser(id) {
  await pool.query(`UPDATE users SET locked_until = NOW() + make_interval(mins => $2::int) WHERE id = $1`,
    [id, LOCK_MINUTES]);
}

function otpIssueError(res, reason) {
  if (reason === 'rate_limited') {
    return res.status(429).json({ error: 'Too many verification codes requested. Please try again in 15 minutes.', code: 'OTP_RATE_LIMITED' });
  }
  return res.status(503).json({ error: 'We could not send the verification SMS. Please try again shortly.', code: 'OTP_DELIVERY_FAILED' });
}

async function otpFailure(res, user, result, purpose) {
  if (result.reason === 'too_many_attempts') {
    await lockUser(user.id);
    await logEvent({ userId: user.id, eventType: 'otp_lockout', severity: 'medium', detail: { purpose },
      explanation: `Account locked for ${LOCK_MINUTES} minutes after 5 incorrect verification codes.` });
    notifier.notify(user.id, 'otp_lockout', { minutes: LOCK_MINUTES });
    return res.status(423).json({ error: `Too many incorrect codes. This account is locked for ${LOCK_MINUTES} minutes.`,
      code: 'ACCOUNT_LOCKED', retryAfterSeconds: LOCK_MINUTES * 60 });
  }
  await logEvent({ userId: user.id, eventType: 'otp_failed', severity: 'info', detail: { purpose, reason: result.reason } });
  if (result.reason === 'wrong_code') {
    return res.status(401).json({ error: 'Incorrect verification code.', code: 'OTP_INCORRECT', attemptsLeft: result.attemptsLeft });
  }
  return res.status(401).json({ error: 'Invalid or expired verification code.', code: 'OTP_INVALID' });
}

const lockedResponse = (res, s) =>
  res.status(423).json({ error: 'This account is temporarily locked. Please try again later.', code: 'ACCOUNT_LOCKED', retryAfterSeconds: s });

/** Issue a session and return the standard success body. */
async function grantSession(res, user, context, riskScore, extra = {}) {
  const session = await sessionStore.issue(user, {
    ip: context.ip, deviceFingerprint: context.deviceFingerprint, riskScore });
  await deviceTrust.touch(user.id, context.deviceFingerprint);
  await logEvent({ userId: user.id, sessionId: session.sessionId, eventType: 'login_success',
    severity: 'info', detail: { riskScore, ...extra } });
  return res.status(200).json({
    accessToken: session.accessToken, refreshToken: session.refreshToken,
    expiresIn: session.expiresIn, user: publicUser(user), riskScore,
  });
}

// ───────────────────────────── endpoints ─────────────────────────────

async function register(req, res) {
  const data = parse(registerSchema, req.body, res);
  if (!data) return;
  let phone;
  try { phone = toE164(data.phoneNumber); } catch { return res.status(400).json({ error: 'Invalid phone number' }); }

  try {
    const existing = await pool.query('SELECT id, phone_verified FROM users WHERE phone_number = $1', [phone]);
    if (existing.rows[0]?.phone_verified) {
      return res.status(409).json({ error: 'This phone number is already registered. Please log in.', code: 'ALREADY_REGISTERED' });
    }
    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].id;
      await pool.query(`UPDATE users SET full_name=$1, email=$2, backup_email=$3, role=$4,
        consent_at=NOW(), updated_at=NOW() WHERE id=$5`,
        [data.fullName, data.email || null, data.backupEmail || null, data.role, userId]);
    } else {
      const ins = await pool.query(
        `INSERT INTO users (phone_number, email, backup_email, full_name, role, account_status, consent_at)
         VALUES ($1,$2,$3,$4,$5,'pending',NOW()) RETURNING id`,
        [phone, data.email || null, data.backupEmail || null, data.fullName, data.role]);
      userId = ins.rows[0].id;
    }
    const otp = await issueOtp(phone, 'registration');
    if (!otp.ok) return otpIssueError(res, otp.reason);
    await logEvent({ userId, eventType: 'registration_started', severity: 'info', detail: { role: data.role } });
    return res.status(201).json({ message: 'Verification code sent. It expires in 5 minutes.' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That email address is already in use.', code: 'EMAIL_IN_USE' });
    console.error('register error:', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
}

async function requestOtp(req, res) {
  const data = parse(otpRequestSchema, req.body, res);
  if (!data) return;
  let phone;
  try { phone = toE164(data.phoneNumber); } catch { return res.status(400).json({ error: 'Invalid phone number' }); }
  const generic = { message: 'If this number is registered, a verification code has been sent.' };
  try {
    const { rows } = await pool.query(USER_BY_PHONE, [phone]);
    const user = rows[0];
    if (!user) return res.status(200).json(generic);
    if (data.purpose === 'login') {
      if (!user.phone_verified) return res.status(200).json(generic);
      if (user.account_status === 'frozen') return res.status(403).json({ error: 'This account is frozen. Please contact support.', code: 'ACCOUNT_FROZEN' });
      if (user.account_status === 'suspended') return res.status(403).json({ error: 'This account is suspended. Please contact support.', code: 'ACCOUNT_SUSPENDED' });
    } else if (user.phone_verified) return res.status(200).json(generic);
    if (user.lock_seconds > 0) return res.status(200).json(generic);
    const otp = await issueOtp(phone, data.purpose);
    if (!otp.ok) return otpIssueError(res, otp.reason);
    return res.status(200).json(generic);
  } catch (err) {
    console.error('requestOtp error:', err);
    return res.status(500).json({ error: 'Could not process the request. Please try again.' });
  }
}

/** Registration verification. The device used here completed an OTP, so it is trusted. */
async function verifyRegistration(req, res) {
  const data = parse(verifySchema, req.body, res);
  if (!data) return;
  let phone;
  try { phone = toE164(data.phoneNumber); } catch { return res.status(400).json({ error: 'Invalid phone number' }); }

  try {
    const { rows } = await pool.query(USER_BY_PHONE, [phone]);
    const user = rows[0];
    if (!user || user.phone_verified) return res.status(401).json({ error: 'Invalid or expired verification code.', code: 'OTP_INVALID' });
    if (user.lock_seconds > 0) return lockedResponse(res, user.lock_seconds);

    const result = await verifyOtp(phone, 'registration', data.otp);
    if (!result.ok) return otpFailure(res, user, result, 'registration');

    const updated = await pool.query(
      `UPDATE users SET phone_verified=TRUE,
         account_status = CASE WHEN role='caregiver' THEN 'pending' ELSE 'active' END,
         device_fingerprint=$2, updated_at=NOW()
       WHERE id=$1 RETURNING id, phone_number, role, account_status, full_name, backup_email`,
      [user.id, data.deviceFingerprint]);
    const fresh = updated.rows[0];

    // Trusted from day one: this device just proved possession of the phone.
    // Re-challenging it on the next login would verify nothing new.
    await deviceTrust.trust(fresh.id, data.deviceFingerprint, 'Registration device');

    // Registration is not scored: there is no baseline to score against, and a
    // fabricated row in anomaly_scores would pollute the dashboard averages.
    await riskEngine.recordAttempt({ userId: fresh.id, ip: req.ip,
      deviceFingerprint: data.deviceFingerprint, wasSuccessful: true });

    const session = await sessionStore.issue(fresh, { ip: req.ip, deviceFingerprint: data.deviceFingerprint });
    await logEvent({ userId: fresh.id, sessionId: session.sessionId, eventType: 'registration_completed',
      severity: 'info', detail: { role: fresh.role } });

    return res.status(201).json({
      accessToken: session.accessToken, refreshToken: session.refreshToken,
      expiresIn: session.expiresIn, user: publicUser(fresh),
      ...(fresh.role === 'caregiver' && { note: 'Your account is pending administrator verification.' }),
    });
  } catch (err) {
    console.error('verifyRegistration error:', err);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
}

/** Login verification: OTP first, then risk scoring decides allow / step-up / block. */
async function verifyLogin(req, res) {
  const data = parse(verifySchema, req.body, res);
  if (!data) return;
  let phone;
  try { phone = toE164(data.phoneNumber); } catch { return res.status(400).json({ error: 'Invalid phone number' }); }

  try {
    const { rows } = await pool.query(USER_BY_PHONE, [phone]);
    const user = rows[0];
    if (!user || !user.phone_verified) return res.status(401).json({ error: 'Invalid or expired verification code.', code: 'OTP_INVALID' });
    if (user.account_status === 'frozen') return res.status(403).json({ error: 'This account is frozen. Please contact support.', code: 'ACCOUNT_FROZEN' });
    if (user.account_status === 'suspended') return res.status(403).json({ error: 'This account is suspended. Please contact support.', code: 'ACCOUNT_SUSPENDED' });
    if (user.lock_seconds > 0) return lockedResponse(res, user.lock_seconds);

    const otpResult = await verifyOtp(phone, 'login', data.otp);
    if (!otpResult.ok) {
      // Count the failed attempt toward login velocity: training counted every
      // attempt, but the extractor only runs once the OTP has passed
      await velocity.recordOnly(user.id);
      // The attempt never reached the model, so record the event without a score
      await riskEngine.recordAttempt({ userId: user.id, ip: req.ip,
        deviceFingerprint: data.deviceFingerprint, wasSuccessful: false });
      return otpFailure(res, user, otpResult, 'login');
    }

    // OTP passed. Now the behavioural layer.
    const evalResult = await riskEngine.evaluate(user.id, {
      ip: req.ip, deviceFingerprint: data.deviceFingerprint });
    const { features, context, model, decision, isTrustedDevice, geo } = evalResult;

    await riskEngine.record({ userId: user.id, features, context, model, decision, isTrustedDevice, wasSuccessful: true });

    const auditDetail = {
      riskScore: model.riskScore, action: decision.action, governedBy: decision.governedBy,
      coldStart: context.coldStart, modelAvailable: model.modelAvailable, features,
      ...(geo.impossible && { impossibleTravel: geo }),
    };

    if (geo.impossible) {
      await logEvent({ userId: user.id, eventType: 'impossible_travel', severity: 'high',
        detail: { stage: 'login', action: decision.action, ...geo }, explanation: geo.explanation });
      // A block sends its own (stronger) alert; one SMS per incident is enough
      if (decision.action !== 'block') {
        notifier.notify(user.id, 'impossible_travel_login', { from: geo.from, to: geo.to });
      }
    }

    if (decision.action === 'block') {
      await stepUp.freezeAndAlert(user, model.explanation);
      await logEvent({ userId: user.id, eventType: 'login_blocked', severity: 'critical',
        detail: auditDetail, explanation: model.explanation });
      return res.status(403).json({
        error: 'We blocked this sign-in and locked the account as a precaution. Please contact support.',
        code: 'LOGIN_BLOCKED', riskScore: model.riskScore, explanation: model.explanation,
      });
    }

    if (decision.action === 'step_up') {
      const challenge = await stepUp.challenge(user, {
        deviceFingerprint: data.deviceFingerprint, ip: req.ip, riskScore: model.riskScore });
      if (!challenge.ok) return otpIssueError(res, challenge.reason);

      await logEvent({ userId: user.id, eventType: 'step_up_required', severity: 'medium',
        detail: { ...auditDetail, channel: challenge.channel },
        explanation: decision.reason || model.explanation });

      return res.status(200).json({
        status: 'step_up_required',
        challengeId: challenge.challengeId,
        channel: challenge.channel,
        expiresIn: challenge.expiresIn,
        message: isTrustedDevice
          ? 'For your security we need to verify this sign-in. Enter the code we just sent.'
          : "We don't recognise this device. We've sent a code to verify it's you.",
        riskScore: model.riskScore,
      });
    }

    return grantSession(res, user, context, model.riskScore,
      { governedBy: decision.governedBy, coldStart: context.coldStart });
  } catch (err) {
    console.error('verifyLogin error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}

/** Complete a step-up challenge and, by default, trust the device so it is a one-off */
async function verifyStepUp(req, res) {
  const data = parse(stepUpSchema, req.body, res);
  if (!data) return;

  try {
    const pending = await stepUp.load(data.challengeId);
    if (!pending) return res.status(401).json({ error: 'This verification has expired. Please sign in again.', code: 'CHALLENGE_EXPIRED' });

    const { rows } = await pool.query(USER_BY_PHONE, [pending.phoneNumber]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'This verification has expired. Please sign in again.', code: 'CHALLENGE_EXPIRED' });
    if (user.lock_seconds > 0) return lockedResponse(res, user.lock_seconds);

    const result = await stepUp.verify(pending, data.otp);
    if (!result.ok) return otpFailure(res, user, result, 'step_up');

    await stepUp.consume(data.challengeId);
    if (data.trustDevice) {
      // A step-up on an already-trusted device (model- or travel-driven) adds nothing new
      const alreadyTrusted = await deviceTrust.isTrusted(user.id, pending.deviceFingerprint);
      await deviceTrust.trust(user.id, pending.deviceFingerprint, data.deviceLabel || null);
      if (!alreadyTrusted && pending.deviceFingerprint) notifier.notify(user.id, 'new_device_trusted');
    }
    await logEvent({ userId: user.id, eventType: 'step_up_passed', severity: 'info',
      detail: { riskScore: pending.riskScore, deviceTrusted: data.trustDevice } });

    return grantSession(res, user,
      { ip: pending.ip, deviceFingerprint: pending.deviceFingerprint },
      pending.riskScore, { viaStepUp: true });
  } catch (err) {
    console.error('verifyStepUp error:', err);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
}

async function refresh(req, res) {
  const data = parse(refreshSchema, req.body, res);
  if (!data) return;
  try {
    const oldHash = sha256(data.refreshToken);
    const session = await sessionStore.findByRefreshHash(oldHash);
    if (!session) return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'REFRESH_INVALID' });
    if (['frozen', 'suspended'].includes(session.account_status)) {
      await sessionStore.revoke(session.session_id);
      return res.status(403).json({ error: 'This account is not available. Please contact support.', code: 'ACCOUNT_RESTRICTED' });
    }

    // Mid-session impossible travel: a refresh token used far from where this
    // session was last seen, too soon to have travelled there, is a stolen token.
    const here = locate(req.ip);
    const travel = geoVelocity.assess(locate(session.ref_ip), here, session.ref_age_seconds);
    if (travel.impossible) {
      await logEvent({ userId: session.id, sessionId: session.session_id, eventType: 'impossible_travel',
        severity: 'high', detail: { stage: 'refresh', ...travel }, explanation: travel.explanation });
      await flagSession({ userId: session.id, sessionId: session.session_id, reason: 'impossible_travel',
        detail: travel, explanation: travel.explanation, notifyVars: { from: travel.from, to: travel.to } });
      return flaggedResponse(res);
    }

    const newToken = newRefreshToken();
    const seenIp = geoVelocity.hasCoords(here) ? req.ip : null;
    if (!(await sessionStore.rotateRefresh(session.session_id, oldHash, sha256(newToken), seenIp))) {
      return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'REFRESH_INVALID' });
    }
    await logEvent({ userId: session.id, sessionId: session.session_id, eventType: 'token_refreshed', severity: 'info' });
    return res.status(200).json({ accessToken: signAccessToken(session, session.session_id), refreshToken: newToken, expiresIn: accessTtlSeconds() });
  } catch (err) {
    console.error('refresh error:', err);
    return res.status(500).json({ error: 'Could not refresh the session.' });
  }
}

async function logout(req, res) {
  try {
    await sessionStore.revoke(req.user.sessionId);
    await logEvent({ userId: req.user.id, sessionId: req.user.sessionId, eventType: 'logout', severity: 'info' });
    return res.status(200).json({ message: 'Logged out.' });
  } catch (err) {
    console.error('logout error:', err);
    return res.status(500).json({ error: 'Logout failed. Please try again.' });
  }
}

async function me(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, phone_number, email, backup_email, role, account_status, verification_status
       FROM users WHERE id = $1`, [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    return res.status(200).json({ id: u.id, fullName: u.full_name, phoneNumber: u.phone_number,
      email: u.email, backupEmail: u.backup_email, role: u.role,
      accountStatus: u.account_status, verificationStatus: u.verification_status });
  } catch (err) {
    console.error('me error:', err);
    return res.status(500).json({ error: 'Could not load profile.' });
  }
}

/** Trusted devices: visible and revocable, so the challenge is something the user controls */
async function listDevices(req, res) {
  try {
    const devices = await deviceTrust.list(req.user.id);
    return res.status(200).json({ devices: devices.map((d) => ({
      id: d.id, label: d.device_label, trustedAt: d.trusted_at, lastSeenAt: d.last_seen_at })) });
  } catch (err) {
    console.error('listDevices error:', err);
    return res.status(500).json({ error: 'Could not load devices.' });
  }
}

async function revokeDevice(req, res) {
  try {
    const ok = await deviceTrust.revoke(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Device not found' });
    await logEvent({ userId: req.user.id, eventType: 'device_untrusted', severity: 'info',
      detail: { deviceId: req.params.id } });
    return res.status(200).json({ message: 'Device removed. It will need verification next time.' });
  } catch (err) {
    console.error('revokeDevice error:', err);
    return res.status(500).json({ error: 'Could not remove the device.' });
  }
}

/** In-app security notifications: the same alerts that went out by SMS */
async function listNotifications(req, res) {
  try {
    const rows = await notifier.list(req.user.id);
    return res.status(200).json({
      unread: rows.filter((n) => !n.read_at).length,
      notifications: rows.map((n) => ({ id: n.id, type: n.event_type, severity: n.severity,
        message: n.message, createdAt: n.created_at, readAt: n.read_at })),
    });
  } catch (err) {
    console.error('listNotifications error:', err);
    return res.status(500).json({ error: 'Could not load notifications.' });
  }
}

async function readNotifications(req, res) {
  try {
    const updated = await notifier.markAllRead(req.user.id);
    return res.status(200).json({ updated });
  } catch (err) {
    console.error('readNotifications error:', err);
    return res.status(500).json({ error: 'Could not update notifications.' });
  }
}

module.exports = { register, requestOtp, verifyRegistration, verifyLogin, verifyStepUp,
                   refresh, logout, me, listDevices, revokeDevice,
                   listNotifications, readNotifications };
