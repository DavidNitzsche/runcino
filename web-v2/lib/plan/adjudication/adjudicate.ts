/**
 * lib/plan/adjudication/adjudicate.ts · the adjudicator itself.
 *
 * Pure functions over already-loaded facts. It opens no database and reads no
 * plan: a caller hands it the runner's demonstrated history and the block's
 * weeks, and it returns traces plus a promotion verdict. That is deliberate —
 * the layer has to be testable against constructed sequences, and a function
 * that fetches cannot be.
 *
 * See `contract.ts` for why this exists and what it optimises for. The one
 * sentence worth repeating here: **the target is the maximum productive load
 * this runner can ABSORB, and the default is to advance.**
 */
import type {
  AthleteEvidence, ComparableSession, DecisionTrace, DoctrineCitation,
  DoctrineConflict, EvidenceClass, Option, OptionAppraisal, PlanAdjudication,
  PromotionCheck, StackedStress,
} from './contract';
import { PROMOTION_DIMENSIONS } from './contract';

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
  /** Miles run in the 7 days after his single biggest session, and what it was. */
  readonly after: readonly ComparableSession[];
}

export interface PlannedWeek {
  readonly weekStartISO: string;
  readonly weeklyMi: number;
  readonly longestMi: number;
  /** Named stressors: 'threshold', 'intervals', 'fast-finish long', 'race'… */
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
 * The bands are not physiology and are not cited as such — they are a reading
 * rule for the word "comparable". A prescription at or under what he has done
 * is SUPPORTED; a modest step is still supported by the progression itself; a
 * large step is ALLOWED at best, whatever a table says; and a step past a
 * quantity he has never approached is CONDITIONAL on earning it first.
 */
export const STEP_SUPPORTED_MAX = 0.10;   // +10% · inside ordinary progression
export const STEP_ALLOWED_MAX = 0.25;     // +25% · a real reach, not yet earned

export function classifyStep(
  prescribed: number | null,
  demonstratedMax: number | null,
): { readonly cls: EvidenceClass; readonly step: number | null } {
  if (prescribed == null || demonstratedMax == null || demonstratedMax <= 0) {
    return { cls: 'UNKNOWN', step: null };
  }
  const step = prescribed / demonstratedMax - 1;
  if (step <= 0) return { cls: 'SUPPORTED', step };
  if (step <= STEP_SUPPORTED_MAX) return { cls: 'SUPPORTED', step };
  if (step <= STEP_ALLOWED_MAX) return { cls: 'ALLOWED', step };
  return { cls: 'CONDITIONAL', step };
}

export function athleteEvidenceFor(
  what: string,
  prescribed: number | null,
  demonstratedMax: number | null,
  comparables: readonly ComparableSession[],
): AthleteEvidence {
  const { cls, step } = classifyStep(prescribed, demonstratedMax);
  const pct = step == null ? 0 : Math.round(step * 1000) / 10;
  const why = cls === 'UNKNOWN'
    ? `Nothing comparable in his history to size ${what} against. That is an absence, not a pass.`
    : cls === 'SUPPORTED'
      ? `${what} is ${pct <= 0 ? 'at or under' : `+${pct}% on`} his demonstrated ${demonstratedMax}. He has done this.`
      : cls === 'ALLOWED'
        ? `${what} is plus ${pct}% on his demonstrated ${demonstratedMax}. A research table permits it; his own history does not yet show it.`
        : `${what} is plus ${pct}% on his demonstrated ${demonstratedMax}. That is a quantity he has never approached, so it has to be EARNED before it is prescribed.`;
  return { evidenceClass: cls, comparables, demonstratedMax, prescribed, stepOverDemonstrated: step, why };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · STACKED STRESS  ·  what the components cost TOGETHER
 * ═══════════════════════════════════════════════════════════════════════ */

/** More than this many named stressors in one week is stacking worth costing. */
export const STACKED_STRESSOR_THRESHOLD = 2;

export function detectStackedStress(
  week: PlannedWeek,
  hist: DemonstratedHistory,
): StackedStress | null {
  const volStep = week.weeklyMi != null && hist.peakWeeklyMi
    ? week.weeklyMi / hist.peakWeeklyMi - 1 : null;
  const longStep = week.longestMi != null && hist.longestRunMi
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

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE THREE OPTIONS  ·  push / hold / pull back, every time
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Expected absorbed fraction. Deliberately crude and deliberately explicit:
 * a SUPPORTED prescription is expected to be absorbed nearly whole; an ALLOWED
 * one carries real miss risk; a CONDITIONAL one is a coin-flip until the
 * evidence exists; a CONTRAINDICATED one is expected to cost more than it buys.
 *
 * This is a HEURISTIC and is labelled one. Its job is to make the comparison
 * explicit and rankable, not to be precise — an adjudicator that cannot say why
 * it preferred one option is the thing being fixed.
 */
export function expectedAbsorbed(cls: EvidenceClass): number | null {
  switch (cls) {
    case 'SUPPORTED': return 0.95;
    case 'ALLOWED': return 0.70;
    case 'CONDITIONAL': return 0.50;
    case 'CONTRAINDICATED': return 0.25;
    case 'UNKNOWN': return null;
  }
}

/**
 * Rank three real options by expected ADAPTATION — stimulus × absorbed.
 *
 * Note the direction this produces, and that it is the point: a bigger
 * prescription only wins when he is expected to absorb it. Pushing into
 * CONDITIONAL territory scores 1.0 × 0.50 = 0.50 against a supported hold's
 * 0.85 × 0.95 = 0.81, so the layer prefers the hold WITHOUT anyone writing "be
 * careful" anywhere. And when the push IS supported it scores 1.0 × 0.95 and
 * wins, which is equally the point — the default is to advance.
 */
export function rankOptions(opts: readonly OptionAppraisal[]): OptionAppraisal[] {
  const stimulus: Record<Option, number> = { PUSH: 1.0, HOLD: 0.85, PULL_BACK: 0.6 };
  return [...opts].sort((a, b) => {
    const av = (a.expectedAbsorbedFrac ?? 0) * stimulus[a.option];
    const bv = (b.expectedAbsorbedFrac ?? 0) * stimulus[b.option];
    return bv - av;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · DOCTRINE CONFLICT  ·  adjudicated, never cherry-picked
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A hard constraint beats a guideline beats a heuristic. Two of equal force is
 * a REAL conflict and the caller must say which wins and why — this refuses to
 * invent a reason, because inventing one is the failure being fixed.
 */
export function adjudicate(
  a: DoctrineCitation, b: DoctrineCitation, becauseIfEqual?: string,
): DoctrineConflict {
  const rank = (f: DoctrineCitation['force']): number =>
    f === 'HARD_CONSTRAINT' ? 2 : f === 'GUIDELINE' ? 1 : 0;
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
 * 5 · THE PROMOTION GATE
 * ═══════════════════════════════════════════════════════════════════════ */

export function checkPromotion(traces: readonly DecisionTrace[]): PlanAdjudication {
  const blocked: string[] = [];

  const unsupported = traces.filter((t) =>
    t.athlete.evidenceClass === 'CONDITIONAL' || t.athlete.evidenceClass === 'CONTRAINDICATED');
  // A CONDITIONAL decision is fine — IF it is marked for reassessment. Fixing a
  // distant high-load session today, on evidence that does not exist yet, is the
  // thing being blocked, not the conditionality itself.
  const unmarked = unsupported.filter((t) => t.reassessOnISO === null);

  const stackedUnaddressed = traces.filter((t) =>
    t.stacked?.simultaneousPeak === true && t.chosen === 'PUSH');

  const missingOptions = traces.filter((t) => {
    const seen = new Set(t.options.map((o) => o.option));
    return !(seen.has('PUSH') && seen.has('HOLD') && seen.has('PULL_BACK'));
  });

  const unresolvedConflict = traces.filter((t) =>
    t.conflicts.some((c) => c.because.trim() === ''));

  if (unmarked.length > 0) {
    blocked.push(`athleteSpecificSupport · ${unmarked.length} decision(s) are not supported by his `
      + `own history and are not marked for reassessment: ${unmarked.map((t) => t.decisionId).join(', ')}`);
  }
  if (stackedUnaddressed.length > 0) {
    blocked.push(`recoverability · ${stackedUnaddressed.length} week(s) peak in volume, long run AND `
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

  const check: PromotionCheck = {
    athleteSpecificSupport: unmarked.length === 0 && traces.length > 0,
    wholeBlockCoherence: missingOptions.length === 0 && traces.length > 0,
    recoverability: stackedUnaddressed.length === 0,
    progression: traces.length > 0,
    taperIntegrity: true,
    doctrineResolution: unresolvedConflict.length === 0,
  };
  // Belt and braces · a dimension added to the type but forgotten here would
  // otherwise silently read as passing.
  for (const d of PROMOTION_DIMENSIONS) {
    if (check[d] === undefined) blocked.push(`${d} · not evaluated`);
  }

  return { traces, check, mayPromote: blocked.length === 0, blockedBecause: blocked };
}
