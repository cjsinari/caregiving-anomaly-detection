#!/usr/bin/env node
/*
 * Seed the database with security data for the dashboard.
 *
 *   node seed.js                 seed the database named in .env
 *   node seed.js --env .env.test seed another one
 *   node seed.js --days 30       how far back to generate (default 14)
 *   node seed.js --reset         remove previously seeded rows first
 *
 * ── What this is for ──
 *
 * Every chart and table in the console needs data to be judged. A dashboard
 * reviewed against three sign-ins from one address looks finished and is not:
 * the empty states never appear, the histogram is one bar, the map has one
 * point, no series folds into "Other", and nobody notices that the timeline
 * cannot show a gap. So this generates a fortnight of plausible traffic across
 * every event type, severity, layer and decision the service can produce.
 *
 * ── What it deliberately does NOT do ──
 *
 * It does not call the API or go through the risk engine. Those paths are what
 * the integration suite exercises; driving them here would make seeding slow,
 * dependent on a running ML service, and unable to place events in the past —
 * and the past is the whole point, since a time-series chart of data created in
 * the last four seconds is a single bar.
 *
 * It therefore writes rows directly, which means it must write them the way the
 * service does. Where it would be easy to drift — the shape of an audit detail,
 * the relationship between an anomaly score and the action taken, the fact that
 * a flagged session has both a reason and a time — it follows the real writers,
 * and the integration suite is what keeps those honest.
 *
 * ── Safety ──
 *
 * Seeded accounts use the reserved +254799xxxxxx range and are tagged in
 * event_detail with seeded:true, so --reset can remove exactly what was added
 * and nothing else. It refuses to run against a database whose name does not
 * look like a development or test one unless --force is given: generating
 * fictional security events into a production audit trail would corrupt the one
 * record that is supposed to be trustworthy.
 */

const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};

const envFile = flag('env', '.env');
require('dotenv').config({ path: path.resolve(__dirname, String(envFile)), override: true });

const pool = require('./src/config/db');

const DAYS = Number(flag('days', 14)) || 14;
const RESET = Boolean(flag('reset', false));
const FORCE = Boolean(flag('force', false));

const SEED_PREFIX = '+254799';

// ───────────────────────────── helpers ─────────────────────────────

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (min, max) => min + Math.random() * (max - min);
const chance = (p) => Math.random() < p;

/** A timestamp `daysAgo` days back, at a plausible hour for the given account. */
function momentWithin(daysAgo, baseHour) {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  // Hours cluster around the account's habitual time, which is what makes
  // time_deviation mean anything on the anomaly screens.
  const hour = Math.max(0, Math.min(23, Math.round(baseHour + between(-1.5, 1.5))));
  at.setHours(hour, Math.floor(between(0, 59)), Math.floor(between(0, 59)), 0);
  return at;
}

/*
 * Places, with coordinates, so the map has something to draw and the
 * impossible-travel legs are real distances rather than invented ones.
 */
const PLACES = {
  nairobi: { country: 'KE', city: 'Nairobi', lat: -1.2921, lon: 36.8219, ips: ['41.90.64.33', '41.90.70.12', '197.232.61.8'] },
  mombasa: { country: 'KE', city: 'Mombasa', lat: -4.0435, lon: 39.6682, ips: ['41.84.20.5', '197.237.1.44'] },
  kisumu: { country: 'KE', city: 'Kisumu', lat: -0.0917, lon: 34.768, ips: ['41.80.112.9'] },
  nakuru: { country: 'KE', city: 'Nakuru', lat: -0.3031, lon: 36.08, ips: ['41.89.64.21'] },
  lagos: { country: 'NG', city: 'Lagos', lat: 6.5244, lon: 3.3792, ips: ['105.112.44.9'] },
  london: { country: 'GB', city: 'London', lat: 51.5074, lon: -0.1278, ips: ['51.140.32.9'] },
  mumbai: { country: 'IN', city: 'Mumbai', lat: 19.076, lon: 72.8777, ips: ['103.21.58.7'] },
};

const KENYAN = [PLACES.nairobi, PLACES.mombasa, PLACES.kisumu, PLACES.nakuru];
const FOREIGN = [PLACES.lagos, PLACES.london, PLACES.mumbai];

