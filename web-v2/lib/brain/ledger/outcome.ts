/**
 * lib/brain/ledger/outcome.ts · STEP 16 · DID THE DECISION WORK?
 *
 * ── THE STEP THAT DID NOT EXIST ────────────────────────────────────────────
 *
 * `lib/brain/orchestration/steps.ts` carried step 16 as `NOT_BUILT`, and its
 * blocker said: "nothing re-reads a decision after its reassessment date to
 * record whether it turned out to be right. The ledger has the columns and the
 * scheduler can raise the date; no code closes the loop between them. This is
 * the step that would make the engine able to learn from being wrong, and it
 * does not exist."
 *
 * This is that code. It reads a decision, reads what the runner actually did in
 * the window after it, and records a verdict.
 *
 * ── IT DOES NOT TUNE ANYTHING, DELIBERATELY ────────────────────────────────
 *
 * The owner's instruction is explicit: "Do not automatically tune coefficients
 * from this yet. Build the measurement path." So nothing here feeds back into a
 * threshold, a cap or a bar. It measures and records. An engine that started
 * moving its own constants off a measurement path nobody had audited would be
 * a worse failure than one that could not measure at all.
 *
 * ── UNRESOLVED IS A FIRST-CLASS ANSWER ─────────────────────────────────────
 *
 * Rule 11, and the one that matters most here. "Not enough has happened yet"
 * and "the decision was fine" are different facts, and an evaluator that cannot
 * say the first will report the second — which would fill the ledger with
 * false vindication and make the whole measurement worthless. The migration's
 * own CHECK enforces that an UNRESOLVED verdict carries its reason.
 *
 * ── WHAT THIS CANNOT DO (Rule 22) ──────────────────────────────────────────
 *
 * · It cannot establish CAUSE. A week that went badly after a PUSH may have
 *   gone badly for reasons the plan never touched. The verdict is an
 *   association recorded honestly, not a causal claim, and `confidence` is
 *   where that doubt lives.
 * · It cannot judge a decision nobody applied. A declined or expired proposal
 *   has no execution to read, and reads UNRESOLVED with that reason.
 * · It cannot see beyond the observation window it was given.
 */

export type OutcomeVerdict = 'PRODUCTIVE' | 'EXCESSIVE' | 'UNDERDOSED' | 'UNRESOLVED';

/** What the decision claimed would happen. */
export interface DecisionPrediction {
  readonly lever: string;
  readonly chosenOption: string;
  readonly rejectedOptions: readonly string[];
  readonly expectedDirection: 'UP' | 'DOWN' | 'NEUTRAL' | 'UNKNOWN';
  /** The value it moved from and to, when it moved one. */
  readonly beforeValue: number | null;
  readonly afterValue: number | null;
  /** Whether the runner ever accepted it. A decision nobody took is not a
   *  decision that failed. */
  readonly applied: boolean;
}

/**
 * What the runner actually did afterwards.
 *
 * Every field is `| null` and null means NOT READ, never zero. The classifier
 * branches on that, because a week with no runs recorded and a week the reader
 * could not open are opposite facts about a runner.
 */
export interface ObservedAftermath {
  /** Prescribed vs completed across the observation window. */
  readonly prescribedMi: number | null;
  readonly completedMi: number | null;
  /** Sessions that fell away late, per the deterioration reader. */
  readonly deterioratedSessions: number | null;
  readonly gradedSessions: number | null;
  /** Did the runner report pain, a niggle, injury or illness in the window? */
  readonly painOrInjuryReported: boolean | null;
  /** A later performance marker, when one exists in the window. */
  readonly laterPerformanceImproved: boolean | null;
  /** Days in the window with no run at all where one was prescribed. */
  readonly missedPrescribedDays: number | null;
}

export interface OutcomeAssessment {
  readonly verdict: OutcomeVerdict;
  readonly because: string;
  readonly unresolvedReason: string | null;
  readonly confidence: number;
}

/**
 * How much of the prescription must be completed before "he absorbed it" is a
 * defensible reading.
 *
 * POLICY_ASSUMPTION, and named as one. It reuses the volume contract's own
 * completion bar rather than inventing a second number, because two bars for
 * "did he do the work" is exactly the Rule 16 duplication this engine keeps
 * paying for.
 */
export const OUTCOME_COMPLETION_BAR = 0.95;

/** Enough of the window must be readable for a verdict to mean anything. */
export const OUTCOME_MIN_GRADED_SESSIONS = 2;

/**
 * The classifier. Pure — no database, no clock — so the gate can walk it.
 *
 * The order of the branches is the argument:
 *   1 · a decision nobody applied cannot have worked or failed
 *   2 · an unreadable window cannot be judged
 *   3 · PAIN OR INJURY outranks everything that follows. A push that was
 *       "absorbed" and hurt him is not productive, and reading completion
 *       first would let it be.
 *   4 · then the load reading
 */
