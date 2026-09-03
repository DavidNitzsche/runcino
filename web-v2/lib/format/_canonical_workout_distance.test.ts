/**
 * _canonical_workout_distance.test.ts · CONTRACT-1 (2026-09-03)
 *
 * Today's dose (`lib/training/spec-card.ts`) and the phone/watch payload
 * (`lib/watch/build-workout.ts`) must render the same total distance for
 * the same `plan_workouts` row. Traced 2026-09-03 after a report showed the
 * same "10×60s hills" workout at both 6.0 mi and 6.5 mi across two handback
 * reports — the actual cause was two different databases being compared
 * (production vs. an isolated QA seed), not a code defect, but the trace
 * also found the two composers applying DIFFERENT numeric transforms to
 * the same column (`roundTo(_, 1)` in one, a raw `Number()` in the other).
 * They agreed today only because `plan_workouts.distance_mi` happens to
 * already be stored pre-rounded — nothing enforced that they would keep
 * agreeing.
 *
 * `canonicalWorkoutDistanceMi` is now the ONE function both call. This
 * test does two things per Rule 18: it asserts the function's own behavior
 * (so a change to the rounding rule is deliberate, not incidental), and it
 * scans the two composer files to assert they actually call it — a
 * liveness check, so this contract cannot silently stop being enforced if
 * someone reverts one call site back to an inline expression.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { canonicalWorkoutDistanceMi } from './run';

describe('canonicalWorkoutDistanceMi', () => {
  it('rounds to one decimal, same as the stored plan value normally already is', () => {
    expect(canonicalWorkoutDistanceMi(6)).toBe(6);
    expect(canonicalWorkoutDistanceMi(6.04)).toBe(6);
    expect(canonicalWorkoutDistanceMi(6.05)).toBe(6.1);
    expect(canonicalWorkoutDistanceMi('6.5')).toBe(6.5);
  });

  it('never returns a negative or non-finite total', () => {
    expect(canonicalWorkoutDistanceMi(0)).toBe(0);
    expect(canonicalWorkoutDistanceMi(-3)).toBe(0);
    expect(canonicalWorkoutDistanceMi(null)).toBe(0);
    expect(canonicalWorkoutDistanceMi(undefined)).toBe(0);
    expect(canonicalWorkoutDistanceMi('not a number')).toBe(0);
    expect(canonicalWorkoutDistanceMi(NaN)).toBe(0);
  });

  it("is never re-summed from phases — it only normalizes the plan row's own figure", () => {
    // A distance far outside anything a real workout's phases would sum to
    // must still pass straight through the rounding rule, proving nothing
    // here consults phase data at all.
    expect(canonicalWorkoutDistanceMi(123.45)).toBe(123.5);
  });
});

describe('Today/Run/Watch distance contract — both composers call the one function', () => {
  const root = join(__dirname, '..', '..');

  it("Today's dose (spec-card.ts) calls canonicalWorkoutDistanceMi for every total_mi it produces", () => {
    const src = readFileSync(join(root, 'lib/training/spec-card.ts'), 'utf8');
    const totalAssignments = src.match(/const total = [^;]+;/g) ?? [];
    expect(totalAssignments.length).toBeGreaterThan(0);
    for (const line of totalAssignments) {
      expect(line).toContain('canonicalWorkoutDistanceMi(');
    }
  });

  it('the watch/phone payload (build-workout.ts) calls the same function for WatchWorkout.distanceMi', () => {
    const src = readFileSync(join(root, 'lib/watch/build-workout.ts'), 'utf8');
    expect(src).toContain('const distanceMi = canonicalWorkoutDistanceMi(wo.distance_mi);');
  });
});
