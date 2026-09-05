/**
 * lib/safety/training-safety.ts · MAY ORDINARY TRAINING OPTIMIZATION PROCEED?
 *
 * The SECOND question the Safety owner answers, and a different one from the
 * first. `safety-verdict.ts` answers "may this runner train today, and what may
 * be put in front of them" (Constitution §2.E, four states, consumed by the
 * phone and the wrist). This file answers "may an engine PROPOSE HARDER
 * TRAINING to this runner", which is the question the Adaptation Engine asks
 * and the one nothing answered before 2026-09-05.
 *
 * Rule 16 is why they are two names rather than one. They are genuinely two
 * quantities: a runner on the third week back from a two week layoff may train
 * today (the first answer is yes) and may not be pushed (the second answer is
 * no). One name for both would have to pick a side, and either side is wrong
 * half the time.
 *
 * ── THE GAP THIS CLOSES, VERBATIM FROM THE CODE IT REPLACES ────────────────
 *
 * `lib/adaptation/canonical-shadow/live-input.ts` carried this, and it was the
 * only thing standing where Safety belongs:
 *
 *     // The Safety owner has no persisted verdict this loader can read either,
 *     // and NORMAL is the correct default here for one reason only: this engine
 *     // proposes nothing that reaches a runner. [...] If that ever changes,
 *     // this field must be wired to Safety BEFORE it does, and this comment is
 *     // the marker for whoever does it.
 *     safety: 'NORMAL',
 *
 * This is that wiring. The literal is gone and
 * `_safety_wired_live.test.ts` is the ratchet that stops it growing back.
 *
 * ── THE PRECEDENCE, EXACTLY AS THE OWNER STATED IT ─────────────────────────
 *
 *   1 · injury hard stop
 *   2 · illness stop or modify
 *   3 · niggle caution
 *   4 · recovery constraint
 *   5 · normal coaching optimization
 *
 * `SAFETY_PRECEDENCE` below is that list as data, in that order, and
 * `_safety_precedence.test.ts` reads the array rather than restating it, so the
 * gate cannot drift from the rule the way a hand-copied expectation would.
 *
 * The ordering is MONOTONE in restriction, and that is load bearing rather than
 * decorative: rank 4 may never produce a state more restrictive than rank 3, or
 * a runner carrying both a niggle and a return constraint would be told the
 * milder of two things. That is why return-to-running and recent disruption
 * both resolve to CAUTION in `safety-verdict.ts` and not to MODIFY. An OPEN
 * injury, which is what puts a runner on a walk-run ladder in the first place,
 * is already rank 1 and already stops everything; rank 4 is the window AFTER
 * the injury is resolved, which doctrine treats as a reduced load rather than
 * as no load (`Research/22-plan-templates.md` §14).
 *
 * ── RULE 11 · WHY THIS GATE IS STRICTER THAN THE PHONE'S ───────────────────
 *
 * `classifySafety` withholds the runner's whole day only when an unreadable
 * signal's worst case could have TIGHTENED THE POSTURE. That is right for a
 * screen: blanking a runner's morning because a niggle read timed out is an
 * over-reaction, and the verdict carries `degradedSignals` so the footnote
 * survives.
 *
 * It is NOT right here, and this gate refuses on ANY degraded signal. The
 * asymmetry is the whole argument: not proposing costs nothing, and proposing a
 * push on safety data nobody could read costs everything. A screen owes the
 * runner an answer this morning. A proposal engine owes them silence until it
 * knows.
 *
 * So `UNREADABLE` fires on both branches of `SafetyResolution`:
 *
 *   · `known: false`                        the verdict itself refused
 *   · `known: true, degradedSignals != []`  the verdict stands for the screen,
 *                                           and this engine still will not push
 *
 * ── WHAT THIS FILE MAY NOT DO ──────────────────────────────────────────────
 *
 *   · It does not read a database. `load-safety.ts` reads; this maps.
 *   · It does not GRADE a health signal. Every state it reads was decided by
 *     `classifySafety`, which is the owner. Deriving a severity here would be
 *     the ownership violation Constitution §2.E names.
 *   · It does not decide what to prescribe instead. That is the Plan
 *     Generator's (§2.H).
 */
