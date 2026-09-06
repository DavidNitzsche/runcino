/**
 * lib/coaching-contract/move-readjudication.ts · THE NEUTRAL CONTRACT.
 *
 * ── THE PROBLEM THIS EXISTS TO REMOVE ──────────────────────────────────────
 *
 * `docs/reports/brain-2026-09-05/HANDBACK-ONE-BRAIN.md`, verbatim:
 *
 *     "It does **not** re-adjudicate: `weekly-demand.ts` reaches
 *      `lib/adaptation/**`, a forbidden directory for that surface."
 *
 * That is a true statement about the import graph and it is not an acceptable
 * reason for incomplete coaching. The owner's ruling: **folder ownership cannot
 * justify incomplete coaching.** A runner who moves his Saturday long run onto
 * the Monday two days after a 10K does not care which directory owns which
 * function; he cares that something checked.
 *
 * The forbidden edge is real and it is RIGHT. `lib/plan/_reschedule_not_
 * adaptation.test.ts` stops the rescheduling surface reaching the adaptation
 * engine, because a reschedule that could change TRAINING is the one thing the
 * rescheduling contract forbids. Deleting that gate to get re-adjudication
 * would trade a coaching hole for a safety hole.
 *
 * ── THE RESOLUTION: A THIRD PLACE THAT NEITHER SIDE OWNS ───────────────────
 *
 * This module is that third place. It is a LEAF: it imports nothing, from
 * anywhere, and `_neutral_contract.test.ts` reads its own source and fails if a
 * single import specifier ever appears. That property is what makes it safe for
 * both sides to speak:
 *
 *   · `lib/plan/reschedule.ts` may import it and acquires NO reachability into
 *     `lib/adaptation/**`, because there is nothing here to reach through.
 *   · `lib/brain/orchestration/move-orchestrator.ts` may import it and
 *     IMPLEMENTS it, wiring the real engines behind the port.
 *
 * The dependency is inverted, not laundered. Nothing here is a registry lookup,
 * a string-built specifier or an HTTP round trip — the three evasions the
 * rescheduling gate itself names as things it cannot see. The rescheduling
 * surface still cannot call an adaptation module; it can only ACCEPT a report
 * that one produced, as plain data, from a caller above it.
 *
 * ── WHY THE REPORT IS A TOTAL RECORD AND NOT A LIST ────────────────────────
 *
 * `ReadjudicationReport.checks` is a `Record<ReadjudicationCheck, CheckOutcome>`
 * over a closed union, so a report that forgot to answer one of the nine checks
 * DOES NOT COMPILE. That is deliberate and it is the strongest enforcement
 * available, in the pattern `NormalReading<T>` set for Rule 8: a discipline that
 * lives in the type is not a discipline anyone can forget.
 *
 * And every outcome has THREE states, per Rule 11. "The spacing check found
 * nothing", "the spacing check did not apply here" and "the spacing check could
 * not run" are three different facts, and a re-adjudication that collapses them
 * would report a clean move over a check that never happened. `verdictOf`
 * therefore cannot return CLEAR while any check refused: it returns INCOMPLETE.
 * A silent skip is exactly how "wired, tested and inert" happens.
 *
 * ── RULE 22 · WHAT THIS CONTRACT CANNOT DO ─────────────────────────────────
 *
 * · It cannot check anything. It is types and four total functions over them.
 *   Every actual reading is the orchestrator's, and a report can be fabricated
 *   by any caller willing to lie about what it ran.
 * · It cannot stop a mover that never asks for a report. Nothing here is
 *   reachable from a route that does not import it; the gate that catches that
 *   is `_move_readjudication.test.ts`'s mover census, not this file.
 * · It cannot tell a check that ran and found nothing from a check that ran
 *   badly. `state: 'ran'` with no findings is a claim by the implementation.
 * · It has no opinion on whether the nine checks are the RIGHT nine. They are
 *   the owner's list, transcribed; adding a tenth is a change here and a
 *   compile error everywhere that builds a report, which is the intended cost.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * THE MOVE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A move as PROPOSED, before anything is written.
 *
 * Deliberately carries the row id AND both dates. A move identified only by
 * dates cannot name which session moved on a day that carries two, and a move
 * identified only by a row id cannot say where it came from once it has moved
 * — which is the difference between a report and an audit trail.
 */
