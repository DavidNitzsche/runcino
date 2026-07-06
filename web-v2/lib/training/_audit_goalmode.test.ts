/**
 * lib/training/_audit_goalmode.test.ts · no-race goal-mode parity sweep.
 *
 * Phone+watch audit 2026-07-06 wave-1 fixes (key: goal-mode). Pins the three
 * PURE pieces of the fix offline (no DB, no clock — same substrate rule as
 * _audit_nonrace.test.ts):
 *
 *   P1-14 · runway cap · projectFitnessTrajectory used to credit the FULL
 *      goal gap (× executionQuality) with no runway term, so a VDOT-40
 *      runner whose goal demands 44.5 with 3 weeks left projected the whole
 *      4.5 gain → hero ON PACE while computeConfidenceLabel on the same
 *      payload graded the gap against runway × 0.35 → LOW. The fix caps the
 *      modeled FUTURE gain at buildWeeks × BASE_BUILD_RATE (Research/00a
 *      periodization · ~0.25–0.4 VDOT/wk, 0.35 midpoint — the SAME rate the
 *      confidence label grades against). Demonstrated over-performance
 *      (2026-06-12 upgrade gear) still rides on top under the block/plan
 *      ceiling — it is current fitness, not future gain.
 *
 *   P1-14 reconciliation · reconcileStatusWithConfidence — LOW confidence
 *      and ON PACE can never coexist. Closes the short-runway edge the cap
 *      alone leaves open (runway < 2 wk with a ≤0.2-VDOT gap inside the
 *      trajectory's noise grace).
 *
 *   P1-12 / P1-53 / P2-28 · composeTargetsSummaryLine — the server-composed
 *      Targets sentence. Contract: NEVER a dash placeholder ("On track for
 *      —."); with a target time it speaks real times, without one it emits
 *      trend copy or a set-a-goal nudge.
 *
 * The DB-coupled halves (route tt_goal_* fallback, auto-rebuild goal-mode
 * branch) are covered by self-audit + integration; the invariants here are
 * the ones a constant tweak could silently regress.
 */

import { describe, it, expect } from 'vitest';
import { projectFitnessTrajectory, BASE_BUILD_RATE, TAPER_WEEKS } from './fitness-trajectory';
import { computeConfidenceLabel, reconcileStatusWithConfidence, type GoalStatus } from './goal-projection';
import { predictRaceTime } from './vdot';
import { composeTargetsSummaryLine, type TargetsSummaryArgs } from './targets-summary';

const MI_5K = 3.10686;
const MI_HM = 13.1094;
const MI_M = 26.2188;

/** Mirror of the route's status derivation (traj branch · no race_week —
 *  goal-mode has no race) + its toGoalStatus mapping. */
function rawStatusOf(traj: NonNullable<ReturnType<typeof projectFitnessTrajectory>>): 'on_track' | 'watch' | 'off' {
  return traj.reachable ? 'on_track' : traj.gapVdot <= 1.5 ? 'watch' : 'off';
}
function toGoalStatus(s: string): GoalStatus {
  return s === 'off' ? 'off-track' : s === 'watch' ? 'watching' : 'on-track';
}