import type { SafetyReason, SafetyResolution, SafetySignalName } from './safety-verdict';

/* ═══════════════════════════════════════════════════════════════════════════
 * THE PRECEDENCE
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The owner's five ranks, in order, as DATA.
 *
 * Declared once and read by the gate, so "the precedence is what was asked
 * for" is checked against this array rather than against a second copy of it
 * written in a test (Rule 18 §"a check that hardcodes both sides only proves
 * the test agrees with itself").
 */
export const SAFETY_PRECEDENCE = [
  'INJURY_HARD_STOP',
  'ILLNESS_STOP_OR_MODIFY',
  'NIGGLE_CAUTION',
  'RECOVERY_CONSTRAINT',
  'NORMAL_OPTIMIZATION',
] as const;

export type SafetyTier = (typeof SAFETY_PRECEDENCE)[number];

/** 1-based rank. Lower outranks higher, exactly as the owner numbered them. */
export type SafetyRank = 1 | 2 | 3 | 4 | 5;

export const rankOfTier = (t: SafetyTier): SafetyRank =>
  (SAFETY_PRECEDENCE.indexOf(t) + 1) as SafetyRank;

/* ═══════════════════════════════════════════════════════════════════════════
 * THE POSTURE THE ADAPTATION ENGINE CONSUMES
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * What an engine that proposes training changes is permitted to do.
 *
 * FOUR members, and each one is a different FACT with a different remedy. This
 * replaced a two member union (`'NORMAL' | 'HARD_STOP'`) declared inside
 * `lib/adaptation/canonical/phase-priority.ts`, which was a second declaration
 * of safety vocabulary outside the Safety owner and had no way to say "the
 * check did not run" at all. Collapsing these four into two is the Rule 11
 * failure this codebase keeps repeating, and collapsing them into ONE
 * (`NORMAL`) is exactly what the live loader was doing.
 *
 * The old header for the two member union argued that a graded member would be
 * the engine making a safety judgement. That argument is preserved and is the
 * reason `CONSTRAINED` is decided HERE, by the Safety owner, off a state
 * `classifySafety` already resolved. The engine carries it. It never grades.
 */
export type TrainingSafetyPosture =
  /** Ordinary training logic may proceed, and may advance. */
  | 'NORMAL'
  /**
   * Training proceeds, and may not ADVANCE. A niggle in doctrine's amber band,
   * or a runner inside a return-to-running or post-layoff window.
   *
   * `Research/05-injury-return-protocols.md` §1.2 says exactly this for amber:
   * "Hold current load; do not progress."
   */
  | 'CONSTRAINED'
  /** Safety has stopped ordinary training. Nothing this engine can produce
   *  outranks it. */
  | 'HARD_STOP'
  /**
   * The safety check did not run, or ran incompletely. Rule 11: this is not
   * NORMAL, and it is not a stop either. It is retryable, and the remedy is a
   * successful read rather than a clinical decision.
   */
  | 'UNREADABLE';

/** True when an engine may propose an INCREASE. The one predicate callers
 *  need, so no caller re-derives the set. */
export const mayAdvanceTraining = (p: TrainingSafetyPosture): boolean => p === 'NORMAL';

/* ═══════════════════════════════════════════════════════════════════════════
 * THE RESOLUTION · RULE 11 AS A TYPE
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Rule 11 as a type, in the `NormalReading<T>` / `SafetyResolution` pattern
 * this codebase has settled on: the unreadable branch carries NO `tier` and NO
 * `rank`, so `ts.rank` does not compile until the caller has branched on
 * `readable`.
 *
 * `posture` is total across both branches DELIBERATELY, and its unreadable
 * value is `UNREADABLE`, which is not `NORMAL`. That is what makes the one read
 * a caller may perform without branching incapable of becoming a permission.
 */
export type TrainingSafety =
  | {
      readonly readable: true;
      readonly rank: SafetyRank;
      readonly tier: SafetyTier;
      readonly posture: TrainingSafetyPosture;
      /** The signal that set the tier, or null at rank 5. */
      readonly driver: SafetySignalName | null;
      /** Evidence, in the shape `lib/brain/objective.ts` adjudicates. */
      readonly because: string;
      readonly wouldAdvanceIf: string;
      readonly explain: string;
    }
  | {
      readonly readable: false;
      readonly posture: 'UNREADABLE';
      /** Every signal that could not be read. Non-empty by construction. */
      readonly unreadable: readonly SafetySignalName[];
      readonly because: string;
      readonly wouldAdvanceIf: string;
      readonly explain: string;
    };

