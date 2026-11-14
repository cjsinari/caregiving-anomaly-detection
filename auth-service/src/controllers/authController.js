const { z } = require('zod');
const pool = require('../config/db');
const { toE164 } = require('../utils/phone');
const { parse } = require('../utils/validate');
const { isValidNationalId, hashNationalId, nationalIdLast4 } = require('../utils/nationalId');
const { KENYA_COUNTIES, COUNTRY_CODES, RELATIONSHIP_VALUES } = require('../data/locality');
const { issueOtp, verifyOtp } = require('../utils/otp');
const { logEvent } = require('../utils/audit');
const { sha256, newRefreshToken, signAccessToken, accessTtlSeconds } = require('../utils/tokens');
const sessionStore = require('../services/sessionStore');
const riskEngine = require('../services/riskEngine');
const deviceTrust = require('../services/deviceTrust');
const stepUp = require('../services/stepUp');
const accountActions = require('../services/accountActions');
const velocity = require('../services/velocity');
const notifier = require('../services/notifier');
const pushTokens = require('../services/pushTokens');
const geoVelocity = require('../services/geoVelocity');
const { flagSession, flaggedResponse } = require('../services/sessionAnomaly');
const { locate } = require('../utils/geo');

const LOCK_MINUTES = 15;

// Login validation 
const phoneField = z.string().min(9).max(20);
const otpField = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');
const deviceField = z.string().min(8).max(255);

/*
 * Registration, which is two different forms wearing one endpoint.
 *
 * A caregiver is vetted and works in a Kenyan county: they owe a national ID
 * and a county. A family member is not vetted and may be anywhere — a large
 * share of them follow a parent's care from abroad — so they owe a country, a
 * county only if that country is Kenya, and the name of the person they are
 * following. Neither role should be asked for the other's fields, which is
 * why this is a discriminated union rather than one object of optionals: an
 * optional field is one a caregiver can omit, and the national ID is not
 * optional for a caregiver.
 *
 * Administrators are absent on purpose. They are pre-provisioned by the seed
 * script and must never be reachable through self-registration.
 */
const registerBase = {
  phoneNumber: phoneField,
  fullName: z.string().trim().min(2).max(100),
  email: z.string().email().max(255).optional(),
  backupEmail: z.string().email().max(255).optional(),
  consent: z.literal(true, { error: 'Consent to data processing is required' }),
};

const caregiverRegisterSchema = z.object({
  ...registerBase,
  role: z.literal('caregiver'),
  nationalId: z.string()
    .refine(isValidNationalId, { message: 'Enter a valid 7 or 8 digit national ID number' }),
  county: z.enum(KENYA_COUNTIES, { error: 'Select the county you work in' }),
  // Accepted so a client may send it, but it can only ever be Kenya: a caregiver
  // delivers care in person. The database says the same thing in a constraint.
  countryCode: z.literal('KE').optional().default('KE'),
});

const familyRegisterSchema = z.object({
  ...registerBase,
  role: z.literal('family'),
  countryCode: z.enum(COUNTRY_CODES, { error: 'Select your country of residence' })
    .optional().default('KE'),
  county: z.enum(KENYA_COUNTIES, { error: 'Select the county you live in' }).optional(),
  careRecipientName: z.string().trim().min(2).max(100),
  relationshipToRecipient: z.enum(RELATIONSHIP_VALUES, { error: 'Select your relationship to them' }),
});

