/**
 * lib/plan/adjudication/weekly-demand.ts · WHAT A WEEK COSTS.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * David, 2026-09-04:
 *
 *   "Show how weekly demand is calculated. It must include volume, intensity,
 *    long-run load, stressor stacking, recent adaptation, recovery and injury
 *    context, not merely whether mileage exceeds a plan-derived ceiling."
 *
 * The engine had two things and neither was a demand model.
 * `lib/adaptation/canonical/plan-load.ts` prices three terms (volume, long
 * run, quality minutes) and says so in its own header: it exists only to
 * compare two projections of the SAME plan, its absolute value is never read,
 * and it "must never be used to decide whether a runner is fatigued". And the
 * adjudication layer next door compares weekly mileage against a ceiling.
 * Neither answers the question he asked, which is what a given week actually
 * costs THIS runner in THIS context.
 *
 * ── RULE 16 · THE NAME COLLISION, ADDRESSED RATHER THAN LEFT ───────────────
 *
 * `ProjectedPlanLoad.demandIndex` already exists. Two different numbers under
 * one name is exactly what Rule 16 forbids, so the two are made ONE quantity
 * by construction instead of being allowed to drift:
 *
 *   · this module IMPORTS `QUALITY_MINUTE_TO_EASY_MILE` and
 *     `LONG_RUN_SURCHARGE_PER_MI` from `plan-load.ts` rather than restating
 *     them, so the terms they share cannot disagree;
 *   · with no context (no stacking, neutral load, no recovery debt, no
 *     injury, no long-run spike) this module's `demandIndex` EQUALS
 *     `projectPlanLoad(...).demandIndex` for the same week. That identity is
 *     asserted in `_weekly_demand.test.ts`, so a future edit to either file
 *     that breaks it fails.
 *
 * So there is one scale. `plan-load` is the three-term projection used for
 * arbitration; this is the full seven-component reading of the same scale,
 * in the same unit.
 *
 * ── THE UNIT ───────────────────────────────────────────────────────────────
 *
 * ONE EQUIVALENT EASY MILE. Volume therefore enters at a coefficient of 1.0
 * by definition of the unit, which is worth saying plainly: that coefficient
 * is not a fitted weight and there is nothing in it to be wrong about. Every
 * other coefficient in this file is either read out of `Research/` or is
 * labelled POLICY_ASSUMPTION, and the report at the bottom of the component
 * table says which is which for every one of the seven.
 *
 * ── THE FORMULA, IN ONE BLOCK ──────────────────────────────────────────────
 *
 *     base        = volume + intensity + longRunLoad
 *     upliftFrac  = stackingFrac + adaptationFrac + recoveryFrac + injuryFrac
 *     demandIndex = base * (1 + upliftFrac)
 *
 * and the four context components are reported as the EEM they each add:
 *
 *     stacking    = base * stackingFrac        (and so on)
 *
 * so the seven components SUM to `demandIndex` exactly. That is not a
 * presentational nicety. It is what makes the derivation readable by a human
 * without re-deriving it, which is the thing he asked for.
 *
 * ── RULE 11 IS THE SPINE ───────────────────────────────────────────────────
 *
 * A component that cannot be computed carries `contribution: null`. Never 0.
 * Zero means measured zero: a rest week really is a rest week, and a runner
 * with one hard session really does have zero stacking. When a REQUIRED
 * component is null, `demandIndex` is null and `unknownComponents` names it.
 * There is no fallback, no default and no partial index, because every one of
 * those makes a week look cheaper than it is, and `docs/
 * PLAN_SIMPLIFICATION_DOCTRINE.md` invariant 11 forbids exactly that:
 * "Missing or unreliable data cannot silently create a more aggressive plan."
 *
 * `injury` is the ONE component that is not required, and it is not required
 * because the owner scoped automatic injury intervention out of this
 * programme. It is read, never detected, and its absence is NAMED in
 * `unknownComponents` and stated in `explain` rather than passing silently.
 *
 * ── RULE 8 · WHICH SIDE OF THE COROLLARY EACH READER IS ON ─────────────────
 *
 * The rule says a taper or a recovery window is never the runner's NORMAL,
 * and its corollary says to filter a reader that asks what he CAN DO and not
 * one that asks what he HAS RECENTLY ABSORBED. This module sits on both sides
 * at once, so each reader states its side:
 *
 *   ABSORBED LOAD · UNFILTERED. Everything that prices the COST of the week:
 *     `longestRunPrior30dMi` (the spike anchor, which `Research/00a` writes
 *     its own 30-day window into), `acwr`, `lastRace`, `weeksSinceLastCutback`.
 *     A taper week is a real week his legs really did. Filtering these would
 *     make a safety-relevant reading MORE permissive in precisely the case it
 *     exists for, which is the over-application Rule 8's corollary names.
 *
 *   HABIT AND CAPABILITY · FILTERED. `demonstratedWeeks`, which is the only
 *     input to `athleteCeiling`. This asks what he NORMALLY handles, so the
 *     CALLER must filter it through `lib/training/normal-window.ts` before
 *     handing it over. This module cannot do that itself and must not: that
 *     module statically imports `@/lib/db/pool`, and this one is pure. The
 *     contract is stated on the field and asserted in the suite by a test
 *     that reads this file's own text, since a comment nothing verifies is a
 *     hypothesis (Rule 20).
 *
 * ── THE CEILING COMPARISON IS SYMMETRIC OR IT IS NOTHING ───────────────────
 *
 * The first cut of this file compared the proposed week's full seven-component
 * `demandIndex` against a ceiling that was `baseCostOfWeek()` — volume plus
 * intensity plus a flat long-run surcharge, and nothing else. So the proposed
 * week was charged for its stacking, its ACWR and its recovery debt while the
 * demonstrated week it was measured against was not. That is apples to
 * oranges, and it fails in ONE direction: every week with two or more hard
 * sessions reads inflated, and the inflation grows with exactly the thing the
 * model was built to price. On the owner's 2026-10-26 week it read 157% of a
 * ceiling that a like-for-like comparison puts at 130%.
 *
 * That is not a rounding concern. An "at ceiling" verdict is what suppresses a
 * progression, and CLAUDE.md Rule 22 measured this repo's standing bias:
 * 29 test files know how to hold a runner back and 2 know what accelerating
 * means; 309 production adaptations with zero upward. A defect that inflates
 * the proposed side and deflates the demonstrated side pushes the engine in
 * the direction it is already wrong.
 *
 * So the comparison now names a BASIS, and both sides go through the SAME
 * function on it (`ceilingCostOf`, which is the only place either side is
 * computed):
 *
 *   FULL_CONTEXT   all six required components, both sides priced by
 *                  `priceWeek`. Available only when EVERY absorbed week
 *                  carries a `context` that prices without refusing.
 *   BASE_ONLY      volume + intensity + the FLAT long-run surcharge, both
 *                  sides via `baseCostOfWeek`. The four context uplifts AND
 *                  the long-run spike term are excluded from BOTH sides,
 *                  because the historical prior-30-day anchor is not known.
 *
 * Note the spike term specifically. "Compare base to base" is itself still
 * mixed if the proposed side's base carries a spike measured against a
 * prior-30-day longest and the historical side's cannot. BASE_ONLY therefore
 * drops the spike from both, which is why the owner's like-for-like number is
 * 130% and not the 140% you get by comparing a spiked base against an
 * unspiked one.
 *
 * ── RULE 11 AT THE CEILING · A MISSING CONTEXT TERM IS NOT A ZERO ──────────
 *
 * When a demonstrated week's context cannot be reconstructed, the model does
 * NOT price its stacking at zero and call the result a ceiling. It degrades
 * the WHOLE comparison to BASE_ONLY, names the weeks it could not reconstruct
 * in `withoutContext`, and says so in `explain`. Degrading is chosen over
 * refusing outright because a labelled symmetric comparison is strictly more
 * informative than nothing and cannot be misread — the label is on the
 * returned value, not only in prose. What is never allowed is the mixture.
 *
 * `injury` is excluded from BOTH sides of the comparison on purpose. It is not
 * a required component, it is read and never detected, and it is never
 * reconstructable for a historical week — so including it on the proposed side
 * alone would rebuild the same defect in miniature. It stays in `demandIndex`,
 * which is the cost of the week, and stays out of `ceiling.proposed`, which is
 * the like-for-like comparison. Those are two quantities and they have two
 * names (Rule 16).
 *
 * ── RULE 9 · CONTINUOUS AND MONOTONE ───────────────────────────────────────
 *
 * Every response here runs continuously through doctrine's numbers rather
 * than stepping at them. `Research/15` asks for this in as many words about
 * the one input where it is easiest to get wrong: "treat ACWR as a
 * directional sanity check, not a stop-light ... a ratio of 1.4 in itself is
 * not a verdict." So 0.8, 1.3 and 1.5 stay exactly where Gabbett put them and
 * only the RESPONSE moves through them. `_weekly_demand_continuity.test.ts`
 * walks every continuous input and fails on any step or any inversion, and it
 * was falsified against a deliberately stepped copy first.
 *
 * `atCeiling` is the one discrete readout in the file. That is legal under
 * Rule 9, which permits discrete BEHAVIOUR and forbids a DECISION hinging on
 * a hair: nothing may act on this module at all (see the next block), and the
 * continuous quantity behind the boolean is reported in `explain`.
 *
 * ── DOCTRINE POSTURE · OBSERVATIONAL ONLY ──────────────────────────────────
 *
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md`, locked 2026-09-02, removed decision
 * authority from readiness, sleep, HRV, resting HR, TSB, illness and injury,
 * and from "any hidden rule that silently makes the plan easier or
 * reorganizes it". It also says: "Where historical data must survive for
 * compatibility, it becomes observational only."
 *
 * This module is observational. It EXPLAINS what a week costs. It must not be
 * wired into a plan mutation, and no caller may read `atCeiling` as licence to
 * shrink a week. Two consequences are built in rather than asked for:
 *
 *   1 · the only component that can LOWER demand is `recentAdaptation`, and
 *       only from a fact about his own mileage (`acwr` below Gabbett's sweet
 *       spot means he is fresh). Recovery and injury context can only ever
 *       RAISE the cost of a week or be null, so no unreadable signal can make
 *       a week look easy.
 *   2 · wearable recovery scores are DELIBERATELY ABSENT. Sleep, HRV and
 *       resting HR are named in the doctrine's removal list. `recovery` here
 *       reads the recovery the CALENDAR affords, which is a plan fact with
 *       two doctrine tables behind it, not a wrist score.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * It cannot tell whether the five POLICY_ASSUMPTION magnitudes are the RIGHT
 * magnitudes. Calibrating them needs outcome data this app does not have, and
 * every test here proves internal consistency, continuity, the citations that
 * do exist, and the Rule 11 branching. It cannot prove the model is true. The
 * labelling is the defence: a reader can see in one column which five numbers
 * are ours and argue with them, which is the whole reason `provenance` is on
 * every component rather than in a comment.
 */
