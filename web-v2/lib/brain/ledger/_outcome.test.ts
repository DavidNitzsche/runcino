/**
 * STEP 16 · THE VERDICT ON A DECISION.
 *
 * WHAT THIS ASSERTS
 *   · UNRESOLVED is reachable and is the honest answer for a decision nobody
 *     applied, a window nobody could read, and a window too thin to judge. An
 *     evaluator that cannot say "not enough happened yet" will report "it was
 *     fine", which fills the ledger with false vindication.
 *   · PAIN OUTRANKS COMPLETION. A push completed in full that left the runner
 *     hurt is EXCESSIVE, not PRODUCTIVE.
 *   · A push absorbed cleanly is PRODUCTIVE, never UNDERDOSED — otherwise
 *     every successful increase becomes a demand for a bigger one, which is
 *     how an optimiser hurts a runner.
 *   · Confidence is continuous in the evidence and capped below 1, because
 *     this is an association and not a causal claim.
 *
 * WHAT IT CANNOT FAIL ON (Rule 22)
 *   · Whether the verdicts are the RIGHT coaching judgements. It checks that
 *     the classifier is honest about what it knows, not that its bands are
 *     correct.
 *   · Whether anything READS the verdicts. Nothing tunes off them, deliberately.
 *   · Causation. It cannot tell a bad week caused by the decision from a bad
 *     week that merely followed it.
 */
import { describe, it, expect } from 'vitest';
import {
  assessOutcome, OUTCOME_MIN_GRADED_SESSIONS,
  type DecisionPrediction, type ObservedAftermath,
} from './outcome';

const push: DecisionPrediction = {
  lever: 'WEEKLY_VOLUME', chosenOption: 'PUSH', rejectedOptions: ['HOLD', 'PULL_BACK'],
  expectedDirection: 'UP', beforeValue: 46.5, afterValue: 48.5, applied: true,
};
const hold: DecisionPrediction = { ...push, chosenOption: 'HOLD', expectedDirection: 'NEUTRAL', afterValue: 46.5 };

const clean: ObservedAftermath = {
  prescribedMi: 48.5, completedMi: 48.5, deterioratedSessions: 0, gradedSessions: 5,
  painOrInjuryReported: false, laterPerformanceImproved: true, missedPrescribedDays: 0,
};

describe('step 16 · UNRESOLVED is a real answer', () => {
  it('a decision nobody applied has no execution to judge', () => {
    const r = assessOutcome({ ...push, applied: false }, clean);
    expect(r.verdict).toBe('UNRESOLVED');
    expect(r.unresolvedReason).toBe('not_applied');
    expect(r.confidence).toBe(0);
  });

  it('an unreadable window is not a window that went well', () => {
    const r = assessOutcome(push, { ...clean, completedMi: null });
    expect(r.verdict).toBe('UNRESOLVED');
    expect(r.unresolvedReason).toBe('window_unreadable');
  });

  it('too few graded sessions refuses rather than guessing', () => {
    const r = assessOutcome(push, { ...clean, gradedSessions: OUTCOME_MIN_GRADED_SESSIONS - 1 });
    expect(r.verdict).toBe('UNRESOLVED');
    expect(r.unresolvedReason).toBe('insufficient_sessions');
  });

  it('every UNRESOLVED carries its reason, and no other verdict does', () => {
    // The migration's CHECK enforces exactly this; the classifier must agree.
    const cases: ObservedAftermath[] = [
      clean,
      { ...clean, completedMi: 30 },
      { ...clean, painOrInjuryReported: true },
      { ...clean, gradedSessions: 0 },
    ];
    for (const o of cases) {
      const r = assessOutcome(push, o);
      expect(r.verdict === 'UNRESOLVED').toBe(r.unresolvedReason !== null);
    }
  });
});

