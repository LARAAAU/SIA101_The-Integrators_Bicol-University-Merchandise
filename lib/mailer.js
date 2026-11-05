// Email integration via Resend REST API (no SDK needed).
// NOTE: on Vercel the function is frozen after the response is sent,
// so always `await` these calls before responding.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    console.log('[mail skipped]', subject, '->', to);
    return { skipped: true };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'MerchSys <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
      }),
    });
    if (!r.ok) console.error('[mail failed]', r.status, await r.text());
    return { ok: r.ok };
  } catch (e) {
    console.error('[mail error]', e.message);
    return { ok: false };
  }
}

const wrap = (title, body) => `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #d8e6f2;border-radius:12px;overflow:hidden">
    <div style="background:#2b7bb9;color:#fff;padding:16px 20px;font-size:18px">BU Merch</div>
    <div style="padding:20px;color:#12324a"><h3 style="margin-top:0">${title}</h3>${body}</div>
    <div style="background:#e6f2fb;padding:10px 20px;font-size:12px;color:#5d7488">Sent by MerchSys</div>
  </div>`;

const PAY_LABEL = { gcash_online: 'Online payment', gcash_manual: 'GCash (send receipt)', onsite: 'Pay onsite' };

const STATUS_LABEL = {
  pending: 'Pending', approved: 'Approved', shipped: 'Shipped',
  ready_for_pickup: 'Ready for pickup', completed: 'Completed', cancelled: 'Cancelled',
};

// Where to pick up + the reminder note (order note overrides the campus default)
const pickupBlock = (o) => {
  if (!o.campus) return '';
  const note = o.pickup_note || o.campus.pickup_note;
  return `<div style="background:#fff4e6;border-left:4px solid #f28c28;padding:10px 14px;margin:14px 0;border-radius:6px">
    <b>Pickup location:</b> ${esc(o.campus.name)}${o.campus.address ? '<br>' + esc(o.campus.address) : ''}
    ${note ? '<br><br>' + esc(note) : ''}</div>`;
};

const STATUS_COPY = {
  approved: (o) => '<p>Your order is confirmed and being prepared.</p>',
  shipped: (o) => `<p>Good news! Your order is <b>on its way to ${esc(o.campus?.name || 'your campus')}</b>. We will email you again once it arrives.</p>`,
  ready_for_pickup: (o) => `<p>Your order has <b>arrived and is ready for pickup</b>. Bring your school ID and your order number (#${o.order_no}).</p>`,
  completed: () => '<p>Your order was picked up. Thank you for supporting BU merch!</p>',
  cancelled: () => '<p>Your order was cancelled and the items were returned to stock.</p>',
  pending: () => '<p>Your order is waiting for confirmation.</p>',
};

const templates = {
  orderPlaced: (o) => ({
    subject: `Order #${o.order_no} received`,
    html: wrap('We received your pre-order', `<p>Hi ${esc(o.profiles?.full_name)},</p>
      <p>Your order <b>#${o.order_no}</b> (total <b>PHP ${Number(o.total).toFixed(2)}</b>) has been placed.</p>
      <p>Payment method: ${esc(PAY_LABEL[o.payment_method] || o.payment_method)}.</p>${pickupBlock(o)}
      <p>We will email you when it ships and when it is ready for pickup.</p>`),
  }),
  statusChanged: (o) => ({
    subject: `Order #${o.order_no}: ${STATUS_LABEL[o.status] || o.status}`,
    html: wrap('Order update: ' + esc(STATUS_LABEL[o.status] || o.status), `<p>Hi ${esc(o.profiles?.full_name)},</p>
      ${(STATUS_COPY[o.status] || (() => ''))(o)}
      ${['shipped', 'ready_for_pickup', 'approved'].includes(o.status) ? pickupBlock(o) : ''}
      ${o.pickup_date ? `<p>Pickup date: <b>${esc(o.pickup_date)}</b></p>` : ''}`),
  }),
  paymentReceived: (o) => ({
    subject: `Payment received for order #${o.order_no}`,
    html: wrap('Payment confirmed', `<p>Hi ${esc(o.profiles?.full_name)},</p>
      <p>We received your payment of <b>PHP ${Number(o.total).toFixed(2)}</b> for order <b>#${o.order_no}</b>.</p>${pickupBlock(o)}`),
  }),
};

module.exports = { sendMail, templates };
