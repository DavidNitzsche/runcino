/**
 * lib/training/_session_ended.test.ts · WALKBACK-SESSIONEND-1, 2026-09-09.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * A real, live regression in code already merged to `main` as part of
 * WALKBACK-2 (`e5bcc430b`). `endCurrentPhase()` recorded a
 * `RecoveryEndedEarlyRecord` for ANY `.recovery` phase ended before its
 * modelled duration — including the plan's LAST phase, which does not
 * "advance early" to anything because nothing comes after it. The watch-side
 * fix (`WorkoutEngine.SessionEndedRecord`, covered by
 * `_RecoveryEndedEarlyTests.swift`'s new WALKBACK-SESSIONEND-1 section) now
 * writes this case as a distinct `sessionEnded` fact instead, never as
 * `recoveryEndedEarly`.
 *
 * This file covers the SERVER-SIDE half of that fix: `gradeStoredPhases`
 * must exclude a recovery carrying a matching `sessionEnded` record from
 * `recoveriesHonestOf`'s tolerance check the SAME WAY it already excludes one
 * carrying a `recoveryEndedEarly` record — a recovery cut short because the
 * session ended is neither a lapse nor a chosen early end to move on to
 * something else, because nothing else was left. Without this exclusion,
 * simply moving the last-phase case OUT of `recoveryEndedEarly` (the display
 * fix) would have been a GRADING regression: that recovery would re-enter
 * the honesty vote as an unrecorded short recovery and could fail a session
 * that executed perfectly, for ending the walk-back the runner had no reason
 * to finish.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ──────────────────────────────
 *
 * It proves the READER's behaviour on synthetic phase arrays. It does not
 * touch the watch engine (`_RecoveryEndedEarlyTests.swift`), the wire
 * normalisation (`complete/route.ts`'s `normalizeSessionEnded`), or the
 * native display (`TodayAfterV5.completionNote`'s `sessionEnded` arm,
 * covered by `WalkBackCompletionLabelTests.swift`).
 */
import { describe, it, expect } from 'vitest';
import { gradeStoredPhases } from '@/lib/execution/verdict';

describe('gradeStoredPhases · sessionEnded excludes the last recovery from the honesty vote', () => {
  /** Same shape as `_recovery_ended_early.test.ts`'s `stridesSessionPhases`,
   *  but the SECOND walk-back is the plan's LAST phase — no work rep after
   *  it — matching the exact case David called out: the final recovery
   *  after the last stride. */
  function finalWalkBackSessionPhases() {
    return [
      { index: 0, type: 'warmup', label: 'Warmup', actualDurationSec: 300,
        completed: true, paceShape: 'ceiling', targetPaceSPerMi: 600, actualPaceSPerMi: 580 },
      { index: 1, type: 'work', label: 'Stride 1', actualDurationSec: 20,
        completed: true, paceShape: 'window', targetPaceSPerMi: 391,
        tolerancePaceSPerMi: 10, actualPaceSPerMi: 388 },
      { index: 2, type: 'recovery', label: 'Walk back 1', actualDurationSec: 55,
        targetDurationSec: 60, completed: true },
      { index: 3, type: 'work', label: 'Stride 2', actualDurationSec: 20,
        completed: true, paceShape: 'window', targetPaceSPerMi: 391,
        tolerancePaceSPerMi: 10, actualPaceSPerMi: 390 },
      // The plan's LAST phase. Cut to 8s of a 60s model because the runner
      // ended the completed workout right here — not a lapse, not a choice
      // to move on to something else.
      { index: 4, type: 'recovery', label: 'Walk back 2', actualDurationSec: 8,
        targetDurationSec: 60, completed: false },
    ];
  }

  it('BEFORE the fix (no sessionEnded passed) · the final walk-back reads as an unrecorded lapse and drags the session down', () => {
    const graded = gradeStoredPhases(finalWalkBackSessionPhases(), 'other');
    const work = graded.phases.filter((p) => p.type === 'work');
    expect(work.every((p) => p.verdict === 'hit')).toBe(true);
    // 8s against a 60s model, unrecorded — exactly the genuine-lapse signal
    // `recoveriesHonestOf` exists to catch.
    expect(graded.session.recoveriesHonest).toBe(false);
    expect(graded.session.verdict).not.toBe('executed');
  });

  it('AFTER the fix · the SAME phases, with the final walk-back carrying sessionEnded · excluded, not penalized', () => {
    const graded = gradeStoredPhases(finalWalkBackSessionPhases(), 'other', {
      sessionEnded: { phaseIndex: 4, phaseType: 'recovery' },
    });
    const work = graded.phases.filter((p) => p.type === 'work');
    expect(work.every((p) => p.verdict === 'hit')).toBe(true);
    expect(graded.session.recoveriesHonest).not.toBe(false);
    expect(graded.session.verdict).toBe('executed');
  });

  it('sessionEnded and recoveryEndedEarly compose · one excludes phase 4, the other could exclude a DIFFERENT phase, both apply', () => {
    const phases = finalWalkBackSessionPhases();
    // Make the FIRST walk-back also short, but for the ordinary WALKBACK-2
    // reason (a chosen early end mid-session, something else was next).
    phases[2] = { ...phases[2], actualDurationSec: 12 };
    const graded = gradeStoredPhases(phases, 'other', {
      recoveryEndedEarly: [{ phaseIndex: 2 }],
      sessionEnded: { phaseIndex: 4, phaseType: 'recovery' },
    });
    expect(graded.session.recoveriesHonest).not.toBe(false);
    expect(graded.session.verdict).toBe('executed');
  });

  it('sessionEnded on a phase that is NOT type recovery is never unioned in — the field only ever excludes a recovery phase', () => {
    // Defensive: a hypothetical future non-recovery session-end (an
    // `abandon()`-triggered mid-session end, not yet built) must not
    // silently start excluding a WORK phase from a check that only ever
    // asked about recoveries.
    const phases = finalWalkBackSessionPhases();
    const graded = gradeStoredPhases(phases, 'other', {
      sessionEnded: { phaseIndex: 3, phaseType: 'work' },
    });
    // Phase 4's genuine unrecorded short recovery still fails the vote —
    // the (irrelevant) work-phase sessionEnded record changed nothing.
    expect(graded.session.recoveriesHonest).toBe(false);
  });

  it('a genuine lapse elsewhere still survives the fix · sessionEnded excludes ONLY the phase it names', () => {
    const phases = finalWalkBackSessionPhases();
    // Walk back 1 (phase 2) is ALSO short, but carries no record of any kind.
    phases[2] = { ...phases[2], actualDurationSec: 12 };
    const graded = gradeStoredPhases(phases, 'other', {
      sessionEnded: { phaseIndex: 4, phaseType: 'recovery' },
    });
    // Phase 4 is excluded; phase 2's unrecorded short recovery is a real
    // lapse signal and must still hold the session back.
    expect(graded.session.recoveriesHonest).toBe(false);
    expect(graded.session.verdict).not.toBe('executed');
  });
});
