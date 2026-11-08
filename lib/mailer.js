// Email integration via Resend REST API (no SDK needed).
// NOTE: on Vercel the function is frozen after the response is sent,
// so always `await` these calls before responding.

const { appUrl } = require('./appUrl');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Retries: a failed email is tried again up to 3 more times (waits 1s, 2s, 4s) when the problem is temporary:
// network error, rate limit (429) or a Resend server error (5xx). Errors like 403/422 (wrong sender or
// recipient) are not retried because trying again cannot fix them.
// There is no background queue (Vercel freezes the function after the response), so the retries happen
// inside this call. Override with MAIL_RETRIES (0 turns retrying off).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resend's shared test sender. It only delivers to the email address of the Resend account owner,
// so real students never receive anything until a domain is verified and MAIL_FROM is changed.
const DEFAULT_FROM = 'BICOL UNIVERSITY MERCHANDISE <onboarding@resend.dev>';

async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    console.log('[mail skipped]', subject, '->', to);
    return { skipped: true, reason: !key ? 'RESEND_API_KEY is not set' : 'no recipient address' };
  }
  const retries = (process.env.MAIL_RETRIES || '').trim() !== '' ? Math.max(0, parseInt(process.env.MAIL_RETRIES, 10) || 0) : 3;
  const body = JSON.stringify({
    from: process.env.MAIL_FROM || DEFAULT_FROM,
    to: [to], subject, html,
  });
  for (let attempt = 0; attempt <= retries; attempt++) {
    let temporary = true, why, status = 0;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
      });
      if (r.ok) {
        if (attempt) console.log(`[mail sent] "${subject}" -> ${to} (after ${attempt} ${attempt === 1 ? 'retry' : 'retries'})`);
        return { ok: true, attempts: attempt + 1 };
      }
      status = r.status;
      temporary = r.status === 429 || r.status >= 500;
      why = `${r.status} ${await r.text()}`;
    } catch (e) {
      why = e.message; // network problem
    }
    if (!temporary || attempt === retries) {
      console.error('[mail failed]', why, `(gave up after ${attempt + 1} ${attempt ? 'attempts' : 'attempt'})`);
      return { ok: false, attempts: attempt + 1, status, error: why };
    }
    const wait = 1000 * 2 ** attempt;
    console.error(`[mail retry] attempt ${attempt + 1} failed (${why.slice(0, 120)}). Trying again in ${wait / 1000}s`);
    await sleep(wait);
  }
}

const wrap = (title, body) => `
  <div style="background:#f1f7fc;padding:24px 12px;font-family:Arial,sans-serif">
    <div style="max-width:520px;margin:auto;background:#fff;border:1px solid #d8e6f2;border-radius:14px;overflow:hidden;color:#12324a">
      <div style="padding:22px 28px 0">
        <div style="font-size:22px;font-weight:bold;letter-spacing:.3px">BU <span style="color:#f28c28">Merch</span></div>
        <div style="height:3px;width:44px;background:#f28c28;border-radius:3px;margin-top:10px"></div>
      </div>
      <div style="padding:18px 28px 8px;font-size:15px;line-height:1.55">
        <h3 style="margin:0 0 14px;font-size:19px">${title}</h3>
        ${body}
      </div>
      <div style="padding:14px 28px;margin-top:12px;border-top:1px solid #e1ebf3;background:#f8fbfd;color:#5d7488;font-size:12px">
        Bicol University Merchandise
      </div>
    </div>
  </div>`;

const money = (n) => 'PHP ' + Number(n).toFixed(2);
const orderUrl = (o) => `${appUrl()}/order-status.html?order=${o.id}`;
const button = (o, label = 'View my order') =>
  `<p style="margin:22px 0"><a href="${orderUrl(o)}" style="background:#2b7bb9;color:#fff;padding:12px 26px;border-radius:999px;text-decoration:none;font-weight:bold;display:inline-block">${label}</a></p>`;