const registerSchema = z.discriminatedUnion('role', [caregiverRegisterSchema, familyRegisterSchema])
  // County is conditionally required, so it cannot be expressed inside either
  // member: a family member in Kenya must give one, a family member abroad has
  // none to give. The path matters as much as the message -- it is what puts
  // the error under the county dropdown instead of at the top of the form.
  .superRefine((data, ctx) => {
    if (data.role === 'family' && data.countryCode === 'KE' && !data.county) {
      ctx.addIssue({ code: 'custom', message: 'Select the county you live in', path: ['county'] });
    }
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

/*
 * Account recovery.
 *
 * One free-text field, because someone who has lost access is not in a position
 * to remember which of two things they registered with. The contact is
 * classified here rather than asked about on the screen.
 */
const recoveryRequestSchema = z.object({ contact: z.string().trim().min(3).max(255) });
const recoveryVerifySchema = z.object({
  contact: z.string().trim().min(3).max(255),
  otp: otpField,
  deviceFingerprint: deviceField,
});

// Helpers
const USER_BY_PHONE = `
  SELECT id, phone_number, full_name, role, account_status, phone_verified, backup_email,
         CASE WHEN locked_until > NOW() THEN EXTRACT(EPOCH FROM (locked_until - NOW()))::int ELSE 0 END AS lock_seconds
  FROM users WHERE phone_number = $1`;

/*
 * The same record, found by whichever contact the person still has.
 *
 * Matched case-insensitively on either address, because an email typed from
 * memory arrives capitalised as often as not, and a recovery flow that fails on
 * "Jane@Example.com" has failed the person it exists for.
 */
const USER_BY_EMAIL = `
  SELECT id, phone_number, full_name, role, account_status, phone_verified, backup_email, email,
         CASE WHEN locked_until > NOW() THEN EXTRACT(EPOCH FROM (locked_until - NOW()))::int ELSE 0 END AS lock_seconds
  FROM users WHERE LOWER(email) = $1 OR LOWER(backup_email) = $1`;

/**
 * Is this contact an email address or a phone number?
 *
 * Deciding on the presence of an "@" rather than on a full email pattern: the
 * only job here is to pick which column to search and which channel to send
 * on. A malformed address finds no account and gets the same answer as an
 * unregistered one, which is the answer it has to get anyway.
 *
 * Returns null when it is neither, which is also treated as "no account".
 */
function classifyContact(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.includes('@')) return { kind: 'email', value: value.toLowerCase() };
  try {
    return { kind: 'phone', value: toE164(value) };
  } catch {
    return null;
  }
}

/** Find the account a recovery contact belongs to, or null. */
async function findByContact(contact) {
  const { rows } = contact.kind === 'email'
    ? await pool.query(USER_BY_EMAIL, [contact.value])
    : await pool.query(USER_BY_PHONE, [contact.value]);
  return rows[0] || null;
}

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
    await logEvent({ userId: user.id, eventType: 'otp_lockout', severity: 'medium',
      actorType: 'automated', resourceType: 'account', resourceId: user.id, action: 'lock',
      decision: 'allow', detail: { purpose },
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
    // The role-specific columns, resolved once so the insert and the update
    // below cannot drift apart. The caregiver's ID is hashed here and the
    // plaintext is not carried any further than this line.
    const profile = data.role === 'caregiver'
      ? { nationalIdHash: hashNationalId(data.nationalId), nationalIdLast4: nationalIdLast4(data.nationalId),
          county: data.county, countryCode: 'KE', recipientName: null, relationship: null }
      : { nationalIdHash: null, nationalIdLast4: null,
          county: data.countryCode === 'KE' ? data.county : null, countryCode: data.countryCode,
          recipientName: data.careRecipientName, relationship: data.relationshipToRecipient };

    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].id;
      // An unverified row is a registration that was abandoned before the code
      // was entered. Starting again overwrites it wholesale rather than merging:
      // someone switching from the family form to the caregiver form must not
      // leave a stale care recipient behind on a caregiver account.
      await pool.query(`UPDATE users SET full_name=$1, email=$2, backup_email=$3, role=$4,
        national_id_hash=$5, national_id_last4=$6, county=$7, country_code=$8,
        care_recipient_name=$9, relationship_to_recipient=$10,
        consent_at=NOW(), updated_at=NOW() WHERE id=$11`,
        [data.fullName, data.email || null, data.backupEmail || null, data.role,
         profile.nationalIdHash, profile.nationalIdLast4, profile.county, profile.countryCode,
         profile.recipientName, profile.relationship, userId]);
    } else {
      const ins = await pool.query(
        `INSERT INTO users (phone_number, email, backup_email, full_name, role, account_status, consent_at,
                            national_id_hash, national_id_last4, county, country_code,
                            care_recipient_name, relationship_to_recipient)
         VALUES ($1,$2,$3,$4,$5,'pending',NOW(),$6,$7,$8,$9,$10,$11) RETURNING id`,
        [phone, data.email || null, data.backupEmail || null, data.fullName, data.role,
         profile.nationalIdHash, profile.nationalIdLast4, profile.county, profile.countryCode,
         profile.recipientName, profile.relationship]);
      userId = ins.rows[0].id;
    }
    const otp = await issueOtp(phone, 'registration');
    if (!otp.ok) return otpIssueError(res, otp.reason);
    await logEvent({ userId, eventType: 'registration_started', severity: 'info',
      detail: { role: data.role, county: profile.county, countryCode: profile.countryCode } });
    return res.status(201).json({ message: 'Verification code sent. It expires in 5 minutes.' });
  } catch (err) {
    if (err.code === '23505') {
      // Which unique index fired decides what the person is told. Both are
      // "already in use", but sending someone to the login screen over a
      // duplicate national ID would be wrong -- that is a vetting matter, and
      // the honest answer is that support has to look at it.
      if (err.constraint === 'idx_users_national_id') {
        return res.status(409).json({
          error: 'This national ID is already registered to another caregiver. Please contact support.',
          code: 'NATIONAL_ID_IN_USE' });
      }
      return res.status(409).json({ error: 'That email address is already in use.', code: 'EMAIL_IN_USE' });
    }
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
      // What a block costs the account is policy, not a constant: the default
      // freezes it and alerts the owner, and a deployment can set the rules
      // differently without the login path changing.
      const response = await accountActions.respondToAnomaly({
        user, action: 'block', severity: 'critical', riskScore: model.riskScore,
        explanation: model.explanation, ip: req.ip,
        notification: { template: 'login_blocked', vars: { explanation: model.explanation } },
      });
      await logEvent({ userId: user.id, eventType: 'login_blocked', severity: 'critical',
        actorType: 'automated',
        detail: { ...auditDetail, accountFrozen: response.frozen, policyRules: response.rules },
        explanation: model.explanation });
      return res.status(403).json({
        error: response.frozen
          ? 'We blocked this sign-in and locked the account as a precaution. Please contact support.'
          : 'We blocked this sign-in as a precaution. Please contact support.',
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

/*
 * ─────────────────────────── account recovery ───────────────────────────
 *
 * For the person who can no longer receive the SMS: a changed number, a lost
 * handset, a swapped SIM. They prove they hold a contact the account already
 * knows, and get a session back. No password is created, because there are
 * none; recovery restores access rather than resetting a secret.
 */

/**
 * Step one: send a code to a registered contact.
 *
 * ── Why every outcome is the same 200 ──
 *
 * This endpoint takes an arbitrary email address or phone number from an
 * unauthenticated caller, so any answer that varies with what was found is a
 * way of asking "does this person use LindaCare?". For a platform whose users
 * are caregivers and the families of elderly people, that question has a value
 * to the wrong people, and it is answerable in bulk.
 *
 * So an unknown contact, an unverified account, a locked one, a frozen one, an
 * exhausted OTP budget and a mail server that is down all produce the same
 * sentence. The `channel` in the response is derived from what the *caller*
 * typed, never from what was found, so it discloses nothing either.
 *
 * The cost is real and worth naming: when delivery genuinely fails, the person
 * is told a code is on its way and none arrives. Nothing can be shown on screen
 * without also answering the enumeration question, so the failure is recorded
 * as an audit event instead, where operators can see it.
 */
async function requestRecovery(req, res) {
  const data = parse(recoveryRequestSchema, req.body, res);
  if (!data) return;

  const contact = classifyContact(data.contact);
  const channel = contact?.kind === 'email' ? 'email' : 'sms';
  const generic = {
    message: channel === 'email'
      ? 'If this account exists, we have sent a verification code to that email address.'
      : 'If this account exists, we have sent a verification code by SMS.',
    channel,
  };

  if (!contact) return res.status(200).json(generic);

  try {
    const user = await findByContact(contact);
    // An account that never completed registration has nothing to recover.
    if (!user || !user.phone_verified) return res.status(200).json(generic);
    if (user.lock_seconds > 0) return res.status(200).json(generic);

    /*
     * A frozen or suspended account still receives the code.
     *
     * The code on its own grants nothing -- verifyRecovery refuses to issue a
     * session for a restricted account. Withholding it here would leave that
     * person with no way to reach the one screen that can tell them their
     * account is frozen and to contact support, which is a dead end rather
     * than a protection.
     */
    const otp = await issueOtp(user.phone_number, 'recovery',
      contact.kind === 'email'
        ? { channel: 'email', email: contact.value }
        : { channel: 'sms' });

    if (!otp.ok) {
      await logEvent({
        userId: user.id, eventType: 'recovery_code_failed', severity: 'medium',
        actorType: 'automated', resourceType: 'account', resourceId: user.id,
        action: 'send', decision: 'deny', detail: { reason: otp.reason, channel },
        explanation: otp.reason === 'rate_limited'
          ? 'A recovery code was not sent because this account had already requested the maximum number of codes.'
          : 'A recovery code could not be delivered. The person was shown the standard message and no code arrived.',
      });
      // Deliberately still the generic 200. See the note above.
      return res.status(200).json(generic);
    }

    await logEvent({
      userId: user.id, eventType: 'recovery_requested', severity: 'medium',
      actorType: 'user', resourceType: 'account', resourceId: user.id,
      action: 'request', decision: 'allow', detail: { channel },
      explanation: `A recovery code was sent by ${channel === 'email' ? 'email' : 'SMS'} to a contact already on this account.`,
    });

    return res.status(200).json(generic);
  } catch (err) {
    console.error('requestRecovery error:', err);
    return res.status(500).json({ error: 'Could not process the request. Please try again.' });
  }
}

/**
 * Step two: prove the contact, and get the account back.
 *
 * ── Why there is no step-up here ──
 *
 * A sign-in can be challenged with a second code because the first one went to
 * the phone. Recovery is the other way round: the code just answered went to a
 * channel *other* than the one being recovered, so it already is the second
 * factor. Sending another code to the same inbox would add a step and no
 * assurance.
 *
 * A `block` from the risk engine is still honoured, because recovery is one of
 * the likelier shapes an account takeover takes and the model scores it on the
 * same features as any other sign-in.
 */
async function verifyRecovery(req, res) {
  const data = parse(recoveryVerifySchema, req.body, res);
  if (!data) return;

  const contact = classifyContact(data.contact);
  const invalid = () => res.status(401).json({
    error: 'Invalid or expired verification code.', code: 'OTP_INVALID' });
  if (!contact) return invalid();

  try {
    const user = await findByContact(contact);
    if (!user || !user.phone_verified) return invalid();
    if (user.lock_seconds > 0) return lockedResponse(res, user.lock_seconds);

    const otpResult = await verifyOtp(user.phone_number, 'recovery', data.otp);
    if (!otpResult.ok) {
      await velocity.recordOnly(user.id);
      await riskEngine.recordAttempt({ userId: user.id, ip: req.ip,
        deviceFingerprint: data.deviceFingerprint, wasSuccessful: false });
      return otpFailure(res, user, otpResult, 'recovery');
    }

    /*
     * The code was right, so this caller holds a contact the account already
     * knew. Only now is it safe to say the account is unavailable: before this
     * point that answer would have been free to anyone who typed the address.
     */
    if (user.account_status === 'frozen') {
      return res.status(403).json({ error: 'This account is frozen. Please contact support.', code: 'ACCOUNT_FROZEN' });
    }
    if (user.account_status === 'suspended') {
      return res.status(403).json({ error: 'This account is suspended. Please contact support.', code: 'ACCOUNT_SUSPENDED' });
    }

    const evalResult = await riskEngine.evaluate(user.id, {
      ip: req.ip, deviceFingerprint: data.deviceFingerprint });
    const { features, context, model, decision, isTrustedDevice } = evalResult;
    await riskEngine.record({ userId: user.id, features, context, model, decision,
      isTrustedDevice, wasSuccessful: true });

    if (decision.action === 'block') {
      const response = await accountActions.respondToAnomaly({
        user, action: 'block', severity: 'critical', riskScore: model.riskScore,
        explanation: model.explanation, ip: req.ip,
        notification: { template: 'login_blocked', vars: { explanation: model.explanation } },
      });
      await logEvent({ userId: user.id, eventType: 'recovery_blocked', severity: 'critical',
        actorType: 'automated',
        detail: { riskScore: model.riskScore, channel: contact.kind,
          accountFrozen: response.frozen, policyRules: response.rules },
        explanation: model.explanation });
      return res.status(403).json({
        error: response.frozen
          ? 'We blocked this recovery attempt and locked the account as a precaution. Please contact support.'
          : 'We blocked this recovery attempt as a precaution. Please contact support.',
        code: 'LOGIN_BLOCKED', riskScore: model.riskScore, explanation: model.explanation,
      });
    }

    await logEvent({
      userId: user.id, eventType: 'account_recovered',
      // High, not info: regaining access without the registered phone is
      // exactly what a takeover looks like, so it belongs in front of whoever
      // reviews this account's history.
      severity: 'high', actorType: 'user', resourceType: 'account', resourceId: user.id,
      action: 'recover', decision: 'allow',
      detail: { channel: contact.kind, riskScore: model.riskScore,
        stepUpSkipped: decision.action === 'step_up' },
      explanation: `Access was restored after a code sent to this account's ${contact.kind === 'email' ? 'registered email address' : 'registered phone number'} was entered correctly.`,
    });

    notifier.notify(user.id, 'account_recovered',
      { channel: contact.kind === 'email' ? 'email address' : 'phone number' });

    return grantSession(res, user, context, model.riskScore,
      { viaRecovery: true, channel: contact.kind });
  } catch (err) {
    console.error('verifyRecovery error:', err);
    return res.status(500).json({ error: 'Recovery failed. Please try again.' });
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
    // A signed-out phone stops receiving this account's pushes now, not when a
    // sender next happens to check whether the session is still alive.
    await pushTokens.revokeForSession(req.user.sessionId);
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
                   requestRecovery, verifyRecovery,
                   refresh, logout, me, listDevices, revokeDevice,
                   listNotifications, readNotifications };
