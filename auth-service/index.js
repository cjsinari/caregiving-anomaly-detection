const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const rateLimit = require('express-rate-limit');

for (const key of ['JWT_SECRET', 'OTP_SECRET']) {
  if (!process.env[key] || process.env[key].length < 32) {
    console.error(`FATAL: ${key} is missing or shorter than 32 characters. Check your .env file.`);
    process.exit(1);
  }
}

const authRoutes = require('./src/routes/authRoutes');
const profileRoutes = require('./src/routes/profileRoutes');
const auditRoutes = require('./src/routes/auditRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const app = express();
const PORT = process.env.PORT || 3000;

// req.ip feeds both geolocation and the per-IP rate limiter, so it must be the
// real client address. 'true' is NOT safe: it trusts any X-Forwarded-For header,
// letting anyone spoof an IP and bypass rate limiting. Set TRUST_PROXY to the
// number of proxy hops in front of the service (1 behind a single nginx or load
// balancer) and leave it unset when the service is directly exposed.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

/*
 * Security headers.
 *
 * Configured explicitly rather than taking helmet's defaults, because the
 * defaults are tuned for a service that serves HTML and this one serves JSON
 * to two clients it does not host.
 *
 * The content policy denies everything. A JSON API has no legitimate reason to
 * load a script, embed a frame or fetch a stylesheet, so a response that
 * somehow rendered as a document — a reflected error page, a content-type
 * confusion — has nothing it is permitted to execute. frame-ancestors 'none'
 * and X-Frame-Options together: the header is the one old browsers honour and
 * the directive is the one that is actually specified.
 *
 * HSTS is set but only takes effect over HTTPS, so it is harmless in
 * development and correct in production. It is deliberately not preloaded:
 * preloading is effectively irreversible and is a deployment decision, not a
 * library default.
 */
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  hsts: { maxAge: 15552000, includeSubDomains: true, preload: false },
}));

/*
 * CORS, limited to the origins that are actually meant to call this service.
 *
 * `cors()` with no arguments reflects any Origin, which meant every website a
 * signed-in administrator visited could read this API with their browser — if
 * the browser carried the credential. It does not today, because the dashboard
 * keeps its token in memory and sends it in a header, so a cross-site page has
 * nothing to replay. That is the reason this was survivable, not a reason to
 * leave it: the moment a refresh cookie is introduced (see the dashboard's
 * README) a permissive CORS policy becomes an account-takeover path, and
 * discovering that during the cookie change is worse than fixing it now.
 *
 * ── On CSRF ──
 *
 * There is deliberately no CSRF token, and that is not an omission. CSRF needs
 * a credential the browser attaches by itself; this service authenticates only
 * from an Authorization header, which a cross-site request cannot set. A token
 * would add a round trip and a failure mode while defending nothing.
 *
 * What makes that true is the two properties below, so both are enforced rather
 * than assumed: the allowlist means no unknown origin gets a successful
 * preflight, and `credentials: false` means the browser will not attach cookies
 * even if something later sets one. If the refresh token ever moves into a
 * cookie, CSRF becomes real and a SameSite=Strict cookie plus an origin check
 * is the defence — and these two settings are where that work starts.
 */
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // No Origin header: a server-to-server call, a health check, or curl.
    // Those are not browser requests, so the same-origin policy is not what is
    // protecting them — the bearer token is — and refusing them would break
    // monitoring for no security gain.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Answered without the allow header rather than with a 500: the browser
    // then blocks the response, which is the correct outcome, and the service
    // does not log an error for something working as intended.
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // The dashboard's export reads the filename the service chose.
  exposedHeaders: ['Content-Disposition', 'Retry-After'],
  credentials: false,
  maxAge: 600,
}));

app.use(express.json({ limit: '10kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests from this device. Please try again later.' },
});

// Resource routes get their own, looser per-IP budget: they are the normal work
// of a signed-in client, and sharing the auth bucket would let ordinary browsing
// use up the allowance that protects the OTP and login endpoints. Per-session and
// per-user limits are enforced separately by enforceApiVelocity.
const resourceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: Number(process.env.RESOURCE_RATE_LIMIT) || 600,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests from this device. Please try again later.' },
});

// The dashboard is a read-heavy client: one administrator opening it fills a row
// of KPI cards, a chart, a table and a session list, and refreshes them while the
// screen is open. Sharing the resource budget would mean one open dashboard
// exhausting the allowance meant for every signed-in family member behind the
// same NAT. Per-session and per-user velocity still apply through
// enforceApiVelocity, which is the limit that actually tracks a single client.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: Number(process.env.ADMIN_RATE_LIMIT) || 1200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests from this device. Please try again later.' },
});

app.get('/health', (req, res) => res.json({ status: 'Auth service running', timestamp: new Date().toISOString() }));
app.use('/auth', authLimiter, authRoutes);
app.use('/profiles', resourceLimiter, profileRoutes);
app.use('/audit', resourceLimiter, auditRoutes);
app.use('/admin', adminLimiter, adminRoutes);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});


const pool = require('./src/config/db');
const { verifyTransport } = require('./src/utils/mailer');

/*
 * Check the mail transport at boot, without sending anything.
 *
 * Account recovery is the one flow that cannot fall back to SMS -- the person
 * using it has lost the phone. A bad SMTP password would otherwise be
 * discovered by the first person who could not get into their account, and
 * discovered as silence, since the recovery endpoint deliberately gives the
 * same answer whether or not delivery worked.
 *
 * It does not stop the service. Email is the secondary channel; a service that
 * refused to start because recovery was degraded would take sign-in down with
 * it.
 */
verifyTransport().then((result) => {
  if (result.devMode) {
    console.log('Mail: no SMTP host configured — recovery codes will print to this console.');
  } else if (!result.ok) {
    console.error(`Mail: SMTP check FAILED (${result.error}). Account recovery by email will not work.`);
  } else {
    console.log('Mail: SMTP transport verified.');
  }
});

app.listen(PORT, () => console.log(`Auth service running on port ${PORT}`));
module.exports = app;