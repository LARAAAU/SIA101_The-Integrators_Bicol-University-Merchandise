const router = require('express').Router();
const { admin, anon } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { full_name, email, password, course } = req.body;
  if (!full_name?.trim() || !email || !password) return res.status(400).json({ message: 'Name, email and password are required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Invalid email address' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });

  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase();
  if (domain && !email.toLowerCase().endsWith('@' + domain))
    return res.status(400).json({ message: `Please use your @${domain} university email` });

  const { data, error } = await admin.auth.admin.createUser({
    email: email.toLowerCase(), password, email_confirm: true, user_metadata: { full_name },
  });
  if (error) {
    const dup = /already|registered|exists/i.test(error.message);
    return res.status(dup ? 409 : 400).json({ message: dup ? 'Email already registered' : error.message });
  }

  const { error: pErr } = await admin.from('profiles').insert({
    id: data.user.id, full_name: full_name.trim(), university_email: email.toLowerCase(), course: course || null,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id); // rollback
    return res.status(500).json({ message: 'Could not create profile' });
  }
  res.status(201).json({ message: 'Registration successful' });
});

// POST /api/auth/login  -> { access_token, refresh_token, expires_at, user }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

  const { data, error } = await anon().auth.signInWithPassword({ email: email.toLowerCase(), password });
  if (error || !data.session) return res.status(401).json({ message: 'Invalid email or password' });

  const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).single();
  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: profile,
  });
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ message: 'refresh_token required' });
  const { data, error } = await anon().auth.refreshSession({ refresh_token });
  if (error || !data.session) return res.status(401).json({ message: 'Session expired' });
  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => res.json(req.user));

// PUT /api/auth/me  { full_name, course, current_password, new_password }
router.put('/me', requireAuth, async (req, res) => {
  const { full_name, course, current_password, new_password } = req.body;

  if (new_password) {
    if (new_password.length < 8) return res.status(400).json({ message: 'New password must be at least 8 characters' });
    const { error } = await anon().auth.signInWithPassword({ email: req.user.university_email, password: current_password || '' });
    if (error) return res.status(400).json({ message: 'Current password is incorrect' });
    const { error: uErr } = await admin.auth.admin.updateUserById(req.user.id, { password: new_password });
    if (uErr) return res.status(400).json({ message: uErr.message });
  }

  const patch = {};
  if (full_name?.trim()) patch.full_name = full_name.trim();
  if (course !== undefined) patch.course = course;
  if (Object.keys(patch).length) {
    const { error } = await admin.from('profiles').update(patch).eq('id', req.user.id);
    if (error) return res.status(400).json({ message: error.message });
  }
  const { data: profile } = await admin.from('profiles').select('*').eq('id', req.user.id).single();
  res.json(profile);
});

module.exports = router;
