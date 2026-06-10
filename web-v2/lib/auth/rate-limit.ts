/**
 * Minimal fixed-window per-IP rate limit for the PUBLIC auth endpoints
 * (/api/auth/signup + /api/auth/email) — the only unauthenticated
 * write surfaces after the 2026-06-10 multi-user opening. Before this,
 * bcrypt cost-12 was the only brake on credential stuffing / signup
 * bots.
 *
 * In-memory by design: Railway runs a single Next instance, the map
 * resets on deploy, and the goal is bot-brake not billing-grade
 * quota. If the app ever scales horizontally, move this to a
 * Postgres/Redis counter.
 *
 * 20 attempts per 10 minutes per IP across both endpoints — generous
 * for a human mistyping a password, tight for a script.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const SWEEP_EVERY = 500; // sweep stale windows every N checks · bounds the map

const hits = new Map<string, { count: number; windowStart: number }>();
let checksSinceSweep = 0;

/** True when this request should be rejected with a 429. Counts the
 *  attempt regardless of auth outcome (failed logins are the signal). */
export function authRateLimited(req: Request | { headers: Headers }): boolean {
  // Railway terminates TLS at the edge proxy · the client lands in the
  // first hop of x-forwarded-for. Absent header (local dev, tests) →
  // one shared bucket, which only matters under attack anyway.
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const ip = xff.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();

  if (++checksSinceSweep >= SWEEP_EVERY) {
    checksSinceSweep = 0;
    for (const [k, v] of hits) {
      if (now - v.windowStart > WINDOW_MS) hits.delete(k);
    }
  }

  const h = hits.get(ip);
  if (!h || now - h.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  h.count += 1;
  return h.count > MAX_ATTEMPTS;
}
