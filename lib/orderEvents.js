// Order status timeline: a small history of what happened to an order, who did it, and when.
// Stored in the order_events table (db/migration-08-order-events.sql).
// If that table does not exist yet, logging is skipped quietly so ordering never breaks.
const { admin } = require('./supabase');

let warned = false;
const warn = (msg) => { if (!warned) { warned = true; console.error('[timeline]', msg, '(did you run db/migration-08-order-events.sql?)'); } };

// actor = req.user (student/staff/admin). Leave it out for automatic events (payment provider, system).
async function logEvent(orderId, { event, from, to, actor, note }) {
  try {
    const { error } = await admin.from('order_events').insert({
      order_id: orderId, event, from_status: from || null, to_status: to || null,
      actor_id: actor?.id || null, actor_role: actor?.role || 'system', note: note || null,
    });
    if (error) warn(error.message);
  } catch (e) { warn(e.message); }
}

// Oldest first. Staff and admin see names; students only see "You", "Shop staff" or "System".
async function getEvents(orderId, { forStaff = false } = {}) {
  try {
    const { data, error } = await admin.from('order_events')
      .select('id, event, from_status, to_status, actor_role, note, created_at, actor:profiles!actor_id(full_name)')
      .eq('order_id', orderId).order('created_at', { ascending: true });
    if (error) { warn(error.message); return []; }
    return (data || []).map((e) => {
      const name = e.actor?.full_name || null;
      let who;
      if (e.actor_role === 'system') who = 'System';
      else if (forStaff) who = (name || 'Unknown user') + (e.actor_role === 'student' ? ' (student)' : e.actor_role === 'admin' ? ' (admin)' : ' (staff)');
      else who = e.actor_role === 'student' ? 'You' : 'Shop staff';
      return { id: e.id, event: e.event, from_status: e.from_status, to_status: e.to_status, note: e.note, actor_role: e.actor_role, actor_label: who, created_at: e.created_at };
    });
  } catch (e) { warn(e.message); return []; }
}

module.exports = { logEvent, getEvents };
