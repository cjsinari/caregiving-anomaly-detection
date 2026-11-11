const { z } = require('zod');
const pool = require('../config/db');
const { parse } = require('../utils/validate');
const audit = require('../utils/audit');
const { maskPhone } = require('../services/notifier');

/*
 * Reading the audit trail. Authorized administrators only.
 *
 * The trail is investigative material, not a user-facing activity feed. It
 * carries model features, velocity limits, internal classifications and the
 * reasons access was refused — which, handed to the holder of a stolen session,
 * is a map of exactly which thresholds the detectors watch and which ones that
 * session has already crossed. Account holders are told about activity on their
 * account through the security notifications, which say what happened without
 * saying how it was caught.
 *
 * Reading it is itself a privileged act, so every query is recorded with the
 * filters it used. An administrator cannot inspect an account's history without
 * that inspection being part of the history.
 */

const timestamp = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)),
  'Use an ISO date or date-time');

const querySchema = z.object({
  userId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  eventType: z.string().max(50).optional(),
  severity: z.enum(['info', 'medium', 'high', 'critical']).optional(),
  decision: z.enum(['allow', 'deny']).optional(),
  actorType: z.enum(['user', 'administrator', 'automated', 'system']).optional(),
  resourceType: z.string().max(40).optional(),
  resourceId: z.string().uuid().optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(audit.MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

/** GET /audit — filtered, paginated, administrators only */
async function listAuditTrail(req, res) {
  const data = parse(querySchema, req.query, res);
  if (!data) return;

  try {
    const page = await audit.query(data);
    const events = page.rows.map(audit.presentEvent);

    await audit.logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'audit_viewed',
      severity: 'medium', resourceType: 'audit_trail', resourceId: data.userId || null,
      action: 'read', decision: 'allow', actorType: 'administrator', ip: req.ip,
      detail: { targetUserId: data.userId || 'all', rows: events.length, filters: data },
    });

    return res.status(200).json({
      total: page.total, limit: page.limit, offset: page.offset, events,
    });
  } catch (err) {
    console.error('listAuditTrail error:', err);
    return res.status(500).json({ error: 'Could not load the audit trail.' });
  }
}

/**
 * GET /audit/accounts — the accounts an administrator can filter the trail by.
 * Phone numbers are masked: an administrator verifying caregivers needs to tell
 * accounts apart, not to hold a list of every subscriber's number.
 */
async function listAccounts(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name, u.role, u.account_status, u.phone_number,
              count(a.id)::int AS events,
              max(a.logged_at) AS last_event_at
       FROM users u LEFT JOIN audit_logs a ON a.user_id = u.id
       GROUP BY u.id ORDER BY max(a.logged_at) DESC NULLS LAST LIMIT 200`
    );
    return res.status(200).json({
      accounts: rows.map((r) => ({
        id: r.id, fullName: r.full_name, role: r.role, accountStatus: r.account_status,
        phoneNumber: maskPhone(r.phone_number), events: r.events, lastEventAt: r.last_event_at,
      })),
    });
  } catch (err) {
    console.error('listAccounts error:', err);
    return res.status(500).json({ error: 'Could not load accounts.' });
  }
}

module.exports = { listAuditTrail, listAccounts };
