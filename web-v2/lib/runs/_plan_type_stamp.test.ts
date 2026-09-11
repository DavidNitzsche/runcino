import { describe, expect, it } from 'vitest';
import { distanceMatchesPlan, selectMatchingPlanDay } from './plan-type-stamp';

/**
 * OVERRUN-MATCH-1 · falsifies the exact regression this band exists to
 * prevent (Rule 18: a gate is not trusted until it has been made to fail).
 * The live incident: a 4.5 mi EASY prescription, 6.18 mi actually run
 * (+37.3%) — the old symmetric ±30% band refused this, this test locks in
 * that it must not refuse it again.
 */
describe('distanceMatchesPlan · OVERRUN-MATCH-1', () => {
  it('matches David\'s own 2026-08-31 run: 4.5 mi prescribed, 6.18 mi actual', () => {
    expect(distanceMatchesPlan(6.18, 4.5)).toBe(true);
  });

  it('still refuses a materially SHORT run — a bail is a different session', () => {
    // 4.5 * 0.7 = 3.15; 3.0 is short of the floor.
    expect(distanceMatchesPlan(3.0, 4.5)).toBe(false);
  });

  it('accepts a run right at the floor', () => {
    expect(distanceMatchesPlan(4.5 * 0.7, 4.5)).toBe(true);
  });

  it('accepts a run right at the new, doubled ceiling', () => {
    expect(distanceMatchesPlan(4.5 * 2.0, 4.5)).toBe(true);
  });

  it('still refuses a wildly unrelated, much longer effort on the same day', () => {
    // A marathon on a 4.5 mi easy day must not inherit "easy".
    expect(distanceMatchesPlan(26.2, 4.5)).toBe(false);
  });

  it('the old, pre-fix symmetric ±30% ceiling would have refused this — proving the fix actually moved the boundary', () => {
    const oldCeiling = 4.5 * 1.3; // 5.85
    expect(6.18).toBeGreaterThan(oldCeiling);
    expect(distanceMatchesPlan(6.18, 4.5)).toBe(true);
  });

  it('treats a missing or non-positive prescription distance as always matching', () => {
    expect(distanceMatchesPlan(6.18, null)).toBe(true);
    expect(distanceMatchesPlan(6.18, 0)).toBe(true);
  });
});

/**
 * WATCHMATCH-1 · falsifies the exact regression the primary watch-completion
 * matcher (`api/watch/workouts/complete/route.ts`) carried until this fix:
 * a separate, never-imported symmetric `[0.7, 1.3]` band, and a "pick the
 * numerically closest candidate" fallback with no ambiguity refusal at all.
 *
 * Each `it.each`-style case below states the PRE-FIX outcome inline as a
 * comment so a reviewer can see this suite would have failed against the old
 * code without having to reconstruct the old code first.
 */
describe('selectMatchingPlanDay · WATCHMATCH-1', () => {
  const DATE = '2026-09-05';

  it('overrun: a runner going long on an easy day still matches — the old symmetric ±30% ceiling (5.85mi) would have refused 6.18mi', () => {
    const result = selectMatchingPlanDay(DATE, 6.18, [
      { id: 'wko_easy', distanceMi: 4.5 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value?.id).toBe('wko_easy');
  });

  it('cut-short: a materially SHORT run still refuses — going long and cutting short are not the same signal', () => {
    // 4.5 * 0.7 = 3.15; 3.0 is short of the floor on both the old and new band.
    const result = selectMatchingPlanDay(DATE, 3.0, [
      { id: 'wko_easy', distanceMi: 4.5 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toBeNull();
  });

  it('AMBIGUOUS: two live prescriptions both plausibly fit — refuses rather than picking the numerically closest one', () => {
    // A two-a-day: an easy 4mi shakeout and a 5mi tempo. A 4.6mi completion
    // sits inside BOTH candidates' [0.7, 2.0] bands (2.8-8.0 and 3.5-10.0).
    // The OLD code picked whichever delta was smaller (|4.6-4|=0.6 vs
    // |4.6-5|=0.4 → old code would have silently picked the tempo session
    // for what may have been the shakeout). This must refuse instead.
    const result = selectMatchingPlanDay(DATE, 4.6, [
      { id: 'wko_shakeout', distanceMi: 4 },
      { id: 'wko_tempo', distanceMi: 5 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.refusal.code).toBe('ambiguous-plan-day-match');
    expect(result.refusal.candidateIds.sort()).toEqual(['wko_shakeout', 'wko_tempo']);
    // Rule 11: the refusal branch carries no `value` — this line must not
    // typecheck if it did. (Runtime assertion of the same contract.)
    expect((result as any).value).toBeUndefined();
  });

  it('zero matches is a definite answer, not a refusal — a run that fits NEITHER candidate is supplemental, not ambiguous', () => {
    const result = selectMatchingPlanDay(DATE, 26.2, [
      { id: 'wko_shakeout', distanceMi: 4 },
      { id: 'wko_tempo', distanceMi: 5 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toBeNull();
  });

  it('no candidates at all (rest day / no plan) is also a definite null, never a refusal', () => {
    const result = selectMatchingPlanDay(DATE, 6.2, []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toBeNull();
  });

  it('exactly one candidate surviving the band is never ambiguous, even with other non-matching candidates present', () => {
    const result = selectMatchingPlanDay(DATE, 6.18, [
      { id: 'wko_easy', distanceMi: 4.5 },
      { id: 'wko_long', distanceMi: 16 }, // 16*0.7=11.2 — 6.18 does not fit
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value?.id).toBe('wko_easy');
  });

  it('a candidate with no authored distance always matches, and is therefore itself a source of ambiguity alongside a real candidate', () => {
    // A prescription with no `distance_mi` (e.g. an "as prescribed"
    // by-effort workout) matches every actual distance per
    // `distanceMatchesPlan`'s own null contract. Paired with a real
    // candidate the run's distance also fits, this is genuinely ambiguous —
    // the matcher cannot tell which prescription a distance-less row and a
    // distance-matched row this run actually satisfied.
    const result = selectMatchingPlanDay(DATE, 6.18, [
      { id: 'wko_easy', distanceMi: 4.5 },
      { id: 'wko_by_effort', distanceMi: null },
    ]);
    expect(result.ok).toBe(false);
  });
});
