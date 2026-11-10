// Payment gateway adapter.
// Maya Checkout (sandbox by default; public test keys are published in Maya's docs).
// The rest of the app only talks to this file, so it never needs to know the provider details.

const MAYA_URL = () => (process.env.MAYA_API_URL || 'https://pg-sandbox.paymaya.com').replace(/\/$/, '');
const basic = (key) => 'Basic ' + Buffer.from(`${key}:`).toString('base64');

function name() {
  return process.env.MAYA_PUBLIC_KEY && process.env.MAYA_SECRET_KEY ? 'maya' : null;
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
      requestReferenceNumber: `BU Merch-${order.order_no}-${Date.now()}`, // must be unique per checkout
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

  return { paid: false, failed: false };
}

module.exports = { name, configured, createCheckout, checkoutStatus };
