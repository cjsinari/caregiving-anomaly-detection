const { z } = require('zod');
const pool = require('../config/db');
const { parse } = require('../utils/validate');
const { logAccess } = require('../utils/audit');
const { maskPhone } = require('../services/notifier');
const accountActions = require('../services/accountActions');
const policy = require('../config/securityPolicy');
const { UUID_RE } = require('../services/resourceAccess');

/*
 * Administrator-initiated security actions.
 *
 * These are the manual counterpart to the automated responses: an administrator
 * reviews an incident in the audit trail and freezes an account, ends a session,
 * or restores access. They go through the same service as the automated path, so
 * the trail records them the same way with actor_type telling them apart.
 *
 * A reason is required on every action and is stored with it. An administrator
 * action with no stated reason is unreviewable, and these are the actions most
 * likely to be questioned afterwards — by the user who was locked out, or by
 * whoever is checking that the people with the power to lock accounts are using
 * it properly.
 */

const actionSchema = z.object({
  reason: z.string().trim().min(5).max(255),
}).strict();

const uuidParam = (value) => UUID_RE.test(String(value || ''));

/** Record a refused administrator action: the attempt is as interesting as the act. */
function denyAction(req, res, { action, resourceType, resourceId, code, status, message, errorCode }) {
  logAccess({
    userId: req.user.id, sessionId: req.user.sessionId,
    resourceType, resourceId, action,
    verdict: { allowed: false, code, context: { role: req.actor.role } },
    actorType: 'administrator', ip: req.ip,
    detail: { path: req.originalUrl.slice(0, 100), method: req.method },
  });
  return res.status(status).json({ error: message, ...(errorCode && { code: errorCode }) });
}

/** POST /admin/accounts/:id/freeze */
async function freezeAccount(req, res) {
  const data = parse(actionSchema, req.body, res);
  if (!data) return;
  const targetId = req.params.id;
  if (!uuidParam(targetId)) return res.status(404).json({ error: 'Account not found.' });

  try {
    const { rows } = await pool.query(
      'SELECT id, role, account_status, phone_number FROM users WHERE id = $1::uuid', [targetId]);
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'Account not found.' });

    // An administrator who can freeze their own account can lock themselves out
    // of the tools used to undo it.
    if (target.id === req.user.id) {
      return denyAction(req, res, {
        action: 'freeze', resourceType: 'account', resourceId: targetId, code: 'cannot_act_on_self',
        status: 400, message: 'You cannot freeze your own account.', errorCode: 'CANNOT_ACT_ON_SELF',
      });
    }
    // Administrators freezing each other is how a compromised administrator
    // account disables oversight. Off by default, policy-controlled.
    if (target.role === 'administrator' && !policy.POLICY.adminsCanFreezeAdmins) {
      return denyAction(req, res, {
        action: 'freeze', resourceType: 'account', resourceId: targetId,
        code: 'administrator_target_protected', status: 403,
        message: 'Administrator accounts cannot be frozen through this endpoint.',
        errorCode: 'TARGET_PROTECTED',
      });
    }

    const result = await accountActions.freeze({
      targetUserId: targetId, reason: data.reason, severity: 'critical',
      actorType: accountActions.ACTOR.ADMINISTRATOR, actorId: req.user.id,
      sessionId: req.user.sessionId, ip: req.ip,
      notification: { template: 'account_frozen', vars: {} },
    });
    if (!result.changed) {
      return res.status(409).json({ error: 'That account is already frozen.', code: 'ALREADY_FROZEN' });
    }

    return res.status(200).json({
      message: 'Account frozen.',
      account: { id: targetId, accountStatus: 'frozen', phoneNumber: maskPhone(target.phone_number) },
      sessionsEnded: result.endedSessions,
    });
  } catch (err) {
    console.error('freezeAccount error:', err);
    return res.status(500).json({ error: 'Could not freeze the account. Please try again.' });
  }
}

/** POST /admin/accounts/:id/restore */
async function restoreAccount(req, res) {
  const data = parse(actionSchema, req.body, res);
  if (!data) return;
  const targetId = req.params.id;
  if (!uuidParam(targetId)) return res.status(404).json({ error: 'Account not found.' });

  try {
    const result = await accountActions.restore({
      targetUserId: targetId, reason: data.reason,
      actorType: accountActions.ACTOR.ADMINISTRATOR, actorId: req.user.id,
      sessionId: req.user.sessionId, ip: req.ip,
    });

    if (!result.ok) {
      if (result.code === 'not_found') return res.status(404).json({ error: 'Account not found.' });
      if (result.code === 'pending_verification') {
        return res.status(409).json({
          error: 'That account is awaiting identity verification, which is a separate decision.',
          code: 'PENDING_VERIFICATION',
        });
      }
      return res.status(409).json({
        error: 'That account is not restricted.', code: 'NOT_RESTRICTED',
      });
    }

    return res.status(200).json({
      message: 'Account access restored.',
      account: { id: targetId, accountStatus: result.status, previousStatus: result.previousStatus },
    });
  } catch (err) {
    console.error('restoreAccount error:', err);
    return res.status(500).json({ error: 'Could not restore the account. Please try again.' });
  }
}

/** POST /admin/sessions/:id/block */
async function blockSession(req, res) {
  const data = parse(actionSchema, req.body, res);
  if (!data) return;
  const targetId = req.params.id;
  if (!uuidParam(targetId)) return res.status(404).json({ error: 'Session not found.' });

  try {
    if (targetId === req.user.sessionId) {
      return denyAction(req, res, {
        action: 'block_session', resourceType: 'session', resourceId: targetId,
        code: 'cannot_act_on_self', status: 400,
        message: 'Use logout to end your own session.', errorCode: 'CANNOT_ACT_ON_SELF',
      });
    }

    const result = await accountActions.blockSession({
      targetSessionId: targetId, reason: data.reason,
      actorType: accountActions.ACTOR.ADMINISTRATOR, actorId: req.user.id,
      sessionId: req.user.sessionId, ip: req.ip,
    });
    if (!result.ok) {
      return result.code === 'not_found'
        ? res.status(404).json({ error: 'Session not found.' })
        : res.status(409).json({ error: 'That session has already ended.', code: 'SESSION_NOT_ACTIVE' });
    }
    return res.status(200).json({ message: 'Session ended.' });
  } catch (err) {
    console.error('blockSession error:', err);
    return res.status(500).json({ error: 'Could not end the session. Please try again.' });
  }
}

/**
 * GET /admin/policy — the response rules currently in force.
 *
 * Rules that are configurable per deployment are no use to the person holding
 * the pager unless they can see what this deployment is actually set to.
 */
function getPolicy(req, res) {
  return res.status(200).json({ policy: policy.POLICY });
}

module.exports = { freezeAccount, restoreAccount, blockSession, getPolicy };