const FIRST = ['Grace', 'Peter', 'Mary', 'Joseph', 'Esther', 'Daniel', 'Faith', 'Samuel',
               'Mercy', 'John', 'Ruth', 'David', 'Alice', 'Michael', 'Jane', 'Francis'];
const LAST = ['Wanjiku', 'Otieno', 'Kamau', 'Achieng', 'Mutiso', 'Njoroge', 'Chebet',
              'Mwangi', 'Odhiambo', 'Wafula', 'Kiptoo', 'Nyambura'];

/** The audit detail shapes the real writers produce, so the viewer sees real rows. */
function auditDetail(extra = {}) {
  return JSON.stringify({ seeded: true, ...extra });
}

async function insertAudit(client, {
  userId = null, sessionId = null, eventType, detail = {}, explanation = null,
  severity = 'info', resourceType = null, resourceId = null, action = null,
  decision = null, actorType = null, ip = null, at,
}) {
  await client.query(
    `INSERT INTO audit_logs
       (user_id, session_id, event_type, event_detail, explanation, severity,
        resource_type, resource_id, action, decision, actor_type, ip_address, logged_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [userId, sessionId, eventType, auditDetail(detail), explanation, severity,
     resourceType, resourceId, action, decision, actorType, ip, at]
  );
}

// ───────────────────────────── the seed ─────────────────────────────

async function main() {
  const dbName = process.env.DB_NAME || '';
  const looksSafe = /test|dev|local|staging/i.test(dbName);
  if (!looksSafe && !FORCE) {
    console.error(
      `Refusing to seed "${dbName}": the name does not look like a development or test database.\n` +
      'Generating fictional security events into a real audit trail would corrupt the one record\n' +
      'that is meant to be trustworthy. Pass --force if this really is a throwaway database.'
    );
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    if (RESET) await reset(client);

    console.log(`Seeding ${dbName} with ${DAYS} days of security data…`);

    const admin = await seedAdministrator(client);
    const people = await seedAccounts(client);
    const counts = await seedActivity(client, people, admin);

    console.log('\nSeeded:');
    console.table(counts);
    await report(client);

    console.log('\nSign in to the console as:');
    console.log(`  ${admin.phone}  (administrator, "${admin.name}")`);
    console.log('With OTP_DEV_MODE=true the service prints the login code to its own console.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

/** Remove exactly what a previous run added, and nothing else. */
async function reset(client) {
  console.log('Removing previously seeded rows…');
  const { rows } = await client.query(
    'SELECT id FROM users WHERE phone_number LIKE $1', [`${SEED_PREFIX}%`]);
  const ids = rows.map((r) => r.id);

  // audit_logs is append-only: its trigger refuses DELETE, which is the whole
  // point of the table. Seeded rows are removed by dropping the trigger for the
  // duration of the delete and putting it back — deliberately explicit, because
  // it is the one operation that can erase history and it should be visible in
  // the diff rather than hidden behind a helper.
  await client.query('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_append_only');
  try {
    await client.query("DELETE FROM audit_logs WHERE event_detail LIKE '%\"seeded\":true%'");
    if (ids.length) await client.query('DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [ids]);
  } finally {
    await client.query('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_append_only');
  }

  if (ids.length) {
    // anomaly_scores has no user_id; it hangs off login_events.
    await client.query(
      `DELETE FROM anomaly_scores WHERE login_event_id IN
         (SELECT id FROM login_events WHERE user_id = ANY($1::uuid[]))`, [ids]);
    await client.query('DELETE FROM login_events WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM trusted_devices WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  }
  console.log(`Removed ${ids.length} seeded account(s) and their events.`);
}

async function seedAdministrator(client) {
  const phone = `${SEED_PREFIX}000001`;
  const name = 'Ops Administrator';
  const { rows } = await client.query(
    `INSERT INTO users (phone_number, full_name, role, account_status, phone_verified, consent_at)
     VALUES ($1, $2, 'administrator', 'active', TRUE, NOW())
     ON CONFLICT (phone_number) DO UPDATE
       SET role = 'administrator', account_status = 'active', phone_verified = TRUE
     RETURNING id`, [phone, name]);
  return { id: rows[0].id, phone, name };
}

/*
 * Accounts with enough variety that every filter has something to find.
 *
 * Standing, role and habits are assigned deliberately rather than randomly: the
 * console needs at least one frozen account, one pending caregiver, one account
 * that has never signed in, and one locked account, because each is a state the
 * interface renders differently and none of them would appear reliably from
 * random generation.
 */
async function seedAccounts(client) {
  const plan = [
    { role: 'family', status: 'active', count: 6 },
    { role: 'family', status: 'frozen', count: 1 },
    { role: 'family', status: 'pending', count: 1 },
    { role: 'caregiver', status: 'active', count: 4 },
    { role: 'caregiver', status: 'pending', count: 1 },
    { role: 'caregiver', status: 'suspended', count: 1 },
    { role: 'administrator', status: 'active', count: 1 },
  ];

  const people = [];
  let n = 2;

  for (const group of plan) {
    for (let i = 0; i < group.count; i += 1) {
      const phone = `${SEED_PREFIX}${String(n).padStart(6, '0')}`;
      n += 1;
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const createdAt = momentWithin(DAYS + Math.floor(between(1, 60)), 10);

      const { rows } = await client.query(
        `INSERT INTO users (phone_number, full_name, role, account_status, phone_verified,
                            verification_status, consent_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (phone_number) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [phone, name, group.role, group.status, group.status !== 'pending',
         group.role === 'caregiver' ? (group.status === 'active' ? 'verified' : 'unverified') : 'unverified',
         createdAt, createdAt]
      );

      people.push({
        id: rows[0].id,
        phone,
        name,
        role: group.role,
        status: group.status,
        home: pick(KENYAN),
        baseHour: Math.round(between(7, 21)),
        device: `seed-device-${crypto.randomBytes(4).toString('hex')}`,
        // One account never signs in, so "never" has a row in the user list.
        dormant: group.status === 'pending',
      });
    }
  }

  // One account carries a live temporary lock, which the list shows beside the
  // standing rather than instead of it.
  const lockable = people.find((p) => p.role === 'family' && p.status === 'active');
  await client.query(
    'UPDATE users SET locked_until = NOW() + INTERVAL \'25 minutes\' WHERE id = $1', [lockable.id]);
  lockable.locked = true;

  console.log(`  ${people.length} accounts`);
  return people;
}

