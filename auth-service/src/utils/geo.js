const geoip = require('geoip-lite');

/**
 * Resolve an IP to country/city
 *
 * geoip-lite is an offline MaxMind GeoLite database: no network latency and no
 * API key, but noticeably imprecise for mobile IPs, which matters in Kenya where
 * carrier-grade NAT routes subscribers through a handful of gateways. Treat city
 * as a weak signal and expect more location noise in production than the
 * synthetic evaluation suggests.
 *
 * Returns { country: 'KE'|null, city: 'Nairobi'|null }.
 */
function locate(ip) {
  if (!ip) return { country: null, city: null };

  // Express gives ::ffff:1.2.3.4 for IPv4-mapped addresses
  const clean = String(ip).replace(/^::ffff:/, '');

  // Loopback and private ranges never resolve; common in local development
  if (clean === '::1' || clean === '127.0.0.1' ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(clean)) {
    return { country: null, city: null };
  }

  try {
    const hit = geoip.lookup(clean);
    if (!hit) return { country: null, city: null };
    return { country: hit.country || null, city: hit.city || null };
  } catch (err) {
    console.error('Geolocation failed:', err.message);
    return { country: null, city: null };
  }
}

module.exports = { locate };
