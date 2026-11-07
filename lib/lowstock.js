// Automatic low-stock alerts.
// After any order or product change, this looks at every visible product. When a product newly drops to its
// "low-stock alert at" level (or sells out), it emails the shop admins and staff ONE message listing what changed.
// It will not email again for the same product until the stock has gone back above the level.
//
// Who gets the email:
//   - everyone with the role admin or staff, or
//   - only the addresses in LOW_STOCK_EMAIL in .env (comma separated), if you set it.
//
// Note: "what was already alerted" is remembered in memory. That is fine on a server that keeps running
// (npm run dev, a VPS). On Vercel each request may start fresh, so alerts can be missed or repeated there.

const { admin } = require('./supabase');
const { sendMail } = require('./mailer');

const seen = new Map();          // product id -> 'ok' | 'low' | 'out'
let running = false, again = false;

const stateOf = (p) => {
  if (Number(p.stock) <= 0) return 'out';
  return Number(p.stock) <= Number(p.low_stock_threshold ?? 5) ? 'low' : 'ok';
};

async function loadProducts() {
  const { data, error } = await admin.from('products').select('id, name, category, stock, low_stock_threshold').eq('is_active', true);
  if (error) throw error;
  return data || [];
}

async function recipients() {
  const fixed = (process.env.LOW_STOCK_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (fixed.length) return fixed;
  const { data } = await admin.from('profiles').select('university_email, role').in('role', ['admin', 'staff']);
  return (data || []).map((u) => u.university_email).filter((e) => e && !e.endsWith('@deleted.invalid'));
}

// Remember the current state at startup so a restart does not re-send old alerts
const ready = loadProducts()
  .then((list) => list.forEach((p) => seen.set(p.id, stateOf(p))))
  .catch((e) => console.error('[low-stock] could not read products at startup:', e.message));

async function run() {
  await ready;
  const list = await loadProducts();
  const fresh = [];
  const live = new Set();
  for (const p of list) {
    live.add(p.id);
    const now = stateOf(p), before = seen.get(p.id) || 'ok';
    if (now !== 'ok' && now !== before) fresh.push({ ...p, state: now }); // newly low, or low -> sold out
    seen.set(p.id, now);
  }
  for (const id of [...seen.keys()]) if (!live.has(id)) seen.delete(id); // hidden or removed products
  if (!fresh.length) return;

  const to = await recipients();
  if (!to.length) { console.warn('[low-stock] products are low but no admin/staff email was found'); return; }

  const base = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rows = fresh.map((p) => `<tr>
      <td style="padding:8px 10px;border-top:1px solid #e1ebf3">${esc(p.name)}<div style="color:#5d7488;font-size:12px">${esc(p.category)}</div></td>
      <td style="padding:8px 10px;border-top:1px solid #e1ebf3;text-align:center;font-weight:bold;color:${p.state === 'out' ? '#d4504b' : '#d97616'}">${p.state === 'out' ? 'Sold out' : p.stock + ' left'}</td>
      <td style="padding:8px 10px;border-top:1px solid #e1ebf3;text-align:center;color:#5d7488">${Number(p.low_stock_threshold ?? 5)}</td></tr>`).join('');
  const soldOut = fresh.filter((p) => p.state === 'out').length;
  const subject = soldOut
    ? `Stock alert: ${soldOut} sold out, ${fresh.length - soldOut} low`
    : `Low stock alert: ${fresh.length} product${fresh.length === 1 ? '' : 's'}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#12324a">
      <h2 style="margin-bottom:4px">BU <span style="color:#f28c28">Merch</span></h2>
      <p>These products just ran low. Restock them or close their pre-order.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#f1f7fc;color:#5d7488;font-size:12px"><th style="padding:8px 10px;text-align:left">Product</th><th style="padding:8px 10px">Stock</th><th style="padding:8px 10px">Alert level</th></tr>${rows}
      </table>
      <p style="margin:22px 0"><a href="${base}/admin.html" style="background:#2b7bb9;color:#fff;padding:11px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Open the admin page</a></p>
      <p style="color:#5d7488;font-size:12px">You get one alert per product. Another one is sent only after its stock goes back above the alert level and drops again.</p>
    </div>`;

  for (const addr of to) {
    try { await sendMail({ to: addr, subject, html }); } catch (e) { console.error('[low-stock] email to', addr, 'failed:', e.message); }
  }
  console.log('[low-stock] alert handled for', fresh.map((p) => `${p.name} (${p.state})`).join(', '), '->', to.length, 'recipient(s)');
}

// Safe to call often: runs one check at a time and re-checks once if called again meanwhile
async function checkLowStock() {
  if (running) { again = true; return; }
  running = true;
  try {
    do { again = false; await run(); } while (again);
  } catch (e) {
    console.error('[low-stock]', e.message);
  } finally { running = false; }
}

// Express middleware: after any successful change to orders or products, check the stock
function lowStockHook(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.on('finish', () => { if (res.statusCode < 400) checkLowStock(); });
  }
  next();
}

module.exports = { checkLowStock, lowStockHook };