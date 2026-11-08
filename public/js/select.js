/* Animated dropdown lists for every <select> on the site.
   The real <select> stays in the page (so layout, values, "change" handlers and forms keep working).
   We only stop the browser's own plain list from opening and show our animated list instead.
   Touch phones keep the native picker, which is better to use there. */
(function () {
  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (coarse) return;

  var panel = null, current = null, active = -1, typed = '', typedAt = 0, closeTimer = null;
  var CHECK = '<svg class="dd-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function eligible(el) {
    return el && el.tagName === 'SELECT' && !el.multiple && !(el.size > 1) && !el.disabled && !el.hasAttribute('data-native');
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function build(sel) {
    var html = '', idx = 0, group = null;
    Array.prototype.forEach.call(sel.children, function add(node) {
      if (node.tagName === 'OPTGROUP') {
        html += '<div class="dd-group" role="presentation">' + esc(node.label) + '</div>';
        Array.prototype.forEach.call(node.children, add);
      } else if (node.tagName === 'OPTION') {
        var i = node.index;
        var cls = 'dd-opt' + (node.value === '' ? ' dd-empty' : '');
        html += '<div class="' + cls + '" role="option" id="dd-o' + i + '" data-i="' + i + '" aria-selected="' + node.selected + '"' + (node.disabled ? ' aria-disabled="true"' : '') + '><span>' + esc(node.text) + '</span>' + CHECK + '</div>';
      }
    });
    return html;
  }

  function place() {
    if (!panel || !current) return;
    var anchor = current.closest('.ux-in') || current; // line up with the visible box when the select sits inside a styled wrapper
    var r = anchor.getBoundingClientRect(), vh = window.innerHeight;
    var below = vh - r.bottom - 12, above = r.top - 12;
    panel.style.minWidth = r.width + 'px';
    panel.style.maxHeight = '';
    var natural = Math.min(panel.scrollHeight + 2, 300);
    var up = below < Math.min(natural, 180) && above > below;
    panel.classList.toggle('up', up);
    panel.style.maxHeight = Math.max(120, Math.min(300, up ? above : below)) + 'px';
    var left = Math.min(Math.max(8, r.left), window.innerWidth - panel.offsetWidth - 8);
    panel.style.left = left + 'px';
    panel.style.top = up ? Math.max(8, r.top - panel.offsetHeight - 4) + 'px' : (r.bottom + 4) + 'px';
  }

  function setActive(i, scroll) {
    if (!panel) return;
    var items = panel.querySelectorAll('.dd-opt');
    Array.prototype.forEach.call(items, function (el) { el.classList.toggle('active', +el.dataset.i === i); });
    active = i;
    var el = panel.querySelector('.dd-opt[data-i="' + i + '"]');
    if (el) {
      current.setAttribute('aria-activedescendant', el.id);
      if (scroll) el.scrollIntoView({ block: 'nearest' });
    }
  }

  function open(sel) {
    if (current === sel) return close();
    close(true);
    current = sel;
    panel = document.createElement('div');
    panel.className = 'dd-panel';
    panel.setAttribute('role', 'listbox');
    panel.innerHTML = build(sel);
    document.body.appendChild(panel);
    sel.setAttribute('aria-expanded', 'true');
    place();
    setActive(sel.selectedIndex, true);
    panel.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus on the select
    panel.addEventListener('mousemove', function (e) {
      var o = e.target.closest('.dd-opt'); if (o && !o.hasAttribute('aria-disabled') && +o.dataset.i !== active) setActive(+o.dataset.i, false);
    });
    panel.addEventListener('click', function (e) {
      var o = e.target.closest('.dd-opt'); if (o && !o.hasAttribute('aria-disabled')) choose(+o.dataset.i);
    });
  }

  function close(instant) {
    clearTimeout(closeTimer);
    var p = panel, sel = current;
    panel = null; current = null; active = -1; typed = '';
    if (sel) { sel.setAttribute('aria-expanded', 'false'); sel.removeAttribute('aria-activedescendant'); }
    if (!p) return;
    if (instant || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { p.remove(); return; }
    p.classList.add('closing');
    closeTimer = setTimeout(function () { p.remove(); }, 140);
  }

  function choose(i) {
    var sel = current; if (!sel) return;
    var changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    close();
    if (changed) {
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sel.focus();
  }

  function move(step) {
    var opts = current.options, i = active;
    for (var n = 0; n < opts.length; n++) {
      i += step;
      if (i < 0 || i >= opts.length) { i = Math.max(0, Math.min(opts.length - 1, i)); break; }
      if (!opts[i].disabled) break;
    }
    if (!opts[i] || opts[i].disabled) return;
    setActive(i, true);
  }

  // click on a select opens our list instead of the browser's
  document.addEventListener('mousedown', function (e) {
    var sel = e.target.closest && e.target.closest('select');
    if (sel && eligible(sel)) {
      if (e.button !== 0) return;
      e.preventDefault();
      sel.focus();
      open(sel);
      return;
    }
    if (panel && !(e.target.closest && e.target.closest('.dd-panel'))) close(); // click anywhere else closes it
  }, true);

  document.addEventListener('keydown', function (e) {
    var sel = e.target;
    if (current) {
      if (sel !== current) return;
      var k = e.key;
      if (k === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (k === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (k === 'Home') { e.preventDefault(); setActive(0, true); }
      else if (k === 'End') { e.preventDefault(); setActive(current.options.length - 1, true); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (active >= 0 && !current.options[active].disabled) choose(active); }
      else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (k === 'Tab') close();
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { // type to jump
        var now = Date.now(); typed = (now - typedAt > 700 ? '' : typed) + k.toLowerCase(); typedAt = now;
        var opts = current.options, start = typed.length === 1 ? active + 1 : active;
        for (var n = 0; n < opts.length; n++) {
          var i = (start + n) % opts.length;
          if (!opts[i].disabled && opts[i].text.trim().toLowerCase().indexOf(typed) === 0) { setActive(i, true); break; }
        }
      }
      return;
    }
    if (eligible(sel) && (e.key === ' ' || e.key === 'Enter' || (e.altKey && e.key === 'ArrowDown'))) {
      if (e.key === 'Enter' && sel.form) return; // Enter still submits the form
      e.preventDefault(); open(sel);
    }
  }, true);

  window.addEventListener('resize', function () { close(true); });
  window.addEventListener('scroll', function (e) { if (panel && !(e.target.closest && e.target.closest('.dd-panel'))) place(); }, true);
  window.addEventListener('pagehide', function () { close(true); });
})();
