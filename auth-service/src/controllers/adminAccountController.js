const { z } = require('zod');
const pool = require('../config/db');
const redis = require('../config/redis');
const { parse } = require('../utils/validate');
const audit = require('../utils/audit');
const timeWindow = require('../utils/timeWindow');
const layers = require('../services/securityLayers');
const explanation = require('../services/explanation');
const { maskPhone } = require('../services/notifier');
const { UUID_RE } = require('../services/resourceAccess');

/*
 * Reviewing anomalies, and the account views an administrator acts from.
 *
 * ── Why the review verdict is worth storing ──
 *
 * The model's precision figures come from the training set, which says how it
 * performed on data it was tuned against — not how it performs on this
 * deployment's real users at these thresholds. The administrator who phoned the
 * account holder back already knows the answer. Recording it turns a dashboard
 * into the source of labelled production data for the next retrain, which is
 * the only way the false-positive rate gets better rather than merely measured.
 *
 * Three verdicts, and `null` for "nobody has looked". That distinction is the
 * reason it is nullable rather than defaulting to under_review: an unreviewed
 * queue and an all-clear queue look identical otherwise, and the difference is
 * exactly what a reviewer needs to see.
 */

const uuidParam = (value) => UUID_RE.test(String(value || ''));

const REVIEW_STATUSES = ['true_positive', 'false_positive', 'under_review'];
const ROLES = ['family', 'caregiver', 'administrator'];
const STATUSES = ['active', 'pending', 'suspended', 'frozen'];

const reviewSchema = z.object({
  reviewStatus: z.enum(REVIEW_STATUSES),
  // Optional on purpose. Requiring a note on every verdict would make
  // classifying a queue of obvious false positives tedious enough that nobody
  // does it, and an unlabelled queue is worth less than an unexplained label.
  note: z.string().trim().max(500).optional(),
}).strict();

/**
 * PATCH /admin/anomalies/:id — record what the review concluded.
 *
 * Re-reviewable: a verdict can be corrected, and the audit trail keeps every
 * version because it is append-only, so the correction and the original both
 * survive. The row carries only the current verdict; the history of who thought
 * what is in the trail, where it cannot be edited.
 */
async function reviewAnomaly(req, res) {
  const data = parse(reviewSchema, req.body, res);
  if (!data) return;
  const id = req.params.id;
  if (!uuidParam(id)) return res.status(404).json({ error: 'Anomaly not found.' });

  try {
    const { rows } = await pool.query(
      `UPDATE anomaly_scores
       SET review_status = $2, review_note = $3, reviewed_by = $4, reviewed_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, isolation_forest_score, action, governed_by, risk_level,
                 review_status, review_note, reviewed_at, login_event_id`,
      [id, data.reviewStatus, data.note || null, req.user.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Anomaly not found.' });

    // Which account the verdict is about, for the trail. A verdict recorded
    // against an anomaly id alone would be unsearchable from the account that
    // was affected, which is how an incident review actually starts.
    const { rows: subject } = await pool.query(
      'SELECT user_id FROM login_events WHERE id = $1::uuid', [row.login_event_id]);

    await audit.logEvent({
      userId: req.user.id,
      sessionId: req.user.sessionId,
      eventType: 'anomaly_reviewed',
      severity: 'info',
      resourceType: 'anomaly',
      resourceId: id,
      action: 'review',
      decision: 'allow',
      actorType: 'administrator',
      ip: req.ip,
      detail: {
        reviewStatus: data.reviewStatus,
        note: data.note || null,
        riskScore: Number(row.isolation_forest_score),
        systemAction: row.action,
        governedBy: row.governed_by,
        subjectUserId: subject[0]?.user_id || null,
      },
      explanation: data.reviewStatus === 'false_positive'
        ? `An administrator recorded that the service was wrong to flag this sign-in (risk score ${
          Number(row.isolation_forest_score).toFixed(1)}, ${row.action}).`
        : data.reviewStatus === 'true_positive'
          ? `An administrator confirmed this sign-in was correctly flagged (risk score ${
            Number(row.isolation_forest_score).toFixed(1)}, ${row.action}).`
          : 'An administrator marked this sign-in as still under review.',
    });

    return res.status(200).json({
      message: 'Review recorded.',
      anomaly: {
        id: row.id,
        reviewStatus: row.review_status,
        reviewNote: row.review_note,
        reviewedAt: row.reviewed_at,
      },
    });
  } catch (err) {
    console.error('reviewAnomaly error:', err);
    return res.status(500).json({ error: 'Could not record the review.' });
  }
}

/**
 * GET /admin/anomalies/review-stats — how much of the queue has been ruled on.
 *
 * The figure that makes the labelled set worth something: a false-positive rate
 * over ten reviewed sign-ins out of four hundred is not a false-positive rate.
 * Reported with the coverage so it cannot be quoted without it.
 */
async function reviewStats(req, res) {
  const range = timeWindow.resolve(req.query);
  try {
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE action IS DISTINCT FROM 'allow')::int AS flagged,
              count(*) FILTER (WHERE review_status IS NOT NULL)::int AS reviewed,
              count(*) FILTER (WHERE review_status = 'true_positive')::int AS true_positive,
              count(*) FILTER (WHERE review_status = 'false_positive')::int AS false_positive,
              count(*) FILTER (WHERE review_status = 'under_review')::int AS under_review
       FROM anomaly_scores
       WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
      [range.from, range.to]
    );
    const r = rows[0];
    const ruled = r.true_positive + r.false_positive;

    return res.status(200).json({
      window: range.window,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      flagged: r.flagged,
      reviewed: r.reviewed,
      truePositive: r.true_positive,
      falsePositive: r.false_positive,
      underReview: r.under_review,
      // null rather than 0 when nothing has been ruled on: a rate computed from
      // no data is not a rate, and rendering it as 0% would read as "no false
      // positives" rather than "nobody has checked".
      falsePositiveRate: ruled > 0 ? Math.round((r.false_positive / ruled) * 1000) / 10 : null,
      reviewCoverage: r.flagged > 0 ? Math.round((r.reviewed / r.flagged) * 1000) / 10 : null,
    });
  } catch (err) {
    console.error('reviewStats error:', err);
    return res.status(500).json({ error: 'Could not load review statistics.' });
  }
}

