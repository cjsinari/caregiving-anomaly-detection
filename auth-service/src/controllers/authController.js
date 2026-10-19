const { z } = require('zod');
const pool = require('../config/db');
const { normalisePhone } = require('../utils/phone');
const { issueOtp, verifyOtp } = require('../utils/otp');
const { logEvent } = require('../utils/audit');
const { sha256, newRefreshToken, signAccessToken, accessTtlSeconds } = require('../utils/tokens');
const sessionStore = require('../services/sessionStore');

const LOCK_MINUTES = 15;

// Login validation 
const phoneField = z.string().min(9).max(20);
const otpField = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');
const deviceField = z.string().min(8).max(255);

const registerSchema = z.object({
  phoneNumber: phoneField,
  fullName: z.string().trim().min(2).max(100),
  email: z.string().email().max(255).optional(),
  role: z.enum(['family', 'caregiver']),      // administrators are pre-provisioned, never self-registered
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent to data processing is required' }) }),
});
const otpRequestSchema = z.object({ phoneNumber: phoneField, purpose: z.enum(['login', 'registration']) });
const verifySchema = z.object({ phoneNumber: phoneField, otp: otpField, deviceFingerprint: deviceField });
const refreshSchema = z.object({ refreshToken: z.string().min(32).max(256) });

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
  SELECT id, phone_number, full_name, role, account_status, phone_verified,
         CASE WHEN locked_until > NOW() THEN EXTRACT(EPOCH FROM (locked_until - NOW()))::int ELSE 0 END AS lock_seconds
  FROM users WHERE phone_number = $1`;

const publicUser = (u) => ({
  id: u.id, fullName: u.full_name, role: u.role, accountStatus: u.account_status,
});

async function recordLoginEvent(userId, req, deviceFingerprint, wasSuccessful) {
  try {
    await pool.query(
      `INSERT INTO login_events (user_id, ip_address, device_fingerprint, was_successful)
       VALUES ($1, $2, $3, $4)`,
      [userId, req.ip ? String(req.ip).slice(0, 45) : null, deviceFingerprint, wasSuccessful]
    );
  } catch (err) {
    console.error('login_events write failed:', err.message);
  }
}

async function lockUser(userId) {
  await pool.query(
    `UPDATE users SET locked_until = NOW() + make_interval(mins => $2::int) WHERE id = $1`,
    [userId, LOCK_MINUTES]
  );
}

function otpIssueError(res, reason) {
  if (reason === 'rate_limited') {
    return res.status(429).json({ error: 'Too many verification codes requested. Please try again in 15 minutes.', code: 'OTP_RATE_LIMITED' });
  }
  return res.status(503).json({ error: 'We could not send the verification SMS. Please try again shortly.', code: 'OTP_DELIVERY_FAILED' });
}

/** Shared handling for a failed OTP check. Returns the HTTP response */
async function otpFailure(res, user, result, purpose) {
  if (result.reason === 'too_many_attempts') {
    await lockUser(user.id);
    await logEvent({
      userId: user.id, eventType: 'otp_lockout', severity: 'medium',
      detail: { purpose },
      explanation: `Account locked for ${LOCK_MINUTES} minutes after 5 incorrect verification codes.`,
    });
    return res.status(423).json({
      error: `Too many incorrect codes. This account is locked for ${LOCK_MINUTES} minutes.`,
      code: 'ACCOUNT_LOCKED', retryAfterSeconds: LOCK_MINUTES * 60,
    });
  }
  await logEvent({ userId: user.id, eventType: 'otp_failed', severity: 'info', detail: { purpose, reason: result.reason } });
  if (result.reason === 'wrong_code') {
    return res.status(401).json({ error: 'Incorrect verification code.', code: 'OTP_INCORRECT', attemptsLeft: result.attemptsLeft });
  }
  return res.status(401).json({ error: 'Invalid or expired verification code.', code: 'OTP_INVALID' });
}

const lockedResponse = (res, seconds) =>
  res.status(423).json({ error: 'This account is temporarily locked. Please try again later.', code: 'ACCOUNT_LOCKED', retryAfterSeconds: seconds });

// Endpoints

/** POST /auth/register: create a pending account and send a registration OTP */
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
      // earlier registration never completed: refresh the details and resend
      userId = existing.rows[0].id;
      await pool.query(
        `UPDATE users SET full_name = $1, email = $2, role = $3, consent_at = NOW(), updated_at = NOW() WHERE id = $4`,
        [data.fullName, data.email || null, data.role, userId]
      );
    } else {
      const ins = await pool.query(
        `INSERT INTO users (phone_number, email, full_name, role, account_status, consent_at)
         VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING id`,
        [phone, data.email || null, data.fullName, data.role]
      );
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

/** POST /auth/otp/request: (re)send a login or registration OTP */
async function requestOtp(req, res) {
  const data = parse(otpRequestSchema, req.body, res);
  if (!data) return;

  let phone;
  try { phone = toE164(data.phoneNumber); } catch { return res.status(400).json({ error: 'Invalid phone number' }); }

  // Same reply whether or not the number is registered (limits account enumeration)
  const generic = { message: 'If this number is registered, a verification code has been sent.' };

  try {
    const { rows } = await pool.query(USER_BY_PHONE, [phone]);
    const user = rows[0];
    if (!user) return res.status(200).json(generic);

    if (data.purpose === 'login') {
      if (!user.phone_verified) return res.status(200).json(generic);
      // Clear status codes let the app show the right screen (e.g. "account frozen")
      if (user.account_status === 'frozen') return res.status(403).json({ error: 'This account is frozen. Please contact support.', code: 'ACCOUNT_FROZEN' });
      if (user.account_status === 'suspended') return res.status(403).json({ error: 'This account is suspended. Please contact support.', code: 'ACCOUNT_SUSPENDED' });
    } else if (user.phone_verified) {
      return res.status(200).json(generic);
    }
    if (user.lock_seconds > 0) return res.status(200).json(generic); // locked: send nothing

    const otp = await issueOtp(phone, data.purpose);
    if (!otp.ok) return otpIssueError(res, otp.reason);
    return res.status(200).json(generic);
  } catch (err) {
    console.error('requestOtp error:', err);
    return res.status(500).json({ error: 'Could not process the request. Please try again.' });
  }
}

/** POST /auth/register/verify: confirm the phone, activate the account and start the first session */
async function verifyRegistration(req, res) {
  const data = parse(verifySchema, req.body, res);
  if (!data) return;

  let phone;
  try { phone = toE164(data.phoneNumber); } catch { return res.status(400).json({ error: 'Invalid phone number' }); }

  try {
    const { rows } = await pool.query(USER_BY_PHONE, [phone]);
    const user = rows[0];
    if (!user || user.phone_verified) {
      return res.status(401).json({ error: 'Invalid or expired verification code.', code: 'OTP_INVALID' });
    }
    if (user.lock_seconds > 0) return lockedResponse(res, user.lock_seconds);

    const result = await verifyOtp(phone, 'registration', data.otp);
    if (!result.ok) return otpFailure(res, user, result, 'registration');

    // Family members are active immediately; caregivers stay 'pending' until an admin verifies their ID
    const updated = await pool.query(
      `UPDATE users
       SET phone_verified = TRUE,
           account_status = CASE WHEN role = 'caregiver' THEN 'pending' ELSE 'active' END,
           device_fingerprint = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, role, account_status, full_name`,
      [user.id, data.deviceFingerprint]
    );
    const fresh = updated.rows[0];

    await recordLoginEvent(fresh.id, req, data.deviceFingerprint, true);
    const session = await sessionStore.issue(fresh, { ip: req.ip, deviceFingerprint: data.deviceFingerprint });
    await logEvent({ userId: fresh.id, sessionId: session.sessionId, eventType: 'registration_completed', severity: 'info', detail: { role: fresh.role } });

    return res.status(201).json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      user: publicUser(fresh),
      ...(fresh.role === 'caregiver' && { note: 'Your account is pending administrator verification.' }),
    });
  } catch (err) {
    console.error('verifyRegistration error:', err);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
}

/** POST /auth/login/verify: check the OTP, then start a session. */
async function verifyLogin(req, res) {
  const data = parse(verifySchema, req.body, res);
  if (!data) return;

  let phone;
  try { phone = toE164(data.phoneNumber); } catch { return res.status(400).json({ error: 'Invalid phone number' }); }

  try {
    const { rows } = await pool.query(USER_BY_PHONE, [phone]);
    const user = rows[0];
    if (!user || !user.phone_verified) {
      return res.status(401).json({ error: 'Invalid or expired verification code.', code: 'OTP_INVALID' });
    }
    if (user.account_status === 'frozen') return res.status(403).json({ error: 'This account is frozen. Please contact support.', code: 'ACCOUNT_FROZEN' });
    if (user.account_status === 'suspended') return res.status(403).json({ error: 'This account is suspended. Please contact support.', code: 'ACCOUNT_SUSPENDED' });
    if (user.lock_seconds > 0) return lockedResponse(res, user.lock_seconds);

    const result = await verifyOtp(phone, 'login', data.otp);
    if (!result.ok) {
      await recordLoginEvent(user.id, req, data.deviceFingerprint, false);
      return otpFailure(res, user, result, 'login');
    }

    await recordLoginEvent(user.id, req, data.deviceFingerprint, true);

    // ── STEP 3 HOOK ───────────────────────────────────────────────────────────
    // Risk scoring goes here: build the 9 features, POST them to the Flask /score
    // endpoint, then act on allow / step_up / block BEFORE issuing the se
    // Until then every verified login is allowed with riskScore 0.
    // ──────────────────────────────────────────────────────────────────────────
    const riskScore = 0;

    const session = await sessionStore.issue(user, { ip: req.ip, deviceFingerprint: data.deviceFingerprint, riskScore });
    await logEvent({ userId: user.id, sessionId: session.sessionId, eventType: 'login_success', severity: 'info', detail: { riskScore } });

    return res.status(200).json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      user: publicUser(user),
    });
  } catch (err) {
    console.error('verifyLogin error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}

/** POST /auth/refresh: swap a refresh token for a new access token and a rotated refresh token */
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

    const newToken = newRefreshToken();
    if (!(await sessionStore.rotateRefresh(session.session_id, oldHash, sha256(newToken)))) {
      return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'REFRESH_INVALID' });
    }

    await logEvent({ userId: session.id, sessionId: session.session_id, eventType: 'token_refreshed', severity: 'info' });
    return res.status(200).json({
      accessToken: signAccessToken(session, session.session_id),
      refreshToken: newToken,
      expiresIn: accessTtlSeconds(),
    });
  } catch (err) {
    console.error('refresh error:', err);
    return res.status(500).json({ error: 'Could not refresh the session.' });
  }
}

/** POST /auth/logout: end the current session immediately */
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

/** GET /auth/me: current user (protected route for testing) */
async function me(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, phone_number, email, role, account_status, verification_status
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    return res.status(200).json({
      id: u.id, fullName: u.full_name, phoneNumber: u.phone_number, email: u.email,
      role: u.role, accountStatus: u.account_status, verificationStatus: u.verification_status,
    });
  } catch (err) {
    console.error('me error:', err);
    return res.status(500).json({ error: 'Could not load profile.' });
  }
}

module.exports = { register, requestOtp, verifyRegistration, verifyLogin, refresh, logout, me };
