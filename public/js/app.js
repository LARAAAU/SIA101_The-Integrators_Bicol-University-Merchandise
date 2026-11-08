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
// Order history (status timeline). events come from GET /api/orders/:id, oldest first; newest is shown on top.
function timelineHtml(events) {
  if (!events || !events.length) return '<div class="muted small">No history recorded yet.</div>';
  const label = (k) => (STATUS[k] ? STATUS[k][0] : k);
  const title = (e) => (e.event === 'status' && e.from_status && e.from_status === e.to_status ? (e.note || label(e.to_status)) : e.event === 'status' ? (e.from_status ? label(e.from_status) + ' \u2192 ' : '') + label(e.to_status) : (e.note || e.event));
  const dot = (e) => (e.event === 'status' || e.event === 'placed' ? (STATUS[e.to_status] || [0, 'secondary'])[1] : 'info');
  return '<ol class="tl">' + events.slice().reverse().map((e, i) =>
    '<li class="tl-item' + (i === 0 ? ' latest' : '') + '"><span class="tl-dot bg-' + dot(e) + '"></span>' +
    '<div class="tl-title">' + esc(title(e)) + '</div>' +
    (e.event === 'status' && e.note && e.from_status !== e.to_status ? '<div class="tl-note">' + esc(e.note) + '</div>' : '') +
    '<div class="tl-meta">' + esc(e.actor_label || 'System') + ' \u00b7 ' + fmtDateTime(e.created_at) + '</div></li>').join('') + '</ol>';
}
const badge = (map, key) => { const [label, cls] = map[key] || [key, 'secondary']; return `<span class="badge bg-${cls}">${esc(label)}</span>`; };

/* ---------- Manual GCash account (edited by admin in Payment settings) ---------- */
const fmtGcashNumber = (n) => String(n || '').replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3');
async function loadGcash() { try { return await api('/settings/payment'); } catch { return null; } }
function gcashBox(s, total) {
  if (!s || !s.gcash_number || !s.gcash_name) {
    return '<div class="gcash-box"><div class="muted small">The merch GCash account has not been set yet. Please contact the shop staff before paying.</div></div>';
  }
  return '<div class="gcash-box"><div class="muted small">Send your payment to this GCash account</div>' +
    '<div class="gcash-row"><span class="muted small">Account name</span><b>' + esc(s.gcash_name) + '</b></div>' +
    '<div class="gcash-row"><span class="muted small">GCash number</span><b class="gcash-num">' + esc(fmtGcashNumber(s.gcash_number)) + '</b>' +
    '<button type="button" class="btn btn-sm btn-outline-ms" data-copy="' + esc(s.gcash_number) + '">Copy</button></div>' +
    (total != null ? '<div class="gcash-row"><span class="muted small">Amount to send</span><b>' + peso(total) + '</b></div>' : '') +
    (s.gcash_note ? '<div class="small mt-2">' + esc(s.gcash_note) + '</div>' : '') + '</div>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
  const done = () => { const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = t; }, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, () => {}); else done();
});

/* ---------- Auth ---------- */
const Auth = {
  session: () => store.get('ms_session'),
  user: () => store.get('ms_user'),
  isStaff: () => ['staff', 'admin'].includes(Auth.user()?.role),
  save(data) {
    store.set('ms_session', { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at });
    store.set('ms_user', data.user);
    try { sessionStorage.removeItem('ms_ann_seen'); localStorage.removeItem('ms_ann_never'); } catch {} // every new login shows the announcement again
  },
  logout() { store.del('ms_session'); store.del('ms_user'); location.href = '/login.html'; },
};

function requireLogin(staff = false) {
  if (!Auth.session()) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); return false; }
  if (staff && !Auth.isStaff()) { location.href = '/index.html'; return false; }
  return true;
}

