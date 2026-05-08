/**
 * /api/coach/today — daily prescription endpoint.
 *
 * Reads through the coach_today_cache (Option C). Cache key is
 * (LA-calendar-date, latest-strava-activity-id) so it auto-
 * invalidates when:
 *   - a new run lands (activity ID changes)
 *   - a new day starts (date rolls over; midnight cron pre-warms)
 *   - the Strava webhook fires (regenerates eagerly)
 *
 * Cache miss: computes the full payload (gatherCoachState +
 * coachDaily + briefDailyTraining LLM call), writes to cache,
 * returns. ~150ms deterministic + 2-5s LLM. Hit: ~10ms Postgres
 * read + return cached payload.
 *
 * Response shape preserved from before: legacy iOS/dashboard
 * consumers still see { ok, today, state, vdot, vdotTestPrompt,
 * dailyBrief, coach: { workout, readiness } }. New top-level field
 * `cacheHit` exposes whether this came from cache (for debugging
 * + telemetry).
 */

import { getCachedOrCompute } from '../../../../lib/coach-today-cache';

export async function GET() {
  try {
    const { payload, cacheHit } = await getCachedOrCompute();
    return Response.json({ ...payload, cacheHit });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
