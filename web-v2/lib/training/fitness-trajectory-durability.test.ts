/**
 * lib/training/fitness-trajectory-durability.test.ts · goal-projection-
 * durability follow-up, 2026-09-01
 * (docs/reports/race-prediction-goal-projection-durability-2026-09-01.md).
 *
 * `projectFitnessTrajectory` stays a pure, DB-free function (it is imported
 * by a client component, GapPanel.tsx — see the file header) so the caller
 * (`goal-projection.ts#computeGoalProjection`) resolves the durability read
 * and hands in an already-blended `currentSecOverride`. This file proves the
 * pure arithmetic in isolation, no DB mock needed:
 *
 *   1. Omitting `currentSecOverride` is byte-identical to the function's
 *      prior behavior (the regression guarantee everything downstream —
 *      goal-projection-ahead.test.ts, goal-projection-belowtable.test.ts,
 *      and every real account with no durability read — depends on).
 *   2. `projectedSec` preserves the SAME relative improvement the VDOT-space
 *      model computed (danielsProjectedSec / danielsCurrentSec), applied to
 *      the corrected baseline — a ratio, not a re-derivation, so a runner
 *      whose durability correction makes today's fitness read SLOWER does
 *      not also get penalized twice on the projected (future) side.
 *   3. A continuity walk — currentSecOverride swept smoothly between the
 *      Daniels value and a materially different one — never jumps (Rule 9).
 */
import { describe, it, expect } from 'vitest';
import { projectFitnessTrajectory } from './fitness-trajectory';
import { predictRaceTime } from './vdot';

const HM_MI = 13.1094;
const CURRENT_VDOT = 46;
const GOAL_SEC = 5900; // comfortably behind current fitness, so gain > 0
const WEEKS = 12;

function baseArgs(overrides: Partial<Parameters<typeof projectFitnessTrajectory>[0]> = {}) {
  return {
    currentVdot: CURRENT_VDOT,
    goalSec: GOAL_SEC,
    raceDistanceMi: HM_MI,
    weeksToRace: WEEKS,
    executionQuality: 0.9,
    ...overrides,
  };
}

describe('projectFitnessTrajectory · currentSecOverride omitted (regression guarantee)', () => {
  it('produces the exact same currentSec/projectedSec/gapSec as before this change', () => {
    const withOverride = projectFitnessTrajectory(baseArgs({ currentSecOverride: null }))!;
    const withoutField = projectFitnessTrajectory(baseArgs())!;
    const danielsCurrent = predictRaceTime(CURRENT_VDOT, HM_MI);
    const danielsProjected = predictRaceTime(withoutField.projectedVdot, HM_MI);

    expect(withOverride.currentSec).toBe(danielsCurrent);
    expect(withOverride.projectedSec).toBe(danielsProjected);
    expect(withoutField.currentSec).toBe(danielsCurrent);
    expect(withoutField.projectedSec).toBe(danielsProjected);
    expect(withOverride).toEqual(withoutField);
  });
});

describe('projectFitnessTrajectory · currentSecOverride supplied (durability-corrected baseline)', () => {
  it('honors the override for currentSec exactly', () => {
    const danielsCurrent = predictRaceTime(CURRENT_VDOT, HM_MI)!;
    const override = danielsCurrent + 90; // a slower personal-durability read
    const traj = projectFitnessTrajectory(baseArgs({ currentSecOverride: override }))!;
    expect(traj.currentSec).toBe(override);
  });

  it('preserves the Daniels-modelled relative improvement on the corrected baseline (ratio, not a re-derivation)', () => {
    const danielsCurrent = predictRaceTime(CURRENT_VDOT, HM_MI)!;
    const plain = projectFitnessTrajectory(baseArgs())!;
    const danielsProjected = plain.projectedSec!;
    const ratio = danielsProjected / danielsCurrent;

    const override = danielsCurrent + 120;
    const corrected = projectFitnessTrajectory(baseArgs({ currentSecOverride: override }))!;

    expect(corrected.projectedSec).toBe(Math.round(override * ratio));
    // The correction moved the projection in the SAME direction it moved the
    // baseline (durability read slower → projected also reads slower) —
    // never the opposite sign, which would mean the ratio math inverted.
    expect(corrected.projectedSec!).toBeGreaterThan(plain.projectedSec!);
  });

  it('a FASTER durability correction also carries through proportionally (not just the slow direction)', () => {
    const danielsCurrent = predictRaceTime(CURRENT_VDOT, HM_MI)!;
    const plain = projectFitnessTrajectory(baseArgs())!;
    const override = danielsCurrent - 120;
    const corrected = projectFitnessTrajectory(baseArgs({ currentSecOverride: override }))!;
    expect(corrected.projectedSec!).toBeLessThan(plain.projectedSec!);
  });

  it('gapSec is recomputed off the corrected projectedSec, not the stale Daniels one', () => {
    const danielsCurrent = predictRaceTime(CURRENT_VDOT, HM_MI)!;
    const override = danielsCurrent + 200;
    const traj = projectFitnessTrajectory(baseArgs({ currentSecOverride: override }))!;
    expect(traj.gapSec).toBe(traj.projectedSec! - GOAL_SEC);
  });

  it('leaves every VDOT-space field (currentVdot, projectedVdot, gapVdot, reachable) untouched — durability corrects distance, not the training-response model', () => {
    const danielsCurrent = predictRaceTime(CURRENT_VDOT, HM_MI)!;
    const plain = projectFitnessTrajectory(baseArgs())!;
    const corrected = projectFitnessTrajectory(baseArgs({ currentSecOverride: danielsCurrent + 300 }))!;

    expect(corrected.currentVdot).toBe(plain.currentVdot);
    expect(corrected.projectedVdot).toBe(plain.projectedVdot);
    expect(corrected.gapVdot).toBe(plain.gapVdot);
    expect(corrected.reachable).toBe(plain.reachable);
    expect(corrected.executionQuality).toBe(plain.executionQuality);
  });
});

describe('projectFitnessTrajectory · continuity walk (Rule 9 — no cliff)', () => {
  it('projectedSec moves smoothly and monotonically as the override sweeps from the Daniels value to a materially different one', () => {
    const danielsCurrent = predictRaceTime(CURRENT_VDOT, HM_MI)!;
    const STEPS = 20;
    const TOTAL_DELTA_SEC = 400; // ~7% of a half-marathon current fitness read
    const series: number[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const override = danielsCurrent + (TOTAL_DELTA_SEC * i) / STEPS;
      const traj = projectFitnessTrajectory(baseArgs({ currentSecOverride: override }))!;
      series.push(traj.projectedSec!);
    }
    // Monotone non-decreasing (a slower and slower correction never produces
    // a faster projection).
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
    }
    // No single step jumps by more than a small multiple of the average
    // per-step movement — the definition of "no cliff" for a linearly-swept
    // input feeding a linear (ratio) transform.
    const totalMove = series[series.length - 1] - series[0];
    const avgStep = totalMove / STEPS;
    for (let i = 1; i < series.length; i++) {
      const step = series[i] - series[i - 1];
      expect(step).toBeLessThan(avgStep * 3 + 5); // +5 absorbs rounding at tiny avgStep
    }
  });
});
