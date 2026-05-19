/**
 * GET /api/watch/today
 *
 * Returns today's workout in the structured shape watchOS needs.
 * The iPhone bridge fetches this and pushes the payload to the
 * paired Apple Watch via WatchConnectivity.
 *
 * Auth: Bearer access token (native).  Cookie also accepted so
 * curl-from-desktop works for testing, but real usage is Bearer.
 *
 * Response shape locked in docs/native/01-watchos-scoping.md and
 * lib/watch-workout.ts WatchWorkout interface:
 *
 *   {
 *     workoutId, name, summary, totalEstimatedMinutes,
 *     phases: [{ type, label, durationSec, targetPaceSPerMi,
 *                tolerancePaceSPerMi?, haptic }],
 *     completionEndpoint, expiresAt
 *   }
 *
 * REST DAYS · returns { workoutId: null, ... } so the watch app can
 * render "Rest day — no workout today" without erroring.
 *
 * RACE DAYS · same · returns null workout · race-day pacing strategy
 * is deferred from MVP per the scoping doc.
 *
 * Tier 1 stable public per docs/api/tier-1-stable-public.md update.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { resolveFitness } from '@/lib/fitness-resolver';
import { buildSyntheticPlan, todayISO, userTimezone } from '@/lib/synthetic-plan';
import { buildWatchWorkout } from '@/lib/watch-workout';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = userTimezone(user.location);
  const today = todayISO(tz);

  // Find today's workout in the synthetic plan · same source the
  // web TodayCard reads from, so what the runner sees in the app
  // matches what gets pushed to the watch.
  const weeks = buildSyntheticPlan();
  let todayDay = null;
  for (const week of weeks) {
    const day = week.days.find((d) => d.date === today);
    if (day) {
      todayDay = day;
      break;
    }
  }

  if (!todayDay) {
    // Date not in the plan window (past end of cycle or before start).
    return NextResponse.json({
      workoutId: null,
      reason: 'no-plan-window',
      message: 'Today is outside the active training plan window.',
    });
  }

  if (todayDay.type === 'rest') {
    return NextResponse.json({
      workoutId: null,
      reason: 'rest',
      message: 'Rest day — no workout today.',
    });
  }

  if (todayDay.type === 'race') {
    return NextResponse.json({
      workoutId: null,
      reason: 'race-day',
      message: 'Race day — pacing strategy is on the web app for now.',
    });
  }

  const fitness = await resolveFitness(user.id, today).catch(() => null);

  const workout = buildWatchWorkout(todayDay, today, fitness);
  if (!workout) {
    return NextResponse.json({
      workoutId: null,
      reason: 'unsupported-workout-type',
      message: 'This workout type isn\'t supported on the watch yet.',
    });
  }

  return NextResponse.json(workout);
}