export interface ProposedMove {
  readonly planWorkoutId: string;
  readonly fromISO: string;
  readonly toISO: string;
  /** The option the runner is looking at, when the move came from a ranked set. */
  readonly optionId: string | null;
}

/**
 * The two calendar weeks a move touches, by their Monday.
 *
 * Both, always, even when they are the same week — an in-week move still has to
 * re-price the week it happened in, and a caller that reported one week for an
 * in-week move and two for a cross-week move would make "how many weeks were
 * recalculated" a question about the move rather than about the check.
 */
export interface AffectedWeeks {
  readonly fromWeekStartISO: string;
  readonly toWeekStartISO: string;
  /** True when the move crosses a week boundary. Derived, never passed. */
  readonly crossesWeekBoundary: boolean;
}

export function affectedWeeks(fromWeekStartISO: string, toWeekStartISO: string): AffectedWeeks {
  return {
    fromWeekStartISO,
    toWeekStartISO,
    crossesWeekBoundary: fromWeekStartISO !== toWeekStartISO,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE NINE CHECKS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every question a proposed move must be re-asked. The owner's list, in his
 * order, one member per requirement.
 *
 * A closed union rather than a string, so `ReadjudicationReport.checks` is total
 * over it and a forgotten check is a type error rather than an absence nobody
 * notices.
 */
export type ReadjudicationCheck =
  /** Recalculate BOTH affected weeks. */
  | 'BOTH_WEEKS'
  /** Recalculate demand — what the week costs, not how many hard days it has. */
  | 'DEMAND'
  /** Recheck hard-session spacing. */
  | 'HARD_SESSION_SPACING'
  /** Recheck long-run placement. */
  | 'LONG_RUN_PLACEMENT'
  /** Recheck race, recovery and taper proximity. */
  | 'RACE_RECOVERY_TAPER_PROXIMITY'
  /** Reevaluate conditional doses. */
  | 'CONDITIONAL_DOSES'
  /** Reevaluate scheduled gates. */
  | 'SCHEDULED_GATES'
  /** Reevaluate deferrals. */
  | 'DEFERRALS'
  /** Detect conflicts the move creates that no single check above owns. */
  | 'CONFLICTS';

export const READJUDICATION_CHECKS: readonly ReadjudicationCheck[] = [
  'BOTH_WEEKS',
  'DEMAND',
  'HARD_SESSION_SPACING',
  'LONG_RUN_PLACEMENT',
  'RACE_RECOVERY_TAPER_PROXIMITY',
  'CONDITIONAL_DOSES',
  'SCHEDULED_GATES',
  'DEFERRALS',
  'CONFLICTS',
];

/* ══════════════════════════════════════════════════════════════════════════
 * FINDINGS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * How much a finding weighs.
 *
 * Rule 9 · a REFUSES finding rests only on a DISCRETE honest fact — the day is
 * a race, the destination sits inside a no-quality window a race already owes,
 * the move puts two hard sessions on consecutive days. A continuous quantity
 * (a demand step, a rolling-7 change, a dosing share) enters as COSTS and can
 * change a RANK; it may never change whether an option EXISTS. The contract
 * states that here because it is the property the whole ranking depends on and
 * an implementation that quietly thresholded a continuous quantity into a
 * refusal would look identical from outside.
 */
export type FindingSeverity =
  /** The move must not happen as proposed. Discrete facts only. */
  | 'REFUSES'
  /** The move is legal and costs something the runner is entitled to read. */
  | 'COSTS'
  /** Worth saying, changes nothing. */
  | 'NOTES';

export interface ReadjudicationFinding {
  readonly check: ReadjudicationCheck;
  readonly severity: FindingSeverity;
  /** One clause, coach voice. What the runner reads. */
  readonly what: string;
  /** The day the finding is about, when it has one. */
  readonly onISO: string | null;
  /**
   * The continuous quantity behind a COSTS finding, when there is one, so a
   * rank can be argued with rather than trusted. Null on a discrete refusal.
   */
  readonly magnitude: number | null;
  /** Doctrine, a research file, or the owning module. Never empty. */
  readonly citation: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * OUTCOMES · RULE 11, IN THE TYPE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * What one check did. Three states, because there are three facts.
 *
 * The refusal branch carries no `findings` field at all, so a caller that reads
 * `outcome.findings` without branching does not compile — the same shape
 * `NormalReading<T>` uses to make Rule 11 a type error instead of a habit.
 */
export type CheckOutcome =
  /** It ran. `findings` may be empty, and an empty list is a real answer. */
  | { readonly state: 'ran'; readonly findings: readonly ReadjudicationFinding[]; readonly read: string }
  /** It ran and there was nothing here to check. Not the same as clean. */
  | { readonly state: 'not_applicable'; readonly why: string }
  /**
   * It could NOT run. A missing table, a failed read, an absent input.
   * This is the state that must never be silently collapsed into "clean",
   * and `verdictOf` is what enforces that.
   */
  | { readonly state: 'refused'; readonly why: string };

/** Findings of a check, or none when it did not run. Total, so callers cannot forget. */
export function findingsOf(o: CheckOutcome): readonly ReadjudicationFinding[] {
  return o.state === 'ran' ? o.findings : [];
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE REPORT
 * ═══════════════════════════════════════════════════════════════════════ */

export type ReadjudicationVerdict =
  /** Every check ran and nothing objected. */
  | 'CLEAR'
  /** Every check ran; the move is legal and costs something stated. */
  | 'COSTED'
  /** At least one check refuses the move on a discrete fact. */
  | 'REFUSED'
  /**
   * At least one check could not run, and nothing refused. NEVER reported as
   * CLEAR. A move waved through by a check that never happened is exactly the
   * failure Rule 11 and Rule 18 both exist to stop.
   */
  | 'INCOMPLETE';

/** A date the coach would rather he used, and the reason in one clause. */
export interface BetterDate {
  readonly dateISO: string;
  readonly why: string;
  /**
   * What the proposed date scored against what this one scores, on the mover's
   * own cost scale. Lower is better. Reported so the recommendation can be
   * argued with rather than trusted.
   */
  readonly proposedCost: number;
  readonly recommendedCost: number;
}

export interface ReadjudicationReport {
  readonly move: ProposedMove;
  readonly weeks: AffectedWeeks;
  /** Total over the nine. A forgotten check does not compile. */
  readonly checks: Readonly<Record<ReadjudicationCheck, CheckOutcome>>;
  /**
   * Set when the coach can name a date that costs less. Null when the proposed
   * date is already the best available, and null is a real answer — a
   * recommendation invented to look helpful is worse than none.
   */
  readonly betterDate: BetterDate | null;
  /** The plan the report was read against, so an apply names the same one. */
  readonly planId: string;
  readonly planVersion: string;
  /** Runner-local day the report was produced for. Never a clock. */
  readonly asOfISO: string;
}

/**
 * The verdict, DERIVED from the checks and never passed in.
 *
 * A caller that could label its own verdict would eventually label an
 * incomplete re-adjudication CLEAR, which is the whole failure this guards.
 * Same argument `adaptation-log.ts` gives for deriving direction from the
 * action rather than accepting it.
 *
 * Precedence: a refusal outranks an incomplete read, because the move is
 * blocked either way and the runner needs the reason that blocks it.
 */
export function verdictOf(report: ReadjudicationReport): ReadjudicationVerdict {
  let refusedToRun = false;
  let costed = false;
  for (const check of READJUDICATION_CHECKS) {
    const o = report.checks[check];
    if (o.state === 'refused') { refusedToRun = true; continue; }
    if (o.state !== 'ran') continue;
    for (const f of o.findings) {
      if (f.severity === 'REFUSES') return 'REFUSED';
      if (f.severity === 'COSTS') costed = true;
    }
  }
  if (refusedToRun) return 'INCOMPLETE';
  return costed ? 'COSTED' : 'CLEAR';
}

/** Every finding, in check order. One flattening, so no surface re-rolls it. */
export function allFindings(report: ReadjudicationReport): readonly ReadjudicationFinding[] {
  const out: ReadjudicationFinding[] = [];
  for (const check of READJUDICATION_CHECKS) out.push(...findingsOf(report.checks[check]));
  return out;
}

/**
 * The checks that could not run, by name.
 *
 * Exported so a surface can PRINT them. An INCOMPLETE verdict whose reason the
 * runner cannot see is a refusal he has no way to act on, and Rule 11's whole
 * point is that the distinction reaches the person who needs it.
 */
export function checksThatCouldNotRun(
  report: ReadjudicationReport,
): readonly { readonly check: ReadjudicationCheck; readonly why: string }[] {
  const out: { check: ReadjudicationCheck; why: string }[] = [];
  for (const check of READJUDICATION_CHECKS) {
    const o = report.checks[check];
    if (o.state === 'refused') out.push({ check, why: o.why });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE PORT
 * ═══════════════════════════════════════════════════════════════════════ */

export interface ReadjudicationRequest {
  readonly userUuid: string;
  /** Runner-local today, passed in. This layer never reads a clock. */
  readonly todayISO: string;
  readonly move: ProposedMove;
  /**
   * The runner's stated availability, exactly as it was put to the mover's own
   * decision engine — never re-derived, never assumed. Omitted, or both
   * empty, means UNKNOWN.
   *
   * MOVEREADJUDICATE-2 (2026-09-05): before this field existed, the
   * implementation invented its own constraint (`UNAVAILABLE_DATES` on the
   * session's own day, always) rather than asking the caller. Verified live
   * against the owner's real block: `GET /api/plan/move?from=2026-09-06
   * &to=2026-09-16` ranked 2026-09-16 as option 1 in `recommendation.options`
   * — the exact date the runner is looking at, on the exact same request — and
   * the SAME response's `readjudication.findings` refused it with "2026-09-16
   * is not among the dates the coach can offer for this session, and no
   * reason was recorded for it." Two answers to one question, Rule 16, caught
   * by Rule 13 (rendering the real reschedule sheet against a scratch copy of
   * the owner's block, not a fixture). The invented constraint and the real
   * one searched different candidate sets, so a date the runner was shown and
   * chose came back refused for a reason that never existed. This field is
   * the fix: a caller that HOLDS the real constraint threads it through
   * instead of the port inventing one.
   */
  readonly unavailableDates?: readonly string[];
  readonly availableDates?: readonly string[];
}

/**
 * What an implementation of re-adjudication looks like from the outside.
 *
 * `lib/plan/reschedule.ts` can hold one of these WITHOUT importing anything
 * that can adapt training, because this is a function type and function types
 * carry no code. That is the inversion, and it is the entire mechanism by which
 * folder ownership stops being an argument about coaching completeness.
 */
export type Readjudicator = (req: ReadjudicationRequest) => Promise<ReadjudicationReport>;

/**
 * The report a mover produces when no re-adjudicator was supplied.
 *
 * Rule 11, applied to the wiring itself: a move that ran with no adjudicator
 * attached must say so in the same shape as a move whose checks broke, so a
 * consumer cannot tell "clean" from "nobody looked" by accident. Every one of
 * the nine refuses with the same sentence, so `verdictOf` returns INCOMPLETE
 * and nothing downstream can read this as approval.
 */
export function noAdjudicatorReport(
  move: ProposedMove,
  weeks: AffectedWeeks,
  planId: string,
  planVersion: string,
  asOfISO: string,
  why: string,
): ReadjudicationReport {
  const refusal: CheckOutcome = { state: 'refused', why };
  const checks = {} as Record<ReadjudicationCheck, CheckOutcome>;
  for (const c of READJUDICATION_CHECKS) checks[c] = refusal;
  return { move, weeks, checks, betterDate: null, planId, planVersion, asOfISO };
}
