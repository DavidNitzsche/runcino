/**
 * lib/brain/objective.ts · THE GOVERNING COACHING OBJECTIVE, stated ONCE and
 * made executable.
 *
 * David, 2026-09-05, after a night that produced correct modules which changed
 * nothing the runner sees:
 *
 *   "Continuously seek the maximum productive training load this runner can
 *    absorb in pursuit of the goal."
 *
 * Every adaptation mechanism answers to this. It is not a comment: the
 * predicates below are called by the option ranking and by the promotion gate,
 * and a decision that cannot satisfy them does not promote.
 *
 * ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
 *
 * The objective was already written in `lib/plan/adjudication/contract.ts`'s
 * header, in `docs/PRODUCT_COACHING_DOCTRINE.md`, and in CLAUDE.md's opening
 * quote. Three statements of one thing, none of which any code could read.
 * CLAUDE.md Rule 20: a product rule with no gate is a hypothesis, and Rule 16:
 * one quantity, one name. This is the one name.
 *
 * ── THE CLAUSE WITH THE MOST TEETH ─────────────────────────────────────────
 *
 * **"A HOLD, regression or refusal requires evidence just as a PUSH does."**
 *
 * That is the clause this codebase has never enforced, and it is the direct
 * cause of the disposition Rule 21 measured: 309 production adaptation intents,
 * zero upward. Every guard in this engine demands evidence to advance and none
 * demands evidence to decline. An adjudicator that returns HOLD when it cannot
 * decide has not been careful, it has picked the option that never has to
 * defend itself.
 *
 * `everyOptionCarriesEvidence` is what makes declining cost something.
 *
 * ── AND THE CLAUSE MOST OFTEN MISREAD ──────────────────────────────────────
 *
 * "Push" is NOT a synonym for more miles or faster paces. David enumerated it:
 * greater duration at the same pace, more specificity, improved density,
 * another running day, a harder long-run structure, or PRESERVING the current
 * load instead of unnecessarily reducing it. `PushKind` is that list, and it
 * exists so a mechanism cannot report "nothing to push" when the only lever it
 * knows about is mileage.
 *
 * The last member is the one to notice. **Declining to cut is a push.** A week
 * held at its authored load when something wanted to shrink it has advanced the
 * objective, and an engine with 117 reducing mechanisms against 37 increasing
 * ones needs that spelled out.
 */
import type { EvidenceClass, Option, OptionAppraisal } from '@/lib/plan/adjudication/contract';

/** The statement itself, so nothing has to paraphrase it. */
export const THE_OBJECTIVE =
  'Continuously seek the maximum productive training load this runner can '
  + 'absorb in pursuit of the goal.';

/**
 * What advancing can MEAN. Enumerated because an engine whose only lever is
 * mileage will report "nothing to push" on a week where five other things could
 * have moved.
 */
export type PushKind =
  /** More miles in the week. */
  | 'VOLUME'
  /** Same pace, longer. Duration before pace, per PROGRESSIVE_BASELINE_DOCTRINE. */
  | 'DURATION'
  /** Faster at the same duration. */
  | 'PACE'
  /** Closer to the race demand: marathon-pace blocks, race-specific structure. */
  | 'SPECIFICITY'
  /** Same work, less recovery between it. */
  | 'DENSITY'
  /** Another running day. */
  | 'FREQUENCY'
  /** A harder long run at the same distance: progression, fast finish, alternating. */
  | 'LONG_RUN_STRUCTURE'
  /**
   * Holding the authored load when something proposed to reduce it.
   *
   * This IS an advance and is counted as one. An engine that only recognises
   * "add something" as pushing will let a plan be whittled down by a series of
   * individually defensible reductions and report that it never pulled back.
   */
  | 'PRESERVATION';

/** Why a mechanism declined to advance. Each requires its own evidence. */
export type DeclineBasis =
  /** Measured: the runner did not absorb what he was already given. */
  | 'ABSORPTION_EVIDENCE'
  /** A doctrine-cited ceiling, named. */
  | 'DOCTRINE_LIMIT'
  /** A prescribed dip: taper, cutback, post-race recovery. */
  | 'PRESCRIBED_RECOVERY'
  /** A safety hard stop. Never overridden by the objective. */
  | 'HARD_STOP'
  /** Rule 11: the read failed or the evidence is absent. An honest refusal. */
  | 'EVIDENCE_ABSENT';

/**
 * The reason a decision declined to advance, and the evidence for it.
 *
 * `because` may not be empty and may not be a restatement of the option. "It is
 * safer" and "to be careful" are not evidence, and `describesEvidence` rejects
 * them by construction rather than by review.
 */
