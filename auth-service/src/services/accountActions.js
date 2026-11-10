const pool = require('../config/db');
const sessionStore = require('./sessionStore');
const notifier = require('./notifier');
const policy = require('../config/securityPolicy');
const { logEvent } = require('../utils/audit');

/*
 * Account security actions: freezing an account, restoring it, blocking a
 * session.
 *
 * One service for both callers. The risk engine freezes an account on its own
 * when a sign-in is blocked, and an administrator freezes one by hand after
 * reviewing an incident; routing both through here is what makes the audit
 * trail comparable, because every action is written with the same shape and with
 * actor_type saying which of the two it was. An incident review that cannot tell
 * an automated response from a human decision cannot assess either.
 *
 * Every function is idempotent and reports whether it actually changed anything:
 * freezing an already-frozen account is not an error, but it must not produce a
 * second "account frozen" entry or a second SMS, or the trail stops being a
 * record of what changed.
 *
 * Nothing here throws for the caller's benefit — a failed notification or audit
 * write must not undo a freeze that has already taken effect (NFR10).
 */

const ACTOR = { AUTOMATED: 'automated', ADMINISTRATOR: 'administrator' };

const RESTORABLE = ['frozen', 'suspended'];

/**
 * Freeze an account.
 *
 * `actorType` is required, and `actorId` is the administrator who decided when
 * actorType is 'administrator' (null for the automated path, where the decider
 * is the risk engine and the rules that fired are recorded instead).
 */
async function freeze({
  targetUserId, reason, severity = 'critical', actorType, actorId = null,
  sessionId = null, ip = null, rules = [], notification = null, detail = {},
}) {
  const { rows } = await pool.query(
    `UPDATE users SET account_status = 'frozen', updated_at = NOW()
     WHERE id = $1::uuid AND account_status <> 'frozen'
     RETURNING id, role, account_status`,
    [targetUserId]
  );
  if (!rows.length) return { ok: false, code: 'not_frozen', changed: false };

  // Freezing an account that still has live sessions would leave the holder of a
  // stolen access token working until it expired.
  const endedSessions = policy.POLICY.endSessionsOnFreeze
    ? await sessionStore.revokeAllForUser(targetUserId)
    : 0;

  await logEvent({
    userId: actorId, sessionId, eventType: 'account_frozen', severity: 'critical',
    resourceType: 'account', resourceId: targetUserId, action: 'freeze',
    decision: 'allow', actorType, ip,
    detail: { reason, severity, rules, endedSessions, initiatedBy: actorType, ...detail },
    explanation: actorType === ACTOR.ADMINISTRATOR
      ? `Account frozen by an administrator: ${reason}`
      : `Account frozen automatically because ${policy.describe(rules)}. ${reason}`.trim(),
  });

  if (notification) notifier.notify(targetUserId, notification.template, notification.vars || {});
  return { ok: true, changed: true, endedSessions };
}

/**
 * Restore access to an account: lift a freeze or suspension and clear any
 * temporary lock left by failed verification codes.
 *
 * Deliberately not a way to activate a pending caregiver. That account is
 * waiting on identity verification, which is a different decision with a
 * different record; silently flipping it to active here would let an
 * administrator skip it without that showing up as a verification.
 */
async function restore({ targetUserId, reason, actorType = ACTOR.ADMINISTRATOR,
                         actorId = null, sessionId = null, ip = null }) {
  const { rows: before } = await pool.query(
    'SELECT account_status, locked_until FROM users WHERE id = $1::uuid', [targetUserId]);
  if (!before.length) return { ok: false, code: 'not_found' };

  const status = before[0].account_status;
  const wasLocked = before[0].locked_until && new Date(before[0].locked_until) > new Date();
  if (!RESTORABLE.includes(status) && !wasLocked) {
    return { ok: false, code: status === 'pending' ? 'pending_verification' : 'not_restricted', status };
  }

  const { rows } = await pool.query(
    `UPDATE users
     SET account_status = CASE WHEN account_status = ANY($2::varchar[]) THEN 'active' ELSE account_status END,
         locked_until = NULL, updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING account_status`,
    [targetUserId, RESTORABLE]
  );

  await logEvent({
    userId: actorId, sessionId, eventType: 'account_restored', severity: 'medium',
    resourceType: 'account', resourceId: targetUserId, action: 'restore',
    decision: 'allow', actorType, ip,
    detail: { reason, previousStatus: status, lockCleared: Boolean(wasLocked),
              newStatus: rows[0].account_status, initiatedBy: actorType },
    explanation: `Account access restored by an administrator (was ${status}` +
      `${wasLocked ? ', with a temporary lock cleared' : ''}): ${reason}`,
  });

  notifier.notify(targetUserId, 'account_restored', {});
  return { ok: true, changed: true, status: rows[0].account_status, previousStatus: status };
}

/**
 * Block one session without touching the account. The lighter response for a
 * session that looks stolen while the account itself is not in doubt: the owner
 * signs in again and goes through the full OTP and risk-scoring path.
 */
// targetSessionId is the session being ended; sessionId is the administrator's
// own session, recorded as the context the action was taken from. Two different
// session ids in one call, so they are named differently on purpose.
async function blockSession({ targetSessionId, reason, actorType = ACTOR.ADMINISTRATOR,
                              actorId = null, sessionId = null, ip = null }) {
  const { rows } = await pool.query(
    'SELECT user_id, session_status FROM sessions WHERE id = $1::uuid', [targetSessionId]);
  if (!rows.length) return { ok: false, code: 'not_found' };
  if (rows[0].session_status !== 'active') return { ok: false, code: 'not_active' };

  const flipped = await sessionStore.flag(targetSessionId, 'administrator_block');
  if (!flipped) return { ok: false, code: 'not_active' };

  await logEvent({
    userId: actorId, sessionId, eventType: 'session_blocked', severity: 'high',
    resourceType: 'session', resourceId: targetSessionId, action: 'block_session',
    decision: 'allow', actorType, ip,
    detail: { reason, targetUserId: rows[0].user_id, initiatedBy: actorType },
    explanation: `Session ended by an administrator: ${reason}`,
  });
  return { ok: true, changed: true, userId: rows[0].user_id };
}

/**
 * The automated path: apply the configured response to something a detector just
 * found. Returns what was done, so the caller can record it alongside its own
 * audit entry for the detection itself.
 */
async function respondToAnomaly({ user, action = null, severity = null, riskScore = null,
                                  explanation = null, sessionId = null, ip = null,
                                  notification = null }) {
  const response = policy.responseFor({ action, severity, riskScore });
  if (!response.freezeAccount) return { ...response, frozen: false };

  const result = await freeze({
    targetUserId: user.id,
    reason: explanation || 'Automated response to a detected anomaly.',
    severity: severity || 'critical',
    actorType: ACTOR.AUTOMATED,
    sessionId, ip, rules: response.rules,
    notification,
    detail: { riskScore, action },
  });
  return { ...response, frozen: result.changed };
}

module.exports = { freeze, restore, blockSession, respondToAnomaly, ACTOR, RESTORABLE };
