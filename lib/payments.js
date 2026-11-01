const { admin } = require('./supabase');
const { sendMail, templates } = require('./mailer');

const PAYMONGO = 'https://api.paymongo.com/v1';

const pmHeaders = () => ({
  Authorization: 'Basic ' + Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64'),
  'Content-Type': 'application/json',
  accept: 'application/json',
});

const ORDER_SELECT = '*, order_items(*), profiles(full_name, university_email)';

async function getOrder(id) {
  const { data } = await admin.from('orders').select(ORDER_SELECT).eq('id', id).single();
  return data;
}

// Idempotent: safe to call from both the webhook and the verify endpoint.
async function markPaid(orderId, providerRef, raw) {
  const order = await getOrder(orderId);
  if (!order || order.payment_status === 'paid') return order;

  const { data: updated } = await admin
    .from('orders')
    .update({
      payment_status: 'paid',
      status: order.status === 'pending' ? 'approved' : order.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .neq('payment_status', 'paid')
    .select('id');

  if (!updated || !updated.length) return getOrder(orderId); // someone else already did it

  await admin.from('payments').insert({
    order_id: orderId, provider: 'paymongo', provider_ref: providerRef || null,
    amount: order.total, status: 'paid', raw: raw || null,
  });

  const fresh = await getOrder(orderId);
  const t = templates.paymentReceived(fresh);
  await sendMail({ to: fresh.profiles?.university_email, ...t });
  return fresh;
}

// Ask PayMongo directly whether the checkout session was paid (source of truth).
async function syncPayment(order) {
  if (!order?.paymongo_checkout_id || order.payment_status === 'paid') return order;
  const r = await fetch(`${PAYMONGO}/checkout_sessions/${order.paymongo_checkout_id}`, { headers: pmHeaders() });
  if (!r.ok) return order;
  const session = (await r.json()).data;
  const attrs = session?.attributes || {};
  const payments = attrs.payments || [];
  const paid =
    payments.some((p) => p.attributes?.status === 'paid') ||
    attrs.payment_intent?.attributes?.status === 'succeeded';
  if (paid) return markPaid(order.id, payments[0]?.id, session);
  return order;
}

module.exports = { PAYMONGO, pmHeaders, getOrder, markPaid, syncPayment, ORDER_SELECT };