// Small summary box: order number, items and total
const summary = (o) => {
  const rows = (o.order_items || []).map((i) => `<tr>
      <td style="padding:6px 0;border-top:1px solid #e1ebf3">${esc(i.product_name)} <span style="color:#5d7488">&times; ${i.quantity}</span></td>
      <td style="padding:6px 0;border-top:1px solid #e1ebf3;text-align:right;white-space:nowrap">${money(i.unit_price * i.quantity)}</td></tr>`).join('');
  return `<div style="background:#f1f7fc;border-radius:10px;padding:14px 16px;margin:14px 0">
    <div style="font-size:12px;color:#5d7488;text-transform:uppercase;letter-spacing:.5px">Order</div>
    <div style="font-size:18px;font-weight:bold;margin-bottom:6px">#${o.order_no}</div>
    ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
      <tr><td style="padding:8px 0 0;border-top:2px solid #cfe0ee;font-weight:bold">Total</td><td style="padding:8px 0 0;border-top:2px solid #cfe0ee;text-align:right;font-weight:bold">${money(o.total)}</td></tr></table>` : ''}
  </div>`;
};

const chip = (text, bg = '#e6f2fb', fg = '#2b7bb9') =>
  `<span style="display:inline-block;background:${bg};color:${fg};font-size:13px;font-weight:bold;padding:4px 12px;border-radius:999px">${esc(text)}</span>`;

const PAY_LABEL = { gcash_online: 'Online payment', gcash_manual: 'GCash (send receipt)', onsite: 'Pay onsite' };

const STATUS_LABEL = {
  pending: 'Pending', approved: 'Approved', shipped: 'Shipped',
  ready_for_pickup: 'Ready for pickup', completed: 'Completed', cancelled: 'Cancelled',
};

// Where to pick up + the reminder note (order note overrides the campus default)
const pickupBlock = (o) => {
  if (!o.campus) return '';
  const note = o.pickup_note || o.campus.pickup_note;
  return `<div style="background:#fff4e6;border-left:4px solid #f28c28;padding:12px 16px;margin:16px 0;border-radius:8px">
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
      <p>Thank you! Your pre-order has been placed.</p>${summary(o)}
      <p>Payment method: <b>${esc(PAY_LABEL[o.payment_method] || o.payment_method)}</b></p>${pickupBlock(o)}
      <p>We will email you when it ships and when it is ready for pickup.</p>${button(o)}`),
  }),
  statusChanged: (o) => ({
    subject: `Order #${o.order_no}: ${STATUS_LABEL[o.status] || o.status}`,
    html: wrap('Order update: ' + esc(STATUS_LABEL[o.status] || o.status), `<p>Hi ${esc(o.profiles?.full_name)},</p>
      <p style="margin:0 0 12px">${chip(STATUS_LABEL[o.status] || o.status)}</p>
      ${(STATUS_COPY[o.status] || (() => ''))(o)}${summary(o)}
      ${['shipped', 'ready_for_pickup', 'approved'].includes(o.status) ? pickupBlock(o) : ''}
      ${o.pickup_date && !['completed', 'cancelled'].includes(o.status) ? `<p>Pickup date: <b>${esc(new Date(o.pickup_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</b></p>` : ''}${button(o)}`),
  }),
  pickupReminder: (o, kind) => {
    const when = o.pickup_date
      ? new Date(o.pickup_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : null;
    const lead = kind === 'overdue'
      ? `<p>Your order <b>#${o.order_no}</b> was ready for pickup${when ? ' on <b>' + esc(when) + '</b>' : ''} and has not been collected yet.</p>`
      : kind === 'upcoming'
        ? `<p>Friendly reminder: your order <b>#${o.order_no}</b> is ready to be picked up on <b>${esc(when)}</b>.</p>`
        : `<p>Your order <b>#${o.order_no}</b> is ready and waiting for you to pick it up.</p>`;
    return {
      subject: `Reminder: pick up your order #${o.order_no}`,
      html: wrap('Pickup reminder', `<p>Hi ${esc(o.profiles?.full_name)},</p>${lead}
        <p>Please bring your school ID and your order number (#${o.order_no}).</p>${pickupBlock(o)}${button(o)}`),
    };
  },
  paymentFailed: (o) => ({
    subject: `Payment not completed for order #${o.order_no}`,
    html: wrap('Payment not completed', `<p>Hi ${esc(o.profiles?.full_name)},</p>
      <p>Your online payment for order <b>#${o.order_no}</b> was not completed. You have not been charged for it.</p>
      <p>Your order is still reserved. Open it and press <b>Pay now</b> to try again, or choose another payment method by contacting the shop.</p>
      ${button(o, 'Open my order')}`),
  }),
  paymentReceived: (o) => ({
    subject: `Payment received for order #${o.order_no}`,
    html: wrap('Payment confirmed', `<p>Hi ${esc(o.profiles?.full_name)},</p>
      <p>We received your payment. Thank you!</p>${summary(o)}${pickupBlock(o)}${button(o)}`),
  }),
};

// What the admin sees in Admin > Shop status > Email delivery. Never includes the API key itself.
function mailStatus() {
  const hasKey = !!process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || DEFAULT_FROM;
  const sandbox = /@resend\.dev\s*>?\s*$/i.test(from);
  const url = appUrl();
  const problems = [];
  if (!hasKey) problems.push('RESEND_API_KEY is not set, so no emails are sent at all.');
  if (sandbox) problems.push('The sender is still Resend\'s test address, which can only deliver to the email of the Resend account owner. Verify a domain in Resend, then set MAIL_FROM to an address on that domain.');
  if (!url) problems.push('APP_URL is not set, so the links inside emails will not open the site.');
  return { has_key: hasKey, from, sandbox_sender: sandbox, app_url: url || null, ready: hasKey && !sandbox && !!url, problems };
}

// Sends one real email so the admin can confirm delivery. Returns a plain-language result.
async function sendTestEmail(to) {
  const st = mailStatus();
  if (!st.has_key) return { ok: false, message: 'RESEND_API_KEY is not set, so nothing can be sent. Add it to your environment variables and restart.' };
  const r = await sendMail({
    to, subject: 'BU Merch test email',
    html: wrap('Email delivery works', '<p>This is a test email from BU Merch. If you can read this, your Resend key and sender address are working.</p><p style="color:#5d7488;font-size:13px">Sent from: ' + esc(st.from) + '</p>'),
  });
  if (r.ok) return { ok: true, message: 'Test email sent to ' + to + '. Check the inbox and the spam folder.', sandbox_sender: st.sandbox_sender };
  const err = String(r.error || '');
  let hint = 'Check the Resend dashboard, Logs, for the reason.';
  if (r.status === 401 || r.status === 400 && /api key/i.test(err)) hint = 'The API key looks wrong or was revoked. Create a new key in Resend and update RESEND_API_KEY.';
  else if (r.status === 403 && /verify a domain|own email/i.test(err)) hint = 'Resend only lets the test sender deliver to the account owner\'s own email. Verify a domain in Resend and set MAIL_FROM to an address on it.';
  else if (r.status === 403 || r.status === 422) hint = 'Resend refused the sender address. MAIL_FROM must use a domain that is verified in Resend.';
  else if (r.status === 429) hint = 'Resend rate limit reached. Wait a minute and try again.';
  return { ok: false, message: 'Could not send the test email. ' + hint, detail: err.slice(0, 300) };
}

module.exports = { sendMail, templates, mailStatus, sendTestEmail };
