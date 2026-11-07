const { admin } = require('./supabase');
const { sendMail, templates } = require('./mailer');

const gateway = require('./gateway');

const ORDER_SELECT = '*, order_items(*), profiles(full_name, university_email, course, student_id, year_level, block, phone), campus:campuses(name, address, is_main, pickup_note)';

async function getOrder(id) {
  const { data } = await admin.from('orders').select(ORDER_SELECT).eq('id', id).single();
  return data;
}

// Saves a row in the payments table. A repeat of the same provider reference is ignored
// (unique index uq_payments_provider_ref), so calling this twice never creates a duplicate record.
async function recordPayment(row) {
  const { error } = await admin.from('payments').insert(row);
  if (error && error.code !== '23505') console.error('[payments] could not save payment record:', error.message);
  return !error;
}

// Idempotent: safe to call from the webhook, the verify endpoint and staff actions, any number of times.
// provider = 'maya' | 'paymongo' | 'manual' | 'onsite'
async function markPaid(orderId, providerRef, raw, provider) {
  const order = await getOrder(orderId);
  if (!order) return order;
  const via = provider || gateway.name() || 'online';

  // Money arrived for an order that was cancelled. Do not reopen the order, but keep a record so staff can refund it.
  if (order.status === 'cancelled') {
    if (providerRef) await recordPayment({ order_id: orderId, provider: via, provider_ref: providerRef, amount: order.total, status: 'refund_needed', raw: raw || null });
    console.warn(`[payments] order #${order.order_no} is cancelled but a payment arrived (${providerRef}). Refund needed.`);
    return order;
  }

  if (order.payment_status === 'paid') {
    // Already paid. If a DIFFERENT checkout was also paid, the student paid twice: keep a record so staff can refund it.
    if (providerRef) {
      const { data: rows } = await admin.from('payments').select('provider_ref').eq('order_id', orderId).eq('provider', via);
      if (!(rows || []).some((r) => r.provider_ref === providerRef)) {
        await recordPayment({ order_id: orderId, provider: via, provider_ref: providerRef, amount: order.total, status: 'duplicate', raw: raw || null });
        console.warn(`[payments] order #${order.order_no} was paid twice (${providerRef}). Refund needed.`);
      }
    }
    return order;
  }

  // Only ONE request can win this update, even if the webhook and the verify page run at the same moment.
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

  await recordPayment({ order_id: orderId, provider: via, provider_ref: providerRef || null, amount: order.total, status: 'paid', raw: raw || null });

  const fresh = await getOrder(orderId);
  const t = templates.paymentReceived(fresh);
  await sendMail({ to: fresh.profiles?.university_email, ...t });
  return fresh;
}

// The checkout expired or the student's payment attempt failed. Marks the order 'failed' once and emails the student.
// This is not final: if the student pays later (same or new checkout), markPaid still works.
async function markFailed(order, checkoutId, raw) {
  if (order.payment_status !== 'unpaid' || order.status === 'cancelled') return order;
  const { data: updated } = await admin.from('orders')
    .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', order.id).eq('payment_status', 'unpaid').select('id');
  if (!updated || !updated.length) return getOrder(order.id); // already handled by another request

  await recordPayment({ order_id: order.id, provider: gateway.name() || 'online', provider_ref: `failed:${checkoutId}`, amount: order.total, status: 'failed', raw: raw || null });
  const fresh = await getOrder(order.id);
  await sendMail({ to: fresh.profiles?.university_email, ...templates.paymentFailed(fresh) });
  return fresh;
}

// Ask the payment provider directly whether the checkout was paid (source of truth).
async function syncPayment(order) {
  if (!order?.checkout_id || order.payment_status === 'paid') return order;
  const result = await gateway.checkoutStatus(order.checkout_id);
  if (result.paid) return markPaid(order.id, result.ref, result.raw, gateway.name());
  if (result.failed) return markFailed(order, order.checkout_id, result.raw);
  return order;
}

// Used by the webhook. The payload only tells us a checkout id; everything else comes from the provider's own answer.
// Also handles an OLDER checkout of an order (the student clicked Pay twice), which would otherwise be lost.
async function syncByCheckoutId(checkoutId) {
  const result = await gateway.checkoutStatus(checkoutId);

  // Which order is this? Prefer what the provider says about the checkout, then fall back to our saved checkout id.
  let orderId = result.orderId || null;
  const { data: current } = await admin.from('orders').select('*').eq('checkout_id', checkoutId).maybeSingle();
  if (!orderId && current) orderId = current.id;
  if (!orderId) return null;

  if (result.paid) return markPaid(orderId, result.ref, result.raw, gateway.name()); // also records "paid twice"
  if (result.failed && current) return markFailed(current, checkoutId, result.raw);
  return null;
}

module.exports = { getOrder, markPaid, markFailed, syncPayment, syncByCheckoutId, ORDER_SELECT };
