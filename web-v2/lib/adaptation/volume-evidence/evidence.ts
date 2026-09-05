/**
 * lib/adaptation/volume-evidence/evidence.ts · CONTINUOUS-EVIDENCE-1 · TWO
 * CHANNELS OUT OF ONE WEEK, NEVER COLLAPSED INTO ONE NUMBER.
 *
 * ── THE HARD REQUIREMENT THIS FILE IS ─────────────────────────────────────
 *
 * The owner, in his own words, and it is the reason this is a separate file
 * rather than another field on `SurplusAdmission`:
 *
 *     "Extra mileage during a recovery week may increase fatigue, affect the
 *      next decision, and fail to earn a future mileage increase. A duplicate
 *      or recording artifact must affect neither."
 *
 * So the same miles are read TWICE, by two readers that do not share a filter:
 *
 *   CAPABILITY · `capacity`  Rule 8 FILTERED. What the runner has SHOWN he can
 *                            carry. A week the engine itself authored small is
 *                            not an answer to that question, so a Rule 8
 *                            non-normal week contributes zero capacity however
 *                            far past its prescription it ran.
 *   ABSORBED LOAD · `fatigue`  Rule 8's COROLLARY, deliberately NOT FILTERED.
 *                            "What the connective tissue will experience next
 *                            week is a function of what it actually did." The
 *                            taper happened. The recovery-week overrun
 *                            happened. Both are fatigue and neither is
 *                            capability.
 *
 * The two are computed by different code over different populations and are
 * returned as different fields on different types. There is no path in this
 * file that adds them, averages them, or lets one stand in for the other.
 *
 * ── AND ONE THING THAT REACHES NEITHER · RULE 14 ──────────────────────────
 *
 * A merged row, an unreadable distance, or a run the day resolver could not
 * tier is a RECORDING ARTIFACT, and it contributes to NEITHER channel. This is
 * not hypothetical arithmetic: measured on the owner's own account, **76
 * merged run-days carrying 946.9 miles** sit inside his 2026 window. Counted
 * as capacity they would manufacture a fitness he never had; counted as
 * fatigue they would manufacture a load his legs never carried. The canonical
 * predicate is `NOT (data ? 'mergedIntoId')` and there is exactly one of it
 * (`CANONICAL_ROW_SQL`); this file is pure and takes its ANSWER through
 * `SurplusRun.mergedIntoAnother`.
 *
 * ── RULE 9 · WHERE THE CONTINUITY LIVES ───────────────────────────────────
 *
 * `weight.ts` holds the curves and the argument. What matters here is which
 * side of the line each input falls on:
 *
 *   CONTINUOUS, therefore ramped   the size of the surplus; the following
 *                                  week's completion fraction; the age of the
 *                                  evidence.
 *   CATEGORICAL, therefore not     merged / not merged; the resolver tiered
 *                                  the run or did not; pain was reported or
 *                                  was not; the plan authored the week as
 *                                  recovery or did not.
 *
 * A boolean input has no neighbourhood, so it cannot have a cliff, and dressing
 * one as a ramp would be decoration rather than correctness.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ───────────────────
 *
 * · It cannot fail on a BAD LOADER. Every fact here arrives pre-resolved:
 *   whether a row is merged, whether a week was authored as recovery, what the
 *   following week completed at. A loader that gets any of those wrong
 *   produces a confident, well-formed, wrong reading and nothing here notices.
 * · It cannot fail on a prescription that was itself too small. Both channels
 *   are measured against what was prescribed.
 * · It cannot tell "no supplemental run happened" from "one happened and never
 *   synced". Both arrive as an absent row, in both channels.
 * · It cannot fail on the FATIGUE channel being spent wrongly downstream.
 *   Nothing in this directory consumes `fatigue`; it is produced so that a
 *   caller has the unfiltered number under a name that says which question it
 *   answers. If a future caller spends it as capability, that is a defect this
 *   file cannot see. `_continuous_evidence.test.ts` asserts only that the two
 *   channels DISAGREE where they must.
 * · It cannot fail on the SEAM. Nothing here writes.
 */
