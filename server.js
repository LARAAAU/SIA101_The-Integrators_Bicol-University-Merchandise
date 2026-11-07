// Local development server. On Vercel, api/index.js is used instead.
require('dotenv').config();
const express = require('express');
const path = require('path');
const app = require('./api/index');

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MerchSys running at http://localhost:${PORT}`));

// Pickup reminders: on Vercel the daily cron in vercel.json does this; on a normal server, check every 6 hours.
const { runPickupReminders } = require('./lib/pickupReminders');
const tick = () => runPickupReminders().then((r) => r.reminded && console.log('[reminders]', r)).catch((e) => console.error('[reminders]', e.message));
setTimeout(tick, 30 * 1000);
setInterval(tick, 6 * 3600 * 1000);
