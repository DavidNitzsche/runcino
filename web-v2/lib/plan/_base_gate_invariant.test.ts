/**
 * _base_gate_invariant.test.ts · BASE-GATE-1 (2026-08-25)
 *
 * "Do I need a base phase since I'm coming off of training?"
 *
 * The answer for the owner is no, and the reason is not the one the source
 * reads like. `composePlan` computes
 *
 *   baseRebuilt = evidence == null
 *              || !(evidence.sustainedMi > 0)
 *              || evidence.meanMi >= BASE_REBUILT_SHARE * evidence.sustainedMi   // 3
 *              || evidence.lifted;                                               // 4
 *
 * and disjunct 3 reads like a VOLUME test that a light month would fail. It is
 * not, because `resolveRampBase` sets `lifted` when
 * `sustainedMi * RAMP_BASE_RESUME_FRACTION > meanMi` — and
 * `RAMP_BASE_RESUME_FRACTION` and `BASE_REBUILT_SHARE` are the same 0.70.
 *
 * So 3 and 4 are EXACT COMPLEMENTS around one constant. For any runner whose
 * interruption run fits the allowance, one of them is always true and the mean
 * cannot decide anything. What actually decides is
 * `interruptionWeeks > allowedInterruptionWeeks` — the length of the
 * consecutive most-recent run below resume level, which is a RECENCY test and
 * not a depth one. A vacation week, a taper, a race week or a work trip sitting
 * anywhere but the front of the series never enters it, and the mean it drags
 * down is not the statistic in play.
 *
 * ── WHY THIS IS A TEST AND NOT A COMMENT ─────────────────────────────────
 *
 * The complementarity is load-bearing and invisible: it holds only while the
 * two constants are equal, and they are declared seven hundred lines apart in
 * different sections. Raise `BASE_REBUILT_SHARE` to 0.75 on its own and a gap
 * opens between the two disjuncts where BOTH are false — and every mid-block
 * runner whose mean lands in that gap is silently demoted into a base phase
 * they do not need, with no test failing. That is the defect this file exists
 * to make impossible.
 *
 * The other half is DOCTRINE-BASE-1's own purpose, which must survive any
 * change here: a genuinely detrained runner passes the QUALITY gate whenever a
 * stale plan is still on file, so the volume side is the only thing standing
 * between them and a build block. It still stands.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveRampBase,
  BASE_REBUILT_SHARE,
  RAMP_BASE_RESUME_FRACTION,
  RAMP_BASE_SUSTAINED_RANK,
} from './generate';

/** `composePlan`'s expression, verbatim, against a resolved evidence object. */
function baseRebuilt(e: ReturnType<typeof resolveRampBase> | null): boolean {
  return e == null
    || !(e.sustainedMi > 0)
    || e.meanMi >= BASE_REBUILT_SHARE * e.sustainedMi
    || e.lifted;
}

const mean4 = (s: number[]) => (s[0] + s[1] + s[2] + s[3]) / 4;
const resolve = (series: number[], allowed: number) =>
  resolveRampBase({ meanWeeklyMi: mean4(series), weeklySeries: series, allowedInterruptionWeeks: allowed });

/** Sixteen weeks of real training, most-recent-first, with the front replaced. */
const trained = [40.3, 46.4, 6, 27.9, 41.4, 40, 45.9, 38.7, 40.8, 43.5, 41, 44, 39, 42, 40, 43];
const withFront = (front: number[]) => [...front, ...trained].slice(0, 16);

describe('BASE-GATE-1 · what decides whether a mid-block runner rebuilds base', () => {
  it('the two constants are the same number, which is what makes 3 and 4 complements', () => {
    expect(
      BASE_REBUILT_SHARE,
      'BASE_REBUILT_SHARE and RAMP_BASE_RESUME_FRACTION must stay equal. `lifted` fires when ' +
      'sustained × RAMP_BASE_RESUME_FRACTION > mean and disjunct 3 fires when ' +
      'mean >= sustained × BASE_REBUILT_SHARE. Equal, they cover every mean between them. ' +
      'Unequal, a gap opens where BOTH are false and a mid-block runner inside the ' +
      'interruption allowance is demoted into a base phase with nothing reporting it.',
    ).toBe(RAMP_BASE_RESUME_FRACTION);
  });

  it('inside the interruption allowance, NO mean produces a base phase', () => {
    // Sweep the front week across the whole range, so the mean moves from far
    // below the threshold to far above it. The verdict must not change.
    for (const frontMi of [0, 5, 10, 20, 30, 40, 50, 60]) {
      const e = resolve(withFront([frontMi]), 4);
      expect(e.interruptionWeeks).toBeLessThanOrEqual(e.allowedInterruptionWeeks);
      expect(
        baseRebuilt(e),
        `front week ${frontMi} mi · mean ${e.meanMi} against ${BASE_REBUILT_SHARE} × ${e.sustainedMi} — ` +
        'a runner inside the allowance must never be sent to base by the mean',
      ).toBe(true);
    }
  });

  it('a light week is invisible unless it is at the FRONT of the series', () => {
    // The owner's own case: a vacation week sitting mid-series. It drags the
    // 28-day mean down and contributes nothing to the interruption run.
    const vacationMidSeries = [38, 40, 4.2, 39, ...trained].slice(0, 16);
    const e = resolve(vacationMidSeries, 2);
    expect(e.interruptionWeeks, 'a hole behind the front does not count as an interruption').toBe(0);
    expect(baseRebuilt(e)).toBe(true);
  });

  it('past the allowance, the mean governs and a detrained runner DOES rebuild base', () => {
    // DOCTRINE-BASE-1's own case, and the one that must survive every change
    // above: eight weeks down. The `3` variant is the dangerous one — a stale
    // plan on file makes them pass the quality gate, so this is the only thing
    // left holding them out of a build block.
    for (const idleMi of [0, 3]) {
      const e = resolve(withFront(Array(8).fill(idleMi)), 2);
      expect(e.interruptionWeeks).toBeGreaterThan(e.allowedInterruptionWeeks);
      expect(e.lifted, 'a layoff longer than the allowance is never lifted').toBe(false);
      expect(
        baseRebuilt(e),
        `eight weeks at ${idleMi} mi must rebuild base`,
      ).toBe(false);
    }
  });

  it('the boundary is the allowance, not the depth', () => {
    const allowed = 4;
    const inside = resolve(withFront(Array(allowed).fill(2)), allowed);
    const outside = resolve(withFront(Array(allowed + 1).fill(2)), allowed);
    expect(baseRebuilt(inside), `${allowed} weeks down, allowance ${allowed} · no base`).toBe(true);
    expect(baseRebuilt(outside), `${allowed + 1} weeks down, allowance ${allowed} · base`).toBe(false);
  });

  it('a series too short to rank a sustained level never claims one', () => {
    // `sustainedMi` is rank-N of the series; below N samples there is no
    // sustained level to compare against and disjunct 2 carries the answer.
    const e = resolve(Array(RAMP_BASE_SUSTAINED_RANK - 1).fill(40), 2);
    expect(e.sustainedMi).toBe(0);
    expect(baseRebuilt(e), 'no evidence is not evidence of detraining').toBe(true);
  });
});
