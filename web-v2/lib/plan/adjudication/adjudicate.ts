/**
 * lib/plan/adjudication/adjudicate.ts · the adjudicator itself.
 *
 * Pure functions over already-loaded facts. It opens no database and reads no
 * plan: a caller hands it the runner's demonstrated history and the block's
 * weeks, and it returns traces plus a promotion verdict. That is deliberate,
 * because the layer has to be testable against constructed sequences and a
 * function that fetches cannot be.
 *
 * See `contract.ts` for why this exists and what it optimises for. The one
 * sentence worth repeating here: **the target is the maximum productive load
 * this runner can ABSORB, and the default is to advance.**
 *
 * ── RULE 22 · WHAT THIS FILE'S GATES CANNOT FAIL ON ────────────────────────
 *
 * They cannot fail on the STEP BANDS being set wrong. `STEP_SUPPORTED_MAX` and
 * `STEP_ALLOWED_MAX` are reading rules for the word "comparable", not
 * physiology, and every test here constructs cases clearly inside or clearly
 * outside them. Moving either band by a few points would pass this whole suite
 * while changing which prescriptions reach a runner. The same is true of
 * `MIN_COMPARABLES_FOR_CEILING_CLAIM`.
 *
 * The four dimensions added on 2026-09-04 (CORPUS-ADJ-1) carry their own
 * blindness, stated rather than implied:
 *
 *   · `earningGateTiming` cannot tell whether the REQUIREMENT is the right
 *     requirement. It checks that the gate is assessed early enough to act and
 *     does not ask about a week that has not run. A gate demanding something
 *     trivially true, on a sane schedule, passes it.
 *   · `executionIdentity` only knows the identities the caller declared. It
 *     reads `PlannedWeek.isRaceWeek`; a race week mislabelled as an ordinary
 *     one is invisible here and belongs to whatever builds the weeks.
 *   · `evidenceProvenance` checks the VOICE, never the number. A fabricated
 *     measurement carrying `ATHLETE_EVIDENCE` and a plausible basis string
 *     passes every clause. `_cim_trace.test.ts` pins the population; nothing
 *     here can.
 *   · `stackedStress` cannot fail on `STACKED_STRESSOR_THRESHOLD` being wrong,
 *     for the same reason the step bands above are unfailable.
 *
 * And with ZERO traces, six of the ten dimensions are vacuously true — there is
 * no violation in an empty set. Promotion is still blocked, by
 * `wholeBlockCoherence`'s "nothing was adjudicated at all", which is the
 * dimension that owns the silent zero.
 *
 * They also cannot tell whether the HISTORY handed in is the right population.
 * The first CIM trace was wrong for exactly that reason and every test here
 * passed on it: the fixture said his longest run was 18.0 when it was 21.51,
 * and a fixture agreeing with itself is Rule 18's warning verbatim. The
 * population is the caller's problem, and `_cim_trace.test.ts` pins it against
 * the queried production numbers so a regression there is visible.
 */
import type {
  AthleteEvidence, Attributed, CeilingClaim, ComparableSession, DecisionTrace,
  DoctrineCitation, DoctrineConflict, EarningGate, EarningRequirement,
  EvidenceClass, Option, OptionAppraisal, PlanAdjudication, PromotionCheck,
  StackedStress,
} from './contract';
import { MIN_COMPARABLES_FOR_CEILING_CLAIM, PROMOTION_DIMENSIONS } from './contract';

/** What the runner has actually done, in the units decisions are made in. */
export interface DemonstratedHistory {
  /** Highest completed week, miles. */
  readonly peakWeeklyMi: number | null;
  /** Longest completed single run, miles. */
  readonly longestRunMi: number | null;
  /** Largest marathon-pace dose he has COMPLETED inside a long run, miles. */
  readonly maxCompletedMpMi: number | null;
  /** Most stressors he has carried in one completed week. */
  readonly maxStressorsInAWeek: number | null;
  /** Comparable sessions, with what the following 7 days looked like. */
  readonly after: readonly ComparableSession[];
  /**
   * The window these numbers were read over, stated so a reader can see it.
   * The first version of this layer was wrong precisely because a caller reused
   * a 90-day window to answer a whole-year question (Rule 14).
   */
  readonly windowDescribed: string;
}

