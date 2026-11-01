const router = require('express').Router();
const { admin } = require('../lib/supabase');
const { adminOnly } = require('../middleware/auth');

// GET /api/users
router.get('/', adminOnly, async (req, res) => {
  const { data, error } = await admin.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ message: error.message });
  res.json(data);
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
