const router = require('express').Router();
const { admin } = require('../lib/supabase');
const { requireAuth, adminOnly } = require('../middleware/auth');
const { getShop, clearShopCache } = require('../lib/shopSettings');

const EMPTY = { gcash_name: '', gcash_number: '', gcash_note: '' };

// Accepts 09XXXXXXXXX, +639XXXXXXXXX or 639XXXXXXXXX (spaces and dashes allowed). Returns 09XXXXXXXXX or null.
function normalizeNumber(v) {
  const d = String(v || '').replace(/[\s-]/g, '');
  const m = d.match(/^(?:\+?63|0)(9\d{9})$/);
  return m ? '0' + m[1] : null;
}

// GET /api/settings/payment  (any logged-in user) - where students send manual GCash payments
router.get('/payment', requireAuth, async (req, res) => {
  const { data, error } = await admin.from('payment_settings').select('gcash_name,gcash_number,gcash_note').eq('id', 1).maybeSingle();
  // Table not created yet (migration 06 not run): behave as "not set" instead of breaking checkout
  if (error) return res.json(EMPTY);
  res.set('Cache-Control', 'no-store');
  res.json(data || EMPTY);
});

// PUT /api/settings/payment  (admin only)
router.put('/payment', adminOnly, async (req, res) => {
  const name = String(req.body.gcash_name || '').trim();
  const number = normalizeNumber(req.body.gcash_number);
  const note = String(req.body.gcash_note || '').trim();
  if (!name) return res.status(400).json({ message: 'GCash account name is required' });
  if (name.length > 80) return res.status(400).json({ message: 'GCash account name is too long' });
  if (!number) return res.status(400).json({ message: 'Enter a valid GCash mobile number, e.g. 09123456789' });
  if (note.length > 300) return res.status(400).json({ message: 'Note is too long (max 300 characters)' });

  const { data, error } = await admin.from('payment_settings')
    .upsert({ id: 1, gcash_name: name, gcash_number: number, gcash_note: note || null, updated_at: new Date().toISOString(), updated_by: req.user.id })
    .select('gcash_name,gcash_number,gcash_note').single();
  if (error) return res.status(500).json({ message: 'Could not save. Did you run db/migration-06-payment-settings.sql in Supabase?' });
  res.json(data);
});

// GET /api/settings/shop  (public) - the storefront reads this to show the closed banner or the maintenance screen
router.get('/shop', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await getShop());
});

// PUT /api/settings/shop  (admin only)
router.put('/shop', adminOnly, async (req, res) => {
  const { is_open, maintenance_mode } = req.body;
  const closed = String(req.body.closed_message || '').trim();
  const maint = String(req.body.maintenance_message || '').trim();
  if (typeof is_open !== 'boolean' || typeof maintenance_mode !== 'boolean') return res.status(400).json({ message: 'Invalid settings' });
  if (closed.length > 300 || maint.length > 300) return res.status(400).json({ message: 'Messages can be at most 300 characters' });

  const { data, error } = await admin.from('shop_settings')
    .upsert({ id: 1, is_open, maintenance_mode, closed_message: closed || null, maintenance_message: maint || null, updated_at: new Date().toISOString(), updated_by: req.user.id })
    .select('is_open,closed_message,maintenance_mode,maintenance_message').single();
  if (error) return res.status(500).json({ message: 'Could not save. Did you run db/migration-07-shop-settings.sql in Supabase?' });
  clearShopCache();
  res.json(data);
});

module.exports = router;