export interface DeclineJustification {
  readonly basis: DeclineBasis;
  readonly because: string;
  /** What would have to be true for this decline to become a push. */
  readonly wouldAdvanceIf: string;
}

/** Phrases that assert caution without asserting a fact. */
const NON_REASONS: readonly string[] = [
  'to be safe', 'to be careful', 'safer', 'more conservative', 'just in case',
  'better safe', 'out of caution', 'seems aggressive', 'looks aggressive',
  'feels like a lot', 'might be too much',
];

/**
 * Does this text describe EVIDENCE, or only a disposition?
 *
 * Deliberately crude and deliberately strict. It cannot tell a true reason from
 * a false one, and does not try: what it catches is the shape of a decline that
 * names no fact, which is the shape that produced 309 intents with zero upward
 * adaptations.
 */
export function describesEvidence(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 12) return false;
  return !NON_REASONS.some((p) => t.includes(p));
}

/**
 * THE CLAUSE WITH TEETH. Every option must carry evidence, including the ones
 * that decline.
 *
 * Returns the options that failed. An empty array is the pass.
 */
export function optionsMissingEvidence(
  options: readonly OptionAppraisal[],
  declines: ReadonlyMap<Option, DeclineJustification>,
): readonly string[] {
  const bad: string[] = [];
  for (const o of options) {
    if (o.option === 'PUSH') continue;
    const j = declines.get(o.option);
    if (j == null) {
      bad.push(`${o.option} declined to advance and carries no justification. `
        + 'The objective requires evidence to decline, not only to push.');
      continue;
    }
    if (!describesEvidence(j.because)) {
      bad.push(`${o.option} justifies itself with "${j.because}", which asserts a `
        + 'disposition rather than a fact. Name what was measured.');
    }
    if (j.wouldAdvanceIf.trim() === '') {
      bad.push(`${o.option} does not say what would change its mind. A decline `
        + 'with no path back to a push is a wall, not a bar.');
    }
  }
  return bad;
}

/**
 * Does the chosen option satisfy the objective, given what the evidence says?
 *
 * The two properties David asked to be proven, stated as one function:
 *
 *   1. A SUPPORTED push defeats an equally coherent hold.
 *   2. An UNSUPPORTED push does not win merely because it is harder.
 *
 * Note what this does NOT do: it does not rank. Ranking lives in
 * `rankOptions`, and this asks the separate question of whether the ranking's
 * winner is defensible against the objective. Rule 16, two questions two names.
 */
export function objectionToChoice(args: {
  readonly chosen: Option;
  readonly pushEvidence: EvidenceClass;
  readonly declines: ReadonlyMap<Option, DeclineJustification>;
}): string | null {
  const { chosen, pushEvidence, declines } = args;

  // 1 · a supported push must not be declined without a reason that outranks it.
  if (chosen !== 'PUSH' && pushEvidence === 'SUPPORTED') {
    const j = declines.get(chosen);
    if (j == null) {
      return 'The push is SUPPORTED by this runner\'s own history and was not taken, '
        + 'with no justification for declining. That is the disposition the objective forbids.';
    }
    if (j.basis === 'HARD_STOP' || j.basis === 'PRESCRIBED_RECOVERY' || j.basis === 'DOCTRINE_LIMIT') {
      return null; // these outrank a supported push, and each names itself
    }
    if (j.basis === 'EVIDENCE_ABSENT') {
      return 'The push is SUPPORTED and was declined for absent evidence. Absent evidence '
        + 'cannot outrank present evidence: that is Rule 11 pointed the wrong way.';
    }
    // ABSORPTION_EVIDENCE outranks a supported push, because it is newer.
    return null;
  }

  // 2 · an unsupported push may not win for being harder.
  if (chosen === 'PUSH' && (pushEvidence === 'CONDITIONAL' || pushEvidence === 'UNKNOWN'
    || pushEvidence === 'CONTRAINDICATED')) {
    return `The push was chosen on ${pushEvidence} evidence. Harder is not better on its own; `
      + 'the objective is the maximum load he can ABSORB, and nothing here says he can.';
  }

  return null;
}

/**
 * A safety hard stop is never overridden by the objective.
 *
 * Stated as its own exported constant so a reader looking for the exception
 * finds it, and so no future mechanism has to rediscover that "always push" has
 * a floor. Suspected bone stress, systemic illness and an escalating pain
 * signal stop running recommendations outright, and no amount of positive
 * capacity evidence outranks them.
 */
export const OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP = true as const;
