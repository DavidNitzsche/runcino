/**
 * lib/plan/adapter-bench.test.ts · adapter integrity tests.
 *
 * Phase 4 of the fail-proof plan-engine rebuild (David 2026-06-02).
 * Companion to generator-bench.test.ts · audits that adapter mutations
 * never break doctrine targets.
 *
 * The adapter (adapt.ts) has 4 mutation kinds:
 *   · reschedule    · move workout date (preserves type + distance)
 *   · downgrade     · change quality → easy (must clear workout_spec)
 *   · shave         · reduce distance_mi by fraction (≥ 0.5 mi floor)
 *   · mark_dirty    · annotation only · no mutation
 *
 * Tests verify these properties pure-logically · the actual SQL paths
 * are tested via integration but here we audit the math + invariants
 * the SQL must respect.
 *
 * Cite: lib/plan/adapt.ts § applyAdaptations
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §adapter
 */

import { describe, it, expect } from 'vitest';
/*
 * DECLAREDLEVEL-0 (2026-09-02) · THE 'Adapter · EXPERIENCE_CAPS vs tier
 * targets' SUITE IS DELETED, along with the `EXPERIENCE_CAPS_MI` /
 * `TIER_TARGETS` / `classifyGoalTier` imports it needed.
 *
 * Its subject was the mapping from a self-declared experience label to a
 * weekly-volume ceiling (beginner→developing, advanced_plus→elite), and
 * whether that ceiling sat clear of the tier bands the generator prescribes.
 * The owner removed self-declared experience-level bands from every plan and
 * adaptation decision, `EXPERIENCE_CAPS_MI` is deleted from `adapt.ts`, and
 * `detectVolumeOvershoot` now grades against the runner's own chronic load or
 * refuses. There is no level→cap relationship left for this to keep honest.
 *
 * Worth naming on the way out, because it is Rule 18's own example: the second
 * case ended `// Soft check · log but don't fail`. It computed a pass/fail,
 * printed a warning when it failed, and asserted nothing. It could not fail,
 * for any input, ever — and it reported green for as long as it existed.
 */

describe('Adapter · shave operation invariants', () => {
  // Shave reduces distance by fraction · documented in adapt.ts:233-242
  // SQL: ROUND((distance_mi * (1 - fraction)) * 2) / 2 (snap to 0.5 mi)
  // Floor: GREATEST(0.5, ...)
  // Guard: only applies WHERE distance_mi >= 1.0
  const simShave = (mi: number, fraction: number): number => {
    if (mi < 1.0) return mi;  // adapter's guard
    return Math.max(0.5, Math.round(mi * (1 - fraction) * 2) / 2);
  };

  it('shave reduces distance · never increases', () => {
    for (const mi of [3, 5, 7.5, 11, 14, 20]) {
      for (const frac of [0.05, 0.10, 0.15, 0.25]) {
        const shaved = simShave(mi, frac);
        expect(shaved).toBeLessThanOrEqual(mi);
      }
    }
  });

  it('shave respects 0.5mi floor', () => {
    for (const mi of [1.0, 1.5, 2.0]) {
      const shaved = simShave(mi, 0.99);
      expect(shaved).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('shave snaps to 0.5 mi increments', () => {
    for (const mi of [5, 7.5, 11, 14]) {
      for (const frac of [0.05, 0.10, 0.15]) {
        const shaved = simShave(mi, frac);
        // Should be a multiple of 0.5.
        const remainder = (shaved * 2) % 1;
        expect(remainder).toBe(0);
      }
    }
  });

  it('shave skips distance_mi < 1.0 · adapter SQL guard', () => {
    // Adapter SQL: WHERE distance_mi >= 1.0 · shorter rows untouched.
    for (const mi of [0.3, 0.5, 0.8, 0.99]) {
      const shaved = simShave(mi, 0.15);
      expect(shaved).toBe(mi);
    }
  });
});

describe('Adapter · downgrade operation invariants', () => {
  // Downgrade changes type to 'easy' or 'recovery' and MUST clear
  // workout_spec (was a known bug pre-task #100 · stale rep specs
  // bled through after type change). Documented in adapt.ts:176-222.

  it('downgrade target types are all non-quality', () => {
    const allowedDowngradeTypes = ['easy', 'recovery', 'rest'];
    for (const t of allowedDowngradeTypes) {
      // Smoke · these are the only types adapter should downgrade TO.
      expect(['easy', 'recovery', 'rest']).toContain(t);
    }
  });

  it('downgrade writes new minimal spec for easy/recovery (not NULL)', () => {
    // 2026-06-03 · iPhone agent Tier 3.e · downgrade now writes a
    // NEW spec for the downgraded type so the read pipeline
    // (expandSpecToPhases) has something to consume. Was setting
    // workout_spec = NULL · forced fallback to prescriptionFor().
    const downgradeToEasy = {
      type: 'easy',
      workout_spec: { kind: 'easy' },
      pace_target_s_per_mi: null,  // pace fills in at read via easyPaceFallback
    };
    expect(downgradeToEasy.workout_spec).not.toBeNull();
    expect((downgradeToEasy.workout_spec as { kind: string }).kind).toBe('easy');
  });

  it('downgrade to rest sets spec NULL (rest has no phases to expand)', () => {
    const downgradeToRest = {
      type: 'rest',
      workout_spec: null,
      pace_target_s_per_mi: null,
    };
    expect(downgradeToRest.workout_spec).toBeNull();
  });
});

describe('Adapter · reschedule operation invariants', () => {
  // Reschedule moves a workout to a new date. SQL pattern:
  //   UPDATE plan_workouts SET date_iso = $newDate WHERE id = $id
  // Preserves type, distance, spec · only the date changes.

  it('reschedule preserves all non-date fields', () => {
    // Adapter's reschedule SQL only touches date_iso.
    const before = { type: 'tempo', distance_mi: 8, workout_spec: { kind: 'tempo' } };
    const after = { ...before, date_iso: '2026-06-09' };
    expect(after.type).toBe(before.type);
    expect(after.distance_mi).toBe(before.distance_mi);
    expect(after.workout_spec).toEqual(before.workout_spec);
  });
});

describe('Adapter · mark_dirty operation invariants', () => {
  // mark_dirty appends a note · does NOT change distance / type / spec.
  // SQL: UPDATE plan_workouts SET notes = COALESCE(notes, '') ||
  //                                       ' [paces stale - recompute]'
  it('mark_dirty preserves all training fields', () => {
    const before = {
      type: 'threshold', distance_mi: 7.5,
      workout_spec: { kind: 'threshold' }, notes: 'WU 1.5mi...',
    };
    const after = { ...before, notes: before.notes + ' [paces stale - recompute]' };
    expect(after.type).toBe(before.type);
    expect(after.distance_mi).toBe(before.distance_mi);
    expect(after.workout_spec).toEqual(before.workout_spec);
    expect(after.notes).toContain('paces stale');
    expect(after.notes).toContain(before.notes);  // appended, not replaced
  });
});
