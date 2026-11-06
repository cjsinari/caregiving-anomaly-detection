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

app.get('/health', (req, res) => res.json({ status: 'Auth service running', timestamp: new Date().toISOString() }));
app.use('/auth', authLimiter, authRoutes);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});


const pool = require('./src/config/db');