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
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden">
    <div style="background:#6f42c1;color:#fff;padding:16px 20px;font-size:18px">MerchSys</div>
    <div style="padding:20px"><h3 style="margin-top:0">${title}</h3>${body}</div>
  </div>`;

const STATUS_LABEL = {
  pending: 'Pending', approved: 'Approved', ready_for_pickup: 'Ready for pickup',
  completed: 'Completed', cancelled: 'Cancelled',
};

const templates = {
  orderPlaced: (o) => ({
    subject: `Order #${o.order_no} received`,
    html: wrap('We received your pre-order', `<p>Hi ${esc(o.profiles?.full_name)},</p>
      <p>Your order <b>#${o.order_no}</b> (total <b>PHP ${Number(o.total).toFixed(2)}</b>) has been placed.</p>
      <p>Payment method: ${esc(o.payment_method)}. We will email you when its status changes.</p>`),
  }),
  statusChanged: (o) => ({
    subject: `Order #${o.order_no} is now ${STATUS_LABEL[o.status] || o.status}`,
    html: wrap('Order status update', `<p>Hi ${esc(o.profiles?.full_name)},</p>
      <p>Your order <b>#${o.order_no}</b> is now <b>${esc(STATUS_LABEL[o.status] || o.status)}</b>.</p>
      ${o.pickup_date ? `<p>Pickup date: <b>${esc(o.pickup_date)}</b></p>` : ''}`),
  }),
  paymentReceived: (o) => ({
    subject: `Payment received for order #${o.order_no}`,
    html: wrap('Payment confirmed', `<p>Hi ${esc(o.profiles?.full_name)},</p>
      <p>We received your payment of <b>PHP ${Number(o.total).toFixed(2)}</b> for order <b>#${o.order_no}</b>.</p>`),
  }),
};

module.exports = { sendMail, templates };
