const { admin } = require('./supabase');

const DEFAULTS = { is_open: true, closed_message: '', maintenance_mode: false, maintenance_message: '' };
const TTL = 10 * 1000; // re-read from the database at most every 10 seconds
let cache = null;
let at = 0;

async function getShop() {
  if (cache && Date.now() - at < TTL) return cache;
  const { data, error } = await admin.from('shop_settings')
    .select('is_open,closed_message,maintenance_mode,maintenance_message').eq('id', 1).maybeSingle();
  // Table missing (migration 07 not run) or a database error: stay open so the site never breaks
  cache = error || !data ? { ...DEFAULTS } : { ...DEFAULTS, ...data };
  at = Date.now();
  return cache;
}

function clearShopCache() { cache = null; }

module.exports = { getShop, clearShopCache, DEFAULTS };
