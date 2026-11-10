const sessionStore = require('./sessionStore');
const notifier = require('./notifier');
const accountActions = require('./accountActions');
const { logEvent } = require('../utils/audit');

/*
 * Mid-session anomaly response, shared by every detector.
 *
 * The session is ended (flagged, not merely logged out) rather than challenged:
 * a stolen token has no step-up flow attached, and the next sign-in goes through
 * the full OTP + risk-scoring path anyway. The owner is told by SMS so a hijack
 * is not silent.
 */
const NOTIFICATION_FOR = {
  impossible_travel: 'session_flagged_geo',
  high_api_velocity: 'session_flagged_api_velocity',
};

async function flagSession({ userId, sessionId, reason, detail = {}, explanation, notifyVars = {} }) {
  const flipped = await sessionStore.flag(sessionId, reason);
  // Concurrent detections on the same session: only the one that ended it reports
  if (!flipped) return false;

  // Whether a flagged session also costs the account is configuration. By
  // default it does not: ending the session is the proportionate response, and
  // the next sign-in goes through the full OTP and risk-scoring path anyway.
  const response = await accountActions.respondToAnomaly({
    user: { id: userId }, severity: 'critical', explanation, sessionId,
    notification: { template: 'account_frozen', vars: {} },
  });

  await logEvent({
    userId, sessionId, eventType: 'session_flagged', severity: 'critical',
    actorType: 'automated',
    detail: { reason, accountFrozen: response.frozen, policyRules: response.rules, ...detail },
    explanation,
  });
  if (NOTIFICATION_FOR[reason]) notifier.notify(userId, NOTIFICATION_FOR[reason], notifyVars);
  return true;
}

const flaggedResponse = (res) => res.status(401).json({
  error: 'This session was ended because of unusual activity. Please sign in again.',
  code: 'SESSION_FLAGGED',
});

module.exports = { flagSession, flaggedResponse };
