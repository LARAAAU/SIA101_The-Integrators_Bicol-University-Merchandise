const { admin } = require('../lib/supabase');
const { getShop } = require('../lib/shopSettings');

// These stay available during maintenance so staff can log in and payments can still be confirmed.
const ALWAYS_OPEN = [
  ['GET', /^\/health$/],
  ['GET', /^\/settings\/shop$/],
  ['POST', /^\/payments\/webhook$/],
  ['POST', /^\/auth\/(login|refresh|forgot|reset)$/],
];

async function roleFromToken(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  return p?.role || null;
}

// Mounted on /api before the routes. While maintenance mode is on, only staff and admin get through.
async function maintenanceGate(req, res, next) {
  const shop = await getShop();
  if (!shop.maintenance_mode) return next();
  if (ALWAYS_OPEN.some(([m, re]) => m === req.method && re.test(req.path))) return next();
  const role = await roleFromToken(req);
  if (role === 'staff' || role === 'admin') return next();
  res.status(503).json({
    maintenance: true,
    message: shop.maintenance_message || 'The shop is under maintenance. Please check back soon.',
  });
}

// Use after requireAuth. Students cannot place new orders while the shop is closed. Staff and admin still can.
async function requireShopOpen(req, res, next) {
  const shop = await getShop();
  if (shop.is_open || ['staff', 'admin'].includes(req.user?.role)) return next();
  res.status(403).json({ shop_closed: true, message: shop.closed_message || 'The shop is closed for new orders right now. Please check back soon.' });
}

module.exports = { maintenanceGate, requireShopOpen };
