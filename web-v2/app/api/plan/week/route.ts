/**
 * GET /api/plan/week?date=YYYY-MM-DD
 *
 * Returns the 7-day training-week window of plan_workouts containing the given
 * date. The week ENDS on the runner's long-run day (their last training day of
 * the cycle) and starts the day after — derived from user_settings.long_run_day.
 * David runs long on Sunday → Mon–Sun. A Saturday-long runner → Sun–Sat.
 * Used by the iPhone WeekStrip and the training calendar.
 *
 * Response shape:
 *   {
 *     plan_id: string,
 *     week_start_iso: string,     // ISO day after the long-run day (week start)
 *     week_end_iso:   string,     // ISO long-run day (week end, 6 days later)
 *     today_iso:      string,     // server "today" (PT-adjusted)
 *     days: Array<{
 *       plan_workout_id: string | null, // row id — the day's IDENTITY (null on a
 *                                       // synthesised rest day with no row)
 *       date_iso: string, dow: number, type: string,
 *       distance_mi: number, sub_label: string | null,
 *       is_today: boolean, is_past: boolean,
 *       completedRunId: string | null,  // Phase 17 — real strava id when day has a logged run
 *       done_mi: number | null          // Phase 17 — canonical completed mileage for the day
 *     }>
 *   }
 *
 * 2026-05-28 Phase 17 — `completedRunId` + `done_mi` added so the iPhone
 * WeekStrip can retire its `is_past && type != "rest"` heuristic. We mirror
 * the canonicalMileageByDay → strava_id resolution from glance-state.ts
 * (see lines 138-170) so the strip agrees with /log on dedupe.
 *
 * 2026-08-19 · the loader itself moved to `lib/plan/week-loader.ts` so
 * `GET /api/v5/today` (the v5 Today composer) can call the SAME function for
 * its week strip instead of re-deriving this logic or round-tripping through
 * HTTP. This route is now a thin wrapper — response shape unchanged.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadPlanWeek } from '@/lib/plan/week-loader';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  // 2026-06-06 · Audit C C6 · runner timezone, not the -7h Pacific hack.
  // Keeps the iPhone week-strip's "today" consistent with /api/watch/today.
  const today = await runnerToday(userId);
  const dateParam = req.nextUrl.searchParams.get('date') ?? undefined;

  const result = await loadPlanWeek(userId, today, dateParam);
  return NextResponse.json(result);
}
