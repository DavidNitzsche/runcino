/**
 * lib/execution/_duration_regression.test.ts · DURATION-REGRESSION-1, 2026-09-12.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * COMPLETIONREASON-1 (`fix/lane-a-completion-reason`, `6c93040d2`) added
 * `GradedPhase.targetDurationSec` computed as `num(p.targetDurationSec)` —
 * a direct read off the raw stored wire-phase object. But no wire payload
 * has ever carried a key literally named `targetDurationSec`:
 * `WatchCompletionPhaseBody` (`app/api/watch/workouts/complete/route.ts`)
 * and its watch-side counterpart `WatchCompletionPhase`
 * (`legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift`)
 * declare no such property, and no construction site in `WorkoutEngine.swift`
 * ever sets one. So `gradedPhase.targetDurationSec` was always `null` on
 * every real row, and `today/route.ts`'s guard
 * (`targetDurationSec != null && > 0`, ~line 1573) silently dropped the
 * "X of Y · advanced early" duration sentence for every advanced-early
 * recovery — where the code this replaced correctly printed it, sourced
 * from `data.recoveryEndedEarly[].prescribedSec` (the watch's own
 * `durationSec + phaseAddedSec` at the moment the runner advanced early,
 * `WorkoutEngine.swift#recordRecoveryEndedEarlyIfApplicable`), so the old
 * path was extension-aware and the new field was not.
 *
 * This file proves three things about the fix in the same commit:
 *
 *   1. An extended recovery (`durationSec` + a live "+30 sec" press) that
 *      then ends early now resolves `targetDurationSec` to the SUM, off
 *      `recoveryEndedEarly[].prescribedSec` — the number that genuinely
 *      exists on the wire — not off a field that never did.
 *   2. A recovery never extended and never ended early still resolves the
 *      base case correctly, off the flat `opts.prescribedRecoverySec`
 *      (`workout_spec.rep_rest_s`) — unchanged behaviour.
 *   3. A recovery with no record of either kind and no plan-level fallback
 *      resolves to `null` — Rule 11: "don't know" is never a manufactured
 *      `0`.
 *
 * Every `it` below states, in a leading comment, what it looked like BEFORE
 * this fix (verified by hand against the unfixed `verdict.ts` — see the
 * session's own report for the before/after `vitest` runs).
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ──────────────────────────────
 *
 * It proves the SERVER reader's resolution of one field on synthetic phase
 * arrays. It does not touch `today/route.ts`'s own sentence-building (which
 * merely reads this field and was not changed by this fix), the watch's
 * `phaseAddedSec` arithmetic itself (covered watch-side by
 * `_RecoveryEndedEarlyTests.swift`), or `complete/route.ts`'s wire
 * normalisation of `recoveryEndedEarly`/`sessionEnded` off the raw POST body
 * (covered by that route's own tests).
 */
import { describe, it, expect } from 'vitest';
import { gradeStoredPhases } from '@/lib/execution/verdict';

/** One synthetic session: warmup, one work rep, a recovery, a cooldown —
 *  the recovery is the only phase this file varies. Deliberately carries NO
 *  `targetDurationSec` / `durationSec` on any phase, because the real wire
 *  never does (see the file header) — a fixture that invented one would not
 *  be testing the regression, it would be testing around it. */
function sessionWith(recovery: Record<string, unknown>) {
  return [
    { index: 0, type: 'warmup', label: 'Warmup', actualDurationSec: 300,
      completed: true, paceShape: 'ceiling', targetPaceSPerMi: 600, actualPaceSPerMi: 580 },
    { index: 1, type: 'work', label: 'Rep 1', actualDurationSec: 240,
      completed: true, paceShape: 'window', targetPaceSPerMi: 391,
      tolerancePaceSPerMi: 10, actualPaceSPerMi: 388 },
    recovery,
    { index: 3, type: 'cooldown', label: 'Cooldown', actualDurationSec: 300,
      completed: true, paceShape: 'ceiling', targetPaceSPerMi: 600, actualPaceSPerMi: 590 },
  ];
}

