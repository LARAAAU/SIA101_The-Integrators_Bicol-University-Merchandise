const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { readEntries, readPage } = require('../lib/audit');

// GET /api/audit?q=text&page=1&limit=10   (admin only; newest first)  ->  { rows, page, limit, total, pages }
router.get('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only admins can view the audit log' });
  try {
    // ?page=&limit= gives { rows, page, limit, total, pages } like the other lists; the old ?offset= form still works
    if (req.query.page !== undefined) return res.json(await readPage({ page: req.query.page, limit: req.query.limit, q: req.query.q }));
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    res.json(await readEntries({ offset, limit: 50, q: req.query.q }));
  } catch (e) {
    console.error('[audit] read failed:', e.message);
    res.status(500).json({ message: 'Could not load the audit log' });
  }
});

module.exports = router;