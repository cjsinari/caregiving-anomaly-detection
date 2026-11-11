const pool = require('../config/db');
const explanation = require('../services/explanation');
const securityStream = require('../services/securityStream');
const securityLayers = require('../services/securityLayers');

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
    // Nothing is announced that was not recorded. A dashboard notification for
    // an event with no row behind it would send an administrator looking
    // through the trail for something that is not in it.
    return;
  }

  /*
   * Announce it to any connected dashboard.
   *
   * After the write, and outside its try: a live notification is strictly less
   * important than the record, and this must not be able to make a successful
   * audit write look like a failed one. The payload is what a notification
   * needs — severity, type, a sentence — and not the whole row; the dashboard
   * re-reads the feed for detail when the administrator looks at it.
   */
  securityStream.publish({
    eventType,
    severity,
    layer: securityLayers.forEvent(eventType),
    userId,
    sessionId,
    actorType,
    resourceType,
    resourceId,
    action,
    decision,
    explanation: why || explanation.forEvent({ event_type: eventType, event_detail: detail }),
  });
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
                        resourceType, resourceId, role, search, from, to }) {
  const where = [];
  const params = [];
  // Each '$?' in the fragment consumes one value, in order, so a filter that
  // matches on two columns passes the same value twice rather than building its
  // own placeholder numbers.
  const add = (sql, ...values) => {
    let i = 0;
    where.push(sql.replace(/\$\?/g, () => { params.push(values[i]); i += 1; return `$${params.length}`; }));
  };

  if (userId) add('a.user_id = $?::uuid', userId);
  if (sessionId) add('a.session_id = $?::uuid', sessionId);
  if (eventType) add('a.event_type = $?', eventType);
  if (severity) add('a.severity = $?', severity);
  if (decision) add('a.decision = $?', decision);
  if (actorType) add('a.actor_type = $?', actorType);
  if (resourceType) add('a.resource_type = $?', resourceType);
  if (resourceId) add('a.resource_id = $?::uuid', resourceId);
  // The role of the account that acted, read from users rather than from the
  // event: audit_logs has no role column, and copying one onto every row would
  // record the role at write time and then disagree with the account later.
  if (role) add('u.role = $?', role);
  // Free text over the two identifiers an administrator actually has to hand
  // when something is reported: a person's name, or an address from a log.
  if (search) {
    const pattern = `%${String(search).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    add('(u.full_name ILIKE $? OR a.ip_address ILIKE $?)', pattern, pattern);
  }
  // timestamptz, not timestamp: logged_at is naive (NOW() writes the database's
  // local time), but the bound arrives from a client as an instant — an ISO
  // string ending in Z, or a Date the driver serialises with its offset. Casting
  // to plain timestamp discards that offset and silently shifts every range
  // query by the server's UTC offset, which in Nairobi is three hours of events.
  if (from) add('a.logged_at >= $?::timestamptz', from);
  if (to) add('a.logged_at <= $?::timestamptz', to);

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/*
 * Sortable columns, as a whitelist of SQL fragments.
 *
 * The key is what the client may ask for and the value is what reaches the
 * query; an unrecognised key falls back to time rather than being interpolated.
 * Severity sorts by rank and not alphabetically, because alphabetically puts
 * 'critical' next to nothing and 'info' above 'high'.
 */
const SORTS = {
  time: 'a.logged_at',
  severity: "CASE a.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
  eventType: 'a.event_type',
  actor: 'u.full_name',
};

function orderBy(sort, order) {
  const column = SORTS[sort] || SORTS.time;
  const direction = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // a.id breaks ties so that paging over equal values cannot repeat or skip a row
  return `ORDER BY ${column} ${direction}, a.id DESC`;
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
     ${orderBy(filters.sort, filters.order)}
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

/*
 * Presenting a row.
 *
 * One definition, used by both the audit trail endpoint and the dashboard's
 * event feed. They read the same table through the same query builder, so two
 * copies of this mapping would be two response shapes that drift apart, and the
 * drift would show up as a column that is populated on one screen and blank on
 * the other.
 */
const parseDetail = (value) => {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return { text: value }; }
};

function presentEvent(r) {
  return {
    id: r.id,
    time: r.logged_at,
    eventType: r.event_type,
    severity: r.severity,
    explanation: r.explanation,
    // Who acted, and by what authority. actorType is what separates a freeze
    // the risk engine applied from one an administrator decided on.
    actorType: r.actor_type,
    actor: r.user_id ? { id: r.user_id, fullName: r.actor_name, role: r.actor_role } : null,
    sessionId: r.session_id,
    ...(r.action && { action: r.action }),
    ...(r.decision && { decision: r.decision }),
    ...(r.resource_type && {
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      // For a security action, the account it was applied to
      ...(r.resource_type === 'account' && r.target_name && {
        target: { id: r.resource_id, fullName: r.target_name, role: r.target_role,
                  accountStatus: r.target_status },
      }),
    }),
    ip: r.ip_address,
    detail: parseDetail(r.event_detail),
  };
}

module.exports = { logEvent, logAccess, query, presentEvent, parseDetail, SORTS, MAX_LIMIT };