import type { AcwrResult } from '@/lib/coach/acwr';
import type { SafetyResolution } from '@/lib/safety/safety-verdict';
import { ACWR_BANDS } from '@/lib/coach/tier-rules';
import {
  QUALITY_MINUTE_TO_EASY_MILE,
  LONG_RUN_SURCHARGE_PER_MI,
  PACE_SEC_PER_MI_TO_QUALITY_COST,
} from '@/lib/adaptation/canonical/plan-load';
import type { DoctrineCitation } from './contract';

/* NOTE ON IMPORT DIRECTION. Every runtime import above is a leaf with no
 * imports of its own (`tier-rules.ts` and `plan-load.ts` both open with a
 * docblock and then declare), so this module reaches no database at any depth.
 * The two `import type` lines are erased at compile time and emit nothing.
 * `_weekly_demand.test.ts` walks the transitive import graph from this file
 * and fails if a database edge ever appears, because Rule 19 was earned by a
 * header comment that asserted exactly this claim and was false for a day. */

/* ══════════════════════════════════════════════════════════════════════════
 * THE PUBLIC SHAPE
 * ═══════════════════════════════════════════════════════════════════════ */

export type DemandComponentKey =
  | 'volume' | 'intensity' | 'longRunLoad' | 'stacking'
  | 'recentAdaptation' | 'recovery' | 'injury';

/**
 * Where a component's NUMBER comes from. Deliberately about the magnitude and
 * not about the trigger: several components below fire on a condition doctrine
 * states and then scale by a coefficient nobody has calibrated, and calling
 * those CALCULATED_PHYSIOLOGY would be the exact defect this file was written
 * to remove. Where a component mixes the two, it is labelled by its weakest
 * part and `basis` says which half is cited.
 */
export type DemandProvenance =
  /** The number falls out of a `Research/` figure or out of the unit itself. */
  | 'CALCULATED_PHYSIOLOGY'
  /** The number is driven by this runner's own measured history. */
  | 'ATHLETE_EVIDENCE'
  /** We chose it. No research behind the magnitude. Argue with it. */
  | 'POLICY_ASSUMPTION';

export interface DemandComponent {
  readonly key: DemandComponentKey;
  /** Equivalent easy miles. `null` means unknown and NEVER stands in for 0. */
  readonly contribution: number | null;
  readonly provenance: DemandProvenance;
  /** The citation or the measurement. */
  readonly basis: string;
  readonly why: string;
}

/**
 * Which component set BOTH sides of the ceiling comparison are priced on.
 *
 * There is no third value and there is deliberately no default. A comparison
 * without a stated basis is the defect this type exists to make unsayable.
 */
export type CeilingBasis =
  /** All six required components, both sides through `priceWeek`. */
  | 'FULL_CONTEXT'
  /** Volume + intensity + the FLAT long-run surcharge, both sides. */
  | 'BASE_ONLY';

/**
 * The proposed week measured against the biggest week he has absorbed, with
 * both numbers produced by one call each to `ceilingCostOf` on one basis.
 *
 * `proposed` is NOT `demandIndex`. It is this week priced on `basis`, which is
 * what makes it comparable to `ceiling`. Reading `demandIndex / ceiling` is
 * the original defect and the suite fails on it by name.
 */
export interface CeilingComparison {
  readonly basis: CeilingBasis;
  /** This week, on `basis`. Equivalent easy miles. */
  readonly proposed: number | null;
  /** His biggest absorbed week, on the SAME basis. Equivalent easy miles. */
  readonly ceiling: number | null;
  /** `proposed / ceiling`. Null when either side is null. */
  readonly ratio: number | null;
  readonly from: DemonstratedWeek | null;
  readonly considered: number;
  /**
   * Absorbed weeks whose context could not be priced, which is WHY the basis
   * degraded. Empty on FULL_CONTEXT. Never silently zeroed (Rule 11).
   */
  readonly withoutContext: readonly string[];
  /** Why this basis and not the other, in one sentence. */
  readonly reason: string;
}

