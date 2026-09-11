/**
 * lib/execution/_recovery_honesty_strides_grading.test.ts ·
 * RECOVERY-HONESTY-STRIDES-1 (2026-09-11).
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────
 *
 * Confirmed by three independent audits this cycle (Runner Data v2.1, Brain
 * v2.1/v2.1.1, Coach v2.1) as the clearest current next-TestFlight blocker.
 *
 * `resolveWorkoutVerdict` (this file's own `verdict.ts`) read
 * `workout_spec.rep_rest_s` into `GradeOptions.prescribedRecoverySec` and
 * NEVER read `workout_spec.strides_recovery_s` — the field a strides-carrying
 * spec (`kind: 'easy'` / `'shakeout'` / `'strides'`, via
 * `lib/training/expand-spec.ts#appendStrides`) actually prescribes its
 * walk-backs from. `rep_rest_s` belongs only to `kind: 'threshold'` /
 * `'intervals'` rows and is never present on a strides spec.
 *
 * Per-phase, `gradeStoredPhases` resolves a recovery's prescribed duration as
 * `p.targetDurationSec ?? opts.prescribedRecoverySec`. The wire's completion
 * struct (`WatchCompletionPhase` in
 * `legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift` — the
 * live watch-app source, symlinked into `native-v2`) declares NO
 * `targetDurationSec` field at all, and the server's own
 * `WatchCompletionPhaseBody` wire type
 * (`web-v2/app/api/watch/workouts/complete/route.ts`) doesn't either — so
 * every real completion phase falls straight through to
 * `opts.prescribedRecoverySec`. With `strides_recovery_s` unread, that was
 * always `null` for a strides workout. `recoveriesHonestOf`
 * (`lib/training/execution-semantics.ts`) refuses to grade a recovery with a
 * null `prescribedSec` (Rule 11: absence is not a verdict) — so a strides
 * session's recovery-honesty vote was ALWAYS `null`, "no signal", regardless
 * of whether the walk-backs were honest, short, or anything in between.
 * Silently blind, exactly as scoped.
 *
 * ── WHY THIS IS TESTED AT `resolveWorkoutVerdict`, NOT `gradeStoredPhases` ──
 *
 * The sibling suite `lib/training/_recovery_ended_early.test.ts` calls
 * `gradeStoredPhases` directly with `targetDurationSec: 60` hand-stamped onto
 * its synthetic recovery phases — a shape real completion data never
 * produces (see above). That fixture bypasses the exact bug this file
 * exists to catch: it exercises `p.targetDurationSec`, the branch that is
 * always null in production, and never exercises
 * `opts.prescribedRecoverySec`'s own derivation from the spec. This is
 * Rule 15's shape — a mechanism the test corpus cannot reach is untested,
 * however many cases pass — so every fixture below omits `targetDurationSec`
 * from its phases (the honest wire shape) and drives the real entry point,
 * `resolveWorkoutVerdict`, so the spec-reading bug is the thing under test.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ──────────────────────────────
 *
 *   · Pause grading — untouched, out of scope for this fix, not exercised
 *     here.
 *   · The watch's own recording of `recoveryEndedEarly` / `sessionEnded`
 *     (`WorkoutEngine.swift` on the wrist) — covered by the watch test
 *     target, not this file.
 *   · Whether `RECOVERY_DURATION_TOLERANCE` (0.5) is the right number —
 *     that's `execution-semantics.ts`'s own claim to defend.
 */
import { describe, it, expect } from 'vitest';
import { resolveWorkoutVerdict } from './verdict';

/* ── fixtures, in the REAL wire shape (no targetDurationSec, ever) ───────── */

/** A rep-format (threshold) session: warmup, 2 reps separated by ONE timed
 *  jog recovery, cooldown. `rep_rest_s` on the spec is the only recovery
 *  source a rep-format row has ever carried. */
function repFormatPhases(recoveryActualSec: number) {
  return [
    { index: 0, type: 'warmup', label: 'Warmup', actualDurationSec: 480, completed: true },
    {
      index: 1, type: 'work', label: 'Rep 1', actualDurationSec: 300,
      targetPaceSPerMi: 419, actualPaceSPerMi: 418, completed: true,
    },
    { index: 2, type: 'recovery', label: 'Jog recovery', actualDurationSec: recoveryActualSec, completed: true },
    {
      index: 3, type: 'work', label: 'Rep 2', actualDurationSec: 300,
      targetPaceSPerMi: 419, actualPaceSPerMi: 420, completed: true,
    },
    { index: 4, type: 'cooldown', label: 'Cooldown', actualDurationSec: 480, completed: true },
  ];
}

