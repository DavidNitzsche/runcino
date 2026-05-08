/**
 * Client-side cache for /api/coach/today, layered ON TOP of the
 * server-side `coach_today_cache` (Postgres). Server cache makes
 * the API response fast (~300ms). This layer makes the BROWSER
 * render instant on revisits — no round trip wait at all.
 *
 * Pattern: stale-while-revalidate.
 *   1. On read, check localStorage for a recent payload (≤6h old).
 *   2. If hit → return cached payload SYNCHRONOUSLY for instant render.
 *      Then re-fetch in the background; on response, write the
 *      fresh payload to localStorage so the next read is even
 *      fresher. Subscribers (via the consumer hook) get the
 *      updated payload via state set.
 *   3. If miss → fetch + render the loading state, write on response.
 *
 * The 6h TTL is conservative — runs that land between visits trigger
 * the Strava webhook → server cache regenerates → next client fetch
 * picks up the new payload. The client TTL only protects against
 * showing OBVIOUSLY stale content (e.g. tomorrow's prescription
 * showing today's stale content).
 */

const KEY = 'runcino:coach-today-cache:v1';
const TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours

interface CacheEntry<T> {
  payload: T;
  storedAt: number;
}

export interface CachedReadResult<T> {
  /** Immediately-available payload from localStorage. Null if no
   *  cache hit or it was stale. */
  cached: T | null;
  /** Promise resolving to the freshly-fetched payload. Always
   *  triggered, regardless of whether `cached` was a hit — so the
   *  client always revalidates against the server. */
  fresh: Promise<T | null>;
}

/** Read the client cache + kick off a background fetch. The caller
 *  can render `cached` immediately for instant UI, then update on
 *  `fresh` resolution.
 *
 *  Caller is responsible for any state updates — this helper is
 *  pure plumbing, no React. */
export function readCoachTodayWithRevalidate<T>(): CachedReadResult<T> {
  const cached = (() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (Date.now() - entry.storedAt > TTL_MS) return null;
      return entry.payload;
    } catch {
      return null;
    }
  })();

  const fresh = (async (): Promise<T | null> => {
    if (typeof window === 'undefined') return null;
    try {
      const res = await fetch('/api/coach/today', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json() as T;
      try {
        const entry: CacheEntry<T> = { payload: data, storedAt: Date.now() };
        window.localStorage.setItem(KEY, JSON.stringify(entry));
      } catch {
        // Quota or disabled — ignore.
      }
      return data;
    } catch {
      return null;
    }
  })();

  return { cached, fresh };
}

/** Manually clear the client cache. Useful when the runner just
 *  saved a new race / changed a profile field and we want the next
 *  read to definitely hit the server. */
export function clearCoachTodayClientCache(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