/**
 * The tier each `SafetyReason` belongs to.
 *
 * Total over `SafetyReason` by construction: a reason with no row here is a
 * compile error, so a future health signal cannot be added to the verdict and
 * silently arrive at rank 5.
 */
export const TIER_BY_REASON: Readonly<Record<SafetyReason, SafetyTier>> = {
  injury_minor: 'INJURY_HARD_STOP',
  injury_moderate: 'INJURY_HARD_STOP',
  injury_major: 'INJURY_HARD_STOP',
  illness_fever: 'ILLNESS_STOP_OR_MODIFY',
  illness: 'ILLNESS_STOP_OR_MODIFY',
  niggle: 'NIGGLE_CAUTION',
  niggle_escalating: 'NIGGLE_CAUTION',
  return_to_running: 'RECOVERY_CONSTRAINT',
  training_disruption: 'RECOVERY_CONSTRAINT',
  clear: 'NORMAL_OPTIMIZATION',
};

/**
 * The posture each tier licenses for an engine that proposes changes.
 *
 * NOTE the injury row. Every open injury is `HARD_STOP` here, INCLUDING a minor
 * one that `classifySafety` puts at MODIFY for the screen. That is not a
 * disagreement between two owners; it is the two questions giving different
 * answers because they are different questions. "What may I show this runner
 * today" is graded by severity, and doctrine brief 11 grades it. "May I propose
 * MORE load to a runner with an open injury row" has one answer at every
 * severity, and it is no.
 */
const POSTURE_BY_TIER: Readonly<Record<SafetyTier, TrainingSafetyPosture>> = {
  INJURY_HARD_STOP: 'HARD_STOP',
  ILLNESS_STOP_OR_MODIFY: 'HARD_STOP',
  NIGGLE_CAUTION: 'CONSTRAINED',
  RECOVERY_CONSTRAINT: 'CONSTRAINED',
  NORMAL_OPTIMIZATION: 'NORMAL',
};

/** Evidence and the path back, per tier. Never a disposition: every `because`
 *  names a fact, because `lib/brain/objective.ts#describesEvidence` rejects the
 *  ones that do not and `_safety_precedence.test.ts` runs every row through it. */
const ACCOUNT_BY_TIER: Readonly<Record<SafetyTier, { because: string; wouldAdvanceIf: string }>> = {
  INJURY_HARD_STOP: {
    because: 'this runner has an open injury row logged against them, and Safety owns whether '
      + 'ordinary training logic may proceed at all',
    wouldAdvanceIf: 'the injury is resolved. That is Safety\'s call, and not a date this engine '
      + 'can schedule against.',
  },
  ILLNESS_STOP_OR_MODIFY: {
    because: 'this runner has an uncleared illness episode logged against them, and running adds '
      + 'load the body does not have to spare',
    wouldAdvanceIf: 'the episode is cleared. That is Safety\'s call, and not a date this engine '
      + 'can schedule against.',
  },
  NIGGLE_CAUTION: {
    because: 'this runner is carrying a logged niggle in the amber band of Research/05 §1.2, '
      + 'whose own instruction is to hold current load and not progress',
    wouldAdvanceIf: 'the niggle clears or drops into the green band at 0 to 2 on the same scale.',
  },
  RECOVERY_CONSTRAINT: {
    because: 'this runner is inside a return window that doctrine prescribes a reduced load for, '
      + 'either after a resolved injury or after a break in running long enough that '
      + 'Research/22 §14 restarts them below their previous volume',
    wouldAdvanceIf: 'the return window closes on its own schedule, which Research/22 §14 puts at '
      + 'the third week for a break of 8 to 14 days.',
  },
  NORMAL_OPTIMIZATION: {
    because: 'every safety signal was read and none of them is firing, so ordinary coaching '
      + 'optimization is what governs',
    wouldAdvanceIf: 'nothing. This tier already permits advancing.',
  },
};

