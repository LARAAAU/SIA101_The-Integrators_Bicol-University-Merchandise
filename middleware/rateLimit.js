// Small in-memory rate limiter (no extra package needed).
// Note: on Vercel each serverless instance keeps its own counters, so this slows down
// guessing but is not a hard global limit. For a strict limit use a shared store (e.g. Upstash Redis).
function rateLimit({ windowMs, max, key = (req) => req.ip, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);

    const k = String(key(req));
    let e = hits.get(k);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(k, e); }
    e.count++;

    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - e.count)));
    if (e.count > max) {
      const retry = Math.max(1, Math.ceil((e.reset - now) / 1000));
      res.set('Retry-After', String(retry));
      const mins = Math.ceil(retry / 60);
      return res.status(429).json({ message: message || `Too many attempts. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
    }
    next();
  };
}

module.exports = { rateLimit };
