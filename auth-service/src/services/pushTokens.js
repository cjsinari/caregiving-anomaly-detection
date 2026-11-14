const pool = require('../config/db');

/*
 * Where the platform may push to.
 *
 * Issue #46 asks the app to register its push token and send it here. Nothing
 * sends pushes yet -- the care module that will produce visit and incident
 * notifications does not exist -- so this is the half of the contract that
 * can be built now: the addresses, kept honestly.
 *
 * ── A token belongs to a session, not just to a user ──
 *
 * The thing that goes wrong with push tokens is that they outlive the reason
 * they were registered. A family member signs out of a shared tablet; a
 * caregiver's session is flagged by the risk engine and ended; a phone is
 * sold. In each case a token bound only to the user keeps delivering one
 * person's care alerts -- "Margaret slipped getting out of her chair" -- to a
 * device that is no longer theirs.
 *
 * So every token carries the session it was registered under, and
 * `activeForUser` -- the only function a sender should ever read from --
 * joins on that session still being active. Logout revokes the session's
 * tokens outright; any other way a session ends (an administrator, the risk
 * engine, a phone-number change, expiry) stops delivery through the join even
 * if nothing remembered to revoke the token.
 *
 * ── A token is a device, not a person ──
 *
 * When a token that is already registered arrives under a different account,
 * the old row is revoked and a new one written. Two live rows for one handset
 * would mean two accounts' alerts arriving on one phone.
 */

const PROVIDERS = ['expo', 'fcm', 'apns'];
const PLATFORMS = ['ios', 'android'];

/** Register (or refresh) a token for this user and session. */
async function register({ userId, sessionId, token, provider, platform }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Whoever held this token before -- another account, or this account
    // under an older session -- no longer does.
    await client.query(
      `UPDATE push_tokens SET revoked_at = NOW()
       WHERE token = $1 AND revoked_at IS NULL
         AND (user_id <> $2::uuid OR session_id IS DISTINCT FROM $3::uuid)`,
      [token, userId, sessionId]
    );

    const { rows } = await client.query(
      `INSERT INTO push_tokens (user_id, session_id, token, provider, platform)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (token) WHERE revoked_at IS NULL
       DO UPDATE SET last_seen_at = NOW()
       RETURNING id, created_at, last_seen_at`,
      [userId, sessionId, token, provider, platform]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Stop pushing to one token, if it is this user's. */
async function unregister({ userId, token }) {
  const { rowCount } = await pool.query(
    `UPDATE push_tokens SET revoked_at = NOW()
     WHERE token = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [token, userId]
  );
  return rowCount > 0;
}

/** Revoke every token registered under a session. Called on logout. */
async function revokeForSession(sessionId) {
  const { rowCount } = await pool.query(
    `UPDATE push_tokens SET revoked_at = NOW()
     WHERE session_id = $1 AND revoked_at IS NULL`,
    [sessionId]
  );
  return rowCount;
}

/**
 * The tokens a sender may use for a user: live, and registered under a
 * session that is still active. Any future push sender reads from here and
 * nowhere else.
 */
async function activeForUser(userId) {
  const { rows } = await pool.query(
    `SELECT t.token, t.provider, t.platform
     FROM push_tokens t
     JOIN sessions s ON s.id = t.session_id
     WHERE t.user_id = $1 AND t.revoked_at IS NULL
       AND s.session_status = 'active' AND s.expires_at > NOW()`,
    [userId]
  );
  return rows;
}

module.exports = { register, unregister, revokeForSession, activeForUser, PROVIDERS, PLATFORMS };
