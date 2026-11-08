const router = require('express').Router();
const multer = require('multer');
const { detectImage, badImage } = require('../lib/imageCheck');
const { admin } = require('../lib/supabase');
const { requireAuth, adminOnly } = require('../middleware/auth');
const { getShop, clearShopCache, pick } = require('../lib/shopSettings');
const { mailStatus, sendTestEmail } = require('../lib/mailer');
const { rateLimit } = require('../middleware/rateLimit');

const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(Object.assign(new Error('Only image files are allowed'), { status: 400 })),
});
const ANN_IMG_PREFIX = () => `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/product-images/announcements/`;

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

// POST /api/settings/announcement-image  (admin only, multipart: image) - stores the popup picture, returns its public URL
router.post('/announcement-image', adminOnly, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Choose an image first' });
  const kind = detectImage(req.file.buffer); // trust the file contents, not the name
  if (!kind) return res.status(400).json({ message: badImage().message });
  const name = `announcements/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${kind.ext}`;
  const { error } = await admin.storage.from('product-images').upload(name, req.file.buffer, { contentType: kind.mime });
  if (error) return res.status(500).json({ message: 'Image upload failed: ' + error.message });
  res.json({ url: admin.storage.from('product-images').getPublicUrl(name).data.publicUrl });
});

// PUT /api/settings/shop  (admin only)
router.put('/shop', adminOnly, async (req, res) => {
  const { is_open, maintenance_mode } = req.body;
  const closed = String(req.body.closed_message || '').trim();
  const maint = String(req.body.maintenance_message || '').trim();
  const announcement_enabled = req.body.announcement_enabled !== false; // missing = keep it on
  const announce = String(req.body.announcement_text || '').trim();
  if (typeof is_open !== 'boolean' || typeof maintenance_mode !== 'boolean') return res.status(400).json({ message: 'Invalid settings' });
  if (closed.length > 300 || maint.length > 300) return res.status(400).json({ message: 'Messages can be at most 300 characters' });
  const announce_image_url = String(req.body.announcement_image_url || '').trim();
  if (announce_image_url && !announce_image_url.startsWith(ANN_IMG_PREFIX())) return res.status(400).json({ message: 'Invalid announcement image' });
  if (announce.length > 500) return res.status(400).json({ message: 'The announcement can be at most 500 characters' });

  const { data, error } = await admin.from('shop_settings')
    .upsert({ id: 1, is_open, maintenance_mode, closed_message: closed || null, maintenance_message: maint || null,
      announcement_enabled, announcement_text: announce || null, announcement_image_url: announce_image_url || null, updated_at: new Date().toISOString(), updated_by: req.user.id })
    .select('*').single();
  if (error) return res.status(500).json({ message: 'Could not save. Did you run db/migration-07-shop-settings.sql and db/migration-10-announcement.sql in Supabase?' });
  clearShopCache();
  res.json({ ...(await getShop()), ...pick(data) });
});

// GET /api/settings/email  (admin only) - is email ready for real students? Never returns the API key.
router.get('/email', adminOnly, (req, res) => res.json(mailStatus()));

// POST /api/settings/email/test  (admin only) - sends one real email to the admin's own address
const testLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: (req) => `mailtest|${req.user?.id || req.ip}`, message: 'Too many test emails. Try again in an hour.' });
router.post('/email/test', adminOnly, testLimit, async (req, res) => {
  const to = req.user.university_email || req.user.email;
  if (!to) return res.status(400).json({ message: 'Your account has no email address to send the test to.' });
  res.json(await sendTestEmail(to));
});

module.exports = router;
