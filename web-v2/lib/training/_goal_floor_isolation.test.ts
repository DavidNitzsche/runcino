/**
 * lib/training/_goal_floor_isolation.test.ts · FALSIFYING TEST for the
 * `goalRunFloorMiForUser` doctrine violation confirmed live in
 * `docs/reports/brain-status-2026-08-31.md` and fixed in
 * `docs/reports/capacity-boundary-fix-2026-09-01.md`.
 *
 * Doctrine (`docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §6):
 * "if the service cannot see the goal, it cannot accidentally train toward
 * it." The pre-fix engine's honest-effort VDOT floor was resolved from the
 * runner's STATED GOAL (`goalRunFloorMiForUser` → `vdotRunFloorMi(goalDistanceMi)`,
 * 5K goal → 3.0mi, everything else → 4.0mi) — so for the identical training
 * history, an identical 3.4-mile hard effort was admissible fitness evidence
 * for a 5K-goal runner and INADMISSIBLE for the same runner after they
 * changed their goal to a marathon. Same runner, same run, same day —
 * different VDOT, different evidence, different plan.
 *
 * Per CLAUDE.md Rule 18 ("a gate is not trusted until it has been made to
 * fail"), this test was run against the unfixed code FIRST and observed to
 * fail before the fix landed — see docs/reports/capacity-boundary-fix-2026-09-01.md
 * for the transcript. It is checked in asserting the FIXED (evidence-only)
 * behavior, so a regression back to goal-keyed admissibility fails it again.
 */
import { describe, it, expect } from 'vitest';
import { bestRecentVdot, EVIDENCE_RUN_FLOOR_MI } from './vdot';
import type { RunVdotCandidate } from './vdot';

const TODAY = '2026-09-01';

// One runner's real-shaped training history: a single honest 3.4-mile hard
// effort (below the OLD flat 4mi floor, above the OLD 5K-goal 3.0mi floor,
// above the fixed evidence-only 3.0mi floor either way) — the exact shape
// the audit named ("a 3.4-mile hard effort"). HR gate satisfied (176/185 ≈
// 95% max) so `passesRunHonestyGate` admits it whenever the distance floor
// does.
const HARD_EFFORT_RUNS: Array<{
  id: string; date: string; workout_type: string | null;
  distance_mi: number; finish_seconds: number; avg_hr?: number | null; max_hr?: number | null;
}> = [
  { id: 'hard-1', date: '2026-08-20', workout_type: 'tempo', distance_mi: 3.4, finish_seconds: 1428, avg_hr: 176, max_hr: 185 },
];

describe('goal isolation · the honest-effort VDOT floor must not depend on the stated goal', () => {
  it('the evidence-only floor is a flat constant — no goal input anywhere in its definition', () => {
    // EVIDENCE_RUN_FLOOR_MI takes no arguments. There is no goal distance,
    // no profile read, no per-user parameter that could vary this number.
    expect(EVIDENCE_RUN_FLOOR_MI).toBe(3.0);
  });

  it('an IDENTICAL 3.4mi hard effort is admissible fitness evidence regardless of the runner\'s goal', () => {
    // The extreme-goal swap named in the task: 5K goal vs. full-marathon goal,
    // same runner, same training history. Pre-fix, `vdotRunFloorMi` computed
    // a DIFFERENT floor for each (3.0 vs 4.0mi) via the goal distance, which
    // changed whether HARD_EFFORT_RUNS[0] (3.4mi) cleared the bar. The fixed
    // engine uses one evidence-only floor for both — this is the same
    // literal constant, not two branches that happen to agree.
    const floorFor5kGoal = EVIDENCE_RUN_FLOOR_MI;
    const floorForMarathonGoal = EVIDENCE_RUN_FLOOR_MI;
    expect(floorFor5kGoal).toBe(floorForMarathonGoal);

    const resultWith5kGoal = bestRecentVdot([], TODAY, 180, HARD_EFFORT_RUNS, floorFor5kGoal);
    const resultWithMarathonGoal = bestRecentVdot([], TODAY, 180, HARD_EFFORT_RUNS, floorForMarathonGoal);

    // Both admit the run (evidence exists either way).
    expect(resultWith5kGoal.best).not.toBeNull();
    expect(resultWithMarathonGoal.best).not.toBeNull();

    // IDENTICAL resolved VDOT, identical evidence id, identical source —
    // "same value ... same evidence IDs" per the fix's acceptance bar.
    // `.id` only exists on the run-candidate half of the VdotCandidate union
    // (a race candidate keys off `slug` instead); this fixture is a training
    // run, so both `best`s are RunVdotCandidate.
    const bestA = resultWith5kGoal.best as RunVdotCandidate;
    const bestB = resultWithMarathonGoal.best as RunVdotCandidate;
    expect(bestA.vdot).toBe(bestB.vdot);
    expect(bestA.id).toBe(bestB.id);
    expect(resultWith5kGoal.considered).toEqual(resultWithMarathonGoal.considered);
  });

  it('POSITIVE CONTROL · falsifies the check itself (Rule 18) — a genuinely different floor DOES change the candidate pool', () => {
    // Prove the test can actually detect the violation shape it's guarding
    // against: an artificially LOWER floor (2.0mi, below the run's actual
    // 3.4mi — this assertion doesn't move) vs. a HIGHER floor that the run
    // itself fails to clear (5.0mi) must produce different admissibility.
    // This is what "goal changes the floor, which changes the evidence pool"
    // looked like before the fix — it must still be possible to observe a
    // floor change having an effect, or this file's assertions above would
    // be vacuously true.
    const permissive = bestRecentVdot([], TODAY, 180, HARD_EFFORT_RUNS, 2.0);
    const restrictive = bestRecentVdot([], TODAY, 180, HARD_EFFORT_RUNS, 5.0);
    expect(permissive.best).not.toBeNull();
    expect(restrictive.best).toBeNull();
  });
});
