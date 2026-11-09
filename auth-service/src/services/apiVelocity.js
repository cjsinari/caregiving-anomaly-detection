const redis = require('../config/redis');

/*
 * API velocity: authenticated requests over a rolling window, tracked per
 * session AND per user.
 *
 * SOFT: above this the request is refused with 429. A real client backs off.
 * HARD: a client that keeps going well past the soft limit is ignoring 429s,
 *       which is how scripted abuse with a stolen token behaves (e.g. bulk-reading
 *       elderly profiles). The session is flagged and revoked.
 *
 * The user window catches the same abuse spread across several sessions, which
 * the per-session window alone would miss. Its limits are higher because one
 * person can legitimately have more than one session (SINGLE_ACTIVE_SESSION=false).
 *
 * Throttled requests still count toward HARD; that is the point of the gap.
 */
const num = (name, fallback) => Number(process.env[name]) || fallback;

const WINDOW_SECONDS = num('API_VELOCITY_WINDOW_SECONDS', 60);
const SESSION_SOFT = num('API_VELOCITY_SOFT', 60);
const SESSION_HARD = Math.max(num('API_VELOCITY_HARD', 150), SESSION_SOFT + 1);
const USER_SOFT = num('API_VELOCITY_USER_SOFT', 120);
const USER_HARD = Math.max(num('API_VELOCITY_USER_HARD', 300), USER_SOFT + 1);

const LIMITS = {
  session: { soft: SESSION_SOFT, hard: SESSION_HARD },
  user: { soft: USER_SOFT, hard: USER_HARD },
};

/**
 * Add this request to both windows in one round trip and return both counts.
 * Throws if Redis is down.
 */
async function hit(userId, sessionId) {
  const now = Date.now();
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
  const cutoff = now - WINDOW_SECONDS * 1000;
  const multi = redis.multi();
  for (const key of [`apivel:${sessionId}`, `apivel:user:${userId}`]) {
    multi.zadd(key, now, member).zremrangebyscore(key, 0, cutoff).zcard(key).expire(key, WINDOW_SECONDS);
  }
  const res = await multi.exec();
  const err = res.find(([e]) => e);
  if (err) throw err[0];
  return { session: Number(res[2][1]) || 1, user: Number(res[6][1]) || 1, at: new Date(now).toISOString() };
}

/**
 * { verdict: 'ok' | 'throttle' | 'flag', scope: 'session' | 'user' | null }
 * The most severe verdict wins; on a tie the session scope is reported.
 */
function classify(counts) {
  for (const verdict of ['flag', 'throttle']) {
    for (const scope of ['session', 'user']) {
      const limit = verdict === 'flag' ? LIMITS[scope].hard : LIMITS[scope].soft;
      if (counts[scope] > limit) return { verdict, scope };
    }
  }
  return { verdict: 'ok', scope: null };
}

/** Has the warning for this session/window already been audited? */
async function firstWarning(sessionId) {
  try {
    return (await redis.set(`apivel:warned:${sessionId}`, '1', 'EX', WINDOW_SECONDS, 'NX')) === 'OK';
  } catch {
    return false;
  }
}

module.exports = { hit, classify, firstWarning, WINDOW_SECONDS, LIMITS };
