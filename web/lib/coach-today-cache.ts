/**
 * Cache for /api/coach/today payload (Option C).
 *
 * Schema in lib/db.ts: `coach_today_cache` with key
 * (cache_date, latest_activity_id) → payload (JSONB).
 *
 * Read path (`getCachedOrCompute`):
 *   1. Compute the current key (date + latest activity ID) from
 *      the SAME source the write path uses — a direct SELECT on
 *      strava_activities. If both paths derive the key the same
 *      way, hits actually hit.
 *   2. Look up that key in Postgres.
 *   3. Hit → return cached payload (instant).
 *   4. Miss → full compute, write to cache under the SAME key,
 *      return result. Next visit at the same key gets a hit.
 *
 * Write paths:
 *   - Strava webhook → `regenerateCoachTodayCache()` writes a fresh
 *     payload under the new latest_activity_id (the webhook fires
 *     when a new activity lands)
 *   - Midnight cron → same call, just at a new date boundary
 *
 * Stale rows are kept (cheap, useful as a fallback). A trim job
 * could prune > N days old; not worth wiring for a single-user
 * deploy yet.
 */

import { query } from './db';
import { computeCoachTodayPayload, type CoachTodayPayloadShape } from './coach-today-payload';

interface DbRow {
  payload: CoachTodayPayloadShape;
  computed_at: Date;
}

/** Single source of truth for the current cache key. Both the read
 *  and write paths route through this so they can never disagree —
 *  the bug we hit was the read deriving latest_activity_id from a
 *  different source (strava_activities table) than the write
 *  (state.races.recent + recovery), which produced eternal misses
 *  for any activity that wasn't a saved race or yesterday/today's
 *  run. */
/** Code version baked into cache reads/writes. Bump this any time
 *  the readiness logic, signal computation, or payload shape changes
 *  in a way that should invalidate previously-computed payloads.
 *  Old rows with a different version simply won't match and the next
 *  read recomputes (which is the goal). */
const CACHE_CODE_VERSION = 16;

async function currentCacheKey(): Promise<{ date: string; latestActivityId: number | null }> {
  // LA-calendar date. Mirrors gatherCoachState's todayLAISO().
  const date = (() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date());
  })();
  // Latest activity ID from the canonical table. Numeric. NULL when
  // the runner has no Strava activities yet. Code version is folded
  // in as `(rawId * 1000) + version` so cache rows from an older
  // deploy never match a new deploy's read key — forces recompute.
  const ids = await query<{ id: string }>(
    `SELECT id::text FROM strava_activities ORDER BY id DESC LIMIT 1`,
  ).catch(() => [] as Array<{ id: string }>);
  const rawId = ids.length > 0 ? Number(ids[0].id) : null;
  const latestActivityId = rawId != null ? rawId * 1000 + CACHE_CODE_VERSION : null;
  return { date, latestActivityId };
}

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

/** Read-through cache: hit → return cached, miss → compute + write
 *  + return. Both branches use currentCacheKey() so the key the
 *  miss path writes IS the key the next read looks up. */
export async function getCachedOrCompute(): Promise<{ payload: CoachTodayPayloadShape; cacheHit: boolean }> {
  const key = await currentCacheKey();

  const cached = await readCache(key.date, key.latestActivityId);
  if (cached) {
    return { payload: cached, cacheHit: true };
  }

  // Miss — full compute + write under the same key.
  const fresh = await computeCoachTodayPayload();
  await writeCache(key.date, key.latestActivityId, fresh).catch(() => undefined);
  return { payload: fresh, cacheHit: false };
}

/** Force a recompute and write to cache. Called by the Strava
 *  webhook when a new activity lands and by the midnight cron.
 *  Reads the key AFTER the compute finishes — the webhook may
 *  have triggered before the new activity actually landed in our
 *  Postgres table, in which case the key would be stale. By
 *  reading the key just-in-time after the payload is built, we
 *  always write under the current state-of-the-world. */
export async function regenerateCoachTodayCache(): Promise<{ key: { date: string; latestActivityId: number | null }; computedAtMs: number }> {
  const t0 = Date.now();
  const fresh = await computeCoachTodayPayload();
  const key = await currentCacheKey();
  await writeCache(key.date, key.latestActivityId, fresh);
  return { key, computedAtMs: Date.now() - t0 };
}
