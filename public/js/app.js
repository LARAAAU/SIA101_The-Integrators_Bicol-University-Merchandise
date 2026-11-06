/* MerchSys shared helpers: API calls, auth, cart, nav, formatting */
const API = '/api';

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

const STATUS = {
  pending: ['Pending', 'warning'], approved: ['Approved', 'info'], shipped: ['Shipped', 'primary'],
  ready_for_pickup: ['Ready for pickup', 'success'], completed: ['Completed', 'secondary'], cancelled: ['Cancelled', 'danger'],
};
const PAY_STATUS = {
  unpaid: ['Unpaid', 'danger'], pending_verification: ['Verifying', 'warning'],
  paid: ['Paid', 'success'], failed: ['Failed', 'danger'],
};
const PAY_METHOD = { gcash_online: 'Online payment', gcash_manual: 'GCash (send receipt)', onsite: 'Pay onsite' };
const badge = (map, key) => { const [label, cls] = map[key] || [key, 'secondary']; return `<span class="badge bg-${cls}">${esc(label)}</span>`; };

/* ---------- Auth ---------- */
const Auth = {
  session: () => store.get('ms_session'),
  user: () => store.get('ms_user'),
  isStaff: () => ['staff', 'admin'].includes(Auth.user()?.role),
  save(data) {
    store.set('ms_session', { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at });
    store.set('ms_user', data.user);
  },
  logout() { store.del('ms_session'); store.del('ms_user'); location.href = '/login.html'; },
};

function requireLogin(staff = false) {
  if (!Auth.session()) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); return false; }
  if (staff && !Auth.isStaff()) { location.href = '/index.html'; return false; }
  return true;
}

/* ---------- API ---------- */
async function api(path, { method = 'GET', body, form, auth = true } = {}) {
  const opt = { method, headers: {} };
  const s = Auth.session();
  if (s && auth) opt.headers.Authorization = 'Bearer ' + s.access_token;
  if (form) opt.body = form;
  else if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }

  let res = await fetch(API + path, opt);
  if (res.status === 401 && s?.refresh_token && auth) {
    const r = await fetch(API + '/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!r.ok) { Auth.logout(); throw new Error('Session expired. Please log in again.'); }
    const n = await r.json();
    store.set('ms_session', n);
    opt.headers.Authorization = 'Bearer ' + n.access_token;
    res = await fetch(API + path, opt);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Something went wrong');
  return data;
}

/* ---------- Cart (kept in this browser) ---------- */
const Cart = {
  get: () => store.get('ms_cart') || [],
  save(c) { store.set('ms_cart', c); updateCartBadge(); },
  count: () => Cart.get().reduce((n, i) => n + i.qty, 0),
  total: () => Cart.get().reduce((n, i) => n + i.qty * i.price, 0),
  add(p) {
    const c = Cart.get(); const it = c.find((i) => i.id === p.id);
    if (it) { if (it.qty >= p.stock) return false; it.qty++; it.stock = p.stock; }
    else c.push({ id: p.id, name: p.name, price: Number(p.price), qty: 1, stock: p.stock, image_url: p.image_url });
    Cart.save(c); return true;
  },
  setQty(id, qty) {
    let c = Cart.get(); const it = c.find((i) => i.id === id); if (!it) return;
    it.qty = Math.max(0, Math.min(qty, it.stock || 50));
    c = c.filter((i) => i.qty > 0); Cart.save(c);
  },
  clear() { Cart.save([]); },
};
function updateCartBadge() { const b = document.getElementById('cartBadge'); if (b) { const n = Cart.count(); b.textContent = n; b.hidden = n === 0; } }

/* ---------- UI helpers ---------- */
function toast(msg, type = 'dark') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  box.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 3500 }); t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}
const fail = (e) => toast(e.message || String(e), 'danger');

