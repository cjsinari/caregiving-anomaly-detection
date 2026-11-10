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
app.use(helmet());
app.use(cors());
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

app.listen(PORT, () => console.log(`Auth service running on port ${PORT}`));
module.exports = app;