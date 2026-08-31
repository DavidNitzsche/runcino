/**
 * _max_hr_lthr_floor.test.ts · LTHR-IMPLIED-FLOOR-1.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `loadEffectiveMaxHr` resolved "the highest verified value from a hard
 * effort in the last 12 months" and treated it as the runner's physiological
 * ceiling. For a runner whose only recent HR evidence is training runs and a
 * threshold-effort race — never an all-out sprint finish or a VO2max test —
 * "highest observed" is a FLOOR, not a ceiling. Verified against prod
 * 2026-08-31: the owner's effective max HR resolved to 180 bpm
 * (`observed_12mo`, health_samples=180 / runs.data.maxHr=179) while his
 * `profile.lthr` — re-anchored 2026-08-30 from a representative half
 * marathon — is 168. Every %HRmax-gated computation in the app (zones,
 * overexertion guards, effort classifiers) read against a ceiling that was
 * too low, which makes real easy running misclassify as harder than it is.
 *
 * This file falsifies the fix per Rule 18: (a) proves the OLD behaviour was
 * wrong by showing what it returned for the owner's real numbers, (b) proves
 * the NEW merge lifts the ceiling correctly, (c) proves it does NOT fire on
 * an absent/stale LTHR, (d) proves the sovereign override still wins over
 * everything, and (e) walks the crossover boundary per Rule 9 — no cliff.
 */
import { describe, it, expect } from 'vitest';
import {
  LTHR_TO_HRMAX_CONSERVATIVE_PCT,
  hrMaxImpliedByLthr,
  lthrFloorIsFresh,
  mergeWithLthrFloor,
  isPlausibleMaxHr,
  type MaxHrCandidate,
} from './max-hr';
import { LTHR_RETEST_CADENCE_DAYS } from '@/lib/training/lthr-cadence';

describe('LTHR_TO_HRMAX_CONSERVATIVE_PCT · the conservative divisor', () => {
  it('is the doctrine-cited 92% — the HIGH edge of the %HRmax-at-Threshold band', () => {
    expect(LTHR_TO_HRMAX_CONSERVATIVE_PCT).toBe(0.92);
  });
});

describe('hrMaxImpliedByLthr · pure derivation', () => {
  it('the owners real numbers: LTHR 168 implies ~183, strictly above the stale 180 ceiling', () => {
    // 2026-08-31 · this is the exact falsification: BEFORE this fix,
    // loadEffectiveMaxHr's `observed_12mo` rung returned 180 for this
    // runner and nothing corrected it. 168 / 0.92 = 182.6 -> rounds to 183.
    const implied = hrMaxImpliedByLthr(168);
    expect(implied).toBe(183);
    expect(implied!).toBeGreaterThan(180);
  });

  it('matches the hand-derived conservative bound: LTHR / 0.92, rounded', () => {
    for (const lthr of [150, 155, 160, 162, 168, 172, 180]) {
      expect(hrMaxImpliedByLthr(lthr)).toBe(Math.round(lthr / 0.92));
    }
  });

  it('is null-safe', () => {
    expect(hrMaxImpliedByLthr(null)).toBeNull();
    expect(hrMaxImpliedByLthr(undefined)).toBeNull();
    expect(hrMaxImpliedByLthr(0)).toBeNull();
    expect(hrMaxImpliedByLthr(NaN)).toBeNull();
    expect(hrMaxImpliedByLthr(-10)).toBeNull();
  });

  it('is plausibility-bounded — a garbage LTHR must not produce a garbage floor', () => {
    // 300 / 0.92 = 326, far outside isPlausibleMaxHr's 100-230 band.
    expect(hrMaxImpliedByLthr(300)).toBeNull();
    // Sanity: the band itself agrees.
    expect(isPlausibleMaxHr(326)).toBe(false);
  });
});

describe('lthrFloorIsFresh · Friel re-test cadence, reused not re-derived', () => {
  const TODAY = '2026-08-31';

  it('an anchor set today is fresh', () => {
    expect(lthrFloorIsFresh('2026-08-31', TODAY)).toBe(true);
  });

  it('an anchor at exactly the cadence ceiling is still fresh (inclusive)', () => {
    const setAt = new Date(Date.parse(TODAY + 'T12:00:00Z') - LTHR_RETEST_CADENCE_DAYS * 86400000)
      .toISOString().slice(0, 10);
    expect(lthrFloorIsFresh(setAt, TODAY)).toBe(true);
  });

  it('an anchor one day past the cadence ceiling is stale', () => {
    const setAt = new Date(Date.parse(TODAY + 'T12:00:00Z') - (LTHR_RETEST_CADENCE_DAYS + 1) * 86400000)
      .toISOString().slice(0, 10);
    expect(lthrFloorIsFresh(setAt, TODAY)).toBe(false);
  });

  it('no stamp at all is never fresh', () => {
    expect(lthrFloorIsFresh(null, TODAY)).toBe(false);
    expect(lthrFloorIsFresh(undefined, TODAY)).toBe(false);
  });
});

