/**
 * _heat_continuity.test.ts · CONTINUOUS-HEAT-1 · Rule 9 · the ability axis is
 * interpolated like every other axis of the heat model.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `heat-model.ts` interpolates everything. Temperature is linear between the
 * Research/06 §1 rows; `dewpointAddPct` is linear; `durationHeatScale` is a
 * ramp. The ABILITY axis was two hard steps, in `abilityTierFromVdot`:
 *
 *   VDOT >= 60 -> elite ; VDOT >= 45 -> mid_pack ; else slow
 *
 * That is the tell Rule 9 names — the author interpolated everything else and
 * left two steps — and the steps are large. At an effective 85°F the same
 * conditions read 15.0% slowdown at VDOT 44.99 and 10.0% at 45.00. Five points
 * of predicted race time, about ten minutes on a 3:30 marathon, for one
 * hundredth of a VDOT, and it runs the wrong way: THE FITTER RUNNER'S HEAT
 * ALLOWANCE COLLAPSES.
 *
 * Live, 2026-08-30: the owner's anchor is VDOT 44.1 — nine tenths of a point
 * under the edge — so a single good race walks him across it.
 *
 * ── WHAT THIS GATE ASSERTS ──────────────────────────────────────────────────
 *
 * Walk a runner's VDOT across both edges at every temperature the table names
 * and require the slowdown to move continuously and monotonically. The three
 * cited columns must still be reproduced exactly at their anchors, so the
 * smoothing cannot be a quiet re-write of doctrine's numbers.
 *
 * Rule 18: falsified against the unfixed engine before landing. The table walk
 * failed at the first temperature it reached (1.00-point step at VDOT 45.00,
 * 60°F) and the composed-effort walk reported a 4.60-point step at VDOT 60.00
 * (82°F, dewpoint 68, 12000 s). The table's own worst cases are larger still:
 * 90°F is 19.0 / 13.0 / 6.0 across the three columns, so 6.00 points at VDOT 45
 * and 7.00 at VDOT 60.
 */
import { describe, it, expect } from 'vitest';
import {
  MAUGHAN_HEAT_SLOWDOWN,
  maughanSlowdownPct,
  maughanSlowdownPctForVdot,
  abilityTierFromVdot,
  ABILITY_ANCHOR_VDOT,
  effortSlowdownPct,
} from './heat-model';

const TEMPS = MAUGHAN_HEAT_SLOWDOWN.map((r) => r.tairF).filter((t) => t > 50);

describe('CONTINUOUS-HEAT-1 · doctrine’s three columns are reproduced exactly', () => {
  it('each cited column is the answer at its own anchor VDOT', () => {
    const A = ABILITY_ANCHOR_VDOT;
    for (const t of TEMPS) {
      expect(maughanSlowdownPctForVdot(t, A.slow), `slow @ ${t}F`)
        .toBeCloseTo(maughanSlowdownPct(t, 'slow'), 10);
      expect(maughanSlowdownPctForVdot(t, A.elite), `elite @ ${t}F`)
        .toBeCloseTo(maughanSlowdownPct(t, 'elite'), 10);
      // The mid-pack column holds across the WHOLE cited band, so no runner
      // doctrine calls mid-pack is priced as anything else.
      for (let v = A.midLo; v <= A.midHi; v += 0.5) {
        expect(maughanSlowdownPctForVdot(t, v), `mid @ ${t}F, VDOT ${v}`)
          .toBeCloseTo(maughanSlowdownPct(t, 'mid_pack'), 10);
      }
    }
  });

  it('EVERY anchor sits inside the band abilityTierFromVdot assigns that column', () => {
    // The constraint that rules out the tempting shape. Read out of the tier
    // function itself rather than hand-copied: a check that hardcodes both
    // sides only proves it agrees with itself (Rule 18).
    const A = ABILITY_ANCHOR_VDOT;
    expect(abilityTierFromVdot(A.slow)).toBe('slow');
    expect(abilityTierFromVdot(A.midLo)).toBe('mid_pack');
    expect(abilityTierFromVdot(A.midHi)).toBe('elite');      // 60 is the edge itself
    expect(abilityTierFromVdot(A.midHi - 0.01)).toBe('mid_pack');
    expect(abilityTierFromVdot(A.elite)).toBe('elite');
    // The open-ended columns sit one mid-band width outside their own edge.
    const bandWidth = A.midHi - A.midLo;
    expect(A.slow).toBe(A.midLo - bandWidth);
    expect(A.elite).toBe(A.midHi + bandWidth);
  });

  it('an unreadable VDOT still falls back to the population default', () => {
    for (const t of TEMPS) {
      expect(maughanSlowdownPctForVdot(t, null)).toBe(maughanSlowdownPct(t, 'mid_pack'));
      expect(maughanSlowdownPctForVdot(t, Number.NaN)).toBe(maughanSlowdownPct(t, 'mid_pack'));
    }
  });
});