/** A strides-format session (an easy run with strides appended): warmup,
 *  2 strides each followed by a "Walk back" recovery, cooldown. Labels match
 *  `strideLabelFor` exactly, so `looksLikeStrideLabel` fires the way a real
 *  completion row does. NOTHING here carries `targetDurationSec` — that is
 *  the entire point of this fixture shape. */
function stridesPhases(walkback1ActualSec: number, walkback2ActualSec: number) {
  return [
    { index: 0, type: 'warmup', label: 'Warmup', actualDurationSec: 900, completed: true },
    {
      index: 1, type: 'work', label: 'Stride 1 of 2', actualDurationSec: 20,
      targetPaceSPerMi: 391, actualPaceSPerMi: 388, completed: true,
    },
    { index: 2, type: 'recovery', label: 'Walk back', actualDurationSec: walkback1ActualSec, completed: true },
    {
      index: 3, type: 'work', label: 'Stride 2 of 2', actualDurationSec: 20,
      targetPaceSPerMi: 391, actualPaceSPerMi: 390, completed: true,
    },
    { index: 4, type: 'recovery', label: 'Walk back', actualDurationSec: walkback2ActualSec, completed: true },
    { index: 5, type: 'cooldown', label: 'Cooldown', actualDurationSec: 300, completed: true },
  ];
}

