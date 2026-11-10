const { z } = require('zod');
const axios = require('axios');
const pool = require('../config/db');
const { parse } = require('../utils/validate');
const audit = require('../utils/audit');
const timeWindow = require('../utils/timeWindow');
const layers = require('../services/securityLayers');
const stream = require('../services/securityStream');
const explanation = require('../services/explanation');

/*
 * Aggregates and the live feed: what the charts on the dashboard read.
 *
 * Every endpoint here aggregates in PostgreSQL rather than returning rows for
 * the browser to count. A month of events is tens of thousands of rows and the
 * chart needs thirty numbers; shipping the rows to compute them would make the
 * page slow in exactly the deployment where the dashboard matters most, and
 * would put two different counting implementations — one in SQL for the KPI
 * cards, one in JavaScript for the chart — in front of an administrator who has
 * to trust that they agree.
 *
 * ── A note on time ──
 *
 * The timestamp columns are `timestamp without time zone` holding the
 * database's local wall time, because that is what NOW() writes. Turning one
 * into a true instant therefore needs the database's own zone:
 * `logged_at AT TIME ZONE current_setting('TimeZone')`. The bucket boundaries
 * below are computed that way and returned as epoch seconds — a number, not a
 * formatted string — so nothing between here and the chart axis can reinterpret
 * them in the wrong zone. Range comparisons use ::timestamptz, which applies the
 * same session zone, so the filters and the buckets agree by construction.
 */

const SEVERITIES = ['info', 'medium', 'high', 'critical'];
const ROLES = ['family', 'caregiver', 'administrator'];

const timestamp = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)),
  'Use an ISO date or date-time');

const windowFields = {
  window: z.enum(timeWindow.KEYS).optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
};

/** The epoch-seconds expression for a column, in the zone that wrote it. */
const epochOf = (column) => `extract(epoch from (${column} AT TIME ZONE current_setting('TimeZone')))`;

