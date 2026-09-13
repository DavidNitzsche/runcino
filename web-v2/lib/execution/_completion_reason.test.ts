/**
 * lib/execution/_completion_reason.test.ts · COMPLETIONREASON-1, 2026-09-12.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `gradeStoredPhases` already computed, internally, which of three things
 * happened to an ended phase — advanced early by explicit runner choice
 * (WALKBACK-2), the session simply ending (WALKBACK-SESSIONEND-1), or a
 * genuine shortfall — but spent that fact building only the internal
 * `recoveries[]` array behind `recoveriesHonestOf`'s vote, then threw it
 * away. `GradedPhase.completed` exposes a bare `boolean | null`, which
 * cannot tell "chose to move on" from "the session ended here" from
 * "genuinely came up short" — all three can produce `completed === false`.
 *
 * Two call sites re-derived an approximation of the SAME fact independently
 * by rejoining `recoveryEndedEarly`/`sessionEnded` onto a phase by
 * `phaseIndex` themselves: `today/route.ts` (server) and native's
 * `WorkoutEngine.swift` (sibling arrays matched by `phaseIndex` rather than
 * carried on the phase record). Rule 16 — two owners of one question.
 *
 * `GradedPhase.completionReason` is the one answer, computed from the exact
 * same two sets (`advancedEarlyPhaseIndices` / `sessionEndedPhaseIndices`)
 * `gradeStoredPhases` already built for `recoveriesHonestOf`'s benefit — no
 * new logic, just exposed. `completionNoteFor` is the one sentence a surface
 * prints for it, mirroring `TodayAfterV5.completionNote` (native)'s existing
 * wording for the four cases it already renders, plus ONE new sentence for
 * `'unknown'` — the case that function has no distinct copy for today (it
 * silently falls to nil, indistinguishable from a phase that ran exactly as
 * prescribed).
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ──────────────────────────────
 *
 * It proves the READER's behaviour on synthetic phase arrays. It does not
 * touch the watch engine, the wire normalisation
 * (`complete/route.ts`'s `normalizeRecoveryEndedEarly`/`normalizeSessionEnded`),
 * or the native display (`TodayAfterV5.completionNote`, which still
 * reconstructs this from `type`/`completed`/`recoveryEndedEarly`/
 * `sessionEnded` rather than reading `completionReason` — a native-side
 * follow-up this change unblocks but does not itself make).
 */
import { describe, it, expect } from 'vitest';
import { gradeStoredPhases, completionNoteFor, type GradedPhase } from '@/lib/execution/verdict';

/** One synthetic recovery phase, everything else held constant. */
function recoveryPhase(overrides: Record<string, unknown>) {
  return {
    index: 2, type: 'recovery', label: 'Walk back', actualDurationSec: 55,
    targetDurationSec: 60, completed: true,
    ...overrides,
  };
}

function sessionWith(recovery: Record<string, unknown>) {
  return [
    { index: 0, type: 'warmup', label: 'Warmup', actualDurationSec: 300,
      completed: true, paceShape: 'ceiling', targetPaceSPerMi: 600, actualPaceSPerMi: 580 },
    { index: 1, type: 'work', label: 'Stride 1', actualDurationSec: 20,
      completed: true, paceShape: 'window', targetPaceSPerMi: 391,
      tolerancePaceSPerMi: 10, actualPaceSPerMi: 388 },
    recovery,
    { index: 3, type: 'cooldown', label: 'Cooldown', actualDurationSec: 300,
      completed: true, paceShape: 'ceiling', targetPaceSPerMi: 600, actualPaceSPerMi: 590 },
  ];
}