describe('resolveWorkoutVerdict · recovery-honesty grading reads strides_recovery_s', () => {
  /* ── (1) rep-format, rep_rest_s present, honest · REGRESSION, must still pass ── */
  it('1 · rep-format workout, rep_rest_s present, recovery honest — grades true', () => {
    const grade = resolveWorkoutVerdict({
      type: 'threshold',
      spec: { kind: 'threshold', rep_rest_s: 90 },
      phases: repFormatPhases(88), // 2s off a 90s model, well within tolerance
    });
    expect(grade.session.recoveriesHonest).toBe(true);
  });

  /* ── (2) strides-format, strides_recovery_s present, honest · THE FIX ────── */
  it('2 · strides-format workout, strides_recovery_s present, recovery honest — grades true (was null before the fix)', () => {
    const grade = resolveWorkoutVerdict({
      type: 'easy',
      spec: { kind: 'easy', strides_reps: 2, strides_recovery_s: 60 },
      phases: stridesPhases(58, 62), // both within RECOVERY_DURATION_TOLERANCE of 60s
    });
    expect(grade.session.recoveriesHonest).toBe(true);
  });

  /* ── (3) strides-format, strides_recovery_s present, genuinely short · THE FIX ── */
  it('3 · strides-format workout, strides_recovery_s present, recovery genuinely short (no early-end record) — grades false (was null before the fix)', () => {
    const grade = resolveWorkoutVerdict({
      type: 'easy',
      spec: { kind: 'easy', strides_reps: 2, strides_recovery_s: 60 },
      phases: stridesPhases(8, 10), // both far outside tolerance, no choice recorded
    });
    expect(grade.session.recoveriesHonest).toBe(false);
  });

  /* ── (4) recoveryEndedEarly excludes, never forces false · WALKBACK-2 regression ── */
  it('4 · a recovery flagged recoveryEndedEarly is excluded (null), never graded false — WALKBACK-2 regression, must still pass', () => {
    const grade = resolveWorkoutVerdict({
      type: 'easy',
      spec: { kind: 'easy', strides_reps: 2, strides_recovery_s: 60 },
      phases: stridesPhases(8, 62), // walkback 1 short but CHOSEN; walkback 2 honest
      recoveryEndedEarly: [{ phaseIndex: 2 }],
    });
    expect(grade.session.recoveriesHonest).not.toBe(false);
    // Confirms this isn't a coincidental null from the pre-fix bug: walkback 2
    // is honestly evaluated (60±30s window) and votes true; the flagged one
    // is excluded rather than forced to a verdict either way.
    expect(grade.session.recoveriesHonest).toBe(true);
  });

  /* ── proves (4) is REAL exclusion post-fix, not the pre-fix bug's coincidental null ── */
  it('4b · recoveryEndedEarly excludes ONLY the phase it names — a genuine unrecorded lapse elsewhere still fails the session (would have been masked as null before the fix)', () => {
    const grade = resolveWorkoutVerdict({
      type: 'easy',
      spec: { kind: 'easy', strides_reps: 2, strides_recovery_s: 60 },
      phases: stridesPhases(8, 10), // walkback 1 CHOSEN; walkback 2 short and UNRECORDED
      recoveryEndedEarly: [{ phaseIndex: 2 }],
    });
    // Before the fix this read null (prescribedSec was null for both, so
    // neither ever entered `known`) — silently hiding the real, unrecorded
    // lapse on walkback 2. After the fix, walkback 2 has a real prescribedSec
    // (60) and a real actualSec (10), is not excluded, and correctly fails.
    expect(grade.session.recoveriesHonest).toBe(false);
  });

  /* ── (5) both rep_rest_s and strides_recovery_s present · investigated, documented ── */
  it("5 · both rep_rest_s and strides_recovery_s on the same spec — CANNOT happen via any current authoring path (mutually exclusive by spec.kind in lib/plan/spec-builder.ts: rep_rest_s only on kind 'threshold'/'intervals', strides_recovery_s only on kind 'easy'/'shakeout'/'strides'). Documented precedence for a case that cannot currently occur: rep_rest_s wins.", () => {
    const grade = resolveWorkoutVerdict({
      type: 'threshold',
      // Synthetic — no authoring path produces this shape today.
      spec: { kind: 'threshold', rep_rest_s: 200, strides_recovery_s: 60 },
      // 195s is honest against rep_rest_s (200) and wildly dishonest against
      // strides_recovery_s (60) — the two fields disagree on purpose, so the
      // verdict pins which one won.
      phases: repFormatPhases(195),
    });
    expect(grade.session.recoveriesHonest).toBe(true);
  });

  /* ── (6) neither field present · Rule 11 refusal, never a silent false/true ── */
  it('6 · neither rep_rest_s nor strides_recovery_s present — refuses (null), never silently false or true', () => {
    const grade = resolveWorkoutVerdict({
      type: 'easy',
      spec: null,
      phases: repFormatPhases(8), // even a wildly "short" recovery must not read as a lapse with no prescribed duration to compare against
    });
    expect(grade.session.recoveriesHonest).toBeNull();
  });

  /* ── (7) final recovery cut short by session end · must not mis-grade ───── */
  it('7 · the LAST recovery cut short by the session ending (not a chosen early end) is excluded, and a genuine unrecorded lapse earlier in the same session still fails — was masked as null before the fix', () => {
    const grade = resolveWorkoutVerdict({
      type: 'easy',
      spec: { kind: 'easy', strides_reps: 2, strides_recovery_s: 60 },
      // Walkback 1: genuinely short, UNRECORDED — a real lapse.
      // Walkback 2 (the last phase of the whole session): cut to 5s because
      // the session ended there, not because the runner chose to move on.
      phases: stridesPhases(10, 5),
      sessionEnded: { phaseIndex: 4, phaseType: 'recovery' },
    });
    // Before the fix: both recoveries had a null prescribedSec, so BOTH were
    // invisible to `recoveriesHonestOf` and the vote read null — hiding the
    // genuine lapse on walkback 1. After the fix: walkback 1 is real and
    // fails; walkback 2 is excluded by sessionEnded either way.
    expect(grade.session.recoveriesHonest).toBe(false);
  });

  it('7b · the LAST recovery cut short by session end, with an otherwise-honest session, grades true — the truncation itself is not penalized', () => {
    const grade = resolveWorkoutVerdict({
      type: 'easy',
      spec: { kind: 'easy', strides_reps: 2, strides_recovery_s: 60 },
      phases: stridesPhases(58, 5), // walkback 1 honest; walkback 2 truncated by session end
      sessionEnded: { phaseIndex: 4, phaseType: 'recovery' },
    });
    expect(grade.session.recoveriesHonest).toBe(true);
  });
});