/** Escape a user-supplied ILIKE term so its wildcards are literal. */
const likeTerm = (value) => `%${String(value).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

function filterBuilder() {
  const where = [];
  const params = [];
  const add = (sql, ...values) => {
    let i = 0;
    where.push(sql.replace(/\$\?/g, () => { params.push(values[i]); i += 1; return `$${params.length}`; }));
  };
  return {
    add,
    params,
    clause: () => (where.length ? `WHERE ${where.join(' AND ')}` : ''),
    placeholder: (offset = 1) => `$${params.length + offset}`,
  };
}

const describeWindow = (range) => ({
  window: range.window,
  from: range.from.toISOString(),
  to: range.to.toISOString(),
  previousFrom: range.previousFrom.toISOString(),
});

// ──────────────────────── GET /admin/stats/timeseries ────────────────────────

/*
 * How events are grouped into series.
 *
 * A whitelist of SQL expressions keyed by what the client may ask for; an
 * unrecognised key falls back to event type rather than being interpolated.
 * `layer` is generated from securityLayers so the database's idea of a layer
 * and the application's cannot drift.
 */
const SERIES_BY = {
  eventType: 'a.event_type',
  severity: 'a.severity',
  layer: layers.sqlCase('a.event_type'),
  role: "COALESCE(u.role, 'unknown')",
  decision: "COALESCE(a.decision, 'none')",
};

const timeseriesSchema = z.object({
  ...windowFields,
  groupBy: z.enum(Object.keys(SERIES_BY)).optional(),
  severity: z.enum(SEVERITIES).optional(),
  eventType: z.string().max(50).optional(),
  role: z.enum(ROLES).optional(),
  layer: z.enum([...layers.KEYS, 'other']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
}).strict();

/**
 * Events over time, split into series.
 *
 * The bucket width is chosen from the window so a chart gets 24–60 points:
 * hourly over a day, six-hourly over a week, daily over a month. Six hours is
 * why the floor is computed arithmetically instead of with date_trunc, which
 * has no such unit.
 *
 * Empty buckets are filled in. A time series with gaps where nothing happened
 * draws a line that steps straight over the quiet hours, which reads as
 * continuous activity rather than as none — the opposite of what the data says.
 */
async function timeseries(req, res) {
  const data = parse(timeseriesSchema, req.query, res);
  if (!data) return;

  const range = timeWindow.resolve(data);
  const bucket = timeWindow.bucketFor(range.window, range.spanMs);
  const groupBy = data.groupBy || 'eventType';
  const seriesExpr = SERIES_BY[groupBy];

  const f = filterBuilder();
  f.add(`a.logged_at >= $?::timestamptz`, range.from);
  f.add(`a.logged_at <= $?::timestamptz`, range.to);
  if (data.severity) f.add('a.severity = $?', data.severity);
  if (data.eventType) f.add('a.event_type = $?', data.eventType);
  if (data.role) f.add('u.role = $?', data.role);
  if (data.layer) f.add(`${layers.sqlCase('a.event_type')} = $?`, data.layer);
  if (data.search) {
    const term = likeTerm(data.search);
    f.add('(u.full_name ILIKE $? OR a.ip_address ILIKE $?)', term, term);
  }

  const width = f.placeholder();

  try {
    const { rows } = await pool.query(
      `SELECT (floor(${epochOf('a.logged_at')} / ${width}) * ${width})::bigint AS bucket,
              ${seriesExpr} AS series,
              count(*)::int AS count
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${f.clause()}
       GROUP BY bucket, series
       ORDER BY bucket ASC`,
      [...f.params, bucket.seconds]
    );

    const seriesNames = [...new Set(rows.map((r) => r.series))].sort();
    const counts = new Map(rows.map((r) => [`${r.bucket}:${r.series}`, r.count]));

    // The grid of buckets the window covers, so the chart's x-axis is the
    // window and not merely the range in which something happened.
    const step = bucket.seconds;
    const first = Math.floor((range.from.getTime() / 1000) / step) * step;
    const last = Math.floor((range.to.getTime() / 1000) / step) * step;
    const points = [];
    for (let at = first; at <= last; at += step) {
      const point = { at, time: new Date(at * 1000).toISOString() };
      let total = 0;
      for (const name of seriesNames) {
        const value = counts.get(`${at}:${name}`) || 0;
        point[name] = value;
        total += value;
      }
      point.total = total;
      points.push(point);
    }

    return res.status(200).json({
      ...describeWindow(range),
      groupBy,
      bucketSeconds: step,
      bucketLabel: bucket.label,
      series: seriesNames.map((name) => ({
        key: name,
        label: groupBy === 'layer' ? (layers.LABEL[name] || name) : humanise(name),
        total: points.reduce((sum, p) => sum + (p[name] || 0), 0),
      })),
      points,
    });
  } catch (err) {
    console.error('timeseries error:', err);
    return res.status(500).json({ error: 'Could not load the event timeline.' });
  }
}

/** snake_case event types read as sentences in a legend. */
const humanise = (value) => String(value).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ───────────────────── GET /admin/anomalies/distribution ─────────────────────

const distributionSchema = z.object({
  ...windowFields,
  bucketSize: z.coerce.number().int().min(1).max(25).optional(),
  role: z.enum(ROLES).optional(),
}).strict();

/**
 * The anomaly score distribution, with the decision thresholds that cut it.
 *
 * The histogram is what makes the thresholds arguable. A score of 61 blocks
 * nothing and a score of 89 blocks a sign-in, and whether those are the right
 * lines is a question about where the mass of the distribution actually sits —
 * which an administrator cannot answer from a list of individual scores.
 *
 * Alongside it: the same period broken down by which defence recorded the
 * concern, and by the role of the account involved. Both are counted from
 * audit_logs rather than from anomaly_scores, because only the pre-login layer
 * produces scores at all — a breakdown taken from the score table would show
 * three layers with two of them permanently empty.
 */
async function distribution(req, res) {
  const data = parse(distributionSchema, req.query, res);
  if (!data) return;

  const range = timeWindow.resolve(data);
  const size = Number(data.bucketSize) || 5;
  const bounds = [range.from, range.to];

  try {
    const [histogram, byAction, byLayer, byRole, thresholds] = await Promise.all([
      pool.query(
        `SELECT (floor(s.isolation_forest_score / $3::numeric) * $3::numeric)::float AS floor,
                count(*)::int AS count,
                count(*) FILTER (WHERE s.action = 'block')::int AS blocked,
                count(*) FILTER (WHERE s.action = 'step_up')::int AS stepped_up,
                count(*) FILTER (WHERE s.action = 'allow')::int AS allowed
         FROM anomaly_scores s
         WHERE s.created_at >= $1::timestamptz AND s.created_at <= $2::timestamptz
           AND s.isolation_forest_score IS NOT NULL
         GROUP BY floor ORDER BY floor ASC`, [...bounds, size]),

      pool.query(
        `SELECT COALESCE(s.action, 'unrecorded') AS action,
                COALESCE(s.governed_by, 'unrecorded') AS governed_by,
                count(*)::int AS count,
                round(avg(s.isolation_forest_score)::numeric, 1)::float AS avg_score
         FROM anomaly_scores s
         WHERE s.created_at >= $1::timestamptz AND s.created_at <= $2::timestamptz
         GROUP BY action, governed_by ORDER BY count DESC`, bounds),

      // "Of concern" is stated rather than implied: medium-and-above severity,
      // or an outright refusal. A layer's raw event count is dominated by
      // routine traffic and would say nothing about where attention is needed.
      pool.query(
        `SELECT ${layers.sqlCase('a.event_type')} AS layer,
                count(*)::int AS total,
                count(*) FILTER (WHERE a.severity IN ('medium', 'high', 'critical')
                                    OR a.decision = 'deny')::int AS of_concern
         FROM audit_logs a
         WHERE a.logged_at >= $1::timestamptz AND a.logged_at <= $2::timestamptz
         GROUP BY layer ORDER BY of_concern DESC`, bounds),

      pool.query(
        `SELECT COALESCE(u.role, 'unknown') AS role,
                count(*)::int AS total,
                count(*) FILTER (WHERE a.severity IN ('medium', 'high', 'critical')
                                    OR a.decision = 'deny')::int AS of_concern,
                count(DISTINCT a.user_id)::int AS accounts
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.logged_at >= $1::timestamptz AND a.logged_at <= $2::timestamptz
         GROUP BY role ORDER BY of_concern DESC`, bounds),

      modelThresholds(),
    ]);

    return res.status(200).json({
      ...describeWindow(range),
      bucketSize: size,
      // The thresholds the chart marks. Reported with their source so a chart
      // drawn against the fallback values cannot be mistaken for one drawn
      // against what the engine is actually enforcing.
      thresholds,
      histogram: histogram.rows.map((r) => ({
        from: r.floor,
        to: r.floor + size,
        count: r.count,
        allowed: r.allowed,
        steppedUp: r.stepped_up,
        blocked: r.blocked,
      })),
      byDecision: byAction.rows.map((r) => ({
        action: r.action,
        governedBy: r.governed_by,
        count: r.count,
        averageScore: r.avg_score,
      })),
      byLayer: byLayer.rows.map((r) => ({
        layer: r.layer,
        label: layers.LABEL[r.layer] || r.layer,
        description: layers.DESCRIPTION[r.layer] || null,
        total: r.total,
        ofConcern: r.of_concern,
      })),
      byRole: byRole.rows.map((r) => ({
        role: r.role,
        total: r.total,
        ofConcern: r.of_concern,
        accounts: r.accounts,
      })),
    });
  } catch (err) {
    console.error('distribution error:', err);
    return res.status(500).json({ error: 'Could not load the anomaly distribution.' });
  }
}

// ──────────────────────────── GET /admin/model ────────────────────────────

/*
 * The model's own account of itself.
 *
 * Cached briefly: the dashboard asks for the thresholds alongside every
 * distribution request, and the answer changes only when the engine is
 * restarted with a retrained model.
 *
 * The fallback values are the ones in the committed model metadata. They are
 * returned with `source: 'fallback'` and never silently — a histogram with a
 * block line drawn at 88 when the engine is actually enforcing something else
 * would be worse than one with no line at all.
 */
const ML_URL = (process.env.ML_ENGINE_URL || 'http://localhost:5000').replace(/\/$/, '');
const THRESHOLD_TTL_MS = 60_000;
const FALLBACK_THRESHOLDS = { allowMax: 58.9, stepUpMax: 88 };

let thresholdCache = { at: 0, value: null };

async function modelThresholds() {
  if (thresholdCache.value && Date.now() - thresholdCache.at < THRESHOLD_TTL_MS) {
    return thresholdCache.value;
  }

  let value;
  try {
    const { data } = await axios.get(`${ML_URL}/health`, { timeout: 1500 });
    // The engine's payload spells this key 'threshlods'. Both spellings are
    // read so the dashboard keeps working either way — depending on a typo is
    // fragile, and so is depending on it being fixed.
    const published = data.thresholds || data.threshlods || {};
    const allowMax = Number(published.allow_max);
    const stepUpMax = Number(published.step_up_max);

    value = Number.isFinite(allowMax) && Number.isFinite(stepUpMax)
      ? {
        allowMax,
        stepUpMax,
        source: 'engine',
        modelLoaded: Boolean(data.model_loaded),
        features: Array.isArray(data.features) ? data.features : null,
      }
      : { ...FALLBACK_THRESHOLDS, source: 'fallback', reason: 'engine_reported_no_thresholds' };
  } catch (err) {
    value = {
      ...FALLBACK_THRESHOLDS,
      source: 'fallback',
      reason: 'engine_unreachable',
      detail: err.code || err.message,
    };
  }

  thresholdCache = { at: Date.now(), value };
  return value;
}

/** GET /admin/model — thresholds, features and the explanation cutoffs. */
async function model(req, res) {
  const thresholds = await modelThresholds();
  return res.status(200).json({
    thresholds,
    // The cutoffs the signal breakdown uses to call a feature unusual, so the
    // review screen can say what "unusual" meant rather than only that it was.
    explanationCutoffs: explanation.CUTS,
    signals: explanation.SIGNALS.map((s) => ({ feature: s.feature, label: s.label })),
    layers: layers.KEYS.map((key) => ({
      key, label: layers.LABEL[key], description: layers.DESCRIPTION[key],
      eventTypes: layers.LAYERS[key],
    })),
  });
}

// ─────────────────────────── GET /admin/locations ───────────────────────────

const locationsSchema = z.object({
  ...windowFields,
  role: z.enum(ROLES).optional(),
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
}).strict();

/**
 * Where sign-ins came from, and which pairs were too far apart to be real.
 *
 * Two sets. The points are login attempts that geolocated, each carrying what
 * the model made of it. The legs are recorded impossible-travel events, which
 * is the detection that a map actually adds something to: two points and a time
 * between them is a claim a reader can check at a glance, where the same thing
 * in a table is two city names and some arithmetic.
 *
 * Coordinates come from what was resolved at the time, not from re-geolocating
 * the address now. An IP reassigned since would otherwise put a months-old
 * sign-in wherever that address lives today. Events recorded before the
 * coordinates were carried on them return with `points: null` on the leg, and
 * the map draws the endpoints it knows without inventing the line.
 */
async function locations(req, res) {
  const data = parse(locationsSchema, req.query, res);
  if (!data) return;

  const range = timeWindow.resolve(data);
  const limit = Math.min(Math.max(Number(data.limit) || 500, 1), 1000);

  const f = filterBuilder();
  f.add('e.login_time >= $?::timestamptz', range.from);
  f.add('e.login_time <= $?::timestamptz', range.to);
  f.add('e.latitude IS NOT NULL AND e.longitude IS NOT NULL');
  if (data.role) f.add('u.role = $?', data.role);
  if (data.userId) f.add('e.user_id = $?::uuid', data.userId);

  try {
    const [points, travel] = await Promise.all([
      pool.query(
        `SELECT e.id, e.latitude::float AS lat, e.longitude::float AS lon,
                e.country, e.city, e.ip_address, e.login_time, e.was_successful,
                u.id AS user_id, u.full_name, u.role,
                s.isolation_forest_score, s.risk_level, s.action
         FROM login_events e
         LEFT JOIN users u ON u.id = e.user_id
         LEFT JOIN anomaly_scores s ON s.login_event_id = e.id
         ${f.clause()}
         ORDER BY e.login_time DESC
         LIMIT ${f.placeholder()}`,
        [...f.params, limit]),

      pool.query(
        `SELECT a.id, a.logged_at, a.event_detail, a.explanation, a.severity,
                u.id AS user_id, u.full_name, u.role
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.event_type = 'impossible_travel'
           AND a.logged_at >= $1::timestamptz AND a.logged_at <= $2::timestamptz
           AND ($3::uuid IS NULL OR a.user_id = $3::uuid)
         ORDER BY a.logged_at DESC
         LIMIT 200`,
        [range.from, range.to, data.userId || null]),
    ]);

    return res.status(200).json({
      ...describeWindow(range),
      points: points.rows.map((r) => ({
        id: r.id,
        lat: r.lat,
        lon: r.lon,
        country: r.country,
        city: r.city,
        ip: r.ip_address,
        time: r.login_time,
        succeeded: r.was_successful,
        riskScore: r.isolation_forest_score === null ? null : Number(r.isolation_forest_score),
        riskLevel: r.risk_level,
        action: r.action,
        account: r.user_id ? { id: r.user_id, fullName: r.full_name, role: r.role } : null,
      })),
      impossibleTravel: travel.rows.map(presentTravel),
    });
  } catch (err) {
    console.error('locations error:', err);
    return res.status(500).json({ error: 'Could not load sign-in locations.' });
  }
}

function presentTravel(r) {
  const detail = audit.parseDetail(r.event_detail) || {};
  const hasPoints = Number.isFinite(detail.fromPoint?.lat) && Number.isFinite(detail.toPoint?.lat);

  return {
    id: r.id,
    time: r.logged_at,
    severity: r.severity,
    explanation: r.explanation || detail.explanation || null,
    from: detail.from || null,
    to: detail.to || null,
    distanceKm: detail.distanceKm ?? null,
    elapsedMinutes: detail.elapsedMinutes ?? null,
    requiredSpeedKmh: detail.requiredSpeedKmh ?? null,
    stage: detail.stage || null,
    // null rather than a guess: see the note on this endpoint.
    points: hasPoints
      ? { from: detail.fromPoint, to: detail.toPoint }
      : null,
    account: r.user_id ? { id: r.user_id, fullName: r.full_name, role: r.role } : null,
  };
}

// ────────────────────────── GET /admin/events.csv ──────────────────────────

const COLUMNS = [
  ['time', (e) => e.time],
  ['severity', (e) => e.severity],
  ['layer', (e) => layers.LABEL[layers.forEvent(e.eventType)] || ''],
  ['event_type', (e) => e.eventType],
  ['explanation', (e) => e.explanation],
  ['actor_name', (e) => e.actor?.fullName || ''],
  ['actor_role', (e) => e.actor?.role || ''],
  ['actor_type', (e) => e.actorType || ''],
  ['action', (e) => e.action || ''],
  ['decision', (e) => e.decision || ''],
  ['resource_type', (e) => e.resourceType || ''],
  ['resource_id', (e) => e.resourceId || ''],
  ['target_name', (e) => e.target?.fullName || ''],
  ['ip_address', (e) => e.ip || ''],
  ['session_id', (e) => e.sessionId || ''],
  ['event_id', (e) => e.id],
];

/**
 * One CSV cell.
 *
 * Quoted and doubled per RFC 4180, and — separately — guarded against formula
 * injection. A cell beginning =, +, - or @ is treated as a formula by Excel and
 * Sheets, so an attacker who can get a string into an audit row (a crafted user
 * agent, a URL in a refused request) can have it execute on the machine of
 * whoever opens the export. The audit trail is precisely a file full of
 * attacker-influenced strings that an administrator will open in a spreadsheet,
 * which makes this the realistic attack on an export feature rather than a
 * theoretical one. Prefixing a tab keeps the value readable while removing its
 * formula-ness.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value instanceof Date ? value.toISOString() : value);
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const csvEventsSchema = z.object({
  ...windowFields,
  userId: z.string().uuid().optional(),
  severity: z.enum(SEVERITIES).optional(),
  eventType: z.string().max(50).optional(),
  decision: z.enum(['allow', 'deny']).optional(),
  actorType: z.enum(['user', 'administrator', 'automated', 'system']).optional(),
  role: z.enum(ROLES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(Object.keys(audit.SORTS)).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional(),
}).strict();

/**
 * The filtered event feed as a CSV file.
 *
 * Exports what is on screen, honouring the same filters, with a row cap well
 * above a page but far below "the whole table" — an unbounded export of an
 * append-only trail is a way to turn one request into an hour of database time.
 *
 * The export is itself recorded. Taking a copy of the security history out of
 * the system is exactly the kind of act the trail should contain, and unlike the
 * screen it produces a file that outlives any access control this service has.
 */
async function exportEvents(req, res) {
  const data = parse(csvEventsSchema, req.query, res);
  if (!data) return;

  const range = timeWindow.resolve(data);
  const limit = Math.min(Number(data.limit) || 5000, 10000);

  try {
    const page = await audit.query({ ...data, from: range.from, to: range.to, limit: audit.MAX_LIMIT });

    // Paged rather than fetched in one statement: MAX_LIMIT caps a single query
    // at 200 rows, and honouring that here keeps one export from holding a
    // connection open over a result set the rest of the service has to wait for.
    const rows = [...page.rows];
    while (rows.length < Math.min(page.total, limit)) {
      const next = await audit.query({
        ...data, from: range.from, to: range.to, limit: audit.MAX_LIMIT, offset: rows.length,
      });
      if (!next.rows.length) break;
      rows.push(...next.rows);
    }

    const events = rows.slice(0, limit).map(audit.presentEvent);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mzazicare-events-${stamp}.csv"`);
    // The file is a download, never something a browser should render or reuse.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    const lines = [COLUMNS.map(([name]) => csvCell(name)).join(',')];
    for (const event of events) {
      lines.push(COLUMNS.map(([, read]) => csvCell(read(event))).join(','));
    }

    audit.logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'admin_export',
      severity: 'medium', resourceType: 'audit_trail', resourceId: data.userId || null,
      action: 'export', decision: 'allow', actorType: 'administrator', ip: req.ip,
      detail: { rows: events.length, format: 'csv', filters: data },
    });

    // CRLF per RFC 4180, and a UTF-8 BOM so Excel on Windows reads the file as
    // UTF-8 rather than guessing the system codepage and mangling any name
    // outside ASCII.
    return res.status(200).send(`﻿${lines.join('\r\n')}\r\n`);
  } catch (err) {
    console.error('exportEvents error:', err);
    return res.status(500).json({ error: 'Could not export the events.' });
  }
}

