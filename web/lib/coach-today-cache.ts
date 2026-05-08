/**
 * Cache for /api/coach/today payload (Option C).
 *
 * Schema in lib/db.ts: `coach_today_cache` with key
 * (cache_date, latest_activity_id) → payload (JSONB).
 *
 * Read path (`getCachedOrCompute`):
 *   1. Compute the current key (date + latest activity ID).
 *   2. Look up that key in Postgres.
 *   3. Hit → return cached payload (instant).
 *   4. Miss → run `computeCoachTodayPayload`, write to cache,
 *      return result. The next visit gets a hit.
 *
 * Write paths:
 *   - Strava webhook → `regenerateCoachTodayCache()` invalidates the
 *     row by re-computing under the NEW activity ID
 *   - Midnight cron → same call, just at the new date boundary
 *
 * Stale rows are kept (cheap and useful as a fallback). A trim
 * job could prune > N days old; not worth wiring for a single-user
 * deploy yet.
 */

import { query } from './db';
import { computeCoachTodayPayload, cacheKey, type CoachTodayPayloadShape } from './coach-today-payload';

interface DbRow {
  payload: CoachTodayPayloadShape;
  computed_at: Date;
}

/** Read the cached payload for a given date + activity-id key.
 *  Returns null on miss. */
async function readCache(date: string, latestActivityId: number | null): Promise<CoachTodayPayloadShape | null> {
  const rows = await query<DbRow>(
    `SELECT payload, computed_at FROM coach_today_cache
     WHERE cache_date = $1
       AND latest_activity_id ${latestActivityId == null ? 'IS NULL' : '= $2'}
     ORDER BY computed_at DESC
     LIMIT 1`,
    latestActivityId == null ? [date] : [date, latestActivityId],
  );
  if (rows.length === 0) return null;
  return rows[0].payload;
}

/** Write a payload to the cache. UPSERT so re-running for the same
 *  key just refreshes the timestamp (rare — usually the key
 *  changed when we got here). */
async function writeCache(date: string, latestActivityId: number | null, payload: CoachTodayPayloadShape): Promise<void> {
  await query(
    `INSERT INTO coach_today_cache (cache_date, latest_activity_id, payload, computed_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (cache_date, latest_activity_id) DO UPDATE SET
       payload = EXCLUDED.payload,
       computed_at = NOW()`,
    [date, latestActivityId, JSON.stringify(payload)],
  );
}

/** Read-through cache: hit → return cached, miss → compute + write +
 *  return. The dashboard read path. */
export async function getCachedOrCompute(): Promise<{ payload: CoachTodayPayloadShape; cacheHit: boolean }> {
  // We need the current key, which means we have to compute the
  // state once even on a cache hit (state is what determines the
  // key). For a hit, we don't need the FULL payload — we only
  // need the activity-id signal. Future optimization: compute the
  // key from a lightweight Postgres read instead of the full
  // gatherCoachState. For now: full compute, since the deterministic
  // parts are ~150ms and the LLM call is what we're saving.
  //
  // Trick to avoid double-computing on a miss: compute the payload
  // FIRST (which gives us state), derive the key, check cache. If
  // we hit cache, we just discard the LLM portion of the freshly-
  // computed payload — but that's exactly the cost we're avoiding.
  //
  // Better: compute state only, derive key, check cache. If miss,
  // continue to full compute. If hit, return cached payload.
  // We do this by splitting computeCoachTodayPayload — but that's
  // a refactor. For pragma: peek at the latest activity ID via a
  // direct SELECT, then check cache, then full compute on miss.

  const ids = await query<{ id: string }>(
    `SELECT id::text FROM strava_activities ORDER BY id DESC LIMIT 1`,
  ).catch(() => [] as Array<{ id: string }>);
  const latestActivityIdGuess = ids.length > 0 ? Number(ids[0].id) : null;

  // LA-calendar date — same logic gatherCoachState uses.
  const date = laTodayISO();

  const cached = await readCache(date, latestActivityIdGuess);
  if (cached) {
    // Sanity: the cached payload's own derived key should match.
    // If it diverges (e.g. activity ID was off because we read it
    // separately), recompute. Cheap defense against split-brain.
    const cachedKey = cacheKey(cached);
    if (cachedKey.date === date && cachedKey.latestActivityId === latestActivityIdGuess) {
      return { payload: cached, cacheHit: true };
    }
  }

  // Miss → full compute + write + return.
  const fresh = await computeCoachTodayPayload();
  const key = cacheKey(fresh);
  await writeCache(key.date, key.latestActivityId, fresh).catch(() => {
    // Cache write failure is non-fatal — return the fresh payload
    // anyway, next visit will retry.
  });
  return { payload: fresh, cacheHit: false };
}

/** Force a recompute and write to cache. Called by the Strava
 *  webhook when a new activity lands and by the midnight cron. */
export async function regenerateCoachTodayCache(): Promise<{ key: { date: string; latestActivityId: number | null }; computedAtMs: number }> {
  const t0 = Date.now();
  const fresh = await computeCoachTodayPayload();
  const key = cacheKey(fresh);
  await writeCache(key.date, key.latestActivityId, fresh);
  return { key, computedAtMs: Date.now() - t0 };
}

/** LA-calendar today as ISO YYYY-MM-DD. Mirrors gatherCoachState's
 *  todayLAISO() so the cache key aligns. */
function laTodayISO(): string {
  // The repo has a todayLAISO() somewhere but it's tied into
  // coach-state's imports. Inline the same computation to keep
  // this module a leaf.
  const now = new Date();
  // Convert UTC → LA via Intl format.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(now);
}