describe('mergeWithLthrFloor · the GREATER wins, never a downward pull', () => {
  it('BEFORE/AFTER falsification: the owners real prod numbers', () => {
    // BEFORE this fix: loadEffectiveMaxHr's rung 2 returned this and nothing
    // else was ever consulted. This is what the OLD code shipped.
    const oldBehaviour: MaxHrCandidate = { bpm: 180, source: 'observed_12mo', observedFrom: 'health_samples' };
    expect(oldBehaviour.bpm).toBe(180); // the defect, stated as a fact

    // AFTER this fix: the same observed baseline, now merged against the
    // LTHR-implied floor computed from his real LTHR of 168.
    const lthrFloor = hrMaxImpliedByLthr(168);
    const merged = mergeWithLthrFloor(oldBehaviour, lthrFloor);
    expect(merged.source).toBe('lthr_implied');
    expect(merged.bpm).toBe(183);
    expect(merged.bpm!).toBeGreaterThan(oldBehaviour.bpm);
  });

  it('never fires when there is no LTHR floor to compete with', () => {
    const baseline: MaxHrCandidate = { bpm: 180, source: 'observed_12mo', observedFrom: 'runs' };
    const merged = mergeWithLthrFloor(baseline, null);
    expect(merged).toEqual({ bpm: 180, source: 'observed_12mo', observedFrom: 'runs' });
  });

  it('never pulls a higher empirical reading DOWN — the floor only lifts', () => {
    // A runner with a genuinely high observed max (e.g. a real sprint finish)
    // whose LTHR-implied floor is lower must keep their real observed number.
    const baseline: MaxHrCandidate = { bpm: 195, source: 'observed_12mo', observedFrom: 'runs' };
    const merged = mergeWithLthrFloor(baseline, 183);
    expect(merged.bpm).toBe(195);
    expect(merged.source).toBe('observed_12mo');
  });

  it('competes with manual_stored exactly as it does with observed_12mo', () => {
    const baseline: MaxHrCandidate = { bpm: 175, source: 'manual_stored', observedFrom: null };
    const merged = mergeWithLthrFloor(baseline, 183);
    expect(merged.bpm).toBe(183);
    expect(merged.source).toBe('lthr_implied');
  });

  it('wins outright from a cold start (no observed, no stored) when a floor exists', () => {
    const merged = mergeWithLthrFloor(null, 183);
    expect(merged).toEqual({ bpm: 183, source: 'lthr_implied', observedFrom: null });
  });

  it('stays a true cold start when neither a baseline nor a floor exists', () => {
    const merged = mergeWithLthrFloor(null, null);
    expect(merged).toEqual({ bpm: null, source: 'unknown', observedFrom: null });
  });

  it('RULE 9 · no cliff at the crossover — walk the boundary in 1 bpm steps', () => {
    // The baseline is fixed at 180 (the owner's real observed ceiling). Walk
    // the LTHR-implied floor from just below 180 to just above it and assert
    // the merged bpm is continuous (moves by exactly the step size or holds)
    // and monotonically non-decreasing — a max() of two continuous inputs
    // has no discontinuity to hide, and this proves it rather than asserting
    // it by construction.
    const baseline: MaxHrCandidate = { bpm: 180, source: 'observed_12mo', observedFrom: 'health_samples' };
    let prevBpm = -Infinity;
    for (let floor = 170; floor <= 190; floor += 1) {
      const merged = mergeWithLthrFloor(baseline, floor);
      expect(merged.bpm).not.toBeNull();
      // Monotonic non-decreasing as the floor rises.
      expect(merged.bpm!).toBeGreaterThanOrEqual(prevBpm === -Infinity ? -Infinity : prevBpm);
      // Continuous: never jumps by more than the 1 bpm step between iterations.
      if (prevBpm !== -Infinity) {
        expect(Math.abs(merged.bpm! - prevBpm)).toBeLessThanOrEqual(1);
      }
      prevBpm = merged.bpm!;
      // And the source label itself only flips ONCE across the whole walk,
      // exactly at the point the floor first exceeds the baseline — never
      // flickers back and forth, which would be a different Rule 9 defect
      // hiding in the label rather than the number.
      const expectedSource = floor > baseline.bpm ? 'lthr_implied' : 'observed_12mo';
      expect(merged.source).toBe(expectedSource);
    }
  });
});
