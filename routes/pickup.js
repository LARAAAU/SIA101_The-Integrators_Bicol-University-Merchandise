const router = require('express').Router();
const { admin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const pickup = require('../lib/pickup');
const { logEvent } = require('../lib/orderEvents');

const isStaff = (u) => ['staff', 'admin'].includes(u.role);
const SCHEDULABLE = ['pending', 'approved', 'shipped', 'ready_for_pickup']; // not cancelled or completed

async function getOrder(id) {
  const { data } = await admin.from('orders').select('id, student_id, status, order_no').eq('id', id).maybeSingle();
  return data;
}

// GET /api/pickup/availability  -> open dates with their time slots and places left (staff and admin only)
router.get('/availability', requireAuth, async (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ message: 'Staff only' });
  res.json(await pickup.availability());
});

// GET /api/pickup/order/:id  -> the order's pickup date and slot, or null (the student who owns it, or staff)
router.get('/order/:id', requireAuth, async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order || (order.student_id !== req.user.id && !isStaff(req.user))) return res.status(404).json({ message: 'Order not found' });
  res.json(await pickup.orderBooking(order.id));
});

// POST /api/pickup/assign  { order_id, date, slot_id }   (admin only)
router.post('/assign', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only admins can set the pickup schedule' });
  const order = await getOrder(req.body?.order_id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (!SCHEDULABLE.includes(order.status)) return res.status(400).json({ message: 'This order is cancelled or already completed, so it cannot be scheduled.' });
  const before = await pickup.orderBooking(order.id);
  const result = await pickup.book(order, String(req.body.date || ''), String(req.body.slot_id || ''));
  if (!before || before.date !== result.date || before.slot_id !== result.slot_id) { // write it in the order history
    try {
      const pretty = new Date(result.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      await logEvent(order.id, { event: 'status', from: order.status, to: order.status, actor: req.user, note: 'Pickup scheduled: ' + pretty + ', ' + result.label });
    } catch (e) { console.error('[pickup] could not log event:', e.message); }
  }
  res.json(result);
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