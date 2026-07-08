/**
 * lib/training/goal-projection-belowtable.test.ts · AUDIT P1-56 / P1-13
 * (2026-07-07) — below-table GOAL support in computeConfidenceLabel.
 *
 * Same fix pattern as fitness-trajectory-belowtable.test.ts, applied to the
 * separate goal-attainment confidence label computeConfidenceLabel produces
 * (evidence.goalVdot / gapVdot / tier). Before this fix, ANY goal implying
 * VDOT < 30 nulled the whole label — including for a fit runner with a real
 * currentVdot setting a deliberately easy/slow goal.
 */
import { describe, it, expect } from 'vitest';
import { computeConfidenceLabel } from './goal-projection';

const MARATHON_MI = 26.2188;
const SLOW_GOAL_SEC = 6 * 3600 + 30 * 60; // 6:30 marathon — raw VDOT ~20.4, off-table

describe('P1-56 · computeConfidenceLabel — below-table (honest slow) goal', () => {
  it('no longer returns null for a fit runner with a slow/easy goal', () => {
    const label = computeConfidenceLabel({
      goalSec: SLOW_GOAL_SEC, raceDistanceMi: MARATHON_MI, vdot: 45, daysToRace: 84, status: 'on-track',
    });
    expect(label).not.toBeNull();
  });

  it('reads HIGH · ahead of the number (the runner has already exceeded this easy goal)', () => {
    const label = computeConfidenceLabel({
      goalSec: SLOW_GOAL_SEC, raceDistanceMi: MARATHON_MI, vdot: 45, daysToRace: 84, status: 'on-track',
    })!;
    expect(label.tier).toBe('high');
    expect(label.word).toBe('HIGH');
    expect(label.detail).toBe('ahead of the number · hold the plan');
  });

  it('evidence.goalVdot is the honest "below_table" marker, never a fabricated number', () => {
    const label = computeConfidenceLabel({
      goalSec: SLOW_GOAL_SEC, raceDistanceMi: MARATHON_MI, vdot: 45, daysToRace: 84, status: 'on-track',
    })!;
    expect(label.evidence.goalVdot).toBe('below_table');
    expect(label.evidence.gapVdot).toBeLessThanOrEqual(0); // ahead-of-goal always reads <= 0
  });

  it('off-track status still caps the tier at LOW even for an easy below-table goal (drift signals matter regardless of goal difficulty)', () => {
    const label = computeConfidenceLabel({
      goalSec: SLOW_GOAL_SEC, raceDistanceMi: MARATHON_MI, vdot: 45, daysToRace: 84, status: 'off-track',
    })!;
    expect(label.tier).toBe('low');
  });

  it('an off-the-top goal (impossibly fast, VDOT>85) still returns null — unaffected by this fix', () => {
    const label = computeConfidenceLabel({
      goalSec: 60, raceDistanceMi: MARATHON_MI, vdot: 45, daysToRace: 84, status: 'on-track',
    });
    expect(label).toBeNull();
  });

  it('BYTE-SAFETY: an ordinary in-table goal is completely unaffected (evidence.goalVdot stays numeric)', () => {
    const realGoalSec = 3 * 3600 + 30 * 60; // 3:30 marathon — real goal for VDOT 45
    const label = computeConfidenceLabel({
      goalSec: realGoalSec, raceDistanceMi: MARATHON_MI, vdot: 45, daysToRace: 84, status: 'on-track',
    })!;
    expect(typeof label.evidence.goalVdot).toBe('number');
    expect(label.evidence.goalVdot).not.toBe('below_table');
  });
});
