/* Code shared by staff.html and admin.html.
   Load it AFTER /js/app.js and the Chart.js <script>, BEFORE each page's own inline <script>:
   <script src="/js/staff-shared.js"></script>
   It uses the page's own $ helper and element ids when the functions run. */

const PAGE_SIZE = 10; // every list with pages shows 10 rows per page
const charts = {};
const STATUS_COLORS = { pending: '#f7b267', approved: '#a9cfe9', shipped: '#4a90c9', ready_for_pickup: '#2f9e75', completed: '#8fa3b3', cancelled: '#d4504b' };

/* ---------------- Charts ---------------- */
function applyChartTheme() {
  const dark = Theme.get() === 'dark';
  Chart.defaults.color = dark ? '#a9bccb' : '#5d7488';
  Chart.defaults.borderColor = dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)';
  Chart.defaults.elements.arc.borderColor = dark ? '#15222e' : '#ffffff';
}
applyChartTheme();
window.addEventListener('themechange', () => {
  applyChartTheme();
  const sec = document.getElementById('sec-dash');
  if (sec && !sec.classList.contains('d-none')) loadDash(); // redraw charts with the new colors
});
function drawChart(id, config, hasData) {
  charts[id]?.destroy();
  document.getElementById(id).classList.toggle('d-none', !hasData);
  document.getElementById(id + '-empty').classList.toggle('d-none', hasData);
  if (hasData) charts[id] = new Chart(document.getElementById(id), config);
}

/* ---------------- Pager: "Showing 1-10 of 134 | Previous  Page 1 of 14  Next" ---------------- */
function renderPager(el, d, go) {
  if (!d || d.total <= d.limit) { el.innerHTML = d && d.total ? '<span class="muted small me-auto">' + d.total + ' in total</span>' : ''; return; }
  const from = (d.page - 1) * d.limit + 1, to = Math.min(d.page * d.limit, d.total);
  el.innerHTML = '<span class="muted small me-auto">Showing ' + from + '-' + to + ' of ' + d.total + '</span>' +
    '<button class="btn btn-outline-ms btn-sm px-3" data-go="' + (d.page - 1) + '"' + (d.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
    '<span class="small nw">Page ' + d.page + ' of ' + d.pages + '</span>' +
    '<button class="btn btn-outline-ms btn-sm px-3" data-go="' + (d.page + 1) + '"' + (d.page >= d.pages ? ' disabled' : '') + '>Next</button>';
  el.onclick = (e) => { const b = e.target.closest('button[data-go]'); if (b && !b.disabled) go(parseInt(b.dataset.go, 10)); };
}

/* ---------------- Order flow rules (same as the server, routes/orders.js) ---------------- */
const FLOW = ['pending', 'approved', 'shipped', 'ready_for_pickup', 'completed'];
const canMove = (from, to) => from === to || (to === 'cancelled' && from !== 'completed' && from !== 'cancelled') ||
  (FLOW.includes(from) && FLOW.includes(to) && FLOW.indexOf(to) > FLOW.indexOf(from));

/* ---------------- CSV export of the orders that match the filters ---------------- */
const csvCell = (v) => {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // stop Excel from running text as a formula
  return '"' + t.replace(/"/g, '""') + '"';
};
async function exportOrdersCsv() {
  const $ = (id) => document.getElementById(id);
  const btn = $('fExport'); btn.disabled = true;
  let rows = [];
  try {
    for (let page = 1; page <= 100; page++) { // every matching order, 100 at a time
      const q = new URLSearchParams({ page, limit: 100 });
      if ($('fStatus').value) q.set('status', $('fStatus').value);
      if ($('fPay').value) q.set('payment_status', $('fPay').value);
      if ($('fQ').value.trim()) q.set('q', $('fQ').value.trim());
      const d = await api('/orders?' + q.toString());
      rows = rows.concat(d.rows);
      if (page >= d.pages) break;
    }
  } catch (e) { btn.disabled = false; return fail(e); }
  btn.disabled = false;
  if (!rows.length) return toast('No orders to export', 'warning');
  const head = ['Order no', 'Date placed', 'Student', 'Student ID', 'Email', 'Course', 'Pickup campus', 'Items', 'Total (PHP)', 'Order status', 'Payment method', 'Payment status', 'Reference number', 'Pickup date'];
  const data = rows.map((o) => [
    o.order_no, fmtDateTime(o.created_at), o.profiles?.full_name, o.profiles?.student_id, o.profiles?.university_email, o.profiles?.course,
    o.campus?.name, (o.order_items || []).map((i) => i.product_name + ' x' + i.quantity).join('; '), Number(o.total || 0).toFixed(2),
    (STATUS[o.status] || [o.status])[0], PAY_METHOD[o.payment_method] || o.payment_method, (PAY_STATUS[o.payment_status] || [o.payment_status])[0],
    o.reference_number, o.pickup_date,
  ]);
  const csv = '\ufeff' + [head, ...data].map((r) => r.map(csvCell).join(',')).join('\r\n'); // BOM so Excel reads UTF-8
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'bu-merch-orders-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Exported ' + rows.length + ' orders', 'success');
}

/* ---------------- Pickup: date label and "who is coming" for a day ---------------- */
const slotDateLabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const todayPH = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
async function loadDay() {
  const $ = (id) => document.getElementById(id);
  try {
    const d = await api('/pickup/day/' + ($('sDate').value || todayPH()));
    $('sDay').innerHTML = (d.open ? '' : '<div class="muted small mb-2">Pickup is closed on this date.</div>') + d.slots.map((s) =>
      '<div class="panel mb-2 py-2"><div class="d-flex justify-content-between"><b>' + esc(s.label) + '</b><span class="muted small">' + s.orders.length + ' / ' + s.capacity + ' booked</span></div>' +
      (s.orders.length ? s.orders.map((o) => '<div class="small mt-1">#' + o.order_no + ' &middot; ' + esc(o.name) + (o.student_id ? ' <span class="muted">(' + esc(o.student_id) + ')</span>' : '') + ' ' + badge(STATUS, o.status) + '</div>').join('') : '<div class="muted small mt-1">No bookings</div>') + '</div>').join('');
  } catch (e) { fail(e); }
}