/**
 * THE MAP. Pure, total, and the ONLY place a `SafetyResolution` becomes a
 * permission to propose.
 *
 * Every branch is driven by the verdict `classifySafety` already produced. This
 * function contains no threshold, no severity comparison and no health
 * judgement of its own, which is what keeps Constitution §2.E's single owner
 * single.
 */
export function resolveTrainingSafety(res: SafetyResolution): TrainingSafety {
  if (!res.known) {
    const unreadable = res.unreadable.map((u) => u.signal);
    return {
      readable: false,
      posture: 'UNREADABLE',
      unreadable,
      because: `the safety check did not complete: ${res.unreadable
        .map((u) => `${u.signal} (${u.failure})`).join(', ')}`,
      wouldAdvanceIf: 'the safety read succeeds. Nothing about this runner is being asserted; '
        + 'the check is retried on the next evaluation.',
      explain: `training-safety UNREADABLE · verdict refused · ${res.explain}`,
    };
  }

  /* ── Rule 11, and the reason this gate is stricter than the screen's ─────
   *
   * A KNOWN verdict with degraded signals is a legitimate answer for a screen
   * and is not one for a proposal. See this file's header for the asymmetry
   * that licenses the difference. */
  if (res.degradedSignals.length > 0) {
    return {
      readable: false,
      posture: 'UNREADABLE',
      unreadable: res.degradedSignals,
      because: `the verdict stands for the screen at ${res.state}, and ${res.degradedSignals
        .join(', ')} could not be read, so no proposal is made on a partial safety picture`,
      wouldAdvanceIf: 'every safety signal reads successfully.',
      explain: `training-safety UNREADABLE · degraded=${res.degradedSignals.join(',')} `
        + `· screen verdict stands at ${res.state}`,
    };
  }

  /* Indexed through a WIDENED view on purpose. The declaration above is
   * `Record<SafetyReason, SafetyTier>`, so a new reason with no rank is a
   * compile error at the table; this read keeps a runtime branch as well,
   * because the compile error is only available to code that recompiles and a
   * persisted verdict row is not. */
  const tier = (TIER_BY_REASON as Partial<Record<string, SafetyTier>>)[res.reason];
  /* Rule 11 again, one layer down. A reason with no tier row is a signal
   * somebody added to the verdict without deciding where it sits in the
   * precedence, and answering NORMAL for it would be the exact defect this
   * whole file exists to close. It refuses instead. */
  if (tier === undefined) {
    return {
      readable: false,
      posture: 'UNREADABLE',
      unreadable: res.driver ? [res.driver] : [],
      because: `the safety verdict named reason "${res.reason}", which has no place in the `
        + 'safety precedence, so this engine cannot tell what it is permitted to do',
      wouldAdvanceIf: 'the reason is given a rank in SAFETY_PRECEDENCE.',
      explain: `training-safety UNREADABLE · unranked reason=${res.reason}`,
    };
  }

  const account = ACCOUNT_BY_TIER[tier];
  return {
    readable: true,
    rank: rankOfTier(tier),
    tier,
    posture: POSTURE_BY_TIER[tier],
    driver: res.driver,
    because: account.because,
    wouldAdvanceIf: account.wouldAdvanceIf,
    explain: `training-safety ${POSTURE_BY_TIER[tier]} · rank=${rankOfTier(tier)} `
      + `· tier=${tier} · ${res.explain}`,
  };
}

/**
 * The posture for "nothing checked".
 *
 * A caller that has no `SafetyResolution` at all has NOT learned that the
 * runner is clear. It has learned that nothing ran, and the honest value for
 * that is `UNREADABLE`. Exported so a caller reaches for this rather than
 * typing `'NORMAL'`, which is the literal `_safety_wired_live.test.ts` bans.
 */
export const TRAINING_SAFETY_NOT_RESOLVED: TrainingSafety = {
  readable: false,
  posture: 'UNREADABLE',
  unreadable: ['injury', 'illness', 'niggle', 'returnToRunning', 'disruption'],
  because: 'no safety resolution was supplied to this evaluation at all',
  wouldAdvanceIf: 'the caller resolves safety before evaluating.',
  explain: 'training-safety UNREADABLE · the resolver did not run for this caller',
};