/* ---------- API ---------- */
// Every request is counted so the page loading screen knows when the first data has arrived
async function api(...args) {
  window.Loader && Loader.begin();
  try { return await apiCall(...args); } finally { window.Loader && Loader.end(); }
}
async function apiCall(path, { method = 'GET', body, form, auth = true } = {}) {
  const opt = { method, headers: {} };
  const s = Auth.session();
  // Public calls (products, campuses) also carry the token when someone is logged in, so staff are recognised during maintenance.
  const useToken = s && (auth || !path.startsWith('/auth/'));
  if (useToken) opt.headers.Authorization = 'Bearer ' + s.access_token;
  if (form) opt.body = form;
  else if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }

  let res = await fetch(API + path, opt);
  if (res.status === 401 && s?.refresh_token && useToken) {
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
  if (!res.ok) {
    if (res.status === 503 && data.maintenance) { showMaintenance(data); const m = new Error(data.message); m.maintenance = true; throw m; }
    throw new Error(data.message || 'Something went wrong');
  }
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
function updateCartBadge() { const b = document.getElementById('cartBadge'); if (b) { const n = Cart.count(); b.textContent = n; b.hidden = n === 0; } const c = document.querySelector('.cart-btn'); if (c) { const n = Cart.count(); c.setAttribute('aria-label', n ? 'Cart, ' + n + ' item' + (n === 1 ? '' : 's') : 'Cart'); } }

/* ---------- Announcement popup (text, picture and on/off are set by admin in Admin > Shop status) ---------- */
// Shown every time a student opens the site (new tab or browser) and after every new login. Closing it hides it
// only for that visit, so moving between pages does not bring it back.
// Staff and admin do not get it (they can preview it from the admin page).
function showAnnouncement(a, force) {
  const text = String(a?.text || '').trim(), image = /^https?:\/\//.test(a?.image || '') ? a.image : '';
  if ((!text && !image) || document.getElementById('annOverlay')) return;
  let h = 0; for (const c of text + '|' + image) h = (h * 31 + c.charCodeAt(0)) | 0;
  const stamp = (Auth.user()?.id || 'guest') + ':' + h; // per account, so a guest closing it does not hide it from a student who logs in later on the same browser
  if (!force) {
    try { if (sessionStorage.getItem('ms_ann_seen') === stamp) return; } catch {}
  }
  const prevFocus = document.activeElement;
  const el = document.createElement('div');
  el.id = 'annOverlay'; el.className = 'ann-overlay';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Announcement');
  el.innerHTML = `<div class="ann-card">
      <div class="ann-head"><span class="brand">BU <span>Merch</span></span><button type="button" class="ann-x" aria-label="Close">&times;</button></div>
      <div class="ann-body">${image ? `<img class="ann-img" src="${esc(image)}" alt="Announcement picture">` : ''}${text ? `<p class="ann-text">${esc(text)}</p>` : ''}</div>
      <div class="ann-foot"><button type="button" class="btn btn-ms ann-never">Got it</button></div>
    </div>`;
  const close = (never) => {
    el.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (force) return; // admin preview never changes what students see
    try { sessionStorage.setItem('ms_ann_seen', stamp); } catch {}
  };
  const onKey = (e) => {
    if (e.key === 'Escape') return close(false);
    if (e.key !== 'Tab') return;
    const f = [...el.querySelectorAll('button')]; if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  el.addEventListener('click', (e) => { if (e.target === el) close(false); });
  el.querySelector('.ann-x').addEventListener('click', () => close(false));
  el.querySelector('.ann-never').addEventListener('click', () => close(true));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el); document.body.style.overflow = 'hidden';
  el.querySelector('.ann-never').focus();
}

/* ---------- Shop open/closed and maintenance mode (set by admin in Admin > Shop status) ---------- */
let SHOP = null;
async function loadShop() {
  window.Loader && Loader.begin();
  try { const r = await fetch(API + '/settings/shop', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } finally { window.Loader && Loader.end(); }
}
const MAINT_KEY = 'ms_maint'; // remembers (for this tab) that maintenance was on, so a reload shows the screen with no flash
let maintTimer = null;
function hideMaintenance() {
  clearInterval(maintTimer); maintTimer = null;
  document.getElementById('maintScreen')?.remove();
  document.body.style.overflow = '';
  try { sessionStorage.removeItem(MAINT_KEY); } catch {}
}
async function recheckMaintenance(manual) {
  const btn = document.getElementById('maintRetry'), note = document.getElementById('maintNote');
  if (manual && btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Checking...'; if (note) note.textContent = ''; }
  const [s] = await Promise.all([loadShop(), manual ? new Promise((r) => setTimeout(r, 900)) : null]);
  if (s && !s.maintenance_mode) {            // maintenance is over: reload (the spinner stays until the page is back)
    try { sessionStorage.removeItem(MAINT_KEY); } catch {}
    location.reload(); return;
  }
  if (s) { const p = document.getElementById('maintMsg'); if (p) p.textContent = s.maintenance_message || 'The shop is under maintenance. Please check back soon.'; }
  if (manual && btn) {
    btn.disabled = false; btn.textContent = 'Try again';
    if (note) note.textContent = s ? 'Still under maintenance. Please try again in a few minutes.' : 'Could not check right now. Please check your internet connection.';
  }
}
function showMaintenance(info) {
  const text = info.message || info.maintenance_message || 'The shop is under maintenance. Please check back soon.';
  try { sessionStorage.setItem(MAINT_KEY, text); } catch {}
  const existing = document.getElementById('maintScreen');
  if (existing) { const p = document.getElementById('maintMsg'); if (p) p.textContent = text; return; }
  const u = Auth.user();
  const el = document.createElement('div');
  el.id = 'maintScreen'; el.className = 'maint-screen';
  el.innerHTML = `${Theme.buttonHTML('floating')}
    <div class="maint-card">
      <div class="maint-ico">${ico('lock')}</div>
      <h1>We'll be right back</h1>
      <p id="maintMsg">${esc(text)}</p>
      <div class="d-flex gap-2 justify-content-center flex-wrap">
        <button class="btn btn-ms maint-btn" id="maintRetry">Try again</button>
        ${u ? '<button class="btn btn-outline-ms" id="maintLogout">Log out</button>' : '<a class="btn btn-outline-ms" href="/login.html">Staff log in</a>'}
      </div>
      <div class="maint-note" id="maintNote" role="status" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  document.getElementById('maintRetry').addEventListener('click', () => recheckMaintenance(true));
  document.getElementById('maintLogout')?.addEventListener('click', Auth.logout);
  maintTimer = setInterval(() => recheckMaintenance(false), 30000); // quietly check every 30 seconds
}
async function applyShopStatus() {
  const staff = Auth.isStaff();
  let cached = null; try { cached = sessionStorage.getItem(MAINT_KEY); } catch {}
  if (cached !== null && !staff) showMaintenance({ message: cached }); // no flash of the page while we check
  const s = SHOP = await loadShop(); if (!s) return;
  if (s.maintenance_mode && !staff) return showMaintenance(s);
  if (document.getElementById('maintScreen')) hideMaintenance();
  if (!staff && s.announcement_enabled !== false) showAnnouncement({ text: s.announcement_text, image: s.announcement_image_url });

  const bars = [];
  if (s.maintenance_mode) bars.push('<div class="shop-bar maint"><b>Maintenance mode is on.</b> Students cannot use the shop right now. You can because you are staff.</div>');
  if (!s.is_open) bars.push(`<div class="shop-bar closed"><b>Shop closed.</b> ${esc(s.closed_message || 'New orders are paused right now. You can still browse and fill your cart.')}${staff ? ' <span class="opacity-75">(Staff can still place orders.)</span>' : ''}</div>`);
  document.getElementById('shopBars')?.remove();
  if (bars.length) document.querySelector('#nav .announce')?.insertAdjacentHTML('afterend', `<div id="shopBars">${bars.join('')}</div>`);

  if (!s.is_open && !staff) {
    document.querySelectorAll('#placeBtn').forEach((b) => { b.disabled = true; b.textContent = 'Shop closed'; });
  }
}
// Safety net: block "Place order" for students while the shop is closed (the server blocks it too)
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#placeBtn');
  if (b && SHOP && !SHOP.is_open && !Auth.isStaff()) { e.preventDefault(); e.stopImmediatePropagation(); toast(SHOP.closed_message || 'The shop is closed for new orders right now.', 'warning'); }
}, true);

/* ---------- Loading cover for sections that refresh (admin tabs, popups) ---------- */
const Skel = {
  rows(n = 6) {
    return '<div class="sk-card sk-rows"><div class="sk title" style="width:200px"></div>' +
      Array.from({ length: n }, () => '<div class="sk-row"><div class="sk thumb" style="width:40px;height:40px"></div><div class="flex-grow-1"><div class="sk line" style="width:55%"></div><div class="sk line" style="width:30%;margin:0"></div></div><div class="sk btn-sk" style="width:80px;height:28px"></div></div>').join('') + '</div>';
  },
  modal() {
    return '<div aria-hidden="true"><div class="sk line" style="width:140px"></div><div class="sk title" style="width:60%"></div><div class="sk block" style="height:90px;margin-bottom:1rem"></div><div class="sk block" style="height:120px;margin-bottom:1rem"></div><div class="sk input"></div></div>';
  },
  // Covers `el` with a skeleton while `promise` runs. It only appears if the wait is longer than 150 ms,
  // and then stays at least 350 ms, so quick loads do not flicker.
  async wrap(el, promise) {
    if (!el || !promise || typeof promise.then !== 'function') return promise;
    let cover = null, shownAt = 0;
    const timer = setTimeout(() => {
      el.classList.add('sk-busy');
      cover = document.createElement('div'); cover.className = 'sk-cover'; cover.setAttribute('aria-hidden', 'true');
      cover.innerHTML = Skel.rows(6);
      el.appendChild(cover); shownAt = Date.now();
    }, 150);
    try { return await promise; } finally {
      clearTimeout(timer);
      if (cover) {
        const rest = Math.max(0, 350 - (Date.now() - shownAt));
        setTimeout(() => { cover.remove(); el.classList.remove('sk-busy'); }, rest);
      }
    }
  },
};

/* ---------- Dropdowns: smooth open (CSS) and smooth close (here) ---------- */
document.addEventListener('hide.bs.dropdown', (e) => {
  const toggle = e.target;
  const menu = toggle.parentElement && toggle.parentElement.querySelector(':scope > .dropdown-menu');
  if (!menu || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  if (menu.dataset.ddState === 'done') return;          // the animation finished, let Bootstrap close it
  e.preventDefault();                                   // wait for the closing animation first
  if (menu.dataset.ddState === 'closing') return;
  menu.dataset.ddState = 'closing';
  menu.classList.add('dd-closing');
  setTimeout(() => {
    menu.dataset.ddState = 'done';
    bootstrap.Dropdown.getOrCreateInstance(toggle).hide();
    menu.classList.remove('dd-closing');
    delete menu.dataset.ddState;
  }, 140);
});

/* ---------- UI helpers ---------- */
function toast(msg, type = 'dark') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0`;
  const urgent = type === 'danger' || type === 'warning';
  el.setAttribute('role', urgent ? 'alert' : 'status'); el.setAttribute('aria-live', urgent ? 'assertive' : 'polite'); el.setAttribute('aria-atomic', 'true');
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  box.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 3500 }); t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}
const fail = (e) => { if (e && e.maintenance) return; toast(e.message || String(e), 'danger'); };

function renderNav(active) {
  const u = Auth.user();
  const first = u ? (u.first_name || (u.full_name || '').split(' ')[0]) : '';
  const initial = esc((first || '?').charAt(0).toUpperCase());
  const cached = store.get('ms_order_count');
  const account = u ? `
    <li class="nav-item dropdown">
      <button class="acct-btn" id="acctBtn" data-bs-toggle="dropdown" aria-expanded="false">
        <span class="avatar">${initial}</span><span class="acct-name">${esc(first)}</span>
        <svg class="chev" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
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
  <nav class="navbar navbar-expand-md navbar-ms mb-4" aria-label="Main"><div class="container">
    <a class="navbar-brand brand" href="/index.html">BU <span>Merch</span></a>
    <div class="d-flex align-items-center gap-2 ms-auto order-md-last">
      ${Theme.buttonHTML()}
      <a class="cart-btn ${active === 'cart' ? 'on' : ''}" href="/cart.html" aria-label="Cart"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg><span id="cartBadge" class="cart-count" hidden>0</span></a>
      <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#navMenu" aria-controls="navMenu" aria-label="Menu"><span class="navbar-toggler-icon"></span></button>
    </div>
    <div class="collapse navbar-collapse" id="navMenu">
      <ul class="navbar-nav me-auto">
        ${u && Auth.isStaff() ? `<li class="nav-item"><a class="nav-link ${active === 'admin' ? 'active' : ''}" href="/admin.html">Admin</a></li>` : ''}
      </ul>
      <ul class="navbar-nav align-items-md-center me-md-3">${account}</ul>
    </div></div></nav>`;

  const mainEl = document.querySelector('main');
  if (mainEl && !document.getElementById('skipLink')) { mainEl.id = mainEl.id || 'main'; mainEl.setAttribute('tabindex', '-1'); document.body.insertAdjacentHTML('afterbegin', '<a id="skipLink" class="skip-link" href="#' + mainEl.id + '">Skip to main content</a>'); }

  document.getElementById('logoutBtn')?.addEventListener('click', Auth.logout);
  document.getElementById('acctBtn')?.addEventListener('show.bs.dropdown', loadAcctOrders);
  updateCartBadge();
  applyShopStatus();
  window.Loader && Loader.navReady(); // the loading screen now starts below the real navbar
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
  bell: '<path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3.5-5.5 7-5.5s7 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2.5.6 4 2.2 4 5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="16.5" cy="13.5" r="1.2"/>',
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
