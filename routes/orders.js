const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { admin } = require('../lib/supabase');
const { requireAuth, staffOnly } = require('../middleware/auth');
const { sendMail, templates } = require('../lib/mailer');
const { getOrder, markPaid, syncPayment } = require('../lib/payments');
const { detectImage } = require('../lib/imageCheck');
const { logEvent, getEvents } = require('../lib/orderEvents');
const { sendReminder } = require('../lib/pickupReminders');
const { requireShopOpen } = require('../middleware/shopStatus');

const STATUSES = ['pending', 'approved', 'shipped', 'ready_for_pickup', 'completed', 'cancelled'];
// Allowed order flow. An order can move forward (skipping steps is fine) or be cancelled
// until it is completed. Completed and cancelled orders are final.
const FLOW = ['pending', 'approved', 'shipped', 'ready_for_pickup', 'completed'];
const canMove = (from, to) =>
  from === to ||
  (to === 'cancelled' && from !== 'completed' && from !== 'cancelled') ||
  (FLOW.includes(from) && FLOW.includes(to) && FLOW.indexOf(to) > FLOW.indexOf(from));

const PAYMENT_METHODS = ['gcash_online', 'gcash_manual', 'onsite'];
const LIST_SELECT = '*, order_items(*), profiles(full_name, university_email, course, student_id, year_level, block, phone), campus:campuses(name)';

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
router.post('/', requireAuth, requireShopOpen, async (req, res) => {
  const { items, payment_method, campus_id } = req.body;
  if (!campus_id) return res.status(400).json({ message: 'Please choose a pickup campus' });
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
    p_student: req.user.id, p_items: clean, p_payment_method: payment_method, p_campus: campus_id,
  });
  if (error) return res.status(400).json({ message: error.message });

  const order = await getOrder(orderId);
  await logEvent(orderId, { event: 'placed', to: 'pending', actor: req.user, note: 'Order placed' });
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
          o.profiles?.student_id?.toLowerCase().includes(q) ||
          o.profiles?.university_email?.toLowerCase().includes(q))
      : data
  );
});

// GET /api/orders/:id  (owner or staff). Also re-checks the payment provider if payment is still unpaid.
router.get('/:id', requireAuth, async (req, res) => {
  let order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.student_id !== req.user.id && !isStaff(req.user)) return res.status(403).json({ message: 'Not your order' });

  if (order.payment_method === 'gcash_online' && order.payment_status !== 'paid') order = await syncPayment(order);
  order.events = await getEvents(order.id, { forStaff: isStaff(req.user) }); // status timeline
  if (isStaff(req.user)) { // payment records (including paid-twice and refund-needed) are for staff only
    const { data: pays } = await admin.from('payments').select('provider, provider_ref, amount, status, created_at').eq('order_id', order.id).order('created_at');
    order.payments = pays || [];
  }
  res.json(await withReceiptUrl(order));
});

// POST /api/orders/:id/receipt  (multipart: receipt + reference_number) for manual GCash
router.post('/:id/receipt', requireAuth, upload.single('receipt'), async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order || order.student_id !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  if (order.payment_method !== 'gcash_manual') return res.status(400).json({ message: 'This order does not use manual GCash payment' });
  if (order.status === 'cancelled') return res.status(400).json({ message: 'This order was cancelled' });
  if (!['unpaid', 'failed'].includes(order.payment_status)) // paid orders must never go back to "pending verification"
    return res.status(400).json({ message: order.payment_status === 'paid' ? 'This order is already paid' : 'Your receipt is already waiting for verification' });
  if (!req.file || !req.body.reference_number?.trim()) return res.status(400).json({ message: 'Receipt image and reference number are required' });

  const kind = detectImage(req.file.buffer); // check the real file type, not just the label
  if (!kind) return res.status(400).json({ message: 'Receipt must be a JPG, PNG, GIF or WebP image' });
  const filePath = `${req.user.id}/${order.id}-${Date.now()}${kind.ext}`;
  const { error: upErr } = await admin.storage.from('receipts').upload(filePath, req.file.buffer, { contentType: kind.mime });
  if (upErr) return res.status(500).json({ message: 'Receipt upload failed' });

  await admin.from('orders').update({
    receipt_path: filePath, reference_number: req.body.reference_number.trim(),
    payment_status: 'pending_verification', updated_at: new Date().toISOString(),
  }).eq('id', order.id);
  await logEvent(order.id, { event: 'receipt', actor: req.user, note: 'Receipt uploaded, waiting for staff to verify' });
  res.json(await getOrder(order.id));
});