export interface WeeklyDemand {
  readonly weekStartISO: string;
  readonly components: readonly DemandComponent[];
  /**
   * What the week COSTS: all seven components, injury included when a human
   * recorded one. Equivalent easy miles. Null when a required component is
   * unknown. This is not the number compared against the ceiling — see
   * `ceiling.proposed`, which is this week on the ceiling's own basis.
   */
  readonly demandIndex: number | null;
  readonly unknownComponents: readonly string[];
  /**
   * The like-for-like comparison, or null when there is no absorbed week to
   * compare against. Both sides are on `ceiling.basis`.
   */
  readonly ceiling: CeilingComparison | null;
  /** `ceiling.ceiling`, kept for readers that want the one number. */
  readonly athleteCeiling: number | null;
  /** `ceiling.proposed >= ceiling.ceiling`, on one basis for both sides. */
  readonly atCeiling: boolean | null;
  readonly explain: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE CITATIONS
 *
 * `source` is the doctrine file and `section` is a VERBATIM heading in it,
 * never a line number, exactly as `lib/doctrine/registry.ts` claims are
 * written. `_weekly_demand_citations.test.ts` resolves every anchor against
 * the real file and parses the numbers below back out of the tables under it,
 * so a check that hardcodes both sides cannot pass by agreeing with itself.
 * ═══════════════════════════════════════════════════════════════════════ */

export const DEMAND_CITATIONS = {
  volume: {
    source: 'Research/00a-distance-running-training.md',
    section: '### Volume progression rules',
    says: 'Doctrine prices a training week in miles per week, and the whole '
      + 'volume-progression table is written in that unit.',
    force: 'GUIDELINE',
  },
  intensity: {
    source: 'Research/00a-distance-running-training.md',
    section: '## Training Intensity Distribution (TID)',
    says: 'Quality running is a different and larger dose than easy running. '
      + 'The table gives SHARES and no load equivalence, so the coefficient '
      + 'here is not read from it.',
    force: 'GUIDELINE',
  },
  longRunSpike: {
    source: 'Research/00a-distance-running-training.md',
    section: '### Volume progression rules',
    says: 'An individual run over 110% of the longest run in the prior 30 days '
      + 'raises overuse injury risk by about 64%, and over 130% raises it '
      + 'further.',
    force: 'HARD_CONSTRAINT',
  },
  stacking: {
    source: 'Research/00a-distance-running-training.md',
    section: '### Practical load rules',
    says: 'Add stress one at a time: either add mileage or add intensity in a '
      + 'given week, not both. And leave 48 h between hard sessions.',
    force: 'GUIDELINE',
  },
  recentAdaptation: {
    source: 'Research/15-wearable-data.md',
    section: '### Acute:Chronic Workload Ratio (ACWR)',
    says: 'Gabbett zones: under 0.8 undertrained, 0.8 to 1.3 sweet spot, 1.3 '
      + 'to 1.5 caution, over 1.5 danger. And the paragraph under the table: '
      + 'a directional sanity check, not a stop-light.',
    force: 'HEURISTIC',
  },
  recoveryPostRace: {
    source: 'Research/00b-recovery-protocols.md',
    section: '### Recovery by Distance',
    says: 'Total recovery days with no quality, by race distance. The column '
      + 'next to it, days of zero or very-light running, is a different '
      + 'number and is not the one used here.',
    force: 'GUIDELINE',
  },
  recoveryCutback: {
    source: 'Research/00a-distance-running-training.md',
    section: '### Volume progression rules',
    says: 'Down weeks every 3 to 4 weeks, reducing volume by 20 to 30%.',
    force: 'GUIDELINE',
  },
  injury: {
    source: 'Research/00a-distance-running-training.md',
    section: '### Practical load rules',
    says: 'Past injury is the strongest predictor of the next one. No table '
      + 'anywhere in Research gives an open injury a load multiplier.',
    force: 'GUIDELINE',
  },
} as const satisfies Record<string, DoctrineCitation>;

function cite(k: keyof typeof DEMAND_CITATIONS): string {
  const c = DEMAND_CITATIONS[k];
  return `${c.source} ${c.section}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE COEFFICIENTS · five of them are ours and are labelled
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * CITED. `Research/00a` §"Volume progression rules", single-session spike
 * threshold row. The ratio at which the cited risk figure applies.
 */
export const LONG_RUN_SPIKE_RATIO = 1.10;

/**
 * CITED. The same row: about 64% increased overuse injury risk once the ratio
 * passes `LONG_RUN_SPIKE_RATIO`. The NUMBER is the document's.
 *
 * HOW IT IS SPENT IS OURS, and that has to be said out loud because it is the
 * seam where a cited figure could be dressed up as more than it is: 64% is a
 * RISK multiplier and nothing in `Research/` converts injury risk into
 * training load. This model spends it as a multiplier on the long run's OWN
 * surcharge, so a long run at exactly the threshold costs 1.64 times what the
 * same distance costs when it sits inside what he has recently run. That is
 * the most conservative honest reading available: the alternative, treating it
 * as 64% of the long run's MILES, would price a threshold-edge long run above
 * the entire rest of the week, which no reading of the source supports.
 */
export const LONG_RUN_SPIKE_RISK_UPLIFT = 0.64;

/**
 * POLICY. Fraction-of-base uplift for each PAIR of hard sessions in the week.
 *
 * `Research/00a` §"Practical load rules" is unambiguous that stress does not
 * stack ("add mileage OR add intensity in a given week, not both") and gives
 * no coefficient for what stacking costs. Nothing else in `Research/` does
 * either. So the SHAPE is doctrine and this MAGNITUDE is ours.
 *
 * Sized so the shape is visible and cannot dominate: three hard sessions
 * spaced at doctrine's 48 h give three pairs and a 12% uplift, and the same
 * three crowded onto back-to-back days give 24%. If you disagree with the
 * model, this is one of the five numbers to argue with.
 */
export const STACK_UPLIFT_PER_PAIR = 0.04;

/**
 * CITED. `Research/00a` §"Practical load rules", hard-session spacing row.
 * Hard sessions closer together than this are crowded, and the crowding
 * multiplier runs continuously from 1.0 at this spacing to 2.0 at zero.
 */
export const HARD_SESSION_SPACING_H = 48;

/**
 * POLICY. Fraction-of-base uplift at Gabbett's danger edge (ACWR 1.5).
 *
 * `Research/15` gives the ZONES and no effect size, and the trap not taken
 * here is the one `lib/coach/acwr.ts` names in its own header: `Research/00a`
 * does carry a 64% figure, and it belongs to the single-run spike, not to the
 * ratio. Binding this to it would be the two-adjacent-columns misread Rule 7
 * exists to prevent, with a citation that resolves and a claim that is still
 * wrong. Left as a labelled convention instead.
 */
export const ADAPTATION_UPLIFT_AT_DANGER = 0.15;

/**
 * POLICY. Fraction-of-base uplift at full recovery debt.
 *
 * Both TRIGGERS underneath it are cited and both are read out of their tables
 * by the citation gate: the post-race no-quality window from `Research/00b`
 * §"Recovery by Distance", and the down-week cadence from `Research/00a`
 * §"Volume progression rules". Neither doc prices what the debt COSTS.
 */
export const RECOVERY_DEBT_UPLIFT = 0.20;

/** CITED. `Research/00a` §"Volume progression rules", down-weeks row, upper
 *  bound of the 3 to 4 week band. Past this the debt starts accruing. */
export const CUTBACK_CADENCE_WEEKS = 4;

/** The width of the overdue ramp, in weeks. The band's own upper bound reused
 *  rather than a second number invented: debt reaches 1.0 at twice the cadence. */
export const CUTBACK_OVERDUE_RAMP_WEEKS = CUTBACK_CADENCE_WEEKS;

/**
 * POLICY. Fraction-of-base uplift per severity of a RECORDED open injury.
 *
 * `Research/00a` §"Practical load rules" says past injury is the strongest
 * predictor of the next one and stops there. No table in `Research/` gives an
 * open injury a load multiplier, and `lib/safety/safety-verdict.ts` records
 * the same finding for its own uncited threshold. These are ours.
 *
 * This does NOT detect anything and does not intervene. It prices context
 * that a human already recorded, which is the whole of what the owner scoped
 * in.
 */
export const INJURY_UPLIFT_BY_SEVERITY = {
  minor: 0.10,
  moderate: 0.25,
  major: 0.50,
} as const;

/**
 * POLICY. Fraction-of-base uplift for a recorded niggle, scaled by its 1 to 10
 * severity. A niggle is not an injury and is priced well under `minor`.
 */
export const NIGGLE_UPLIFT_AT_MAX_SEVERITY = 0.08;

/** The 1 to 10 scale `NiggleSignal.severity` is recorded on. */
const NIGGLE_SEVERITY_MAX = 10;

/**
 * The ACWR response curve, in fraction-of-`ADAPTATION_UPLIFT_AT_DANGER` units.
 *
 * The three inner abscissae are Gabbett's own edges, taken from `ACWR_BANDS`
 * in `lib/coach/tier-rules.ts` rather than retyped, so there is one copy of
 * that table in the app (Rule 16). The two outer ones are each one
 * caution-band width outside the sweet spot, derived from the table rather
 * than chosen, which is the same derivation `lib/coach/readiness.ts`
 * documents for `LOAD_CONTEXT_CURVE`.
 *
 * WHY THIS IS NOT `LOAD_CONTEXT_CURVE`. That curve answers a READINESS
 * question and returns a readiness multiplier. `PLAN_SIMPLIFICATION_DOCTRINE`
 * removed readiness from plan decisions, and importing the readiness module
 * into `lib/plan` would put it back. Same abscissae, different ordinate,
 * different question, different name. The abscissae agree because they are
 * both derived from `ACWR_BANDS` and neither owns them.
 *
 * The WHOLE sweet spot is flat at zero, in both directions: a runner is not
 * charged extra for an ordinary week and is not discounted for one either.
 */
export const ADAPTATION_CURVE: ReadonlyArray<readonly [acwr: number, frac: number]> =
  (() => {
    const bandWidth = ACWR_BANDS.danger - ACWR_BANDS.caution;
    return [
      [ACWR_BANDS.detraining - bandWidth, -1],
      [ACWR_BANDS.detraining, 0],
      [ACWR_BANDS.caution, 0],
      [ACWR_BANDS.danger, 1],
      [ACWR_BANDS.danger + bandWidth, 2],
    ] as const;
  })();

/* ══════════════════════════════════════════════════════════════════════════
 * THE INPUT
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * One week the runner COMPLETED, for sizing `athleteCeiling`.
 *
 * RULE 8, HABIT SIDE. This list asks what he NORMALLY handles, so the CALLER
 * must have excluded prescribed taper, race and post-race-recovery days with
 * `lib/training/normal-window.ts` before handing it over. This module is pure
 * and cannot apply the filter itself: `normal-window.ts` statically imports
 * `@/lib/db/pool`.
 */
/**
 * The four context terms as they stood for a week the runner already ran.
 *
 * This exists so the demonstrated week can be priced by the SAME function as
 * the proposed one. Every field here is reconstructable from the run and race
 * history the caller already holds — where the hard days fell, what his
 * prior-30-day longest was at the time, his acute-to-chronic ratio that week,
 * how long since a race and since a down week.
 *
 * A field left `null` is "not reconstructed", and it refuses rather than
 * pricing at zero. That refusal degrades the whole comparison to BASE_ONLY
 * for BOTH sides, which is the honest outcome; pricing a historical week's
 * stacking at zero while charging the proposed week for its own is the
 * apples-to-oranges defect this type was added to remove.
 *
 * `safety` is absent by design. Injury is read and never detected, is never
 * reconstructable for a past week, and is excluded from both sides of the
 * comparison — see the header block on the ceiling comparison.
 */
export interface DemonstratedWeekContext {
  /** Where that week's hard sessions fell. See `WeekCostInput`. */
  readonly hardSessionDayOrdinals: readonly number[] | null;
  /** His longest run in the 30 days BEFORE that week, literal. */
  readonly longestRunPrior30dMi: number | null;
  /** His acute-to-chronic ratio as it stood that week. */
  readonly acwr: AcwrResult | null;
  /**
   * The race behind him at that week, or `'NONE'`.
   *
   * A caller that has applied Rule 8's habit filter has already dropped every
   * week inside a post-race no-quality window, so this term is usually zero by
   * the filter's own guarantee. It is still supplied rather than assumed,
   * because "the filter would have caught it" is not a fact about this week.
   */
  readonly lastRace: LastRaceContext | 'NONE' | null;
  readonly weeksSinceLastCutback: number | null;
}

export interface DemonstratedWeek {
  readonly weekStartISO: string;
  readonly weeklyMi: number;
  readonly longRunMi: number;
  readonly qualityMinutes: number;
  /**
   * Did he ABSORB it. Not "did he run it".
   *
   * `null` is unknown and unknown does NOT raise the ceiling. That is
   * `PLAN_SIMPLIFICATION_DOCTRINE` invariant 11 applied at the one place in
   * this file where a missing fact could make the next plan more aggressive:
   * a week nobody has judged is not evidence of capacity.
   */
  readonly absorbed: boolean | null;
  /**
   * That week's own context, or `null` for "not reconstructed".
   *
   * REQUIRED, not optional, so every construction site has to say which it is.
   * An optional field would let a caller omit context by accident and get a
   * silently base-only ceiling, which is how the mixed-basis defect got in.
   */
  readonly context: DemonstratedWeekContext | null;
}

/** A race he actually ran, and the recovery window doctrine gives it. */
export interface LastRaceContext {
  readonly daysSince: number;
  /**
   * `Research/00b` §"Recovery by Distance", the "Total recovery days (no
   * quality)" column, upper bound. Supply this from
   * `raceWindowFor(distanceMi, true)` in `lib/coach/easy-discipline.ts`,
   * which is the app's one owner of that number (Rule 16). It is passed in
   * rather than resolved here because that module imports the database.
   */
  readonly noQualityWindowDays: number;
}

/**
 * Everything needed to PRICE one week, and nothing about any other week.
 *
 * A demonstrated week is mapped onto this same shape before it is priced, so
 * the historical side and the proposed side go through one function. That is
 * the whole point of the split: `WeeklyDemandInput` adds the comparison set,
 * and the comparison set must not be reachable from the pricing code, or the
 * two sides can drift apart again.
 */
export interface WeekCostInput {
  readonly weekStartISO: string;

  /* ── THE WEEK BEING PRICED ─────────────────────────────────────────── */

  /** Total prescribed or completed miles in the week. */
  readonly weeklyMi: number | null;
  /** Minutes of running at threshold pace or faster, plus race-pace work. */
  readonly qualityMinutes: number | null;
  /** The week's single longest run. */
  readonly longRunMi: number | null;
  /**
   * Day ordinals of the week's HARD sessions, on any consistent origin, in
   * days. Fractional values are honoured so a caller that knows session times
   * can supply them. The long run counts as a hard session.
   *
   * An EMPTY array is a measured fact (an all-easy week) and prices stacking
   * at 0. `null` means the caller does not know where the hard days fall, and
   * prices it at `null`.
   */
  readonly hardSessionDayOrdinals: readonly number[] | null;

  /**
   * How far this week's threshold ANCHOR has been moved from the anchor the
   * plan was authored at, in seconds per mile. Negative is faster, which is
   * more demanding.
   *
   * OPTIONAL, AND THE OMITTED VALUE IS A MEASURED ZERO, NOT AN UNKNOWN. That
   * is the one place in this file where a default is allowed, and the reason
   * is that this field is a property of a PROPOSAL rather than a measurement
   * of the runner: a week nobody has proposed anything against is priced at
   * the anchor it was written at, and a week he has already run was run at its
   * own anchor by definition. There is no third state to lose, so Rule 11 has
   * nothing to protect here. Everywhere else in this type an absent number
   * means "nobody looked" and is priced `null`.
   *
   * It exists so `lib/adaptation/canonical/arbitration.ts` can price the
   * PROJECTED week — the one carrying a proposal — through the same function
   * that prices the ceiling. Before it, arbitration had a second, three-term
   * scale of its own, and the two sides of its rule-1 comparison were built by
   * different arithmetic (Rule 16). The coefficient is
   * `PACE_SEC_PER_MI_TO_QUALITY_COST`, imported from `plan-load.ts` rather
   * than restated, so there is still one number.
   */
  readonly thresholdAnchorDeltaSecPerMi?: number;

  /* ── ABSORBED LOAD · RULE 8 SAYS DO NOT FILTER THESE ───────────────── */

  /**
   * His longest single run in the prior 30 days, LITERAL.
   *
   * RULE 8, SPIKE-ANCHOR SIDE. `Research/00a` writes its own window into the
   * citation ("the longest run in the prior 30 d"), and CLAUDE.md names this
   * exact reader as the worked example of a quantity whose habit half is
   * filtered and whose spike anchor stays literal. A taper long run is a real
   * run his legs really did, and hiding it would wave through a jump they have
   * not been prepared for.
   */
  readonly longestRunPrior30dMi: number | null;

  /**
   * From `acwrFromDailyMileage` in `lib/coach/acwr.ts`, which is the app's one
   * implementation (Rule 16). Passed in rather than computed here because the
   * loader half of that module reads the database.
   *
   * Three states arrive intact and stay distinguishable: `null` means the
   * caller did not compute it, a result whose `acwr` is null carries the
   * resolver's own `reason` for refusing, and a real ratio is a real ratio.
   *
   * RULE 8, ABSORBED-LOAD SIDE. Acute load is SUPPOSED to move with recent
   * load. That is what makes it acute.
   */
  readonly acwr: AcwrResult | null;

  /**
   * `null` is unknown. The string `'NONE'` is the KNOWN fact that he has not
   * raced, which prices the post-race half of recovery debt at 0 rather than
   * refusing. Rule 11: those are two different facts and they are two values.
   *
   * RULE 8, ABSORBED-LOAD SIDE. This reader exists to look at race weeks.
   */
  readonly lastRace: LastRaceContext | 'NONE' | null;

  /**
   * Weeks since his last authored cutback or down week. Where he has never
   * had one, supply weeks since the block opened, which is the same question.
   *
   * RULE 8, ABSORBED-LOAD SIDE. Time since the tissue last got a break.
   */
  readonly weeksSinceLastCutback: number | null;

  /* ── RECORDED INJURY CONTEXT · READ, NEVER DETECTED ────────────────── */

  /**
   * From `resolveSafety` in `lib/safety/load-safety.ts`, the app's one owner
   * of the injury, illness and niggle reads (Rule 16). `null` means the caller
   * did not resolve safety at all.
   *
   * This module builds NO injury detection. The owner scoped automatic injury
   * intervention out of this programme, so the component reads what a human
   * already recorded and otherwise reports unknown.
   */
  readonly safety: SafetyResolution | null;
}

export interface WeeklyDemandInput extends WeekCostInput {
  /* ── HABIT · RULE 8 SAYS FILTER THIS ──────────────────────────────── */

  /**
   * `null` is "the caller did not look". An EMPTY array is "the caller looked
   * and there are none", which is a different fact and produces a different
   * sentence in `explain`. Both give a null ceiling, and neither is a zero.
   */
  readonly demonstratedWeeks: readonly DemonstratedWeek[] | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ARITHMETIC HELPERS · deliberately boring
 * ═══════════════════════════════════════════════════════════════════════ */

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function isReal(x: number | null | undefined): x is number {
  return x != null && Number.isFinite(x);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Piecewise-linear interpolation over a sorted control-point list, flat
 *  outside the ends. Continuous everywhere by construction, which is the
 *  property Rule 9 asks for. */
function interpolate(
  curve: ReadonlyArray<readonly [number, number]>,
  x: number,
): number {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i];
    const [x1, y1] = curve[i + 1];
    if (x >= x0 && x <= x1) {
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE SEVEN PIECES
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * How far past his own prior-30-day longest this week's long run reaches,
 * expressed against doctrine's 110% threshold: 0 at or under the prior
 * longest, 1.0 exactly AT 110%, and rising linearly past it.
 *
 * Deliberately UNBOUNDED above. `Research/00a` says over 130% raises risk
 * further and does not say where it stops, and a term that flattens out stops
 * telling an aggressive prescription apart from an absurd one. The cost of the
 * choice is that a long run at double his longest prices very high, which is
 * a faithful reading of an input that should never be authored.
 */
export function longRunSpikeFraction(
  longRunMi: number,
  longestPrior30dMi: number,
): number {
  if (!(longestPrior30dMi > 0)) return 0;
  const ratio = longRunMi / longestPrior30dMi;
  return Math.max(0, (ratio - 1) / (LONG_RUN_SPIKE_RATIO - 1));
}

/** Pairs of hard sessions, and how crowded the tightest pair is. */
export function stackingShape(ordinals: readonly number[]): {
  readonly pairs: number;
  readonly minGapH: number | null;
  readonly crowding: number;
} {
  const n = ordinals.length;
  const pairs = (n * (n - 1)) / 2;
  if (pairs === 0) return { pairs: 0, minGapH: null, crowding: 1 };
  const sorted = [...ordinals].sort((a, b) => a - b);
  let minGapH = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    minGapH = Math.min(minGapH, (sorted[i] - sorted[i - 1]) * 24);
  }
  const crowding =
    1 + clamp((HARD_SESSION_SPACING_H - minGapH) / HARD_SESSION_SPACING_H, 0, 1);
  return { pairs, minGapH, crowding };
}

/**
 * The ACWR response as a fraction of base. Continuous through Gabbett's
 * numbers rather than stepping at them, which is what `Research/15` asks for
 * one paragraph under its own zone table.
 */
export function adaptationFraction(acwr: number): number {
  return ADAPTATION_UPLIFT_AT_DANGER * interpolate(ADAPTATION_CURVE, acwr);
}

/**
 * Recovery debt in 0 to 1, from two cited triggers.
 *
 * Post-race overlap runs from 1.0 on race day to 0 at the end of doctrine's
 * no-quality window. Cutback debt starts at the upper bound of the 3 to 4 week
 * down-week band and reaches 1.0 one further cadence later. They are summed
 * and clamped, so a week that is both fresh off a marathon and six weeks
 * without a down week does not price the two separately and then twice.
 */
export function recoveryDebt(
  lastRace: LastRaceContext | 'NONE',
  weeksSinceLastCutback: number,
): { readonly debt: number; readonly raceOverlap: number; readonly cutbackOverdue: number } {
  const raceOverlap =
    lastRace === 'NONE' || !(lastRace.noQualityWindowDays > 0)
      ? 0
      : clamp(
        (lastRace.noQualityWindowDays - lastRace.daysSince)
            / lastRace.noQualityWindowDays,
        0,
        1,
      );
  const cutbackOverdue = clamp(
    (weeksSinceLastCutback - CUTBACK_CADENCE_WEEKS) / CUTBACK_OVERDUE_RAMP_WEEKS,
    0,
    1,
  );
  return { debt: clamp(raceOverlap + cutbackOverdue, 0, 1), raceOverlap, cutbackOverdue };
}

/**
 * The injury component, which reads and never detects.
 *
 * Every branch returns `null`, including the one where the resolver read every
 * table and found nothing open. That is the owner's scoping decision applied
 * literally: automatic injury intervention is out of this programme, so injury
 * context is kept OUT of `demandIndex` by construction rather than by a zero
 * that a later reader could mistake for evidence of health. The three cases
 * stay distinguishable in `why`, which is the part Rule 11 actually protects,
 * and `unknownComponents` always names it so the absence is stated.
 *
 * When a human HAS recorded an open injury or niggle, it is priced. That is
 * the only branch that produces a number.
 */
function injuryComponent(safety: SafetyResolution | null): DemandComponent {
  const basis = cite('injury');
  if (safety == null) {
    return {
      key: 'injury',
      contribution: null,
      provenance: 'POLICY_ASSUMPTION',
      basis,
      why: 'No safety resolution was supplied, so injury context is unknown. '
        + 'It is named here rather than priced at zero, and it is left out of '
        + 'the index rather than guessed.',
    };
  }
  if (!safety.known) {
    const names = safety.unreadable.map((u) => `${u.signal}:${u.failure}`).join(', ');
    return {
      key: 'injury',
      contribution: null,
      provenance: 'POLICY_ASSUMPTION',
      basis,
      why: `The safety resolver could not read ${names}. A failed read is not `
        + 'evidence that nothing is wrong, so this is unknown and stays out of '
        + 'the index.',
    };
  }
  const injury = safety.injury;
  const niggle = safety.niggle;
  if (injury == null && niggle == null) {
    return {
      key: 'injury',
      contribution: null,
      provenance: 'POLICY_ASSUMPTION',
      basis,
      why: 'The safety resolver read every table and found no open injury and '
        + 'no open niggle. Automatic injury intervention is out of scope for '
        + 'this programme, so that clean read is reported rather than priced.',
    };
  }
  const injuryFrac = injury == null ? 0 : INJURY_UPLIFT_BY_SEVERITY[injury.severity];
  const niggleFrac = niggle == null
    ? 0
    : NIGGLE_UPLIFT_AT_MAX_SEVERITY
      * clamp(niggle.severity / NIGGLE_SEVERITY_MAX, 0, 1);
  const parts: string[] = [];
  if (injury != null) parts.push(`a ${injury.severity} injury at the ${injury.site}, open since ${injury.startDateISO}`);
  if (niggle != null) parts.push(`a niggle at the ${niggle.bodyPart} logged at severity ${niggle.severity} of ${NIGGLE_SEVERITY_MAX}`);
  return {
    key: 'injury',
    contribution: injuryFrac + niggleFrac,
    provenance: 'POLICY_ASSUMPTION',
    basis,
    why: `Recorded: ${parts.join(' and ')}. Read from what a human logged, not `
      + 'detected. The uplift is ours: no table in Research prices an open '
      + 'injury, and this number carries no research behind it.',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE CEILING · Rule 8 HABIT side
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The base cost of one completed week, in the same unit as `demandIndex`.
 *
 * With `thresholdAnchorDeltaSecPerMi` omitted or zero this is byte-for-byte
 * `projectPlanLoad(...).demandIndex` for the same week, and with it supplied
 * it stays byte-for-byte equal for the same delta. That identity is what makes
 * BASE_ONLY and the arbitration scale ONE quantity rather than two that happen
 * to agree today, and `_weekly_demand.test.ts` asserts it in both directions.
 */
export function baseCostOfWeek(w: {
  readonly weeklyMi: number;
  readonly longRunMi: number;
  readonly qualityMinutes: number;
  readonly thresholdAnchorDeltaSecPerMi?: number;
}): number {
  return w.weeklyMi
    + w.qualityMinutes * QUALITY_MINUTE_TO_EASY_MILE * anchorCostMultiplier(w.thresholdAnchorDeltaSecPerMi)
    + w.longRunMi * LONG_RUN_SURCHARGE_PER_MI;
}

/**
 * What moving the threshold anchor does to the cost of the SAME quality
 * minutes. One expression, called from `baseCostOfWeek` and from the intensity
 * component, so the two pricing paths cannot disagree about it.
 *
 * A faster anchor (a negative delta) makes the same work harder, which is why
 * the sign is inverted — the contract's "do not pretend pace changes are
 * load-neutral", in one line.
 */
export function anchorCostMultiplier(deltaSecPerMi: number | undefined): number {
  const d = isReal(deltaSecPerMi) ? deltaSecPerMi : 0;
  return 1 + -d * PACE_SEC_PER_MI_TO_QUALITY_COST;
}

/* NOTE · `athleteCeilingFrom` IS GUARDED AS REMOVED.
 *
 * It used to return `baseCostOfWeek(best)` and was compared against the
 * proposed week's full `demandIndex`. That mixed basis is the defect this
 * section was rewritten to remove, so the function is deleted rather than
 * deprecated: a "// legacy, don't call" shortcut is one someone calls.
 * `_weekly_demand.test.ts` fails if the identifier reappears in this file. */

/** Map a week the runner already ran onto the shape the pricer takes. */
export function demonstratedWeekAsInput(w: DemonstratedWeek): WeekCostInput {
  return {
    weekStartISO: w.weekStartISO,
    weeklyMi: w.weeklyMi,
    qualityMinutes: w.qualityMinutes,
    longRunMi: w.longRunMi,
    hardSessionDayOrdinals: w.context?.hardSessionDayOrdinals ?? null,
    longestRunPrior30dMi: w.context?.longestRunPrior30dMi ?? null,
    acwr: w.context?.acwr ?? null,
    lastRace: w.context?.lastRace ?? null,
    weeksSinceLastCutback: w.context?.weeksSinceLastCutback ?? null,
    // Injury is excluded from BOTH sides of the comparison. See the header.
    safety: null,
    // A week he already ran was run at its own anchor. Stated rather than
    // left to the default, because this is the side of the comparison where a
    // silent anchor term would be a fabrication about the past.
    thresholdAnchorDeltaSecPerMi: 0,
  };
}

/**
 * THE ONLY PLACE EITHER SIDE OF THE CEILING COMPARISON IS COMPUTED.
 *
 * Both the proposed week and every demonstrated week go through this one
 * function on one basis, so they are commensurable by construction rather
 * than by coincidence. If you find yourself computing one side any other way,
 * that is the bug.
 *
 * BASE_ONLY deliberately uses `baseCostOfWeek`, which carries the FLAT
 * long-run surcharge and no spike. A base that includes a spike measured
 * against a prior-30-day anchor on one side and cannot on the other is still
 * a mixed comparison, just a subtler one.
 */
export function ceilingCostOf(
  week: WeekCostInput,
  basis: CeilingBasis,
): number | null {
  if (basis === 'BASE_ONLY') {
    if (!isReal(week.weeklyMi) || !isReal(week.longRunMi) || !isReal(week.qualityMinutes)) {
      return null;
    }
    return round3(baseCostOfWeek({
      weeklyMi: week.weeklyMi,
      longRunMi: week.longRunMi,
      qualityMinutes: week.qualityMinutes,
      thresholdAnchorDeltaSecPerMi: week.thresholdAnchorDeltaSecPerMi,
    }));
  }
  const priced = priceWeek(week);
  if (priced.missingRequired.length > 0) return null;
  let total = 0;
  for (const key of REQUIRED_COMPONENTS) {
    const c = priced.components.find((x) => x.key === key);
    if (c == null || c.contribution == null) return null;
    total += c.contribution;
  }
  return round3(total);
}

/* ══════════════════════════════════════════════════════════════════════════
 * PRICING A PROJECTED WEEK · the arbitration seam
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Everything about a week EXCEPT the four quantities a lever can move.
 *
 * Split out so a caller can hold one context and price many candidate weeks
 * against it, which is precisely what plan-level arbitration does: it projects
 * the same week half a dozen ways (base, with volume applied, with volume plus
 * the long run, and so on) and every one of those projections has to be priced
 * by the same function on the same basis as the ceiling, or the comparison is
 * apples to oranges again.
 *
 * `weekStartISO` stays here because it identifies the week and no lever moves
 * it.
 */
export type WeekDemandContext = Omit<
  WeekCostInput,
  'weeklyMi' | 'longRunMi' | 'qualityMinutes' | 'thresholdAnchorDeltaSecPerMi'
>;

/** The four quantities a canonical lever can move. */
export interface ProjectedWeekQuantities {
  readonly weeklyMi: number;
  readonly longRunMi: number;
  readonly qualityMinutes: number;
  /** Signed, against the anchor the plan was authored at. Negative is faster. */
  readonly thresholdAnchorDeltaSecPerMi: number;
}

/**
 * A context that knows NOTHING but the week's date.
 *
 * Every context term is `null`, which per this file's Rule 11 spine means
 * unknown, so `ceilingCostOf(..., 'FULL_CONTEXT')` refuses against it and only
 * BASE_ONLY prices. That is the correct behaviour and it is the reason this
 * constant exists rather than a caller hand-rolling `{ acwr: null, ... }`:
 * a hand-rolled context is a place a future field can be silently forgotten,
 * and a forgotten field defaults to a cheaper week.
 */
export const unknownWeekDemandContext = (weekStartISO: string): WeekDemandContext => ({
  weekStartISO,
  hardSessionDayOrdinals: null,
  longestRunPrior30dMi: null,
  acwr: null,
  lastRace: null,
  weeksSinceLastCutback: null,
  safety: null,
});

/**
 * PRICE ONE PROJECTION OF A WEEK, ON THE BASIS THE CEILING WAS BUILT ON.
 *
 * The only function plan-level arbitration may use to price a week. It goes
 * through `ceilingCostOf`, which is the only place either side of the ceiling
 * comparison is computed, so the projected week and the ceiling are
 * commensurable by construction rather than by coincidence (Rule 16).
 *
 * Returns `null` when the week cannot be priced on that basis — a refusal, not
 * a zero. A caller that reads `null` as "no demand" has reintroduced the exact
 * defect Rule 11 exists to stop.
 */
export function priceProjectedWeek(
  context: WeekDemandContext,
  week: ProjectedWeekQuantities,
  basis: CeilingBasis,
): number | null {
  return ceilingCostOf({ ...context, ...week }, basis);
}

/**
 * The proposed week against the biggest week he has demonstrated he ABSORBS,
 * both on one basis.
 *
 * Only weeks marked `absorbed === true` count. A week nobody has judged does
 * not raise the ceiling, because a higher ceiling licenses a bigger plan and
 * `PLAN_SIMPLIFICATION_DOCTRINE` invariant 11 forbids missing data doing that.
 *
 * The basis is FULL_CONTEXT only when EVERY absorbed week prices without
 * refusing. One unreconstructable week degrades the whole comparison rather
 * than being dropped from it, because dropping weeks lowers the ceiling and
 * a lower ceiling is the restrictive direction this fix exists to stop the
 * model leaning in.
 */
export function compareToAthleteCeiling(
  proposed: WeekCostInput,
  weeks: readonly DemonstratedWeek[] | null,
): CeilingComparison | null {
  if (weeks == null) return null;
  const absorbed = weeks.filter((w) => w.absorbed === true);
  if (absorbed.length === 0) return null;

  const priced = absorbed.map((w) => ({
    week: w,
    full: ceilingCostOf(demonstratedWeekAsInput(w), 'FULL_CONTEXT'),
  }));
  const withoutContext = priced
    .filter((p) => p.full == null)
    .map((p) => p.week.weekStartISO);

  const basis: CeilingBasis = withoutContext.length === 0 ? 'FULL_CONTEXT' : 'BASE_ONLY';

  let best: DemonstratedWeek | null = null;
  let ceiling: number | null = null;
  for (const w of absorbed) {
    const c = ceilingCostOf(demonstratedWeekAsInput(w), basis);
    if (c == null) continue;
    if (ceiling == null || c > ceiling) { ceiling = c; best = w; }
  }

  const proposedCost = ceilingCostOf(proposed, basis);
  const ratio = proposedCost == null || ceiling == null || ceiling === 0
    ? null
    : proposedCost / ceiling;

  const reason = basis === 'FULL_CONTEXT'
    ? `All ${absorbed.length} absorbed weeks carry a reconstructed context, so `
      + 'both sides are priced on all six required components by the same '
      + 'function. Injury is excluded from both, because it is never '
      + 'reconstructable for a past week.'
    : `${withoutContext.length} of ${absorbed.length} absorbed weeks could not `
      + `be priced in context (${withoutContext.join(', ')}), so BOTH sides drop `
      + 'to volume, quality and the flat long-run surcharge. The four context '
      + 'uplifts and the long-run spike term are excluded from the proposed '
      + 'week too, not just from the ceiling.';

  return { basis, proposed: proposedCost, ceiling, ratio, from: best, considered: absorbed.length, withoutContext, reason };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE MODEL
 * ═══════════════════════════════════════════════════════════════════════ */

/** Every component that must be present for `demandIndex` to exist. */
export const REQUIRED_COMPONENTS: readonly DemandComponentKey[] = [
  'volume', 'intensity', 'longRunLoad', 'stacking', 'recentAdaptation', 'recovery',
];

/** What one week costs, with no reference to any other week. */
export interface WeekPricing {
  readonly components: readonly DemandComponent[];
  readonly unknownComponents: readonly DemandComponentKey[];
  readonly missingRequired: readonly DemandComponentKey[];
  /** All seven components. Null when a required one is unknown. */
  readonly demandIndex: number | null;
}

/**
 * Price one week. The proposed week and every demonstrated week both come
 * through here, which is what makes the ceiling comparison honest.
 *
 * It takes `WeekCostInput` and not `WeeklyDemandInput` on purpose: the pricer
 * cannot see the comparison set, so it cannot start treating the two sides
 * differently.
 */
export function priceWeek(input: WeekCostInput): WeekPricing {
  /* ── 1 · VOLUME ─────────────────────────────────────────────────────── */
  const volume: DemandComponent = isReal(input.weeklyMi)
    ? {
      key: 'volume',
      contribution: input.weeklyMi,
      provenance: 'CALCULATED_PHYSIOLOGY',
      basis: cite('volume'),
      why: `${round3(input.weeklyMi)} mi in the week. The unit of this index is `
          + 'one equivalent easy mile, so volume enters at a coefficient of 1.0 '
          + 'by definition. There is no fitted weight here to be wrong about.',
    }
    : {
      key: 'volume',
      contribution: null,
      provenance: 'CALCULATED_PHYSIOLOGY',
      basis: cite('volume'),
      why: 'Weekly mileage was not supplied. Unknown, not zero.',
    };

  /* ── 2 · INTENSITY ──────────────────────────────────────────────────── */
  const anchorMul = anchorCostMultiplier(input.thresholdAnchorDeltaSecPerMi);
  const intensity: DemandComponent = isReal(input.qualityMinutes)
    ? {
      key: 'intensity',
      contribution: input.qualityMinutes * QUALITY_MINUTE_TO_EASY_MILE * anchorMul,
      provenance: 'POLICY_ASSUMPTION',
      basis: `${cite('intensity')} · coefficient inherited from `
          + 'lib/adaptation/canonical/plan-load.ts QUALITY_MINUTE_TO_EASY_MILE',
      why: `${round3(input.qualityMinutes)} quality minutes at `
          + `${QUALITY_MINUTE_TO_EASY_MILE} equivalent easy miles each`
          + (anchorMul === 1
            ? ', priced at the anchor the week was written at. '
            : `, priced ${round3((anchorMul - 1) * 100)}% differently because the threshold `
              + `anchor is proposed to move ${round3(input.thresholdAnchorDeltaSecPerMi ?? 0)} s/mi. `)
          + 'The '
          + 'intensity-distribution table gives shares and no load equivalence, '
          + 'so this coefficient has no research behind it. It is the same '
          + 'number the arbitration scale already used, kept in one place so '
          + 'the two cannot drift apart.',
    }
    : {
      key: 'intensity',
      contribution: null,
      provenance: 'POLICY_ASSUMPTION',
      basis: cite('intensity'),
      why: 'Quality minutes were not supplied. Unknown, not zero. A week with '
          + 'no quality is a measured zero and looks different from this.',
    };

  /* ── 3 · LONG-RUN LOAD ──────────────────────────────────────────────── */
  let longRunLoad: DemandComponent;
  if (!isReal(input.longRunMi)) {
    longRunLoad = {
      key: 'longRunLoad',
      contribution: null,
      provenance: 'POLICY_ASSUMPTION',
      basis: cite('longRunSpike'),
      why: 'The week\'s longest run was not supplied. Unknown, not zero.',
    };
  } else if (!isReal(input.longestRunPrior30dMi)) {
    longRunLoad = {
      key: 'longRunLoad',
      contribution: null,
      provenance: 'ATHLETE_EVIDENCE',
      basis: cite('longRunSpike'),
      why: 'His longest run in the prior 30 days is not known, so the cited '
        + 'spike threshold has nothing to measure against. Reporting the flat '
        + 'surcharge alone would understate a week that may be a large step up, '
        + 'so this is unknown rather than partial.',
    };
  } else {
    const spikeFrac = longRunSpikeFraction(input.longRunMi, input.longestRunPrior30dMi);
    const flat = input.longRunMi * LONG_RUN_SURCHARGE_PER_MI;
    // The cited 64% multiplies the long run's OWN surcharge. See
    // LONG_RUN_SPIKE_RISK_UPLIFT for why that spending is a policy choice and
    // not something the source states.
    const spike = flat * LONG_RUN_SPIKE_RISK_UPLIFT * spikeFrac;
    const ratioPct = input.longestRunPrior30dMi > 0
      ? Math.round((input.longRunMi / input.longestRunPrior30dMi) * 1000) / 10
      : 0;
    longRunLoad = {
      key: 'longRunLoad',
      contribution: flat + spike,
      // The provenance follows the reading, not the file. Once the cited spike
      // term is live the number is measured against HIS own longest run using
      // doctrine's own ratio; when it is quiet, all that is left is an
      // inherited flat surcharge nobody calibrated.
      provenance: spike > 0 ? 'ATHLETE_EVIDENCE' : 'POLICY_ASSUMPTION',
      basis: spike > 0
        ? `${cite('longRunSpike')} · measured against his own longest run in the prior 30 days`
        : `${cite('longRunSpike')} · surcharge inherited from lib/adaptation/canonical/plan-load.ts LONG_RUN_SURCHARGE_PER_MI`,
      why: `${round3(input.longRunMi)} mi long run at ${ratioPct}% of his `
        + `prior-30-day longest of ${round3(input.longestRunPrior30dMi)} mi. `
        + `A flat surcharge of ${round3(flat)} because the same miles cost more `
        + 'in one run than spread across the week, plus '
        + (spike > 0
          ? `${round3(spike)} for reaching past what he has just run. Doctrine `
            + `puts about ${Math.round(LONG_RUN_SPIKE_RISK_UPLIFT * 100)}% more `
            + `overuse injury risk on a run over ${Math.round(LONG_RUN_SPIKE_RATIO * 100)}% `
            + 'of the prior-30-day longest, and that multiplies the surcharge '
            + 'here. The anchor is his LITERAL prior-30-day longest, taper runs '
            + 'included, because that is what his legs have actually been '
            + 'prepared for.'
          : 'no spike term, because it sits at or under what he has just run.'),
    };
  }

  /* ── base ───────────────────────────────────────────────────────────── */
  const baseParts = [volume, intensity, longRunLoad];
  const baseKnown = baseParts.every((c) => c.contribution != null);
  const base = baseKnown
    ? baseParts.reduce((s, c) => s + (c.contribution ?? 0), 0)
    : null;

  /* ── 4 · STACKING ───────────────────────────────────────────────────── */
  let stacking: DemandComponent;
  if (input.hardSessionDayOrdinals == null) {
    stacking = {
      key: 'stacking',
      contribution: null,
      provenance: 'POLICY_ASSUMPTION',
      basis: cite('stacking'),
      why: 'Where the hard sessions fall in the week is not known, so what they '
        + 'cost together cannot be priced. Unknown, not zero.',
    };
  } else if (base == null) {
    stacking = {
      key: 'stacking',
      contribution: null,
      provenance: 'POLICY_ASSUMPTION',
      basis: cite('stacking'),
      why: 'Stacking is priced as a fraction of the week\'s base cost, and the '
        + 'base cost is not known.',
    };
  } else {
    const shape = stackingShape(input.hardSessionDayOrdinals);
    const frac = STACK_UPLIFT_PER_PAIR * shape.pairs * shape.crowding;
    const n = input.hardSessionDayOrdinals.length;
    stacking = {
      key: 'stacking',
      contribution: base * frac,
      provenance: 'POLICY_ASSUMPTION',
      basis: `${cite('stacking')} · the shape is doctrine, the magnitude `
        + `(${STACK_UPLIFT_PER_PAIR} of base per pair) is ours and is not cited`,
      why: n <= 1
        ? `${n} hard session in the week, so nothing stacks. A measured zero, `
          + 'not an absence.'
        : `${n} hard sessions make ${shape.pairs} interacting pairs, and the `
          + `tightest gap is ${shape.minGapH == null ? 'unknown' : `${round3(shape.minGapH)} h`} `
          + `against doctrine's ${HARD_SESSION_SPACING_H} h, a crowding factor `
          + `of ${round3(shape.crowding)}. Two hard sessions and a long run in `
          + 'one week cost more than the three of them apart, which is why this '
          + 'term is a product of pairs and not a sum of sessions.',
    };
  }

  /* ── 5 · RECENT ADAPTATION ──────────────────────────────────────────── */
  let recentAdaptation: DemandComponent;
  if (input.acwr == null) {
    recentAdaptation = {
      key: 'recentAdaptation',
      contribution: null,
      provenance: 'ATHLETE_EVIDENCE',
      basis: cite('recentAdaptation'),
      why: 'No acute-to-chronic reading was supplied, so whether he has been '
        + 'absorbing recent load is unknown.',
    };
  } else if (input.acwr.acwr == null) {
    recentAdaptation = {
      key: 'recentAdaptation',
      contribution: null,
      provenance: 'ATHLETE_EVIDENCE',
      basis: cite('recentAdaptation'),
      why: `The acute-to-chronic resolver declined to answer: ${input.acwr.reason ?? 'reason not stated'}. `
        + 'That refusal is carried through rather than flattened to a neutral '
        + 'number, because a runner whose history is too short to measure and a '
        + 'runner sitting in the sweet spot are not the same runner.',
    };
  } else if (base == null) {
    recentAdaptation = {
      key: 'recentAdaptation',
      contribution: null,
      provenance: 'ATHLETE_EVIDENCE',
      basis: cite('recentAdaptation'),
      why: 'Recent adaptation is priced as a fraction of the week\'s base cost, '
        + 'and the base cost is not known.',
    };
  } else {
    const ratio = input.acwr.acwr;
    const frac = adaptationFraction(ratio);
    recentAdaptation = {
      key: 'recentAdaptation',
      contribution: base * frac,
      provenance: 'ATHLETE_EVIDENCE',
      basis: `${cite('recentAdaptation')} · zone edges from ACWR_BANDS, `
        + `magnitude (${ADAPTATION_UPLIFT_AT_DANGER} of base at the danger edge) is ours`,
      why: `Acute-to-chronic load is ${ratio}. `
        + (frac === 0
          ? `Inside the ${ACWR_BANDS.detraining} to ${ACWR_BANDS.caution} sweet spot, `
            + 'so this week costs neither more nor less for the load underneath '
            + 'it. A measured zero.'
          : frac < 0
            ? `Below the sweet spot, so he is carrying less recent load than his `
              + 'own month, and the same week lands on fresher legs.'
            : `Above the sweet spot, so this week lands on top of load he is `
              + 'already carrying and costs more than the same week would in an '
              + 'ordinary month.')
        + ' The response runs continuously through the zone edges rather than '
        + 'stepping at them, which is what the research asks for one paragraph '
        + 'under its own table.',
    };
  }

  /* ── 6 · RECOVERY ───────────────────────────────────────────────────── */
  let recovery: DemandComponent;
  const raceCtx = input.lastRace;
  const basisRecovery = `${cite('recoveryPostRace')} and ${cite('recoveryCutback')} `
    + `· both windows are cited, the magnitude (${RECOVERY_DEBT_UPLIFT} of base at `
    + 'full debt) is ours';
  if (raceCtx == null || !isReal(input.weeksSinceLastCutback)) {
    recovery = {
      key: 'recovery',
      contribution: null,
      provenance: 'POLICY_ASSUMPTION',
      basis: basisRecovery,
      why: raceCtx == null
        ? 'Whether he has raced recently is not known. That is unknown, and it '
          + 'is different from knowing he has not raced, which is a fact this '
          + 'model accepts and prices at zero.'
        : 'Weeks since his last down week are not known, so recovery debt '
          + 'cannot be priced.',
    };
  } else if (base == null) {
    recovery = {
      key: 'recovery',
      contribution: null,
      provenance: 'POLICY_ASSUMPTION',
      basis: basisRecovery,
      why: 'Recovery debt is priced as a fraction of the week\'s base cost, and '
        + 'the base cost is not known.',
    };
  } else {
    const d = recoveryDebt(raceCtx, input.weeksSinceLastCutback);
    const frac = RECOVERY_DEBT_UPLIFT * d.debt;
    const raceLine = raceCtx === 'NONE'
      ? 'He has no recorded race behind him, so no post-race window applies.'
      : `${round3(raceCtx.daysSince)} days since his last race against a `
        + `${raceCtx.noQualityWindowDays}-day no-quality window, which is `
        + `${Math.round(d.raceOverlap * 100)}% of that window still owed.`;
    const cutbackLine = d.cutbackOverdue === 0
      ? `${round3(input.weeksSinceLastCutback)} weeks since his last down week, `
        + `inside doctrine's ${CUTBACK_CADENCE_WEEKS}-week cadence.`
      : `${round3(input.weeksSinceLastCutback)} weeks since his last down week `
        + `against a ${CUTBACK_CADENCE_WEEKS}-week cadence, so `
        + `${Math.round(d.cutbackOverdue * 100)}% of a cadence overdue.`;
    recovery = {
      key: 'recovery',
      contribution: base * frac,
      provenance: 'POLICY_ASSUMPTION',
      basis: basisRecovery,
      why: `${raceLine} ${cutbackLine} `
        + 'This reads the recovery the calendar affords, not a wrist score: '
        + 'sleep, heart-rate variability and resting heart rate were removed '
        + 'from plan decisions on 2026-09-02 and are deliberately not here.',
    };
  }

  /* ── 7 · INJURY ─────────────────────────────────────────────────────── */
  const injuryRaw = injuryComponent(input.safety);
  const injury: DemandComponent = injuryRaw.contribution == null || base == null
    ? (base == null && injuryRaw.contribution != null
      ? { ...injuryRaw, contribution: null,
        why: `${injuryRaw.why} The week's base cost is not known, so the uplift cannot be sized.` }
      : injuryRaw)
    : { ...injuryRaw, contribution: base * injuryRaw.contribution };

  /* ── ASSEMBLE ───────────────────────────────────────────────────────── */
  //
  // Rounding happens ONCE, on the components, and the index is the sum of what
  // the reader is shown. Rounding the total independently would leave the
  // seven printed numbers not adding up to the printed total, which is a small
  // lie and the exact kind that makes a derivation impossible to check by hand.
  const components: readonly DemandComponent[] =
    [volume, intensity, longRunLoad, stacking, recentAdaptation, recovery, injury]
      .map((c) => (c.contribution == null ? c : { ...c, contribution: round3(c.contribution) }));

  const unknownComponents = components
    .filter((c) => c.contribution == null)
    .map((c) => c.key);

  const missingRequired = REQUIRED_COMPONENTS.filter((k) =>
    unknownComponents.includes(k));

  const demandIndex = missingRequired.length > 0
    ? null
    : round3(components.reduce((s, c) => s + (c.contribution ?? 0), 0));

  return { components, unknownComponents, missingRequired, demandIndex };
}

