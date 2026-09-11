/**
 * lib/postrun/_recovery_honesty_text_partial_landed.test.ts ·
 * RECOVERY-HONESTY-TEXT-1 (2026-09-11).
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────
 *
 * `RECOVERY-HONESTY-STRIDES-1` (`lib/execution/verdict.ts`, same date) fixed
 * `resolveWorkoutVerdict` so a strides-carrying spec's `strides_recovery_s`
 * reaches grading — before it, `recoveriesHonest` was always `null` for a
 * strides day and the whole ladder branch this file tests was unreachable.
 * The mechanism is correct and untouched here.
 *
 * What the mechanism fix did not update: `lib/postrun/experience.ts`'s
 * `readExecution`, whose `uneven` branch had exactly one piece of runner
 * text for "not every graded thing agreed" — "Some of the {noun}
 * {insideBound} and some did not." That sentence is FALSE when the reason
 * for `uneven` is `recoveriesHonest === false` and every graded WORK phase
 * landed: nothing "did not" land. On a strides day this reads as though the
 * runner's easy run itself was inconsistent, which is the same shape as the
 * "not completed" complaint already fixed on the native side
 * (`TodayAfterV5.completionNote`, WALKBACK-1/2) — a recovery-timing fact
 * dressed up as a work-execution verdict.
 *
 * ── THE REAL WORKOUT ─────────────────────────────────────────────────────
 *
 * David's own account, `runs.id = -218380344929823`, 2026-09-09, read via
 * `DATABASE_URL_RO`: 5.0 mi easy + 6x20s strides, `workout_spec.
 * strides_recovery_s: 60`, walk-backs of 30/43/61/24/38/8s. The 5.0 mi easy
 * block graded `hit`. `runs.data` carries no `recoveryEndedEarly` and no
 * `sessionEnded` key at all for this row — there is no record either way of
 * why the two short walk-backs (24s, 8s) came in outside
 * `RECOVERY_DURATION_TOLERANCE` of the 60s model, which is exactly the
 * "third state" Rule 11 requires this file not collapse: not "chosen", not
 * "a lapse" — unknown, and the copy must not assert either.
 *
 * ── FALSIFIED FIRST (Rule 18) ────────────────────────────────────────────
 *
 * Run against the pre-fix `experience.ts` (`git stash` the
 * RECOVERY-HONESTY-TEXT-1 hunk and re-run), the fixture below produces
 * `headline: 'Mixed set'` and a summary containing "and some did not" —
 * confirmed failing before the fix, confirmed passing after it, in the same
 * session this test was written.
 */
import { describe, it, expect } from 'vitest';
import { resolveWorkoutVerdict } from '@/lib/execution/verdict';
import { composePostRunExperience, type PostRunInput } from './experience';

/** The real stored phases for `runs.id = -218380344929823` (2026-09-09),
 *  trimmed of `hrSamples`/`paceSamples` (not read by any of the code under
 *  test) but otherwise the real recorded shape and real numbers — no
 *  `targetDurationSec` on any phase, matching what `WatchCompletionPhase`
 *  actually sends (see `_recovery_honesty_strides_grading.test.ts`'s own
 *  header on why that omission is the point). */
const REAL_0909_PHASES = [
  { index: 0, type: 'work', label: '5.0 mi easy', paceShape: 'ceiling', targetPaceSPerMi: 522, actualPaceSPerMi: 521, actualDurationSec: 2607, actualDistanceMi: 5.0, completed: true, avgHr: 133 },
  { index: 1, type: 'work', label: 'Stride 1 of 6', targetPaceSPerMi: 401, actualPaceSPerMi: 395, actualDurationSec: 20, isStrideSegment: true, completed: true },
  { index: 2, type: 'recovery', label: 'Walk back', paceShape: 'none', targetPaceSPerMi: 522, actualDurationSec: 30, actualDistanceMi: 0.04, completed: false },
  { index: 3, type: 'work', label: 'Stride 2 of 6', targetPaceSPerMi: 401, actualPaceSPerMi: 398, actualDurationSec: 22, isStrideSegment: true, completed: true },
  { index: 4, type: 'recovery', label: 'Walk back', paceShape: 'none', targetPaceSPerMi: 522, actualDurationSec: 43, actualDistanceMi: 0.05, completed: false },
  { index: 5, type: 'work', label: 'Stride 3 of 6', targetPaceSPerMi: 401, actualPaceSPerMi: 397, actualDurationSec: 21, isStrideSegment: true, completed: true },
  { index: 6, type: 'recovery', label: 'Walk back', paceShape: 'none', targetPaceSPerMi: 522, actualDurationSec: 61, actualDistanceMi: 0.06, completed: true },
  { index: 7, type: 'work', label: 'Stride 4 of 6', targetPaceSPerMi: 401, actualPaceSPerMi: 396, actualDurationSec: 20, isStrideSegment: true, completed: true },
  { index: 8, type: 'recovery', label: 'Walk back', paceShape: 'none', targetPaceSPerMi: 522, actualDurationSec: 24, actualDistanceMi: 0.03, completed: false },
  { index: 9, type: 'work', label: 'Stride 5 of 6', targetPaceSPerMi: 401, actualPaceSPerMi: 398, actualDurationSec: 22, isStrideSegment: true, completed: true },
  { index: 10, type: 'recovery', label: 'Walk back', paceShape: 'none', targetPaceSPerMi: 522, actualDurationSec: 38, actualDistanceMi: 0.06, completed: false },
  { index: 11, type: 'work', label: 'Stride 6 of 6', targetPaceSPerMi: 401, actualPaceSPerMi: 397, actualDurationSec: 21, isStrideSegment: true, completed: true },
  { index: 12, type: 'recovery', label: 'Walk back', paceShape: 'none', targetPaceSPerMi: 522, actualDurationSec: 8, actualDistanceMi: 0.03, completed: false },
  { index: 13, type: 'overtime', label: 'After the session', actualDurationSec: 10, completed: true },
];