export function assessOutcome(
  p: DecisionPrediction,
  o: ObservedAftermath,
): OutcomeAssessment {
  if (!p.applied) {
    return {
      verdict: 'UNRESOLVED',
      because: 'The decision was never applied, so there is no execution to read against it.',
      unresolvedReason: 'not_applied',
      confidence: 0,
    };
  }

  if (o.gradedSessions === null || o.completedMi === null || o.prescribedMi === null) {
    return {
      verdict: 'UNRESOLVED',
      because: 'The window after this decision could not be read.',
      unresolvedReason: 'window_unreadable',
      confidence: 0,
    };
  }

  if (o.gradedSessions < OUTCOME_MIN_GRADED_SESSIONS) {
    return {
      verdict: 'UNRESOLVED',
      because: `Only ${o.gradedSessions} graded session(s) sit after this decision, and a `
        + `verdict asks for ${OUTCOME_MIN_GRADED_SESSIONS}.`,
      unresolvedReason: 'insufficient_sessions',
      confidence: 0,
    };
  }

  /* Pain and injury come FIRST, before any reading of load.
   *
   * A push the runner completed in full and which left him hurt is not a
   * productive decision, and an evaluator that scores completion first would
   * record it as one. `OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP` is the same rule
   * pointed forwards; this is it pointed backwards at what already happened. */
  if (o.painOrInjuryReported === true) {
    return {
      verdict: 'EXCESSIVE',
      because: p.expectedDirection === 'UP'
        ? 'The runner reported pain or injury in the window after this increase.'
        : 'The runner reported pain or injury in the window after this decision.',
      unresolvedReason: null,
      confidence: 0.7,
    };
  }

  const completionFrac = o.prescribedMi > 0 ? o.completedMi / o.prescribedMi : null;
  if (completionFrac === null) {
    return {
      verdict: 'UNRESOLVED',
      because: 'Nothing was prescribed in the window after this decision, so completion says '
        + 'nothing about whether it was absorbed.',
      unresolvedReason: 'nothing_prescribed',
      confidence: 0,
    };
  }

  const deteriorationRate = o.deterioratedSessions !== null && o.gradedSessions > 0
    ? o.deterioratedSessions / o.gradedSessions
    : null;

  /* EXCESSIVE · he could not carry it. */
  if (completionFrac < OUTCOME_COMPLETION_BAR
    || (deteriorationRate !== null && deteriorationRate > 0.5)) {
    return {
      verdict: 'EXCESSIVE',
      because: `The window completed at ${Math.round(completionFrac * 100)}% of prescribed`
        + (deteriorationRate !== null && deteriorationRate > 0.5
          ? `, and ${o.deterioratedSessions} of ${o.gradedSessions} sessions fell away late.`
          : '.'),
      unresolvedReason: null,
      confidence: confidenceFor(o),
    };
  }

  /* UNDERDOSED · he carried it with room to spare, and nothing cost him.
   *
   * Only reachable on a decision that did NOT go up. A push he absorbed
   * cleanly is the push working, not evidence it should have been bigger —
   * calling that underdosed would ratchet every successful increase into a
   * demand for a larger one, which is how an optimiser hurts a runner. */
  if (p.expectedDirection !== 'UP'
    && completionFrac >= 1.05
    && (deteriorationRate === null || deteriorationRate === 0)) {
    return {
      verdict: 'UNDERDOSED',
      because: `The window completed at ${Math.round(completionFrac * 100)}% of prescribed with `
        + 'no session falling away, so there was room this decision did not spend.',
      unresolvedReason: null,
      confidence: confidenceFor(o),
    };
  }

  return {
    verdict: 'PRODUCTIVE',
    because: `The window completed at ${Math.round(completionFrac * 100)}% of prescribed`
      + (o.laterPerformanceImproved === true ? ', and later performance improved.' : '.'),
    unresolvedReason: null,
    confidence: confidenceFor(o),
  };
}

/**
 * How much to trust the verdict.
 *
 * Continuous in the evidence (Rule 9) and deliberately capped below 1: this is
 * an association between a decision and what followed it, and it can never be
 * a causal claim. A week may go badly for reasons the plan never touched.
 */
function confidenceFor(o: ObservedAftermath): number {
  const graded = o.gradedSessions ?? 0;
  const base = Math.min(graded / 6, 1) * 0.6;
  const painKnown = o.painOrInjuryReported !== null ? 0.15 : 0;
  const perfKnown = o.laterPerformanceImproved !== null ? 0.1 : 0;
  return Math.round(Math.min(base + painKnown + perfKnown, 0.85) * 1000) / 1000;
}
