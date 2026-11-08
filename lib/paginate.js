// Pagination helper for list endpoints (orders, users, products).
//
//   GET /api/orders?page=2&limit=20   ->  { rows: [...], page: 2, limit: 20, total: 134, pages: 7 }
//
// - limit defaults to 20 and can never be more than 100, so one request cannot pull a whole table.
// - Without ?page or ?limit the endpoint still returns a plain array like before (the dashboard and the
//   shop need that), but it is now capped, so it can never grow without limit.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePage(req, { limit = DEFAULT_LIMIT, max = MAX_LIMIT } = {}) {
  const paged = req.query.page !== undefined || req.query.limit !== undefined;
  const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || limit, 1), max);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  return { paged, page, limit: lim, from: (page - 1) * lim, to: page * lim - 1 };
}

function envelope(rows, count, p) {
  const total = count ?? rows.length;
  return { rows, page: p.page, limit: p.limit, total, pages: Math.max(Math.ceil(total / p.limit), 1) };
}

// Search text goes into PostgREST filters, so drop the characters that have a meaning there.
const cleanSearch = (s) => String(s || '').replace(/[,()*%\\:"'<>;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

module.exports = { parsePage, envelope, cleanSearch, MAX_LIMIT, LEGACY_CAP: 1000 };