// ─────────────────────────── GET /admin/stream ───────────────────────────

const HEARTBEAT_MS = 25_000;

/**
 * Server-sent events: the live feed behind the dashboard's notifications.
 *
 * SSE rather than a WebSocket. The traffic is one-directional — the service
 * tells the dashboard what happened and the dashboard never pushes back — and
 * SSE is plain HTTP, so it carries the same bearer token, passes the same
 * authorization middleware, and is subject to the same rate limits as every
 * other endpoint. A WebSocket would need its own handshake authentication and
 * its own authorization path, which is a second way into the service's security
 * data for no functional gain.
 *
 * The first message always states whether delivery is live. If Redis is
 * unreachable the stream says so immediately instead of holding a connection
 * open that will never produce anything, and the dashboard polls instead.
 */
async function liveStream(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Nginx buffers proxied responses by default, which would hold events until
  // the buffer filled and make a live stream arrive in batches.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const write = (event, payload) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const { live, unsubscribe } = await stream.subscribe((event) => write('security', event));

  write('ready', {
    live,
    // The client needs to know whether to start its own polling, and an
    // administrator needs to know whether "nothing is happening" means the
    // service is quiet or the stream is dead.
    fallback: live ? null : 'poll',
    heartbeatSeconds: HEARTBEAT_MS / 1000,
    at: new Date().toISOString(),
  });

  // A comment line keeps the connection open through proxies and load balancers
  // that close idle connections, and lets the client notice a dead stream.
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.writableEnded) res.end();
  };

  req.on('close', close);
  req.on('error', close);
}

module.exports = {
  timeseries, distribution, model, locations, exportEvents, liveStream,
  modelThresholds, csvCell,
};
