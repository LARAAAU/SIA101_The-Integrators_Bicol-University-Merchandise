const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { readEntries } = require('../lib/audit');

// GET /api/audit?q=text&offset=0   (admin only; newest first)  ->  { rows: [...], next: number | null }
router.get('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only admins can view the audit log' });
  try {
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    res.json(await readEntries({ offset, limit: 50, q: req.query.q }));
  } catch (e) {
    console.error('[audit] read failed:', e.message);
    res.status(500).json({ message: 'Could not load the audit log' });
  }
});

module.exports = router;