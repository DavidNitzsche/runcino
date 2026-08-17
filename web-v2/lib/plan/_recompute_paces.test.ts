/**
 * BLEND-GATE INVARIANTS (2026-08-17 · coaching-loop reconciliation).
 *
 * Locks the measured-evidence gate on the weekly currentT→goalT blend:
 *
 *   1. PARITY   — with no measured evidence the shared blendedTPaceForWeek
 *                 is byte-identical to the historical composePlan-local
 *                 formula (Rule 3 + BRK-1 + VAR-07). The extraction cannot
 *                 change a single authored pace.
 *   2. STALL    — fitness stalls → paces stall at currentT + grace,
 *                 regardless of how far the calendar has marched.
 *   3. ADVANCE  — fitness advances → paces advance (monotone in measured
 *                 progress, capped by the calendar).
 *   4. TRACK    — measured VDOT tracks the calendar → the gate is a no-op
 *                 (min(calendar, measured + grace) = calendar).
 *
 * Cite: Research/01-pace-zones-vdot.md §Recalibrate-Paces (:304-321).
 */
import { describe, it, expect } from 'vitest';
import {
  BLEND_GRACE_FRACTION,
  maxSeasonalVdotGain,
  measuredProgressFraction,
  gatedBlendFraction,
  blendedTPaceForWeek,
} from './recompute-paces';

/** The historical composePlan-local tPaceForWeek, verbatim (pre-2026-08-17). */
function legacyTPaceForWeek(
  currentT: number | null,
  goalT: number | null,
  weekIdx: number,
  phase: string,
  buildWeeks: number,
): number | null {
  if (goalT == null) return null;
  if (currentT == null) return goalT;
  if (currentT <= goalT) return currentT;
  if (phase === 'TAPER') return goalT;
  const denom = Math.max(1, Math.round(buildWeeks * 0.6));
  const blend = Math.min(1, weekIdx / denom);
  return Math.round(currentT + (goalT - currentT) * blend);
}

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
  it('trusts the calendar when no evidence is supplied', () => {
    expect(gatedBlendFraction(0.8, null)).toBe(0.8);
    expect(gatedBlendFraction(1, undefined)).toBe(1);
  });
  it('caps the calendar at measured + grace', () => {
    expect(gatedBlendFraction(0.8, 0)).toBeCloseTo(BLEND_GRACE_FRACTION, 5);
    expect(gatedBlendFraction(0.8, 0.5)).toBeCloseTo(0.65, 5);
  });
  it('never exceeds the calendar (evidence cannot leapfrog periodization)', () => {
    expect(gatedBlendFraction(0.2, 0.9)).toBe(0.2);
  });
  it('caps at 1 overall', () => {
    expect(gatedBlendFraction(1, 0.95)).toBe(1);
  });
});

describe('blendedTPaceForWeek · parity with the historical formula (gate off)', () => {
  const grid = {
    currentT: [null, 380, 390, 420.4],
    goalT: [null, 360, 395],
    weekIdx: [0, 1, 3, 6, 9, 14],
    phase: ['BASE', 'BUILD', 'RACE-SPECIFIC', 'TAPER'],
    buildWeeks: [1, 6, 10, 14],
  };
  it('matches on the full grid', () => {
    for (const currentT of grid.currentT) {
      for (const goalT of grid.goalT) {
        for (const weekIdx of grid.weekIdx) {
          for (const phase of grid.phase) {
            for (const buildWeeks of grid.buildWeeks) {
              const got = blendedTPaceForWeek({ currentT, goalT, weekIdx, phase, buildWeeks });
              const want = legacyTPaceForWeek(currentT, goalT, weekIdx, phase, buildWeeks);
              expect(got).toBe(want);
            }
          }
        }
      }
    }
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

  it('TRACK · measured tracks the calendar → gate is a no-op', () => {
    const denom = Math.max(1, Math.round(buildWeeks * 0.6));
    for (const weekIdx of [0, 2, 4, 6, 8]) {
      const calendar = Math.min(1, weekIdx / denom);
      const gated = blendedTPaceForWeek({
        currentT, goalT, weekIdx, phase: 'BUILD', buildWeeks,
        measuredProgressFraction: calendar,  // fitness exactly on schedule
      });
      const ungated = blendedTPaceForWeek({ currentT, goalT, weekIdx, phase: 'BUILD', buildWeeks });
      expect(gated).toBe(ungated);
    }
  });

  it('BRK-1 · soft goal still trains at current fitness under any gate', () => {
    expect(blendedTPaceForWeek({
      currentT: 380, goalT: 400, weekIdx: 5, phase: 'BUILD', buildWeeks,
      measuredProgressFraction: 0,
    })).toBe(380);
  });
});

describe('maxSeasonalVdotGain', () => {
  it('scales with build length and caps at 6 (Research/01:314-321)', () => {
    expect(maxSeasonalVdotGain(0)).toBe(2);
    expect(maxSeasonalVdotGain(10)).toBeCloseTo(4.2, 5);
    expect(maxSeasonalVdotGain(18.18)).toBeCloseTo(5.9996, 3);
    expect(maxSeasonalVdotGain(30)).toBe(6);
  });
});