import { roundTo } from '@/lib/format/run';
import { admitSurplus, type AdmissionInput } from './admit';
import { classifyWeekSurplus } from './classify';
import type { Readability } from '@/lib/adaptation/canonical/input';
import {
  absent, failed, measured,
  type Measured,
  type SurplusAdmission,
  type WeekSurplus,
  type WeekSurplusInput,
} from './contract';
import {
  absorptionWeight,
  creditedSurplusFrac,
  PROGRESSION_UNLOCK_FRAC,
  PROVISIONAL_ABSORPTION_WEIGHT,
  progressionFractionFromUnits,
  recencyWeight,
} from './weight';

/* ══════════════════════════════════════════════════════════════════════════
 * CHANNEL 1 · CAPACITY
 * ═══════════════════════════════════════════════════════════════════════ */

/** One named multiplier, so a reading can always say why it is the size it is. */
export interface WeightFactor {
  readonly name: string;
  readonly value: number;
  readonly why: string;
}

export interface CapacityEvidence {
  readonly weekStartISO: string;
  /** admissible surplus ÷ prescribed. Refuses exactly when the week refuses. */
  readonly surplusFrac: Measured<number>;
  /**
   * The size half of the credit, in fractions of prescribed volume, AFTER the
   * GPS noise gate and the per-week saturation. Zero for a week whose surplus
   * is inside measurement error.
   */
  readonly creditedFrac: number;
  /**
   * How much of `units` absorption has confirmed, in [0, 1]. Named for the one
   * question it answers rather than as a bag of "quality": it holds exactly
   * `absorptionWeight`, and a plural name over a single factor is how a field
   * quietly becomes two quantities (Rule 16).
   */
  readonly confirmationWeight: number;
  /**
   * WHAT THIS WEEK CONTRIBUTES. Equal to `creditedFrac`: the evidence exists as
   * soon as the running happened and the categorical gates passed.
   *
   * Recency is NOT applied here — it depends on when the question is asked, so
   * `accumulateCapacityEvidence` applies it.
   */
  readonly units: number;
  /**
   * THE PART A PROGRESSION MAY SPEND: `units × absorptionWeight`.
   *
   * The owner's requirement is a sentence about CONFIRMATION, not about
   * existence: "Evidence remains PROVISIONAL until recovery indicates
   * absorption." Provisional is not zero. So a week the runner did not carry
   * on from keeps its `units` on the record and confirms none of them, and a
   * week whose successor has not been run yet confirms half
   * (`PROVISIONAL_ABSORPTION_WEIGHT`).
   *
   * Splitting these two is Rule 11 at the level that matters here: "the runner
   * ran no extra" and "the runner ran extra and it has not been confirmed" are
   * opposite facts, and the old code returned the same number for both.
   */
  readonly confirmedUnits: number;
  /** `units − confirmedUnits`. Recorded, not yet spendable. */
  readonly provisionalUnits: number;
  /**
   * `units ÷ PROGRESSION_UNLOCK_FRAC`. The share of a full doctrinal step this
   * one week's running is worth. This is the number the owner asked to see for
   * 2026-06-15.
   */
  readonly fractionOfFullStep: number;
  /** `confirmedUnits ÷ PROGRESSION_UNLOCK_FRAC`. What it may actually buy today. */
  readonly confirmedFractionOfFullStep: number;
  /**
   * True while the week AFTER this one has not been run yet. Rule 11: this is
   * not "absorption failed", it is "absorption is not yet observable", and the
   * two must not produce the same downstream sentence.
   */
  readonly provisional: boolean;
  /**
   * True when the read failed rather than the evidence saying no. An
   * unreadable week contributes zero units and must NOT be counted as a week
   * the runner failed to earn anything in.
   */
  readonly unreadable: boolean;
  readonly factors: readonly WeightFactor[];
  readonly detail: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * CHANNEL 2 · FATIGUE
 * ═══════════════════════════════════════════════════════════════════════ */

export interface FatigueContribution {
  readonly weekStartISO: string;
  /**
   * Every canonical, readable mile run in the week, whatever KIND it was.
   * Races count. Moved sessions count. A recovery week's overrun counts. Rule
   * 8's corollary: the legs do not know what the plan intended.
   */
  readonly absorbedMi: Measured<number>;
  /** Miles above prescription, floored at zero. NOT Rule 8 filtered. */
  readonly excessMi: Measured<number>;
  /** `excessMi ÷ prescribedMi`. Absent when the week had no prescription. */
  readonly excessFrac: Measured<number>;
  /**
   * The requirement, made visible: extra mileage inside a week the plan
   * authored small raises THIS number while contributing zero to capacity.
   */
  readonly duringPrescribedNonNormal: boolean;
  /** Rule 14 receipts. Miles on merged rows, excluded from BOTH channels. */
  readonly artifactMiExcluded: number;
  readonly detail: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE SPINE ENTRY POINT
 * ═══════════════════════════════════════════════════════════════════════ */

export interface WeekEvidenceInput {
  readonly asOfISO: string;
  /** The loader's week, unclassified. */
  readonly week: WeekSurplusInput;
  /**
   * The five admission conditions, minus the week itself, which this function
   * classifies. Same type `admitSurplus` already takes, so there is one
   * vocabulary for the conditions and not two (Rule 16).
   */
  readonly conditions: Omit<AdmissionInput, 'week'>;
}

export interface WeekEvidenceReading {
  readonly weekStartISO: string;
  /** The classified week, for a caller that wants the per-run receipts. */
  readonly surplus: WeekSurplus;
  /** The categorical verdict, unchanged in shape. */
  readonly admission: SurplusAdmission;
  readonly capacity: CapacityEvidence;
  readonly fatigue: FatigueContribution;
}

/**
 * The human half of a `Readability`. `READ` is unreachable on a refusal branch
 * by construction and says so rather than printing "undefined" if it ever is.
 * Deliberately the same helper, with the same sentence, as `admit.ts`'s — a
 * second dialect of "why could this not be read" is exactly the Rule 16 shape
 * this directory exists to avoid.
 */
const whyText = (r: Readability): string => (r.kind === 'READ' ? 'the value was read' : r.what);

const zeroCapacity = (
  weekStartISO: string,
  surplusFrac: Measured<number>,
  factors: readonly WeightFactor[],
  detail: string,
  o: { provisional?: boolean; unreadable?: boolean } = {},
): CapacityEvidence => ({
  weekStartISO,
  surplusFrac,
  creditedFrac: 0,
  confirmationWeight: 0,
  units: 0,
  confirmedUnits: 0,
  provisionalUnits: 0,
  fractionOfFullStep: 0,
  confirmedFractionOfFullStep: 0,
  provisional: o.provisional ?? false,
  unreadable: o.unreadable ?? false,
  factors,
  detail,
});

/**
 * ONE WEEK OF EXECUTIONS IN, TWO CHANNELS OUT.
 *
 * This is the function a caller outside this directory should call. It runs
 * the whole per-week path — classify, admit, weigh — so that no caller has to
 * remember the order or get the Rule 8 filter right on its own.
 */
export function readWeekEvidence(input: WeekEvidenceInput): WeekEvidenceReading {
  const surplus = classifyWeekSurplus(input.week);
  const admission = admitSurplus({ ...input.conditions, week: surplus });
  return {
    weekStartISO: surplus.weekStartISO,
    surplus,
    admission,
    capacity: weighCapacity(surplus, admission, input.conditions),
    fatigue: readFatigue(input.week, surplus),
  };
}

/**
 * CHANNEL 1. How much this week moves the belief about what the runner CAN DO.
 *
 * The order of the guards is the argument, and it is the same order `admit.ts`
 * uses, for the same reason: the most disqualifying fact wins, because every
 * later clause would spend the miles.
 */
export function weighCapacity(
  week: WeekSurplus,
  admission: SurplusAdmission,
  conditions: Omit<AdmissionInput, 'week'>,
): CapacityEvidence {
  const factors: WeightFactor[] = [];

  /* ── the surplus fraction, or a refusal ────────────────────────────── */

  if (!week.admissibleSurplusMi.ok) {
    const why = week.admissibleSurplusMi.why;
    return zeroCapacity(
      week.weekStartISO,
      week.admissibleSurplusMi,
      factors,
      why.kind === 'ABSENT'
        // Rule 8 · a prescribed recovery, taper, cutback or race week. The
        // miles are real and they are in the FATIGUE channel; they are not an
        // answer to "what can this runner carry".
        ? `No capacity evidence: ${whyText(why)}`
        : `Capacity could not be read: ${whyText(why)}`,
      { unreadable: why.kind === 'FAILED' },
    );
  }
  if (week.prescribedMi <= 0) {
    return zeroCapacity(
      week.weekStartISO,
      absent('no prescription for this week, so there is no surplus fraction to measure'),
      factors,
      'No prescription for this week, so there is nothing for the running to be surplus to.',
    );
  }

  const surplusFracValue = week.admissibleSurplusMi.value / week.prescribedMi;
  const surplusFrac: Measured<number> = measured(surplusFracValue);

  /* ── the CATEGORICAL gates. A boolean input has no hair to slip on, so
   *    these are not Rule 9 cliffs and they are left exactly as they are. ── */

  if (!admission.admitted && admission.outcome === 'UNREADABLE') {
    return zeroCapacity(
      week.weekStartISO, surplusFrac, factors,
      `Capacity is not readable for this week: ${admission.blocking.join(', ') || 'no condition named'}.`,
      { unreadable: true },
    );
  }
  if (!admission.admitted) {
    return zeroCapacity(
      week.weekStartISO, surplusFrac, factors,
      `The evidence says this surplus may not be spent as capacity: `
      + `${admission.blocking.join(', ') || 'no condition named'}.`,
    );
  }

  /* ── the CONTINUOUS half ───────────────────────────────────────────── */

  const credited = creditedSurplusFrac(surplusFracValue);
  factors.push({
    name: 'creditedSurplusFrac',
    value: credited,
    why: `${roundTo(surplusFracValue * 100)} per cent over prescription, after the GPS noise `
      + 'gate and the per-week saturation.',
  });

  /* Absorption. THREE facts, never one (Rule 11):
   *   READ    · ramp between doctrine's two weekly-completion bars.
   *   ABSENT  · the week after has not happened. PROVISIONAL, not zero.
   *   FAILED  · the read broke. `admitSurplus` has already refused above, so
   *             this branch is unreachable from `readWeekEvidence`; it is kept
   *             because `weighCapacity` is exported and a direct caller can
   *             reach it. */
  let provisional = false;
  let absorption: number;
  if (conditions.followingWeekCompletionFrac.ok) {
    absorption = absorptionWeight(conditions.followingWeekCompletionFrac.value);
    factors.push({
      name: 'absorptionWeight',
      value: absorption,
      why: `The following week completed at `
        + `${roundTo(conditions.followingWeekCompletionFrac.value * 100)} per cent.`,
    });
  } else if (conditions.followingWeekCompletionFrac.why.kind === 'ABSENT') {
    provisional = true;
    absorption = PROVISIONAL_ABSORPTION_WEIGHT;
    factors.push({
      name: 'PROVISIONAL_ABSORPTION_WEIGHT',
      value: absorption,
      why: 'The week after this one has not been run yet, so absorption is not yet observable.',
    });
  } else {
    return zeroCapacity(
      week.weekStartISO, surplusFrac, factors,
      `Absorption could not be read: ${whyText(conditions.followingWeekCompletionFrac.why)}`,
      { unreadable: true },
    );
  }

  /* THE TWO AXES, KEPT APART.
   *
   * `units` is what the running was worth. `confirmedUnits` is what absorption
   * has so far allowed a progression to spend of it. A week followed by a
   * collapse keeps the first and loses the second, which is the difference
   * between recording evidence and erasing it. */
  const confirmationWeight = absorption;
  const units = credited;
  const confirmedUnits = credited * confirmationWeight;
  const provisionalUnits = units - confirmedUnits;
  const fractionOfFullStep = progressionFractionFromUnits(units);
  const confirmedFractionOfFullStep = progressionFractionFromUnits(confirmedUnits);

  return {
    weekStartISO: week.weekStartISO,
    surplusFrac,
    creditedFrac: credited,
    confirmationWeight,
    units,
    confirmedUnits,
    provisionalUnits,
    fractionOfFullStep,
    confirmedFractionOfFullStep,
    provisional,
    unreadable: false,
    factors,
    detail: `${roundTo(week.admissibleSurplusMi.value)} mi over `
      + `${roundTo(week.prescribedMi)} mi prescribed is worth `
      + `${Math.round(fractionOfFullStep * 100)} per cent of a full volume step, `
      + `of which ${Math.round(confirmedFractionOfFullStep * 100)} per cent is confirmed`
      + `${provisional ? ' so far, because the following week has not been run yet' : ''}.`,
  };
}

/**
 * CHANNEL 2. What the legs actually carried, whatever the plan intended.
 *
 * Rule 8's COROLLARY, and the reason it is a separate function over a separate
 * population: "over-applying this rule makes a safety guard MORE PERMISSIVE in
 * exactly the situation it exists for." A ramp check measured against a
 * pre-taper self waves through a jump the legs were not prepared for.
 *
 * So this reader does NOT exclude a recovery week, a taper week, a cutback, a
 * race week, a race, or a moved session. It excludes exactly two things, and
 * both because they are not running that happened:
 *
 *   · a merged row (Rule 14 · the same run recorded twice)
 *   · a row with no readable distance (Rule 11 · not a zero-mile run)
 */
export function readFatigue(input: WeekSurplusInput, week: WeekSurplus): FatigueContribution {
  const canonical = input.runs.filter((r) => !r.mergedIntoAnother);
  const unreadable = canonical.filter((r) => !r.distanceMi.ok);
  const artifactMiExcluded = roundTo(
    input.runs
      .filter((r) => r.mergedIntoAnother && r.distanceMi.ok)
      .reduce((a, r) => a + (r.distanceMi.ok ? r.distanceMi.value : 0), 0),
  );

  const absorbedMi: Measured<number> = unreadable.length > 0
    ? failed(`${unreadable.length} activities in this week have no readable distance`)
    : !input.dataComplete
      ? failed('the week contains missing, duplicate or misattributed activity data')
      : measured(roundTo(canonical.reduce(
        (a, r) => a + (r.distanceMi.ok ? r.distanceMi.value : 0), 0)));

  const excessMi: Measured<number> = !absorbedMi.ok
    ? absorbedMi
    : input.prescribedMi <= 0
      ? absent('no prescription for this week, so there is no excess to measure')
      : measured(Math.max(0, roundTo(absorbedMi.value - input.prescribedMi)));

  const excessFrac: Measured<number> = !excessMi.ok
    ? excessMi
    : measured(excessMi.value / input.prescribedMi);

  const nonNormal = week.prescribedNonNormal;
  const excess = excessMi.ok ? excessMi.value : null;

  return {
    weekStartISO: input.weekStartISO,
    absorbedMi,
    excessMi,
    excessFrac,
    duringPrescribedNonNormal: nonNormal,
    artifactMiExcluded,
    detail: excess == null
      ? 'The load this week put through the legs could not be read.'
      : nonNormal && excess > 0
        // The requirement, stated where a reader will meet it.
        ? `${roundTo(excess)} mi beyond a week the plan authored small. It is fatigue and it `
          + 'is not evidence about what this runner can carry.'
        : `${roundTo(excess)} mi beyond prescription went through the legs.`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ACCUMULATION · "repeated modest overruns accumulate"
 * ═══════════════════════════════════════════════════════════════════════ */

export interface LedgerContribution {
  readonly weekStartISO: string;
  readonly ageDays: number;
  readonly recency: number;
  /** The week's own units, before recency. What the running was worth. */
  readonly units: number;
  /** `confirmedUnits × recency`. What actually reached the spendable total. */
  readonly contributed: number;
  /** `units × recency`. What reached the RECORD, confirmed or not. */
  readonly recorded: number;
  readonly provisional: boolean;
}

export interface CapacityAccumulation {
  readonly asOfISO: string;
  /**
   * Σ `confirmedUnits × recency` over every week inside the window. THE
   * SPENDABLE TOTAL, and the only one `progressionFraction` is derived from.
   */
  readonly totalUnits: number;
  /**
   * Σ `units × recency`. Everything the running was worth, confirmed or not.
   * Always ≥ `totalUnits`. Carried so a caller can say "you have run this, and
   * this much of it has been confirmed" instead of reporting a bare zero over
   * weeks the runner really did run (Rule 11).
   */
  readonly recordedUnits: number;
  /**
   * `clamp01(totalUnits / PROGRESSION_UNLOCK_FRAC)`. THE OUTPUT. A caller
   * multiplies its doctrinal step by this, which is what stops the unlock from
   * being a cliff of its own: a third of the evidence buys a third of the step.
   */
  readonly progressionFraction: number;
  /** True at a full cycle's worth of accumulated growth. */
  readonly fullStepUnlocked: boolean;
  /** How much of the total rests on weeks whose absorption is not yet observable. */
  readonly provisionalUnits: number;
  /**
   * Weeks the read failed on. Rule 11: these are NOT weeks the runner earned
   * nothing in, and a caller that reports "no evidence" over a non-empty list
   * here is making the collapse this app has shipped four times.
   */
  readonly unreadableWeeks: readonly string[];
  readonly contributions: readonly LedgerContribution[];
}

const DAY_MS = 86_400_000;
const daysBetween = (fromISO: string, toISO: string): number =>
  Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / DAY_MS);

/**
 * THE LEDGER.
 *
 * Three weeks each 5 per cent over prescription accumulate to exactly one
 * training cycle's worth of growth and unlock a full step. One week 40 per
 * cent over accumulates a third of it and unlocks a third of a step, because
 * `PER_WEEK_CREDIT_CEILING_FRAC` saturates it — which is the owner's "one
 * extreme overrun does not establish sustainable capacity", made structural.
 *
 * `readings` may be given in any order; only `weekStartISO` is used to age
 * them. A week outside the window contributes nothing and is dropped
 * CONTINUOUSLY rather than at a boundary — see `recencyWeight`.
 */
export function accumulateCapacityEvidence(
  readings: readonly CapacityEvidence[],
  asOfISO: string,
): CapacityAccumulation {
  const contributions: LedgerContribution[] = [];
  const unreadableWeeks: string[] = [];
  let totalUnits = 0;
  let recordedUnits = 0;
  let provisionalUnits = 0;

  for (const r of readings) {
    if (r.unreadable) unreadableWeeks.push(r.weekStartISO);
    const ageDays = daysBetween(r.weekStartISO, asOfISO);
    // A week in the FUTURE is not evidence about the past. Guarded rather than
    // allowed to produce a recency above one.
    if (ageDays < 0) continue;
    const recency = recencyWeight(ageDays);
    const contributed = r.confirmedUnits * recency;
    const recorded = r.units * recency;
    totalUnits += contributed;
    recordedUnits += recorded;
    provisionalUnits += r.provisionalUnits * recency;
    contributions.push({
      weekStartISO: r.weekStartISO, ageDays, recency, units: r.units,
      contributed, recorded, provisional: r.provisional,
    });
  }

  const progressionFraction = progressionFractionFromUnits(totalUnits);
  return {
    asOfISO,
    totalUnits,
    recordedUnits,
    progressionFraction,
    fullStepUnlocked: totalUnits + 1e-12 >= PROGRESSION_UNLOCK_FRAC,
    provisionalUnits,
    unreadableWeeks,
    contributions: contributions.sort((a, b) => a.weekStartISO.localeCompare(b.weekStartISO)),
  };
}
