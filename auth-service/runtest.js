// Everything in one process: ML stub, auth app, and the test flow.
require('dotenv').config({ path: '.env.test', override: true });

// One proxy hop so the tests can place requests with X-Forwarded-For. Requests
// that send no such header still resolve to the socket address (127.0.0.1).
process.env.TRUST_PROXY = '1';
// Small API velocity limits so the test can cross them quickly
process.env.API_VELOCITY_SOFT = '10';
process.env.API_VELOCITY_HARD = '20';
process.env.API_VELOCITY_WINDOW_SECONDS = '60';
process.env.API_VELOCITY_USER_SOFT = '25';
process.env.API_VELOCITY_USER_HARD = '40';
const http = require('http');
const express = require('express');

// ── ML engine stub implementing app.py's contract ──
const ml = express();
ml.use(express.json());
const F = ['login_hour','time_deviation','is_known_country','is_known_city','login_velocity'];
const ALLOW = 58.9, STEP = 88;
ml.post('/score', (req, res) => {
  const d = req.body;
  if (!d || !Object.keys(d).length) return res.status(400).json({ error: 'No JSON payload received' });
  const miss = F.filter(f => !(f in d));
  if (miss.length) return res.status(400).json({ error: `Missing required features: ${miss}` });
  let r = (1-d.is_known_country)*45 + (1-d.is_known_city)*20
        + Math.min(d.login_velocity,258)/258*40 + Math.min(d.time_deviation,16)/16*10;
  r = Math.round(Math.min(r,100)*100)/100;
  const [lvl,act] = r<=ALLOW ? ['low','allow'] : (r<=STEP ? ['medium','step_up'] : ['high','block']);
  const rs = [];
  if (d.is_known_device === 0) rs.push('unrecognised device');
  if (d.is_known_country === 0) rs.push('login from an unfamiliar country');
  else if (d.is_known_city === 0) rs.push('login from an unfamiliar city');
  if (d.login_velocity > 3) rs.push(`unusually high login frequency (${d.login_velocity} attempts)`);
  if (d.time_deviation > 8.5) rs.push('login at an unusual time for this account');
  const e = !rs.length ? "Login matches this account's established behavioural pattern."
    : (lvl === 'low' ? `Login allowed. Noted: ${rs.join(', ')}.`
                     : `Flagged as ${lvl} risk due to: ${rs.join(', ')}.`);
  res.json({ riskScore:r, riskLevel:lvl, action:act, isAnomaly:r>ALLOW, explanation:e, modelAvailable:true });
});
const mlServer = http.createServer(ml).listen(5000);

// index.js calls app.listen() itself, so just require it
require('./index.js');

const pool = require('./src/config/db');
const redis = require('./src/config/redis');

// capture the dev-mode OTPs the service prints
const otps = {};
const origLog = console.log;
console.log = (...a) => {
  const s = a.join(' ');
  const m = /\[DEV\] OTP for (\S+) \((\w+)\): (\d{6})/.exec(s);
  if (m) otps[m[2]] = m[3];
  origLog(...a);
};

const PHONE = '0712345678', E164 = '+254712345678';
const PFP = 'device-phone-aaa11111', LFP = 'device-laptop-bbb22222';

const NAIROBI = '41.90.64.1';    // geoip-lite: Nairobi, KE, accuracy 20 km
const UK = '81.2.69.142';        // geoip-lite: Newmarket, GB, accuracy 500 km
// Same Nairobi range, separate per-IP rate-limit bucket for the high-volume section
const NAIROBI_2 = '41.90.64.9';
const ADMIN_PHONE = '+254700000001';

const post = async (path, body, token, ip) => {
  const r = await fetch(`http://127.0.0.1:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }),
               ...(ip && { 'X-Forwarded-For': ip }) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const get = async (path, token, ip) => {
  const r = await fetch(`http://127.0.0.1:3000${path}`,
    { headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(ip && { 'X-Forwarded-For': ip }) } });
  return { status: r.status, body: await r.json() };
};

