/**
 * plan-match · pure helpers for matching Strava activities to the
 * planned workout for the same calendar day, and deciding whether
 * the planned work was "completed."
 *
 * Single source of truth for:
 *   - which activity (if any) covers a given PlanWorkout
 *   - which PlanWorkout (if any) covers a given Strava activity
 *   - whether today's planned mileage has been fulfilled
 *
 * Consumed by:
 *   - /api/strava/sync (writeback rename + shoe auto-assign)
 *   - /api/overview & /overview UI (✓ chip on the hero TodayCard)
 *   - /workout/[date] (actuals panel + completion pin)
 *   - lib/__tests__/plan-match.test.ts (synthetic fixture)
 *
 * Completion threshold: actual miles ≥ 60% of planned miles.
 * Below that, the day reads as "started" but not done — keeps the
 * coach from claiming a 4-mile shakeout finished a 16-mile long run.
 *
 * Matcher tolerance: same calendar day (YYYY-MM-DD), Run-type
 * activity, distance within ±15% of planned (or any same-day run when
 * planned is 0 / unspecified). Loose enough that a 5.8 mi recovery
 * day still matches when the user runs 5.3 or 6.4.
 */

import type { Plan, PlanWorkout, WorkoutType } from '../coach/plan-types';
import type { NormalizedActivity } from '../app/api/strava/activities/route-shared';

export const COMPLETION_MIN_FRACTION = 0.6;
export const MATCH_DISTANCE_TOLERANCE = 0.15;

export interface PlanMatch {
  workout: PlanWorkout;
  activity: NormalizedActivity;
  actualMi: number;
  plannedMi: number;
  /** actualMi / max(plannedMi, 0.1). 1.0 = exactly on plan. */
  fraction: number;
  isComplete: boolean;
}

function isRun(a: NormalizedActivity): boolean {
  return a.type === 'Run' || a.sportType === 'Run' || a.sportType === 'TrailRun';
}

/** True when the activity should be considered a match for the workout.
 *  Rules: same date, is a run, distance within ±15% of planned (or any
 *  same-day run when planned is 0). */
export function activityMatchesWorkout(
  activity: NormalizedActivity,
  workout: PlanWorkout,
): boolean {
  if (activity.date !== workout.dateISO) return false;
  if (!isRun(activity)) return false;
  if (workout.type === 'rest') return false;
  if (workout.distanceMi <= 0) return true;
  const delta = Math.abs(activity.distanceMi - workout.distanceMi) / Math.max(workout.distanceMi, 0.1);
  return delta <= MATCH_DISTANCE_TOLERANCE;
}

/** Pick the best Strava activity for a planned workout.
 *  Preference order: distance-tolerant same-day run (closest to planned)
 *  → any same-day run (longest first, for runners who logged a long run
 *  on a rest day or doubled up). Returns null when no run on that date. */
export function findActivityForWorkout(
  workout: PlanWorkout,
  activities: NormalizedActivity[],
): NormalizedActivity | null {
  const sameDay = activities.filter(a => a.date === workout.dateISO && isRun(a));
  if (sameDay.length === 0) return null;
  if (workout.distanceMi > 0) {
    const within = sameDay.filter(a =>
      Math.abs(a.distanceMi - workout.distanceMi) / Math.max(workout.distanceMi, 0.1) <= MATCH_DISTANCE_TOLERANCE,
    );
    if (within.length > 0) {
      return within.sort(
        (a, b) =>
          Math.abs(a.distanceMi - workout.distanceMi) - Math.abs(b.distanceMi - workout.distanceMi),
      )[0];
    }
  }
  return sameDay.sort((a, b) => b.distanceMi - a.distanceMi)[0];
}

/** Reverse lookup: given an activity, find the PlanWorkout it covers.
 *  null when the date isn't in the plan, the day is a rest, or the
 *  distance is wildly off (e.g. a 26-mi run on a 4-mi recovery day). */
export function findWorkoutForActivity(
  plan: Plan,
  activity: NormalizedActivity,
): PlanWorkout | null {
  for (const week of plan.weeks) {
    for (const workout of week.workouts) {
      if (activityMatchesWorkout(activity, workout)) return workout;
    }
  }
  return null;
}

/** Find the PlanWorkout (if any) for a specific calendar date. Includes
 *  rest days — caller decides whether to surface those. */
export function findWorkoutForDate(plan: Plan, dateISO: string): PlanWorkout | null {
  for (const week of plan.weeks) {
    for (const workout of week.workouts) {
      if (workout.dateISO === dateISO) return workout;
    }
  }
  return null;
}

/** Decide whether a planned workout's mileage has been fulfilled.
 *  actual ≥ 60% × planned (treats a rest day with miles=0 as not done
 *  by definition — there's nothing to fulfill). */
export function isWorkoutComplete(plannedMi: number, actualMi: number): boolean {
  if (plannedMi <= 0) return false;
  return actualMi >= plannedMi * COMPLETION_MIN_FRACTION;
}

/** Build every (workout, activity) pair where a same-day run covers
 *  the planned workout. Used by /api/strava/sync to drive writeback +
 *  shoe auto-assign in one pass. */
export function buildPlanMatches(
  plan: Plan,
  activities: NormalizedActivity[],
): PlanMatch[] {
  const out: PlanMatch[] = [];
  for (const week of plan.weeks) {
    for (const workout of week.workouts) {
      if (workout.type === 'rest' || workout.distanceMi <= 0) continue;
      const match = findActivityForWorkout(workout, activities);
      if (!match) continue;
      const fraction = match.distanceMi / Math.max(workout.distanceMi, 0.1);
      out.push({
        workout,
        activity: match,
        actualMi: match.distanceMi,
        plannedMi: workout.distanceMi,
        fraction,
        isComplete: isWorkoutComplete(workout.distanceMi, match.distanceMi),
      });
    }
  }
  return out;
}

/** Map of completed mileage per date in the current plan window — i.e.
 *  for each planned date that has a same-day run, the total miles run.
 *  Used by the calendar / week-strip / today-card to show a ✓ pill. */
export function getCompletedMileageByDate(
  plan: Plan,
  activities: NormalizedActivity[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const week of plan.weeks) {
    for (const workout of week.workouts) {
      const sameDay = activities.filter(a => a.date === workout.dateISO && isRun(a));
      if (sameDay.length === 0) continue;
      const total = Math.round(sameDay.reduce((s, a) => s + a.distanceMi, 0) * 10) / 10;
      out.set(workout.dateISO, total);
    }
  }
  return out;
}

/** Workout-type → RunType for shoe auto-assignment. Prefers the
 *  planned type over Strava's freeform activity name so a planned
 *  "Easy" run with an activity called "Lunch run" still gets the easy
 *  shoe. Mirrors lib/shoe-utils.inferRunType but flows from the plan. */
export function runTypeForWorkout(type: WorkoutType): 'race' | 'long' | 'easy' | 'recovery' | 'tempo' | 'intervals' | 'as_needed' {
  switch (type) {
    case 'race':      return 'race';
    case 'long':      return 'long';
    case 'recovery':  return 'recovery';
    case 'shakeout':  return 'recovery';
    case 'easy':      return 'easy';
    case 'threshold': return 'tempo';
    case 'mp':        return 'tempo';
    case 'interval':  return 'intervals';
    default:          return 'as_needed';
  }
}
