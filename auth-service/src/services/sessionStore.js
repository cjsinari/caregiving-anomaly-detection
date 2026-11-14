const crypto = require('crypto');
const pool = require('../config/db');
const redis = require('../config/redis');
const {
  sha256, newRefreshToken, signAccessToken, accessTtlSeconds, refreshTtlSeconds,
} = require('../utils/tokens');

// Documented rule: a user has at most one active session at a time
// Set SINGLE_ACTIVE_SESSION=false to allow e.g. phone + web simultaneously
const SINGLE_ACTIVE_SESSION = process.env.SINGLE_ACTIVE_SESSION !== 'false';

/*
 * PostgreSQL (sessions table) is the source of truth.
 * Redis is a fast cache for "is this session / refresh token still valid?" and is
 * what makes logout take effect immediately. If Redis is down or was flushed,
 * every function falls back to PostgreSQL (NFR11).
 */

async function cacheSession(sessionId, userId, refreshHash, ttlSeconds) {
  try {
    await redis
      .multi()
      .set(`session:${sessionId}`, userId, 'EX', ttlSeconds)
      .set(`refresh:${refreshHash}`, sessionId, 'EX', ttlSeconds)
      .exec();
  } catch (err) {
    console.error('Redis cache write failed (continuing, DB is source of truth):', err.message);
  }
}

async function dropFromCache(sessionId, refreshHash) {
  try {
    const multi = redis.multi().del(`session:${sessionId}`);
    if (refreshHash) multi.del(`refresh:${refreshHash}`);
    await multi.exec();
  } catch (err) {
    console.error('Redis revoke failed (DB already updated):', err.message);
  }
}

async function revoke(sessionId) {
  const { rows } = await pool.query(
    `UPDATE sessions SET session_status = 'invalidated'
     WHERE id = $1 AND session_status = 'active' RETURNING refresh_token`,
    [sessionId]
  );
  await dropFromCache(sessionId, rows[0]?.refresh_token);
  return rows.length > 0;
}

/**
 * End a session because of an anomaly. Distinct from 'invalidated' (logout) so
 * the dashboard can tell the two apart. Returns true only for the caller that
 * actually flipped it, so concurrent detections alert once.
 */
async function flag(sessionId, reason) {
  const { rows } = await pool.query(
    `UPDATE sessions SET session_status = 'flagged', flagged_reason = $2, flagged_at = NOW()
     WHERE id = $1 AND session_status = 'active' RETURNING refresh_token`,
    [sessionId, String(reason).slice(0, 50)]
  );
  await dropFromCache(sessionId, rows[0]?.refresh_token);
  return rows.length > 0;
}

async function revokeAllForUser(userId) {
  const { rows } = await pool.query(
    `UPDATE sessions SET session_status = 'invalidated'
     WHERE user_id = $1 AND session_status = 'active' RETURNING id, refresh_token`,
    [userId]
  );
  if (rows.length) {
    try {
      const multi = redis.multi();
      rows.forEach((r) => multi.del(`session:${r.id}`).del(`refresh:${r.refresh_token}`));
      await multi.exec();
    } catch (err) {
      console.error('Redis revoke failed (DB already updated):', err.message);
    }
  }
  return rows.length;
}

/**
 * End every session on the account except one.
 *
 * Used when the account's sign-in credential changes underneath it -- today,
 * the phone number. The session that made the change has just proved itself
 * twice over, so it stays; every other one was established against the old
 * number and is ended, so a phone that was signed in by whoever held that
 * number does not stay signed in after it has stopped being the account's.
 */
async function revokeOthersForUser(userId, keepSessionId) {
  const { rows } = await pool.query(
    `UPDATE sessions SET session_status = 'invalidated'
     WHERE user_id = $1 AND session_status = 'active' AND id <> $2::uuid
     RETURNING id, refresh_token`,
    [userId, keepSessionId]
  );
  if (rows.length) {
    try {
      const multi = redis.multi();
      rows.forEach((r) => multi.del(`session:${r.id}`).del(`refresh:${r.refresh_token}`));
      await multi.exec();
    } catch (err) {
      console.error('Redis revoke failed (DB already updated):', err.message);
    }
  }
  return rows.map((r) => r.id);
}