describe('step 16 · pain outranks completion', () => {
  it('a push completed in full that hurt him is EXCESSIVE, not PRODUCTIVE', () => {
    const r = assessOutcome(push, { ...clean, painOrInjuryReported: true });
    expect(r.verdict).toBe('EXCESSIVE');
    expect(r.because).toContain('pain or injury');
  });

  it('pain wins over EVERY load reading, not just a bad one', () => {
    /* The claim this test actually guarantees, corrected after falsifying it.
     * My first version was titled "checked BEFORE the load reading" and could
     * not fail: moving the pain branch anywhere above the final return still
     * yields EXCESSIVE, because the only case that distinguishes ordering is
     * pain plus FULL completion — and that case is caught wherever the branch
     * sits. What IS checkable, and what matters, is that no load reading can
     * out-vote pain. So the walk covers the full completion range. */
    for (const completedMi of [20, 38, 46, 48.5, 55, 70]) {
      const r = assessOutcome(push, { ...clean, completedMi, painOrInjuryReported: true });
      expect(r.verdict, `completion ${completedMi} out-voted a pain report`).toBe('EXCESSIVE');
      expect(r.because).toContain('pain or injury');
    }
  });

  it('and a HOLD the runner exceeded is EXCESSIVE too when it hurt him', () => {
    // The branch that would otherwise read UNDERDOSED.
    const r = assessOutcome(hold, {
      ...clean, prescribedMi: 46.5, completedMi: 46.5 * 1.15, painOrInjuryReported: true,
    });
    expect(r.verdict).toBe('EXCESSIVE');
  });
});

describe('step 16 · the load reading', () => {
  it('a shortfall is EXCESSIVE', () => {
    const r = assessOutcome(push, { ...clean, completedMi: 38 });
    expect(r.verdict).toBe('EXCESSIVE');
  });

  it('sessions falling away late are EXCESSIVE even at full mileage', () => {
    const r = assessOutcome(push, { ...clean, deterioratedSessions: 4, gradedSessions: 5 });
    expect(r.verdict).toBe('EXCESSIVE');
  });

  it('a clean absorption is PRODUCTIVE', () => {
    expect(assessOutcome(push, clean).verdict).toBe('PRODUCTIVE');
  });

  it('a PUSH absorbed cleanly is never UNDERDOSED', () => {
    // Otherwise every successful increase becomes a demand for a bigger one.
    const r = assessOutcome(push, { ...clean, completedMi: 48.5 * 1.2 });
    expect(r.verdict).toBe('PRODUCTIVE');
  });

  it('a HOLD the runner comfortably exceeded IS underdosed', () => {
    const r = assessOutcome(hold, { ...clean, prescribedMi: 46.5, completedMi: 46.5 * 1.15 });
    expect(r.verdict).toBe('UNDERDOSED');
    expect(r.because).toContain('room this decision did not spend');
  });
});

describe('step 16 · confidence is honest', () => {
  it('never claims certainty, because this is association and not cause', () => {
    for (const g of [2, 4, 6, 12, 50]) {
      const r = assessOutcome(push, { ...clean, gradedSessions: g });
      expect(r.confidence).toBeLessThanOrEqual(0.85);
    }
  });

  it('rises continuously with evidence · no cliff (Rule 9)', () => {
    let prev = assessOutcome(push, { ...clean, gradedSessions: 2 }).confidence;
    for (let g = 3; g <= 12; g += 1) {
      const cur = assessOutcome(push, { ...clean, gradedSessions: g }).confidence;
      expect(cur).toBeGreaterThanOrEqual(prev);
      expect(cur - prev, `confidence jumped at ${g} graded sessions`).toBeLessThan(0.15);
      prev = cur;
    }
  });

  it('falls when pain and performance were not read at all', () => {
    const known = assessOutcome(push, clean).confidence;
    const unknown = assessOutcome(push, {
      ...clean, painOrInjuryReported: null, laterPerformanceImproved: null,
    }).confidence;
    expect(unknown).toBeLessThan(known);
  });
});
