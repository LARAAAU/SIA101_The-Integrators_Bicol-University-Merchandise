const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { admin } = require('../lib/supabase');
const { staffOnly } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(Object.assign(new Error('Only image files are allowed'), { status: 400 })),
});

async function uploadImage(file) {
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const { error } = await admin.storage.from('product-images').upload(name, file.buffer, { contentType: file.mimetype });
  if (error) throw new Error('Image upload failed: ' + error.message);
  return admin.storage.from('product-images').getPublicUrl(name).data.publicUrl;
}

function parseBody(b) {
  const out = {};
  if (b.name !== undefined) out.name = String(b.name).trim();
  if (b.description !== undefined) out.description = b.description;
  if (b.price !== undefined) out.price = Number(b.price);
  if (b.stock !== undefined) out.stock = parseInt(b.stock, 10);
  if (b.low_stock_threshold !== undefined) out.low_stock_threshold = parseInt(b.low_stock_threshold, 10);
  if (b.preorder_deadline !== undefined) out.preorder_deadline = b.preorder_deadline || null;
  if (b.is_active !== undefined) out.is_active = b.is_active === true || b.is_active === 'true';
  return out;
}

const invalid = (p) =>
  (p.name !== undefined && !p.name) || (p.price !== undefined && !(p.price >= 0)) || (p.stock !== undefined && !(p.stock >= 0));

// GET /api/products  (public; CDN-cached for speed)
router.get('/', async (req, res) => {
  const { data, error } = await admin.from('products').select('*').eq('is_active', true).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ message: error.message });
  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  res.json(data);
});

// GET /api/products/all  (staff/admin, includes inactive)
router.get('/all', staffOnly, async (req, res) => {
  const { data, error } = await admin.from('products').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ message: error.message });
  res.json(data);
});

// POST /api/products  (multipart: image + fields)
router.post('/', staffOnly, upload.single('image'), async (req, res) => {
  const p = parseBody(req.body);
  if (!p.name || invalid(p) || p.price === undefined) return res.status(400).json({ message: 'Name and a valid price are required' });
  if (req.file) p.image_url = await uploadImage(req.file);
  const { data, error } = await admin.from('products').insert(p).select().single();
  if (error) return res.status(400).json({ message: error.message });
  res.status(201).json(data);
});

// PUT /api/products/:id
router.put('/:id', staffOnly, upload.single('image'), async (req, res) => {
  const p = parseBody(req.body);
  if (invalid(p)) return res.status(400).json({ message: 'Invalid product data' });
  if (req.file) p.image_url = await uploadImage(req.file);
  const { data, error } = await admin.from('products').update(p).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ message: error.message });
  res.json(data);
});

// DELETE /api/products/:id  (soft delete so old orders keep their history)
router.delete('/:id', staffOnly, async (req, res) => {
  const { error } = await admin.from('products').update({ is_active: false }).eq('id', req.params.id);
  if (error) return res.status(400).json({ message: error.message });
  res.json({ message: 'Product removed from the shop' });
});

module.exports = router;
