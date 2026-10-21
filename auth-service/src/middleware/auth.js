const jwt = require('jsonwebtoken');
const sessionStore = require('../services/sessionStore');

/** Requires a valid access token AND a still-active session (logout is immediate) */
async function verifyToken(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let payload;
  try {
    // Pin the algorithm: never trust the token's own "alg" header
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({ error: expired ? 'Access token expired' : 'Invalid token', code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' });
  }

  try {
    if (!(await sessionStore.isActive(payload.sid))) {
      return res.status(401).json({ error: 'Session has ended', code: 'SESSION_ENDED' });
    }
  } catch (err) {
    console.error('Session check failed:', err.message);
    return res.status(503).json({ error: 'Unable to verify session. Please try again.' });
  }

  req.user = { id: payload.sub, role: payload.role, status: payload.status, sessionId: payload.sid };
  next();
}

/** RBAC: allow only the listed roles. Used after verifyToken */
const requireRole = (...allowed) => (req, res, next) => {
  if (!req.user || !allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action' });
  }
  next();
};

module.exports = { verifyToken, requireRole };
