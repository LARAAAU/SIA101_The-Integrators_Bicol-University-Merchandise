/* BU Merch dark mode. Loaded in <head> so the theme is applied before the page paints. */
(function () {
  var KEY = 'ms_theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function systemTheme() { return media && media.matches ? 'dark' : 'light'; }
  function current() { return root.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light'; }

  function apply(theme, announce) {
    root.setAttribute('data-bs-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(theme === 'dark'));
      b.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
    if (announce) window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }

  // set it immediately (saved choice wins, otherwise follow the device)
  apply(saved() === 'dark' || saved() === 'light' ? saved() : systemTheme(), false);

  var ICONS =
    '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' +
    '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  window.Theme = {
    get: current,
    set: function (theme) {
      try { localStorage.setItem(KEY, theme); } catch (e) {}
      apply(theme, true);
    },
    toggle: function () { this.set(current() === 'dark' ? 'light' : 'dark'); },
    buttonHTML: function (extra) {
      return '<button type="button" class="theme-btn ' + (extra || '') + '" data-theme-toggle aria-label="Toggle dark mode" aria-pressed="' + (current() === 'dark') + '">' + ICONS + '</button>';
    },
  };

  // follow the device setting live, but only until the user picks a theme themselves
  if (media) {
    var onSys = function () { if (!saved()) apply(systemTheme(), true); };
    if (media.addEventListener) media.addEventListener('change', onSys); else if (media.addListener) media.addListener(onSys);
  }

  // one listener handles every toggle button, including ones rendered later by renderNav()
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (b) window.Theme.toggle();
  });

  // pages without the shared navbar (login) get a floating toggle
  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('nav')) document.body.insertAdjacentHTML('beforeend', window.Theme.buttonHTML('floating'));
    apply(current(), false);
  });
  // sync across open tabs
  window.addEventListener('storage', function (e) {
    if (e.key === KEY && (e.newValue === 'dark' || e.newValue === 'light')) apply(e.newValue, true);
  });
})();
