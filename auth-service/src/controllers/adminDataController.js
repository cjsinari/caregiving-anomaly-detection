const { z } = require('zod');
const pool = require('../config/db');
const redis = require('../config/redis');
const { parse } = require('../utils/validate');
const audit = require('../utils/audit');
const timeWindow = require('../utils/timeWindow');
const explanation = require('../services/explanation');
const { maskPhone } = require('../services/notifier');

/*
 * Read-only security data for the administrator dashboard.
 *
 * Separate from adminController.js, which performs actions. The split is not
 * cosmetic: everything in this file is a GET that changes nothing, and keeping
 * it apart means a route added here cannot accidentally be given the ability to
 * freeze an account, while the action endpoints stay small enough to read in one
 * sitting. Authorization is identical for both — requireActiveRole re-checks the
 * administrator role against the database on every request — because reading the
 * whole service's security history is itself a privileged act.
 *
 * Nothing here invents data. Each endpoint is a view over what the detection
 * layers already wrote: audit_logs (events), anomaly_scores joined to
 * login_events (model decisions), sessions plus the Redis cache (who is signed
 * in), and counts over the same three tables (the summary). Where a sentence is
 * needed, it comes from the explanation service, which prefers what the writer
 * recorded at the time over anything reconstructed afterwards.
 *
 * Two rules the responses follow:
 *
 *  - Phone numbers are masked, as they are on the audit routes. An administrator
 *    reviewing anomalies needs to tell accounts apart, not to hold a list of
 *    every subscriber's number.
 *  - No clinical data appears anywhere. Administrators have no access to care
 *    records (resourceAccess refuses it), so an endpoint here that resolved a
 *    profile's contents would hand over by the back door what the authorization
 *    layer refuses at the front.
 */

// ───────────────────────────── validation ─────────────────────────────

const ROLES = ['family', 'caregiver', 'administrator'];
const SEVERITIES = ['info', 'medium', 'high', 'critical'];
const ACTIONS = ['allow', 'step_up', 'block'];
const RISK_LEVELS = ['low', 'medium', 'high'];
const SESSION_STATUSES = ['active', 'expired', 'invalidated', 'flagged'];

const timestamp = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)),
  'Use an ISO date or date-time');

/** Shared by every listing: the window, free text, and the page. */
const windowFields = {
  window: z.enum(timeWindow.KEYS).optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
};

