// Pickup schedule: days open, time slots with a limit, and student bookings.
// No SQL needed. Everything is kept as small JSON files in a private Supabase Storage bucket
// called "pickup-schedule" (the server creates it by itself the first time):
//   config.json               the days open, closed dates, how far ahead students can book, and the time slots
//   bookings/<date>.json      which orders booked which slot on that date
//   orders/<orderId>.json     each order's chosen date and slot
// A booking also sets the order's existing pickup_date, so the rest of the system keeps working.
//
// Note: bookings are saved one at a time inside this server, which is right for one running server
// (npm run dev, a VPS). On Vercel, two students booking the very same second could both get the last place.

const { admin } = require('./supabase');

const BUCKET = 'pickup-schedule';
const TZ = 'Asia/Manila';

const DEFAULTS = {
  days: [1, 2, 3, 4, 5],            // Monday to Friday
  advance_days: 14,                 // students can book up to 14 days ahead
  closed: [],                       // dates like '2026-12-25'
  slots: [
    { start: '09:00', end: '10:00', capacity: 20 },
    { start: '10:00', end: '11:00', capacity: 20 },
    { start: '13:00', end: '14:00', capacity: 20 },
    { start: '14:00', end: '15:00', capacity: 20 },
  ],
};

const httpError = (status, message) => { const e = new Error(message); e.status = status; return e; };

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

async function exists(path) {
  await ensureBucket();
  const i = path.lastIndexOf('/');
  const dir = i >= 0 ? path.slice(0, i) : '';
  const name = path.slice(i + 1);
  const { data, error } = await admin.storage.from(BUCKET).list(dir, { limit: 5, search: name });
  if (error) throw error;
  return (data || []).some((f) => f.name === name);
}

// A missing file gives the fallback. A real read error is thrown, so a hiccup can never wipe the bookings.
async function readJson(path, fallback) {
  if (!(await exists(path))) return fallback;
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw error || new Error('Could not read ' + path);
  return JSON.parse(await data.text());
}

async function writeJson(path, obj) {
  await ensureBucket();
  const { error } = await admin.storage.from(BUCKET).upload(path, Buffer.from(JSON.stringify(obj)), { contentType: 'application/json', upsert: true });
  if (error) throw error;
}

// One booking change at a time
let chain = Promise.resolve();
function lock(fn) { const run = chain.then(() => fn()); chain = run.catch(() => {}); return run; }

/* ---------------- dates and times (Philippine time) ---------------- */
function manilaNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fmt12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------------- settings ---------------- */
function withIds(slots) {
  return slots.map((s) => ({
    id: s.start.replace(':', '') + '-' + s.end.replace(':', ''),
    start: s.start, end: s.end, capacity: Number(s.capacity),
    label: `${fmt12(s.start)}\u2013${fmt12(s.end)}`,
  }));
}

function validate(input) {
  const b = input || {};
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort();
  if (!days.length) throw httpError(400, 'Choose at least one day students can pick up.');
  const advance = Number(b.advance_days);
  if (!Number.isInteger(advance) || advance < 1 || advance > 60) throw httpError(400, 'Days ahead must be between 1 and 60.');
  const closed = [...new Set((Array.isArray(b.closed) ? b.closed : []).map((s) => String(s).trim()).filter(Boolean))];
  if (closed.some((d) => !DATE_RE.test(d) || isNaN(new Date(d + 'T12:00:00Z')))) throw httpError(400, 'Closed dates must look like 2026-12-25, one per line.');
  const raw = Array.isArray(b.slots) ? b.slots : [];
  if (!raw.length || raw.length > 12) throw httpError(400, 'Add between 1 and 12 time slots.');
  for (const s of raw) {
    if (!TIME_RE.test(s.start || '') || !TIME_RE.test(s.end || '')) throw httpError(400, 'Every time slot needs a start and an end time.');
    if (mins(s.start) >= mins(s.end)) throw httpError(400, 'A time slot must end after it starts.');
    const cap = Number(s.capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 500) throw httpError(400, 'Each slot needs a limit between 1 and 500 students.');
  }
  const slots = withIds(raw).sort((a, c) => mins(a.start) - mins(c.start));
  if (new Set(slots.map((s) => s.id)).size !== slots.length) throw httpError(400, 'Two time slots are the same.');
  return { days, advance_days: advance, closed: closed.sort(), slots };
}

async function getConfig() {
  const c = await readJson('config.json', null);
  const base = c || DEFAULTS;
  return { days: base.days, advance_days: base.advance_days, closed: base.closed || [], slots: withIds(base.slots) };
}

async function saveConfig(input) {
  const cfg = validate(input);
  await writeJson('config.json', cfg);
  return getConfig();
}

