/**
 * lib/training/_recovery_ended_early.test.ts · WALKBACK-2, 2026-09-09.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `recoveriesHonestOf` graded ANY recovery outside `RECOVERY_DURATION_TOLERANCE`
 * (±50% of prescribed) as "not honest," with zero awareness of WHY it was
 * short. A runner who deliberately, correctly cut a walk-back short once he
 * felt ready for the next stride — exactly the behaviour
 * `Research/04-workout-vocabulary.md` §7.2 prescribes ("Full walk-back ...
 * no fatigue between strides," a runner-judged condition, not a clock) — was
 * graded identically to a recovery that came apart from a lapse or a lost
 * signal. Real account, 2026-09-09: several walk-backs ran 8-43s against a
 * 60s model, all ended deliberately via "End interval," on a session whose
 * strides landed perfectly.
 *
 * `sessionLadder` requires `recoveriesHonest !== false` for a session to
 * grade `'executed'`, its best verdict, and `recoveriesHonest` fed straight
 * from the duration comparison with no way to except a chosen early end. So
 * a session with perfect stride execution and several honest, deliberate
 * walk-backs could not grade better than `'uneven'` — the same word used for
 * genuinely uncontrolled execution.
 *
 * The fix: `WorkoutEngine.recordRecoveryEndedEarlyIfApplicable` (watch) records
 * an explicit `RecoveryEndedEarlyRecord` when the runner ends a `.recovery`
 * phase before its modelled duration; the wire carries it as
 * `RunData.recoveryEndedEarly`; `gradeStoredPhases` matches those records onto
 * recovery phases by `phaseIndex` and marks them `endedEarlyByChoice`;
 * `recoveriesHonestOf` excludes an `endedEarlyByChoice` recovery from the
 * tolerance check entirely rather than forcing it to "honest" — Rule 11: a
 * chosen early end and a genuinely short, UNRECORDED recovery are different
 * facts, and only the explicit record can tell them apart.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ──────────────────────────────
 *
 * It proves the READER's behaviour on synthetic phase arrays. It does not
 * touch the watch engine (`_RecoveryEndedEarlyTests.swift` in the watch test
 * target covers recording), the wire normalisation
 * (`complete/route.ts`'s `normalizeRecoveryEndedEarly`), or the native
 * display (`TodayAfterV5.completionNote`'s new positive-label arm).
 */
import { describe, it, expect } from 'vitest';
import { recoveriesHonestOf, RECOVERY_DURATION_TOLERANCE } from '@/lib/training/execution-semantics';
import { gradeStoredPhases } from '@/lib/execution/verdict';

describe('recoveriesHonestOf · absence is absence, a choice is not a lapse', () => {
  it('every recovery within tolerance · honest, as before this field existed', () => {
    expect(recoveriesHonestOf([
      { prescribedSec: 60, actualSec: 55 },
      { prescribedSec: 60, actualSec: 65 },
    ])).toBe(true);
  });

  it('a recovery outside tolerance with NO record · still fails. This is the genuine lapse this check exists to catch, and the fix must not soften it.', () => {
    expect(recoveriesHonestOf([
      { prescribedSec: 60, actualSec: 8 },
    ])).toBe(false);
    // Sanity on the boundary math itself: 8s is well outside ±50% of 60s.
    expect(Math.abs(8 - 60)).toBeGreaterThan(60 * RECOVERY_DURATION_TOLERANCE);
  });

  it('no recovery carries a prescribed+actual pair · null, not false (Rule 11: absence is not a lapse)', () => {
    expect(recoveriesHonestOf([])).toBeNull();
    expect(recoveriesHonestOf([{ prescribedSec: null, actualSec: 8 }])).toBeNull();
  });

  // ── THE FIX ───────────────────────────────────────────────────────────

  it('THE EXACT DEFECT · several deliberately-shortened recoveries, all recorded as chosen · does NOT fail the honesty check', () => {
    // The real account's shape: 8s and 15s against a 60s model, both well
    // outside tolerance by duration alone — but both explicitly recorded as
    // ended early BY CHOICE.
    const result = recoveriesHonestOf([
      { prescribedSec: 60, actualSec: 8, endedEarlyByChoice: true },
      { prescribedSec: 60, actualSec: 15, endedEarlyByChoice: true },
    ]);
    // null (no signal), never `false` — every recovery that could have
    // voted was excluded as a choice, so there is nothing left to grade.
    expect(result).not.toBe(false);
    expect(result).toBeNull();
  });

  it('a MIX · one recorded choice, one genuinely short and UNRECORDED · still fails, on the unrecorded one', () => {
    const result = recoveriesHonestOf([
      { prescribedSec: 60, actualSec: 8, endedEarlyByChoice: true },   // excluded
      { prescribedSec: 60, actualSec: 15 },                              // no record — still a lapse signal
    ]);
    expect(result).toBe(false);
  });

  it('a recorded choice that happens to ALSO be within tolerance · excluded either way, never double-counted', () => {
    // endedEarlyByChoice does not need to be "the reason" it failed — the
    // exclusion is unconditional on the flag, which is the simplest contract
    // and the one the watch can actually promise (it never claims "this
    // caused a failure," only "this was a choice").
    const result = recoveriesHonestOf([
      { prescribedSec: 60, actualSec: 55, endedEarlyByChoice: true },
    ]);
    expect(result).toBeNull();
  });
});

