const router = require('express').Router();
const { admin } = require('../lib/supabase');
const { adminOnly } = require('../middleware/auth');
const { parsePage, envelope, cleanSearch, LEGACY_CAP } = require('../lib/paginate');

// GET /api/users  ?q=&role=&page=&limit=   -> { rows, page, limit, total, pages }  (without page/limit: first 1000 as an array)
router.get('/', adminOnly, async (req, res) => {
  const pg = parsePage(req);
  let query = admin.from('profiles').select('*, campus:campuses(name)', pg.paged ? { count: 'exact' } : undefined).order('created_at', { ascending: false });
  if (['student', 'staff', 'admin'].includes(req.query.role)) query = query.eq('role', req.query.role);
  const q = cleanSearch(req.query.q);
  if (q) query = query.or(`full_name.ilike.*${q}*,university_email.ilike.*${q}*,student_id.ilike.*${q}*`);
  query = pg.paged ? query.range(pg.from, pg.to) : query.limit(LEGACY_CAP);
  const { data, count, error } = await query;
  if (error) return res.status(500).json({ message: error.message });
  res.json(pg.paged ? envelope(data, count, pg) : data);
});

// PATCH /api/users/:id/role  { role }
router.patch('/:id/role', adminOnly, async (req, res) => {
  const { role } = req.body;
  if (!['student', 'staff', 'admin'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
  if (req.params.id === req.user.id) return res.status(400).json({ message: 'You cannot change your own role' });
  const { data, error } = await admin.from('profiles').update({ role }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ message: error.message });
  res.json(data);
});

module.exports = router;
