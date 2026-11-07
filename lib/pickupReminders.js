// Scheduled pickup reminders: emails students whose order is "ready for pickup" but not yet collected.
// Run once a day by Vercel Cron (see vercel.json) or by the timer in server.js when running locally.
// Safe to run as often as you like: every order is "claimed" in the database before the email is sent,
// so a student never gets the same reminder twice.
//
// Rules (all adjustable in .env):
//   - Order has a pickup date: remind on the day before and on the pickup day, then nudge every
//     REMINDER_INTERVAL_DAYS while it is overdue.
//   - No pickup date: remind when the order has been ready for REMINDER_INTERVAL_DAYS, then repeat.
//   - Never more than REMINDER_MAX reminders per order (a pickup-day-before reminder still counts).
const { admin } = require('./supabase');
const { sendMail, templates } = require('./mailer');
const { logEvent } = require('./orderEvents');

const INTERVAL = () => Math.max(1, parseInt(process.env.REMINDER_INTERVAL_DAYS, 10) || 3);
const MAX = () => Math.max(1, parseInt(process.env.REMINDER_MAX, 10) || 3);
const DAY = 86400000;

// Today's date in the Philippines (YYYY-MM-DD), because pickup_date is a plain calendar date.
const manilaToday = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY); // a - b in days

// Returns 'upcoming' | 'overdue' | 'waiting' when a reminder is due now, otherwise null.
function reminderDue(o, now = new Date()) {
  if (o.status !== 'ready_for_pickup') return null;
  const count = o.pickup_reminder_count || 0;
  if (count >= MAX()) return null;
  const today = manilaToday(now);
  const last = o.last_pickup_reminder_at ? new Date(o.last_pickup_reminder_at) : null;
  const sinceLast = last ? (now - last) / DAY : Infinity;

  if (o.pickup_date) {
    const left = dayDiff(o.pickup_date, today); // days until pickup
    if (left === 1 || left === 0) {
      const lastDay = last ? manilaToday(last) : null;
      // one reminder per day in the window; none if a reminder already went out today
      return lastDay !== today && (left === 0 || !lastDay || dayDiff(o.pickup_date, lastDay) > 1) ? 'upcoming' : null;
    }
    if (left < 0) return sinceLast >= INTERVAL() ? 'overdue' : null;
    return null; // pickup date is still far away
  }
  const readySince = new Date(o.updated_at);
  return (now - readySince) / DAY >= INTERVAL() && sinceLast >= INTERVAL() ? 'waiting' : null;
}

// Claim the order (compare-and-set on the counter), email the student, write it in the order history.
async function sendReminder(o, kind, actor) {
  const count = o.pickup_reminder_count || 0;
  const { data: claimed, error } = await admin.from('orders')
    .update({ pickup_reminder_count: count + 1, last_pickup_reminder_at: new Date().toISOString() })
    .eq('id', o.id).eq('pickup_reminder_count', count).eq('status', 'ready_for_pickup').select('id');
  if (error) throw new Error(error.message);
  if (!claimed?.length) return { skipped: 'already handled' };
  const to = o.profiles?.university_email;
  const mail = await sendMail({ to, ...templates.pickupReminder(o, kind) });
  await logEvent(o.id, { event: 'reminder', actor, note: `Pickup reminder emailed (${count + 1} of ${MAX()})` });
  return { sent: !mail.skipped && mail.ok !== false, to };
}

async function runPickupReminders(now = new Date()) {
  const { data, error } = await admin.from('orders')
    .select('*, profiles(full_name, university_email), campus:campuses(name, address, is_main, pickup_note)')
    .eq('status', 'ready_for_pickup').limit(500);
  if (error) throw new Error(error.message);
  const out = { checked: data.length, reminded: 0, failed: 0 };
  for (const o of data) {
    const kind = reminderDue(o, now);
    if (!kind) continue;
    try { const r = await sendReminder(o, kind); if (r.sent !== undefined) out.reminded++; }
    catch (e) { out.failed++; console.error('[reminders]', o.order_no, e.message); }
  }
  return out;
}

module.exports = { runPickupReminders, sendReminder, reminderDue, manilaToday };
