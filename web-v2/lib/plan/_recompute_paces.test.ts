/**
 * BLEND INVARIANTS · EVIDENCE-1 (2026-08-17).
 *
 * REWRITTEN the day it was written. The first version of this file locked a
 * PARITY invariant — "with no measured evidence the blend is byte-identical to
 * the historical calendar formula" — against a legacy implementation copied in
 * verbatim. Hours later the owner locked
 * `Design/engine-doctrine-evidence-and-levers.md` Rule 1:
 *
 *   > Time passing, plan completion, or scheduled progression alone cannot
 *   > increase or decrease demonstrated fitness.
 *
 * naming this exact formula as violation #1. A test that pins an engine to a
 * behaviour doctrine forbids is not a guard, it is the defect with a lock on
 * it, so the parity invariant is deleted rather than exempted and replaced by
 * its negation. What the blend now locks:
 *
 *   1. NO-CALENDAR — the result does not depend on weekIdx, phase or
 *                    buildWeeks. Nothing about the schedule can move a pace.
 *   2. HOLD        — no evidence → the block trains at demonstrated fitness
 *                    (plus the standing single-retest grace), start to finish.
 *   3. ADVANCE     — fitness advances → paces advance, monotone in measured
 *                    progress, reaching goal pace only at fully-proven fitness.
 *   4. TAPER       — the taper sharpens on evidence like every other week; it
 *                    no longer returns goal pace unconditionally.
 *
 * Cite: Design/engine-doctrine-evidence-and-levers.md §Rule 1
 * Cite: Research/01-pace-zones-vdot.md §Recalibrate-Paces (:304-321) ·
 *       §"Freshness window" (:659-677 · a stale anchor is a floor, not a pace
 *       source).
 */
import { describe, it, expect } from 'vitest';
import {
  BLEND_GRACE_FRACTION,
  maxSeasonalVdotGain,
  measuredProgressFraction,
  gatedBlendFraction,
  blendedTPaceForWeek,
} from './recompute-paces';
import { seasonalVdotCeiling } from '@/lib/training/achievable-target';
import { VDOT_GAIN_PER_WEEK_MAX, MAX_BLOCK_GAIN_VDOT } from '@/lib/training/vdot-gain-rate';

describe('measuredProgressFraction', () => {
  it('is null on missing inputs', () => {
    expect(measuredProgressFraction(null, 46, 51)).toBeNull();
    expect(measuredProgressFraction(44, null, 51)).toBeNull();
    expect(measuredProgressFraction(44, 46, null)).toBeNull();
  });
  it('is null for a soft/at-goal season (no gap to gate)', () => {
    expect(measuredProgressFraction(51, 51.5, 51)).toBeNull();
    expect(measuredProgressFraction(51, 50, 50.5)).toBeNull(); // span 0.5 > 0.1? span=-0.5 → null
  });
  it('measures the banked share of the season gap, clamped [0,1]', () => {
    // David's CIM frame: anchor 44.1, goal ~51 → span 6.9.
    expect(measuredProgressFraction(44.1, 44.1, 51)!).toBeCloseTo(0, 5);
    expect(measuredProgressFraction(44.1, 46, 51)!).toBeCloseTo(1.9 / 6.9, 5);
    expect(measuredProgressFraction(44.1, 52, 51)).toBe(1);   // overshoot clamps
    expect(measuredProgressFraction(44.1, 42, 51)).toBe(0);   // regression clamps at 0
  });
});

describe('gatedBlendFraction', () => {
  it('claims NOTHING when no evidence is supplied', () => {
    expect(gatedBlendFraction(0.8, null)).toBe(0);
    expect(gatedBlendFraction(1, undefined)).toBe(0);
  });
  it('is the measured fraction plus the standing grace', () => {
    expect(gatedBlendFraction(0.8, 0)).toBeCloseTo(BLEND_GRACE_FRACTION, 5);
    expect(gatedBlendFraction(0.8, 0.5)).toBeCloseTo(0.65, 5);
  });
  it('ignores the calendar argument entirely (Rule 1)', () => {
    for (const calendar of [0, 0.2, 0.5, 1]) {
      expect(gatedBlendFraction(calendar, 0.9)).toBeCloseTo(1, 5);
      expect(gatedBlendFraction(calendar, 0.3)).toBeCloseTo(0.45, 5);
      expect(gatedBlendFraction(calendar, null)).toBe(0);
    }
  });
  it('caps at 1 overall', () => {
    expect(gatedBlendFraction(1, 0.95)).toBe(1);
  });
});

