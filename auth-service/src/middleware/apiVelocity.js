const apiVelocity = require('../services/apiVelocity');
const { flagSession, flaggedResponse } = require('../services/sessionAnomaly');
const { logEvent } = require('../utils/audit');

/**
 * Per-session and per-user request velocity. Runs after verifyToken.
 *
 * Fails open when Redis is unavailable: velocity is a secondary control, and
 * refusing every authenticated request during a Redis outage would turn a cache
 * failure into a full outage (NFR11). The token and session checks still apply.
 */
async function enforceApiVelocity(req, res, next) {
  const { id: userId, sessionId } = req.user;

  let counts;
  try {
    counts = await apiVelocity.hit(userId, sessionId);
  } catch (err) {
    console.error('API velocity unavailable (allowing request):', err.message);
    return next();
  }

  const { verdict, scope } = apiVelocity.classify(counts);
  if (verdict === 'ok') return next();

  const limits = apiVelocity.LIMITS[scope];
  const window = apiVelocity.WINDOW_SECONDS;
  const detail = {
    classification: 'high_api_velocity', scope,
    userId, sessionId, requestedAt: counts.at,
    sessionCount: counts.session, userCount: counts.user,
    windowSeconds: window, limits: apiVelocity.LIMITS,
    path: req.originalUrl.slice(0, 100), method: req.method,
  };

  if (verdict === 'flag') {
    await flagSession({
      userId, sessionId, reason: 'high_api_velocity', detail,
      explanation: `${counts[scope]} requests in ${window}s for this ${scope}, above the hard limit of ` +
        `${limits.hard}, after being throttled at ${limits.soft}.`,
    });
    return flaggedResponse(res);
  }

  if (await apiVelocity.firstWarning(sessionId)) {
    logEvent({ userId, sessionId, eventType: 'api_velocity_throttled', severity: 'medium', detail,
      explanation: `More than ${limits.soft} requests in ${window}s for this ${scope}.` });
  }
  res.set('Retry-After', String(window));
  return res.status(429).json({
    error: 'Too many requests. Please slow down and try again shortly.',
    code: 'API_VELOCITY_EXCEEDED', retryAfterSeconds: window,
  });
}

module.exports = { enforceApiVelocity };
