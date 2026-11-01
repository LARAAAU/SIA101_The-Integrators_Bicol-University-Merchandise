const router = require('express').Router();
const { admin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { PAYMONGO, pmHeaders, getOrder, syncPayment } = require('../lib/payments');

// POST /api/payments/checkout  { order_id }  -> { checkout_url }
// Creates a PayMongo Checkout Session (GCash) and returns the hosted payment page URL.
router.post('/checkout', requireAuth, async (req, res) => {
  if (!process.env.PAYMONGO_SECRET_KEY) return res.status(500).json({ message: 'Online payment is not configured' });

  const order = await getOrder(req.body.order_id);
  if (!order || order.student_id !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  if (order.payment_method !== 'gcash_online') return res.status(400).json({ message: 'Order is not set to online payment' });
  if (order.payment_status === 'paid') return res.status(400).json({ message: 'Order is already paid' });
  if (order.status === 'cancelled') return res.status(400).json({ message: 'Order was cancelled' });

  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const body = {
    data: {
      attributes: {
        line_items: order.order_items.map((i) => ({
          currency: 'PHP', amount: Math.round(Number(i.unit_price) * 100), name: i.product_name, quantity: i.quantity,
        })),
        payment_method_types: ['gcash'],
        description: `MerchSys order #${order.order_no}`,
        metadata: { order_id: order.id },
        success_url: `${base}/order-status.html?order=${order.id}&paid=1`,
        cancel_url: `${base}/order-status.html?order=${order.id}`,
      },
    },
  };

  const r = await fetch(`${PAYMONGO}/checkout_sessions`, { method: 'POST', headers: pmHeaders(), body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(502).json({ message: json.errors?.[0]?.detail || 'Payment provider error' });

  const session = json.data;
  await admin.from('orders').update({ paymongo_checkout_id: session.id }).eq('id', order.id);
  res.json({ checkout_url: session.attributes.checkout_url });
});

// GET /api/payments/verify/:orderId
// Asks PayMongo directly if the session is paid. Works locally where webhooks cannot reach.
router.get('/verify/:orderId', requireAuth, async (req, res) => {
  const order = await getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.student_id !== req.user.id && !['staff', 'admin'].includes(req.user.role))
    return res.status(403).json({ message: 'Not your order' });
  const fresh = await syncPayment(order);
  res.json({ payment_status: fresh.payment_status, status: fresh.status });
});

// POST /api/payments/webhook  (PayMongo -> MerchSys)
// We never trust the payload itself: we only read the session id from it,
// then confirm with PayMongo's API before marking anything paid.
router.post('/webhook', async (req, res) => {
  try {
    const eventType = req.body?.data?.attributes?.type;
    const sessionId = req.body?.data?.attributes?.data?.id;
    if (eventType === 'checkout_session.payment.paid' && sessionId) {
      const { data: order } = await admin.from('orders').select('*').eq('paymongo_checkout_id', sessionId).maybeSingle();
      if (order) await syncPayment(order);
    }
  } catch (e) {
    console.error('[webhook]', e.message);
  }
  res.status(200).json({ received: true }); // always 200 so PayMongo does not retry endlessly
});

module.exports = router;
