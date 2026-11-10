const pool = require('../config/db');
const resourceAccess = require('../services/resourceAccess');
const { logAccess } = require('../utils/audit');

/*
 * Ownership enforcement for resource routes. Runs after verifyToken.
 *
 * Authorization is a middleware rather than a check inside each handler so that
 * a new route cannot be added without one: a handler that is reached has already
 * been authorized, and it works from req.resource (loaded by the same query that
 * made the decision) instead of re-fetching the record and risking a second,
 * unchecked read path.
 *
 * Both outcomes are audited here, which is the other reason this is one place:
 * every allowed read of a care record and every refusal is written to the trail
 * with the reason it was decided that way, without each handler remembering to.
 *
 * Failure is closed. verifyToken fails open on a Redis outage by design (velocity
 * is secondary), but an ownership check that cannot reach PostgreSQL has no
 * fallback that is safe — allowing the request would hand out health data on the
 * strength of a database error — so it answers 503 and the client retries.
 */

const DENIAL_MESSAGE = {
  // The resource is hidden, so the message must not differ by reason
  not_found: 'Care profile not found.',
  not_owner: 'Care profile not found.',
  no_assignment: 'Care profile not found.',
  assignment_ended: 'Care profile not found.',
  assignment_inactive: 'Care profile not found.',
  assignment_not_started: 'Care profile not found.',

  // Visible to the caller: say what the limit is, so it can be acted on
  caregiver_read_only: 'Caregivers have read-only access to the profiles they are assigned to.',
  administrator_no_clinical_access:
    'Administrator accounts do not have access to care records.',
  account_not_active: 'This account cannot access care records yet.',
  unknown_actor: 'This account is no longer available.',
  role_not_permitted: 'Your account type cannot perform this action.',
};

const DENIAL_CODE = {
  caregiver_read_only: 'READ_ONLY_ACCESS',
  administrator_no_clinical_access: 'NO_CLINICAL_ACCESS',
  account_not_active: 'ACCOUNT_NOT_ACTIVE',
  unknown_actor: 'ACCOUNT_UNAVAILABLE',
  role_not_permitted: 'ROLE_NOT_PERMITTED',
};

/**
 * Require an active account, optionally in one of `roles`, for a route that has
 * no resource of its own yet (creating a profile, listing profiles, reading the
 * audit trail).
 *
 * The role comes from the database, not from the access token. requireRole() in
 * middleware/auth.js reads the token's claim, which is right for the auth routes
 * — they are about the session — but a token issued before an account was
 * suspended, or before a caregiver was verified, must not still open care
 * records. Attaches req.actor.
 */
function requireActiveRole({ roles = [], action = 'read', resourceType = 'elderly_profile' } = {}) {
  return async function enforce(req, res, next) {
    const { id: userId, sessionId } = req.user;

    let actor;
    try {
      const { rows } = await pool.query(
        'SELECT role, account_status FROM users WHERE id = $1::uuid', [userId]);
      actor = rows[0];
    } catch (err) {
      console.error('Account status check failed:', err.message);
      return res.status(503).json({
        error: 'Unable to verify your access. Please try again.',
        code: 'AUTHORIZATION_UNAVAILABLE',
      });
    }

    let code = null;
    if (!actor) code = 'unknown_actor';
    else if (actor.account_status !== 'active') code = 'account_not_active';
    else if (roles.length && !roles.includes(actor.role)) {
      code = actor.role === 'administrator' && resourceType === 'elderly_profile'
        ? 'administrator_no_clinical_access'
        : 'role_not_permitted';
    }

    if (code) {
      const verdict = {
        allowed: false, code,
        context: { role: actor?.role, accountStatus: actor?.account_status },
      };
      logAccess({ userId, sessionId, resourceType, resourceId: null, action, verdict, ip: req.ip,
        detail: { path: req.originalUrl.slice(0, 100), method: req.method } });
      return res.status(403).json({
        error: DENIAL_MESSAGE[code] || 'You do not have permission to perform this action.',
        ...(DENIAL_CODE[code] && { code: DENIAL_CODE[code] }),
      });
    }

    req.actor = { id: userId, role: actor.role, accountStatus: actor.account_status };
    return next();
  };
}

/**
 * Require `action` access to the care profile named by req.params[param].
 * On success, attaches req.resource (the profile) and req.access (the verdict).
 */
function requireProfileAccess(action, param = 'id') {
  return async function enforce(req, res, next) {
    const resourceId = req.params[param];
    const { id: userId, sessionId } = req.user;

    let verdict;
    try {
      verdict = await resourceAccess.authorizeProfile({ actorId: userId, resourceId, action });
    } catch (err) {
      console.error('Ownership check failed:', err.message);
      return res.status(503).json({
        error: 'Unable to verify your access to this record. Please try again.',
        code: 'AUTHORIZATION_UNAVAILABLE',
      });
    }

    logAccess({
      userId, sessionId, resourceType: 'elderly_profile',
      // A probe for a non-existent (or malformed) id still gets a trail entry; the
      // id column stays null because there is no resource to point at.
      resourceId: verdict.code === 'not_found' ? null : resourceId,
      action, verdict, ip: req.ip,
      detail: { path: req.originalUrl.slice(0, 100), method: req.method, requestedId: resourceId },
    });

    if (!verdict.allowed) {
      return res.status(verdict.status).json({
        error: DENIAL_MESSAGE[verdict.code] || 'You do not have permission to perform this action.',
        ...(DENIAL_CODE[verdict.code] && { code: DENIAL_CODE[verdict.code] }),
      });
    }

    req.resource = verdict.resource;
    req.access = { via: verdict.code, context: verdict.context };
    return next();
  };
}

module.exports = { requireProfileAccess, requireActiveRole, DENIAL_MESSAGE };
