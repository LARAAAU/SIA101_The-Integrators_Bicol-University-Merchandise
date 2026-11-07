const router = require('express').Router();
const { admin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const gateway = require('../lib/gateway');
const { getOrder, syncPayment, syncByCheckoutId } = require('../lib/payments');

const inFlight = new Set(); // orders that are creating a checkout right now

// POST /api/payments/checkout  { order_id }  -> { checkout_url }
// Creates a hosted checkout page with the payment provider (Maya or PayMongo) and returns its URL.
router.post('/checkout', requireAuth, async (req, res) => {
  if (!gateway.configured()) return res.status(500).json({ message: 'Online payment is not configured' });

  const order = await getOrder(req.body.order_id);
  if (!order || order.student_id !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  if (order.payment_method !== 'gcash_online') return res.status(400).json({ message: 'Order is not set to online payment' });
  if (order.payment_status === 'paid') return res.status(400).json({ message: 'Order is already paid' });
  if (order.status === 'cancelled') return res.status(400).json({ message: 'Order was cancelled' });

  // One checkout request per order at a time (double click, two tabs)
  if (inFlight.has(order.id)) return res.status(429).json({ message: 'Please wait a moment, your payment page is being prepared.' });
  inFlight.add(order.id);
  try {
    // Before opening a NEW checkout, check the previous one. If it was already paid (the webhook may not have arrived yet),
    // stop here so the student is never asked to pay twice. Otherwise close the old page and continue.
    if (order.checkout_id) {
      const synced = await syncPayment(order);
      if (synced.payment_status === 'paid') return res.status(400).json({ message: 'Order is already paid' });
      await gateway.expireCheckout(order.checkout_id);
    }

    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const page = `${base}/order-status.html?order=${order.id}`;
    try {
      const { id, url } = await gateway.createCheckout(order, { successUrl: page + '&paid=1', failureUrl: page, cancelUrl: page });
      // A new attempt starts clean: 'failed' goes back to 'unpaid'
      await admin.from('orders').update({ checkout_id: id, payment_status: 'unpaid', updated_at: new Date().toISOString() }).eq('id', order.id).in('payment_status', ['unpaid', 'failed']);
      res.json({ checkout_url: url });
    } catch (e) {
      console.error('[checkout]', e.message);
      res.status(502).json({ message: e.message || 'Payment provider error' });
    }
  } finally {
    inFlight.delete(order.id);
  }
});

// GET /api/payments/verify/:orderId
// Asks the provider directly if the checkout is paid. Works locally where webhooks cannot reach.
router.get('/verify/:orderId', requireAuth, async (req, res) => {
  const order = await getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.student_id !== req.user.id && !['staff', 'admin'].includes(req.user.role))
    return res.status(403).json({ message: 'Not your order' });
  const fresh = await syncPayment(order);
  res.json({ payment_status: fresh.payment_status, status: fresh.status });
});

// POST /api/payments/webhook  (PayMongo -> MerchSys; Maya uses the verify flow instead)
// We never trust the payload: we read the checkout id, then confirm with the provider's API.
router.post('/webhook', async (req, res) => {
  try {
    const eventType = req.body?.data?.attributes?.type;
    const checkoutId = req.body?.data?.attributes?.data?.id;
    // Repeated deliveries of the same event are harmless: markPaid only acts once per payment.
    if (eventType === 'checkout_session.payment.paid' && checkoutId) await syncByCheckoutId(checkoutId);
  } catch (e) {
    console.error('[webhook]', e.message);
  }
  res.status(200).json({ received: true });
});

module.exports = router;
