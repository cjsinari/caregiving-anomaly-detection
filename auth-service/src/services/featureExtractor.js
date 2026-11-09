const pool = require('../config/db');
const { locate } = require('../utils/geo');
const velocity = require('./velocity');

// The model is trained on Nairobi local time. Server UTC would shift every
// login_hour by 3 and make time_deviation meaningless.
const TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Nairobi';

// Below this many successful logins a user has no usable behavioural baseline,
// so the model's score is recorded but the response is governed by rules.
const MIN_LOGINS_FOR_BASELINE = Number(process.env.MIN_LOGINS_FOR_BASELINE) || 3;

function localHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: 'numeric', hour12: false,
  }).format(date));
}

/**
 * Build the five model features plus the context the explanation and audit
 * trail need.
 *
 * is_known_country / is_known_city use "has this user logged in successfully
 * from here before", not "matches their single most common location". The
 * mode-based definition used during RBA feature engineering marks a caregiver
 * working across three neighbourhoods as unfamiliar in two of them.
 */
async function build(userId, { ip, deviceFingerprint }) {
  const now = new Date();
  const hour = localHour(now);
  const location = locate(ip);
  const { country, city } = location;

  const { rows: hist } = await pool.query(
    `SELECT
       COUNT(*)::int AS login_count,
       AVG(EXTRACT(HOUR FROM login_time AT TIME ZONE 'UTC' AT TIME ZONE $2))::float AS mean_hour,
       BOOL_OR(country IS NOT NULL AND country = $3) AS seen_country,
       BOOL_OR(city IS NOT NULL AND city = $4) AS seen_city
     FROM login_events
     WHERE user_id = $1 AND was_successful = TRUE`,
    [userId, TIMEZONE, country, city]
  );
  const h = hist[0];
  const loginCount = h.login_count || 0;
  const coldStart = loginCount < MIN_LOGINS_FOR_BASELINE;

  // With no history there is nothing to deviate from, so 0 is the honest value.
  const timeDeviation = (loginCount > 0 && h.mean_hour != null)
    ? Math.abs(hour - h.mean_hour)
    : 0;

  // An unresolvable IP must not be reported as unfamiliar: geoip-lite returns
  // nothing for private ranges and many mobile IPs, and treating that as a
  // foreign login would flag every developer and a share of real users.
  const isKnownCountry = country === null ? 1 : (h.seen_country ? 1 : 0);
  const isKnownCity = city === null ? 1 : (h.seen_city ? 1 : 0);

  const loginVelocity = await velocity.recordAndCount(userId);

  return {
    features: {
      login_hour: hour,
      time_deviation: Number(timeDeviation.toFixed(4)),
      is_known_country: isKnownCountry,
      is_known_city: isKnownCity,
      login_velocity: loginVelocity,
    },
    context: { country, city, location, ip, deviceFingerprint, loginCount, coldStart },
  };
}

module.exports = { build, MIN_LOGINS_FOR_BASELINE };
