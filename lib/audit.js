// Audit log: records what admin and staff do, so there is a trail of who changed what and when.
// No SQL needed. Each log entry is saved as a tiny JSON file in a private Supabase Storage bucket
// called "audit-logs" (the server creates the bucket by itself the first time).
//
// Connect it once in api/index.js, AFTER express.json() and BEFORE the routes:
//     const { auditHook } = require('../lib/audit');
//     app.use('/api', auditHook);
//
// It records every successful change made by a staff or admin account. It never records passwords or tokens,
// and students' own actions are not logged.

const crypto = require('crypto');
const { admin } = require('./supabase');

const BUCKET = 'audit-logs';

/* ---------------- storage ---------------- */
let bucketReady = null;
function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { error } = await admin.storage.createBucket(BUCKET, { public: false });
      if (error && !/already exists|duplicate/i.test(error.message || '')) throw error;
    })().catch((e) => { bucketReady = null; throw e; });
  }
  return bucketReady;
}

async function writeEntry(entry) {
  await ensureBucket();
  // Name = time first, so a newest-first listing is simply the names sorted backwards
  const name = String(Date.now()).padStart(13, '0') + '-' + crypto.randomBytes(3).toString('hex') + '.json';
  const { error } = await admin.storage.from(BUCKET).upload(name, Buffer.from(JSON.stringify(entry)), { contentType: 'application/json', upsert: false });
  if (error) throw error;
}

// Newest first. With q, scans up to 400 recent entries for matches in the person, action or item.
async function readEntries({ offset = 0, limit = 50, q = '' } = {}) {
  await ensureBucket();
  const bucket = admin.storage.from(BUCKET);
  const needle = String(q || '').trim().toLowerCase();
  const MAX_SCAN = needle ? 400 : limit;
  const rows = [];
  let pos = offset, scanned = 0;

  while (rows.length < limit && scanned < MAX_SCAN) {
    const take = Math.min(needle ? 50 : limit, MAX_SCAN - scanned);
    const { data: files, error } = await bucket.list('', { limit: take, offset: pos, sortBy: { column: 'name', order: 'desc' } });
    if (error) throw error;
    if (!files || !files.length) return { rows, next: null };

    const entries = await Promise.all(files.map(async (f) => {
      try { const { data } = await bucket.download(f.name); return { id: f.name, ...JSON.parse(await data.text()) }; } catch { return null; }
    }));
    for (const e of entries) {
      if (!e) continue;
      if (!needle || [e.actor_name, e.action, e.target_label].join(' ').toLowerCase().includes(needle)) rows.push(e);
    }
    pos += files.length; scanned += files.length;
    if (files.length < take) return { rows, next: null };
  }
  return { rows, next: pos };
}

// Page-based read for the admin table -> { rows, page, limit, total, pages } (same shape as the other lists).
// Without a search the newest 5000 entries are counted from file names only (cheap) and just the 10 on the page are opened.
// With a search the newest 400 entries are scanned (kept for 20 seconds so flipping pages is quick).
const scanCache = new Map();
async function listNames(max) {
  await ensureBucket();
  const bucket = admin.storage.from(BUCKET);
  const names = [];
  while (names.length < max) {
    const take = Math.min(1000, max - names.length);
    const { data, error } = await bucket.list('', { limit: take, offset: names.length, sortBy: { column: 'name', order: 'desc' } });
    if (error) throw error;
    if (!data || !data.length) break;
    names.push(...data.map((f) => f.name));
    if (data.length < take) break;
  }
  return names;
}
async function openEntries(names) {
  const bucket = admin.storage.from(BUCKET);
  const out = await Promise.all(names.map(async (name) => {
    try { const { data } = await bucket.download(name); return { id: name, ...JSON.parse(await data.text()) }; } catch { return null; }
  }));
  return out.filter(Boolean);
}
async function readPage({ page = 1, limit = 10, q = '' } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const needle = String(q || '').trim().toLowerCase();
  let total, rows;
  if (!needle) {
    const names = await listNames(5000);
    total = names.length;
    rows = await openEntries(names.slice((pg - 1) * lim, pg * lim));
  } else {
    let hit = scanCache.get(needle);
    if (!hit || Date.now() - hit.at > 20000) {
      const names = await listNames(400);
      const all = [];
      for (let i = 0; i < names.length; i += 50) all.push(...await openEntries(names.slice(i, i + 50)));
      hit = { at: Date.now(), rows: all.filter((e) => [e.actor_name, e.action, e.target_label].join(' ').toLowerCase().includes(needle)) };
      scanCache.set(needle, hit);
      if (scanCache.size > 20) scanCache.delete(scanCache.keys().next().value);
    }
    total = hit.rows.length;
    rows = hit.rows.slice((pg - 1) * lim, pg * lim);
  }
  return { rows, page: pg, limit: lim, total, pages: Math.max(Math.ceil(total / lim), 1) };
}