// PATCH/DELETE (and anything with no body) for the resource routes
const send = async (method, path, body, token, ip) => {
  const r = await fetch(`http://127.0.0.1:3000${path}`, {
    method,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(ip && { 'X-Forwarded-For': ip }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { status: r.status, body: parsed };
};

// Notifications are fire-and-forget, so poll for them
async function waitForNotification(eventType, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE event_type = $1 ORDER BY created_at DESC LIMIT 1', [eventType]);
    if (rows.length || Date.now() - started > timeoutMs) return rows[0] || null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Audit writes are fire-and-forget on the request path (a failed audit must not
// break the request), so a count taken immediately after a response can race them
async function waitForCount(sql, params, min, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    const { rows } = await pool.query(sql, params);
    const n = rows[0].n;
    if (n >= min || Date.now() - started > timeoutMs) return n;
    await new Promise((r) => setTimeout(r, 100));
  }
}

//Waiting until the authentication service is ready before running tests
async function waitForServer(timeoutMs = 15000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch('http://127.0.0.1:3000/health');
      if (r.ok) return;
    } catch { /* not listening yet */ }
    if (Date.now() - started > timeoutMs) {
      throw new Error('Auth service did not start listening on 127.0.0.1:3000');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const clearOtps = () => pool.query(`DELETE FROM otps WHERE phone_number=$1`, [E164]);

async function login(fp, ip) {
  await clearOtps();
  await post('/auth/otp/request', { phoneNumber: PHONE, purpose: 'login' }, null, ip);
  return post('/auth/login/verify', { phoneNumber: PHONE, otp: otps.login, deviceFingerprint: fp }, null, ip);
}

/** Sign any account in, passing the step-up a first-time device always triggers */
async function loginAs(phone, fp, ip) {
  const { toE164 } = require('./src/utils/phone');
  await pool.query('DELETE FROM otps WHERE phone_number=$1', [toE164(phone)]);
  await post('/auth/otp/request', { phoneNumber: phone, purpose: 'login' }, null, ip);
  const r = await post('/auth/login/verify',
    { phoneNumber: phone, otp: otps.login, deviceFingerprint: fp }, null, ip);
  if (r.body.status !== 'step_up_required') return r;
  return post('/auth/step-up/verify',
    { challengeId: r.body.challengeId, otp: otps.step_up, trustDevice: true }, null, ip);
}

// The test env runs tiny API-velocity limits (10 per session) so section 11 can
// cross them quickly; the resource sections make more requests than that, so they
// clear the windows between steps rather than being throttled by them.
async function resetVelocity() {
  const keys = await redis.keys('apivel:*');
  if (keys.length) await redis.del(...keys);
}

(async () => {

  //Wait for the authentication service before preparing the test database
  await waitForServer();
  await pool.query('TRUNCATE notifications, audit_logs, anomaly_scores, login_events, sessions, trusted_devices, otps, users CASCADE');
  await redis.flushall();
  const pass = [];
  const check = (d, ok) => { pass.push(ok); origLog(`  [${ok ? 'PASS' : 'FAIL'}] ${d}`); };

  origLog('\n=== 1. Register (with backup email) ===');
  await post('/auth/register', { phoneNumber: PHONE, fullName: 'Jane Kamau',
    backupEmail: 'jane.backup@example.com', role: 'family', consent: true,
    countryCode: 'KE', county: 'Nairobi',
    careRecipientName: 'Grace Kamau', relationshipToRecipient: 'parent' });
  const reg = await post('/auth/register/verify',
    { phoneNumber: PHONE, otp: otps.registration, deviceFingerprint: PFP });
  check('registration issues a session', !!reg.body.accessToken);
  const devs = await get('/auth/devices', reg.body.accessToken);
  check('registration device is trusted immediately',
    devs.body.devices?.length === 1 && devs.body.devices[0].label === 'Registration device');

  origLog('\n=== 2. Logins 2-3, same device, cold start ===');
  for (const i of [2, 3]) {
    const r = await login(PFP);
    origLog(`  login #${i}: ${r.body.status || 'allow, session granted'} | risk ${r.body.riskScore}`);
    check(`login #${i} not challenged`, !r.body.challengeId && !!r.body.accessToken);
  }

  origLog('\n=== 3. Login 4 from a NEW laptop ===');
  const l4 = await login(LFP);
  origLog(`  status : ${l4.body.status}`);
  origLog(`  channel: ${l4.body.channel}`);
  origLog(`  message: ${l4.body.message}`);
  check('new device forces step-up', l4.body.status === 'step_up_required');
  check('no session issued before the challenge is passed', !l4.body.accessToken);
  check('challenge routed to backup email, not the same SMS channel', l4.body.channel === 'backup_email');

  origLog('\n=== 4. Pass the step-up, trust the laptop ===');
  const su = await post('/auth/step-up/verify',
    { challengeId: l4.body.challengeId, otp: otps.step_up, trustDevice: true, deviceLabel: 'Work laptop' });
  check('step-up grants a session', !!su.body.accessToken);

  origLog('\n=== 5. Login 5 from the laptop again ===');
  const l5 = await login(LFP);
  check('trusted device is NOT challenged again', !l5.body.challengeId && !!l5.body.accessToken);
  const devs2 = await get('/auth/devices', l5.body.accessToken);
  check('both devices now trusted', devs2.body.devices?.length === 2);

  origLog('\n=== 6. Revoke the laptop, then log in from it ===');
  const laptopId = devs2.body.devices.find(d => d.label === 'Work laptop').id;
  const del = await fetch(`http://127.0.0.1:3000/auth/devices/${laptopId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${l5.body.accessToken}` } });
  check('device revoked', del.status === 200);
  const l6 = await login(LFP);
  check('revoked device is challenged again', l6.body.status === 'step_up_required');

  origLog('\n=== 6b. Account recovery (issue #43) ===');
  /*
   * The case recovery exists for: the phone is gone, so the only usable
   * contact is the backup email registered in section 1.
   */
  await clearOtps();
  const BACKUP_EMAIL = 'jane.backup@example.com';
  // `otps` is scraped from the log and never cleared, so a value left by an
  // earlier step would make "a code was issued" pass without one being issued.
  delete otps.recovery;

  const recUnknown = await post('/auth/recovery/request', { contact: 'nobody@example.com' });
  const recKnown = await post('/auth/recovery/request', { contact: BACKUP_EMAIL });
  check('an unregistered contact is answered 200, like a registered one',
    recUnknown.status === 200 && recKnown.status === 200);
  check('both answers are byte-identical, so neither confirms an account exists',
    JSON.stringify(recUnknown.body) === JSON.stringify(recKnown.body));
  check('the channel reported is the one the caller typed',
    recKnown.body.channel === 'email');
  check('a recovery code was issued over the email channel', !!otps.recovery);

  // Mixed case, because an address typed from memory arrives capitalised as
  // often as not and a recovery flow that fails on that has failed its user.
  await clearOtps();
  delete otps.recovery;
  await post('/auth/recovery/request', { contact: BACKUP_EMAIL.toUpperCase() });
  check('a registered email is matched regardless of case', !!otps.recovery);

  const wrongCode = await post('/auth/recovery/verify',
    { contact: BACKUP_EMAIL, otp: '000000', deviceFingerprint: 'device-recovery-ccc333' });
  check('a wrong recovery code is refused and counts an attempt',
    wrongCode.status === 401 && wrongCode.body.code === 'OTP_INCORRECT');

  const recovered = await post('/auth/recovery/verify',
    { contact: BACKUP_EMAIL, otp: otps.recovery, deviceFingerprint: 'device-recovery-ccc333' });
  check('recovery restores a session without the phone', !!recovered.body.accessToken);
  check('the recovered session works', (await get('/auth/me', recovered.body.accessToken)).status === 200);

  const reused = await post('/auth/recovery/verify',
    { contact: BACKUP_EMAIL, otp: otps.recovery, deviceFingerprint: 'device-recovery-ccc333' });
  check('a recovery code is single-use', reused.status === 401);

  const { rows: recAudit } = await pool.query(
    `SELECT severity, event_detail FROM audit_logs WHERE event_type = 'account_recovered' ORDER BY created_at DESC LIMIT 1`);
  check('recovery is recorded at high severity, not buried as routine',
    recAudit.length === 1 && recAudit[0].severity === 'high');

  const { rows: recNotice } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE event_type = 'account_recovered'`);
  check('the account owner is told their account was recovered', recNotice[0].n >= 1);

  // Recovery by phone is accepted too: someone who still has the number should
  // not be turned away for using the screen meant for people who do not.
  await clearOtps();
  delete otps.recovery;
  const byPhone = await post('/auth/recovery/request', { contact: PHONE });
  check('a phone contact routes to SMS', byPhone.body.channel === 'sms');
  check('a recovery code was issued over SMS', !!otps.recovery);

  origLog('\n=== 7. A failed OTP must NOT write an anomaly_scores row ===');
  await clearOtps();
  await post('/auth/otp/request', { phoneNumber: PHONE, purpose: 'login' });
  const before = (await pool.query('SELECT count(*)::int n FROM anomaly_scores')).rows[0].n;
  const beforeEv = (await pool.query('SELECT count(*)::int n FROM login_events')).rows[0].n;
  await post('/auth/login/verify', { phoneNumber: PHONE, otp: '000000', deviceFingerprint: PFP });
  const after = (await pool.query('SELECT count(*)::int n FROM anomaly_scores')).rows[0].n;
  const afterEv = (await pool.query('SELECT count(*)::int n FROM login_events')).rows[0].n;
  check('failed OTP adds no anomaly_scores row', after === before);
  check('failed OTP still adds a login_events row', afterEv === beforeEv + 1);
  const bad = await pool.query(
    "SELECT count(*)::int n FROM anomaly_scores WHERE governed_by IN ('registration','otp')");
  check('no placeholder rows with fabricated scores', bad.rows[0].n === 0);
  const velKeys = await redis.zcard(`velocity:${(await pool.query(
    'SELECT id FROM users WHERE phone_number=$1', [E164])).rows[0].id}`);
  check('failed attempt counted toward login velocity', velKeys > 0);

  origLog('\n=== 8. Impossible travel: pure checks ===');
  const { assess } = require('./src/services/geoVelocity');
  const { decide } = require('./src/services/riskEngine');
  const { locate } = require('./src/utils/geo');
  const nbo = locate(NAIROBI), uk = locate(UK), keCentroid = locate('105.160.0.1');
  check('Nairobi -> KE country centroid in 1 min is NOT impossible (geoip noise)',
    assess(nbo, keCentroid, 60).impossible === false);
  const fast = assess(nbo, uk, 120);
  origLog(`  Nairobi -> UK in 2 min: ${fast.explanation}`);
  check('Nairobi -> UK in 2 minutes IS impossible', fast.impossible === true);
  check('Nairobi -> UK in 12 hours is plausible', assess(nbo, uk, 12 * 3600).impossible === false);
  check('unresolvable IP is never impossible', assess(nbo, locate('127.0.0.1'), 1).impossible === false);
  const d1 = decide({ coldStart: false, isTrustedDevice: true, modelAction: 'allow', geo: fast });
  check('travel rule overrides a model "allow" -> step_up (rules_geo)',
    d1.action === 'step_up' && d1.governedBy === 'rules_geo' && !!d1.reason);
  const d2 = decide({ coldStart: true, isTrustedDevice: true, modelAction: 'allow', geo: fast });
  check('travel rule applies during cold start', d2.action === 'step_up' && d2.governedBy === 'rules_geo');
  const d3 = decide({ coldStart: false, isTrustedDevice: true, modelAction: 'block', geo: fast });
  check('model block still wins over the travel step-up', d3.action === 'block' && d3.governedBy === 'model');

  origLog('\n=== 9. Impossible travel at login ===');
  const newDeviceAlerts = async () => (await pool.query(
    "SELECT count(*)::int n FROM notifications WHERE event_type='new_device_trusted'")).rows[0].n;
  check('section 4 (genuinely new laptop) produced a "new device" alert', (await newDeviceAlerts()) === 1);
  const n1 = await login(PFP, NAIROBI);   // first KE login: unfamiliar country -> model step-up
  const n1s = await post('/auth/step-up/verify', { challengeId: n1.body.challengeId, otp: otps.step_up }, null, NAIROBI);
  check('Nairobi session established', !!n1s.body.accessToken);
  await new Promise((r) => setTimeout(r, 300));   // give a (wrong) fire-and-forget alert time to land
  check('step-up on an already-trusted device sends no "new device" alert', (await newDeviceAlerts()) === 1);
  const nbSession = await login(PFP, NAIROBI);
  check('second Nairobi login allowed', !!nbSession.body.accessToken);
  const ukLogin = await login(PFP, UK);
  check('UK login minutes later is challenged, no session issued',
    ukLogin.body.status === 'step_up_required' && !ukLogin.body.accessToken);
  const travelAudit = await pool.query(
    "SELECT event_detail FROM audit_logs WHERE event_type='impossible_travel' ORDER BY logged_at DESC LIMIT 1");
  check('impossible_travel audited at login',
    travelAudit.rows.length === 1 && JSON.parse(travelAudit.rows[0].event_detail).stage === 'login');
  const ln = await waitForNotification('impossible_travel_login');
  origLog(`  SMS: ${ln && ln.message}`);
  check('owner notified of the login attempt', ln && ln.delivery_status === 'dev_logged');
  const geoRow = await pool.query(
    "SELECT latitude, longitude FROM login_events WHERE country='GB' ORDER BY login_time DESC LIMIT 1");
  check('login_events now stores coordinates', geoRow.rows[0] && geoRow.rows[0].latitude != null);

  origLog('\n=== 10. Impossible travel mid-session (refresh), SMS provider down ===');
  const notifier = require('./src/services/notifier');
  const userId = (await pool.query('SELECT id FROM users WHERE phone_number=$1', [E164])).rows[0].id;
  const adminId = (await pool.query(
    `INSERT INTO users (phone_number, full_name, role, account_status, phone_verified)
     VALUES ($1, 'Ops Admin', 'administrator', 'active', TRUE) RETURNING id`, [ADMIN_PHONE])).rows[0].id;
  notifier.setTransport(async () => { throw new Error("Africa's Talking: 503 Service Unavailable"); });
  const r1 = await post('/auth/refresh', { refreshToken: nbSession.body.refreshToken }, null, NAIROBI);
  check('refresh from the same city succeeds', r1.status === 200 && !!r1.body.refreshToken);
  const r2 = await post('/auth/refresh', { refreshToken: r1.body.refreshToken }, null, UK);
  check('refresh from the UK is refused as SESSION_FLAGGED', r2.status === 401 && r2.body.code === 'SESSION_FLAGGED');
  const flagged = await pool.query(
    "SELECT session_status, flagged_reason FROM sessions WHERE session_status='flagged'");
  check('session marked flagged (impossible_travel)', flagged.rows[0] && flagged.rows[0].flagged_reason === 'impossible_travel');
  const afterFlag = await get('/auth/me', r1.body.accessToken, NAIROBI);
  check('access token of the flagged session stops working immediately', afterFlag.status === 401);
  check('SMS outage did not interrupt the request (flag response still returned)', r2.body.code === 'SESSION_FLAGGED');
  const sn = await waitForNotification('session_flagged_geo');
  check('owner notification recorded as failed, with the provider error',
    sn && sn.delivery_status === 'failed' && /503/.test(sn.delivery_error));
  const an = await waitForNotification('admin:session_flagged_geo');
  origLog(`  admin SMS: ${an && an.message}`);
  check('administrator alerted about the critical event', an && an.user_id === adminId && an.subject_user_id === userId);
  check('admin alert masks the phone number', an && an.message.includes('+2547****5678') && !an.message.includes(E164));
  check('admin alert contains no session or user IDs',
    an && !an.message.includes(userId) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(an.message));
  notifier.setTransport();   // back to the dev transport

  origLog('\n=== 11. API velocity thresholds (per session) ===');
  await redis.del(`apivel:user:${userId}`);   // isolate from earlier sections
  const v = await login(PFP, NAIROBI);
  check('fresh Nairobi login allowed', !!v.body.accessToken);
  const statuses = [];
  for (let i = 0; i < 22; i++) statuses.push((await get('/auth/me', v.body.accessToken, NAIROBI)).status);
  origLog(`  statuses: ${statuses.join(' ')}`);
  check('first 10 requests served', statuses.slice(0, 10).every((x) => x === 200));
  check('requests 11-20 throttled with 429', statuses.slice(10, 20).every((x) => x === 429));
  check('request 21 (client ignored 429s) ends the session', statuses[20] === 401);
  const velFlag = await pool.query(
    "SELECT count(*)::int n FROM sessions WHERE flagged_reason='high_api_velocity'");
  check('session flagged exactly once, classified high_api_velocity', velFlag.rows[0].n === 1);
  const velAudit = JSON.parse((await pool.query(
    "SELECT event_detail FROM audit_logs WHERE event_type='session_flagged' ORDER BY logged_at DESC LIMIT 1")).rows[0].event_detail);
  check('audit captures user, session, timestamp and count',
    velAudit.classification === 'high_api_velocity' && velAudit.scope === 'session' &&
    velAudit.userId === userId && !!velAudit.sessionId && !!velAudit.requestedAt && velAudit.sessionCount === 21);
  const throttleAudits = await pool.query(
    "SELECT count(*)::int n FROM audit_logs WHERE event_type='api_velocity_throttled'");
  check('throttling audited once per window, not per request', throttleAudits.rows[0].n === 1);
  check('owner notified of the velocity sign-out', !!(await waitForNotification('session_flagged_api_velocity')));

  origLog('\n=== 11b. API velocity thresholds (per user, across sessions) ===');
  await redis.del(`apivel:user:${userId}`);
  const userStatuses = [];
  for (let round = 0; round < 5; round++) {
    // 9 requests per session keeps every session under its own soft limit of 10,
    // so only the user window can trip. Each login replaces the previous session.
    const s = await login(PFP, NAIROBI_2);
    for (let i = 0; i < 9; i++) userStatuses.push((await get('/auth/me', s.body.accessToken, NAIROBI_2)).status);
  }
  origLog(`  statuses: ${userStatuses.join(' ')}`);
  check('first 25 requests across sessions served', userStatuses.slice(0, 25).every((x) => x === 200));
  check('requests 26-40 throttled by the user window', userStatuses.slice(25, 40).every((x) => x === 429));
  check('request 41 flags the session (user scope)', userStatuses[40] === 401);
  const userFlag = JSON.parse((await pool.query(
    "SELECT event_detail FROM audit_logs WHERE event_type='session_flagged' ORDER BY logged_at DESC LIMIT 1")).rows[0].event_detail);
  check('flag recorded with scope=user', userFlag.scope === 'user' && userFlag.userCount === 41);
  await redis.del(`apivel:user:${userId}`);

  origLog('\n=== 11c. Notification delivery: success and failure ===');
  const sent = [];
  notifier.setTransport(async (phone, message) => { sent.push({ phone, message }); return 'sent'; });
  const ok = await notifier.notify(userId, 'login_blocked', { explanation: 'Test.' });
  check('successful delivery recorded as sent (owner and admin)', ok.user === 'sent' && ok.admins.join() === 'sent');
  check('owner and admin each received one SMS', sent.length === 2 && sent.some((m) => m.phone === ADMIN_PHONE));
  notifier.setTransport(async () => { throw new Error('network timeout'); });
  let threw = false, failed;
  try { failed = await notifier.notify(userId, 'login_blocked', { explanation: 'Test.' }); } catch { threw = true; }
  check('failed delivery does not throw', !threw);
  check('failed delivery recorded as failed', failed.user === 'failed' && failed.admins.join() === 'failed');
  const medium = await notifier.notify(userId, 'otp_lockout', { minutes: 15 });
  check('medium-severity events do not page administrators', medium.admins.length === 0);
  notifier.setTransport();

  origLog('\n=== 12. Notification inbox ===');
  const inboxLogin = await login(PFP, NAIROBI);
  const inbox = await get('/auth/notifications', inboxLogin.body.accessToken, NAIROBI);
  origLog(`  ${inbox.body.unread} unread: ${(inbox.body.notifications || []).map((n) => n.type).join(', ')}`);
  check('inbox lists the security alerts', inbox.status === 200 && inbox.body.unread >= 3);
  await post('/auth/notifications/read', {}, inboxLogin.body.accessToken, NAIROBI);
  const inbox2 = await get('/auth/notifications', inboxLogin.body.accessToken, NAIROBI);
  check('mark-all-read clears the unread count', inbox2.body.unread === 0);

  origLog('\n=== 13. Resource authorization: care profile ownership ===');
  await resetVelocity();
  const KE_IP = '41.90.64.33';            // same Nairobi range, its own rate-limit bucket
  const CG_PHONE = '+254711000002', FAM2_PHONE = '+254711000003';
  const cgId = (await pool.query(
    `INSERT INTO users (phone_number, full_name, role, account_status, phone_verified)
     VALUES ($1, 'Mary Wanjiru', 'caregiver', 'pending', TRUE) RETURNING id`, [CG_PHONE])).rows[0].id;
  const fam2Id = (await pool.query(
    `INSERT INTO users (phone_number, full_name, role, account_status, phone_verified)
     VALUES ($1, 'Peter Otieno', 'family', 'active', TRUE) RETURNING id`, [FAM2_PHONE])).rows[0].id;

  const famToken = (await loginAs(PHONE, PFP, KE_IP)).body.accessToken;
  const cgToken = (await loginAs(CG_PHONE, 'device-cg-ccc33333', KE_IP)).body.accessToken;
  const fam2Token = (await loginAs(FAM2_PHONE, 'device-fam2-ddd44444', KE_IP)).body.accessToken;
  const adminToken = (await loginAs(ADMIN_PHONE, 'device-admin-eee55555', KE_IP)).body.accessToken;
  check('sessions established for family, caregiver, second family and administrator',
    !!famToken && !!cgToken && !!fam2Token && !!adminToken);

  await resetVelocity();
  const created = await send('POST', '/profiles', {
    fullName: 'Grace Njeri', homeAddress: 'Kilimani, Nairobi', dateOfBirth: '1948-04-12',
    medicalNotes: 'Hypertension; metformin 500mg twice daily' }, famToken, KE_IP);
  check('family member creates a care profile', created.status === 201 && !!created.body.profile?.id);
  const profileId = created.body.profile.id;
  const own = await send('GET', `/profiles/${profileId}`, null, famToken, KE_IP);
  check('owner reads it, medical notes included',
    own.status === 200 && /metformin/.test(own.body.profile.medicalNotes) &&
    own.body.profile.accessVia === 'family_owner');
  const mine = await send('GET', '/profiles', null, famToken, KE_IP);
  check('owner lists exactly their own profile',
    mine.body.count === 1 && mine.body.profiles[0].id === profileId);
  const patched = await send('PATCH', `/profiles/${profileId}`,
    { homeAddress: 'Lavington, Nairobi' }, famToken, KE_IP);
  check('owner updates it', patched.status === 200 && patched.body.profile.homeAddress === 'Lavington, Nairobi');

  await resetVelocity();
  const cgPending = await send('GET', `/profiles/${profileId}`, null, cgToken, KE_IP);
  check('an unverified (pending) caregiver account is refused',
    cgPending.status === 403 && cgPending.body.code === 'ACCOUNT_NOT_ACTIVE');
  await pool.query(
    `UPDATE users SET account_status='active', verification_status='verified' WHERE id=$1`, [cgId]);
  const cgNoAssign = await send('GET', `/profiles/${profileId}`, null, cgToken, KE_IP);
  check('a verified caregiver with no assignment gets 404, not 403', cgNoAssign.status === 404);
  const otherFam = await send('GET', `/profiles/${profileId}`, null, fam2Token, KE_IP);
  check('another family member cannot even tell the profile exists',
    otherFam.status === 404 && otherFam.body.error === 'Care profile not found.');
  const adminRead = await send('GET', `/profiles/${profileId}`, null, adminToken, KE_IP);
  check('administrators have no clinical access',
    adminRead.status === 403 && adminRead.body.code === 'NO_CLINICAL_ACCESS');
  check('administrators cannot list care profiles',
    (await send('GET', '/profiles', null, adminToken, KE_IP)).status === 403);
  check('an unauthenticated request is refused',
    (await send('GET', `/profiles/${profileId}`, null, null, KE_IP)).status === 401);

  await resetVelocity();
  const assign = await send('POST', `/profiles/${profileId}/assignments`,
    { caregiverPhone: CG_PHONE }, famToken, KE_IP);
  check('owner assigns the caregiver',
    assign.status === 201 && assign.body.assignment?.caregiver.id === cgId);
  check('the response masks the caregiver number', /\*/.test(assign.body.assignment.caregiver.phoneNumber));
  const dup = await send('POST', `/profiles/${profileId}/assignments`,
    { caregiverPhone: CG_PHONE }, famToken, KE_IP);
  check('a second live assignment for the same caregiver is refused',
    dup.status === 409 && dup.body.code === 'ALREADY_ASSIGNED');
  const unknownCg = await send('POST', `/profiles/${profileId}/assignments`,
    { caregiverPhone: '+254711000099' }, famToken, KE_IP);
  check('only a verified caregiver account can be assigned',
    unknownCg.status === 404 && unknownCg.body.code === 'CAREGIVER_NOT_FOUND');

  const cgRead = await send('GET', `/profiles/${profileId}`, null, cgToken, KE_IP);
  check('the assigned caregiver reads the profile with the same token as before',
    cgRead.status === 200 && cgRead.body.profile.accessVia === 'caregiver_assignment');
  check('the caregiver listing shows the assigned profile',
    (await send('GET', '/profiles', null, cgToken, KE_IP)).body.count === 1);
  const cgWrite = await send('PATCH', `/profiles/${profileId}`,
    { medicalNotes: 'edited by the caregiver' }, cgToken, KE_IP);
  check('a caregiver cannot change the record',
    cgWrite.status === 403 && cgWrite.body.code === 'READ_ONLY_ACCESS');
  const cgManage = await send('POST', `/profiles/${profileId}/assignments`,
    { caregiverPhone: CG_PHONE }, cgToken, KE_IP);
  check('a caregiver cannot change the care team', cgManage.status === 403);
  check('a caregiver cannot delete the record',
    (await send('DELETE', `/profiles/${profileId}`, null, cgToken, KE_IP)).status === 403);

  await resetVelocity();
  const team = await send('GET', `/profiles/${profileId}/assignments`, null, famToken, KE_IP);
  check('owner sees the care team, numbers masked',
    team.body.assignments?.length === 1 && team.body.assignments[0].status === 'active' &&
    !team.body.assignments[0].caregiver.phoneNumber.includes('711000002'));
  const assignmentId = team.body.assignments[0].id;
  check('owner ends the assignment',
    (await send('DELETE', `/profiles/${profileId}/assignments/${assignmentId}`, null, famToken, KE_IP)).status === 200);
  check('the caregiver token stops opening the record the moment access ends',
    (await send('GET', `/profiles/${profileId}`, null, cgToken, KE_IP)).status === 404);
  check('the ended assignment leaves the caregiver listing',
    (await send('GET', '/profiles', null, cgToken, KE_IP)).body.count === 0);
  const kept = await pool.query('SELECT status, end_date FROM assignments WHERE id=$1', [assignmentId]);
  check('the assignment is kept and dated, not deleted',
    kept.rows[0].status === 'inactive' && !!kept.rows[0].end_date);

  check('probing an unknown id returns 404',
    (await send('GET', '/profiles/11111111-2222-3333-4444-555555555555', null, famToken, KE_IP)).status === 404);
  check('a malformed id is refused without reaching the database',
    (await send('GET', '/profiles/not-a-uuid', null, famToken, KE_IP)).status === 404);

  origLog('\n=== 14. Audit trail and generated explanations ===');
  await resetVelocity();
  const denials = await pool.query(
    `SELECT event_detail, explanation FROM audit_logs
     WHERE event_type='resource_access' AND decision='deny' ORDER BY logged_at`);
  const reasons = denials.rows.map((r) => JSON.parse(r.event_detail).reason);
  origLog(`  refusal reasons recorded: ${[...new Set(reasons)].join(', ')}`);
  check('every refusal was recorded with its reason',
    ['account_not_active', 'no_assignment', 'not_owner', 'administrator_no_clinical_access',
     'caregiver_read_only', 'assignment_ended', 'not_found'].every((r) => reasons.includes(r)));
  check('every refusal carries a generated explanation',
    denials.rows.length > 0 && denials.rows.every((r) => /was denied: .+\.$/.test(r.explanation)));
  check('the ended-assignment refusal names the date it ended',
    denials.rows.some((r) => /assignment ended on \d{4}-\d{2}-\d{2}/.test(r.explanation)));
  const allowed = await pool.query(
    `SELECT count(*)::int n FROM audit_logs WHERE event_type='resource_access' AND decision='allow'`);
  check('allowed reads are recorded too, not only refusals', allowed.rows[0].n >= 3);
  const leak = await pool.query(
    `SELECT count(*)::int n FROM audit_logs
     WHERE explanation ILIKE '%Grace Njeri%' OR event_detail ILIKE '%metformin%'
        OR event_detail ILIKE '%Lavington%'`);
  check('no care-record content leaked into the audit trail', leak.rows[0].n === 0);

  // Issue #32: the trail is investigative material, administrators only.
  const famAudit = await send('GET', '/audit?limit=100', null, famToken, KE_IP);
  check('a family member cannot read the audit trail',
    famAudit.status === 403 && famAudit.body.code === 'ROLE_NOT_PERMITTED');
  check('a caregiver cannot read the audit trail',
    (await send('GET', '/audit?limit=100', null, cgToken, KE_IP)).status === 403);
  check('a family member cannot list accounts',
    (await send('GET', '/audit/accounts', null, famToken, KE_IP)).status === 403);
  check('the refused attempts on the trail are themselves recorded', (await waitForCount(
    `SELECT count(*)::int n FROM audit_logs
     WHERE resource_type='audit_trail' AND decision='deny' AND user_id=$1`, [userId], 2)) >= 2);

  await resetVelocity();
  const trail = await send('GET', `/audit?userId=${userId}&limit=100`, null, adminToken, KE_IP);
  check('an administrator reads one account trail', trail.status === 200 && trail.body.events.length > 5);
  check('every entry carries a readable explanation',
    trail.body.events.every((e) => typeof e.explanation === 'string' && e.explanation.length > 10));
  check('no entry falls back to the generic wording',
    trail.body.events.every((e) => !e.explanation.startsWith('Recorded event:')));
  check('entries carry the detail and the acting account',
    trail.body.events.some((e) => e.detail) &&
    trail.body.events.every((e) => !e.actor || e.actor.id === userId));
  const viewed = await pool.query(
    `SELECT user_id, event_detail, actor_type FROM audit_logs
     WHERE event_type='audit_viewed' ORDER BY logged_at DESC LIMIT 1`);
  check('every read of the trail is itself audited, as an administrator action',
    viewed.rows.length === 1 && viewed.rows[0].user_id === adminId &&
    viewed.rows[0].actor_type === 'administrator' &&
    JSON.parse(viewed.rows[0].event_detail).targetUserId === userId);
  const whole = await send('GET', '/audit?limit=1', null, adminToken, KE_IP);
  check('the whole trail is paged, with a total', whole.body.events.length === 1 && whole.body.total > 20);
  const crit = await send('GET', '/audit?severity=critical&limit=100', null, adminToken, KE_IP);
  check('the severity filter narrows the trail', crit.body.events.length > 0 &&
    crit.body.events.every((e) => e.severity === 'critical') && crit.body.total < whole.body.total);
  const aSession = trail.body.events.find((e) => e.sessionId)?.sessionId;
  check('the trail records which session each event came from', !!aSession);
  const sessionPage = await send('GET', `/audit?sessionId=${aSession}&limit=100`, null, adminToken, KE_IP);
  check('the session filter narrows to one session', sessionPage.status === 200 &&
    sessionPage.body.events.length > 0 && sessionPage.body.events.every((e) => e.sessionId === aSession));
  check('an unknown filter value is rejected',
    (await send('GET', '/audit?severity=nonsense', null, adminToken, KE_IP)).status === 400);
  const accounts = await send('GET', '/audit/accounts', null, adminToken, KE_IP);
  check('an administrator lists accounts with masked numbers',
    accounts.status === 200 && accounts.body.accounts.every((a) => !/\+2547\d{6}/.test(a.phoneNumber)));

  origLog('\n=== 15. The trail cannot be rewritten ===');
  let updateBlocked = false, deleteBlocked = false;
  try {
    await pool.query(`UPDATE audit_logs SET explanation='nothing to see here' WHERE decision='deny'`);
  } catch (e) { updateBlocked = /append-only/.test(e.message); }
  check('UPDATE on the audit trail is refused by the database', updateBlocked);
  try {
    await pool.query(`DELETE FROM audit_logs WHERE decision='deny'`);
  } catch (e) { deleteBlocked = /append-only/.test(e.message); }
  check('DELETE on the audit trail is refused by the database', deleteBlocked);
  const ghostId = (await pool.query(
    `INSERT INTO users (phone_number, full_name, role, account_status, phone_verified)
     VALUES ('+254711000044', 'Temp Account', 'family', 'active', TRUE) RETURNING id`)).rows[0].id;
  await pool.query(
    `INSERT INTO audit_logs (user_id, event_type, severity) VALUES ($1, 'account_closed', 'info')`, [ghostId]);
  await pool.query('DELETE FROM users WHERE id=$1', [ghostId]);
  check('deleting an account still works, and its events outlive it', (await pool.query(
    `SELECT count(*)::int n FROM audit_logs WHERE event_type='account_closed' AND user_id IS NULL`)).rows[0].n === 1);

  origLog('\n=== 16. Account security actions ===');
  await resetVelocity();
  const policy = require('./src/config/securityPolicy');
  const admin2Id = (await pool.query(
    `INSERT INTO users (phone_number, full_name, role, account_status, phone_verified)
     VALUES ('+254700000002', 'Second Admin', 'administrator', 'active', TRUE) RETURNING id`)).rows[0].id;
  const pendingCgId = (await pool.query(
    `INSERT INTO users (phone_number, full_name, role, account_status, phone_verified)
     VALUES ('+254711000055', 'Awaiting Verification', 'caregiver', 'pending', TRUE) RETURNING id`)).rows[0].id;

  // Authorization first: these endpoints freeze accounts and end sessions.
  const famFreeze = await send('POST', `/admin/accounts/${cgId}/freeze`,
    { reason: 'trying it on' }, famToken, KE_IP);
  check('a family member cannot freeze an account',
    famFreeze.status === 403 && famFreeze.body.code === 'ROLE_NOT_PERMITTED');
  check('an unauthenticated freeze is refused',
    (await send('POST', `/admin/accounts/${cgId}/freeze`, { reason: 'trying it on' }, null, KE_IP)).status === 401);
  check('a freeze with no stated reason is rejected',
    (await send('POST', `/admin/accounts/${fam2Id}/freeze`, {}, adminToken, KE_IP)).status === 400);
  check('an unknown account is a 404',
    (await send('POST', '/admin/accounts/11111111-2222-3333-4444-555555555555/freeze',
      { reason: 'no such account' }, adminToken, KE_IP)).status === 404);

  const selfFreeze = await send('POST', `/admin/accounts/${adminId}/freeze`,
    { reason: 'locking myself out' }, adminToken, KE_IP);
  check('an administrator cannot freeze their own account',
    selfFreeze.status === 400 && selfFreeze.body.code === 'CANNOT_ACT_ON_SELF');
  const adminFreeze = await send('POST', `/admin/accounts/${admin2Id}/freeze`,
    { reason: 'disabling oversight' }, adminToken, KE_IP);
  check('administrator accounts are protected from freezing by policy',
    adminFreeze.status === 403 && adminFreeze.body.code === 'TARGET_PROTECTED');
  check('both refusals were recorded against the administrator who tried', (await waitForCount(
    `SELECT count(*)::int n FROM audit_logs
     WHERE resource_type='account' AND decision='deny' AND user_id=$1 AND actor_type='administrator'`,
    [adminId], 2)) === 2);

  await resetVelocity();
  const frozen = await send('POST', `/admin/accounts/${fam2Id}/freeze`,
    { reason: 'Reported handset theft; freezing pending contact with the family.' }, adminToken, KE_IP);
  check('an administrator freezes an account', frozen.status === 200 && frozen.body.sessionsEnded >= 1);
  check('the frozen account is signed out immediately',
    (await send('GET', '/profiles', null, fam2Token, KE_IP)).status === 401);
  const frozenLogin = await post('/auth/otp/request',
    { phoneNumber: FAM2_PHONE, purpose: 'login' }, null, KE_IP);
  check('a frozen account cannot start a new sign-in',
    frozenLogin.status === 403 && frozenLogin.body.code === 'ACCOUNT_FROZEN');
  const freezeRow = (await pool.query(
    `SELECT user_id, resource_id, action, actor_type, severity, event_detail, explanation
     FROM audit_logs WHERE event_type='account_frozen' ORDER BY logged_at DESC LIMIT 1`)).rows[0];
  check('the action records who decided, and on which account',
    freezeRow.user_id === adminId && freezeRow.resource_id === fam2Id &&
    freezeRow.action === 'freeze' && freezeRow.actor_type === 'administrator');
  check('the action records its reason and severity',
    /handset theft/.test(JSON.parse(freezeRow.event_detail).reason) && freezeRow.severity === 'critical');
  origLog(`  explanation: ${freezeRow.explanation}`);
  check('freezing again changes nothing and says so',
    (await send('POST', `/admin/accounts/${fam2Id}/freeze`, { reason: 'again' }, adminToken, KE_IP)).status === 409);
  check('the owner was told their account was frozen',
    !!(await waitForNotification('account_frozen')));

  await resetVelocity();
  const restored = await send('POST', `/admin/accounts/${fam2Id}/restore`,
    { reason: 'Handset recovered and identity confirmed by phone.' }, adminToken, KE_IP);
  check('an administrator restores access', restored.status === 200 &&
    restored.body.account.accountStatus === 'active' && restored.body.account.previousStatus === 'frozen');
  check('the restored account can sign in again', !!(await loginAs(FAM2_PHONE, 'device-fam2-ddd44444', KE_IP)).body.accessToken);
  const restoreRow = (await pool.query(
    `SELECT user_id, resource_id, actor_type, event_detail FROM audit_logs
     WHERE event_type='account_restored' ORDER BY logged_at DESC LIMIT 1`)).rows[0];
  check('the restoration is recorded as an administrator action',
    restoreRow.user_id === adminId && restoreRow.resource_id === fam2Id &&
    restoreRow.actor_type === 'administrator' &&
    JSON.parse(restoreRow.event_detail).previousStatus === 'frozen');
  check('restoring an unrestricted account is refused',
    (await send('POST', `/admin/accounts/${fam2Id}/restore`, { reason: 'nothing to do' }, adminToken, KE_IP)).status === 409);
  const pendingRestore = await send('POST', `/admin/accounts/${pendingCgId}/restore`,
    { reason: 'skipping verification' }, adminToken, KE_IP);
  check('restore cannot be used to skip caregiver verification',
    pendingRestore.status === 409 && pendingRestore.body.code === 'PENDING_VERIFICATION');

  // Restoration also lifts the temporary lock left by failed verification codes.
  await pool.query(
    `UPDATE users SET locked_until = NOW() + interval '15 minutes' WHERE id=$1`, [fam2Id]);
  check('a locked but otherwise active account can be restored',
    (await send('POST', `/admin/accounts/${fam2Id}/restore`, { reason: 'User confirmed by phone.' },
      adminToken, KE_IP)).status === 200);
  check('the temporary lock was cleared', (await pool.query(
    'SELECT locked_until FROM users WHERE id=$1', [fam2Id])).rows[0].locked_until === null);

  await resetVelocity();
  const cgSession = (await pool.query(
    `SELECT id FROM sessions WHERE user_id=$1 AND session_status='active' ORDER BY created_at DESC LIMIT 1`,
    [cgId])).rows[0].id;
  const adminSession = (await pool.query(
    `SELECT id FROM sessions WHERE user_id=$1 AND session_status='active' ORDER BY created_at DESC LIMIT 1`,
    [adminId])).rows[0].id;
  const selfBlock = await send('POST', `/admin/sessions/${adminSession}/block`,
    { reason: 'ending my own session' }, adminToken, KE_IP);
  check('an administrator cannot block their own session',
    selfBlock.status === 400 && selfBlock.body.code === 'CANNOT_ACT_ON_SELF');
  const blocked = await send('POST', `/admin/sessions/${cgSession}/block`,
    { reason: 'Session seen from an unexpected network during an investigation.' }, adminToken, KE_IP);
  check('an administrator blocks one session', blocked.status === 200);
  check('the blocked session stops working at once',
    (await send('GET', '/profiles', null, cgToken, KE_IP)).status === 401);
  check('the account itself was untouched', (await pool.query(
    'SELECT account_status FROM users WHERE id=$1', [cgId])).rows[0].account_status === 'active');
  const blockRow = (await pool.query(
    `SELECT user_id, resource_id, resource_type, actor_type FROM audit_logs
     WHERE event_type='session_blocked' ORDER BY logged_at DESC LIMIT 1`)).rows[0];
  check('the session block names the administrator and the session',
    blockRow.user_id === adminId && blockRow.resource_id === cgSession &&
    blockRow.resource_type === 'session' && blockRow.actor_type === 'administrator');
  check('blocking an already-ended session is refused',
    (await send('POST', `/admin/sessions/${cgSession}/block`, { reason: 'again' }, adminToken, KE_IP)).status === 409);

  origLog('\n=== 16b. Configurable response rules ===');
  check('the default rules freeze on a risk-engine block',
    policy.responseFor({ action: 'block' }).freezeAccount === true &&
    policy.responseFor({ action: 'block' }).rules.join() === 'freeze_on_block');
  check('by default a flagged session does not cost the account',
    policy.responseFor({ severity: 'critical' }).freezeAccount === false);
  check('the flagged sessions from sections 10 and 11 left their accounts active', (await pool.query(
    `SELECT count(*)::int n FROM audit_logs
     WHERE event_type='session_flagged' AND event_detail LIKE '%"accountFrozen":false%'`)).rows[0].n >= 2);
  check('detector actions are distinguishable from human ones', (await pool.query(
    `SELECT count(*)::int n FROM audit_logs WHERE actor_type='automated'`)).rows[0].n > 0);
  policy.POLICY.freezeOnSeverities.push('critical');
  check('configuring a severity to freeze changes the response',
    policy.responseFor({ severity: 'critical' }).freezeAccount === true &&
    policy.responseFor({ severity: 'critical' }).rules.includes('freeze_on_severity'));
  policy.POLICY.freezeOnSeverities.pop();
  const thresholdBefore = policy.POLICY.freezeRiskThreshold;
  policy.POLICY.freezeRiskThreshold = 90;
  check('a risk-score threshold freezes without an explicit block',
    policy.responseFor({ action: 'step_up', riskScore: 95 }).freezeAccount === true &&
    policy.responseFor({ action: 'step_up', riskScore: 80 }).freezeAccount === false);
  policy.POLICY.freezeRiskThreshold = thresholdBefore;
  const policyView = await send('GET', '/admin/policy', null, adminToken, KE_IP);
  check('an administrator can read the rules in force',
    policyView.status === 200 && policyView.body.policy.freezeOnBlock === true);
  check('a family member cannot read the rules',
    (await send('GET', '/admin/policy', null, famToken, KE_IP)).status === 403);

  origLog('\n=== 17. Explanation generation ===');
  const explanation = require('./src/services/explanation');
  check('an allowed access explains the grant',
    explanation.forAccess({ decision: 'allow', code: 'family_owner', action: 'read',
      resourceType: 'elderly_profile' }) ===
    'Read access to a care profile was allowed: the requester is the family member who registered it.');
  check('an event stored without an explanation still gets one',
    explanation.forEvent({ event_type: 'login_success',
      event_detail: JSON.stringify({ riskScore: 12.44, governedBy: 'model' }) }) ===
    'Signed in successfully. Risk score 12.4, decided by the anomaly model.');
  check('a stored explanation is preferred over the template',
    explanation.forEvent({ event_type: 'login_success', explanation: 'kept as written' }) === 'kept as written');
  check('an unrecognised event type still produces a sentence',
    explanation.forEvent({ event_type: 'some_new_event' }) === 'Recorded event: some new event.');
  check('detail that is not JSON does not throw',
    typeof explanation.forEvent({ event_type: 'logout', event_detail: 'not json' }) === 'string');

  origLog('\n=== 18. Dashboard read endpoints ===');
  /*
   * The dashboard's four read endpoints, against the data the preceding
   * seventeen sections produced. That ordering is the point: these are views
   * over real detector output — sign-ins, step-ups, a block, flagged sessions,
   * refused accesses — rather than fixtures written to make a chart look full,
   * so a count that disagrees with the database fails here.
   */
  const timeWindow = require('./src/utils/timeWindow');
  // This section makes tens of requests on one administrator session, which is
  // what an open dashboard does. The harness runs with API velocity limits set
  // deliberately low (10 requests a minute) so section 11 can cross them in a
  // few calls; left at that, every check below would be answered 429 and the
  // session would be flagged halfway through. The limits are raised to a
  // realistic dashboard budget for this section only — the velocity behaviour
  // itself is already covered, and what is under test here is the read path.
  const velocity = require('./src/services/apiVelocity');
  Object.assign(velocity.LIMITS.session, { soft: 1000, hard: 2000 });
  Object.assign(velocity.LIMITS.user, { soft: 1000, hard: 2000 });
  await resetVelocity();

  const ev = await send('GET', '/admin/events?window=24h&limit=5', null, adminToken, KE_IP);
  check('the event feed returns a page with its total',
    ev.status === 200 && ev.body.events.length === 5 && ev.body.total > 5 &&
    ev.body.limit === 5 && ev.body.window === '24h');
  check('the feed echoes the window it resolved',
    Date.parse(ev.body.from) < Date.parse(ev.body.to) &&
    Date.parse(ev.body.previousFrom) < Date.parse(ev.body.from));
  check('every event carries a readable explanation',
    ev.body.events.every((e) => typeof e.explanation === 'string' && e.explanation.length > 0));
  check('the feed pages without repeating a row',
    (await send('GET', '/admin/events?window=24h&limit=5&offset=5', null, adminToken, KE_IP))
      .body.events.every((e) => !ev.body.events.some((f) => f.id === e.id)));

  const bySeverity = await send('GET', '/admin/events?severity=critical', null, adminToken, KE_IP);
  check('the feed filters by severity',
    bySeverity.status === 200 && bySeverity.body.events.length > 0 &&
    bySeverity.body.events.every((e) => e.severity === 'critical'));
  check('the feed filters by the acting account\'s role',
    (await send('GET', '/admin/events?role=administrator', null, adminToken, KE_IP))
      .body.events.every((e) => !e.actor || e.actor.role === 'administrator'));
  const sorted = await send('GET', '/admin/events?sort=severity&order=desc&limit=20',
    null, adminToken, KE_IP);
  const rank = { info: 1, medium: 2, high: 3, critical: 4 };
  check('the feed sorts severity by rank, not alphabetically',
    sorted.body.events.every((e, i, a) => i === 0 || rank[a[i - 1].severity] >= rank[e.severity]));
  check('an unknown filter is rejected rather than ignored',
    (await send('GET', '/admin/events?nonsense=1', null, adminToken, KE_IP)).status === 400);
  check('a window outside the allowed set is rejected',
    (await send('GET', '/admin/events?window=all-time', null, adminToken, KE_IP)).status === 400);
  // A '%' in free text must search for a literal '%', not match every row
  check('free text does not let a wildcard through',
    (await send('GET', '/admin/events?search=%25', null, adminToken, KE_IP)).body.total === 0);

  const anoms = await send('GET', '/admin/anomalies?window=24h', null, adminToken, KE_IP);
  check('the anomaly list returns scored sign-ins',
    anoms.status === 200 && anoms.body.anomalies.length > 0 &&
    anoms.body.anomalies.every((a) => typeof a.riskScore === 'number'));
  check('each anomaly reports the action and what governed it',
    anoms.body.anomalies.every((a) => ['allow', 'step_up', 'block'].includes(a.decision.action) &&
      typeof a.decision.governedBy === 'string'));
  check('each anomaly breaks its features into named signals',
    anoms.body.anomalies.every((a) => Array.isArray(a.signals) && a.signals.length >= 5 &&
      a.signals.every((s) => typeof s.label === 'string' && typeof s.explanation === 'string')));
  check('signals are ordered with the unusual ones first',
    anoms.body.anomalies.every((a) => a.signals.every((s, i, arr) =>
      i === 0 || !(s.contributed && !arr[i - 1].contributed))));
  const stepUps = await send('GET', '/admin/anomalies?action=step_up', null, adminToken, KE_IP);
  check('the anomaly list filters by the action taken',
    stepUps.status === 200 && stepUps.body.anomalies.length > 0 &&
    stepUps.body.anomalies.every((a) => a.decision.action === 'step_up'));
  const reviewQueue = await send('GET', '/admin/anomalies?flaggedOnly=true', null, adminToken, KE_IP);
  check('the review queue excludes the allowed sign-ins',
    reviewQueue.body.anomalies.every((a) => a.decision.action !== 'allow') &&
    reviewQueue.body.total === stepUps.body.total +
      (await send('GET', '/admin/anomalies?action=block', null, adminToken, KE_IP)).body.total);
  check('the anomaly list sorts by score',
    (await send('GET', '/admin/anomalies?sort=score&order=desc', null, adminToken, KE_IP))
      .body.anomalies.every((a, i, arr) => i === 0 || arr[i - 1].riskScore >= a.riskScore));
  check('phone numbers are masked on the anomaly list',
    anoms.body.anomalies.every((a) => !a.account || !/^\+254\d{9}$/.test(a.account.phoneNumber)));

  const sum = await send('GET', '/admin/stats/summary?window=24h', null, adminToken, KE_IP);
  check('the summary returns every KPI with a previous period',
    sum.status === 200 &&
    ['logins', 'failedLogins', 'anomaliesFlagged', 'loginsBlocked', 'sessionsBlocked', 'events']
      .every((k) => typeof sum.body.metrics[k].value === 'number' &&
                    typeof sum.body.metrics[k].previous === 'number'));
  // The acceptance criterion: a card has to agree with the table behind it
  const dbCounts = (await pool.query(
    `SELECT count(*) FILTER (WHERE was_successful) AS ok,
            count(*) FILTER (WHERE NOT was_successful) AS bad
     FROM login_events WHERE login_time >= NOW() - INTERVAL '24 hours'`)).rows[0];
  check('the login cards match the database',
    sum.body.metrics.logins.value === Number(dbCounts.ok) &&
    sum.body.metrics.failedLogins.value === Number(dbCounts.bad));
  const activeNow = Number((await pool.query(
    "SELECT count(*) AS n FROM sessions WHERE session_status = 'active' AND expires_at > NOW()"
  )).rows[0].n);
  check('the active-session count matches the database',
    sum.body.activeSessions === activeNow);
  check('flagged anomalies equal the step-ups plus the blocks',
    sum.body.metrics.anomaliesFlagged.value ===
    sum.body.metrics.stepUpsRequired.value + sum.body.metrics.loginsBlocked.value);
  check('growth from nothing reports no percentage rather than +100%',
    timeWindow.trend(5, 0) === null && timeWindow.trend(0, 0) === 0 &&
    timeWindow.trend(15, 10) === 50);

  const ses = await send('GET', '/admin/sessions', null, adminToken, KE_IP);
  check('the session list returns the active sessions',
    ses.status === 200 && ses.body.sessions.length > 0 &&
    ses.body.sessions.every((s) => s.status === 'active'));
  check('the session list agrees with the summary card',
    ses.body.total === activeNow);
  check('each session reports its device, address and start time',
    ses.body.sessions.every((s) => s.device && s.startedAt && s.account.fullName));
  check('Redis reports whether the fast path still holds the session',
    ses.body.cache.available === true &&
    ses.body.sessions.every((s) => s.cache.cached === true && s.cache.ttlSeconds > 0));
  const flaggedSessions = await send('GET', '/admin/sessions?status=flagged', null, adminToken, KE_IP);
  check('sessions ended by a detector are listed with their reason',
    flaggedSessions.status === 200 && flaggedSessions.body.sessions.length > 0 &&
    flaggedSessions.body.sessions.every((s) => s.flagged && s.flagged.reason));

  // Authorization: the role is re-read from the database on every one of these
  for (const [path, label] of [['/admin/events', 'the event feed'],
                               ['/admin/anomalies', 'the anomaly list'],
                               ['/admin/stats/summary', 'the summary'],
                               ['/admin/sessions', 'the session list']]) {
    check(`a family member cannot read ${label}`,
      (await send('GET', path, null, famToken, KE_IP)).status === 403);
    check(`an unauthenticated request cannot read ${label}`,
      (await send('GET', path, null, null, KE_IP)).status === 401);
  }
  // The caregiver's session was ended earlier in the run, which is itself worth
  // asserting: the session check runs before the role check, so a token whose
  // session is gone is refused without the authorization layer being consulted
  // at all. That ordering is what makes a logout take effect immediately.
  check('a token whose session has ended is refused before the role is considered',
    (await send('GET', '/admin/events', null, cgToken, KE_IP)).status === 401);
  const cgFresh = (await loginAs(CG_PHONE, 'device-cg-ccc33333', KE_IP)).body.accessToken;
  await resetVelocity();
  check('a caregiver with a live session still cannot read the event feed',
    (await send('GET', '/admin/events', null, cgFresh, KE_IP)).status === 403);
  check('a refused dashboard read is itself recorded',
    (await send('GET', '/audit?eventType=resource_access&resourceType=security_stats',
      null, adminToken, KE_IP)).body.events.some((e) => e.decision === 'deny'));
  check('an administrator reading one account\'s history is recorded',
    (await send('GET', `/admin/events?userId=${userId}`, null, adminToken, KE_IP)).status === 200);
  await new Promise((r) => setTimeout(r, 150));   // the audit write is fire-and-forget
  check('the targeted read names the account that was inspected',
    (await send('GET', '/audit?eventType=admin_data_viewed', null, adminToken, KE_IP))
      .body.events.some((e) => e.resourceId === userId && e.actorType === 'administrator'));

  // The acceptance criterion: a filtered, paginated page in under 500 ms
  const timings = [];
  for (const path of ['/admin/events?window=7d&limit=50&severity=info',
                      '/admin/anomalies?window=7d&limit=50',
                      '/admin/stats/summary?window=30d',
                      '/admin/sessions?limit=50']) {
    const started = Date.now();
    const r = await send('GET', path, null, adminToken, KE_IP);
    timings.push({ endpoint: path.split('?')[0], ms: Date.now() - started, status: r.status });
  }
  check('every dashboard endpoint answers in under 500 ms',
    timings.every((t) => t.status === 200 && t.ms < 500));
  console.table(timings);

  origLog('\n=== 19. Dashboard charts, export and the live feed ===');
  /*
   * The aggregate endpoints the charts read, and the stream behind the
   * dashboard's notifications. Checked against the same data the preceding
   * sections produced, so a chart that disagrees with the event feed fails
   * here — which is the acceptance criterion for the visualisation module.
   */
  const audit = require('./src/utils/audit');
  const series = await send('GET', '/admin/stats/timeseries?window=24h&groupBy=eventType',
    null, adminToken, KE_IP);
  check('the timeline returns buckets spanning the whole window',
    series.status === 200 && series.body.points.length > 20 &&
    series.body.bucketSeconds === 3600 && series.body.bucketLabel === 'hour');
  check('empty buckets are filled in rather than omitted',
    series.body.points.some((p) => p.total === 0) &&
    series.body.points.every((p, i, a) => i === 0 || p.at > a[i - 1].at));
  check('bucket boundaries are a whole number of bucket widths apart',
    series.body.points.every((p, i, a) => i === 0 || p.at - a[i - 1].at === series.body.bucketSeconds));
  // The acceptance criterion: the chart and the feed must agree
  const feedTotal = (await send('GET', '/admin/events?window=24h&limit=1', null, adminToken, KE_IP))
    .body.total;
  check('the timeline totals equal the event feed total for the same window',
    series.body.points.reduce((sum, p) => sum + p.total, 0) === feedTotal &&
    series.body.series.reduce((sum, s) => sum + s.total, 0) === feedTotal);

  const byLayer = await send('GET', '/admin/stats/timeseries?window=24h&groupBy=layer',
    null, adminToken, KE_IP);
  check('events can be grouped by the defence that recorded them',
    byLayer.status === 200 &&
    byLayer.body.series.every((s) =>
      ['pre_login', 'session', 'resource', 'administration', 'other'].includes(s.key)) &&
    byLayer.body.series.some((s) => s.key === 'pre_login'));
  check('an unclassified event type would land in its own bucket, not a default one',
    require('./src/services/securityLayers').forEvent('some_future_event') === 'other');
  check('a bad groupBy is rejected rather than silently defaulted',
    (await send('GET', '/admin/stats/timeseries?groupBy=nonsense', null, adminToken, KE_IP)).status === 400);

  const dist = await send('GET', '/admin/anomalies/distribution?window=7d', null, adminToken, KE_IP);
  check('the distribution returns score bands with their outcomes',
    dist.status === 200 && dist.body.histogram.length > 0 &&
    dist.body.histogram.every((b) => b.to - b.from === dist.body.bucketSize &&
      b.allowed + b.steppedUp + b.blocked === b.count));
  check('the histogram accounts for every scored sign-in',
    dist.body.histogram.reduce((sum, b) => sum + b.count, 0) ===
    Number((await pool.query(
      `SELECT count(*) AS n FROM anomaly_scores
       WHERE created_at >= NOW() - INTERVAL '7 days' AND isolation_forest_score IS NOT NULL`
    )).rows[0].n));
  check('the thresholds the chart marks are reported with their source',
    ['engine', 'fallback'].includes(dist.body.thresholds.source) &&
    typeof dist.body.thresholds.allowMax === 'number' &&
    dist.body.thresholds.stepUpMax > dist.body.thresholds.allowMax);
  // The ML stub in this harness has no /health route, so the fallback is what
  // should be reported — and reported as a fallback, never passed off as live.
  check('an unreachable engine reports fallback thresholds, not silent defaults',
    dist.body.thresholds.source === 'fallback' && !!dist.body.thresholds.reason);
  check('the breakdowns cover both the layer and the role',
    dist.body.byLayer.every((r) => r.label && r.ofConcern <= r.total) &&
    dist.body.byRole.every((r) => r.ofConcern <= r.total && r.accounts >= 0));

  const modelView = await send('GET', '/admin/model', null, adminToken, KE_IP);
  check('the model endpoint publishes the cutoffs the signal breakdown uses',
    modelView.status === 200 &&
    modelView.body.explanationCutoffs.time_deviation === 8.5 &&
    modelView.body.explanationCutoffs.login_velocity === 3 &&
    modelView.body.layers.length === 4);

  const geo = await send('GET', '/admin/locations?window=7d', null, adminToken, KE_IP);
  check('the locations endpoint returns points and impossible-travel legs',
    geo.status === 200 && Array.isArray(geo.body.points) &&
    Array.isArray(geo.body.impossibleTravel) && geo.body.impossibleTravel.length > 0);
  check('an impossible-travel leg carries the figures that justify it',
    geo.body.impossibleTravel.every((leg) =>
      typeof leg.distanceKm === 'number' && typeof leg.elapsedMinutes === 'number' &&
      typeof leg.requiredSpeedKmh === 'number' && typeof leg.explanation === 'string'));
  check('a leg recorded without coordinates reports no line rather than a guess',
    geo.body.impossibleTravel.every((leg) =>
      leg.points === null ||
      (Number.isFinite(leg.points.from.lat) && Number.isFinite(leg.points.to.lat))));

  const csv = await send('GET', '/admin/events.csv?window=24h', null, adminToken, KE_IP);
  const csvText = csv.body.raw || '';
  check('the export returns a CSV with a header row per column',
    csv.status === 200 && csvText.startsWith('"time"') &&
    csvText.includes('"severity"') && csvText.includes('"explanation"'));
  /*
   * The byte order mark has to be checked on the bytes, not on the decoded
   * text: Response.text() decodes as UTF-8 and strips a leading BOM per the
   * spec, so a text-level assertion would fail whether or not the mark was
   * sent. The mark matters because Excel on Windows otherwise guesses the
   * system codepage and mangles any name outside ASCII.
   */
  const csvBytes = new Uint8Array(await (await fetch(
    'http://127.0.0.1:3000/admin/events.csv?window=24h',
    { headers: { Authorization: `Bearer ${adminToken}`, 'X-Forwarded-For': KE_IP } }
  )).arrayBuffer());
  check('the export is sent with a UTF-8 byte order mark',
    csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF);
  check('the export uses CRLF line endings',
    csvText.includes(String.fromCharCode(13, 10)));
  check('the export has a row per event in the window',
    csvText.trim().split('\r\n').length === feedTotal + 1);
  /*
   * Formula injection. The audit trail is a file full of attacker-influenced
   * strings that an administrator will open in a spreadsheet, so a cell that
   * starts with '=' must not arrive as a formula.
   */
  const { csvCell } = require('./src/controllers/adminAnalyticsController');
  check('a cell that looks like a formula is neutralised',
    csvCell('=1+1') === '"\t=1+1"' && csvCell('@SUM(A1)') === '"\t@SUM(A1)"' &&
    csvCell('-2+3') === '"\t-2+3"' && csvCell('+1') === '"\t+1"');
  check('a quote inside a cell is doubled, not dropped',
    csvCell('say "hello"') === '"say ""hello"""');
  check('an ordinary cell is not mangled',
    csvCell('Nairobi, KE') === '"Nairobi, KE"' && csvCell(null) === '' &&
    csvCell(undefined) === '' && csvCell(0) === '"0"');
  check('a family member cannot export the trail',
    (await send('GET', '/admin/events.csv', null, famToken, KE_IP)).status === 403);
  await new Promise((r) => setTimeout(r, 150));
  check('the export is recorded as its own action, not as another read',
    (await send('GET', '/audit?eventType=admin_export', null, adminToken, KE_IP))
      .body.events.some((e) => e.action === 'export' && e.actorType === 'administrator'));

  /*
   * The live feed. The acceptance criterion is that a simulated critical
   * anomaly reaches an open dashboard within a few seconds and without a
   * refresh, so that is what is measured: subscribe, write an event through the
   * ordinary audit path, and time its arrival.
   */
  const streamed = [];
  let streamReady = null;
  const streamAbort = new AbortController();
  const readyPromise = new Promise((resolve) => { streamReady = resolve; });

  (async () => {
    const response = await fetch('http://127.0.0.1:3000/admin/stream', {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Forwarded-For': KE_IP },
      signal: streamAbort.signal,
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const record = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const name = /^event: (.+)$/m.exec(record)?.[1];
        const payload = /^data: (.+)$/m.exec(record)?.[1];
        if (!payload) continue;
        if (name === 'ready') streamReady(JSON.parse(payload));
        else if (name === 'security') streamed.push({ at: Date.now(), event: JSON.parse(payload) });
      }
    }
  })().catch(() => { /* aborted at the end of the section */ });

  const ready = await Promise.race([
    readyPromise,
    new Promise((r) => setTimeout(() => r(null), 4000)),
  ]);
  check('the stream states up front whether delivery is live',
    ready !== null && typeof ready.live === 'boolean' && ready.heartbeatSeconds > 0);
  check('a live stream reports no polling fallback, and a dead one names it',
    ready && (ready.live ? ready.fallback === null : ready.fallback === 'poll'));

  if (ready && ready.live) {
    const sentAt = Date.now();
    await audit.logEvent({
      userId, eventType: 'login_blocked', severity: 'critical', actorType: 'automated',
      detail: { riskScore: 97.3, simulated: true },
      explanation: 'Simulated critical anomaly for the live-feed check.',
    });

    const arrival = await (async () => {
      for (let waited = 0; waited < 5000; waited += 100) {
        const hit = streamed.find((s) => s.event.eventType === 'login_blocked' &&
          s.event.severity === 'critical');
        if (hit) return hit.at - sentAt;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    })();

    check('a critical anomaly reaches an open dashboard within a few seconds',
      arrival !== null && arrival < 3000);
    origLog(`      (delivered in ${arrival} ms)`);
    check('the delivered event carries what a notification needs',
      streamed.some((s) => s.event.severity === 'critical' && s.event.layer === 'pre_login' &&
        typeof s.event.explanation === 'string' && s.event.explanation.length > 0));
  } else {
    check('a critical anomaly reaches an open dashboard within a few seconds',
      false);   // the stream never became live; the fan-out is broken
  }

  check('a family member cannot open the live feed',
    (await send('GET', '/admin/stream', null, famToken, KE_IP)).status === 403);

  streamAbort.abort();
  require('./src/services/securityStream').shutdown();

  origLog('\n=== 20. Anomaly review, accounts and administrator response ===');
  /*
   * The verdict, the account views, and the two responses that sit between
   * doing nothing and freezing an account outright.
   */
  const queue = await send('GET', '/admin/anomalies?flaggedOnly=true&limit=5',
    null, adminToken, KE_IP);
  const toReview = queue.body.anomalies[0];
  check('a flagged sign-in starts with no verdict recorded',
    !!toReview && toReview.review === null);
  check('the queue can be narrowed to what nobody has ruled on',
    (await send('GET', '/admin/anomalies?reviewStatus=unreviewed', null, adminToken, KE_IP))
      .body.anomalies.every((a) => a.review === null));

  const verdict = await send('PATCH', `/admin/anomalies/${toReview.id}`,
    { reviewStatus: 'false_positive', note: 'Owner confirmed the travel by phone.' },
    adminToken, KE_IP);
  check('an administrator can record that the service was wrong',
    verdict.status === 200 && verdict.body.anomaly.reviewStatus === 'false_positive');
  const reviewed = await send('GET', '/admin/anomalies?reviewStatus=false_positive',
    null, adminToken, KE_IP);
  const reviewedRow = reviewed.body.anomalies.find((a) => a.id === toReview.id);
  check('the verdict comes back on the anomaly, with who recorded it',
    !!reviewedRow && reviewedRow.review.status === 'false_positive' &&
    reviewedRow.review.by.fullName === 'Ops Admin' && !!reviewedRow.review.at &&
    reviewedRow.review.note === 'Owner confirmed the travel by phone.');
  check('an unknown verdict is rejected',
    (await send('PATCH', `/admin/anomalies/${toReview.id}`, { reviewStatus: 'maybe' },
      adminToken, KE_IP)).status === 400);
  check('a verdict on a non-existent anomaly is a 404, not a silent success',
    (await send('PATCH', '/admin/anomalies/11111111-2222-3333-4444-555555555555',
      { reviewStatus: 'true_positive' }, adminToken, KE_IP)).status === 404);
  check('a family member cannot record a verdict',
    (await send('PATCH', `/admin/anomalies/${toReview.id}`, { reviewStatus: 'true_positive' },
      famToken, KE_IP)).status === 403);
  await new Promise((r) => setTimeout(r, 200));
  check('the verdict is written to the trail with the account it concerns',
    (await send('GET', '/audit?eventType=anomaly_reviewed', null, adminToken, KE_IP))
      .body.events.some((e) => e.detail.reviewStatus === 'false_positive' &&
        e.actorType === 'administrator'));

  const reviewStats = await send('GET', '/admin/anomalies/review-stats?window=7d',
    null, adminToken, KE_IP);
  check('review coverage is reported alongside the false-positive rate',
    reviewStats.status === 200 && reviewStats.body.falsePositive >= 1 &&
    reviewStats.body.falsePositiveRate === 100 && reviewStats.body.reviewCoverage > 0);
  check('a rate computed over nothing is null, not zero per cent',
    (await send('GET',
      '/admin/anomalies/review-stats?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z',
      null, adminToken, KE_IP)).body.falsePositiveRate === null);

  const accountList = await send('GET', '/admin/accounts?limit=50', null, adminToken, KE_IP);
  check('the account list returns role, standing and last sign-in',
    accountList.status === 200 && accountList.body.accounts.length > 0 &&
    accountList.body.accounts.every((a) => a.role && a.accountStatus &&
      typeof a.events === 'number' && typeof a.activeSessions === 'number'));
  check('phone numbers are masked in the account list',
    accountList.body.accounts.every((a) => !/^\+254\d{9}$/.test(a.phoneNumber)));
  check('the list filters by role and by standing',
    (await send('GET', '/admin/accounts?role=caregiver', null, adminToken, KE_IP))
      .body.accounts.every((a) => a.role === 'caregiver') &&
    (await send('GET', '/admin/accounts?status=frozen', null, adminToken, KE_IP))
      .body.accounts.every((a) => a.accountStatus === 'frozen'));
  check('the list can be searched by name',
    (await send('GET', '/admin/accounts?search=Mary', null, adminToken, KE_IP))
      .body.accounts.some((a) => a.fullName.includes('Mary')));
  check('a wildcard in the search is escaped rather than matching everything',
    (await send('GET', '/admin/accounts?search=%25', null, adminToken, KE_IP)).body.total === 0);
  // Counted with lateral subqueries rather than a join and GROUP BY, which would
  // multiply audit rows by sign-ins before aggregating.
  const trueEventCount = Number((await pool.query(
    'SELECT count(*) AS n FROM audit_logs WHERE user_id = $1', [userId])).rows[0].n);
  const listedRow = accountList.body.accounts.find((a) => a.id === userId);
  check('event counts are per account, not multiplied by the join',
    !!listedRow && listedRow.events === trueEventCount);

  const detail = await send('GET', `/admin/accounts/${userId}`, null, adminToken, KE_IP);
  check('the account detail carries a risk summary over 90 days',
    detail.status === 200 && detail.body.riskSummary.periodDays === 90 &&
    detail.body.riskSummary.scored > 0);
  check('the detail carries the security history, every line explained',
    detail.body.history.length > 0 &&
    detail.body.history.every((e) => typeof e.explanation === 'string' && e.explanation.length > 0) &&
    detail.body.history.every((e) => typeof e.layer === 'string'));
  check('the detail carries the sessions and the trusted devices',
    Array.isArray(detail.body.sessions) && Array.isArray(detail.body.trustedDevices));
  // Administrators have no clinical access, so nothing here may carry care data
  // resource_type = 'elderly_profile' legitimately appears in the history: an
  // administrator must be able to see THAT a care profile was read. What must
  // never appear is the record's contents.
  check('the account detail exposes no care-record contents',
    await (async () => {
      const text = JSON.stringify(detail.body);
      /*
       * Clinical VALUES, not field names. A profile_updated event records which
       * fields were changed — ["homeAddress", "medicalNotes"] — and that is
       * exactly what an audit trail should say: it names what was touched
       * without reproducing the contents. The values themselves must never
       * appear, and those are what this checks for.
       */
      const clinical = ['Hypertension', 'metformin', 'Lavington',
                        'edited by the caregiver', '1948-'];
      return clinical.every((field) => !text.includes(field)) &&
        !Object.prototype.hasOwnProperty.call(detail.body, 'profiles');
    })());
  check('a family member cannot read an account detail',
    (await send('GET', `/admin/accounts/${userId}`, null, famToken, KE_IP)).status === 403);
  check('a malformed account id is a 404, not a database error',
    (await send('GET', '/admin/accounts/not-a-uuid', null, adminToken, KE_IP)).status === 404);

  const lockTarget = (await pool.query(
    `INSERT INTO users (phone_number, full_name, role, account_status, phone_verified)
     VALUES ('+254711000077', 'Lock Target', 'family', 'active', TRUE) RETURNING id`)).rows[0].id;
  const locked = await send('POST', `/admin/accounts/${lockTarget}/lock`,
    { reason: 'Reported lost phone; holding access until the owner calls back.', minutes: 45 },
    adminToken, KE_IP);
  check('an administrator can lock an account temporarily',
    locked.status === 200 && new Date(locked.body.account.lockedUntil) > new Date());
  await pool.query('DELETE FROM otps WHERE phone_number = $1', ['+254711000077']);
  const lockedAttempt = await send('POST', '/auth/login/verify',
    { phoneNumber: '+254711000077', otp: '000000', deviceFingerprint: PFP }, null, KE_IP);
  check('a locked account is refused at sign-in with a retry time',
    lockedAttempt.status === 423 && lockedAttempt.body.code === 'ACCOUNT_LOCKED' &&
    lockedAttempt.body.retryAfterSeconds > 0);
  const lockedDetail = await send('GET', `/admin/accounts/${lockTarget}`, null, adminToken, KE_IP);
  check('a lock is reported as a lock, and is distinct from a freeze',
    lockedDetail.body.account.lockedUntil !== null &&
    lockedDetail.body.account.accountStatus === 'active');
  check('an administrator cannot lock their own account',
    (await send('POST', `/admin/accounts/${adminId}/lock`, { reason: 'testing a self lock' },
      adminToken, KE_IP)).status === 400);
  check('a lock without a stated reason is refused',
    (await send('POST', `/admin/accounts/${lockTarget}/lock`, {}, adminToken, KE_IP)).status === 400);

  const devicesBefore = Number((await pool.query(
    'SELECT count(*) AS n FROM trusted_devices WHERE user_id = $1', [userId])).rows[0].n);
  const sessionsBefore = Number((await pool.query(
    "SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND session_status = 'active'",
    [userId])).rows[0].n);
  const stepUpResponse = await send('POST', `/admin/accounts/${userId}/require-step-up`,
    { reason: 'Owner reports their handset was stolen this morning.' }, adminToken, KE_IP);
  check('requiring step-up removes the account\'s trusted devices',
    stepUpResponse.status === 200 && stepUpResponse.body.devicesUntrusted === devicesBefore &&
    Number((await pool.query('SELECT count(*) AS n FROM trusted_devices WHERE user_id = $1',
      [userId])).rows[0].n) === 0);
  check('requiring step-up leaves live sessions running',
    Number((await pool.query(
      "SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND session_status = 'active'",
      [userId])).rows[0].n) === sessionsBefore);
  await new Promise((r) => setTimeout(r, 200));
  const adminTrail = (await send('GET', '/audit?actorType=administrator&limit=100',
    null, adminToken, KE_IP)).body.events;
  check('both responses are recorded against the account they were applied to',
    adminTrail.some((e) => e.eventType === 'account_locked' && e.resourceId === lockTarget) &&
    adminTrail.some((e) => e.eventType === 'step_up_required_by_admin' && e.resourceId === userId));
  check('a family member cannot apply either response',
    (await send('POST', `/admin/accounts/${lockTarget}/lock`, { reason: 'not allowed here' },
      famToken, KE_IP)).status === 403 &&
    (await send('POST', `/admin/accounts/${userId}/require-step-up`, { reason: 'not allowed here' },
      famToken, KE_IP)).status === 403);

  /*
   * The audit log viewer is read-only by construction rather than by the
   * interface omitting the buttons: the table itself refuses an edit, so there
   * is no endpoint that could offer one.
   */
  let trailEditRefused = false;
  try {
    await pool.query(
      "UPDATE audit_logs SET explanation = 'rewritten' WHERE id = (SELECT id FROM audit_logs LIMIT 1)");
  } catch (err) {
    trailEditRefused = /append-only/.test(err.message);
  }
  check('the trail refuses an edit at the database, not merely in the interface',
    trailEditRefused);


  origLog('\n=== anomaly_scores ===');
  const { rows } = await pool.query(
    `SELECT action, governed_by, cold_start, model_available, round(isolation_forest_score,2) AS risk
     FROM anomaly_scores ORDER BY created_at`);
  console.table(rows);

  origLog(`\n${pass.filter(Boolean).length}/${pass.length} checks passed`);
  await pool.end(); redis.disconnect(); mlServer.close();
  process.exit(pass.every(Boolean) ? 0 : 1);
})().catch(e => { origLog('TEST ERROR:', e); process.exit(1); });