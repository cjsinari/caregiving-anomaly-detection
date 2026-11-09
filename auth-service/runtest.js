// Everything in one process: ML stub, auth app, and the test flow.
require('dotenv').config({ path: '.env.test', override: true });

process.env.TRUST_PROXY = '';
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

const post = async (path, body, token) => {
  const r = await fetch(`http://127.0.0.1:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const get = async (path, token) => {
  const r = await fetch(`http://127.0.0.1:3000${path}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, body: await r.json() };
};

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

async function login(fp) {
  await clearOtps();
  await post('/auth/otp/request', { phoneNumber: PHONE, purpose: 'login' });
  return post('/auth/login/verify', { phoneNumber: PHONE, otp: otps.login, deviceFingerprint: fp });
}

(async () => {

  //Wait for the authentication service before preparing the test database
  await waitForServer();
  await pool.query('TRUNCATE audit_logs, anomaly_scores, login_events, sessions, trusted_devices, otps, users CASCADE');
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

  origLog('\n=== anomaly_scores ===');
  const { rows } = await pool.query(
    `SELECT action, governed_by, cold_start, model_available, round(isolation_forest_score,2) AS risk
     FROM anomaly_scores ORDER BY created_at`);
  console.table(rows);

  origLog(`\n${pass.filter(Boolean).length}/${pass.length} checks passed`);
  await pool.end(); redis.disconnect(); mlServer.close();
  process.exit(pass.every(Boolean) ? 0 : 1);
})().catch(e => { origLog('TEST ERROR:', e); process.exit(1); });