const router = require('express').Router();
const { admin, anon } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { sendMail } = require('../lib/mailer');

const MIN = 60 * 1000;
// Login: 10 tries per email per 15 min, and 60 per IP per 15 min (campus Wi-Fi shares IPs, so the IP cap is loose)
const loginPerAccount = rateLimit({ windowMs: 15 * MIN, max: 10, key: (req) => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase()}` });
const loginPerIp = rateLimit({ windowMs: 15 * MIN, max: 60, key: (req) => `ip|${req.ip}` });
const registerLimit = rateLimit({ windowMs: 60 * MIN, max: 10, key: (req) => `reg|${req.ip}`, message: 'Too many sign-up attempts. Please try again later.' });
const profileLimit = rateLimit({ windowMs: 15 * MIN, max: 30, key: (req) => `me|${req.user?.id || req.ip}` });
// Password reset: 5 emails per address per hour, 20 per IP per hour
const forgotPerEmail = rateLimit({ windowMs: 60 * MIN, max: 5, key: (req) => `forgot|${String(req.body?.email || '').trim().toLowerCase()}`, message: 'Too many reset requests. Please try again later.' });
const forgotPerIp = rateLimit({ windowMs: 60 * MIN, max: 20, key: (req) => `forgot-ip|${req.ip}`, message: 'Too many reset requests. Please try again later.' });
const resetLimit = rateLimit({ windowMs: 15 * MIN, max: 10, key: (req) => `reset|${req.ip}`, message: 'Too many attempts. Please try again later.' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(\+?63|0)9\d{9}$/;
const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'];
const PROFILE_SELECT = '*, campus:campuses(name)';

const clean = (v) => String(v ?? '').trim();
const cleanPhone = (v) => clean(v).replace(/[\s-]/g, '');

async function getProfile(id) {
  const { data } = await admin.from('profiles').select(PROFILE_SELECT).eq('id', id).single();
  return data;
}

async function validCampus(id) {
  if (!id) return false;
  const { data } = await admin.from('campuses').select('id').eq('id', id).eq('is_active', true).maybeSingle();
  return !!data;
}

// POST /api/auth/register
router.post('/register', registerLimit, async (req, res) => {
  const b = req.body;
  const first = clean(b.first_name), middle = clean(b.middle_name), last = clean(b.last_name);
  const email = clean(b.email).toLowerCase();
  const phone = cleanPhone(b.phone);
  const studentId = clean(b.student_id), course = clean(b.course), block = clean(b.block).toUpperCase();
  const address = clean(b.address), year = clean(b.year_level);

  if (!first || !last || !email || !b.password || !studentId || !course || !year || !block || !address || !phone || !b.campus_id)
    return res.status(400).json({ message: 'Please fill in all the fields' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Invalid email address' });
  if (b.password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
  if (!PHONE_RE.test(phone)) return res.status(400).json({ message: 'Enter a valid mobile number, e.g. 09123456789' });
  if (!YEARS.includes(year)) return res.status(400).json({ message: 'Choose your year level' });
  if (!(await validCampus(b.campus_id))) return res.status(400).json({ message: 'Choose your campus' });

  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase();
  if (domain && !email.endsWith('@' + domain)) return res.status(400).json({ message: `Please use your @${domain} university email` });

  const { data: dup } = await admin.from('profiles').select('id').eq('student_id', studentId).maybeSingle();
  if (dup) return res.status(409).json({ message: 'That student ID is already registered' });

  const fullName = [first, middle, last].filter(Boolean).join(' ');
  const { data, error } = await admin.auth.admin.createUser({
    email, password: b.password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error) {
    const exists = /already|registered|exists/i.test(error.message);
    return res.status(exists ? 409 : 400).json({ message: exists ? 'Email already registered' : error.message });
  }

  const { error: pErr } = await admin.from('profiles').insert({
    id: data.user.id, full_name: fullName, first_name: first, middle_name: middle || null, last_name: last, university_email: email, course, student_id: studentId,
    year_level: year, block, address, phone, campus_id: b.campus_id,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id); // rollback
    return res.status(pErr.code === '23505' ? 409 : 500).json({ message: pErr.code === '23505' ? 'That student ID is already registered' : 'Could not create profile' });
  }
  res.status(201).json({ message: 'Registration successful' });
});

// POST /api/auth/login  -> { access_token, refresh_token, expires_at, user }
router.post('/login', loginPerIp, loginPerAccount, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

  const { data, error } = await anon().auth.signInWithPassword({ email: clean(email).toLowerCase(), password });
  if (error || !data.session) return res.status(401).json({ message: 'Invalid email or password' });

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: await getProfile(data.user.id),
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

// POST /api/auth/forgot  { email }
// Creates a one-time reset link with Supabase and emails it with our own mailer.
// The answer is always the same, so nobody can use this form to find out which emails have accounts.
router.post('/forgot', forgotPerIp, forgotPerEmail, async (req, res) => {
  const email = clean(req.body?.email).toLowerCase();
  const reply = { message: 'If that email has an account, a reset link is on its way.' };
  if (!EMAIL_RE.test(email)) return res.json(reply);

  try {
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery', email, options: { redirectTo: base + '/reset-password.html' },
    });
    if (error || !data?.properties?.action_link) {
      console.error('[forgot] no link for', email, '-', error?.message || 'no link returned'); // usually: no account with this email
      return res.json(reply);
    }
    const link = data.properties.action_link;
    await sendMail({
      to: email,
      subject: 'Reset your BU Merch password',
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#12324a">
        <h2 style="margin-bottom:4px">BU <span style="color:#f28c28">Merch</span></h2>
        <p>We got a request to reset your password. Click the button below to choose a new one.</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#2b7bb9;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:bold">Reset password</a></p>
        <p style="color:#5d7488;font-size:13px">This link works once and expires soon. If you did not ask for this, you can ignore this email and your password stays the same.</p>
      </div>`,
    });
    console.log('[forgot] reset email handled for', email);
  } catch (e) {
    console.error('[forgot]', e.message);
  }
  res.json(reply);
});

