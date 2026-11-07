// Called by Vercel Cron once a day (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
const router = require('express').Router();
const { runPickupReminders } = require('../lib/pickupReminders');

router.get('/pickup-reminders', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ message: 'Unauthorized' });
  res.json(await runPickupReminders());
});

module.exports = router;