const pageFields = {
  limit: z.coerce.number().int().min(1).max(audit.MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z.enum(['asc', 'desc']).optional(),
};

const eventsSchema = z.object({
  ...windowFields,
  ...pageFields,
  userId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  eventType: z.string().max(50).optional(),
  severity: z.enum(SEVERITIES).optional(),
  decision: z.enum(['allow', 'deny']).optional(),
  actorType: z.enum(['user', 'administrator', 'automated', 'system']).optional(),
  resourceType: z.string().max(40).optional(),
  resourceId: z.string().uuid().optional(),
  role: z.enum(ROLES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(Object.keys(audit.SORTS)).optional(),
}).strict();

const anomaliesSchema = z.object({
  ...windowFields,
  ...pageFields,
  userId: z.string().uuid().optional(),
  role: z.enum(ROLES).optional(),
  action: z.enum(ACTIONS).optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  // The review queue: everything the system did not simply allow.
  flaggedOnly: z.enum(['true', 'false']).optional(),
  // 'unreviewed' is its own value rather than an absent filter: "nobody has
  // looked at this" is the queue an administrator works from, and it is not the
  // same question as "show me everything".
  reviewStatus: z.enum(['true_positive', 'false_positive', 'under_review', 'unreviewed']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['time', 'score']).optional(),
}).strict();

const summarySchema = z.object({ ...windowFields }).strict();

const sessionsSchema = z.object({
  ...pageFields,
  userId: z.string().uuid().optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum([...SESSION_STATUSES, 'all']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['lastSeen', 'started', 'risk']).optional(),
}).strict();

// ───────────────────────────── helpers ─────────────────────────────

/**
 * Compose a WHERE clause from fragments, each consuming one parameter per '$?'.
 * The same shape as the audit trail's builder, for the same reason: no value
 * reaches PostgreSQL as interpolated text, and a filter that matches on two
 * columns passes its value twice rather than counting placeholders by hand.
 */
function filterBuilder() {
  const where = [];
  const params = [];
  const add = (sql, ...values) => {
    let i = 0;
    where.push(sql.replace(/\$\?/g, () => { params.push(values[i]); i += 1; return `$${params.length}`; }));
  };
  const clause = () => (where.length ? `WHERE ${where.join(' AND ')}` : '');
  // The trailing LIMIT/OFFSET placeholders, numbered after every filter's.
  const paging = () => `LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  return { add, params, clause, paging };
}

/** Escape the wildcards in a user-supplied ILIKE term so a '%' searches for '%'. */
const likeTerm = (value) => `%${String(value).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/** A KPI card's value, the same value one window earlier, and the change between. */
const metric = (value, previous) => ({
  value: Number(value) || 0,
  previous: Number(previous) || 0,
  trend: timeWindow.trend(value, previous),
});

/** The window, as echoed back on every response so the client can label its axes. */
const describeWindow = (range) => ({
  window: range.window,
  from: range.from.toISOString(),
  to: range.to.toISOString(),
  previousFrom: range.previousFrom.toISOString(),
});

/**
 * Record that an administrator inspected one account's security history.
 *
 * Deliberately not written for every request. The dashboard refreshes these
 * endpoints on a timer, and a trail that gained a row per refresh would bury the
 * events it exists to preserve under thousands of "an administrator looked at the
 * overview". What is worth keeping is the targeted read — the moment an
 * administrator singles out one account or one session — which is the access a
 * subject of the data would want accounted for, and that is what this writes.
 */
function auditTargetedRead(req, { view, filters }) {
  const target = filters.userId || filters.sessionId;
  if (!target) return;
  audit.logEvent({
    userId: req.user.id,
    sessionId: req.user.sessionId,
    eventType: 'admin_data_viewed',
    severity: 'medium',
    resourceType: filters.userId ? 'account' : 'session',
    resourceId: target,
    action: 'read',
    decision: 'allow',
    actorType: 'administrator',
    ip: req.ip,
    detail: { view, filters },
  });
}

// ───────────────────────────── GET /admin/events ─────────────────────────────

/**
 * The security event feed: audit_logs, filtered and paginated.
 *
 * Reads through the same query builder as GET /audit and presents rows with the
 * same function, so the dashboard's feed and the audit trail viewer cannot
 * disagree about what an event is. What this adds is the dashboard's own
 * filters — a named time window, the acting account's role, free text over name
 * and address, and a sort — none of which the audit endpoint had.
 */
async function listEvents(req, res) {
  const data = parse(eventsSchema, req.query, res);
  if (!data) return;

  const range = timeWindow.resolve(data);
  try {
    const page = await audit.query({ ...data, from: range.from, to: range.to });
    auditTargetedRead(req, { view: 'events', filters: data });

    return res.status(200).json({
      ...describeWindow(range),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      events: page.rows.map(audit.presentEvent),
    });
  } catch (err) {
    console.error('listEvents error:', err);
    return res.status(500).json({ error: 'Could not load security events.' });
  }
}

// ──────────────────────────── GET /admin/anomalies ────────────────────────────

const ANOMALY_SORTS = {
  time: 's.created_at',
  score: 's.isolation_forest_score',
};

/**
 * What the model said, and what the service did about it.
 *
 * One row per scored sign-in attempt: the score, the decision it drove, the
 * features it was computed from, and the engine's own explanation. The feature
 * set is returned both raw (what was sent to the model) and broken out per
 * signal, because an administrator deciding whether a block was right needs to
 * see which signal was unusual, and `{"time_deviation":11.3}` does not say that
 * to anyone who has not read the training script.
 */
async function listAnomalies(req, res) {
  const data = parse(anomaliesSchema, req.query, res);
  if (!data) return;

  const range = timeWindow.resolve(data);
  const limit = Math.min(Math.max(Number(data.limit) || 50, 1), audit.MAX_LIMIT);
  const offset = Math.max(Number(data.offset) || 0, 0);

  const f = filterBuilder();
  f.add('s.created_at >= $?::timestamptz', range.from);
  f.add('s.created_at <= $?::timestamptz', range.to);
  if (data.userId) f.add('e.user_id = $?::uuid', data.userId);
  if (data.role) f.add('u.role = $?', data.role);
  if (data.action) f.add('s.action = $?', data.action);
  if (data.riskLevel) f.add('s.risk_level = $?', data.riskLevel);
  if (data.minScore !== undefined) f.add('s.isolation_forest_score >= $?::numeric', data.minScore);
  if (data.maxScore !== undefined) f.add('s.isolation_forest_score <= $?::numeric', data.maxScore);
  // 'allow' is the overwhelming majority of rows and is not what gets reviewed.
  if (data.flaggedOnly === 'true') f.add("s.action IS DISTINCT FROM 'allow'");
  if (data.reviewStatus === 'unreviewed') f.add('s.review_status IS NULL');
  else if (data.reviewStatus) f.add('s.review_status = $?', data.reviewStatus);
  if (data.search) {
    const term = likeTerm(data.search);
    f.add('(u.full_name ILIKE $? OR e.ip_address ILIKE $? OR e.city ILIKE $?)', term, term, term);
  }

  const column = ANOMALY_SORTS[data.sort] || ANOMALY_SORTS.time;
  const direction = String(data.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.login_event_id, s.isolation_forest_score, s.risk_level, s.explanation,
              s.action, s.governed_by, s.cold_start, s.model_available, s.features,
              s.known_device, s.velocity_count, s.created_at,
              s.review_status, s.review_note, s.reviewed_at, s.reviewed_by,
              reviewer.full_name AS reviewer_name,
              e.ip_address, e.country, e.city, e.login_time, e.was_successful,
              e.device_fingerprint, e.login_velocity,
              u.id AS user_id, u.full_name, u.role, u.account_status, u.phone_number,
              count(*) OVER () AS total
       FROM anomaly_scores s
       JOIN login_events e ON e.id = s.login_event_id
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
       ${f.clause()}
       ORDER BY ${column} ${direction}, s.id DESC
       ${f.paging()}`,
      [...f.params, limit, offset]
    );

    auditTargetedRead(req, { view: 'anomalies', filters: data });

    return res.status(200).json({
      ...describeWindow(range),
      total: rows.length ? Number(rows[0].total) : 0,
      limit,
      offset,
      anomalies: rows.map(presentAnomaly),
    });
  } catch (err) {
    console.error('listAnomalies error:', err);
    return res.status(500).json({ error: 'Could not load anomaly scores.' });
  }
}

/**
 * One anomaly row, as the review screen needs it.
 *
 * `decision` carries both halves of the outcome: what was done (action) and
 * whether the model or a deterministic rule decided it (governedBy). They are
 * reported together because "blocked" means something different when the
 * impossible-travel rule forced it than when the score alone crossed the
 * threshold, and an administrator reviewing a false positive has to know which
 * one to argue with.
 */
function presentAnomaly(r) {
  return {
    id: r.id,
    loginEventId: r.login_event_id,
    time: r.created_at,
    loginTime: r.login_time,
    riskScore: toNumber(r.isolation_forest_score),
    riskLevel: r.risk_level,
    explanation: explanation.forAnomaly(r),
    decision: {
      action: r.action,
      governedBy: r.governed_by,
      // A cold-start decision was made with no behavioural baseline, and a
      // decision made while the engine was unreachable was not the model's at
      // all. Either one changes how much weight the score deserves.
      coldStart: r.cold_start,
      modelAvailable: r.model_available,
      loginSucceeded: r.was_successful,
    },
    account: r.user_id ? {
      id: r.user_id,
      fullName: r.full_name,
      role: r.role,
      accountStatus: r.account_status,
      phoneNumber: maskPhone(r.phone_number),
    } : null,
    origin: {
      ip: r.ip_address,
      country: r.country,
      city: r.city,
      deviceFingerprint: r.device_fingerprint,
      knownDevice: r.known_device,
    },
    features: r.features,
    signals: explanation.contributingFeatures(r.features, { knownDevice: r.known_device }),
    // null when nobody has ruled on it, which is deliberately distinguishable
    // from a verdict of "fine": an unreviewed queue and an all-clear queue are
    // otherwise the same shape on screen.
    review: r.review_status ? {
      status: r.review_status,
      note: r.review_note,
      at: r.reviewed_at,
      by: r.reviewed_by ? { id: r.reviewed_by, fullName: r.reviewer_name } : null,
    } : null,
  };
}

// ───────────────────────── GET /admin/stats/summary ─────────────────────────

/**
 * The KPI cards: counts for the window, and the same counts for the window
 * before it.
 *
 * Four queries, one per table, each a single pass that counts both periods with
 * FILTER rather than running the same scan twice. They go out together because
 * none depends on another's result, and the card row should not take four round
 * trips to fill.
 *
 * Every number here is a count of rows the detection layers wrote, with no
 * derived or smoothed values, so a card can be checked against the database by
 * hand — which is the acceptance criterion for this view.
 */
async function summary(req, res) {
  const data = parse(summarySchema, req.query, res);
  if (!data) return;

  const range = timeWindow.resolve(data);
  const bounds = [range.from, range.to, range.previousFrom];

  try {
    const [logins, anomalies, sessions, events] = await Promise.all([
      pool.query(
        `SELECT
           count(*) FILTER (WHERE was_successful AND login_time >= $1::timestamptz) AS logins,
           count(*) FILTER (WHERE NOT was_successful AND login_time >= $1::timestamptz) AS failed_logins,
           count(DISTINCT user_id) FILTER (WHERE was_successful AND login_time >= $1::timestamptz) AS accounts,
           count(*) FILTER (WHERE was_successful AND login_time < $1::timestamptz) AS prev_logins,
           count(*) FILTER (WHERE NOT was_successful AND login_time < $1::timestamptz) AS prev_failed_logins,
           count(DISTINCT user_id) FILTER (WHERE was_successful AND login_time < $1::timestamptz) AS prev_accounts
         FROM login_events
         WHERE login_time >= $3::timestamptz AND login_time <= $2::timestamptz`, bounds),

      pool.query(
        `SELECT
           count(*) FILTER (WHERE created_at >= $1::timestamptz) AS scored,
           count(*) FILTER (WHERE created_at >= $1::timestamptz
                              AND action IS DISTINCT FROM 'allow') AS flagged,
           count(*) FILTER (WHERE created_at >= $1::timestamptz AND action = 'block') AS blocked_logins,
           count(*) FILTER (WHERE created_at >= $1::timestamptz AND action = 'step_up') AS step_ups,
           avg(isolation_forest_score) FILTER (WHERE created_at >= $1::timestamptz) AS avg_risk,
           count(*) FILTER (WHERE created_at < $1::timestamptz) AS prev_scored,
           count(*) FILTER (WHERE created_at < $1::timestamptz
                              AND action IS DISTINCT FROM 'allow') AS prev_flagged,
           count(*) FILTER (WHERE created_at < $1::timestamptz AND action = 'block') AS prev_blocked_logins,
           count(*) FILTER (WHERE created_at < $1::timestamptz AND action = 'step_up') AS prev_step_ups,
           avg(isolation_forest_score) FILTER (WHERE created_at < $1::timestamptz) AS prev_avg_risk
         FROM anomaly_scores
         WHERE created_at >= $3::timestamptz AND created_at <= $2::timestamptz`, bounds),

      // Unbounded by the window on purpose: "signed in right now" is a fact
      // about the present, not about the last 24 hours, and a card that showed
      // only sessions started inside the window would under-report every
      // long-lived session. The partial index on active sessions serves it.
      pool.query(
        `SELECT
           count(*) FILTER (WHERE session_status = 'active' AND expires_at > NOW()) AS active_now,
           count(*) FILTER (WHERE flagged_at >= $1::timestamptz
                              AND flagged_at <= $2::timestamptz) AS blocked_sessions,
           count(*) FILTER (WHERE flagged_at >= $3::timestamptz
                              AND flagged_at < $1::timestamptz) AS prev_blocked_sessions,
           count(*) FILTER (WHERE created_at >= $1::timestamptz
                              AND created_at <= $2::timestamptz) AS started,
           count(*) FILTER (WHERE created_at >= $3::timestamptz
                              AND created_at < $1::timestamptz) AS prev_started
         FROM sessions`, bounds),

      pool.query(
        `SELECT
           count(*) FILTER (WHERE logged_at >= $1::timestamptz) AS events,
           count(*) FILTER (WHERE logged_at >= $1::timestamptz
                              AND severity IN ('high', 'critical')) AS urgent,
           count(*) FILTER (WHERE logged_at >= $1::timestamptz AND decision = 'deny') AS access_denied,
           count(*) FILTER (WHERE logged_at < $1::timestamptz) AS prev_events,
           count(*) FILTER (WHERE logged_at < $1::timestamptz
                              AND severity IN ('high', 'critical')) AS prev_urgent,
           count(*) FILTER (WHERE logged_at < $1::timestamptz AND decision = 'deny') AS prev_access_denied
         FROM audit_logs
         WHERE logged_at >= $3::timestamptz AND logged_at <= $2::timestamptz`, bounds),
    ]);

    const l = logins.rows[0];
    const a = anomalies.rows[0];
    const s = sessions.rows[0];
    const e = events.rows[0];

    return res.status(200).json({
      ...describeWindow(range),
      metrics: {
        logins: metric(l.logins, l.prev_logins),
        failedLogins: metric(l.failed_logins, l.prev_failed_logins),
        accountsSignedIn: metric(l.accounts, l.prev_accounts),
        anomaliesScored: metric(a.scored, a.prev_scored),
        anomaliesFlagged: metric(a.flagged, a.prev_flagged),
        loginsBlocked: metric(a.blocked_logins, a.prev_blocked_logins),
        stepUpsRequired: metric(a.step_ups, a.prev_step_ups),
        sessionsBlocked: metric(s.blocked_sessions, s.prev_blocked_sessions),
        sessionsStarted: metric(s.started, s.prev_started),
        events: metric(e.events, e.prev_events),
        urgentEvents: metric(e.urgent, e.prev_urgent),
        accessDenied: metric(e.access_denied, e.prev_access_denied),
      },
      // Not a windowed count, so it is reported outside `metrics` rather than
      // given a meaningless `previous` alongside the cards that have one.
      activeSessions: Number(s.active_now) || 0,
      averageRiskScore: {
        value: toNumber(a.avg_risk) === null ? null : Math.round(toNumber(a.avg_risk) * 10) / 10,
        previous: toNumber(a.prev_avg_risk) === null ? null
          : Math.round(toNumber(a.prev_avg_risk) * 10) / 10,
      },
    });
  } catch (err) {
    console.error('summary error:', err);
    return res.status(500).json({ error: 'Could not load the security summary.' });
  }
}

// ──────────────────────────── GET /admin/sessions ────────────────────────────

const SESSION_SORTS = {
  lastSeen: 'COALESCE(s.last_seen_at, s.created_at)',
  started: 's.created_at',
  risk: 's.risk_score',
};

/**
 * Who is signed in, and from where.
 *
 * PostgreSQL is the source of truth for the list and Redis is consulted for
 * liveness, which is the same order of trust the session layer itself uses.
 * Reading the list out of Redis directly would mean SCANning a keyspace shared
 * with the OTP, velocity and notification keys, would return an id and a user id
 * and nothing else, and would silently show an empty dashboard after a cache
 * flush — at the moment an administrator most needs to know who is connected.
 *
 * What Redis does answer is whether the fast path still holds the session and
 * for how long, which is exactly what tells an administrator whether a revoke
 * has taken effect everywhere. When Redis is unreachable the rows are still
 * returned, with `cache.available` false, rather than failing the request.
 */
async function listSessions(req, res) {
  const data = parse(sessionsSchema, req.query, res);
  if (!data) return;

  const limit = Math.min(Math.max(Number(data.limit) || 50, 1), audit.MAX_LIMIT);
  const offset = Math.max(Number(data.offset) || 0, 0);
  const status = data.status || 'active';

  const f = filterBuilder();
  if (status === 'active') {
    // An 'active' row whose expires_at has passed is not a live session; the
    // status column is only updated when something touches the session.
    f.add("s.session_status = 'active' AND s.expires_at > NOW()");
  } else if (status === 'expired') {
    f.add("(s.session_status = 'expired' OR (s.session_status = 'active' AND s.expires_at <= NOW()))");
  } else if (status !== 'all') {
    f.add('s.session_status = $?', status);
  }
  if (data.userId) f.add('s.user_id = $?::uuid', data.userId);
  if (data.role) f.add('u.role = $?', data.role);
  if (data.search) {
    const term = likeTerm(data.search);
    f.add('(u.full_name ILIKE $? OR s.ip_address ILIKE $? OR COALESCE(s.last_seen_ip, s.ip_address) ILIKE $?)',
      term, term, term);
  }

  const column = SESSION_SORTS[data.sort] || SESSION_SORTS.lastSeen;
  const direction = String(data.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.user_id, s.user_role, s.risk_score, s.device_fingerprint,
              s.ip_address, s.last_seen_ip, s.last_seen_at, s.session_status,
              s.created_at, s.expires_at, s.flagged_reason, s.flagged_at,
              u.full_name, u.role, u.account_status, u.phone_number,
              count(*) OVER () AS total
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       ${f.clause()}
       ORDER BY ${column} ${direction}, s.id DESC
       ${f.paging()}`,
      [...f.params, limit, offset]
    );

    const cache = await cacheTtls(rows.map((r) => r.id));
    auditTargetedRead(req, { view: 'sessions', filters: data });

    return res.status(200).json({
      total: rows.length ? Number(rows[0].total) : 0,
      limit,
      offset,
      status,
      cache: { available: cache.available },
      sessions: rows.map((r) => presentSession(r, cache)),
    });
  } catch (err) {
    console.error('listSessions error:', err);
    return res.status(500).json({ error: 'Could not load active sessions.' });
  }
}

/**
 * The remaining Redis TTL for each session, in one pipeline.
 *
 * TTL answers both questions at once: -2 means the key is gone (so the fast path
 * will fall through to PostgreSQL), and a positive value is how long the cached
 * grant still stands. Never throws — a cache that cannot be reached is reported
 * as unavailable, not as a page of dead sessions.
 */
async function cacheTtls(sessionIds) {
  if (!sessionIds.length) return { available: true, ttl: new Map() };
  try {
    const pipeline = redis.multi();
    sessionIds.forEach((id) => pipeline.ttl(`session:${id}`));
    const results = await pipeline.exec();
    const ttl = new Map();
    results.forEach(([err, value], i) => { if (!err) ttl.set(sessionIds[i], Number(value)); });
    return { available: true, ttl };
  } catch (err) {
    console.error('Redis session liveness unavailable:', err.message);
    return { available: false, ttl: new Map() };
  }
}

function presentSession(r, cache) {
  const ttl = cache.ttl.has(r.id) ? cache.ttl.get(r.id) : null;
  const expired = new Date(r.expires_at) <= new Date();

  return {
    id: r.id,
    status: r.session_status === 'active' && expired ? 'expired' : r.session_status,
    account: {
      id: r.user_id,
      fullName: r.full_name,
      role: r.role,
      accountStatus: r.account_status,
      phoneNumber: maskPhone(r.phone_number),
      // The role recorded on the session, which is the role the token carries.
      // A mismatch with the account's current role means the session predates a
      // role change and is worth seeing.
      sessionRole: r.user_role,
    },
    device: {
      fingerprint: r.device_fingerprint,
      ip: r.ip_address,
      lastSeenIp: r.last_seen_ip,
    },
    startedAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
    riskScore: toNumber(r.risk_score),
    ...(r.flagged_reason && {
      flagged: { reason: r.flagged_reason, at: r.flagged_at },
    }),
    cache: cache.available
      ? { cached: ttl !== null && ttl >= 0, ttlSeconds: ttl !== null && ttl >= 0 ? ttl : null }
      : { cached: null, ttlSeconds: null },
  };
}

module.exports = { listEvents, listAnomalies, summary, listSessions, presentAnomaly, presentSession };
