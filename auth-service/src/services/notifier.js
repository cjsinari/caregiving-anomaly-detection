const pool = require('../config/db');
const redis = require('../config/redis');
const { sendSecurityAlert } = require('../utils/sms');

/*
 * Security notifications.
 *
 * The account owner is told about suspicious activity on their account.
 * Administrators are also told about events at ADMIN_ALERT_SEVERITIES (default:
 * critical only), so they hear about frozen accounts and hijacked sessions
 * without being texted every time someone signs in over a VPN.
 *
 * Every notification is written to the recipient's in-app inbox (notifications
 * table) together with the SMS outcome. A per-event cooldown stops a burst of
 * activity producing fifty texts; the inbox still records every occurrence.
 *
 * notify() never throws and callers do not await it: delivery must not hold up
 * or break the request that triggered it (NFR10).
 *
 * What messages may contain:
 *  - No user-supplied text (e.g. device labels): whoever passed a step-up
 *    controls it and could use it to send phishing under the MzaziCare name.
 *  - No authentication material (codes, tokens, session IDs).
 *  - Admin alerts identify the account only by a masked phone number; the full
 *    record is in the audit log, behind admin authentication, not in an SMS.
 */
const DEV_MODE = process.env.OTP_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
const DEFAULT_COOLDOWN = Number(process.env.NOTIFY_COOLDOWN_SECONDS) || 900;
const ADMIN_SEVERITIES = (process.env.ADMIN_ALERT_SEVERITIES || 'critical')
  .split(',').map((s) => s.trim()).filter(Boolean);
const SUPPORT = 'If this was not you, contact MzaziCare support.';

const TEMPLATES = {
  login_blocked: {
    severity: 'critical', cooldown: 0,   // always sent: the account has just been frozen
    text: (v) => `MzaziCare: we blocked a sign-in to your account and locked it as a precaution. ` +
      `${v.explanation || ''} If this was you, contact support to restore access.`.replace(/\s+/g, ' '),
    admin: () => 'high-risk sign-in blocked and account frozen',
  },
  session_flagged_geo: {
    severity: 'critical',
    text: (v) => `MzaziCare: we signed you out because your session was used from ${v.to} shortly ` +
      `after ${v.from}. Please sign in again. ${SUPPORT}`,
    admin: (v) => `session ended for impossible travel (${v.from} -> ${v.to})`,
  },
  session_flagged_api_velocity: {
    severity: 'critical',
    text: () => `MzaziCare: we signed you out because your session made an unusually high number of ` +
      `requests. Please sign in again. ${SUPPORT}`,
    admin: () => 'session ended for high API request velocity',
  },
  impossible_travel_login: {
    severity: 'high',
    text: (v) => `MzaziCare: a sign-in attempt from ${v.to} needed extra verification because it was ` +
      `too far from where you were last signed in (${v.from}). ${SUPPORT}`,
    admin: (v) => `sign-in challenged for impossible travel (${v.from} -> ${v.to})`,
  },
  new_device_trusted: {
    severity: 'medium',
    text: () => `MzaziCare: a new device was verified and added to your account. ${SUPPORT} ` +
      `You can remove devices in your account settings.`,
    admin: () => 'new device trusted',
  },
  /*
   * Sent to the number the account USED to have, never to the new one.
   *
   * Whoever made the change already knows about it. The person who needs this
   * message is the one who did not make it -- an owner whose session was
   * taken -- and the only number that still reaches them is the old one.
   * deliver() honours `sendTo` for exactly this case.
   */
  phone_changed: {
    severity: 'medium', cooldown: 0,
    // The new number is masked: the old number may have been recycled to a
    // stranger, who has no business learning the account's new one.
    text: (v) => `MzaziCare: the phone number on your account was changed to ${v.newNumber}. ${SUPPORT}`,
    admin: () => 'account phone number changed',
  },
  account_frozen: {
    severity: 'high', cooldown: 0,   // always sent: the account has just lost access
    text: () => `MzaziCare: your account has been locked by our security team and you have been ` +
      `signed out. Contact MzaziCare support to restore access.`,
    admin: () => 'account frozen by an administrator',
  },
  account_restored: {
    severity: 'medium', cooldown: 0,
    text: () => `MzaziCare: access to your account has been restored. You can sign in again. ${SUPPORT}`,
    admin: () => 'account access restored by an administrator',
  },
  otp_lockout: {
    severity: 'medium',
    text: (v) => `MzaziCare: your account was locked for ${v.minutes || 15} minutes after several ` +
      `incorrect verification codes. If you did not try to sign in, someone may be trying to access it.`,
    admin: () => 'account locked after repeated incorrect codes',
  },
  /*
   * Always sent, and never throttled.
   *
   * Someone has just regained access to this account without using the phone
   * it signs in with, which is both the legitimate purpose of recovery and the
   * shape of a takeover. If it was not the owner, this message is the only
   * chance they have to notice.
   */
  account_recovered: {
    severity: 'high', cooldown: 0,
    text: (v) => `MzaziCare: access to your account was restored using a code sent to your ` +
      `registered ${v.channel || 'contact'}. ${SUPPORT}`,
    admin: (v) => `account access recovered via ${v.channel || 'a registered contact'}`,
  },
};

