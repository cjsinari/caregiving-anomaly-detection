const pool = require('../config/db');
const { locate } = require('../utils/geo');
const featureExtractor = require('./featureExtractor');
const riskClient = require('./riskClient');
const deviceTrust = require('./deviceTrust');
const geoVelocity = require('./geoVelocity');

const SEVERITY = { allow: 0, step_up: 1, block: 2 };

// Impossible travel defaults to a step-up, not a block: VPNs, roaming SIMs and
// stale geoip ranges all produce it for legitimate users, and freezing the
// account would lock them out. Set GEO_IMPOSSIBLE_ACTION=block to harden.
const GEO_ACTION = process.env.GEO_IMPOSSIBLE_ACTION === 'block' ? 'block' : 'step_up';

/**
 * Combine the deterministic rules with the model's verdict.
 *
 * The rules are the floor and the model can only raise the response, never lower
 * it. Three rules currently apply:
 *
 *  - An untrusted device forces a step-up. The model cannot help here: device-only
 *    anomalies are indistinguishable from a user's new phone in feature space
 *    (measured at 3-9% detection across every configuration), which is why
 *    is_known_device was dropped as a model feature.
 *  - Impossible travel since the last session forces at least GEO_ACTION. This
 *    rule needs one prior location, not a baseline, so it applies during cold
 *    start too.
 *  - During cold start the model's score is recorded but does not govern, because
 *    time_deviation and the location flags have no history to compare against.
 */
function decide({ coldStart, isTrustedDevice, modelAction, geo = null }) {
  const deviceAction = isTrustedDevice ? 'allow' : 'step_up';
  const geoGoverns = Boolean(geo?.impossible) && SEVERITY[GEO_ACTION] > SEVERITY[deviceAction];
  const ruleAction = geoGoverns ? GEO_ACTION : deviceAction;
  const geoReason = geoGoverns ? geo.explanation : null;

  if (coldStart) {
    return {
      action: ruleAction,
      governedBy: geoGoverns ? 'rules_geo' : 'rules_cold_start',
      reason: geoReason || (isTrustedDevice
        ? 'No behavioural baseline yet; device is trusted.'
        : 'No behavioural baseline yet; device not recognised.'),
    };
  }

  const rulesWon = SEVERITY[ruleAction] > SEVERITY[modelAction];
  return {
    action: rulesWon ? ruleAction : modelAction,
    governedBy: rulesWon ? (geoGoverns ? 'rules_geo' : 'rules') : 'model',
    reason: rulesWon ? geoReason : null,
  };
}

/** Score a login attempt and decide what the service should do about it. */
async function evaluate(userId, { ip, deviceFingerprint }) {
  const { features, context } = await featureExtractor.build(userId, { ip, deviceFingerprint });
  const [isTrustedDevice, geo] = await Promise.all([
    deviceTrust.isTrusted(userId, deviceFingerprint),
    geoVelocity.checkLogin(userId, context.location),
  ]);
  const model = await riskClient.score(features, { isKnownDevice: isTrustedDevice });
  const decision = decide({
    coldStart: context.coldStart,
    isTrustedDevice,
    modelAction: model.action,
    geo,
  });

  return { features, context, model, decision, isTrustedDevice, geo };
}

/**
 * Persist the login event and its score. Never throws: a logging failure must not
 * break the login it describes
 */
async function record({ userId, features, context, model, decision, isTrustedDevice, wasSuccessful }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO login_events
         (user_id, ip_address, device_fingerprint, country, city, latitude, longitude,
          login_velocity, was_successful)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [userId, context.ip ? String(context.ip).slice(0, 45) : null, context.deviceFingerprint,
       context.country, context.city, context.location?.lat ?? null, context.location?.lon ?? null,
       features.login_velocity, wasSuccessful]
    );
    const loginEventId = rows[0].id;

    await pool.query(
      `INSERT INTO anomaly_scores
         (login_event_id, isolation_forest_score, known_device, velocity_count,
          risk_level, explanation, action, governed_by, cold_start, model_available, features)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [loginEventId, model.riskScore, isTrustedDevice, features.login_velocity,
       model.riskLevel, model.explanation, decision.action, decision.governedBy,
       context.coldStart, model.modelAvailable, JSON.stringify(features)]
    );
    return loginEventId;
  } catch (err) {
    console.error('Failed to record login event / anomaly score:', err.message);
    return null;
  }
}

/**
 * Record a login attempt that was never scored: a failed OTP, or registration.
 *
 * These paths must NOT write to anomaly_scores. Inserting a fabricated score
 * there would put rows with risk 0 and action 'block' alongside real model
 * verdicts, so a dashboard counting blocks would count mistyped codes and the
 * averages would be skewed.
 */
async function recordAttempt({ userId, ip, deviceFingerprint, wasSuccessful }) {
  try {
    const { country, city, lat, lon } = locate(ip);
    await pool.query(
      `INSERT INTO login_events
         (user_id, ip_address, device_fingerprint, country, city, latitude, longitude, was_successful)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, ip ? String(ip).slice(0, 45) : null, deviceFingerprint, country, city, lat, lon, wasSuccessful]
    );
  } catch (err) {
    console.error('login_events write failed:', err.message);
  }
}

module.exports = { evaluate, record, recordAttempt, decide };
