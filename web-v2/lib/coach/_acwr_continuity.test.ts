/**
 * _acwr_continuity.test.ts · CONTINUOUS-LOAD-1 · Rule 9 · the ACWR response is
 * a slope, not a stop-light.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `loadContextMultiplier` was a step function on Gabbett's zone edges:
 *
 *   acwr > 1.5  ->  0.88      acwr > 1.3  ->  0.95
 *   acwr < 0.8  ->  1.05      otherwise   ->  1.00
 *
 * So a runner at 1.300 kept his whole readiness score and a runner at 1.301
 * lost 5% of it, on an input that is a ratio of two rolling averages and moves
 * by that much when a single easy run lands on one side of midnight. Same
 * again, harder, at 1.5.
 *
 * ── WHY THE FIX IS NOT "MOVING DOCTRINE'S NUMBER" ──────────────────────────
 *
 * 1.3 and 1.5 are real, cited numbers and they are kept exactly. What changes
 * is that the RESPONSE runs continuously through them instead of stepping at
 * them — which is what `Research/15-wearable-data.md` §"Acute:Chronic Workload
 * Ratio (ACWR)" actually asks for, in the paragraph immediately under the zone
 * table:
 *
 *   "treat ACWR as a directional sanity check, not a stop-light ... a ratio of
 *    1.4 in itself is not a verdict"
 *
 * A step function IS a stop-light. Under the old code 1.4 bought the full
 * elevated penalty — a verdict — which is the one reading that paragraph rules
 * out. So this is doctrine being restored, not bent.
 *
 * Rule 18: falsified against the unfixed engine before landing — the walk
 * reported a 0.0500 step at 1.30 and 0.0700 at 1.50.
 */
import { describe, it, expect } from 'vitest';
import {
  loadContextMultiplier,
  LOAD_CONTEXT_MULTIPLIER,
  LOAD_CONTEXT_CURVE,
} from './readiness';

/** Walk the ratio and report the worst single step and worst inversion. */
function walk(lo: number, hi: number, stepBy = 0.001) {
  let worst = 0;
  let worstAt = 0;
  let inversion = 0;
  let inversionAt = 0;
  const at = (r: number) => loadContextMultiplier(r, r * 4, 4);
  let prev = at(lo);
  for (let r = lo + stepBy; r <= hi + 1e-9; r += stepBy) {
    const cur = at(Math.round(r * 1000) / 1000);
    const d = Math.abs(cur - prev);
    if (d > worst) { worst = d; worstAt = r; }
    // The ratio RISES through the walk, so the multiplier must never rise
    // with it: more acute load may not buy a better readiness multiplier.
    if (cur - prev > inversion) { inversion = cur - prev; inversionAt = r; }
    prev = cur;
  }
  return { worst, worstAt, inversion, inversionAt };
}

describe('CONTINUOUS-LOAD-1 · the walk reaches the zone edges', () => {
  it('liveness · the sweep spans every band doctrine names', () => {
    // A walk that never leaves one band proves nothing (Rule 18).
    expect(loadContextMultiplier(0.6, 2.4, 4)).toBeGreaterThan(1);
    expect(loadContextMultiplier(1.15, 4.6, 4)).toBe(1);
    expect(loadContextMultiplier(1.9, 7.6, 4)).toBeLessThan(0.95);
  });

  it('the curve is anchored on doctrine’s own zone edges and multipliers', () => {
    const xs = LOAD_CONTEXT_CURVE.map(([x]) => x);
    expect(xs).toContain(0.8);   // Research/15 · sweet-spot floor
    expect(xs).toContain(1.3);   // Research/15 · caution edge
    expect(xs).toContain(1.5);   // Research/15 · danger edge
    // The sweet spot is FLAT · a runner banks nothing for an ordinary week.
    expect(loadContextMultiplier(0.85, 3.4, 4)).toBe(1);
    expect(loadContextMultiplier(1.2, 4.8, 4)).toBe(1);
    const ys = LOAD_CONTEXT_CURVE.map(([, y]) => y);
    for (const y of ys) {
      expect(Object.values(LOAD_CONTEXT_MULTIPLIER) as number[]).toContain(y);
    }
  });
});

describe('CONTINUOUS-LOAD-1 · no step at 1.3 or 1.5', () => {
  const r = walk(0.5, 2.2);

  it('the multiplier is CONTINUOUS across every zone edge', () => {
    // 0.001 of ratio may move the multiplier by at most the steepest cited
    // segment's slope over that interval, with a little room for float.
    expect(
      r.worst,
      `load multiplier stepped ${r.worst.toFixed(4)} at ACWR ${r.worstAt.toFixed(3)}`,
    ).toBeLessThanOrEqual(0.002);
  });

  it('more acute load never buys a BETTER multiplier', () => {
    expect(
      r.inversion,
      `multiplier ROSE by ${r.inversion.toFixed(4)} as load rose, at ACWR ${r.inversionAt.toFixed(3)}`,
    ).toBeLessThanOrEqual(1e-9);
  });
});

describe('CONTINUOUS-LOAD-1 · doctrine survives the smoothing', () => {
  it('the cited zone edges are still where the response changes character', () => {
    // Inside the sweet spot nothing pulls the score.
    expect(loadContextMultiplier(1.0, 4, 4)).toBe(1);
    expect(loadContextMultiplier(1.3, 5.2, 4)).toBe(1);
    // Past the caution edge it starts to bite, and keeps biting.
    expect(loadContextMultiplier(1.35, 5.4, 4)).toBeLessThan(1);
    expect(loadContextMultiplier(1.5, 6, 4)).toBeLessThan(loadContextMultiplier(1.35, 5.4, 4));
    expect(loadContextMultiplier(1.7, 6.8, 4)).toBeLessThan(loadContextMultiplier(1.5, 6, 4));
  });

  it('Research/15 · "a ratio of 1.4 in itself is not a verdict"', () => {
    // The old code handed 1.4 the FULL elevated penalty. It now sits between
    // neutral and elevated — a nudge, which is what the doc asks for.
    const m = loadContextMultiplier(1.4, 5.6, 4);
    expect(m).toBeLessThan(LOAD_CONTEXT_MULTIPLIER.neutral);
    expect(m).toBeGreaterThan(LOAD_CONTEXT_MULTIPLIER.elevated);
  });

  it('every value stays inside D1 §2.4’s stated [0.85, 1.10]', () => {
    for (let r = 0; r <= 4; r += 0.01) {
      const m = loadContextMultiplier(r, r * 4, 4);
      expect(m, `ACWR ${r.toFixed(2)}`).toBeGreaterThanOrEqual(0.85);
      expect(m, `ACWR ${r.toFixed(2)}`).toBeLessThanOrEqual(1.10);
    }
  });

  it('an unreadable ratio still has no opinion', () => {
    expect(loadContextMultiplier(null, null, null)).toBe(LOAD_CONTEXT_MULTIPLIER.neutral);
    expect(loadContextMultiplier(Number.NaN, 1, 1)).toBe(LOAD_CONTEXT_MULTIPLIER.neutral);
  });

  it('the ATL-under-CTL guard still caps the penalty at elevated', () => {
    // A high ratio whose acute load is NOT above chronic is not a spike.
    expect(loadContextMultiplier(1.9, 3, 4)).toBe(LOAD_CONTEXT_MULTIPLIER.elevated);
    expect(loadContextMultiplier(1.9, 7.6, 4)).toBeLessThan(LOAD_CONTEXT_MULTIPLIER.elevated);
  });
});