// PATCH /api/orders/:id/status  { status, pickup_date? }  (staff/admin)
router.patch('/:id/status', staffOnly, async (req, res) => {
  const { status, pickup_date, pickup_campus_id, pickup_note } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' });

  const current = await getOrder(req.params.id);
  if (!current) return res.status(404).json({ message: 'Order not found' });
  if (!canMove(current.status, status)) {
    const label = (s) => s.replace(/_/g, ' ');
    return res.status(400).json({ message: `An order that is ${label(current.status)} cannot be changed to ${label(status)}.` });
  }

  if (status === 'cancelled' && current.status === 'cancelled') return res.json(current); // already cancelled, nothing to do
  if (status === 'cancelled') {
    const { error } = await admin.rpc('cancel_order', { p_order: req.params.id });
    if (error) return res.status(400).json({ message: error.message });
  } else {
    const patch = { status, updated_at: new Date().toISOString() };
    if (pickup_date) patch.pickup_date = pickup_date;
    if (pickup_campus_id) patch.pickup_campus_id = pickup_campus_id; // e.g. redirect pickup to the Main Campus
    if (pickup_note !== undefined) patch.pickup_note = pickup_note || null;
    const { error } = await admin.from('orders').update(patch).eq('id', req.params.id);
    if (error) return res.status(400).json({ message: error.message });
  }
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  // Timeline: a status change, and/or a new pickup date (a date-only change is logged on its own line)
  const dateChanged = status !== 'cancelled' && pickup_date && pickup_date !== current.pickup_date;
  const prettyDate = dateChanged ? new Date(pickup_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const dateNote = dateChanged ? (current.pickup_date ? 'Pickup date changed to ' : 'Pickup date set to ') + prettyDate : null;
  if (status !== current.status) {
    await logEvent(order.id, { event: 'status', from: current.status, to: status, actor: req.user, note: dateNote });
  } else if (dateChanged) {
    await logEvent(order.id, { event: 'status', from: current.status, to: current.status, actor: req.user, note: dateNote });
  }
  await sendMail({ to: order.profiles?.university_email, ...templates.statusChanged(order) });
  res.json(order);
});

// PATCH /api/orders/:id/payment  { payment_status }  (staff/admin) - verify manual GCash / confirm onsite cash
router.patch('/:id/payment', staffOnly, async (req, res) => {
  const { payment_status } = req.body;
  if (!['paid', 'unpaid', 'failed'].includes(payment_status)) return res.status(400).json({ message: 'Invalid payment status' });

  const current = await getOrder(req.params.id);
  if (!current) return res.status(404).json({ message: 'Order not found' });
  if (current.status === 'cancelled') return res.status(400).json({ message: 'This order was cancelled' });

  if (payment_status === 'paid') {
    // Safe to press twice: a payment is only recorded once
    return res.json(await markPaid(current.id, null, { verified_by: req.user.id }, current.payment_method === 'onsite' ? 'onsite' : 'manual', req.user));
  }
  if (current.payment_status === 'paid' && req.user.role !== 'admin') // a confirmed payment can only be undone by an admin
    return res.status(409).json({ message: 'This order is already paid. Only an admin can change a confirmed payment.' });
  await admin.from('orders').update({ payment_status, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  if (payment_status !== current.payment_status)
    await logEvent(current.id, { event: 'payment', actor: req.user, note: payment_status === 'failed' ? 'Payment marked as failed (receipt rejected)' : 'Payment reset to unpaid' });
  res.json(await getOrder(req.params.id));
});

// POST /api/orders/:id/remind  (staff/admin) - email the pickup reminder right now
router.post('/:id/remind', staffOnly, async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.status !== 'ready_for_pickup') return res.status(400).json({ message: 'Reminders can only be sent for orders that are ready for pickup' });
  const kind = order.pickup_date ? 'upcoming' : 'waiting';
  const r = await sendReminder(order, kind, req.user);
  res.json({ message: r.skipped ? 'Reminder was just sent' : 'Reminder emailed', ...r });
});

// POST /api/orders/:id/cancel  (owner while pending/unpaid)
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order || order.student_id !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  if (order.status !== 'pending' || order.payment_status === 'paid')
    return res.status(400).json({ message: 'Only pending, unpaid orders can be cancelled' });
  const { error } = await admin.rpc('cancel_order', { p_order: order.id });
  if (error) return res.status(400).json({ message: error.message });
  await logEvent(order.id, { event: 'status', from: order.status, to: 'cancelled', actor: req.user, note: 'Cancelled by the student' });
  res.json(await getOrder(order.id));
});

module.exports = router;
