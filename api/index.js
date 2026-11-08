require('dotenv').config();
require('../lib/envCheck').reportEnv(); // friendly warnings about missing or weak secrets (never prints values)
const express = require('express');
const cors = require('cors');
const { auditHook } = require('../lib/audit');
const { lowStockHook } = require('../lib/lowstock');
const auditRoutes = require('../routes/audit');

const app = express();
app.set('trust proxy', true);

// CORS allowlist. The site calls its own /api (same origin), so it needs no CORS headers at all.
// Add any other website that is allowed to call this API in CORS_ORIGINS (comma separated).
const allowedOrigins = [process.env.APP_URL, ...(process.env.CORS_ORIGINS || '').split(',')]
  .map((o) => (o || '').trim().replace(/\/$/, '')).filter(Boolean);
const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
if (isProd) require('../lib/mailer').mailStatus().problems.forEach((p) => console.warn('[email setup]', p)); // shows up in the Vercel logs
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

app.use('/api/cron', require('../routes/cron')); // scheduled jobs (own secret, before the maintenance gate)
app.use('/api', auditHook); // audit log: records successful changes made by staff and admin
app.use('/api', require('../middleware/shopStatus').maintenanceGate); // maintenance mode: only staff and admin pass
app.use('/api/auth', require('../routes/auth'));
app.use('/api/products', lowStockHook, require('../routes/products')); // lowStockHook: emails admins when stock runs low
app.use('/api/campuses', require('../routes/campuses'));
app.use('/api/orders', lowStockHook, require('../routes/orders'));
app.use('/api/pickup', require('../routes/pickup')); // pickup schedule: time slots and bookings
app.use('/api/payments', require('../routes/payments'));
app.use('/api/settings', require('../routes/settings'));
app.use('/api/users', require('../routes/users'));
app.use('/api/analytics', require('../routes/analytics'));
app.use('/api/audit', auditRoutes); // admin-only audit log viewer

app.use('/api', (req, res) => res.status(404).json({ message: 'Endpoint not found' }));

// Central error handler: always answer errors as JSON so the frontend can show a proper message
// (Express 5 forwards rejected async handlers here)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'File is too large (maximum 5 MB)' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ message: status < 500 ? err.message : 'Server error' });
});

module.exports = app;