describe('blendedTPaceForWeek · NO-CALENDAR (Rule 1)', () => {
  const grid = {
    currentT: [null, 380, 390, 420.4],
    goalT: [null, 360, 395],
    weekIdx: [0, 1, 3, 6, 9, 14],
    phase: ['BASE', 'BUILD', 'RACE-SPECIFIC', 'TAPER'],
    buildWeeks: [1, 6, 10, 14],
    measured: [null, 0, 0.4, 1],
  };
  it('is invariant in weekIdx, phase and buildWeeks across the full grid', () => {
    for (const currentT of grid.currentT) {
      for (const goalT of grid.goalT) {
        for (const measuredProgressFraction of grid.measured) {
          const ref = blendedTPaceForWeek({
            currentT, goalT, weekIdx: 0, phase: 'BASE', buildWeeks: 1, measuredProgressFraction,
          });
          for (const weekIdx of grid.weekIdx) {
            for (const phase of grid.phase) {
              for (const buildWeeks of grid.buildWeeks) {
                const got = blendedTPaceForWeek({
                  currentT, goalT, weekIdx, phase, buildWeeks, measuredProgressFraction,
                });
                expect(got).toBe(ref);
              }
            }
          }
        }
      }
    }
  });

  it('HOLD · a whole block with no evidence trains at demonstrated fitness + grace', () => {
    const currentT = 453;   // the owner's measured VDOT 45.1
    const goalT = 413;      // 3:00 CIM, GOAL-2-floored
    const held = Math.round(currentT + (goalT - currentT) * BLEND_GRACE_FRACTION);
    for (let weekIdx = 0; weekIdx < 14; weekIdx++) {
      const phase = weekIdx >= 11 ? 'TAPER' : 'BUILD';
      expect(blendedTPaceForWeek({
        currentT, goalT, weekIdx, phase, buildWeeks: 11, measuredProgressFraction: 0,
      })).toBe(held);
    }
    // and it never reaches the goal-derived pace on the calendar alone
    expect(held).toBeGreaterThan(goalT);
  });
});

describe('blendedTPaceForWeek · the measured gate', () => {
  // David's CIM frame in T-pace space: VDOT 44.1 → T ≈ 7:16/mi (436 s/mi
  // is illustrative; the test uses round numbers). currentT 436, goalT
  // (3:00 marathon, GOAL-2-floored) faster.
  const currentT = 436;
  const goalT = 400;
  const buildWeeks = 12;

  it('STALL · fitness stalls → paces stall at currentT + grace forever', () => {
    for (const weekIdx of [2, 5, 8, 11]) {
      const gated = blendedTPaceForWeek({
        currentT, goalT, weekIdx, phase: 'BUILD', buildWeeks,
        measuredProgressFraction: 0,
      })!;
      // grace only: 436 + (400-436)*0.15 = 430.6 → 431
      expect(gated).toBe(Math.round(currentT + (goalT - currentT) * BLEND_GRACE_FRACTION));
    }
    // TAPER under a stalled gate must NOT sharpen to goalT.
    const taper = blendedTPaceForWeek({
      currentT, goalT, weekIdx: 13, phase: 'TAPER', buildWeeks,
      measuredProgressFraction: 0,
    })!;
    expect(taper).toBe(Math.round(currentT + (goalT - currentT) * BLEND_GRACE_FRACTION));
    expect(taper).toBeGreaterThan(goalT);
  });

  it('ADVANCE · fitness advances → paces advance monotonically', () => {
    const weekIdx = 9; // calendar fraction > 1 → capped at 1
    const at0 = blendedTPaceForWeek({ currentT, goalT, weekIdx, phase: 'BUILD', buildWeeks, measuredProgressFraction: 0 })!;
    const at03 = blendedTPaceForWeek({ currentT, goalT, weekIdx, phase: 'BUILD', buildWeeks, measuredProgressFraction: 0.3 })!;
    const at07 = blendedTPaceForWeek({ currentT, goalT, weekIdx, phase: 'BUILD', buildWeeks, measuredProgressFraction: 0.7 })!;
    const at1 = blendedTPaceForWeek({ currentT, goalT, weekIdx, phase: 'BUILD', buildWeeks, measuredProgressFraction: 1 })!;
    expect(at03).toBeLessThan(at0);
    expect(at07).toBeLessThan(at03);
    expect(at1).toBeLessThanOrEqual(at07);
    expect(at1).toBe(goalT); // fully-proven fitness reaches goal pace
  });

  it('TAPER · sharpens on evidence, never on arrival', () => {
    const noEvidence = blendedTPaceForWeek({
      currentT, goalT, weekIdx: 13, phase: 'TAPER', buildWeeks,
    })!;
    expect(noEvidence).toBe(currentT);            // Rule 1 · nothing was measured
    const proven = blendedTPaceForWeek({
      currentT, goalT, weekIdx: 13, phase: 'TAPER', buildWeeks,
      measuredProgressFraction: 1,
    })!;
    expect(proven).toBe(goalT);                   // fully demonstrated → goal pace
  });

  it('BRK-1 · soft goal still trains at current fitness under any gate', () => {
    expect(blendedTPaceForWeek({
      currentT: 380, goalT: 400, weekIdx: 5, phase: 'BUILD', buildWeeks,
      measuredProgressFraction: 0,
    })).toBe(380);
  });
});