// ──────────────────────────── GET /admin/accounts ────────────────────────────

const accountsSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(STATUSES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['lastSeen', 'name', 'created', 'events']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

const ACCOUNT_SORTS = {
  lastSeen: 'last_login_at',
  name: 'u.full_name',
  created: 'u.created_at',
  events: 'event_count',
};

/**
 * The accounts on the service.
 *
 * Phone numbers masked, as everywhere else an administrator sees them: telling
 * accounts apart is the need, and a list of every subscriber's number is not.
 *
 * Counted with lateral subqueries rather than joins and GROUP BY. Joining
 * login_events and audit_logs to users and grouping would multiply rows before
 * aggregating — an account with 200 audit rows and 50 sign-ins produces 10,000
 * intermediate rows, and the counts come out wrong unless every aggregate is
 * DISTINCT, which is both slower and easy to get subtly wrong.
 */
async function listAccounts(req, res) {
  const data = parse(accountsSchema, req.query, res);
  if (!data) return;

  const limit = Math.min(Math.max(Number(data.limit) || 50, 1), 200);
  const offset = Math.max(Number(data.offset) || 0, 0);

  const where = [];
  const params = [];
  const add = (sql, ...values) => {
    let i = 0;
    where.push(sql.replace(/\$\?/g, () => { params.push(values[i]); i += 1; return `$${params.length}`; }));
  };

  if (data.role) add('u.role = $?', data.role);
  if (data.status) add('u.account_status = $?', data.status);
  if (data.search) {
    const term = `%${String(data.search).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    // Phone search matches the stored number even though the response masks it:
    // an administrator handed a number by someone reporting a problem has to be
    // able to find the account, and masking the output is about not producing a
    // list of numbers, not about refusing to look one up.
    add('(u.full_name ILIKE $? OR u.phone_number ILIKE $? OR u.email ILIKE $?)', term, term, term);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const column = ACCOUNT_SORTS[data.sort] || ACCOUNT_SORTS.lastSeen;
  const direction = String(data.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name, u.role, u.account_status, u.phone_number, u.email,
              u.phone_verified, u.verification_status, u.created_at, u.locked_until,
              last_login.login_time AS last_login_at,
              last_login.country AS last_login_country,
              last_login.city AS last_login_city,
              COALESCE(activity.event_count, 0)::int AS event_count,
              COALESCE(activity.urgent_count, 0)::int AS urgent_count,
              COALESCE(live.active_sessions, 0)::int AS active_sessions,
              count(*) OVER () AS total
       FROM users u
       LEFT JOIN LATERAL (
         SELECT e.login_time, e.country, e.city
         FROM login_events e
         WHERE e.user_id = u.id AND e.was_successful
         ORDER BY e.login_time DESC LIMIT 1
       ) last_login ON TRUE
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS event_count,
                count(*) FILTER (WHERE a.severity IN ('high', 'critical'))::int AS urgent_count
         FROM audit_logs a WHERE a.user_id = u.id
       ) activity ON TRUE
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS active_sessions
         FROM sessions s
         WHERE s.user_id = u.id AND s.session_status = 'active' AND s.expires_at > NOW()
       ) live ON TRUE
       ${clause}
       ORDER BY ${column} ${direction} NULLS LAST, u.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return res.status(200).json({
      total: rows.length ? Number(rows[0].total) : 0,
      limit,
      offset,
      accounts: rows.map(presentAccount),
    });
  } catch (err) {
    console.error('listAccounts error:', err);
    return res.status(500).json({ error: 'Could not load the accounts.' });
  }
}

function presentAccount(r) {
  const lockedUntil = r.locked_until && new Date(r.locked_until) > new Date() ? r.locked_until : null;
  return {
    id: r.id,
    fullName: r.full_name,
    role: r.role,
    accountStatus: r.account_status,
    phoneNumber: maskPhone(r.phone_number),
    phoneVerified: r.phone_verified,
    verificationStatus: r.verification_status,
    createdAt: r.created_at,
    // Distinct from a freeze: a lock expires on its own, a freeze does not.
    lockedUntil,
    lastLogin: r.last_login_at ? {
      at: r.last_login_at,
      country: r.last_login_country,
      city: r.last_login_city,
    } : null,
    events: r.event_count,
    urgentEvents: r.urgent_count,
    activeSessions: r.active_sessions,
  };
}

// ───────────────────────── GET /admin/accounts/:id ─────────────────────────

/**
 * One account: its standing, its security history, and a risk summary.
 *
 * No clinical data, and no list of the care profiles it owns. Administrators
 * have no access to care records — resourceAccess refuses it explicitly — and
 * an account detail page that listed the elderly people behind an account would
 * hand over through the back door exactly what the authorization layer refuses
 * at the front. What is here is the account's security posture, which is what
 * an administrator is entitled to and needs.
 */
async function getAccount(req, res) {
  const id = req.params.id;
  if (!uuidParam(id)) return res.status(404).json({ error: 'Account not found.' });

  try {
    const [account, risk, sessions, recent, devices] = await Promise.all([
      pool.query(
        `SELECT u.id, u.full_name, u.role, u.account_status, u.phone_number, u.email,
                u.backup_email, u.phone_verified, u.verification_status, u.consent_at,
                u.created_at, u.updated_at, u.locked_until,
                last_login.login_time AS last_login_at,
                last_login.country AS last_login_country,
                last_login.city AS last_login_city,
                COALESCE(activity.event_count, 0)::int AS event_count,
                COALESCE(activity.urgent_count, 0)::int AS urgent_count,
                0::int AS active_sessions
         FROM users u
         LEFT JOIN LATERAL (
           SELECT e.login_time, e.country, e.city FROM login_events e
           WHERE e.user_id = u.id AND e.was_successful
           ORDER BY e.login_time DESC LIMIT 1
         ) last_login ON TRUE
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS event_count,
                  count(*) FILTER (WHERE a.severity IN ('high','critical'))::int AS urgent_count
           FROM audit_logs a WHERE a.user_id = u.id
         ) activity ON TRUE
         WHERE u.id = $1::uuid`, [id]),

      // The risk summary: what the model has made of this account over 90 days.
      pool.query(
        `SELECT count(*)::int AS scored,
                count(*) FILTER (WHERE s.action = 'block')::int AS blocked,
                count(*) FILTER (WHERE s.action = 'step_up')::int AS stepped_up,
                count(*) FILTER (WHERE s.review_status = 'false_positive')::int AS false_positives,
                count(*) FILTER (WHERE s.review_status = 'true_positive')::int AS true_positives,
                round(avg(s.isolation_forest_score)::numeric, 1)::float AS avg_score,
                round(max(s.isolation_forest_score)::numeric, 1)::float AS max_score,
                count(DISTINCT e.country) FILTER (WHERE e.country IS NOT NULL)::int AS countries,
                count(*) FILTER (WHERE NOT e.was_successful)::int AS failed_attempts
         FROM anomaly_scores s
         JOIN login_events e ON e.id = s.login_event_id
         WHERE e.user_id = $1::uuid AND s.created_at >= NOW() - INTERVAL '90 days'`, [id]),

      pool.query(
        `SELECT s.id, s.session_status, s.device_fingerprint, s.ip_address, s.last_seen_ip,
                s.created_at, s.last_seen_at, s.expires_at, s.risk_score,
                s.flagged_reason, s.flagged_at
         FROM sessions s
         WHERE s.user_id = $1::uuid
         ORDER BY COALESCE(s.last_seen_at, s.created_at) DESC LIMIT 10`, [id]),

      pool.query(
        `SELECT a.id, a.event_type, a.severity, a.explanation, a.event_detail, a.logged_at,
                a.action, a.decision, a.actor_type, a.resource_type, a.resource_id,
                a.ip_address, a.session_id, a.user_id,
                u.full_name AS actor_name, u.role AS actor_role
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.user_id = $1::uuid OR a.resource_id = $1::uuid
         ORDER BY a.logged_at DESC LIMIT 25`, [id]),

      pool.query(
        `SELECT id, device_label, trusted_at, last_seen_at
         FROM trusted_devices WHERE user_id = $1::uuid ORDER BY last_seen_at DESC`, [id]),
    ]);

    if (!account.rows.length) return res.status(404).json({ error: 'Account not found.' });

    // Liveness for the listed sessions, the same way the session list does it.
    const ids = sessions.rows.filter((s) => s.session_status === 'active').map((s) => s.id);
    let cached = new Set();
    try {
      if (ids.length) {
        const pipeline = redis.multi();
        ids.forEach((sid) => pipeline.exists(`session:${sid}`));
        const results = await pipeline.exec();
        results.forEach(([err, value], i) => { if (!err && value) cached.add(ids[i]); });
      }
    } catch (err) {
      console.error('Redis session liveness unavailable:', err.message);
      cached = null;
    }

    const r = risk.rows[0];
    await audit.logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'admin_data_viewed',
      severity: 'medium', resourceType: 'account', resourceId: id, action: 'read',
      decision: 'allow', actorType: 'administrator', ip: req.ip,
      detail: { view: 'account_detail' },
    });

    return res.status(200).json({
      account: {
        ...presentAccount({ ...account.rows[0], active_sessions: 0 }),
        // The unmasked contact fields an administrator genuinely needs for the
        // one account they are investigating, which is a different question
        // from whether the list should contain every number.
        email: account.rows[0].email,
        backupEmail: account.rows[0].backup_email,
        consentAt: account.rows[0].consent_at,
        updatedAt: account.rows[0].updated_at,
        activeSessions: sessions.rows.filter(
          (s) => s.session_status === 'active' && new Date(s.expires_at) > new Date()).length,
      },
      riskSummary: {
        periodDays: 90,
        scored: r.scored,
        blocked: r.blocked,
        steppedUp: r.stepped_up,
        falsePositives: r.false_positives,
        truePositives: r.true_positives,
        averageScore: r.avg_score,
        highestScore: r.max_score,
        countriesSeen: r.countries,
        failedAttempts: r.failed_attempts,
      },
      sessions: sessions.rows.map((s) => ({
        id: s.id,
        status: s.session_status === 'active' && new Date(s.expires_at) <= new Date()
          ? 'expired' : s.session_status,
        device: { fingerprint: s.device_fingerprint, ip: s.ip_address, lastSeenIp: s.last_seen_ip },
        startedAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        expiresAt: s.expires_at,
        riskScore: s.risk_score === null ? null : Number(s.risk_score),
        ...(s.flagged_reason && { flagged: { reason: s.flagged_reason, at: s.flagged_at } }),
        cache: cached === null
          ? { cached: null }
          : { cached: cached.has(s.id) },
      })),
      trustedDevices: devices.rows.map((d) => ({
        id: d.id, label: d.device_label, trustedAt: d.trusted_at, lastSeenAt: d.last_seen_at,
      })),
      /*
       * presentEvent copies the stored explanation through as-is. Most routine
       * events were written without one, because there was nothing to explain
       * at the time, so the generated fallback has to be applied here — the
       * audit trail endpoint gets it from audit.query(), which this does not go
       * through. Without it the history shows a column of blanks next to the
       * interesting rows, which is the one thing this view must not do.
       */
      history: recent.rows.map((row) => ({
        ...audit.presentEvent(row),
        explanation: explanation.forEvent(row),
        layer: layers.forEvent(row.event_type),
      })),
    });
  } catch (err) {
    console.error('getAccount error:', err);
    return res.status(500).json({ error: 'Could not load the account.' });
  }
}

// ───────────────────── POST /admin/accounts/:id/lock ─────────────────────

const lockSchema = z.object({
  reason: z.string().trim().min(5).max(255),
  minutes: z.coerce.number().int().min(5).max(1440).optional(),
}).strict();

/**
 * Lock an account temporarily.
 *
 * The middle option between doing nothing and freezing. A freeze is indefinite
 * and needs an administrator to undo it; a lock expires on its own, which is
 * the right response to "this looks wrong but I am not sure and I cannot reach
 * the owner at 2am". It reuses the lockout the OTP path already applies after
 * repeated wrong codes, so the sign-in flow needs no new case: the account
 * answers 423 with a retry-after until it clears.
 *
 * Existing sessions are deliberately left alone. A lock prevents new sign-ins;
 * ending live sessions as well is what a freeze is for, and conflating the two
 * would remove the reason to have both.
 */
async function lockAccount(req, res) {
  const data = parse(lockSchema, req.body, res);
  if (!data) return;
  const id = req.params.id;
  if (!uuidParam(id)) return res.status(404).json({ error: 'Account not found.' });

  const minutes = data.minutes || 30;

  try {
    if (id === req.user.id) {
      return res.status(400).json({
        error: 'You cannot lock your own account.', code: 'CANNOT_ACT_ON_SELF',
      });
    }

    const { rows } = await pool.query(
      `UPDATE users SET locked_until = NOW() + make_interval(mins => $2::int), updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, role, account_status, locked_until`,
      [id, minutes]
    );
    if (!rows.length) return res.status(404).json({ error: 'Account not found.' });

    await audit.logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'account_locked',
      severity: 'high', resourceType: 'account', resourceId: id, action: 'lock',
      decision: 'allow', actorType: 'administrator', ip: req.ip,
      detail: { reason: data.reason, minutes, until: rows[0].locked_until },
      explanation: `An administrator locked the account for ${minutes} minutes: ${data.reason}`,
    });

    return res.status(200).json({
      message: `Account locked for ${minutes} minutes.`,
      account: { id, lockedUntil: rows[0].locked_until },
    });
  } catch (err) {
    console.error('lockAccount error:', err);
    return res.status(500).json({ error: 'Could not lock the account.' });
  }
}

// ───────────────── POST /admin/accounts/:id/require-step-up ─────────────────

const stepUpSchema = z.object({
  reason: z.string().trim().min(5).max(255),
}).strict();

/**
 * Require extra verification on this account's next sign-in.
 *
 * Implemented by untrusting its devices, which is what "step up next time"
 * actually means in this service: the risk engine challenges a sign-in from a
 * device it does not recognise, so removing the trust marks is enough and
 * needs no new flag for the login path to check. A separate
 * `force_step_up` column would be a second mechanism doing the same job, with
 * its own chance of disagreeing with the first.
 *
 * Useful when an account holder reports a lost phone: their sessions can be
 * left running while the next sign-in from anywhere has to prove itself.
 */
async function requireStepUp(req, res) {
  const data = parse(stepUpSchema, req.body, res);
  if (!data) return;
  const id = req.params.id;
  if (!uuidParam(id)) return res.status(404).json({ error: 'Account not found.' });

  try {
    const { rows: exists } = await pool.query('SELECT id FROM users WHERE id = $1::uuid', [id]);
    if (!exists.length) return res.status(404).json({ error: 'Account not found.' });

    const { rowCount } = await pool.query(
      'DELETE FROM trusted_devices WHERE user_id = $1::uuid', [id]);

    await audit.logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'step_up_required_by_admin',
      severity: 'medium', resourceType: 'account', resourceId: id, action: 'require_step_up',
      decision: 'allow', actorType: 'administrator', ip: req.ip,
      detail: { reason: data.reason, devicesUntrusted: rowCount },
      explanation: `An administrator removed ${rowCount} trusted device(s), so this account's `
        + `next sign-in from any device will need extra verification: ${data.reason}`,
    });

    return res.status(200).json({
      message: rowCount
        ? `Removed ${rowCount} trusted device(s). The next sign-in will need extra verification.`
        : 'This account had no trusted devices, so its next sign-in already needs extra verification.',
      devicesUntrusted: rowCount,
    });
  } catch (err) {
    console.error('requireStepUp error:', err);
    return res.status(500).json({ error: 'Could not require extra verification.' });
  }
}

module.exports = {
  reviewAnomaly, reviewStats, listAccounts, getAccount, lockAccount, requireStepUp,
};