/** The real `plan_workouts.workout_spec` for `wko_d19936ca5659c63b`. */
const REAL_0909_SPEC = {
  kind: 'easy',
  hr_cap_bpm: 151,
  strides_reps: 6,
  strides_duration_s: 20,
  strides_recovery_s: 60,
  strides_pace_s_per_mi: 401,
  pace_target_s_per_mi_hi: 542,
  pace_target_s_per_mi_lo: 502,
};

function makeInput(): PostRunInput {
  // No `recoveryEndedEarly`, no `sessionEnded` — matches the real row
  // exactly (`data ? 'recoveryEndedEarly'` is `false` on
  // `runs.id = -218380344929823`, confirmed via `DATABASE_URL_RO`).
  const verdict = resolveWorkoutVerdict({
    type: 'easy',
    spec: REAL_0909_SPEC,
    phases: REAL_0909_PHASES,
  });
  return {
    runId: '-218380344929823',
    dateISO: '2026-09-09',
    plannedType: 'easy',
    plannedTypeDisplay: 'Easy',
    plannedDistanceMi: 5,
    raceMatched: false,
    targetProvenance: 'plan',
    verdict,
    evidence: null,
    workHrCeilingBpm: null,
    overallHrCeilingBpm: 151,
    wholeRunHrBpm: 133,
    rpe: null,
    adaptations: [],
    hasActivePlan: true,
    activePlanId: 'pln_test',
    sensorLimited: false,
    stridesPrescribed: 6,
    recordedDistanceMi: 5.3,
    recordedDurationSec: 3062,
    structuredDistanceMi: 5.3,
    structuredDurationSec: 3062,
    splitCount: null,
    splitDistanceMi: null,
    correctedManually: false,
    clockAudit: null,
  };
}

describe('RECOVERY-HONESTY-TEXT-1 · the real 2026-09-09 strides day', () => {
  it('grades the session uneven with the easy block landed and recoveries dishonest — the mechanism fix, unchanged', () => {
    const v = makeInput().verdict;
    expect(v.session.recoveriesHonest).toBe(false); // 24s, 8s outside tolerance of 60s
    expect(v.session.lateCollapse).toBe(false);
    expect(v.session.verdict).toBe('uneven');
    // The one graded work phase (the easy block) landed clean.
    const workVerdicts = v.phases.filter((p) => p.type === 'work' && !p.isStrideSegment).map((p) => p.verdict);
    expect(workVerdicts).toEqual(['hit']);
  });

  it('never says the work "did not" land, and never says a walk-back was "not completed"', () => {
    const out = composePostRunExperience(makeInput());
    expect(out.execution.headline.toLowerCase()).not.toBe('mixed set');
    expect(out.execution.summary).not.toMatch(/and some did not/i);
    expect(out.execution.summary).not.toMatch(/not completed/i);
    expect(out.execution.headline).not.toMatch(/not completed/i);
  });

  it('states the recovery-timing fact plainly, without claiming a choice or a lapse', () => {
    const out = composePostRunExperience(makeInput());
    expect(out.execution.headline).toBe('Walk-backs ran short');
    expect(out.execution.summary).toBe(
      'The work block stayed under the ceiling. Walk-backs came in short of what was modelled '
      + '— logged as run, not judged. Six strides completed.',
    );
    // No fabricated claim about WHY they were short — neither "chose" nor
    // "missed"/"failed"/"lapse" appears anywhere in the sentence.
    expect(out.execution.summary).not.toMatch(/chose|advanced early|lapse|failed|missed/i);
  });

  it('the strides section itself never grades the walk-backs either (doctrine: "Not a workout")', () => {
    const out = composePostRunExperience(makeInput());
    expect(out.strides).not.toBeNull();
    expect(out.strides!.completed).toBe(6);
    expect(out.strides!.summary).not.toMatch(/not completed|short|failed/i);
  });
});