/** Create a session and return the tokens for the client */
async function issue(user, { ip = null, deviceFingerprint = null, riskScore = 0 } = {}) {
  if (SINGLE_ACTIVE_SESSION) await revokeAllForUser(user.id);

  const sessionId = crypto.randomUUID();
  const refreshToken = newRefreshToken();
  const refreshHash = sha256(refreshToken);
  const ttl = refreshTtlSeconds();

  await pool.query(
    `INSERT INTO sessions
       (id, user_id, user_role, refresh_token, risk_score, device_fingerprint, ip_address, session_status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW() + make_interval(secs => $8::int))`,
    [sessionId, user.id, user.role, refreshHash, riskScore, deviceFingerprint,
     ip ? String(ip).slice(0, 45) : null, ttl]
  );
  await cacheSession(sessionId, user.id, refreshHash, ttl);

  return {
    sessionId,
    accessToken: signAccessToken(user, sessionId),
    refreshToken,
    expiresIn: accessTtlSeconds(),
  };
}

/** Is this session still valid? Redis fast path, use PostgreSQL fallback */
async function isActive(sessionId) {
  try {
    if (await redis.exists(`session:${sessionId}`)) return true;
  } catch (err) {
    console.error('Redis unavailable, checking PostgreSQL:', err.message);
  }
  const { rows } = await pool.query(
    `SELECT user_id, refresh_token,
            GREATEST(EXTRACT(EPOCH FROM (expires_at - NOW()))::int, 1) AS ttl
     FROM sessions
     WHERE id = $1 AND session_status = 'active' AND expires_at > NOW()`,
    [sessionId]
  );
  if (!rows.length) return false;
  await cacheSession(sessionId, rows[0].user_id, rows[0].refresh_token, rows[0].ttl); // repopulate after a flush
  return true;
}

/** Find the active session that owns this refresh-token hash */
async function findByRefreshHash(hash) {
  let sessionId = null;
  try {
    sessionId = await redis.get(`refresh:${hash}`);
  } catch (err) {
    console.error('Redis unavailable, checking PostgreSQL:', err.message);
  }
  // The DB query below also confirms the hash is the CURRENT one (guards against a stale cache entry)
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.device_fingerprint, s.ip_address,
            COALESCE(s.last_seen_ip, s.ip_address) AS ref_ip,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(s.last_seen_at, s.created_at)))::float AS ref_age_seconds,
            u.id, u.role, u.account_status, u.full_name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.refresh_token = $1 AND s.session_status = 'active' AND s.expires_at > NOW()
       AND ($2::uuid IS NULL OR s.id = $2::uuid)`,
    [hash, sessionId]
  );
  return rows[0] || null;
}

/**
 * Rotate the refresh token. Compare and swap: only one concurrent caller wins.
 *
 * seenIp is the client address, passed only when it geolocates: it becomes the
 * session's reference point for the next impossible-travel check. An
 * unresolvable address leaves the old reference (and its timestamp) in place,
 * since advancing the time without a position would shrink the elapsed time of
 * the next comparison and inflate the computed speed.
 */
async function rotateRefresh(sessionId, oldHash, newHash, seenIp = null) {
  const { rows } = await pool.query(
    `UPDATE sessions SET refresh_token = $1,
       last_seen_ip = COALESCE($4, last_seen_ip),
       last_seen_at = CASE WHEN $4::varchar IS NULL THEN last_seen_at ELSE NOW() END
     WHERE id = $2 AND refresh_token = $3 AND session_status = 'active'
     RETURNING GREATEST(EXTRACT(EPOCH FROM (expires_at - NOW()))::int, 1) AS ttl`,
    [newHash, sessionId, oldHash, seenIp ? String(seenIp).slice(0, 45) : null]
  );
  if (!rows.length) return false;
  try {
    await redis
      .multi()
      .del(`refresh:${oldHash}`)
      .set(`refresh:${newHash}`, sessionId, 'EX', rows[0].ttl)
      .exec();
  } catch (err) {
    console.error('Redis rotate failed (DB already updated):', err.message);
  }
  return true;
}

module.exports = { issue, isActive, findByRefreshHash, rotateRefresh, revoke, revokeAllForUser,
  revokeOthersForUser, flag };