describe('GradedPhase.targetDurationSec · resolved from data that exists on the wire, not a field that never did', () => {
  it('extended recovery ended early · durationSec(60) + phaseAddedSec(30) via recoveryEndedEarly.prescribedSec — BEFORE this fix this read null (num(p.targetDurationSec) on a raw phase with no such key)', () => {
    const graded = gradeStoredPhases(
      sessionWith({
        index: 2, type: 'recovery', label: 'Walk back',
        // No `targetDurationSec` key at all — the raw wire never has one.
        actualDurationSec: 70, completed: false,
      }),
      'other',
      {
        prescribedRecoverySec: 60,
        recoveryEndedEarly: [
          // The watch's own `durationSec + phaseAddedSec` at the moment the
          // runner advanced on: 60 modelled + one live "+30 sec" press.
          { phaseIndex: 2, prescribedSec: 90 },
        ],
      },
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completionReason).toBe('advanced_early');
    // THE ASSERTION THAT FAILS PRE-FIX: 90, the extension-aware sum, never
    // the un-extended 60 the flat `prescribedRecoverySec` fallback would
    // give and never the `null` the buggy raw-field read gave.
    expect(rec.targetDurationSec).toBe(90);
    expect(rec.actualDurationSec).toBe(70);
  });

  it('extended recovery cut short by the SESSION ending · same sum via sessionEnded.prescribedSecInPhase', () => {
    const graded = gradeStoredPhases(
      sessionWith({
        index: 2, type: 'recovery', label: 'Walk back',
        actualDurationSec: 40, completed: false,
      }),
      'other',
      {
        prescribedRecoverySec: 60,
        sessionEnded: { phaseIndex: 2, phaseType: 'recovery', prescribedSecInPhase: 90 },
      },
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completionReason).toBe('session_ended');
    expect(rec.targetDurationSec).toBe(90);
  });

  it('base case · never extended, never ended early — falls back to the flat opts.prescribedRecoverySec (workout_spec.rep_rest_s), unchanged from before this fix', () => {
    const graded = gradeStoredPhases(
      sessionWith({
        index: 2, type: 'recovery', label: 'Walk back',
        actualDurationSec: 60, completed: true,
      }),
      'other',
      { prescribedRecoverySec: 60 },
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completionReason).toBe('as_prescribed');
    expect(rec.targetDurationSec).toBe(60);
  });

  it('genuinely absent duration data · no record of either kind AND no plan-level fallback resolves to null, never a manufactured 0 (Rule 11)', () => {
    const graded = gradeStoredPhases(
      sessionWith({
        index: 2, type: 'recovery', label: 'Walk back',
        actualDurationSec: 8, completed: false,
      }),
      'other',
      // No `prescribedRecoverySec`, no `recoveryEndedEarly`, no `sessionEnded`
      // — a payload with genuinely nothing to say about this recovery's
      // modelled duration.
      {},
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completionReason).toBe('incomplete');
    expect(rec.targetDurationSec).toBeNull();
    expect(rec.targetDurationSec).not.toBe(0);
  });

  it('malformed recoveryEndedEarly record (prescribedSec 0 / missing) is never trusted as a real duration — falls through to the flat fallback instead of a false 0', () => {
    const graded = gradeStoredPhases(
      sessionWith({
        index: 2, type: 'recovery', label: 'Walk back',
        actualDurationSec: 12, completed: false,
      }),
      'other',
      {
        prescribedRecoverySec: 45,
        // phaseIndex present, prescribedSec malformed/absent — the record
        // still marks completionReason 'advanced_early' (that vote is keyed
        // on phaseIndex alone, per COMPLETIONREASON-1), but must not mint a
        // false duration of 0 out of it.
        recoveryEndedEarly: [{ phaseIndex: 2, prescribedSec: 0 }],
      },
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completionReason).toBe('advanced_early');
    expect(rec.targetDurationSec).toBe(45);
  });

  it('non-recovery phase never resolves a targetDurationSec off these records, even if its index happens to match one — the wire never prescribes a warmup/work/cooldown duration this way', () => {
    const graded = gradeStoredPhases(
      [
        { index: 0, type: 'warmup', label: 'Warmup', actualDurationSec: 55, completed: false },
        { index: 1, type: 'work', label: 'Rep 1', actualDurationSec: 240,
          completed: true, paceShape: 'window', targetPaceSPerMi: 391,
          tolerancePaceSPerMi: 10, actualPaceSPerMi: 388 },
      ],
      'other',
      { recoveryEndedEarly: [{ phaseIndex: 0, prescribedSec: 90 }] },
    );
    const warmup = graded.phases.find((p) => p.index === 0)!;
    expect(warmup.type).toBe('warmup');
    expect(warmup.targetDurationSec).toBeNull();
  });
});
