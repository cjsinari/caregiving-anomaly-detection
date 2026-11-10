/*
 * Security response policy: what the service does when an anomaly is detected.
 *
 * Detection and response are separated on purpose. The detectors decide how
 * unusual something is; this decides what that costs the account, and it is
 * configuration rather than code because the right answer differs by deployment.
 * A pilot with 50 families can afford to freeze on a single critical anomaly and
 * have someone phone the user back; at national scale the same rule locks out
 * hundreds of people every time a mobile carrier re-assigns an IP range.
 *
 * The defaults reproduce the behaviour the service had before this was
 * configurable: a risk-engine block freezes the account, and a flagged session
 * (impossible travel, API velocity) ends the session without touching the
 * account. Nothing here changes unless it is set.
 *
 *   SECURITY_FREEZE_ON_BLOCK           freeze when the risk engine blocks a
 *                                      sign-in (default true)
 *   SECURITY_FREEZE_RISK_THRESHOLD     freeze at or above this risk score,
 *                                      whatever the action was (default 0 = off)
 *   SECURITY_FREEZE_ON_SEVERITIES      severities of mid-session anomaly that
 *                                      freeze the account, comma-separated
 *                                      (default empty = none)
 *   SECURITY_END_SESSIONS_ON_FREEZE    revoke the account's sessions when it is
 *                                      frozen (default true)
 *   SECURITY_ADMINS_CAN_FREEZE_ADMINS  allow administrators to freeze other
 *                                      administrator accounts (default false)
 */

const bool = (name, fallback) =>
  (process.env[name] === undefined ? fallback : process.env[name] === 'true');

const num = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const list = (name) => (process.env[name] || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const POLICY = {
  freezeOnBlock: bool('SECURITY_FREEZE_ON_BLOCK', true),
  freezeRiskThreshold: num('SECURITY_FREEZE_RISK_THRESHOLD', 0),
  freezeOnSeverities: list('SECURITY_FREEZE_ON_SEVERITIES'),
  endSessionsOnFreeze: bool('SECURITY_END_SESSIONS_ON_FREEZE', true),
  adminsCanFreezeAdmins: bool('SECURITY_ADMINS_CAN_FREEZE_ADMINS', false),
};

/**
 * What should happen to an account given what was just detected?
 *
 * Returns { freezeAccount, endSessions, rules } where `rules` names the rules
 * that fired, so the audit trail records why the response was what it was and
 * not merely that it happened.
 */
function responseFor({ action = null, severity = null, riskScore = null } = {}) {
  const rules = [];

  if (action === 'block' && POLICY.freezeOnBlock) {
    rules.push('freeze_on_block');
  }
  if (POLICY.freezeRiskThreshold > 0 && Number(riskScore) >= POLICY.freezeRiskThreshold) {
    rules.push('freeze_risk_threshold');
  }
  if (severity && POLICY.freezeOnSeverities.includes(String(severity).toLowerCase())) {
    rules.push('freeze_on_severity');
  }

  const freezeAccount = rules.length > 0;
  return {
    freezeAccount,
    endSessions: freezeAccount && POLICY.endSessionsOnFreeze,
    rules,
  };
}

/** The sentence that explains a response, for the audit trail. */
const RULE_TEXT = {
  freeze_on_block: 'the risk engine blocked the sign-in',
  freeze_risk_threshold: 'the risk score reached the configured freeze threshold',
  freeze_on_severity: 'an anomaly of a severity configured to freeze the account',
};

const describe = (rules = []) =>
  rules.map((r) => RULE_TEXT[r] || r).join(' and ') || 'no configured rule applied';

module.exports = { POLICY, responseFor, describe, RULE_TEXT };