describe('P1-14 · trajectory runway cap', () => {
  it('unrealistic goal (4.5-VDOT gap, 3 weeks out) no longer reads reachable', () => {
    // Pre-fix: plannedGain = 4.5 × 1.0 clamped only at MAX_BLOCK_GAIN 5 →
    // gapVdot ≈ 0 → reachable → ON PACE, while the label graded LOW.
    const goalSec = predictRaceTime(44.5, MI_5K)!;
    const traj = projectFitnessTrajectory({
      currentVdot: 40, goalSec, raceDistanceMi: MI_5K,
      weeksToRace: 3, executionQuality: 1.0,
    })!;
    const buildWeeks = 3 - TAPER_WEEKS; // 1
    expect(traj.buildWeeks).toBeCloseTo(buildWeeks, 5);
    // Modeled gain capped at what the remaining build can deliver (0.051
    // margin · projectedGainVdot is display-rounded to 0.1 VDOT).
    expect(traj.projectedGainVdot).toBeLessThanOrEqual(buildWeeks * BASE_BUILD_RATE + 0.051);
    expect(traj.reachable).toBe(false);
    // And the two signals agree without needing the reconciliation gate:
    const label = computeConfidenceLabel({
      goalSec, raceDistanceMi: MI_5K, vdot: 40,
      daysToRace: 21, status: toGoalStatus(rawStatusOf(traj)),
    })!;
    expect(label.tier).toBe('low');
    expect(rawStatusOf(traj)).not.toBe('on_track');
  });

  it('realistic goal-built plan is untouched · "the plan trusts itself" survives', () => {
    // 1.5-VDOT gap, 12 weeks (buildWeeks 10 → runway cap 3.5 · doesn't bite).
    const goalSec = predictRaceTime(47.5, MI_HM)!;
    const traj = projectFitnessTrajectory({
      currentVdot: 46, goalSec, raceDistanceMi: MI_HM,
      weeksToRace: 12, executionQuality: 1.0,
    })!;
    expect(traj.reachable).toBe(true);
    expect(traj.gapVdot).toBeLessThanOrEqual(0.2);
  });

  it('taper over-performer keeps the upgrade gear · demonstrated fitness is not future gain', () => {
    // buildWeeks 0 → runway cap 0 for MODELED gain, but the HR-controlled
    // over-performance bonus (already run, already shown) still projects.
    const goalSec = predictRaceTime(47.5, MI_5K)!;
    const traj = projectFitnessTrajectory({
      currentVdot: 47, goalSec, raceDistanceMi: MI_5K,
      weeksToRace: 1, executionQuality: 1.0,
      overPerformanceBonusVdot: 1.0,
    })!;
    expect(traj.projectedGainVdot).toBeCloseTo(1.0, 5);
    expect(traj.aheadOfGoal).toBe(true);
  });

  it('sweep · modeled gain never exceeds buildWeeks × BASE_BUILD_RATE (no over-performance)', () => {
    const violations: string[] = [];
    for (const currentVdot of [35, 40, 47.9]) {
      for (const gap of [0.5, 1, 2, 3, 4.5]) {
        for (const weeksToRace of [1, 2, 3, 6, 10, 16]) {
          for (const exec of [0.5, 0.7, 1.0]) {
            for (const dist of [MI_5K, MI_HM, MI_M]) {
              const goalSec = predictRaceTime(currentVdot + gap, dist);
              if (goalSec == null) continue;
              const traj = projectFitnessTrajectory({
                currentVdot, goalSec, raceDistanceMi: dist,
                weeksToRace, executionQuality: exec,
              });
              if (!traj) continue;
              // 0.051 margin · projectedGainVdot is display-rounded to 0.1.
              const cap = Math.max(0, weeksToRace - TAPER_WEEKS) * BASE_BUILD_RATE;
              if (traj.projectedGainVdot > cap + 0.051) {
                violations.push(`vdot=${currentVdot} gap=${gap} wk=${weeksToRace} exec=${exec} dist=${dist} → gain ${traj.projectedGainVdot} > cap ${cap.toFixed(2)}`);
              }
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('P1-14 · status × confidence reconciliation', () => {
  it('on_track + LOW demotes to watch · everything else passes through', () => {
    expect(reconcileStatusWithConfidence('on_track', 'low')).toBe('watch');
    expect(reconcileStatusWithConfidence('on_track', 'medium')).toBe('on_track');
    expect(reconcileStatusWithConfidence('on_track', 'high')).toBe('on_track');
    expect(reconcileStatusWithConfidence('on_track', null)).toBe('on_track');
    expect(reconcileStatusWithConfidence('watch', 'low')).toBe('watch');
    expect(reconcileStatusWithConfidence('off', 'low')).toBe('off');
    expect(reconcileStatusWithConfidence('cold', undefined)).toBe('cold');
    // race_week is a time-based override, not an ON PACE claim · untouched.
    expect(reconcileStatusWithConfidence('race_week', 'low')).toBe('race_week');
  });

  it('sweep · the composed pipeline never emits ON PACE next to LOW', () => {
    const violations: string[] = [];
    for (const currentVdot of [35, 40, 47.9]) {
      for (const gap of [0.1, 0.5, 1, 2, 3, 4.5]) {
        for (const weeksToRace of [1, 1.5, 2, 3, 6, 10, 16]) {
          for (const exec of [0.5, 0.7, 1.0]) {
            const goalSec = predictRaceTime(currentVdot + gap, MI_HM);
            if (goalSec == null) continue;
            const traj = projectFitnessTrajectory({
              currentVdot, goalSec, raceDistanceMi: MI_HM,
              weeksToRace, executionQuality: exec,
            });
            if (!traj) continue;
            const raw = rawStatusOf(traj);
            const label = computeConfidenceLabel({
              goalSec, raceDistanceMi: MI_HM, vdot: currentVdot,
              daysToRace: Math.round(weeksToRace * 7), status: toGoalStatus(raw),
            });
            const final = reconcileStatusWithConfidence(raw, label?.tier);
            if (final === 'on_track' && label?.tier === 'low') {
              violations.push(`vdot=${currentVdot} gap=${gap} wk=${weeksToRace} exec=${exec} → ON PACE + LOW`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('P1-12 / P2-28 · summary line · never a dash sentence', () => {
  const move = { prevVdot: 46.5, newVdot: 47.9, deltaVdot: 1.4 };

  it('goal + projection · speaks real times per status', () => {
    const base = { goalSec: 5400, projectedSec: 5694, goalSource: 'race' as const,
      raceName: 'AFC Half', daysAway: 41, vdot: 47.9, lastMove: move, heldDays: 3 };
    expect(composeTargetsSummaryLine({ ...base, status: 'on_track', projectedSec: 5400 }))
      .toBe('On pace for 1:30:00. Keep doing the work.');
    expect(composeTargetsSummaryLine({ ...base, status: 'watch' }))
      .toContain('1:34:54 against a 1:30:00 goal');
    expect(composeTargetsSummaryLine({ ...base, status: 'off' })).toContain('1:34:54');
    expect(composeTargetsSummaryLine({ ...base, status: 'race_week', daysAway: 5 }))
      .toContain('Race week');
  });

  it('race saved without a time goal · names the race, nudges (P2-28)', () => {
    const line = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: 5694, goalSource: 'race',
      raceName: 'AFC Half', daysAway: 41, vdot: 47.9, lastMove: null, heldDays: 0,
    });
    expect(line).toBe('Racing AFC Half in 41 days. Set a time goal to track a projection against it.');
  });

  it('fitness goal without a parseable time · trend copy (P1-12 legacy "22-25" rows)', () => {
    const up = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: 1400, goalSource: 'fitness_goal',
      raceName: null, daysAway: 30, vdot: 47.9, lastMove: move, heldDays: 0,
    });
    expect(up).toContain('Fitness trending up');
    expect(up).toContain('46.5 to 47.9');
    const held = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: 1400, goalSource: 'fitness_goal',
      raceName: null, daysAway: 30, vdot: 47.9, lastMove: null, heldDays: 12,
    });
    expect(held).toContain('holding at VDOT 47.9 for 12 days');
  });

  it('no baseline at all · honest cold copy', () => {
    const line = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: null, goalSource: null,
      raceName: null, daysAway: null, vdot: null, lastMove: null, heldDays: 0,
    });
    expect(line).toContain('No baseline yet');
  });

  it('sweep · no combination ever emits a dash placeholder', () => {
    const violations: string[] = [];
    const statuses: TargetsSummaryArgs['status'][] = ['on_track', 'watch', 'off', 'race_week', 'cold'];
    for (const status of statuses) {
      for (const goalSec of [null, 5400]) {
        for (const projectedSec of [null, 5694]) {
          for (const goalSource of [null, 'race', 'fitness_goal'] as const) {
            for (const raceName of [null, 'AFC Half']) {
              for (const vdot of [null, 47.9]) {
                for (const lastMove of [null, move, { prevVdot: 48.4, newVdot: 47.9, deltaVdot: -0.5 }]) {
                  for (const daysAway of [null, 0, 1, 41]) {
                    const line = composeTargetsSummaryLine({
                      status, goalSec, projectedSec, goalSource, raceName,
                      daysAway, vdot, lastMove, heldDays: 12,
                    });
                    if (!line || line.length === 0) violations.push('empty line');
                    if (line.includes('—')) violations.push(`dash in: ${line}`);
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