describe('maxSeasonalVdotGain', () => {
  /**
   * GAINRATE-2 (2026-08-25) · this suite used to assert the fourth gain model:
   * `min(6, 2 + weeks × 0.22)`, under a title citing "Research/01:314-321" —
   * a line-number citation, which Rule 7 forbids, to a passage that says
   * something else. It asserted a zero-week block was worth +2 VDOT.
   *
   * The assertions below are derived from the bound band rather than restated,
   * so this test cannot go on agreeing with itself if the band moves.
   */
  it('spends only the BUILD weeks, at the doctrine band fast edge', () => {
    // A marathon's taper is 3 weeks and builds no fitness, so a 3-week
    // marathon block has no build weeks at all and is worth nothing. The old
    // formula paid it +2.66.
    expect(maxSeasonalVdotGain(3, 26.22)).toBe(0);
    expect(maxSeasonalVdotGain(0, 26.22)).toBe(0);
    // 14 weeks to a marathon = 11 build weeks at the fast edge.
    expect(maxSeasonalVdotGain(14, 26.22)).toBeCloseTo(11 * VDOT_GAIN_PER_WEEK_MAX, 6);
    // A 5K taper is one week, so the same runway buys more build.
    expect(maxSeasonalVdotGain(14, 3.1)).toBeCloseTo(13 * VDOT_GAIN_PER_WEEK_MAX, 6);
  });

  it('never exceeds the block ceiling every other consumer honours', () => {
    // The old cap was 6, ABOVE the bound MAX_BLOCK_GAIN_VDOT of 5 — it could
    // authorise a gain the rest of the engine calls impossible.
    for (const weeks of [20, 30, 52, 104]) {
      expect(maxSeasonalVdotGain(weeks, 26.22)).toBeLessThanOrEqual(MAX_BLOCK_GAIN_VDOT);
    }
    expect(maxSeasonalVdotGain(104, 26.22)).toBe(MAX_BLOCK_GAIN_VDOT);
  });

  it('is monotonic in runway', () => {
    let prev = -1;
    for (let w = 0; w <= 40; w++) {
      const g = maxSeasonalVdotGain(w, 26.22);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('is the SAME ceiling the race target is bounded by', () => {
    // The whole point of RACEPACE-1: threshold and race pace stopped being
    // floored by two different numbers.
    for (const weeks of [6, 14, 24]) {
      expect(seasonalVdotCeiling(44.1, weeks, 26.22).gainVdot)
        .toBe(maxSeasonalVdotGain(weeks, 26.22));
    }
  });
});
