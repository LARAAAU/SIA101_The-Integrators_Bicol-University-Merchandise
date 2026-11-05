const { admin } = require('./supabase');
const { sendMail, templates } = require('./mailer');

const gateway = require('./gateway');

const ORDER_SELECT = '*, order_items(*), profiles(full_name, university_email, course, student_id, year_level, block, phone), campus:campuses(name, address, is_main, pickup_note)';

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
    order_id: orderId, provider: gateway.name() || 'online', provider_ref: providerRef || null,
    amount: order.total, status: 'paid', raw: raw || null,
  });

  const fresh = await getOrder(orderId);
  const t = templates.paymentReceived(fresh);
  await sendMail({ to: fresh.profiles?.university_email, ...t });
  return fresh;
}

// Ask the payment provider directly whether the checkout was paid (source of truth).
async function syncPayment(order) {
  if (!order?.checkout_id || order.payment_status === 'paid') return order;
  const result = await gateway.checkoutStatus(order.checkout_id);
  if (result.paid) return markPaid(order.id, result.ref, result.raw);
  return order;
}

module.exports = { getOrder, markPaid, syncPayment, ORDER_SELECT };
