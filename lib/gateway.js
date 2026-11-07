// Payment gateway adapter.
//   maya     -> Maya Checkout (sandbox by default; public test keys are published in Maya's docs)
//   paymongo -> PayMongo Checkout Sessions (GCash)
// The provider is picked from the environment, so the rest of the app never cares which one is used.

const MAYA_URL = () => (process.env.MAYA_API_URL || 'https://pg-sandbox.paymaya.com').replace(/\/$/, '');
const PAYMONGO_URL = 'https://api.paymongo.com/v1';
const basic = (key) => 'Basic ' + Buffer.from(`${key}:`).toString('base64');

function name() {
  const forced = (process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  if (forced === 'maya' || forced === 'paymongo') return forced;
  if (process.env.MAYA_PUBLIC_KEY && process.env.MAYA_SECRET_KEY) return 'maya';
  if (process.env.PAYMONGO_SECRET_KEY) return 'paymongo';
  return null;
}
const configured = () => name() !== null;

// Creates a hosted checkout page for an order. Returns { id, url }.
async function createCheckout(order, { successUrl, failureUrl, cancelUrl }) {
  const provider = name();

  if (provider === 'maya') {
    const body = {
      totalAmount: { value: Number(order.total), currency: 'PHP' },
      items: order.order_items.map((i) => ({
        name: i.product_name,
        quantity: i.quantity,
        amount: { value: Number(i.unit_price) },
        totalAmount: { value: Number(i.unit_price) * i.quantity },
      })),
      redirectUrl: { success: successUrl, failure: failureUrl, cancel: cancelUrl },
      requestReferenceNumber: `MERCHSYS-${order.order_no}-${Date.now()}`, // must be unique per checkout
      metadata: { order_id: order.id },
    };
    const r = await fetch(`${MAYA_URL()}/checkout/v1/checkouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: basic(process.env.MAYA_PUBLIC_KEY) }, // Create Checkout uses the PUBLIC key
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok || !json.checkoutId) throw new Error(json.message || 'Payment provider error');
    return { id: json.checkoutId, url: json.redirectUrl };
  }

  if (provider === 'paymongo') {
    const body = {
      data: {
        attributes: {
          line_items: order.order_items.map((i) => ({ currency: 'PHP', amount: Math.round(Number(i.unit_price) * 100), name: i.product_name, quantity: i.quantity })),
          payment_method_types: ['gcash'],
          description: `MerchSys order #${order.order_no}`,
          metadata: { order_id: order.id },
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
      },
    };
    const r = await fetch(`${PAYMONGO_URL}/checkout_sessions`, {
      method: 'POST',
      headers: { Authorization: basic(process.env.PAYMONGO_SECRET_KEY), 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.errors?.[0]?.detail || 'Payment provider error');
    return { id: json.data.id, url: json.data.attributes.checkout_url };
  }

  throw new Error('Online payment is not configured');
}

// Asks the provider directly whether a checkout was paid (the source of truth). Returns { paid, ref, raw }.
async function checkoutStatus(checkoutId) {
  const provider = name();

  if (provider === 'maya') {
    const r = await fetch(`${MAYA_URL()}/checkout/v1/checkouts/${checkoutId}`, { headers: { Authorization: basic(process.env.MAYA_SECRET_KEY) } }); // Retrieve uses the SECRET key
    if (!r.ok) return { paid: false, failed: false };
    const s = await r.json();
    const failed = ['PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'AUTH_FAILED'].includes(s.paymentStatus) || s.status === 'EXPIRED';
    return {
      paid: s.paymentStatus === 'PAYMENT_SUCCESS', failed, orderId: s.metadata?.order_id || null,
      ref: s.transactionReferenceNumber || s.receiptNumber || checkoutId, raw: s,
    };
  }

  if (provider === 'paymongo') {
    const r = await fetch(`${PAYMONGO_URL}/checkout_sessions/${checkoutId}`, { headers: { Authorization: basic(process.env.PAYMONGO_SECRET_KEY), accept: 'application/json' } });
    if (!r.ok) return { paid: false, failed: false };
    const session = (await r.json()).data;
    const attrs = session?.attributes || {};
    const payments = attrs.payments || [];
    const paid = payments.some((p) => p.attributes?.status === 'paid') || attrs.payment_intent?.attributes?.status === 'succeeded';
    const failed = !paid && (attrs.status === 'expired' || payments.some((p) => p.attributes?.status === 'failed'));
    return { paid, failed, orderId: attrs.metadata?.order_id || null, ref: payments.find((p) => p.attributes?.status === 'paid')?.id || payments[0]?.id || checkoutId, raw: session };
  }

  return { paid: false, failed: false };
}

// Best effort: close an old checkout page so the student cannot pay the same order twice.
// PayMongo supports this. Maya has no such call, so the paid-twice record in payments covers it.
async function expireCheckout(checkoutId) {
  if (name() !== 'paymongo' || !checkoutId) return;
  try {
    await fetch(`${PAYMONGO_URL}/checkout_sessions/${checkoutId}/expire`, { method: 'POST', headers: { Authorization: basic(process.env.PAYMONGO_SECRET_KEY), accept: 'application/json' } });
  } catch (e) { console.error('[gateway] could not expire old checkout:', e.message); }
}

module.exports = { name, configured, createCheckout, checkoutStatus, expireCheckout };
