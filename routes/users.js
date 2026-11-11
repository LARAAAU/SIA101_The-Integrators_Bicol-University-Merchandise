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

// PATCH /api/users/:id/name  { name }   admin only, STAFF accounts only (e.g. "Polangui Campus Staff")
// Keeps full_name, first_name and last_name in step, because the navbar and emails read them.
router.patch('/:id/name', adminOnly, async (req, res) => {
  const name = String(req.body.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) return res.status(400).json({ message: 'The name must be 2 to 60 characters' });
  if (!/^[\p{L}\p{N} .'\-]+$/u.test(name)) return res.status(400).json({ message: 'Use letters, numbers, spaces, . \' and - only' });

  const { data: target, error: tErr } = await admin.from('profiles').select('id, role').eq('id', req.params.id).maybeSingle();
  if (tErr) return res.status(400).json({ message: tErr.message });
  if (!target) return res.status(404).json({ message: 'User not found' });
  if (target.role !== 'staff') return res.status(400).json({ message: 'Only staff names can be edited here' });

  const parts = name.split(' ');
  const last = parts.length > 1 ? parts.pop() : null;
  const first = parts.join(' ');
  const { data, error } = await admin.from('profiles')
    .update({ full_name: name, first_name: first, middle_name: null, last_name: last })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ message: error.message });
  res.json(data);
});

module.exports = router;