// POST /api/auth/reset  { access_token, password }
// access_token is the temporary token from the emailed link. It is checked with Supabase before the password is changed.
router.post('/reset', resetLimit, async (req, res) => {
  const { access_token, password } = req.body || {};
  if (!access_token) return res.status(400).json({ message: 'This reset link is invalid or has expired.' });
  if (!password || String(password).length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });

  const { data, error } = await admin.auth.getUser(String(access_token));
  if (error || !data?.user) return res.status(400).json({ message: 'This reset link is invalid or has expired.' });

  const { error: uErr } = await admin.auth.admin.updateUserById(data.user.id, { password: String(password) });
  if (uErr) return res.status(400).json({ message: uErr.message });
  res.json({ message: 'Password updated. Please log in.' });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => res.json(await getProfile(req.user.id)));

// PUT /api/auth/me  (profile fields and/or password change)
router.put('/me', requireAuth, profileLimit, async (req, res) => {
  const b = req.body;

  if (b.new_password) {
    if (b.new_password.length < 8) return res.status(400).json({ message: 'New password must be at least 8 characters' });
    const { error } = await anon().auth.signInWithPassword({ email: req.user.university_email, password: b.current_password || '' });
    if (error) return res.status(400).json({ message: 'Current password is incorrect' });
    const { error: uErr } = await admin.auth.admin.updateUserById(req.user.id, { password: b.new_password });
    if (uErr) return res.status(400).json({ message: uErr.message });
  }

  const patch = {};
  if (b.first_name !== undefined || b.middle_name !== undefined || b.last_name !== undefined) {
    const first = clean(b.first_name), middle = clean(b.middle_name), last = clean(b.last_name);
    if (!first || !last) return res.status(400).json({ message: 'First name and last name are required' });
    Object.assign(patch, { first_name: first, middle_name: middle || null, last_name: last, full_name: [first, middle, last].filter(Boolean).join(' ') });
  }
  if (b.course !== undefined) patch.course = clean(b.course) || null;
  if (b.student_id !== undefined) patch.student_id = clean(b.student_id) || null;
  if (b.block !== undefined) patch.block = clean(b.block).toUpperCase() || null;
  if (b.address !== undefined) patch.address = clean(b.address) || null;
  if (b.phone !== undefined) {
    const ph = cleanPhone(b.phone);
    if (ph && !PHONE_RE.test(ph)) return res.status(400).json({ message: 'Enter a valid mobile number, e.g. 09123456789' });
    patch.phone = ph || null;
  }
  if (b.year_level !== undefined) {
    if (b.year_level && !YEARS.includes(b.year_level)) return res.status(400).json({ message: 'Invalid year level' });
    patch.year_level = b.year_level || null;
  }
  if (b.campus_id !== undefined) {
    if (b.campus_id && !(await validCampus(b.campus_id))) return res.status(400).json({ message: 'Invalid campus' });
    patch.campus_id = b.campus_id || null;
  }

  if (Object.keys(patch).length) {
    const { error } = await admin.from('profiles').update(patch).eq('id', req.user.id);
    if (error) return res.status(error.code === '23505' ? 409 : 400).json({ message: error.code === '23505' ? 'That student ID is already registered' : error.message });
  }
  res.json(await getProfile(req.user.id));
});

module.exports = router;