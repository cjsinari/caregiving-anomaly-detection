const pool = require('../config/db');
const explanation = require('../services/explanation');

/*
 * The audit trail.
 *
 * Writes never throw and never block the caller's success path: an audit failure
 * must not turn a working request into an error (NFR10). The table is append-only
 * at the database level (sql/resource_authz.sql), so what is written here cannot
 * later be edited by the service — including by the account the row is about.
 */

const MAX_LIMIT = 200;

/**
 * Append a security event to the audit trail.
 *
 * resourceType/resourceId/action/decision are set by authorization events and
 * actorType by security actions; the older auth events pass none of them and are
 * unaffected. userId is the account that ACTED, which for an administrator
 * action is not the account acted on — that one is resourceId. Never throws: a
 * failed audit write must not break the request that triggered it.
 */
async function logEvent({
  userId = null,
  sessionId = null,
  eventType,
  detail = null,
  explanation: why = null,
  severity = 'info',
  resourceType = null,
  resourceId = null,
  action = null,
  decision = null,
  actorType = null,
  ip = null,
}) {
  try {
    const detailText = detail && typeof detail === 'object' ? JSON.stringify(detail) : detail;
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, session_id, event_type, event_detail, explanation, severity,
          resource_type, resource_id, action, decision, actor_type, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [userId, sessionId, eventType, detailText, why, severity,
       resourceType, resourceId, action, decision, actorType,
       ip ? String(ip).slice(0, 45) : null]
    );
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

/**
 * Record an authorization decision, with its explanation generated from the
 * reason code. Both outcomes are recorded: a trail that only kept refusals could
 * not answer "who read this record?", which is the question health data actually
 * raises.
 */
function logAccess({ userId, sessionId, resourceType, resourceId, action, verdict, ip,
                     actorType = 'user', detail = {} }) {
  const decision = verdict.allowed ? 'allow' : 'deny';
  return logEvent({
    userId,
    sessionId,
    eventType: 'resource_access',
    severity: verdict.allowed ? 'info' : 'medium',
    resourceType,
    resourceId,
    action,
    decision,
    actorType,
    ip,
    detail: { decision, reason: verdict.code, ...verdict.context, ...detail },
    explanation: explanation.forAccess({
      decision, code: verdict.code, action, resourceType, context: verdict.context,
    }),
  });
}

/*
 * Reading the trail.
 *
 * Filters are composed rather than interpolated; every value reaches PostgreSQL
 * as a parameter. `total` is returned alongside the page so the dashboard can
 * page without a second request.
 */
function buildFilters({ userId, sessionId, eventType, severity, decision, actorType,
                        resourceType, resourceId, from, to }) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('$?', `$${params.length}`)); };

  if (userId) add('a.user_id = $?::uuid', userId);
  if (sessionId) add('a.session_id = $?::uuid', sessionId);
  if (eventType) add('a.event_type = $?', eventType);
  if (severity) add('a.severity = $?', severity);
  if (decision) add('a.decision = $?', decision);
  if (actorType) add('a.actor_type = $?', actorType);
  if (resourceType) add('a.resource_type = $?', resourceType);
  if (resourceId) add('a.resource_id = $?::uuid', resourceId);
  if (from) add('a.logged_at >= $?::timestamp', from);
  if (to) add('a.logged_at <= $?::timestamp', to);

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * A page of the audit trail, newest first, each row carrying a readable
 * explanation (generated when the writer recorded none).
 */
async function query(filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), MAX_LIMIT);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const { clause, params } = buildFilters(filters);

  const { rows } = await pool.query(
    `SELECT a.id, a.user_id, a.session_id, a.event_type, a.event_detail, a.explanation,
            a.severity, a.logged_at, a.resource_type, a.resource_id, a.action,
            a.decision, a.actor_type, a.ip_address,
            u.full_name AS actor_name, u.role AS actor_role,
            t.full_name AS target_name, t.role AS target_role, t.account_status AS target_status,
            count(*) OVER () AS total
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     -- A security action names the account it was applied to in resource_id;
     -- resolving it here is what lets one row show both sides of the action.
     LEFT JOIN users t ON a.resource_type = 'account' AND t.id = a.resource_id
     ${clause}
     ORDER BY a.logged_at DESC, a.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    total: rows.length ? Number(rows[0].total) : 0,
    limit,
    offset,
    rows: rows.map((r) => ({ ...r, explanation: explanation.forEvent(r) })),
  };
}

module.exports = { logEvent, logAccess, query, MAX_LIMIT };
