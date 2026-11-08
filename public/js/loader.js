/* BU Merch page loading screen (skeleton). Loaded in <head> on every page, right after theme.js.
   It shows grey placeholder blocks that match the page, until the page and its first data requests are done.
   app.js tells it about data requests (Loader.begin / Loader.end) and when the navbar is ready (Loader.navReady). */
(function () {
  var root = document.documentElement;
  var page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';
  var AUTH = page === 'login' || page === 'resetpassword';

  var MIN_SHOW = 450;   // show it at least this long so it never just flashes
  var QUIET = 250;      // hide only after no data request has been running for this long
  var MAX_SHOW = 10000; // safety: never keep the screen longer than this

  var pending = 0, loaded = false, hidden = false, shownAt = Date.now(), quietTimer = null, overlay = null;

  function b(cls, style) { return '<div class="sk ' + (cls || '') + '"' + (style ? ' style="' + style + '"' : '') + '></div>'; }
  function lines(n, last) { var s = ''; for (var i = 0; i < n; i++) s += b('line', i === n - 1 && last ? 'width:' + last : ''); return s; }
  function repeat(n, fn) { var s = ''; for (var i = 0; i < n; i++) s += fn(i); return s; }
  function title(w) { return b('title', 'width:' + (w || '220px')); }

  var T = {
    index: function () {
      return '<div class="row align-items-center g-4 mb-5"><div class="col-md-7">' + b('hero-h') + b('hero-h', 'width:80%') + b('hero-h', 'width:55%') +
        '<div class="mt-3">' + lines(3, '60%') + '</div><div class="d-flex gap-2 mt-4">' + b('btn-sk', 'width:140px') + b('btn-sk', 'width:160px') + '</div></div>' +
        '<div class="col-md-5 d-none d-md-block">' + b('circle-lg') + '</div></div>' +
        '<div class="d-flex justify-content-between align-items-center mb-3">' + title('180px') + b('btn-sk', 'width:220px') + '</div>' +
        '<div class="d-flex gap-4 mb-4 overflow-hidden">' + repeat(6, function () { return '<div class="text-center">' + b('circle') + b('line', 'width:48px;margin:.5rem auto 0') + '</div>'; }) + '</div>' +
        '<div class="row g-3">' + repeat(8, function () { return '<div class="col-6 col-md-4 col-lg-3"><div class="sk-card p-0 overflow-hidden">' + b('img') + '<div class="p-3">' + lines(2, '55%') + b('btn-sk', 'width:90px;margin-top:.5rem') + '</div></div></div>'; }) + '</div>';
    },
    cart: function () {
      return title('120px') + '<div class="row g-4"><div class="col-lg-8"><div class="sk-card">' +
        repeat(3, function () { return '<div class="d-flex gap-3 align-items-center py-3 sk-sep">' + b('thumb') + '<div class="flex-grow-1">' + lines(2, '45%') + '</div>' + b('btn-sk', 'width:100px') + '</div>'; }) +
        '</div></div><div class="col-lg-4"><div class="sk-card">' + lines(3, '50%') + b('btn-sk', 'width:100%;margin-top:1rem') + '</div></div></div>';
    },
    checkout: function () {
      return '<div style="max-width:620px;margin:0 auto">' + title('200px') + '<div class="sk-card">' + b('input') + b('block', 'height:70px;margin:1rem 0') + title('160px') +
        repeat(3, function () { return b('block', 'height:74px;margin-bottom:.75rem'); }) + '<div class="d-flex justify-content-between my-3">' + b('line', 'width:60px') + b('line', 'width:110px') + '</div>' + b('btn-sk', 'width:100%') + '</div></div>';
    },
    orders: function () {
      return title('160px') + repeat(5, function () { return '<div class="sk-card mb-3 d-flex gap-3 align-items-center">' + b('thumb') + '<div class="flex-grow-1">' + lines(2, '40%') + '</div>' + b('btn-sk', 'width:90px') + '</div>'; });
    },
    'order-status': function () {
      return '<div style="max-width:820px;margin:0 auto"><div class="d-flex justify-content-between mb-3">' + title('180px') + b('btn-sk', 'width:140px') + '</div>' +
        '<div class="d-flex gap-2 mb-4 overflow-hidden">' + repeat(5, function () { return b('btn-sk', 'width:130px;flex:0 0 auto'); }) + '</div>' +
        '<div class="sk-card mb-3">' + lines(4, '45%') + '</div><div class="sk-card mb-3">' + lines(3, '60%') + '</div><div class="sk-card">' + lines(3, '35%') + '</div></div>';
    },
    profile: function () {
      return b('line', 'width:140px;margin-bottom:.5rem') + title('260px') + '<div class="row g-4"><div class="col-md-3"><div class="sk-card">' +
        repeat(4, function () { return b('block', 'height:42px;margin-bottom:.5rem'); }) + '</div></div><div class="col-md-9"><div class="sk-card mb-3"><div class="d-flex gap-4">' + b('circle', 'width:90px;height:90px;flex:0 0 auto') +
        '<div class="flex-grow-1 row g-3">' + repeat(4, function () { return '<div class="col-md-6">' + b('line', 'width:80px') + b('input') + '</div>'; }) + '</div></div></div>' +
        '<div class="sk-card">' + repeat(2, function () { return b('line', 'width:90px') + b('input', 'margin-bottom:1rem'); }) + '</div></div></div>';
    },
    admin: function () {
      return b('line', 'width:140px;margin-bottom:.5rem') + title('240px') + '<div class="row g-4"><div class="col-md-3"><div class="sk-card">' +
        repeat(8, function () { return b('block', 'height:38px;margin-bottom:.5rem'); }) + '</div></div><div class="col-md-9"><div class="row g-3 mb-3">' +
        repeat(6, function () { return '<div class="col-6 col-lg-4"><div class="sk-card">' + b('line', 'width:50%') + b('title', 'width:70%;margin-top:.75rem') + '</div></div>'; }) +
        '</div><div class="sk-card">' + title('120px') + b('block', 'height:240px') + '</div></div></div>';
    },
    auth: function () {
      return '<div class="sk-auth-card">' + b('logo') + b('title', 'width:140px;margin:1.25rem 0') + b('line', 'width:60px') + b('input', 'margin-bottom:1rem') + b('line', 'width:80px') + b('input', 'margin-bottom:1.25rem') + b('btn-sk', 'width:100%') + '</div>';
    },
  };
  T.resetpassword = T.auth; T.login = T.auth;

  function fakeNav() {
    return '<div class="sk-fake-nav"><div class="sk-announce"></div><div class="container d-flex align-items-center gap-3 py-3">' +
      b('logo') + '<div class="flex-grow-1"></div>' + b('circle', 'width:42px;height:42px') + b('circle', 'width:42px;height:42px') + b('btn-sk', 'width:120px') + '</div></div>';
  }

  function build() {
    var el = document.createElement('div');
    el.id = 'pageSkel';
    el.className = 'page-skel' + (AUTH ? ' is-auth' : '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Loading');
    var body = (T[page] || T.index)();
    el.innerHTML = '<div class="sk-bar" aria-hidden="true"></div>' + (AUTH ? '' : fakeNav()) +
      '<div class="' + (AUTH ? 'sk-auth-wrap' : 'container sk-content') + '" aria-hidden="true">' + body + '</div><span class="visually-hidden">Loading...</span>';
    return el;
  }

  function mount() {
    if (overlay || !document.body) return;
    overlay = build();
    document.body.appendChild(overlay);
    if (hidden) overlay.remove();
  }
  if (document.body) mount(); else {
    var mo = new MutationObserver(function () { if (document.body) { mo.disconnect(); mount(); } });
    mo.observe(root, { childList: true });
  }

  function finish() {
    if (hidden) return;
    hidden = true;
    clearTimeout(quietTimer);
    if (!overlay) return;
    overlay.classList.add('page-skel-out');
    setTimeout(function () { if (overlay) overlay.remove(); }, 280);
  }
  function maybeHide() {
    clearTimeout(quietTimer);
    if (hidden || !loaded || pending > 0) return;
    quietTimer = setTimeout(function () {
      if (pending > 0) return;
      setTimeout(finish, Math.max(0, MIN_SHOW - (Date.now() - shownAt)));
    }, QUIET);
  }

  // Once the real navbar exists, the skeleton starts below it (like the reference) instead of covering it
  function navReady() {
    var nav = document.getElementById('nav');
    if (!overlay || !nav || AUTH) return;
    var fit = function () { if (overlay) overlay.style.top = Math.round(nav.getBoundingClientRect().bottom) + 'px'; };
    var fake = overlay.querySelector('.sk-fake-nav'); if (fake) fake.remove();
    overlay.classList.add('has-nav');
    fit();
    if (window.ResizeObserver) new ResizeObserver(fit).observe(nav);
    window.addEventListener('resize', fit);
  }

  window.Loader = {
    begin: function () { pending++; },
    end: function () { pending = Math.max(0, pending - 1); maybeHide(); },
    active: function () { return !hidden; },
    navReady: navReady,
    done: finish,
  };
  window.addEventListener('load', function () { loaded = true; maybeHide(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) finish(); }); // back button: do not show a stale skeleton
  setTimeout(finish, MAX_SHOW);
})();
