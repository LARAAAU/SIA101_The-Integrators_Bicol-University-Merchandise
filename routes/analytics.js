const router = require('express').Router();
const { admin } = require('../lib/supabase');
const { staffOnly } = require('../middleware/auth');

// GET /api/analytics  -> all dashboard numbers + chart data in ONE database round trip
router.get('/', staffOnly, async (req, res) => {
  const { data, error } = await admin.rpc('dashboard_stats');
  if (error) return res.status(500).json({ message: error.message });
  res.json(data);
});

module.exports = router;
