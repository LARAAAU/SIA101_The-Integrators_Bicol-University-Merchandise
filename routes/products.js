const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { admin } = require('../lib/supabase');
const { staffOnly } = require('../middleware/auth');
const { detectImage, badImage } = require('../lib/imageCheck');
const { parsePage, envelope, cleanSearch, LEGACY_CAP } = require('../lib/paginate');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(Object.assign(new Error('Only image files are allowed'), { status: 400 })),
});

async function uploadImage(file) {
  const kind = detectImage(file.buffer); // trust the file contents, not the name or the client's mimetype
  if (!kind) throw badImage();
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${kind.ext}`;
  const { error } = await admin.storage.from('product-images').upload(name, file.buffer, { contentType: kind.mime });
  if (error) throw new Error('Image upload failed: ' + error.message);
  return admin.storage.from('product-images').getPublicUrl(name).data.publicUrl;
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

function parseBody(b) {
  const out = {};
  // sizes: "S,M,L" -> ['S','M','L'] (sorted small to large). An empty value means "this item has no sizes".
  if (b.sizes !== undefined) {
    const want = [...new Set(String(b.sizes).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))];
    out.sizes = want.sort((a, c) => (SIZE_ORDER.indexOf(a) + 99) % 99 - (SIZE_ORDER.indexOf(c) + 99) % 99);
  }
  if (b.name !== undefined) out.name = String(b.name).trim();
  if (b.description !== undefined) out.description = b.description;
  if (b.category !== undefined) out.category = b.category;
  if (b.price !== undefined) out.price = Number(b.price);
  if (b.stock !== undefined) out.stock = parseInt(b.stock, 10);
  if (b.low_stock_threshold !== undefined) out.low_stock_threshold = parseInt(b.low_stock_threshold, 10);
  if (b.preorder_deadline !== undefined) out.preorder_deadline = b.preorder_deadline || null;
  if (b.is_active !== undefined) out.is_active = b.is_active === true || b.is_active === 'true';
  return out;
}

const CATEGORIES = ['Clothes', 'Bags', 'Caps', 'Pins', 'Others'];
const invalid = (p) =>
  (p.sizes !== undefined && p.sizes.some((x) => !SIZE_ORDER.includes(x))) ||
  (p.category !== undefined && !CATEGORIES.includes(p.category)) || (p.name !== undefined && !p.name) || (p.price !== undefined && !(p.price >= 0)) || (p.stock !== undefined && !(p.stock >= 0));

// If the sizes column is missing, tell the admin what to do instead of showing a database error
const dbMessage = (error) => (/sizes/i.test(error.message) && /column|schema cache/i.test(error.message)
  ? 'Sizes are not set up yet. Run db/migration-15-product-sizes.sql in the Supabase SQL Editor, then try again.' : error.message);

// GET /api/products  (public; CDN-cached for speed). Optional ?page=&limit= (max 100); without them the shop gets up to 500 products.
router.get('/', async (req, res) => {
  const pg = parsePage(req);
  let query = admin.from('products').select('*', pg.paged ? { count: 'exact' } : undefined).eq('is_active', true).order('created_at', { ascending: false });
  query = pg.paged ? query.range(pg.from, pg.to) : query.limit(500);
  const { data, count, error } = await query;
  if (error) return res.status(500).json({ message: error.message });
  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  res.json(pg.paged ? envelope(data, count, pg) : data);
});

// GET /api/products/all  (staff/admin, includes inactive)  ?q=&category=&page=&limit=
router.get('/all', staffOnly, async (req, res) => {
  const pg = parsePage(req);
  let query = admin.from('products').select('*', pg.paged ? { count: 'exact' } : undefined).order('created_at', { ascending: false });
  if (CATEGORIES.includes(req.query.category)) query = query.eq('category', req.query.category);
  const q = cleanSearch(req.query.q);
  if (q) query = query.ilike('name', `%${q}%`);
  query = pg.paged ? query.range(pg.from, pg.to) : query.limit(LEGACY_CAP);
  const { data, count, error } = await query;
  if (error) return res.status(500).json({ message: error.message });
  res.json(pg.paged ? envelope(data, count, pg) : data);
});

// POST /api/products  (multipart: image + fields)
router.post('/', staffOnly, upload.single('image'), async (req, res) => {
  const p = parseBody(req.body);
  if (!p.name || invalid(p) || p.price === undefined) return res.status(400).json({ message: 'Name and a valid price are required' });
  if (req.file) { try { p.image_url = await uploadImage(req.file); } catch (e) { return res.status(e.status || 500).json({ message: e.message }); } }
  const { data, error } = await admin.from('products').insert(p).select().single();
  if (error) return res.status(400).json({ message: dbMessage(error) });
  res.status(201).json(data);
});

// PUT /api/products/:id
router.put('/:id', staffOnly, upload.single('image'), async (req, res) => {
  const p = parseBody(req.body);
  if (invalid(p)) return res.status(400).json({ message: 'Invalid product data' });
  if (req.file) { try { p.image_url = await uploadImage(req.file); } catch (e) { return res.status(e.status || 500).json({ message: e.message }); } }
  const { data, error } = await admin.from('products').update(p).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ message: dbMessage(error) });
  res.json(data);
});

// DELETE /api/products/:id  (soft delete so old orders keep their history)
router.delete('/:id', staffOnly, async (req, res) => {
  const { error } = await admin.from('products').update({ is_active: false }).eq('id', req.params.id);
  if (error) return res.status(400).json({ message: error.message });
  res.json({ message: 'Product removed from the shop' });
});

module.exports = router;
