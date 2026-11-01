const { admin } = require('../lib/supabase');

async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Login required' });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ message: 'Session expired. Please log in again.' });

  const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).single();
  if (!profile) return res.status(401).json({ message: 'Account profile not found' });

  req.user = profile;
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'You do not have permission to do this' });

const staffOnly = [requireAuth, requireRole('staff', 'admin')];
const adminOnly = [requireAuth, requireRole('admin')];

module.exports = { requireAuth, requireRole, staffOnly, adminOnly };
