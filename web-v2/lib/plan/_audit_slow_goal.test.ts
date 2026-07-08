/**
 * lib/plan/_audit_slow_goal.test.ts · AUDIT P1-56 (2026-07-07) — a legitimate
 * slow HM+/marathon GOAL (not the runner's own fitness) must survive
 * generate.ts's PACE-3/GOAL-4 sanity guard end-to-end.
 *
 * Background: GOAL-4-SLOW-1 (2026-06-23) added an off-the-bottom check —
 * "null out any HM+/ultra goal implying VDOT < 30" — intended as a
 * wheel-error guard. It over-fired: a 6:30 marathon goal (raw VDOT ~20.4,
 * a common, entirely legitimate goal for a true-beginner/run-walk runner)
 * was silently discarded and replaced with the current-fitness anchor,
 * the exact "slow runner's data gets erased" failure mode this audit
 * targets, applied to GOAL-SETTING instead of fitness-READING.
 *
 * Fix (2026-07-07): the off-the-bottom check is REMOVED for HM+ distances
 * (there is no absolute-pace threshold that catches wheel errors without
 * ALSO rejecting ordinary slow marathon finishers — many marathons have
 * 7-8hr cutoffs). What still protects quality-pace sanity: BRK-1
 * (tPaceForWeek) already ensures a too-slow goalT can never drive quality
 * work when the runner's current fitness is at-or-above the goal.
 * The sub-HM 900 s/mi (15:00/mi) wheel-error cap is UNCHANGED and still
 * scoped to sub-HM distances, where it remains well-calibrated.
 *
 * lib/plan/sim-inputs.ts's buildSimPlan already carried the CORRECT
 * (narrower) guard shape even before this fix — this file exercises it
 * end-to-end via the sim harness (the production generate.ts path was
 * restored to match it) plus a direct unit-level check of the exact
 * boolean guard expression, mirroring _audit_pace_anchors.test.ts's style.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { vdotFromRace, predictRaceTime } from '@/lib/training/vdot';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
  raceHistory: [], longRunDay: 'sun', availableDays: [],
} as any;

describe('P1-56 · GOAL-4 off-the-bottom guard, unit level', () => {
  /** Mirrors the exact boolean expression at generate.ts loadGeneratorInputs
   *  (post-fix, 2026-07-07) and sim-inputs.ts buildSimPlan (unchanged). */
  function goalIsGuarded(goalSec: number, raceDistanceMi: number): boolean {
    return (
      (raceDistanceMi < 13.1 && goalSec / raceDistanceMi > 900) ||
      (vdotFromRace(goalSec, raceDistanceMi) == null && goalSec < (predictRaceTime(85, raceDistanceMi) ?? 0))
    );
  }

  it('a 6:30 marathon goal (raw VDOT ~20.4) is NO LONGER guarded — a legitimate slow goal', () => {
    const goalSec = 6 * 3600 + 30 * 60;
    expect(goalIsGuarded(goalSec, 26.2188)).toBe(false);
  });

  it('a 3:16 half-marathon goal (equivalent slow pace, raw VDOT ~20.4) is also not guarded', () => {
    const goalSec = 3 * 3600 + 16 * 60;
    expect(goalIsGuarded(goalSec, 13.1094)).toBe(false);
  });

  it('an 8:00 marathon goal (near the far end of realistic run-walk finishes) is still not guarded', () => {
    const goalSec = 8 * 3600;
    expect(goalIsGuarded(goalSec, 26.2188)).toBe(false);
  });

  it('a genuinely off-the-top marathon goal (sub-2:00, VDOT>85) IS still guarded — unaffected by this fix', () => {
    const goalSec = 1 * 3600 + 55 * 60; // 1:55 marathon — faster than the world record
    expect(goalIsGuarded(goalSec, 26.2188)).toBe(true);
  });

  it('a wheel-error 5K goal (HM time pasted onto a 5K field, ~30min/mi) is STILL guarded (sub-HM cap unchanged)', () => {
    const goalSec = 5585; // 1:33 HM time on a 5K goal — the PACE-3 canonical example
    expect(goalIsGuarded(goalSec, 3.10686)).toBe(true);
  });

  it('a genuinely slow but real 5K goal (32:00, sub-HM, under the 900 s/mi cap) is NOT guarded', () => {
    const goalSec = 32 * 60; // 32:00 5K = ~618 s/mi, under the 900 s/mi cap
    expect(goalIsGuarded(goalSec, 3.10686)).toBe(false);
  });
});

describe('P1-56 · end-to-end: a slow marathon goal survives buildSimPlan and threads a sane goalPaceSec', () => {
  it('6:30 marathon goal is preserved (not nulled), goalPaceSec reflects the actual slow goal', () => {
    const goalSec = 6 * 3600 + 30 * 60;
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: 'marathon', planWeeks: 16, goalTimeSec: goalSec,
      experienceLevel: 'beginner', weeklyFrequency: 3, weeklyMileageBucket: 15, longestRunBucket: '3-6',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.derived.goalPaceSec).not.toBeNull();
    // goalPaceSec should reflect the actual 6:30 marathon pace (~892 s/mi), not
    // be silently discarded and replaced with a fitness-anchored pace.
    expect(r.derived.goalPaceSec).toBeCloseTo(Math.round(goalSec / 26.2188), 0);
  });

  it('the plan still generates successfully (structurally sound) for this slow goal', () => {
    const goalSec = 6 * 3600 + 30 * 60;
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: 'marathon', planWeeks: 16, goalTimeSec: goalSec,
      experienceLevel: 'beginner', weeklyFrequency: 3, weeklyMileageBucket: 15, longestRunBucket: '3-6',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.composed.weeks.length).toBeGreaterThan(0);
  });

  it('BYTE-SAFETY: the wheel-error case (PACE-3) is still guarded end-to-end, unaffected by this fix', () => {
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: '5k', planWeeks: 12, goalTimeSec: 5585, // 1:33 HM time on a 5K goal
      experienceLevel: 'intermediate', weeklyFrequency: 4, weeklyMileageBucket: 25, longestRunBucket: '6-10',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.derived.goalPaceSec).toBeNull(); // still guarded — same as _audit_pace_anchors.test.ts's PACE-3 test
  });

  it('BYTE-SAFETY: a genuinely off-the-top goal (sub-2:00 marathon) is still guarded end-to-end', () => {
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: 'marathon', planWeeks: 16, goalTimeSec: 1 * 3600 + 55 * 60,
      experienceLevel: 'advanced', weeklyFrequency: 5, weeklyMileageBucket: 45, longestRunBucket: '10+', bestRecentVdotOverride: 60,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.derived.goalPaceSec).toBeNull(); // off-the-top stays guarded
  });
});