const isOpen = (date, cfg, now) =>
  cfg.days.includes(dow(date)) && !cfg.closed.includes(date) && date >= now.date && date <= addDays(now.date, cfg.advance_days);

/* ---------------- bookings ---------------- */
async function activeOrderIds(ids) {
  if (!ids.length) return new Set();
  const { data, error } = await admin.from('orders').select('id, status').in('id', ids);
  if (error) throw error;
  return new Set((data || []).filter((o) => o.status !== 'cancelled').map((o) => o.id)); // a cancelled order frees its place
}

// Open dates in the booking window, each with its slots and how many places are left
async function availability() {
  const cfg = await getConfig();
  const now = manilaNow();
  const dates = [];
  for (let i = 0; i <= cfg.advance_days; i++) dates.push(addDays(now.date, i));
  return Promise.all(dates.filter((d) => isOpen(d, cfg, now)).map(async (date) => {
    const file = await readJson(`bookings/${date}.json`, {});
    const active = await activeOrderIds([...new Set(Object.values(file).flat())]);
    const slots = cfg.slots.map((s) => {
      const booked = (file[s.id] || []).filter((id) => active.has(id)).length;
      const left = Math.max(s.capacity - booked, 0);
      const passed = date === now.date && mins(s.start) <= now.minutes;
      return { id: s.id, label: s.label, capacity: s.capacity, booked, left, status: passed ? 'passed' : left === 0 ? 'full' : 'available' };
    });
    return { date, slots };
  }));
}

const strip = (file, orderId) => { for (const k of Object.keys(file)) file[k] = file[k].filter((id) => id !== orderId); return file; };

function book(order, date, slotId) {
  return lock(async () => {
    const cfg = await getConfig();
    const now = manilaNow();
    if (!DATE_RE.test(date || '') || !isOpen(date, cfg, now)) throw httpError(400, 'That date is not open for pickup.');
    const slot = cfg.slots.find((s) => s.id === slotId);
    if (!slot) throw httpError(400, 'Choose a time slot.');
    if (date === now.date && mins(slot.start) <= now.minutes) throw httpError(400, 'That time slot has already started. Pick a later one.');

    const prev = await readJson(`orders/${order.id}.json`, null);
    if (prev && prev.date === date && prev.slot_id === slotId) return { date, slot_id: slotId, label: slot.label };

    const file = await readJson(`bookings/${date}.json`, {});
    const others = (file[slotId] || []).filter((id) => id !== order.id);
    const active = await activeOrderIds(others);
    if (active.size >= slot.capacity) throw httpError(409, 'That time slot is fully booked. Please choose another.');

    if (prev && prev.date !== date) {                                   // moving to another day: free the old place
      const old = await readJson(`bookings/${prev.date}.json`, {});
      await writeJson(`bookings/${prev.date}.json`, strip(old, order.id));
    }
    strip(file, order.id);
    file[slotId] = [...others, order.id];
    await writeJson(`bookings/${date}.json`, file);
    await writeJson(`orders/${order.id}.json`, { order_id: order.id, date, slot_id: slotId, label: slot.label, booked_at: new Date().toISOString() });

    const { error } = await admin.from('orders').update({ pickup_date: date }).eq('id', order.id);
    if (error) console.error('[pickup] could not set pickup_date:', error.message);
    return { date, slot_id: slotId, label: slot.label };
  });
}

async function orderBooking(orderId) {
  const b = await readJson(`orders/${orderId}.json`, null);
  return b ? { date: b.date, slot_id: b.slot_id, label: b.label } : null;
}

// For staff: who booked each slot on one day
async function dayDetail(date) {
  if (!DATE_RE.test(date || '')) throw httpError(400, 'Choose a date.');
  const cfg = await getConfig();
  const file = await readJson(`bookings/${date}.json`, {});
  const ids = [...new Set(Object.values(file).flat())];
  let byId = new Map();
  if (ids.length) {
    const { data, error } = await admin.from('orders').select('id, order_no, status, profiles(full_name, student_id)').in('id', ids);
    if (error) throw error;
    byId = new Map((data || []).filter((o) => o.status !== 'cancelled').map((o) => [o.id, o]));
  }
  return {
    date, open: cfg.days.includes(dow(date)) && !cfg.closed.includes(date),
    slots: cfg.slots.map((s) => ({
      id: s.id, label: s.label, capacity: s.capacity,
      orders: (file[s.id] || []).map((id) => byId.get(id)).filter(Boolean)
        .map((o) => ({ order_no: o.order_no, status: o.status, name: o.profiles?.full_name || '-', student_id: o.profiles?.student_id || '' }))
        .sort((a, c) => a.order_no - c.order_no),
    })),
  };
}

module.exports = { getConfig, saveConfig, availability, book, orderBooking, dayDetail };