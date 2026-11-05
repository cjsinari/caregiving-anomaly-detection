const redis = require('../config/redis');
const pool = require('../config/db');

const WINDOW_SECONDS = 3600;   // rolling 60-minute window, matching training

/**
 * Count this user's login attempts in the last hour, including the current one.
 *
 * Uses a Redis sorted set so the window genuinely rolls, rather than resetting on
 * a fixed boundary the way a plain counter with EXPIRE would. Falls back to
 * PostgreSQL if Redis is unavailable
 */
async function recordAndCount(userId) {
  const now = Date.now();
  const key = `velocity:${userId}`;

  try {
    const [, , count] = await redis
      .multi()
      .zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`)
      .zremrangebyscore(key, 0, now - WINDOW_SECONDS * 1000)
      .zcard(key)
      .expire(key, WINDOW_SECONDS)
      .exec()
      .then((res) => res.map((r) => r[1]));
    return Number(count) || 1;
  } catch (err) {
    console.error('Redis velocity unavailable, counting from PostgreSQL:', err.message);
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int + 1 AS n FROM login_events
         WHERE user_id = $1 AND login_time > NOW() - make_interval(secs => $2::int)`,
        [userId, WINDOW_SECONDS]
      );
      return rows[0].n;
    } catch (dbErr) {
      console.error('Velocity fallback failed:', dbErr.message);
      return 1;   // neutral value rather than blocking the login
    }
  }
}

/**
 * Add an attempt to the window without reading the count back.
 *
 * Training counted ALL login attempts in the hour, failed ones included, but
 * featureExtractor only runs after the OTP has passed. Without this the Redis
 * path would count successes only while the PostgreSQL fallback counted every
 * attempt, so the two paths would disagree for the same login.
 */
async function recordOnly(userId) {
  const now = Date.now();
  const key = `velocity:${userId}`;
  try {
    await redis
      .multi()
      .zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`)
      .zremrangebyscore(key, 0, now - WINDOW_SECONDS * 1000)
      .expire(key, WINDOW_SECONDS)
      .exec();
  } catch (err) {
    console.error('Redis velocity write failed:', err.message);   // best effort
  }
}

module.exports = { recordAndCount, recordOnly };
