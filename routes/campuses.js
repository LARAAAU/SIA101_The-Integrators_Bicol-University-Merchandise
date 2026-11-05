const router = require('express').Router();
const { admin } = require('../lib/supabase');
const { staffOnly } = require('../middleware/auth');

const pick = (b) => {
  const o = {};
  if (b.name !== undefined) o.name = String(b.name).trim();
  if (b.address !== undefined) o.address = b.address;
  if (b.pickup_note !== undefined) o.pickup_note = b.pickup_note;
  if (b.is_main !== undefined) o.is_main = !!b.is_main;
  if (b.is_active !== undefined) o.is_active = !!b.is_active;
  if (b.sort_order !== undefined) o.sort_order = parseInt(b.sort_order, 10) || 0;
  return o;
};

// GET /api/campuses  (public) - pickup locations shown at checkout and in the footer
router.get('/', async (req, res) => {
  const { data, error } = await admin.from('campuses').select('*').eq('is_active', true).order('sort_order').order('name');
  if (error) return res.status(500).json({ message: error.message });
  res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  res.json(data);
});

// GET /api/campuses/all  (staff, includes inactive)
router.get('/all', staffOnly, async (req, res) => {
  const { data, error } = await admin.from('campuses').select('*').order('sort_order').order('name');
  if (error) return res.status(500).json({ message: error.message });
  res.json(data);
});

router.post('/', staffOnly, async (req, res) => {
  const c = pick(req.body);
  if (!c.name) return res.status(400).json({ message: 'Campus name is required' });
  const { data, error } = await admin.from('campuses').insert(c).select().single();
  if (error) return res.status(400).json({ message: error.message });
  res.status(201).json(data);
});

router.put('/:id', staffOnly, async (req, res) => {
  const c = pick(req.body);
  if (c.name !== undefined && !c.name) return res.status(400).json({ message: 'Campus name is required' });
  const { data, error } = await admin.from('campuses').update(c).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ message: error.message });
  res.json(data);
});

// Soft delete: old orders keep their campus
router.delete('/:id', staffOnly, async (req, res) => {
  const { error } = await admin.from('campuses').update({ is_active: false }).eq('id', req.params.id);
  if (error) return res.status(400).json({ message: error.message });
  res.json({ message: 'Campus hidden' });
});

module.exports = router;
