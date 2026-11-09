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

(async () => {

  //Wait for the authentication service before preparing the test database
  await waitForServer();
  await pool.query('TRUNCATE notifications, audit_logs, anomaly_scores, login_events, sessions, trusted_devices, otps, users CASCADE');
  await redis.flushall();
  const pass = [];
  const check = (d, ok) => { pass.push(ok); origLog(`  [${ok ? 'PASS' : 'FAIL'}] ${d}`); };

  origLog('\n=== 1. Register (with backup email) ===');
  await post('/auth/register', { phoneNumber: PHONE, fullName: 'Jane Kamau',
    backupEmail: 'jane.backup@example.com', role: 'family', consent: true });
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

  origLog('\n=== anomaly_scores ===');
  const { rows } = await pool.query(
    `SELECT action, governed_by, cold_start, model_available, round(isolation_forest_score,2) AS risk
     FROM anomaly_scores ORDER BY created_at`);
  console.table(rows);

  origLog(`\n${pass.filter(Boolean).length}/${pass.length} checks passed`);
  await pool.end(); redis.disconnect(); mlServer.close();
  process.exit(pass.every(Boolean) ? 0 : 1);
})().catch(e => { origLog('TEST ERROR:', e); process.exit(1); });