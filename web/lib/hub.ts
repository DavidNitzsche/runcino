/**
 * `getHub()` — server-side compute for the unified RunnerHub payload.
 *
 * Fans out the three sources in parallel:
 *   1. Coach today payload (the expensive one — ~2-5s for the LLM
 *      brief, ~150ms otherwise)
 *   2. All saved races
 *   3. Runner profile singleton
 *
 * Then bundles them with cache-provenance metadata. The expensive
 * coach payload is read through its own cache via `getCachedOrCompute`,
 * so a hub miss only re-pays the LLM cost when the coach key changed.
 *
 * Used by:
 *   - /api/hub (read path)
 *   - the hub regenerator on Strava webhook + midnight cron
 */

import { getCachedOrCompute } from './coach-today-cache';
import { listRacesDB } from './race-store';
import { getRunnerProfile } from './runner-profile-store';
import { getRecentRpe } from './rpe-store';
import { query } from './db';
import type { RunnerHub } from './hub-types';

/** LA-calendar date in YYYY-MM-DD. Mirrors gatherCoachState's
 *  todayLAISO() so the hub's cache_date matches the coach's. */
function todayLAISO(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

async function latestActivityId(): Promise<number | null> {
  const ids = await query<{ id: string }>(
    `SELECT id::text FROM strava_activities ORDER BY id DESC LIMIT 1`,
  ).catch(() => [] as Array<{ id: string }>);
  return ids.length > 0 ? Number(ids[0].id) : null;
}

/** Compute the full RunnerHub payload. Returns the hub plus a flag
 *  indicating whether the coach portion was a cache hit (lets the
 *  /api/hub route surface this for telemetry without two trips). */
export async function getHub(): Promise<{ hub: RunnerHub; cacheHit: boolean }> {
  // Fan out: coach (cached), races (Postgres), profile (Postgres),
  // recent RPE (Postgres). The coach call dominates — the others
  // are cheap Postgres reads and parallelize for free.
  const [coachResult, races, profile, latestId, recentRpe] = await Promise.all([
    getCachedOrCompute(),
    listRacesDB(),
    getRunnerProfile().catch(() => null),
    latestActivityId(),
    getRecentRpe(14).catch(() => []),
  ]);

  const hub: RunnerHub = {
    ok: true,
    coach: coachResult.payload,
    races,
    // getRunnerProfile returns the DEFAULT shape when the row is
    // missing rather than null — but the runner is "unfilled" if
    // every meaningful field is empty.
    profile: profile && (profile.birthDate || profile.hrmaxBpm || profile.rhrBpm)
      ? profile : null,
    recentRpe,
    meta: {
      computedAt: new Date().toISOString(),
      cacheDate: todayLAISO(),
      latestActivityId: latestId,
      cacheHit: coachResult.cacheHit,
    },
  };

  return { hub, cacheHit: coachResult.cacheHit };
}