/*
 * The traffic. One pass per account per day, with the unusual cases injected
 * at known points so every view has something in it.
 */
async function seedActivity(client, people, admin) {
  const counts = {
    loginEvents: 0, anomalyScores: 0, auditRows: 0, sessions: 0,
    impossibleTravel: 0, blocked: 0, steppedUp: 0, denials: 0, reviewed: 0,
  };

  for (const person of people) {
    if (person.dormant) continue;

    await client.query(
      `INSERT INTO trusted_devices (user_id, device_fingerprint, device_label, trusted_at, last_seen_at)
       VALUES ($1,$2,$3,NOW() - INTERVAL '20 days', NOW())
       ON CONFLICT (user_id, device_fingerprint) DO NOTHING`,
      [person.id, person.device, `${person.name.split(' ')[0]}'s phone`]);

    for (let day = DAYS; day >= 0; day -= 1) {
      // Not every account signs in every day; the gaps are what let the
      // timeline show a quiet period rather than a flat line.
      if (chance(0.35)) continue;

      const attempts = chance(0.15) ? 2 : 1;
      for (let a = 0; a < attempts; a += 1) {
        const at = momentWithin(day, person.baseHour);
        const away = chance(0.12);
        const place = away ? pick([...KENYAN, ...FOREIGN]) : person.home;
        const foreign = place.country !== 'KE';
        const knownCity = place.city === person.home.city;

        // The feature values the extractor would have produced, which is what
        // makes the score and the signal breakdown consistent with each other.
        const features = {
          login_hour: at.getHours(),
          time_deviation: Number(Math.abs(at.getHours() - person.baseHour).toFixed(4)),
          is_known_country: foreign ? 0 : 1,
          is_known_city: knownCity ? 1 : 0,
          login_velocity: a === 0 ? Math.floor(between(1, 3)) : Math.floor(between(4, 9)),
        };

        // Mirrors the engine's weighting closely enough that the histogram,
        // the thresholds and the decisions agree on screen.
        let score = (1 - features.is_known_country) * 45
          + (1 - features.is_known_city) * 20
          + Math.min(features.login_velocity, 258) / 258 * 40
          + Math.min(features.time_deviation, 16) / 16 * 10;
        score = Math.round(Math.min(score, 100) * 100) / 100;

        const action = score > 88 ? 'block' : score > 58.9 ? 'step_up' : 'allow';
        const riskLevel = score > 88 ? 'high' : score > 58.9 ? 'medium' : 'low';
        const succeeded = action !== 'block';
        const ip = pick(place.ips);

        const reasons = [];
        if (!features.is_known_country) reasons.push('login from an unfamiliar country');
        else if (!features.is_known_city) reasons.push('login from an unfamiliar city');
        if (features.login_velocity > 3) {
          reasons.push(`unusually high login frequency (${features.login_velocity} attempts)`);
        }
        if (features.time_deviation > 8.5) reasons.push('login at an unusual time for this account');
        const modelExplanation = reasons.length
          ? (riskLevel === 'low'
            ? `Login allowed. Noted: ${reasons.join(', ')}.`
            : `Flagged as ${riskLevel} risk due to: ${reasons.join(', ')}.`)
          : "Login matches this account's established behavioural pattern.";

        const { rows: eventRows } = await client.query(
          `INSERT INTO login_events
             (user_id, ip_address, device_fingerprint, country, city, latitude, longitude,
              login_velocity, was_successful, login_time)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [person.id, ip, person.device, place.country, place.city, place.lat, place.lon,
           features.login_velocity, succeeded, at]);
        counts.loginEvents += 1;

        // A verdict on roughly half the flagged sign-ins, so review coverage is
        // partial — which is the realistic state and the one that makes the
        // "reviewed N of M" figure worth showing.
        const flagged = action !== 'allow';
        const verdict = flagged && chance(0.5)
          ? (score > 88 || foreign ? 'true_positive' : 'false_positive')
          : null;
        if (verdict) counts.reviewed += 1;

        await client.query(
          `INSERT INTO anomaly_scores
             (login_event_id, isolation_forest_score, known_device, velocity_count, risk_level,
              explanation, action, governed_by, cold_start, model_available, features,
              review_status, review_note, reviewed_by, reviewed_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [eventRows[0].id, score, true, features.login_velocity, riskLevel, modelExplanation,
           action, 'model', false, true, JSON.stringify(features),
           verdict, verdict ? (verdict === 'false_positive'
             ? 'Phoned the owner; they were travelling for work.'
             : 'Owner did not recognise the activity.') : null,
           verdict ? admin.id : null, verdict ? new Date(at.getTime() + 3_600_000) : null, at]);
        counts.anomalyScores += 1;

        if (action === 'block') {
          counts.blocked += 1;
          await insertAudit(client, {
            userId: person.id, eventType: 'login_blocked', severity: 'critical',
            actorType: 'automated', ip, at,
            detail: { riskScore: score, action, governedBy: 'model', features, accountFrozen: false },
            explanation: modelExplanation,
          });
          counts.auditRows += 1;
        } else if (action === 'step_up') {
          counts.steppedUp += 1;
          await insertAudit(client, {
            userId: person.id, eventType: 'step_up_required', severity: 'medium',
            actorType: 'automated', ip, at,
            detail: { riskScore: score, action, governedBy: 'model', features, channel: 'sms' },
            explanation: modelExplanation,
          });
          await insertAudit(client, {
            userId: person.id, eventType: 'step_up_passed', severity: 'info', ip,
            at: new Date(at.getTime() + 45_000), detail: { deviceTrusted: true },
          });
          counts.auditRows += 2;
        }

        if (succeeded) {
          const sessionId = crypto.randomUUID();
          const ends = new Date(at.getTime() + between(0.5, 8) * 3_600_000);
          const stillLive = day === 0 && chance(0.5);

          await client.query(
            `INSERT INTO sessions
               (id, user_id, user_role, refresh_token, risk_score, device_fingerprint, ip_address,
                session_status, created_at, expires_at, last_seen_ip, last_seen_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [sessionId, person.id, person.role, crypto.randomBytes(32).toString('hex'), score,
             person.device, ip, stillLive ? 'active' : 'invalidated', at,
             stillLive ? new Date(Date.now() + 7 * 86_400_000) : ends, ip, ends]);
          counts.sessions += 1;

          await insertAudit(client, {
            userId: person.id, sessionId, eventType: 'login_success', severity: 'info', ip, at,
            detail: { riskScore: score, governedBy: 'model', coldStart: false },
          });
          counts.auditRows += 1;

          // Resource access, which is the layer with the most traffic and the
          // fewest interesting rows — exactly the shape the breakdown exists
          // to show.
          const reads = Math.floor(between(1, 5));
          for (let k = 0; k < reads; k += 1) {
            const denied = chance(0.12);
            const atRead = new Date(at.getTime() + k * 180_000);
            if (denied) counts.denials += 1;
            await insertAudit(client, {
              userId: person.id, sessionId, eventType: 'resource_access',
              severity: denied ? 'medium' : 'info',
              resourceType: 'elderly_profile', resourceId: crypto.randomUUID(),
              action: pick(['read', 'read', 'read', 'write']),
              decision: denied ? 'deny' : 'allow',
              actorType: 'user', ip, at: atRead,
              detail: { decision: denied ? 'deny' : 'allow',
                        reason: denied ? (person.role === 'caregiver' ? 'no_assignment' : 'not_owner')
                                       : (person.role === 'family' ? 'family_owner' : 'caregiver_assignment') },
              explanation: denied
                ? 'Read access to a care profile was denied: '
                  + (person.role === 'caregiver'
                    ? 'the requester has no caregiver assignment to it.'
                    : "it belongs to another family member's account.")
                : 'Read access to a care profile was allowed: '
                  + (person.role === 'family'
                    ? 'the requester is the family member who registered it.'
                    : 'the requester has an active caregiver assignment to it.'),
            });
            counts.auditRows += 1;
          }

          await insertAudit(client, {
            userId: person.id, sessionId, eventType: 'token_refreshed', severity: 'info', ip,
            at: new Date(at.getTime() + 900_000),
          });
          await insertAudit(client, {
            userId: person.id, sessionId, eventType: 'logout', severity: 'info', ip, at: ends,
          });
          counts.auditRows += 2;

          // Impossible travel: a second appearance, far away, too soon. The
          // coordinates go on the event so the map can draw the leg.
          if (chance(0.06)) {
            const elsewhere = pick(FOREIGN.filter((p) => p.city !== place.city));
            const minutes = Math.floor(between(8, 50));
            const laterAt = new Date(at.getTime() + minutes * 60_000);
            const distanceKm = haversine(place, elsewhere);
            const speed = Math.round(distanceKm / (minutes / 60));

            await insertAudit(client, {
              userId: person.id, sessionId, eventType: 'impossible_travel', severity: 'high',
              actorType: 'automated', ip: pick(elsewhere.ips), at: laterAt,
              detail: {
                stage: 'refresh', distanceKm: Math.round(distanceKm), elapsedMinutes: minutes,
                requiredSpeedKmh: speed,
                from: `${place.city}, ${place.country}`,
                to: `${elsewhere.city}, ${elsewhere.country}`,
                fromCountry: place.country, toCountry: elsewhere.country,
                fromPoint: { lat: place.lat, lon: place.lon },
                toPoint: { lat: elsewhere.lat, lon: elsewhere.lon },
              },
              explanation:
                `Activity from ${elsewhere.city}, ${elsewhere.country} came ${minutes} minute(s) `
                + `after activity from ${place.city}, ${place.country}, ${Math.round(distanceKm)} km `
                + `away; that would need travel at about ${speed} km/h.`,
            });
            await client.query(
              `UPDATE sessions SET session_status = 'flagged', flagged_reason = 'impossible_travel',
                                   flagged_at = $2 WHERE id = $1`, [sessionId, laterAt]);
            await insertAudit(client, {
              userId: person.id, sessionId, eventType: 'session_flagged', severity: 'high',
              actorType: 'automated', ip: pick(elsewhere.ips),
              at: new Date(laterAt.getTime() + 1000),
              detail: { reason: 'impossible_travel' },
            });
            counts.impossibleTravel += 1;
            counts.auditRows += 2;
          }

          // API velocity, so the session layer has its second detector
          // represented and the throttle event type is not permanently absent.
          if (chance(0.04)) {
            await insertAudit(client, {
              userId: person.id, sessionId, eventType: 'api_velocity_throttled', severity: 'medium',
              actorType: 'automated', ip, at: new Date(at.getTime() + 600_000),
              detail: { classification: 'high_api_velocity', scope: 'session',
                        sessionCount: Math.floor(between(61, 140)), windowSeconds: 60 },
            });
            counts.auditRows += 1;
          }
        } else {
          // A failed attempt, which is what the "failed sign-ins" card counts.
          await insertAudit(client, {
            userId: person.id, eventType: 'otp_failed', severity: 'medium', ip, at,
            detail: { purpose: 'login', attempts: Math.floor(between(1, 3)) },
          });
          counts.auditRows += 1;
        }
      }
    }
  }

  await injectAttacks(client, people, admin, counts);
  counts.auditRows += await seedAdministratorActions(client, people, admin);
  return counts;
}

/*
 * Injected attacks: the sign-ins the service is supposed to block.
 *
 * Ordinary traffic cannot reach a blocking score, and that is not a flaw in the
 * generator — it is what the thresholds mean. An unfamiliar country and an odd
 * hour together come to about 76, which is a step-up. Getting past 88 takes the
 * thing the velocity feature exists to catch: a burst of attempts against one
 * account in a short window, which is somebody working through a list rather
 * than a person signing in.
 *
 * So the blocked rows come from a modelled credential-stuffing burst against a
 * few accounts from a foreign address, which is both the realistic source of a
 * block and the one that makes the review queue worth opening. Without this the
 * histogram has no right-hand tail, the "sign-ins blocked" card reads zero, and
 * nobody reviewing the dashboard would find out that the block path renders at
 * all.
 */
async function injectAttacks(client, people, admin, counts) {
  const targets = people.filter((p) => !p.dormant).slice(0, 3);
  let bursts = 0;

  for (const [index, person] of targets.entries()) {
    const origin = pick(FOREIGN);
    const dayOffset = Math.max(0, Math.floor(DAYS / 2) - index * 2);
    const start = momentWithin(dayOffset, 3);          // the small hours
    const attempts = Math.floor(between(6, 11));

    for (let i = 0; i < attempts; i += 1) {
      const at = new Date(start.getTime() + i * Math.floor(between(20_000, 90_000)));
      // Velocity climbs through the burst, which is what pushes the later
      // attempts over the blocking threshold while the first few only escalate.
      const velocity = 20 + i * Math.floor(between(18, 34));

      const features = {
        login_hour: at.getHours(),
        time_deviation: Number(Math.abs(at.getHours() - person.baseHour).toFixed(4)),
        is_known_country: 0,
        is_known_city: 0,
        login_velocity: velocity,
      };

      let score = 45 + 20
        + Math.min(features.login_velocity, 258) / 258 * 40
        + Math.min(features.time_deviation, 16) / 16 * 10;
      score = Math.round(Math.min(score, 100) * 100) / 100;

      const action = score > 88 ? 'block' : score > 58.9 ? 'step_up' : 'allow';
      const riskLevel = score > 88 ? 'high' : score > 58.9 ? 'medium' : 'low';
      const ip = pick(origin.ips);

      const reasons = ['login from an unfamiliar country',
                       `unusually high login frequency (${velocity} attempts)`];
      if (features.time_deviation > 8.5) reasons.push('login at an unusual time for this account');
      const modelExplanation = `Flagged as ${riskLevel} risk due to: ${reasons.join(', ')}.`;

      const { rows } = await client.query(
        `INSERT INTO login_events
           (user_id, ip_address, device_fingerprint, country, city, latitude, longitude,
            login_velocity, was_successful, login_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9) RETURNING id`,
        [person.id, ip, `attacker-${crypto.randomBytes(3).toString('hex')}`,
         origin.country, origin.city, origin.lat, origin.lon, velocity, at]);
      counts.loginEvents += 1;

      // The blocks are the rows most worth reviewing, so most carry a verdict —
      // and a couple deliberately do not, so the unreviewed queue is not empty.
      const verdict = action === 'block' && chance(0.7) ? 'true_positive' : null;
      if (verdict) counts.reviewed += 1;

      await client.query(
        `INSERT INTO anomaly_scores
           (login_event_id, isolation_forest_score, known_device, velocity_count, risk_level,
            explanation, action, governed_by, cold_start, model_available, features,
            review_status, review_note, reviewed_by, reviewed_at, created_at)
         VALUES ($1,$2,FALSE,$3,$4,$5,$6,'model',FALSE,TRUE,$7,$8,$9,$10,$11,$12)`,
        [rows[0].id, score, velocity, riskLevel, modelExplanation, action,
         JSON.stringify(features), verdict,
         verdict ? 'Owner confirmed they were asleep; the attempts were not theirs.' : null,
         verdict ? admin.id : null, verdict ? new Date(at.getTime() + 7_200_000) : null, at]);
      counts.anomalyScores += 1;

      if (action === 'block') {
        counts.blocked += 1;
        await insertAudit(client, {
          userId: person.id, eventType: 'login_blocked', severity: 'critical',
          actorType: 'automated', ip, at,
          detail: { riskScore: score, action, governedBy: 'model', features,
                    accountFrozen: i === attempts - 1, policyRules: ['freeze_on_block'] },
          explanation: modelExplanation,
        });
        counts.auditRows += 1;
      } else {
        counts.steppedUp += action === 'step_up' ? 1 : 0;
        await insertAudit(client, {
          userId: person.id, eventType: 'otp_failed', severity: 'medium', ip, at,
          detail: { purpose: 'login', attempts: i + 1 },
        });
        counts.auditRows += 1;
      }
    }

    // The burst ends in a lockout, which is what repeated wrong codes produce.
    await insertAudit(client, {
      userId: person.id, eventType: 'otp_lockout', severity: 'high',
      actorType: 'automated', ip: pick(origin.ips),
      at: new Date(start.getTime() + attempts * 90_000),
      detail: { purpose: 'login', minutes: 15 },
    });
    counts.auditRows += 1;
    bursts += 1;
  }

  console.log(`  ${bursts} injected attack bursts`);
}

/*
 * Administrator actions, so the audit log viewer and the administration layer
 * have rows, and so the "who acted" filter has something in every bucket.
 */
async function seedAdministratorActions(client, people, admin) {
  let written = 0;
  const frozen = people.find((p) => p.status === 'frozen');
  const suspended = people.find((p) => p.status === 'suspended');

  if (frozen) {
    const at = momentWithin(Math.floor(DAYS / 2), 14);
    await insertAudit(client, {
      userId: admin.id, eventType: 'account_frozen', severity: 'critical',
      resourceType: 'account', resourceId: frozen.id, action: 'freeze', decision: 'allow',
      actorType: 'administrator', ip: pick(PLACES.nairobi.ips), at,
      detail: { reason: 'Three impossible-travel events in one hour; owner unreachable.',
                initiatedBy: 'administrator', endedSessions: 1 },
    });
    written += 1;
  }

  if (suspended) {
    const at = momentWithin(Math.floor(DAYS / 3), 11);
    await insertAudit(client, {
      userId: admin.id, eventType: 'account_locked', severity: 'high',
      resourceType: 'account', resourceId: suspended.id, action: 'lock', decision: 'allow',
      actorType: 'administrator', ip: pick(PLACES.nairobi.ips), at,
      detail: { reason: 'Caregiver reported a lost handset; holding access pending a call back.',
                minutes: 60 },
    });
    written += 1;
  }

  // A refused attempt on the trail by an account with no business there: the
  // kind of row the audit log exists to contain, and one the denial filter
  // needs in order to find anything.
  const prober = people.find((p) => p.role === 'family' && p.status === 'active');
  if (prober) {
    await insertAudit(client, {
      userId: prober.id, eventType: 'resource_access', severity: 'medium',
      resourceType: 'audit_trail', action: 'read', decision: 'deny',
      actorType: 'user', ip: pick(prober.home.ips), at: momentWithin(2, 23),
      detail: { decision: 'deny', reason: 'role_not_permitted', role: 'family',
                path: '/audit', method: 'GET' },
      explanation: 'Read access to the security audit trail was denied: a family account may not '
        + 'perform this action.',
    });
    written += 1;
  }

  // Administrator reads, so the administration layer is not only actions.
  for (let i = 0; i < 6; i += 1) {
    await insertAudit(client, {
      userId: admin.id, eventType: 'audit_viewed', severity: 'medium',
      resourceType: 'audit_trail', action: 'read', decision: 'allow',
      actorType: 'administrator', ip: pick(PLACES.nairobi.ips),
      at: momentWithin(Math.floor(between(0, DAYS)), 9),
      detail: { targetUserId: 'all', rows: Math.floor(between(20, 50)) },
    });
    written += 1;
  }

  console.log(`  ${written} administrator actions`);
  return written;
}

/** Great-circle distance, so the seeded travel legs state real distances. */
function haversine(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/*
 * Prove the seed actually fills every view, rather than asserting that it does.
 *
 * Each line is a query behind one panel. A zero here means a chart or a table
 * that an administrator would review as finished while looking at nothing, so
 * the script says which one.
 */
async function report(client) {
  const checks = [
    ['events, all severities', "SELECT count(DISTINCT severity) FROM audit_logs WHERE event_detail LIKE '%\"seeded\":true%'", 4],
    ['event types represented', "SELECT count(DISTINCT event_type) FROM audit_logs WHERE event_detail LIKE '%\"seeded\":true%'", 10],
    ['score bands in the histogram', 'SELECT count(DISTINCT floor(isolation_forest_score / 5)) FROM anomaly_scores', 4],
    ['sign-ins blocked', "SELECT count(*) FROM anomaly_scores WHERE action = 'block'", 1],
    ['step-up challenges', "SELECT count(*) FROM anomaly_scores WHERE action = 'step_up'", 1],
    ['anomalies reviewed', 'SELECT count(*) FROM anomaly_scores WHERE review_status IS NOT NULL', 1],
    ['anomalies left unreviewed', "SELECT count(*) FROM anomaly_scores WHERE review_status IS NULL AND action <> 'allow'", 1],
    ['impossible-travel legs with coordinates', "SELECT count(*) FROM audit_logs WHERE event_type = 'impossible_travel' AND event_detail LIKE '%fromPoint%'", 1],
    ['locatable sign-ins for the map', 'SELECT count(*) FROM login_events WHERE latitude IS NOT NULL', 20],
    ['countries on the map', 'SELECT count(DISTINCT country) FROM login_events WHERE country IS NOT NULL', 3],
    ['access refusals', "SELECT count(*) FROM audit_logs WHERE decision = 'deny'", 1],
    ['sessions live now', "SELECT count(*) FROM sessions WHERE session_status = 'active' AND expires_at > NOW()", 1],
    ['sessions ended by a detector', "SELECT count(*) FROM sessions WHERE flagged_reason IS NOT NULL", 1],
    ['administrator actions', "SELECT count(*) FROM audit_logs WHERE actor_type = 'administrator'", 5],
    ['accounts, every standing', 'SELECT count(DISTINCT account_status) FROM users', 4],
    ['accounts that never signed in', 'SELECT count(*) FROM users u WHERE NOT EXISTS (SELECT 1 FROM login_events e WHERE e.user_id = u.id)', 1],
  ];

  console.log('\nCoverage — every view has data to show:');
  const results = [];
  let short = 0;
  for (const [label, sql, atLeast] of checks) {
    const n = Number((await client.query(sql)).rows[0].count);
    const ok = n >= atLeast;
    if (!ok) short += 1;
    results.push({ check: label, found: n, 'at least': atLeast, ok: ok ? 'yes' : 'NO' });
  }
  console.table(results);
  if (short) {
    console.log(`\n${short} check(s) short. Re-run with a longer --days, or --reset first.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