/* ---------------- what we recognise ---------------- */
const RULES = [
  { m: 'PATCH',  re: /^\/api\/orders\/([^/]+)\/status$/,   action: 'Updated order status',   type: 'order' },
  { m: 'PATCH',  re: /^\/api\/orders\/([^/]+)\/payment$/,  action: 'Updated order payment',  type: 'order' },
  { m: 'POST',   re: /^\/api\/orders\/?$/,                 action: 'Placed an order',        type: 'order', noId: true },
  { m: 'POST',   re: /^\/api\/products\/?$/,               action: 'Added product',          type: 'product', noId: true },
  { m: 'PUT',    re: /^\/api\/products\/([^/]+)$/,         action: 'Edited product',         type: 'product' },
  { m: 'DELETE', re: /^\/api\/products\/([^/]+)$/,         action: 'Hid product',            type: 'product' },
  { m: 'POST',   re: /^\/api\/campuses\/?$/,               action: 'Added pickup location',  type: 'campus', noId: true },
  { m: 'PUT',    re: /^\/api\/campuses\/([^/]+)$/,         action: 'Edited pickup location', type: 'campus' },
  { m: 'DELETE', re: /^\/api\/campuses\/([^/]+)$/,         action: 'Hid pickup location',    type: 'campus' },
  { m: 'PATCH',  re: /^\/api\/users\/([^/]+)\/role$/,      action: 'Changed user role',      type: 'user' },
  { m: 'PUT',    re: /^\/api\/settings\/payment$/,         action: 'Updated GCash account',  type: 'setting', noId: true },
  { m: 'PUT',    re: /^\/api\/settings\/shop$/,            action: 'Updated shop status',    type: 'setting', noId: true },
];
const SKIP = [/^\/api\/auth\//, /^\/api\/payments\/webhook/, /^\/api\/audit/];
const SECRET = /pass|token|secret|key|authorization/i;

function cleanBody(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (SECRET.test(k) || v === undefined || v === null || v === '') continue;
    out[k] = typeof v === 'string' ? (v.length > 200 ? v.slice(0, 200) + '...' : v) : v;
  }
  return Object.keys(out).length ? out : null;
}

// A readable name for the thing that was changed (order number, product name, ...)
async function labelFor(type, id) {
  if (!id) return null;
  try {
    if (type === 'order') { const { data } = await admin.from('orders').select('order_no').eq('id', id).maybeSingle(); return data ? '#' + data.order_no : null; }
    if (type === 'product') { const { data } = await admin.from('products').select('name').eq('id', id).maybeSingle(); return data?.name || null; }
    if (type === 'campus') { const { data } = await admin.from('campuses').select('name').eq('id', id).maybeSingle(); return data?.name || null; }
    if (type === 'user') { const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle(); return data?.full_name || null; }
  } catch { /* the label is a nice-to-have */ }
  return null;
}

let warned = false;
async function record(req) {
  const u = req.user;
  if (!u || !['staff', 'admin'].includes(u.role)) return;           // only staff and admin actions
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
  if (SKIP.some((re) => re.test(path))) return;

  const rule = RULES.find((r) => r.m === req.method && r.re.test(path));
  const id = rule && !rule.noId ? (path.match(rule.re) || [])[1] : null;
  const type = rule?.type || null;

  let label = await labelFor(type, id);
  const body = cleanBody(req.body);
  if (!label && body?.name && (type === 'product' || type === 'campus')) label = String(body.name); // newly added item

  try {
    await writeEntry({
      created_at: new Date().toISOString(),
      actor_id: u.id, actor_name: u.full_name || u.university_email || null, actor_role: u.role,
      action: rule ? rule.action : `${req.method} ${path}`,
      target_type: type, target_id: id, target_label: label,
      details: body, ip: req.ip || null,
    });
  } catch (e) {
    if (!warned) { warned = true; console.error('[audit] could not save a log entry:', e.message); }
  }
}

// Express middleware: after a successful change, write the log entry (never slows or breaks the request)
function auditHook(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.on('finish', () => { if (res.statusCode < 400) record(req).catch((e) => console.error('[audit]', e.message)); });
  }
  next();
}

module.exports = { auditHook, readEntries, readPage };