export interface PlannedWeek {
  readonly weekStartISO: string;
  readonly weeklyMi: number;
  readonly longestMi: number;
  /** Named stressors: 'threshold', 'intervals', 'fast-finish long', 'race'. */
  readonly stressors: readonly string[];
  /** Marathon-pace miles prescribed in this week, if any. */
  readonly mpMi: number;
  readonly isTaper: boolean;
  readonly isRaceWeek: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · ATHLETE EVIDENCE  ·  supported-for-him vs permitted-by-a-table
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * How far a prescription steps past what he has demonstrated, and what that
 * makes it.
 *
 * The bands are not physiology and are not cited as such. They are a reading
 * rule for the word "comparable", and they carry POLICY_ASSUMPTION provenance
 * wherever they are reported.
 */
export const STEP_SUPPORTED_MAX = 0.10;   // +10% · inside ordinary progression
export const STEP_ALLOWED_MAX = 0.25;     // +25% · a real reach, not yet earned

/**
 * A correction to the paragraph above, found while checking my own constants
 * against the source rather than against my memory of it.
 *
 * For a LONG RUN, +10% is doctrine and is strong: `Research/00a` §"Practical
 * load rules" caps a single long run at 110% of the longest run in the prior 30
 * days, and §"The 10% rule reconsidered" prices the breach at a 64% rise in
 * overuse-injury risk from a 5,200-runner cohort. That band is
 * CALCULATED_PHYSIOLOGY and `LONGRUN.wow-single-step-cap-is-the-injury-red-line`
 * already binds it in CI.
 *
 * For WEEKLY VOLUME, +10% is NOT doctrine, and doctrine says so explicitly. The
 * same section is titled "The 10% rule reconsidered" and its findings are that
 * novices at +24% over 8 weeks showed no higher injury rate than +10% over 12,
 * and that "weekly mileage change correlated weakly with injury". So a 10%
 * weekly-volume band is a POLICY_ASSUMPTION wearing a research number's
 * clothes, and reading it as a limit makes this layer more restrictive than the
 * evidence warrants, which is Rule 22 pointed at my own constant.
 *
 * The band stays where it is, because it is doing a different job here: it is a
 * reading rule for how far past demonstrated capacity counts as "comparable",
 * not an injury threshold. What changes is that it is labelled honestly, and
 * that the real cited constraint on a week which adds volume is the
 * one-stressor-at-a-time rule below, which actually bites.
 */
export const VOLUME_BAND_IS_POLICY_NOT_THE_TEN_PERCENT_RULE =
  'Research/00a §"The 10% rule reconsidered" declines to support a 10% weekly cap. '
  + 'This band classifies comparability, it does not assert an injury threshold.';

export function classifyStep(
  prescribed: number | null,
  demonstratedMax: number | null,
): { readonly cls: EvidenceClass; readonly step: number | null } {
  if (prescribed == null || demonstratedMax == null || demonstratedMax <= 0) {
    return { cls: 'UNKNOWN', step: null };
  }
  const step = prescribed / demonstratedMax - 1;
  if (step <= STEP_SUPPORTED_MAX) return { cls: 'SUPPORTED', step };
  if (step <= STEP_ALLOWED_MAX) return { cls: 'ALLOWED', step };
  return { cls: 'CONDITIONAL', step };
}

/**
 * Read a capacity CEILING off a set of comparables, or refuse to.
 *
 * Defect 2 of David's list, in his words: "That is one comparison, not a
 * demonstrated capacity limit."
 *
 * Two failures are guarded here, and the first one actually happened. The first
 * CIM trace observed that he ran 11.01 miles seven days after one half marathon
 * and concluded that a 16-mile run at that offset was unsupported. The set was
 * {21.51, 17.21, 11.01} and the trace picked the MINIMUM. So:
 *
 *   1 · a ceiling is the MAXIMUM of the comparables, never a member of the set
 *       chosen for being small, and
 *   2 · below `MIN_COMPARABLES_FOR_CEILING_CLAIM` there is no ceiling claim at
 *       all, only an observation.
 */
export function ceilingClaimFrom(
  comparables: readonly ComparableSession[],
  quantity: (c: ComparableSession) => number | null,
): CeilingClaim | null {
  const values = comparables.map(quantity).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  const max = Math.max(...values);
  const valid = values.length >= MIN_COMPARABLES_FOR_CEILING_CLAIM;
  return {
    value: max,
    comparableCount: values.length,
    valid,
    why: valid
      ? `${values.length} comparable sessions, the largest being ${max}. That is enough to describe a limit.`
      : `${values.length} comparable session${values.length === 1 ? '' : 's'} `
        + `(${values.join(', ')}). Fewer than ${MIN_COMPARABLES_FOR_CEILING_CLAIM}, so this is an `
        + 'observation and not a demonstrated capacity limit. It may not be used to refuse anything.',
  };
}

export interface AthleteEvidenceArgs {
  readonly what: string;
  readonly asOfISO: string;
  readonly prescribed: number | null;
  /** Demonstrated maximum from COMPLETED training, as of today. */
  readonly demonstratedMaxToday: number | null;
  /** What the plan builds him to before `asOfISO`, if he executes it. */
  readonly demonstratedMaxProjected: number | null;
  readonly comparables: readonly ComparableSession[];
  /** Set when this evidence might be used to REFUSE, so a ceiling is claimed. */
  readonly ceilingQuantity?: (c: ComparableSession) => number | null;
  readonly historyWindow: string;
}

/**
 * The athlete-specific case for or against one prescription, AT A DATE.
 *
 * Defect 1 of David's list: "Do not treat my current historical ceiling as a
 * permanent future ceiling. October and November workouts must be evaluated
 * against the training accumulated by then."
 *
 * So the classification is taken against the PROJECTED maximum where one
 * exists, and the today-relative step is reported alongside it rather than
 * instead of it. A prescription that is a reach today but an ordinary step
 * against the body the plan builds by then is CONDITIONAL, not refused, and it
 * leaves here carrying the evidence a caller needs to write its earning gate.
 */
export function athleteEvidenceFor(args: AthleteEvidenceArgs): AthleteEvidence {
  const {
    what, asOfISO, prescribed, demonstratedMaxToday, demonstratedMaxProjected,
    comparables, ceilingQuantity, historyWindow,
  } = args;

  const today = classifyStep(prescribed, demonstratedMaxToday);
  const projected = classifyStep(prescribed, demonstratedMaxProjected);

  // The honest class for a future date is the projected one when a projection
  // exists. Where it does not, fall back to today and say so.
  const usingProjection = demonstratedMaxProjected != null;
  const cls: EvidenceClass = usingProjection ? projected.cls : today.cls;

  const ceilingClaim = ceilingQuantity ? ceilingClaimFrom(comparables, ceilingQuantity) : null;

  // Defect 2 enforced rather than documented: an invalid ceiling claim may not
  // produce a CONTRAINDICATED verdict.
  const finalCls: EvidenceClass =
    cls === 'CONTRAINDICATED' && (ceilingClaim === null || !ceilingClaim.valid) ? 'UNKNOWN' : cls;

  const pctToday = today.step == null ? null : Math.round(today.step * 1000) / 10;
  const pctProj = projected.step == null ? null : Math.round(projected.step * 1000) / 10;

  const why = finalCls === 'UNKNOWN'
    ? `Nothing comparable in his history to size ${what} against, over ${historyWindow}. `
      + 'That is an absence, not a pass.'
    : usingProjection
      ? `${what} is ${fmtPct(pctProj)} on the ${demonstratedMaxProjected} the plan builds him to by `
        + `${asOfISO}, and ${fmtPct(pctToday)} on the ${demonstratedMaxToday} he has demonstrated today. `
        + 'The first number is the one that governs, because the second describes a runner who will '
        + 'not be the one doing this session.'
      : `${what} is ${fmtPct(pctToday)} on his demonstrated ${demonstratedMaxToday}, over `
        + `${historyWindow}. No projection was available, so this is judged against today.`;

  return {
    evidenceClass: finalCls,
    comparables,
    asOfISO,
    demonstratedMaxToday: {
      value: demonstratedMaxToday,
      provenance: 'ATHLETE_EVIDENCE',
      basis: `Completed training, ${historyWindow}.`,
    },
    demonstratedMaxProjected: {
      value: demonstratedMaxProjected,
      provenance: 'POLICY_ASSUMPTION',
      basis: demonstratedMaxProjected == null
        ? 'No projection: the plan before this date does not build toward this quantity.'
        : `Assumes the plan up to ${asOfISO} is executed. It is an assumption about the future, `
          + 'not a measurement, and the earning gate on this decision is what checks it.',
    },
    prescribed,
    stepOverDemonstratedToday: today.step,
    stepOverProjected: projected.step,
    ceilingClaim,
    why,
  };
}

function fmtPct(pct: number | null): string {
  if (pct == null) return 'an unknown step';
  if (pct <= 0) return `${pct === 0 ? 'level with' : `${-pct}% under`}`;
  return `plus ${pct}%`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · EARNING GATES  ·  a CONDITIONAL can be earned, defect 6
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * David: "A 60-mile week or 10-mile MP dose should be allowed to become
 * supported through successful September and October training rather than being
 * permanently accepted or rejected today."
 *
 * A CONDITIONAL prescription therefore leaves this layer with a gate attached:
 * what would earn it, when that is checked, and what happens if it is not met.
 * Neither waving it through nor deleting it is an answer.
 */
export function earningGateFor(args: {
  readonly decisionId: string;
  readonly what: string;
  readonly prescribed: number;
  readonly demonstratedMaxToday: number | null;
  readonly assessOnISO: string;
  readonly requires: readonly EarningRequirement[];
  readonly ifUnmet: 'DEFER' | 'REDUCE' | 'DROP';
  readonly reduceTo: number | null;
}): EarningGate {
  const { decisionId, what, prescribed, demonstratedMaxToday, assessOnISO, requires, ifUnmet, reduceTo } = args;
  const unmet = ifUnmet === 'REDUCE' && reduceTo != null
    ? `it is reduced to ${reduceTo}`
    : ifUnmet === 'DEFER'
      ? 'it is deferred to the next boundary and stays queued'
      : 'it is dropped from the block';
  return {
    gateId: `earn:${decisionId}`,
    forDecisionId: decisionId,
    requires,
    assessOnISO,
    ifUnmet,
    reduceTo,
    explain: `${what} at ${prescribed} is not supported by the ${demonstratedMaxToday ?? 'unknown'} he `
      + `has demonstrated today. It becomes supported if, by ${assessOnISO}, `
      + `${requires.map((r) => r.what).join(' and ')}. If that has not happened, ${unmet}.`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · STACKED STRESS  ·  what the components cost TOGETHER
 * ═══════════════════════════════════════════════════════════════════════ */

/** More than this many named stressors in one week is stacking worth costing. */
export const STACKED_STRESSOR_THRESHOLD = 2;

export function detectStackedStress(
  week: PlannedWeek,
  hist: DemonstratedHistory,
): StackedStress | null {
  const volStep = week.weeklyMi != null && hist.peakWeeklyMi
    ? week.weeklyMi / hist.peakWeeklyMi - 1 : null;
  /**
   * EXECUTION IDENTITY (CORPUS-ADJ-1, 2026-09-04) · THE GOAL RACE IS NOT A
   * TRAINING LONG RUN.
   *
   * `week.longestMi` on a race week is the RACE. Dividing 26.2 by an 18-mile
   * demonstrated longest training run reads +46% and flags the goal race
   * itself as an injury-grade long-run spike, in every marathon block ever
   * authored. It is the same shape as Rule 16's watch defect — one quantity
   * wearing two identities — and it is worse than noise, because the honest
   * verdict on "should he run the race he entered" is not a doctrine question
   * this layer gets to ask.
   *
   * `hist.longestRunMi` is symmetric about this: the corpus bridge and
   * `_cim_trace.test.ts` both read it from COMPLETED TRAINING only, never from
   * a race, so neither side of the comparison carries a race.
   *
   * Volume is deliberately still compared. A race week's total mileage is a
   * real week of load the legs absorb, and Rule 8's corollary keeps an
   * absorbed-load reader on the literal number.
   */
  const longStep = week.isRaceWeek ? null
    : week.longestMi != null && hist.longestRunMi
      ? week.longestMi / hist.longestRunMi - 1 : null;

  const overStressed = week.stressors.length > STACKED_STRESSOR_THRESHOLD
    || (hist.maxStressorsInAWeek != null && week.stressors.length > hist.maxStressorsInAWeek);
  const volReach = volStep != null && volStep > STEP_ALLOWED_MAX;
  const longReach = longStep != null && longStep > STEP_SUPPORTED_MAX;

  if (!overStressed && !volReach && !longReach) return null;

  // THE ONE THAT MATTERS MOST. Any single reach is a normal training decision.
  // All three at once is the week nothing in this repository was checking.
  const simultaneousPeak = overStressed && volReach && longReach;

  const parts: string[] = [];
  if (overStressed) {
    parts.push(`${week.stressors.length} stressors (${week.stressors.join(', ')})`
      + (hist.maxStressorsInAWeek != null ? ` against a demonstrated ${hist.maxStressorsInAWeek}` : ''));
  }
  if (volStep != null) parts.push(`${week.weeklyMi} mi is ${volStep > 0 ? '+' : ''}${Math.round(volStep * 1000) / 10}% on his peak week`);
  if (longStep != null) parts.push(`the long run is ${longStep > 0 ? '+' : ''}${Math.round(longStep * 1000) / 10}% on his longest`);

  return {
    weekStartISO: week.weekStartISO,
    stressors: week.stressors,
    weeklyMi: week.weeklyMi,
    longestMi: week.longestMi,
    volumeOverDemonstratedMax: volStep,
    longRunOverDemonstratedMax: longStep,
    simultaneousPeak,
    why: (simultaneousPeak
      ? 'Volume, longest run AND stressor count all peak in the same week. '
      : '') + parts.join('; ') + '.',
  };
}

/**
 * ONE STRESSOR AT A TIME.
 *
 *   "Add stress one-at-a-time · Either add mileage OR add intensity in a given
 *    week, not both."      — Research/00a §"Practical load rules"
 *
 * A HARD_CONSTRAINT, cited, and until now unenforced at authoring. The string
 * "stress one-at-a-time" appears in `lib/plan/adaptive-ramp.ts`, which governs
 * ADAPTATION, and Rule 21 measured that path at zero firings in 309 production
 * intents. So the rule was quoted in a file that never runs and checked nowhere
 * that composes a plan. Rule 20 exactly: a product rule with no gate is a
 * hypothesis.
 *
 * It belongs here rather than in a per-week validator because it is a SEQUENCE
 * question. It compares this week against the one before it, and every existing
 * gate samples weeks one at a time, which is why nothing caught it.
 */
export interface SimultaneousStressAddition {
  readonly weekStartISO: string;
  readonly volumeStep: number;
  readonly stressorsBefore: number;
  readonly stressorsAfter: number;
  readonly why: string;
}

/** Below this, a volume change is noise rather than "adding mileage". */
export const VOLUME_ADDITION_THRESHOLD = 0.05;

/**
 * How many prior weeks the baseline is read over.
 *
 * THREE, and the reason is a defect this function shipped with for a few hours
 * on 2026-09-04. The first version compared against the IMMEDIATELY PRECEDING
 * week, and a planned cutback poisons that comparison completely. Measured on
 * the live CIM block, the two readings disagree on four of thirteen weeks:
 *
 *   week        vs previous week   vs trailing max
 *   2026-09-14      +91.8%              +0.6%
 *   2026-10-26      +30.4%              +0.7%
 *   2026-11-16      +21.0%             -18.3%
 *   2026-11-30      +21.4%             -10.8%
 *
 * Every one of those is a week that follows a deliberate dip, and every one was
 * reported as "adds mileage" when the block is in fact flat or falling there.
 * Only 2026-09-21 survives as a real addition, which is the same week the
 * volume classification independently flags.
 *
 * This is CLAUDE.md Rule 8 one level down. That rule says a taper or recovery
 * window is never the runner's NORMAL; the same is true of a cutback as a
 * BASELINE. The first version guarded taper weeks and race weeks explicitly and
 * missed the cutback, which is the most common dip in any block.
 */
export const ADDITION_BASELINE_TRAILING_WEEKS = 3;

export function detectSimultaneousStressAddition(
  week: PlannedWeek,
  /** The weeks before this one, oldest first. Only the trailing few are read. */
  previousWeeks: readonly PlannedWeek[],
): SimultaneousStressAddition | null {
  const window = previousWeeks
    .slice(-ADDITION_BASELINE_TRAILING_WEEKS)
    .filter((w) => w.weeklyMi > 0);
  if (window.length === 0) return null;

  // ── THE SECOND VERSION OF THE SAME MISTAKE, CAUGHT BY THE PRODUCTION REPLAY
  //
  // This filtered `isTaper || isRaceWeek` weeks OUT of the window before taking
  // the max, which sounds right and is wrong twice over.
  //
  // `isRaceWeek` conflates two different weeks (Rule 16): one that TAPERS for a
  // race, and one that merely CONTAINS a race without tapering. On the live CIM
  // block, 2026-09-21 is a 55.2 mile week holding a C-priority tune-up, and it
  // is his biggest week in the block. Filtering it out inflated the next week's
  // step from +7.8% to +27.1% and manufactured a finding.
  //
  // And the filter was redundant even where it was right. A MAXIMUM is already
  // immune to a dip: that is the whole reason it is a max and not a mean. The
  // filter was a second mechanism doing the same job worse.
  //
  // What survives is the honest part, as a REFUSAL rather than a subtraction:
  // if every week in the window is a prescribed dip there is no baseline to
  // read, and Rule 11 says that is "do not know" rather than a number.
  if (window.every((w) => w.isTaper || w.isRaceWeek)) return null;

  const baselineMi = Math.max(...window.map((w) => w.weeklyMi));
  const baselineStressors = Math.max(...window.map((w) => w.stressors.length));

  const volumeStep = week.weeklyMi / baselineMi - 1;
  const after = week.stressors.length;

  const addsMileage = volumeStep > VOLUME_ADDITION_THRESHOLD;
  const addsIntensity = after > baselineStressors;
  if (!addsMileage || !addsIntensity) return null;

  return {
    weekStartISO: week.weekStartISO,
    volumeStep,
    stressorsBefore: baselineStressors,
    stressorsAfter: after,
    why: `Volume rises ${Math.round(volumeStep * 1000) / 10}% on the highest of the previous `
      + `${window.length} week(s) AND the stressor count goes from ${baselineStressors} to ${after}. `
      + 'Research/00a §"Practical load rules" asks for one or the other in a given week, not both.',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE THREE OPTIONS  ·  push / hold / pull back, every time
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A RANKING SCORE. Defect 4 of David's list, in his words:
 *
 *   "Stop describing expectedAbsorbed as an evidence-derived expectation while
 *    it uses fixed heuristic weights. Rename it as a heuristic ranking score or
 *    calibrate it from outcomes."
 *
 * He is right, and the honest fix is the rename plus the label, because the
 * calibration data does not exist yet: grading only began producing FULL and
 * SUBSTANTIAL verdicts for this runner in the last few weeks, and the canonical
 * engine is still shadow-only. Calibrating on a handful of graded sessions
 * would replace an admitted guess with a disguised one.
 *
 * So: these four numbers are POLICY_ASSUMPTION, they are ordinal, and their
 * only job is to make the comparison between three options explicit and
 * rankable. **They do not forecast absorption and must never be reported as a
 * percentage the runner will absorb.**
 *
 * What would replace them: the fraction of prescribed work actually completed
 * at grade FULL or SUBSTANTIAL, per evidence class, over a season of graded
 * sessions. When that exists, this function should read it and its provenance
 * becomes ATHLETE_EVIDENCE.
 */
export function heuristicRankScore(cls: EvidenceClass): Attributed<number> | null {
  const basis = 'Ordinal ranking weight, chosen not measured. Not calibrated against any outcome. '
    + 'Replace with completion-at-grade rates per evidence class once a season of graded sessions exists.';
  switch (cls) {
    case 'SUPPORTED': return { value: 0.95, provenance: 'POLICY_ASSUMPTION', basis };
    case 'ALLOWED': return { value: 0.70, provenance: 'POLICY_ASSUMPTION', basis };
    case 'CONDITIONAL': return { value: 0.50, provenance: 'POLICY_ASSUMPTION', basis };
    case 'CONTRAINDICATED': return { value: 0.25, provenance: 'POLICY_ASSUMPTION', basis };
    // Rule 11: ranking an unknown means inventing a number.
    case 'UNKNOWN': return null;
  }
}

/**
 * Rank three real options by stimulus times ranking score.
 *
 * Note the direction this produces, and that it is the point: a bigger
 * prescription only wins when the evidence backs it. Pushing into CONDITIONAL
 * territory scores 1.0 x 0.50 against a supported hold's 0.85 x 0.95, so the
 * layer prefers the hold WITHOUT anyone writing "be careful" anywhere. And when
 * the push IS supported it scores 1.0 x 0.95 and wins, which is equally the
 * point, because the default is to advance.
 *
 * The product is a ranking, not a quantity with units. It is deliberately not
 * exposed on the trace.
 */
export function rankOptions(opts: readonly OptionAppraisal[]): OptionAppraisal[] {
  const stimulus: Record<Option, number> = { PUSH: 1.0, HOLD: 0.85, PULL_BACK: 0.6 };
  return [...opts].sort((a, b) => {
    const av = (a.heuristicRankScore?.value ?? 0) * stimulus[a.option];
    const bv = (b.heuristicRankScore?.value ?? 0) * stimulus[b.option];
    return bv - av;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · DOCTRINE CONFLICT  ·  adjudicated, never cherry-picked
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A hard constraint beats a guideline beats a heuristic. Two of equal force is
 * a REAL conflict and the caller must say which wins and why. This refuses to
 * invent a reason, because inventing one is the failure being fixed.
 */
export const forceRank = (f: DoctrineCitation['force']): number =>
  f === 'HARD_CONSTRAINT' ? 2 : f === 'GUIDELINE' ? 1 : 0;

export function adjudicate(
  a: DoctrineCitation, b: DoctrineCitation, becauseIfEqual?: string,
): DoctrineConflict {
  const rank = forceRank;
  const ra = rank(a.force); const rb = rank(b.force);
  if (ra !== rb) {
    return {
      between: [a, b],
      resolvedInFavourOf: ra > rb ? 0 : 1,
      because: `${ra > rb ? a.source : b.source} is a ${ra > rb ? a.force : b.force} and `
        + `${ra > rb ? b.source : a.source} is a ${ra > rb ? b.force : a.force}.`,
    };
  }
  if (!becauseIfEqual) {
    throw new Error(
      `Doctrine conflict between ${a.source} ${a.section} and ${b.source} ${b.section} at equal `
      + `force (${a.force}) with no adjudication. Name which wins and why. Picking the sentence `
      + 'that agrees with the proposal already made is the defect this layer exists to stop.',
    );
  }
  return { between: [a, b], resolvedInFavourOf: 0, because: becauseIfEqual };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · THE PROMOTION GATE
 * ═══════════════════════════════════════════════════════════════════════ */

export interface PromotionContext {
  /** The block's weeks, so taper integrity and progression are real checks. */
  readonly weeks: readonly PlannedWeek[];
}

/** ISO calendar day, strictly. `Date.parse` accepts far too much. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whole days from `fromISO` to `toISO`, or null when either is not an ISO day.
 *
 * Null is a THIRD fact and the callers branch on it (Rule 11): an unparseable
 * date is not "zero days apart", and it is not "fine".
 */
export function daysBetweenISO(fromISO: string, toISO: string): number | null {
  if (!ISO_DAY.test(fromISO) || !ISO_DAY.test(toISO)) return null;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * How far before the prescription an earning gate must be assessed.
 *
 * POLICY_ASSUMPTION, and the honest floor rather than a comfortable number: a
 * gate assessed ON the day it guards, or after it, cannot change the
 * prescription at all — `ifUnmet: 'REDUCE'` has nothing left to reduce. One
 * day is the minimum that can still act, and for a week-scale decision it is
 * also the right one, because the week the gate is testing has just ended.
 */
export const MIN_GATE_LEAD_DAYS = 1;

/**
 * Which WEEK a decision is about.
 *
 * `stacked.weekStartISO` when the trace carries stacked stress, and the
 * decision's own date otherwise. The second half is load-bearing and was the
 * taper-integrity hole: `detectStackedStress` returns NULL for an ordinary
 * taper week (low volume, one stressor, a short long run — no reach on any of
 * the three), so a gate keyed only on `t.stacked` could not see a PUSH inside
 * a taper unless the caller hand-built a `StackedStress` that the detector
 * would never have produced. The one test that "covered" it did exactly that.
 */
const weekOf = (t: DecisionTrace): string => t.stacked?.weekStartISO ?? t.dateISO;

export function checkPromotion(
  traces: readonly DecisionTrace[],
  ctx?: PromotionContext,
): PlanAdjudication {
  const blocked: string[] = [];

  const conditional = traces.filter((t) =>
    t.athlete.evidenceClass === 'CONDITIONAL' || t.athlete.evidenceClass === 'CONTRAINDICATED');

  // Defect 6. A CONDITIONAL decision is fine, IF it carries a gate that says
  // how it can be earned and when that is checked. Marking it for reassessment
  // without saying what would earn it is what the first version accepted, and
  // it leaves the runner nothing to aim at.
  const ungated = conditional.filter((t) => t.earningGate === null && t.reassessOnISO === null);
  const markedButUnexplained = conditional.filter((t) =>
    t.earningGate === null && t.reassessOnISO !== null);

  const stackedUnaddressed = traces.filter((t) =>
    t.stacked?.simultaneousPeak === true && t.chosen === 'PUSH');

  const missingOptions = traces.filter((t) => {
    const seen = new Set(t.options.map((o) => o.option));
    return !(seen.has('PUSH') && seen.has('HOLD') && seen.has('PULL_BACK'));
  });

  /**
   * A conflict is unresolved when nobody said why, OR when the "resolution"
   * hands it to the WEAKER citation.
   *
   * The empty-`because` clause alone was a proxy that the supported path could
   * not produce: `adjudicate()` always writes a non-empty sentence and throws
   * outright on two equal-force citations with no argument, so the only way to
   * reach that filter was to hand-write a `DoctrineConflict` literal. Rule 18
   * §1 — a check nothing can make fail is a hypothesis.
   *
   * The second clause is the real defect it was standing in for. Letting a
   * GUIDELINE beat a HARD_CONSTRAINT is precisely "quoting whichever sentence
   * supports the proposal already made", which is what `contract.ts` says this
   * type exists to stop, and it is expressible today.
   */
  const unresolvedConflict = traces.filter((t) =>
    t.conflicts.some((c) => {
      if (c.because.trim() === '') return true;
      const winner = c.between[c.resolvedInFavourOf];
      const loser = c.between[c.resolvedInFavourOf === 0 ? 1 : 0];
      return forceRank(winner.force) < forceRank(loser.force);
    }));

  // Defect 2 enforced at the gate as well as at the source: nothing may be
  // refused on a ceiling claim that does not have the comparables behind it.
  const badCeiling = traces.filter((t) =>
    t.athlete.evidenceClass === 'CONTRAINDICATED'
    && (t.athlete.ceilingClaim === null || !t.athlete.ceilingClaim.valid));

  // Rule 21, as a real check rather than `traces.length > 0`. A block that
  // never advances anywhere is not a training plan. This is the dimension the
  // first version could not fail on.
  const anyAdvance = traces.some((t) => t.chosen === 'PUSH');

  // ONE STRESSOR AT A TIME, walked across the SEQUENCE. A week that adds
  // mileage and intensity together may still be right, but it has to be argued
  // rather than assumed, so it must either not be pushed or carry a gate.
  const simultaneousAdditions = (() => {
    const weeks = ctx?.weeks ?? [];
    const out: SimultaneousStressAddition[] = [];
    for (let i = 1; i < weeks.length; i += 1) {
      const f = detectSimultaneousStressAddition(weeks[i], weeks.slice(0, i));
      if (f != null) out.push(f);
    }
    return out;
  })();
  const unarguedAdditions = simultaneousAdditions.filter((a) => {
    const t = traces.find((x) => weekOf(x) === a.weekStartISO);
    // No trace at all for a week doctrine flags is the worst case: nobody looked.
    if (t == null) return true;
    return t.chosen === 'PUSH' && t.earningGate === null;
  });

  // Taper integrity, likewise real. Nothing gets pushed inside a taper.
  //
  // CORPUS-ADJ-1 · keyed on `weekOf`, not on `t.stacked`. See `weekOf`: the
  // old predicate required a `StackedStress` that `detectStackedStress` cannot
  // produce for a taper week, so this dimension was structurally unfailable
  // through the supported path and its one test hand-built the object.
  const taperWeeks = new Set((ctx?.weeks ?? []).filter((w) => w.isTaper || w.isRaceWeek)
    .map((w) => w.weekStartISO));
  const pushedInTaper = ctx == null ? [] : traces.filter((t) =>
    t.chosen === 'PUSH' && taperWeeks.has(weekOf(t)));

  /**
   * RULE 11 AT THE GATE · an honest absence is not support.
   *
   * `UNKNOWN` means "nothing comparable exists either way", and `contract.ts`
   * says so: "an honest absence (Rule 11)". The gate only ever collected
   * CONDITIONAL and CONTRAINDICATED, so a decision the layer could say NOTHING
   * about, PUSHed, with no gate and no reassessment, promoted silently — the
   * exact shape of every Rule 11 defect in CLAUDE.md, where a missing input
   * disables the mechanism that exists for it.
   *
   * A HOLD or a PULL_BACK on unknown evidence is not caught here, deliberately:
   * declining to advance into the dark needs no gate. Advancing into it does.
   */
  const unknownPushed = traces.filter((t) =>
    t.athlete.evidenceClass === 'UNKNOWN' && t.chosen === 'PUSH'
    && t.earningGate === null && t.reassessOnISO === null);

  /* ── EARNING-GATE TIMING · defect 1 of David's list, at the gate ──────────
   *
   * "October and November workouts must be evaluated against the training
   * accumulated by then." The corollary nobody checked: the CHECK has to
   * happen in time to act, and it may not ask about training that has not
   * happened when it runs.
   */
  const gateTimingFaults: string[] = [];
  for (const t of traces) {
    const g = t.earningGate;
    if (g == null) continue;
    const lead = daysBetweenISO(g.assessOnISO, t.dateISO);
    if (lead == null) {
      gateTimingFaults.push(`${g.gateId} · assessOnISO "${g.assessOnISO}" or decision date `
        + `"${t.dateISO}" is not an ISO day, so the gate cannot be scheduled at all`);
    } else if (lead < MIN_GATE_LEAD_DAYS) {
      gateTimingFaults.push(`${g.gateId} · assessed on ${g.assessOnISO}, ${lead} day(s) before the `
        + `${t.dateISO} prescription it guards. A gate assessed on or after the day it guards has `
        + 'nothing left to defer, reduce or drop.');
    }
    for (const r of g.requires) {
      const slack = daysBetweenISO(r.byISO, g.assessOnISO);
      if (slack == null) {
        gateTimingFaults.push(`${g.gateId} · requirement due "${r.byISO}" is not an ISO day`);
      } else if (slack < 0) {
        gateTimingFaults.push(`${g.gateId} · assessed on ${g.assessOnISO} but requires "${r.measurable}" `
          + `by ${r.byISO}. It asks whether a week that has not yet run has completed.`);
      }
    }
    if (g.ifUnmet === 'REDUCE' && g.reduceTo == null) {
      gateTimingFaults.push(`${g.gateId} · reduces on failure but names no reduced value, so "REDUCE" `
        + 'is a word rather than an instruction');
    }
  }

  /* ── EXECUTION IDENTITY · one quantity, one identity (Rule 16) ───────────
   *
   * The goal race is not a training long run. `detectStackedStress` now
   * declines to compare a race week's distance against demonstrated TRAINING
   * capacity; this is the gate that acts on it, so a caller who hand-builds a
   * `StackedStress` for a race week — or whose detector regresses — is caught
   * rather than trusted. Detector and gate, per the defect found on
   * 2026-09-04 where disabling a promotion-level block left the suite green.
   */
  const raceWeekStarts = new Set((ctx?.weeks ?? []).filter((w) => w.isRaceWeek)
    .map((w) => w.weekStartISO));
  const allWeekStarts = new Set((ctx?.weeks ?? []).map((w) => w.weekStartISO));
  const identityFaults: string[] = [];
  for (const t of traces) {
    const wk = weekOf(t);
    if (raceWeekStarts.has(wk) && t.stacked?.longRunOverDemonstratedMax != null) {
      identityFaults.push(`${t.decisionId} · week ${wk} is a RACE week and its distance is being read as `
        + `a ${Math.round(t.stacked.longRunOverDemonstratedMax * 1000) / 10}% reach over his longest `
        + 'TRAINING run. A race is not a long run.');
    }
    if (ctx != null && allWeekStarts.size > 0 && !allWeekStarts.has(wk)) {
      identityFaults.push(`${t.decisionId} · decides about week ${wk}, which is not a week of this block. `
        + 'The decision and the block are describing different plans.');
    }
  }

  /* ── EVIDENCE PROVENANCE · defect 3 of David's list, at the gate ─────────
   *
   * "The output must clearly distinguish calculated physiology, athlete
   * evidence and policy assumptions." `Attributed.basis` says of itself:
   * "Never empty." Nothing checked either sentence.
   */
  const provenanceFaults: string[] = [];
  for (const t of traces) {
    const a = t.athlete;
    const checkAttr = (label: string, attr: Attributed<unknown>, want: Attributed<unknown>['provenance']) => {
      if (attr.provenance !== want) {
        provenanceFaults.push(`${t.decisionId} · ${label} is reported as ${attr.provenance}, not ${want}`);
      }
      if (attr.basis.trim() === '') {
        provenanceFaults.push(`${t.decisionId} · ${label} carries no basis, and a number with no basis `
          + 'is a claim rather than evidence');
      }
    };
    checkAttr('demonstratedMaxToday', a.demonstratedMaxToday, 'ATHLETE_EVIDENCE');
    checkAttr('demonstratedMaxProjected', a.demonstratedMaxProjected, 'POLICY_ASSUMPTION');
    for (const o of t.options) {
      const s = o.heuristicRankScore;
      if (s == null) {
        if (o.evidenceClass !== 'UNKNOWN') {
          provenanceFaults.push(`${t.decisionId} · the ${o.option} option is ${o.evidenceClass} but was `
            + 'not ranked at all, so the comparison the layer exists to make was not made');
        }
        continue;
      }
      if (o.evidenceClass === 'UNKNOWN') {
        provenanceFaults.push(`${t.decisionId} · the ${o.option} option is UNKNOWN and was ranked `
          + `${s.value} anyway. Ranking an unknown means inventing a number (Rule 11).`);
      }
      checkAttr(`the ${o.option} option's heuristicRankScore`, s, 'POLICY_ASSUMPTION');
    }
  }

  if (ungated.length > 0) {
    blocked.push(`athleteSpecificSupport · ${ungated.length} decision(s) are not supported by his own `
      + `history, carry no earning gate and are not marked for reassessment: ${ungated.map((t) => t.decisionId).join(', ')}`);
  }
  if (markedButUnexplained.length > 0) {
    blocked.push(`athleteSpecificSupport · ${markedButUnexplained.length} decision(s) are marked for `
      + `reassessment but say nothing about what would earn them: ${markedButUnexplained.map((t) => t.decisionId).join(', ')}`);
  }
  if (badCeiling.length > 0) {
    blocked.push(`athleteSpecificSupport · ${badCeiling.length} decision(s) refuse a prescription on a `
      + `ceiling claim with fewer than ${MIN_COMPARABLES_FOR_CEILING_CLAIM} comparables: `
      + `${badCeiling.map((t) => t.decisionId).join(', ')}`);
  }
  if (unknownPushed.length > 0) {
    blocked.push(`athleteSpecificSupport · ${unknownPushed.length} decision(s) PUSH on evidence the layer `
      + 'classed UNKNOWN, with no gate and no reassessment. An honest absence is not support (Rule 11): '
      + `${unknownPushed.map((t) => t.decisionId).join(', ')}`);
  }
  if (stackedUnaddressed.length > 0) {
    blocked.push(`stackedStress · ${stackedUnaddressed.length} week(s) peak in volume, long run AND `
      + `stressor count simultaneously and were still PUSHed: ${stackedUnaddressed.map((t) => t.decisionId).join(', ')}`);
  }
  if (missingOptions.length > 0) {
    blocked.push(`wholeBlockCoherence · ${missingOptions.length} decision(s) did not compare all three `
      + `options: ${missingOptions.map((t) => t.decisionId).join(', ')}`);
  }
  if (unresolvedConflict.length > 0) {
    blocked.push(`doctrineResolution · ${unresolvedConflict.length} decision(s) carry an unadjudicated conflict`);
  }
  if (traces.length === 0) {
    blocked.push('wholeBlockCoherence · nothing was adjudicated at all, which is not a pass (Rule 18)');
  }
  if (traces.length > 0 && !anyAdvance) {
    blocked.push('progression · no decision in this block advances anything. Rule 21: a plan that only '
      + 'holds and pulls back is a safety system wearing a coach\'s clothes.');
  }
  if (unarguedAdditions.length > 0) {
    blocked.push(`recoverability · ${unarguedAdditions.length} week(s) add mileage AND intensity `
      + 'together with no gate and no argument, against Research/00a §"Practical load rules": '
      + `${unarguedAdditions.map((a) => a.weekStartISO).join(', ')}`);
  }
  if (pushedInTaper.length > 0) {
    blocked.push(`taperIntegrity · ${pushedInTaper.length} decision(s) PUSH inside a taper or race week: `
      + `${pushedInTaper.map((t) => t.decisionId).join(', ')}`);
  }
  if (gateTimingFaults.length > 0) {
    blocked.push(`earningGateTiming · ${gateTimingFaults.length} gate(s) cannot be assessed in time to `
      + `act, or ask about training that has not happened yet: ${gateTimingFaults.join(' | ')}`);
  }
  if (identityFaults.length > 0) {
    blocked.push(`executionIdentity · ${identityFaults.length} decision(s) read one quantity under two `
      + `identities: ${identityFaults.join(' | ')}`);
  }
  if (provenanceFaults.length > 0) {
    blocked.push(`evidenceProvenance · ${provenanceFaults.length} number(s) are printed in the wrong `
      + `voice or with no basis: ${provenanceFaults.join(' | ')}`);
  }

  const check: PromotionCheck = {
    athleteSpecificSupport: ungated.length === 0 && markedButUnexplained.length === 0
      && badCeiling.length === 0 && unknownPushed.length === 0 && traces.length > 0,
    wholeBlockCoherence: missingOptions.length === 0 && traces.length > 0,
    recoverability: unarguedAdditions.length === 0,
    progression: traces.length > 0 && anyAdvance,
    taperIntegrity: pushedInTaper.length === 0,
    doctrineResolution: unresolvedConflict.length === 0,
    stackedStress: stackedUnaddressed.length === 0,
    earningGateTiming: gateTimingFaults.length === 0,
    executionIdentity: identityFaults.length === 0,
    evidenceProvenance: provenanceFaults.length === 0,
  };
  // Belt and braces · a dimension added to the type but forgotten here would
  // otherwise silently read as passing.
  for (const d of PROMOTION_DIMENSIONS) {
    if (check[d] === undefined) blocked.push(`${d} · not evaluated`);
  }

  const earningGates = traces
    .map((t) => t.earningGate)
    .filter((g): g is EarningGate => g != null);

  return { traces, check, mayPromote: blocked.length === 0, blockedBecause: blocked, earningGates };
}
