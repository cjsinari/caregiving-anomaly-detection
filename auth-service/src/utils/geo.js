const geoip = require('geoip-lite');

const EMPTY = Object.freeze({ country: null, city: null, lat: null, lon: null, accuracyKm: null });

/**
 * Resolve an IP to country/city/coordinates
 *
 * geoip-lite is an offline MaxMind GeoLite database: no network latency and no
 * API key, but noticeably imprecise for mobile IPs, which matters in Kenya where
 * carrier-grade NAT routes subscribers through a handful of gateways. Treat city
 * as a weak signal and expect more location noise in production than the
 * synthetic evaluation suggests. Many Kenyan mobile ranges resolve only to the
 * country centroid (lat 1, lon 38), roughly 290 km from Nairobi; accuracyKm is
 * MaxMind's accuracy radius and must be taken into account by any distance check.
 *
 * Returns { country, city, lat, lon, accuracyKm }, all null when unresolvable.
 */
function locate(ip) {
  if (!ip) return { ...EMPTY };

  // Express gives ::ffff:1.2.3.4 for IPv4-mapped addresses
  const clean = String(ip).replace(/^::ffff:/, '');

  // Loopback and private ranges never resolve; common in local development
  if (clean === '::1' || clean === '127.0.0.1' ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(clean)) {
    return { ...EMPTY };
  }

  try {
    const hit = geoip.lookup(clean);
    if (!hit) return { ...EMPTY };
    const [lat, lon] = Array.isArray(hit.ll) ? hit.ll : [null, null];
    return {
      country: hit.country || null,
      city: hit.city || null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      accuracyKm: Number.isFinite(hit.area) ? hit.area : null,
    };
  } catch (err) {
    console.error('Geolocation failed:', err.message);
    return { ...EMPTY };
  }
}

/** Great-circle distance in kilometres. */
function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

module.exports = { locate, haversineKm };
