const pool = require('../config/db');
const { locate, haversineKm } = require('../utils/geo');

/*
 * Geographic impossibility ("impossible travel").
 *
 * Two observations of the same user are impossible when getting from one to the
 * other would need a speed no traveller can reach. Raw distance is not enough:
 * geoip positions are approximate, and a Kenyan mobile IP that resolves only to
 * the country centroid sits ~290 km from Nairobi. Each point's accuracy radius is
 * therefore subtracted first, and only what remains counts as distance travelled.
 */
const MAX_SPEED_KMH = Number(process.env.GEO_MAX_SPEED_KMH) || 1000;     // above airliner cruise
const MIN_DISTANCE_KM = Number(process.env.GEO_MIN_DISTANCE_KM) || 500;  // ignore short hops entirely
// Country-level hits carry a small nominal radius that understates the error
const COUNTRY_LEVEL_RADIUS_KM = Number(process.env.GEO_COUNTRY_RADIUS_KM) || 500;
const MIN_ELAPSED_SECONDS = 60;   // avoids dividing by ~0 for back-to-back requests

const hasCoords = (loc) => loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon);
const label = (loc) => (loc.city ? `${loc.city}, ${loc.country}` : loc.country || 'an unknown location');

function radiusKm(loc) {
  if (!loc.city) return Math.max(loc.accuracyKm || 0, COUNTRY_LEVEL_RADIUS_KM);
  return loc.accuracyKm || 50;
}

/**
 * Pure check: could someone have travelled from prev to curr in elapsedSeconds?
 * Returns { impossible:false, reason } when there is nothing to compare.
 */
function assess(prev, curr, elapsedSeconds) {
  if (!hasCoords(prev) || !hasCoords(curr)) return { impossible: false, reason: 'no_reference' };

  const distanceKm = haversineKm(prev, curr);
  const effectiveKm = Math.max(0, distanceKm - radiusKm(prev) - radiusKm(curr));
  const seconds = Math.max(Number(elapsedSeconds) || 0, MIN_ELAPSED_SECONDS);
  const requiredSpeedKmh = effectiveKm / (seconds / 3600);
  const impossible = effectiveKm >= MIN_DISTANCE_KM && requiredSpeedKmh > MAX_SPEED_KMH;

  const result = {
    impossible,
    distanceKm: Math.round(distanceKm),
    effectiveKm: Math.round(effectiveKm),
    elapsedMinutes: Math.round(seconds / 60),
    requiredSpeedKmh: Math.round(requiredSpeedKmh),
    from: label(prev),
    to: label(curr),
    fromCountry: prev.country,
    toCountry: curr.country,
  };
  if (impossible) {
    result.explanation =
      `Activity from ${result.to} came ${result.elapsedMinutes} minute(s) after activity from ` +
      `${result.from}, ${result.distanceKm} km away; that would need travel at about ` +
      `${result.requiredSpeedKmh} km/h.`;
  }
  return result;
}

/**
 * Where was this user last verifiably present? Uses sessions, not login_events:
 * a login that stalled at step-up still writes a login_event, and an attacker
 * holding an OTP must not be able to move the user's reference location.
 */
async function lastKnownLocation(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(last_seen_ip, ip_address) AS ip,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_seen_at, created_at)))::float AS age_seconds
     FROM sessions
     WHERE user_id = $1 AND COALESCE(last_seen_ip, ip_address) IS NOT NULL
     ORDER BY COALESCE(last_seen_at, created_at) DESC
     LIMIT 5`,
    [userId]
  );
  for (const r of rows) {
    const loc = locate(r.ip);
    if (hasCoords(loc)) return { loc, ageSeconds: r.age_seconds };
  }
  return null;
}

/** Login-time check against the last session location. Never throws. */
async function checkLogin(userId, currentLoc) {
  try {
    if (!hasCoords(currentLoc)) return { impossible: false, reason: 'unresolved_ip' };
    const ref = await lastKnownLocation(userId);
    if (!ref) return { impossible: false, reason: 'no_reference' };
    return assess(ref.loc, currentLoc, ref.ageSeconds);
  } catch (err) {
    console.error('Impossible-travel check failed:', err.message);
    return { impossible: false, reason: 'error' };
  }
}

module.exports = { assess, checkLogin, hasCoords, MAX_SPEED_KMH, MIN_DISTANCE_KM };
