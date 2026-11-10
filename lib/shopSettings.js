const { admin } = require('./supabase');

const DEFAULTS = { is_open: true, closed_message: '', maintenance_mode: false, maintenance_message: '', announcement_enabled: true, announcement_text: '', announcement_image_url: '', hero1_url: '', hero1_label: '', hero2_url: '', hero2_label: '', hero3_url: '', hero3_label: '', countdown_enabled: true, countdown_at: '', countdown_label: '' };
const FIELDS = Object.keys(DEFAULTS);
const pick = (row) => Object.fromEntries(FIELDS.filter((k) => row[k] !== undefined && row[k] !== null).map((k) => [k, row[k]]));
const TTL = 10 * 1000; // re-read from the database at most every 10 seconds
let cache = null;
let at = 0;

async function getShop() {
  if (cache && Date.now() - at < TTL) return cache;
  // select('*') so the shop still works if migration 10 (announcement columns) has not been run yet
  const { data, error } = await admin.from('shop_settings').select('*').eq('id', 1).maybeSingle();
  // Table missing (migration 07 not run) or a database error: stay open so the site never breaks
  cache = error || !data ? { ...DEFAULTS } : { ...DEFAULTS, ...pick(data) };
  at = Date.now();
  return cache;
}

function clearShopCache() { cache = null; }

module.exports = { getShop, clearShopCache, DEFAULTS, pick };
