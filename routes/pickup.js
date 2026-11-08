const router = require('express').Router();
const { admin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const pickup = require('../lib/pickup');
const { logEvent } = require('../lib/orderEvents');

const isStaff = (u) => ['staff', 'admin'].includes(u.role);
const SCHEDULABLE = ['pending', 'approved', 'shipped', 'ready_for_pickup']; // not cancelled or completed
const STUDENT_CAN_BOOK = ['approved', 'shipped', 'ready_for_pickup']; // a student picks a slot after the order is approved

async function getOrder(id) {
  const { data } = await admin.from('orders').select('id, student_id, status, order_no').eq('id', id).maybeSingle();
  return data;
}

// GET /api/pickup/availability  -> open dates with their time slots and places left (any logged-in user, so students can pick a slot)
// It only holds counts, never names of other students.
router.get('/availability', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await pickup.availability());
});

// GET /api/pickup/order/:id  -> the order's pickup date and slot, or null (the student who owns it, or staff)
router.get('/order/:id', requireAuth, async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order || (order.student_id !== req.user.id && !isStaff(req.user))) return res.status(404).json({ message: 'Order not found' });
  res.json(await pickup.orderBooking(order.id));
});

// Books (or changes) the pickup date and time slot of an order, and writes it in the order history
async function schedule(req, res, order, allowed) {
  if (!allowed.includes(order.status)) return res.status(400).json({ message: order.status === 'pending' ? 'You can choose a pickup schedule once your order is approved.' : 'This order is cancelled or already completed, so it cannot be scheduled.' });
  const before = await pickup.orderBooking(order.id);
  const result = await pickup.book(order, String(req.body.date || ''), String(req.body.slot_id || ''));
  if (!before || before.date !== result.date || before.slot_id !== result.slot_id) { // write it in the order history
    try {
      const pretty = new Date(result.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      await logEvent(order.id, { event: 'status', from: order.status, to: order.status, actor: req.user, note: 'Pickup scheduled: ' + pretty + ', ' + result.label });
    } catch (e) { console.error('[pickup] could not log event:', e.message); }
  }
  res.json(result);
}

// POST /api/pickup/assign  { order_id, date, slot_id }   (admin only, any order that is not cancelled or completed)
router.post('/assign', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only admins can set the pickup schedule for a student' });
  const order = await getOrder(req.body?.order_id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  await schedule(req, res, order, SCHEDULABLE);
});

// POST /api/pickup/book  { order_id, date, slot_id }   (the student who owns the order, once it is approved)
router.post('/book', requireAuth, async (req, res) => {
  const order = await getOrder(req.body?.order_id);
  if (!order || order.student_id !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  await schedule(req, res, order, STUDENT_CAN_BOOK);
});

// GET /api/pickup/config   (staff and admin)   PUT /api/pickup/config   (admin only)
router.get('/config', requireAuth, async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ message: 'Staff only' });
  res.json(await pickup.getConfig());
});
router.put('/config', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only admins can change the pickup schedule' });
  res.json(await pickup.saveConfig(req.body));
});

// GET /api/pickup/day/:date  -> who is coming, per slot   (staff and admin)
router.get('/day/:date', requireAuth, async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ message: 'Staff only' });
  res.json(await pickup.dayDetail(req.params.date));
});

module.exports = router;