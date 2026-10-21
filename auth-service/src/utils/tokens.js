const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Refresh tokens are opaque random strings (not JWTs); only their hash is ever stored
const newRefreshToken = () => crypto.randomBytes(48).toString('hex');

/** Parsing '15m', '7d', '30s', '2h' into seconds. */
function parseDuration(value, fallbackSeconds) {
  const match = /^(\d+)([smhd])$/.exec(String(value || ''));
  if (!match) return fallbackSeconds;
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
  return Number(match[1]) * unit;
}

const accessTtlSeconds = () => parseDuration(process.env.JWT_EXPIRES_IN, 900);
const refreshTtlSeconds = () => parseDuration(process.env.REFRESH_TOKEN_EXPIRES_IN, 604800);

function signAccessToken(user, sessionId) {
  return jwt.sign(
    { sub: user.id, role: user.role, status: user.account_status, sid: sessionId },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: accessTtlSeconds() }
  );
}

module.exports = {
  sha256,
  newRefreshToken,
  parseDuration,
  accessTtlSeconds,
  refreshTtlSeconds,
  signAccessToken,
};