describe('gradeStoredPhases · the session-level verdict, before and after WALKBACK-2', () => {
  /** Two strides, both landing dead in the window, separated by walk-backs
   *  cut to 8s and 15s against a 60s model — the real account's shape. */
  function stridesSessionPhases() {
    return [
      { index: 0, type: 'warmup', label: 'Warmup', actualDurationSec: 300,
        completed: true, paceShape: 'ceiling', targetPaceSPerMi: 600, actualPaceSPerMi: 580 },
      { index: 1, type: 'work', label: 'Stride 1', actualDurationSec: 20,
        completed: true, paceShape: 'window', targetPaceSPerMi: 391,
        tolerancePaceSPerMi: 10, actualPaceSPerMi: 388 },
      { index: 2, type: 'recovery', label: 'Walk back 1', actualDurationSec: 8,
        targetDurationSec: 60, completed: false },
      { index: 3, type: 'work', label: 'Stride 2', actualDurationSec: 20,
        completed: true, paceShape: 'window', targetPaceSPerMi: 391,
        tolerancePaceSPerMi: 10, actualPaceSPerMi: 390 },
      { index: 4, type: 'recovery', label: 'Walk back 2', actualDurationSec: 15,
        targetDurationSec: 60, completed: false },
      { index: 5, type: 'cooldown', label: 'Cooldown', actualDurationSec: 300,
        completed: true, paceShape: 'ceiling', targetPaceSPerMi: 600, actualPaceSPerMi: 590 },
    ];
  }

  it('BEFORE the fix (no recoveryEndedEarly passed) · perfect strides still grade only "uneven", never "executed"', () => {
    const graded = gradeStoredPhases(stridesSessionPhases(), 'other');
    const work = graded.phases.filter((p) => p.type === 'work');
    // The stride execution itself is flawless.
    expect(work.every((p) => p.verdict === 'hit')).toBe(true);
    // But the session verdict is dragged down by the unrecorded short recoveries.
    expect(graded.session.recoveriesHonest).toBe(false);
    expect(graded.session.verdict).toBe('uneven');
    expect(graded.session.verdict).not.toBe('executed');
  });

  it('AFTER the fix · the SAME phases, with both walk-backs recorded as chosen · grades "executed"', () => {
    const graded = gradeStoredPhases(stridesSessionPhases(), 'other', {
      recoveryEndedEarly: [
        { phaseIndex: 2 },
        { phaseIndex: 4 },
      ],
    });
    const work = graded.phases.filter((p) => p.type === 'work');
    expect(work.every((p) => p.verdict === 'hit')).toBe(true);
    expect(graded.session.recoveriesHonest).not.toBe(false);
    expect(graded.session.verdict).toBe('executed');
  });

  it('a genuine lapse survives the fix · one recorded, one NOT · still fails to "executed"', () => {
    const graded = gradeStoredPhases(stridesSessionPhases(), 'other', {
      // Only phase 2 (Walk back 1) is recorded as chosen; phase 4's short
      // recovery has no explicit record — a real data-quality/lapse signal
      // must still hold the session back.
      recoveryEndedEarly: [{ phaseIndex: 2 }],
    });
    expect(graded.session.recoveriesHonest).toBe(false);
    expect(graded.session.verdict).not.toBe('executed');
  });
});
