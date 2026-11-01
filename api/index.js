require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', require('../routes/auth'));
app.use('/api/products', require('../routes/products'));
app.use('/api/orders', require('../routes/orders'));
app.use('/api/payments', require('../routes/payments'));
app.use('/api/users', require('../routes/users'));
app.use('/api/analytics', require('../routes/analytics'));

app.use('/api', (req, res) => res.status(404).json({ message: 'Endpoint not found' }));

// Central error handler (Express 5 forwards rejected async handlers here)
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'File too large (max 5MB)' });
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

module.exports = app;