describe('CONTINUOUS-HEAT-1 · no step at VDOT 45 or 60', () => {
  const STEP = 0.01;
  const LO = 40;
  const HI = 65;

  it('the slowdown is CONTINUOUS across both edges, at every cited temperature', () => {
    for (const t of TEMPS) {
      let prev = maughanSlowdownPctForVdot(t, LO);
      let worst = 0;
      let worstAt = LO;
      for (let v = LO + STEP; v <= HI + 1e-9; v += STEP) {
        const vdot = Math.round(v * 100) / 100;
        const cur = maughanSlowdownPctForVdot(t, vdot);
        if (Math.abs(cur - prev) > worst) { worst = Math.abs(cur - prev); worstAt = vdot; }
        prev = cur;
      }
      // The steepest cited segment is slow->mid over 7.5 VDOT; 0.01 of VDOT
      // can move the answer by a small fraction of a point, never a whole one.
      expect(
        worst,
        `slowdown stepped ${worst.toFixed(2)} points at VDOT ${worstAt.toFixed(2)} and ${t}°F`,
      ).toBeLessThanOrEqual(0.05);
    }
  });

  it('a FITTER runner is never handed a LARGER heat penalty', () => {
    for (const t of TEMPS) {
      let prev = maughanSlowdownPctForVdot(t, LO);
      for (let v = LO + STEP; v <= HI + 1e-9; v += STEP) {
        const vdot = Math.round(v * 100) / 100;
        const cur = maughanSlowdownPctForVdot(t, vdot);
        expect(
          cur,
          `slowdown ROSE from ${prev.toFixed(2)} to ${cur.toFixed(2)} as VDOT reached ` +
          `${vdot.toFixed(2)} at ${t}°F`,
        ).toBeLessThanOrEqual(prev + 1e-9);
        prev = cur;
      }
    }
  });

  it('the whole composed effort is continuous too, not just the table lookup', () => {
    // The owner's own neighbourhood: VDOT 44.1, walking across 45.
    let prev = effortSlowdownPct({ tempF: 82, dewpointF: 68, durationS: 12000, vdot: 43 });
    let worst = 0;
    let worstAt = 43;
    for (let v = 43.01; v <= 62; v += 0.01) {
      const vdot = Math.round(v * 100) / 100;
      const cur = effortSlowdownPct({ tempF: 82, dewpointF: 68, durationS: 12000, vdot });
      if (Math.abs(cur - prev) > worst) { worst = Math.abs(cur - prev); worstAt = vdot; }
      expect(cur, `composed effort ROSE at VDOT ${vdot}`).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
    expect(
      worst,
      `composed heat effort stepped ${worst.toFixed(2)} points at VDOT ${worstAt.toFixed(2)}`,
    ).toBeLessThanOrEqual(0.05);
  });

  it('a bare tier still selects its own column · the old contract is intact', () => {
    for (const t of TEMPS) {
      for (const tier of ['slow', 'mid_pack', 'elite'] as const) {
        expect(effortSlowdownPct({ tempF: t, durationS: null, tier }))
          .toBeCloseTo(maughanSlowdownPct(t, tier), 10);
      }
    }
  });
});