describe('GradedPhase.completionReason · the fact gradeStoredPhases already computed, exposed', () => {
  it("as_prescribed · completed === true, no early-end records", () => {
    const graded = gradeStoredPhases(
      sessionWith(recoveryPhase({ completed: true, actualDurationSec: 60 })),
      'other',
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completionReason).toBe('as_prescribed');
  });

  it("advanced_early · a recoveryEndedEarly record names this phase, completed false", () => {
    const graded = gradeStoredPhases(
      sessionWith(recoveryPhase({ completed: false, actualDurationSec: 12 })),
      'other',
      { recoveryEndedEarly: [{ phaseIndex: 2 }] },
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completionReason).toBe('advanced_early');
  });

  it("session_ended · a sessionEnded record names this phase, completed false", () => {
    const graded = gradeStoredPhases(
      sessionWith(recoveryPhase({ completed: false, actualDurationSec: 8 })),
      'other',
      { sessionEnded: { phaseIndex: 2, phaseType: 'recovery' } },
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completionReason).toBe('session_ended');
  });

  it("incomplete · completed === false, no record of either kind — the genuine lapse recoveriesHonestOf already treats as one", () => {
    const graded = gradeStoredPhases(
      sessionWith(recoveryPhase({ completed: false, actualDurationSec: 8 })),
      'other',
      // opts SUPPLIED (even though empty for this phase) — the wire does
      // carry the field, it just says nothing happened here.
      { recoveryEndedEarly: [] },
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completionReason).toBe('incomplete');
    // Consistent with the existing, deliberately-unsoftened session-level
    // read of the identical input (`_recovery_ended_early.test.ts`).
    expect(graded.session.recoveriesHonest).toBe(false);
  });

  it("unknown · completed === null — a genuinely ambiguous / pre-field-existing payload that never said either way", () => {
    // No `completed` key at all (the tri-state's own honest absence,
    // COMPLETION-STATE-1) and no recoveryEndedEarly/sessionEnded opts —
    // exactly the shape a run recorded before either field existed on the
    // wire, or before the watch build that could populate them, produces.
    const graded = gradeStoredPhases(
      sessionWith({ index: 2, type: 'recovery', label: 'Walk back', actualDurationSec: 8, targetDurationSec: 60 }),
      'other',
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    expect(rec.completed).toBeNull();
    expect(rec.completionReason).toBe('unknown');
    // NEVER coerced to a confident claim in either direction (Rule 11).
    expect(rec.completionReason).not.toBe('incomplete');
    expect(rec.completionReason).not.toBe('as_prescribed');
  });

  it('a non-recovery phase never reads advanced_early/session_ended, even if the phaseIndex happens to match a record — those records are meaningless outside type recovery', () => {
    const phases = [
      { index: 0, type: 'work', label: 'Stride 1', actualDurationSec: 20,
        completed: false, paceShape: 'window', targetPaceSPerMi: 391,
        tolerancePaceSPerMi: 10, actualPaceSPerMi: 388 },
    ];
    const graded = gradeStoredPhases(phases, 'other', {
      recoveryEndedEarly: [{ phaseIndex: 0 }],
      sessionEnded: { phaseIndex: 0, phaseType: 'work' },
    });
    const work = graded.phases.find((p) => p.index === 0)!;
    expect(work.completionReason).toBe('incomplete');
  });

  it('the existing completed field is untouched — this adds a field, it does not change what completed means', () => {
    const graded = gradeStoredPhases(
      sessionWith(recoveryPhase({ completed: false, actualDurationSec: 12 })),
      'other',
      { recoveryEndedEarly: [{ phaseIndex: 2 }] },
    );
    const rec = graded.phases.find((p) => p.index === 2)!;
    // completed is STILL the raw tri-state, unaffected by the new field.
    expect(rec.completed).toBe(false);
    expect(rec.completionReason).toBe('advanced_early');
  });
});

describe('completionNoteFor · the sentence, mirroring TodayAfterV5.completionNote plus ONE new honest case', () => {
  function note(completionReason: GradedPhase['completionReason'], type: GradedPhase['type'], durations?: { targetDurationSec: number | null; actualDurationSec: number | null }) {
    return completionNoteFor({
      type,
      completionReason,
      targetDurationSec: durations?.targetDurationSec ?? null,
      actualDurationSec: durations?.actualDurationSec ?? null,
    });
  }

  it('as_prescribed · nothing to add', () => {
    expect(note('as_prescribed', 'recovery')).toBeNull();
  });

  it("advanced_early · \"0:12 of 1:00 · advanced early\" — the exact wording TodayAfterV5.completionNote already renders", () => {
    expect(note('advanced_early', 'recovery', { targetDurationSec: 60, actualDurationSec: 12 }))
      .toBe('0:12 of 1:00 · advanced early');
  });

  it('advanced_early with no usable duration pair · says nothing rather than a broken sentence', () => {
    expect(note('advanced_early', 'recovery', { targetDurationSec: null, actualDurationSec: null })).toBeNull();
  });

  it('session_ended · null — a hard veto, the run already states it ended here', () => {
    expect(note('session_ended', 'recovery', { targetDurationSec: 60, actualDurationSec: 8 })).toBeNull();
  });

  it('incomplete on a non-recovery phase · "not completed"', () => {
    expect(note('incomplete', 'work')).toBe('not completed');
  });

  it('incomplete on a recovery phase · stays silent — WALKBACK-1\'s original posture, no claim in either direction', () => {
    expect(note('incomplete', 'recovery')).toBeNull();
  });

  it("unknown on a recovery phase · ONE honest, neutral sentence — the case TodayAfterV5.completionNote has no distinct copy for today", () => {
    const text = note('unknown', 'recovery');
    expect(text).not.toBeNull();
    expect(text).toBe('recovery outcome not recorded');
    // Never implies either success or failure.
    expect(text).not.toMatch(/complet|advanced|fail|miss/i);
  });

  it('unknown on a non-recovery phase · stays silent, same posture as every other "nothing to add" case', () => {
    expect(note('unknown', 'work')).toBeNull();
  });
});