/*
 * Transport: how an SMS actually leaves. Returns a delivery status, or throws.
 * Swappable so delivery failures can be tested, and so another channel can be
 * added without touching the callers.
 */
const smsTransport = async (phone, message) => { await sendSecurityAlert(phone, message); return 'sent'; };
const devTransport = async (phone, message, eventType) => {
  console.log(`[DEV] Security SMS to ${phone} (${eventType}): ${message}`);
  return 'dev_logged';
};
const defaultTransport = DEV_MODE ? devTransport : smsTransport;
let transport = defaultTransport;

/** Replace the transport (tests). Call with no argument to restore the default. */
function setTransport(fn) { transport = fn || defaultTransport; }

/** +254712345678 -> +2547****5678 */
function maskPhone(phone) {
  if (!phone || phone.length < 8) return 'an account';
  return `${phone.slice(0, 5)}${'*'.repeat(Math.max(phone.length - 9, 2))}${phone.slice(-4)}`;
}

/** true = go ahead and send. Redis down → send anyway: over-alerting beats silence. */
async function claimCooldown(key, seconds) {
  if (!seconds) return true;
  try {
    return (await redis.set(`notify:${key}`, '1', 'EX', seconds, 'NX')) === 'OK';
  } catch (err) {
    console.error('Notification cooldown unavailable (sending anyway):', err.message);
    return true;
  }
}

/** Deliver one message to one recipient and record it. Returns the delivery status. */
async function sendOne({ recipientId, phone, eventType, severity, message, cooldownKey, cooldown, subjectUserId }) {
  let status;
  let error = null;
  if (!phone) {
    status = 'skipped';
  } else if (!(await claimCooldown(cooldownKey, cooldown))) {
    status = 'suppressed';
  } else {
    try {
      status = (await transport(phone, message, eventType)) || 'sent';
    } catch (err) {
      status = 'failed';
      error = String(err?.message || err).slice(0, 255);
      console.error(`Security SMS (${eventType}) failed:`, error);
    }
  }

  await pool.query(
    `INSERT INTO notifications
       (user_id, subject_user_id, event_type, severity, message, channel, delivery_status, delivery_error)
     VALUES ($1, $2, $3, $4, $5, 'sms', $6, $7)`,
    [recipientId, subjectUserId, eventType, severity, message, status, error]
  );
  return status;
}

async function deliver(userId, eventType, vars) {
  const template = TEMPLATES[eventType];
  if (!template) throw new Error(`Unknown notification type: ${eventType}`);
  const cooldown = template.cooldown ?? DEFAULT_COOLDOWN;

  const { rows } = await pool.query('SELECT phone_number FROM users WHERE id = $1', [userId]);
  // `sendTo` overrides the account's current number for the one message that
  // must reach a number the account no longer has (phone_changed).
  const phone = vars.sendTo || rows[0]?.phone_number;

  const result = {
    user: await sendOne({
      recipientId: userId, subjectUserId: userId, phone, eventType, severity: template.severity,
      message: template.text(vars), cooldownKey: `${userId}:${eventType}`, cooldown,
    }),
    admins: [],
  };

  if (ADMIN_SEVERITIES.includes(template.severity)) {
    const { rows: admins } = await pool.query(
      `SELECT id, phone_number FROM users
       WHERE role = 'administrator' AND account_status = 'active' AND phone_verified = TRUE AND id <> $1`,
      [userId]
    );
    const message = `MzaziCare admin alert [${template.severity}]: ${template.admin(vars)} on account ` +
      `${maskPhone(phone)}. Review the audit log for details.`;
    for (const admin of admins) {
      result.admins.push(await sendOne({
        recipientId: admin.id, subjectUserId: userId, phone: admin.phone_number,
        eventType: `admin:${eventType}`, severity: template.severity, message,
        cooldownKey: `${admin.id}:${eventType}:${userId}`, cooldown,
      }));
    }
  }
  return result;
}

/** Fire-and-forget. Resolves to the delivery statuses (used by tests); never rejects. */
function notify(userId, eventType, vars = {}) {
  return deliver(userId, eventType, vars).catch((err) => {
    console.error(`Notification ${eventType} failed:`, err.message);
    return { user: 'error', admins: [] };
  });
}

async function list(userId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, event_type, severity, message, created_at, read_at
     FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function markAllRead(userId) {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return rowCount;
}

module.exports = { notify, list, markAllRead, setTransport, maskPhone, TEMPLATES };