/**
 * Price the week and, where there is evidence to compare it against, set it
 * beside the biggest week he has absorbed — on ONE basis, both sides.
 */
export function computeWeeklyDemand(input: WeeklyDemandInput): WeeklyDemand {
  const priced = priceWeek(input);
  const ceiling = compareToAthleteCeiling(input, input.demonstratedWeeks);
  const atCeiling = ceiling == null || ceiling.proposed == null || ceiling.ceiling == null
    ? null
    : ceiling.proposed >= ceiling.ceiling;

  return {
    weekStartISO: input.weekStartISO,
    components: priced.components,
    demandIndex: priced.demandIndex,
    unknownComponents: priced.unknownComponents,
    ceiling,
    athleteCeiling: ceiling?.ceiling ?? null,
    atCeiling,
    explain: explainDemand(
      input, priced.components, priced.demandIndex, ceiling, priced.missingRequired,
    ),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE DERIVATION, IN ONE PARAGRAPH
 * ═══════════════════════════════════════════════════════════════════════ */

function explainDemand(
  input: WeeklyDemandInput,
  components: readonly DemandComponent[],
  demandIndex: number | null,
  ceil: CeilingComparison | null,
  missingRequired: readonly DemandComponentKey[],
): string {
  const named = (k: DemandComponentKey): string => {
    const c = components.find((x) => x.key === k);
    if (c == null || c.contribution == null) return `${k} unknown`;
    return `${k} ${round3(c.contribution)}`;
  };

  const ceilingLine = ceil == null || ceil.ceiling == null || ceil.proposed == null
    ? (input.demonstratedWeeks == null
      ? 'No demonstrated weeks were supplied, so there is no athlete ceiling to '
        + 'compare against.'
      : ceil == null
        ? 'No demonstrated week is marked as absorbed, so there is no athlete '
          + 'ceiling. A week nobody has judged does not raise it.'
        : `There is an absorbed week to compare against, but this week cannot be `
          + `priced on the ${ceil.basis} basis the comparison would use, so no `
          + 'ratio is reported rather than a ratio measured two different ways.')
    : `Measured on the ${ceil.basis} basis, which is applied to BOTH sides by `
      + 'one function: this week costs '
      + `${round3(ceil.proposed)} on that basis against a demonstrated ceiling `
      + `of ${ceil.ceiling}, from the week of `
      + `${ceil.from?.weekStartISO ?? 'unknown'}, the largest of `
      + `${ceil.considered} weeks he is recorded as having absorbed. That is `
      + `${Math.round((ceil.proposed / ceil.ceiling) * 100)}% of it`
      + `${ceil.proposed >= ceil.ceiling ? ', so it is at or over the ceiling.' : '.'}`
      + ` ${ceil.reason}`;

  // The ceiling comparison can stand when the index does not. BASE_ONLY reads
  // three measured quantities and none of the context terms, so a week that
  // refuses an index because its ACWR is unknown still has an honest
  // like-for-like ratio. Rule 11 cuts both ways: refusing a fact that IS known
  // is as much a loss of information as inventing one that is not.
  if (demandIndex == null) {
    return `Week of ${input.weekStartISO}. No demand index: `
      + `${missingRequired.join(', ')} could not be computed, and a partial `
      + 'index would make the week look cheaper than it is. The components that '
      + `are known read ${components.filter((c) => c.contribution != null).map((c) => named(c.key)).join(', ') || 'nothing at all'}. `
      + `Supply the missing inputs and the index resolves. ${ceilingLine}`;
  }

  const injuryLine = components.find((c) => c.key === 'injury')?.contribution == null
    ? ' Injury context is not in this number: it is reported separately and '
      + 'named in the unknown list.'
    : '';

  return `Week of ${input.weekStartISO} costs ${demandIndex} equivalent easy `
    + `miles. ${named('volume')} for the mileage itself, ${named('intensity')} `
    + `for the quality minutes, ${named('longRunLoad')} for the long run and `
    + 'how far it reaches past his own recent longest. Those three are the base '
    + `cost. On top of it, ${named('stacking')} for what the hard sessions cost `
    + `together rather than apart, ${named('recentAdaptation')} for the load he `
    + `is already carrying, and ${named('recovery')} for the recovery the `
    + `calendar has not yet given back. ${ceilingLine}${injuryLine} The unit is `
    + 'one equivalent easy mile throughout, so the seven numbers add up to the '
    + 'total and can be argued with one at a time.';
}
