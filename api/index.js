require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.set('trust proxy', true);

// CORS allowlist. The site calls its own /api (same origin), so it needs no CORS headers at all.
// Add any other website that is allowed to call this API in CORS_ORIGINS (comma separated).
const allowedOrigins = [process.env.APP_URL, ...(process.env.CORS_ORIGINS || '').split(',')]
  .map((o) => (o || '').trim().replace(/\/$/, '')).filter(Boolean);
const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin requests, curl, payment webhooks
    const o = origin.replace(/\/$/, '');
    if (allowedOrigins.includes(o)) return cb(null, true);
    if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return cb(null, true);
    return cb(null, false); // no CORS headers, so browsers block it
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
}));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', require('../routes/auth'));
app.use('/api/products', require('../routes/products'));
app.use('/api/campuses', require('../routes/campuses'));
app.use('/api/orders', require('../routes/orders'));
app.use('/api/payments', require('../routes/payments'));
app.use('/api/settings', require('../routes/settings'));
app.use('/api/users', require('../routes/users'));
app.use('/api/analytics', require('../routes/analytics'));

app.use('/api', (req, res) => res.status(404).json({ message: 'Endpoint not found' }));

// Always answer errors as JSON so the frontend can show a proper message
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'File is too large (maximum 5 MB)' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ message: status < 500 ? err.message : 'Server error' });
});

// Central error handler (Express 5 forwards rejected async handlers here)
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'File too large (max 5MB)' });
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

module.exports = app;
