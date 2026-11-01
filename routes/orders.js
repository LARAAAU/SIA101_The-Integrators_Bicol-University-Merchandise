const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { admin } = require('../lib/supabase');
const { requireAuth, staffOnly } = require('../middleware/auth');
const { sendMail, templates } = require('../lib/mailer');
const { getOrder, markPaid, syncPayment } = require('../lib/payments');

const STATUSES = ['pending', 'approved', 'ready_for_pickup', 'completed', 'cancelled'];
const PAYMENT_METHODS = ['gcash_online', 'gcash_manual', 'onsite'];
const LIST_SELECT = '*, order_items(*), profiles(full_name, university_email, course)';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(Object.assign(new Error('Receipt must be an image'), { status: 400 })),
});

const isStaff = (u) => u.role === 'staff' || u.role === 'admin';

async function withReceiptUrl(order) {
  if (order?.receipt_path) {
    const { data } = await admin.storage.from('receipts').createSignedUrl(order.receipt_path, 3600);
    order.receipt_url = data?.signedUrl || null;
  }
  return order;
}

// POST /api/orders  { items:[{product_id, quantity}], payment_method }
router.post('/', requireAuth, async (req, res) => {
  const { items, payment_method } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ message: 'Your cart is empty' });
  if (!PAYMENT_METHODS.includes(payment_method)) return res.status(400).json({ message: 'Invalid payment method' });

  const merged = {};
  for (const it of items) {
    const qty = parseInt(it.quantity, 10);
    if (!it.product_id || !(qty >= 1 && qty <= 50)) return res.status(400).json({ message: 'Invalid item or quantity' });
    merged[it.product_id] = (merged[it.product_id] || 0) + qty;
  }
  const clean = Object.entries(merged).map(([product_id, quantity]) => ({ product_id, quantity }));

  // Stock check + deduction + order insert happen in ONE database transaction (see db/schema.sql)
  const { data: orderId, error } = await admin.rpc('create_order', {
    p_student: req.user.id, p_items: clean, p_payment_method: payment_method,
  });
  if (error) return res.status(400).json({ message: error.message });

  const order = await getOrder(orderId);
  await sendMail({ to: req.user.university_email, ...templates.orderPlaced(order) });
  res.status(201).json(order);
});

// GET /api/orders/mine
router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await admin.from('orders').select('*, order_items(*)').eq('student_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ message: error.message });
  res.json(data);
});

// GET /api/orders  (staff/admin)  ?status=&payment_status=&q=
router.get('/', staffOnly, async (req, res) => {
  let query = admin.from('orders').select(LIST_SELECT).order('created_at', { ascending: false }).limit(300);
  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.payment_status) query = query.eq('payment_status', req.query.payment_status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ message: error.message });

  const q = (req.query.q || '').toLowerCase().trim();
  res.json(
    q
      ? data.filter((o) =>
          String(o.order_no).includes(q) ||
          o.profiles?.full_name?.toLowerCase().includes(q) ||
          o.profiles?.university_email?.toLowerCase().includes(q))
      : data
  );
});

// GET /api/orders/:id  (owner or staff). Also re-checks PayMongo if payment is still unpaid.
router.get('/:id', requireAuth, async (req, res) => {
  let order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.student_id !== req.user.id && !isStaff(req.user)) return res.status(403).json({ message: 'Not your order' });

  if (order.payment_method === 'gcash_online' && order.payment_status !== 'paid') order = await syncPayment(order);
  res.json(await withReceiptUrl(order));
});

// POST /api/orders/:id/receipt  (multipart: receipt + reference_number) for manual GCash
router.post('/:id/receipt', requireAuth, upload.single('receipt'), async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order || order.student_id !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  if (order.payment_method !== 'gcash_manual') return res.status(400).json({ message: 'This order does not use manual GCash payment' });
  if (!req.file || !req.body.reference_number?.trim()) return res.status(400).json({ message: 'Receipt image and reference number are required' });

  const filePath = `${req.user.id}/${order.id}-${Date.now()}${path.extname(req.file.originalname).toLowerCase() || '.jpg'}`;
  const { error: upErr } = await admin.storage.from('receipts').upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
  if (upErr) return res.status(500).json({ message: 'Receipt upload failed' });

  await admin.from('orders').update({
    receipt_path: filePath, reference_number: req.body.reference_number.trim(),
    payment_status: 'pending_verification', updated_at: new Date().toISOString(),
  }).eq('id', order.id);
  res.json(await getOrder(order.id));
});

// PATCH /api/orders/:id/status  { status, pickup_date? }  (staff/admin)
router.patch('/:id/status', staffOnly, async (req, res) => {
  const { status, pickup_date } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' });

  if (status === 'cancelled') {
    const { error } = await admin.rpc('cancel_order', { p_order: req.params.id });
    if (error) return res.status(400).json({ message: error.message });
  } else {
    const patch = { status, updated_at: new Date().toISOString() };
    if (pickup_date) patch.pickup_date = pickup_date;
    const { error } = await admin.from('orders').update(patch).eq('id', req.params.id);
    if (error) return res.status(400).json({ message: error.message });
  }
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  await sendMail({ to: order.profiles?.university_email, ...templates.statusChanged(order) });
  res.json(order);
});

// PATCH /api/orders/:id/payment  { payment_status }  (staff/admin) - verify manual GCash / confirm onsite cash
router.patch('/:id/payment', staffOnly, async (req, res) => {
  const { payment_status } = req.body;
  if (!['paid', 'unpaid', 'failed'].includes(payment_status)) return res.status(400).json({ message: 'Invalid payment status' });

  if (payment_status === 'paid') {
    const order = await markPaid(req.params.id, null, { verified_by: req.user.id });
    return res.json(order);
  }
  await admin.from('orders').update({ payment_status, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  res.json(await getOrder(req.params.id));
});

// POST /api/orders/:id/cancel  (owner while pending/unpaid)
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order || order.student_id !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  if (order.status !== 'pending' || order.payment_status === 'paid')
    return res.status(400).json({ message: 'Only pending, unpaid orders can be cancelled' });
  const { error } = await admin.rpc('cancel_order', { p_order: order.id });
  if (error) return res.status(400).json({ message: error.message });
  res.json(await getOrder(order.id));
});

module.exports = router;
