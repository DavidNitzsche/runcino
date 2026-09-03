/**
 * lib/adaptation/canonical/levers/shared.ts · WHAT EVERY LEVER RETURNS.
 *
 * A lever answers one question about one quantity and says nothing about the
 * plan as a whole. Turning a verdict into a plan change, checking it against
 * the other levers, and writing the decision record are all the evaluator's
 * job, not the lever's. That split is what makes the contract's arbitration
 * possible: `docs/ADAPTATION_ENGINE_CONTRACT.md` requires evidence to be
 * "evaluated separately by lever" while mutations are arbitrated together, and
 * a lever that already knew about the week's total demand could not be said to
 * have reached its verdict independently.
 *
 * ── THE SIGNATURE RULE, WHICH IS A GATE AND NOT A CONVENTION ───────────────
 *
 * No function in this directory takes a `GoalRequirement`, and
 * `_forbidden_inputs.test.ts` asserts it by reading these files. The goal is a
 * legitimate input to the RECORD, which must state the requirement and the gap.
 * It is never an input to a VERDICT, because
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` requires goal data to
 * be "physically excluded from capacity resolvers' inputs, not just
 * conventionally kept separate", and a lever that cannot receive the goal
 * cannot be talked into pricing capacity off it.
 */
import type {
  ConfidenceStatement,
  ContradictoryEvidence,
  ExcludedEvidence,
  IncludedEvidence,
  Magnitude,
  CanonicalDecision,
} from '../decision-record';
import type { CanonicalLever } from '../input';
import { COMPLETION_FRACTION_EPSILON } from '../contract-constants';
import { fmtMi, fmtPaceSlash } from '@/lib/format/run';

/**
 * "Completed at or above the bar", with Rule 9's representation tolerance.
 *
 * ONE definition, because a bar compared four different ways in three files is
 * four opinions about one number (Rule 16). See
 * `COMPLETION_FRACTION_EPSILON` for why a bare `>=` is a cliff and why this is
 * not a widened threshold.
 */
export const meetsCompletionBar = (observed: number, bar: number): boolean =>
  observed >= bar - COMPLETION_FRACTION_EPSILON;

export interface LeverVerdict {
  readonly lever: CanonicalLever;
  readonly decision: CanonicalDecision;
  readonly beforeValue: number;
  /** Null unless the decision proposes a new value. */
  readonly proposedAfterValue: number | null;
  readonly magnitude: Magnitude | null;
  readonly included: readonly IncludedEvidence[];
  readonly excluded: readonly ExcludedEvidence[];
  readonly contradictory: readonly ContradictoryEvidence[];
  readonly windowDays: number;
  readonly confidence: ConfidenceStatement;
  /** Coach voice. No em dash, no exclamation mark, no scolding. */
  readonly reason: string;
  /** Contract · what future evidence could change this decision. */
  readonly whatWouldChangeIt: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * FORMATTING  ·  one way to write a run down
 *
 * Every number this engine puts in front of a runner goes through
 * `lib/format/run.ts`, which is the codebase's single owner of how a distance,
 * a pace and a clock are written. The first draft of these levers hand-rolled
 * `Math.round(x * 10) / 10` and its own `m:ss` builder in four files, and
 * `_format_lint.test.ts` caught all four. That gate is right and the reason it
 * exists is Rule 16: a surface that rounds its own copy is how the poster and
 * the recap came apart.
 * ═══════════════════════════════════════════════════════════════════════ */

/** A distance for coach prose: "16 mi", "47.2 mi". */
export const miText = (n: number): string => fmtMi(n) ?? 'no distance';

/** A pace for coach prose: "7:10/mi". */
export const paceText = (secPerMi: number): string => fmtPaceSlash(secPerMi) ?? 'no pace';

/** Whole days between two ISO dates, positive when `then` is before `now`. */
export function daysBetween(nowISO: string, thenISO: string): number {
  const ms = Date.parse(nowISO) - Date.parse(thenISO);
  return Math.floor(ms / 86_400_000);
}

/**
 * Build the confidence statement Q39 requires.
 *
 * The raw number is deliberately the LAST field and is documented as auditable
 * detail. Q39's rule is that uncertainty reaches the runner as a range, an
 * evidence count, a plain limitation and a path to something stronger, and that
 * raw values "must not lead the runner-facing experience".
 *
 * The arithmetic is intentionally dull: supporting observations against
 * supporting plus contradicting, with no free parameters. A weighting scheme
 * here would be a second opinion about evidence strength, which the Runner
 * Model owns.
 */
export function confidenceFrom(args: {
  supportingCount: number;
  contradictingCount: number;
  windowDays: number;
  sentence: string;
  limitation?: string | null;
}): ConfidenceStatement {
  const total = args.supportingCount + args.contradictingCount;
  const raw = total === 0 ? 0 : args.supportingCount / total;
  return {
    supportingCount: args.supportingCount,
    contradictingCount: args.contradictingCount,
    windowDays: args.windowDays,
    sentence: args.sentence,
    limitation: args.limitation ?? null,
    rawConfidence: raw,
  };
}

/** A verdict that moves nothing, for the many paths that legitimately do not. */
export function nonMoving(args: {
  lever: CanonicalLever;
  decision: Extract<CanonicalDecision, 'HOLD' | 'REFUSE'>;
  beforeValue: number;
  included?: readonly IncludedEvidence[];
  excluded?: readonly ExcludedEvidence[];
  contradictory?: readonly ContradictoryEvidence[];
  windowDays: number;
  confidence: ConfidenceStatement;
  reason: string;
  whatWouldChangeIt: readonly string[];
}): LeverVerdict {
  return {
    lever: args.lever,
    decision: args.decision,
    beforeValue: args.beforeValue,
    proposedAfterValue: null,
    magnitude: null,
    included: args.included ?? [],
    excluded: args.excluded ?? [],
    contradictory: args.contradictory ?? [],
    windowDays: args.windowDays,
    confidence: args.confidence,
    reason: args.reason,
    whatWouldChangeIt: args.whatWouldChangeIt,
  };
}