function renderNav(active) {
  const u = Auth.user();
  const first = u ? (u.first_name || (u.full_name || '').split(' ')[0]) : '';
  const initial = esc((first || '?').charAt(0).toUpperCase());
  const cached = store.get('ms_order_count');
  const account = u ? `
    <li class="nav-item dropdown">
      <button class="acct-btn" id="acctBtn" data-bs-toggle="dropdown" aria-expanded="false">
        <span class="avatar">${initial}</span><span class="acct-name">${esc(first)}</span>
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="dropdown-menu dropdown-menu-end acct-menu">
        <div class="acct-head"><span class="avatar lg">${initial}</span>
          <div class="min-w-0"><div class="fw-bold">${esc(u.full_name)}</div><div class="muted small text-break">${esc(u.university_email)}</div></div></div>
        <a class="acct-row" href="/orders.html"><span>My orders</span><span class="count" id="acctCount">${cached ?? ''}</span></a>
        <div id="acctRecent"></div>
        <hr class="acct-sep">
        <a class="acct-row" href="/profile.html">Account settings</a>
        <button class="acct-row" id="logoutBtn">Log out</button>
      </div>
    </li>` : `<li class="nav-item"><a class="btn btn-sm btn-gold" href="/login.html">Log in</a></li>`;

  document.getElementById('nav').innerHTML = `
  <div class="announce">Pre-order now, pay with GCash, and pick up on your campus.</div>
  <nav class="navbar navbar-expand-md navbar-ms mb-4"><div class="container">
    <a class="navbar-brand brand" href="/index.html">BU <span>Merch</span></a>
    <div class="d-flex align-items-center gap-2 ms-auto order-md-last">
      ${Theme.buttonHTML()}
      <a class="cart-btn ${active === 'cart' ? 'on' : ''}" href="/cart.html" aria-label="Cart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg><span id="cartBadge" class="cart-count" hidden>0</span></a>
      <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#navMenu" aria-controls="navMenu" aria-label="Menu"><span class="navbar-toggler-icon"></span></button>
    </div>
    <div class="collapse navbar-collapse" id="navMenu">
      <ul class="navbar-nav me-auto">
        ${u && Auth.isStaff() ? `<li class="nav-item"><a class="nav-link ${active === 'admin' ? 'active' : ''}" href="/admin.html">Admin</a></li>` : ''}
      </ul>
      <ul class="navbar-nav align-items-md-center me-md-3">${account}</ul>
    </div></div></nav>`;

  document.getElementById('logoutBtn')?.addEventListener('click', Auth.logout);
  document.getElementById('acctBtn')?.addEventListener('show.bs.dropdown', loadAcctOrders);
  updateCartBadge();
}

// Fills the account menu with the order count and the 3 most recent orders
async function loadAcctOrders() {
  const box = document.getElementById('acctRecent'); if (!box) return;
  try {
    const list = await api('/orders/mine');
    store.set('ms_order_count', list.length);
    document.getElementById('acctCount').textContent = list.length;
    box.innerHTML = list.length
      ? list.slice(0, 3).map((o) => {
          const qty = o.order_items.reduce((n, i) => n + i.quantity, 0);
          return `<a class="acct-order" href="/order-status.html?order=${o.id}"><span class="fw-medium">#${o.order_no}</span>
            <span class="muted small flex-grow-1 text-truncate">${qty} item${qty === 1 ? '' : 's'} &middot; ${peso(o.total)}</span>${badge(STATUS, o.status)}</a>`;
        }).join('') + (list.length > 3 ? `<a class="acct-more" href="/orders.html">View all ${list.length} orders</a>` : '')
      : '<div class="acct-empty">No orders yet</div>';
  } catch { box.innerHTML = ''; }
}

// Shared footer listing pickup campuses
async function renderFooter() {
  const el = document.getElementById('footer'); if (!el) return;
  let campuses = [];
  try { campuses = await api('/campuses', { auth: false }); } catch {}
  el.innerHTML = `<footer class="site"><div class="container"><div class="row g-4">
    <div class="col-md-5"><div class="brand fs-5 text-white mb-2">BU Merch</div><div>Official Bicol University merchandise. Pre-order online and pick it up at your campus.</div><div class="small mt-3">Powered by MerchSys (IT 118 project)</div></div>
    <div class="col-md-7"><h6>Pickup locations</h6><div class="row small">${campuses.map((c) => `<div class="col-sm-6 col-lg-4 mb-2">${esc(c.name)}${c.is_main ? ' (Main)' : ''}</div>`).join('')}</div></div>
  </div></div></footer>`;
}

/* ---------- icons + account area sidebar (shared by Account, Security, My orders) ---------- */
const ICONS = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16c.6-1.6 4.4-1.6 5 0M14 10h4M14 14h3"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  device: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 20h20"/>',
  logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3.5-5.5 7-5.5s7 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2.5.6 4 2.2 4 5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
function hydrateIcons(root = document) { root.querySelectorAll('[data-i]').forEach((el) => { el.innerHTML = ico(el.dataset.i); }); }

function renderAccountSide(active) {
  const el = document.getElementById('side'); if (!el) return;
  const item = (key, href, icon, label) => `<a class="ux-nav ${active === key ? 'on' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}><i class="ico" data-i="${icon}"></i>${label}</a>`;
  el.innerHTML = `<nav class="ux-side" aria-label="Account">
    ${item('account', '/profile.html', 'user', 'Account')}
    ${item('security', '/profile.html#security', 'shield', 'Security')}
    ${item('orders', '/orders.html', 'bag', 'My orders')}
    <button class="ux-nav out" id="sideOut" type="button"><i class="ico" data-i="logout"></i>Log out</button>
  </nav>`;
  hydrateIcons(el);
  document.getElementById('sideOut').addEventListener('click', Auth.logout);
}
