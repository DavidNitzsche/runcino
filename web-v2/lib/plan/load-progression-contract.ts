/**
 * lib/plan/load-progression-contract.ts · LOADCONTRACT-1 (2026-09-02) · THE ONE
 * TIME-AWARE ANSWER TO "HOW MUCH LOAD", SHARED BY AUTHORING AND ADAPTATION.
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE ────────────────────────────────────────
 *
 * Composing the reference runner on 2026-09-02 produced a block peaking at
 * 60.0 mi/wk while the SAME authoring wrote `tier_peak_weekly_band: [45, 55]`.
 * `lib/plan/adaptive-ramp.ts` reads that band's upper as the ceiling the
 * upward volume bump may never cross, so the plan peaked five miles above its
 * own published ceiling and `belowTierUpper` could never pass. Rule 21's named
 * signature: wired, doctrine-bound, cron-mounted and INERT.
 *
 * The two numbers were never the same quantity, and that is the whole bug:
 *
 *   60.0  came from `cycleBoundedPeak` — `demonstratedPeak (52.3) × 1.15`, the
 *         per-cycle base-growth row of `Research/00a` §"Volume progression
 *         rules". A statement about a RATE of growth, measured off his own
 *         biggest week.
 *   55    came from `TIER_TARGETS.m.intermediate.peakWeeklyMileageBand[1]` —
 *         the peak volume `Research/22` §"Marathon — Intermediate" publishes
 *         for that TEMPLATE. A statement about an archetype's plan, selected
 *         by a marathon-equivalent PACE reading.
 *
 * Taking `min` of a growth rate and a template's published peak produces a
 * number that means neither, and publishing it under a name (`tier_peak_*
 * _band`) that a second module spends as a hard ceiling is Rule 16 exactly.
 *
 * ── THE OWNER'S RULING, WHICH IS THIS FILE'S SPECIFICATION ─────────────────
 *
 *   "Do not automatically cut the plan to 55 miles, and do not leave authoring
 *    and adaptation governed by contradictory load authority. Determine exactly
 *    what the approximately 55-mile value means: Maximum load supported today.
 *    Maximum immediately permitted increase. Maximum future planned load.
 *    Adaptation-specific limit. Or a historical evidence reference rather than
 *    a hard ceiling. These are different concepts and must not share an
 *    ambiguous field or name."
 *
 *   "A marathon plan may prescribe 60 miles later in the block even if
 *    approximately 55 is the load supported today, provided the intervening
 *    weeks deliberately build and demonstrate the capacity required for that
 *    peak."
 *
 * ANSWERED, for the reference runner, with the names he asked for:
 *
 *   currentlySupportedLoad            45.0  the volume he has held REPEATEDLY
 *                                           (rank-3 week), not once
 *   immediatelyPermittedLoad          39.9  34.7 held × the week-over-week
 *                                           growth ceiling
 *   plannedFutureLoad(week n)         the envelope below — a continuous climb
 *                                           from what he holds toward the peak
 *   plannedPeakLoad                   60.1  52.3 demonstrated peak × the
 *                                           per-cycle growth figure
 *   demonstratedLoadAfterEachWeek     recomputed from completed weeks, which
 *                                           is what moves every number above
 *
 * So the ~55 is the FIFTH of his five options — a historical evidence
 * reference, the template band his archetype is published against — and it was
 * being spent as the fourth, an adaptation-specific hard limit. It is still
 * carried, under `templatePeakBandMi`, and it no longer decides anything.
 *
 * ── WHY THE PEAK IS A DIFFERENT QUESTION FROM TODAY'S CEILING ──────────────
 *
 * This is the "time-aware" half of the ask, and it is why one scalar could
 * never have answered it. `currentlySupportedLoad` is a fact about today.
 * `plannedPeakLoad` is a fact about a week ten weeks out, conditional on the
 * weeks between now and then being completed. Comparing a block's PEAK against
 * a ceiling struck for TODAY compares two different weeks, and it is what made
 * a coherent plan look like a violation.
 *
 * `plannedFutureLoad` is the bridge: a monotone, continuous envelope from what
 * the runner holds now to the peak, at no more than doctrine's week-over-week
 * growth. A week may be planned at the envelope; it is EARNED by the weeks
 * before it actually being run.
 *
 * ── WHY NO EXPERIENCE LABEL REACHES THIS FILE ─────────────────────────────
 *
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` removes "self-declared experience-level
 * bands" as decision authority outright. `profile.experience_level` reads
 * `advanced` because the owner typed it, and it was worth five miles a week at
 * peak: composed against `TIER_TARGETS.m.advanced` it targeted 65 and landed on
 * 60.1; composed against the intermediate row it would have targeted 45 and
 * landed on 52.3 — his own existing peak, a build that builds nothing.
 *
 * Doctrine's own split in that row is TRAINED versus NOVICE, and this file
 * decides it from EVIDENCE: a runner with a measured peak week has a training
 * history and is inside the cohort the row is stated for; a runner with none
 * gets no per-cycle bound at all and the caller keeps its template band. That
 * is the same move `evidenceLongCeilingMi` already makes when it hard-reads
 * `CYCLE_GROWTH_CEILING.intermediate` rather than keying on the typed level
 * (`generate.ts`, LONGEVIDENCE-1) — precedent, not invention.
 *
 * `CYCLE_GROWTH_CEILING` and `GENERAL_RAMP_CEILING` keep their per-level shape
 * because `RAMP.cycle-over-cycle-peak-growth` and `RAMP.general-case-ceiling`
 * pin it in CI against the doctrine row's own wording. What changed is who
 * asks, and with what.
 *
 * ── RULE 11 · THREE STATES, ENFORCED BY THE TYPE ───────────────────────────
 *
 * `LoadReading`'s refusal branch carries no `mi` field at all, so
 * `reading.mi` does not compile until the caller has branched. Copied
 * deliberately from `lib/training/normal-window.ts`'s `NormalReading<T>`,
 * because "we have not measured this runner" and "this runner measured zero"
 * are opposite facts and the second must never read as permission.
 *
 * ── RULE 9 · NO THRESHOLD ANYWHERE IN THIS FILE ────────────────────────────
 *
 * Every quantity below is `min`, `max` or a product of continuous inputs.
 * There is no comparison of two computed quantities that switches a behaviour,
 * so there is no cliff to smooth and none can be introduced without adding
 * one. `_load_progression_contract.test.ts` walks the evidence in 0.01 mi
 * steps and asserts continuity and monotonicity, the pattern
 * `_restore_continuity.test.ts` and `_cadence_robust.test.ts` set.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT ANSWER ─────────────────────────────────
 *
 * · Whether 1.15 is the right per-cycle figure. `RAMP.cycle-over-cycle-peak-
 *   growth` owns that against `Research/00a`'s own table cell.
 * · Anything about the SHAPE of a week — long-run band, quality density, days
 *   per week, the medium-long run. Those stay on `TIER_TARGETS` and are
 *   selected by `classifyCapacityTier`, which still carries the typed level's
 *   floor. That residual is argued in `goal-tiers.ts`'s TIEREVIDENCE-1 block
 *   and is deliberately NOT moved here: a volume contract has no business
 *   shortening a marathoner's long run.
 * · Whether the runner should train at all. It bounds load; it never
 *   prescribes it, and it never reduces a plan on its own — a caller that
 *   refuses to bound gets a refusal, not a small number.
 *
 * Cite: Research/00a-distance-running-training.md §"Volume progression rules"
 * Cite: Research/22-plan-templates.md (the template bands, carried as a
 *       reference and no longer as an authority)
 */
import {
  CYCLE_GROWTH_CEILING,
  GENERAL_RAMP_CEILING,
} from './goal-tiers';

/**
 * THE PER-CYCLE PEAK-GROWTH FIGURE, read off the doctrine table rather than
 * re-typed (Rule 18 · a check that hardcodes both sides only proves it agrees
 * with itself, and the same applies to a constant).
 *
 * `CYCLE_GROWTH_CEILING`'s `intermediate` rung is the TRAINED rung — the whole
 * table is 1.15 for every trained level and `null` for `beginner`, on the
 * strength of the row saying "for trained athletes". This contract asks the
 * trained question of a runner it has MEASURED, so it takes the trained rung
 * and gates it on the measurement instead of on a typed word.
 *
 * Cite: Research/00a-distance-running-training.md §"Volume progression rules"
 *       — the "Year-on-year base growth" row, per-cycle axis
 * Bound by RAMP.cycle-over-cycle-peak-growth (via CYCLE_GROWTH_CEILING).
 */
export const PER_CYCLE_PEAK_GROWTH: number = CYCLE_GROWTH_CEILING.intermediate as number;

/**
 * THE WEEK-OVER-WEEK GROWTH FIGURE. Same reading, same table, other axis: the
 * most one week may exceed the one before it.
 *
 * Cite: Research/00a-distance-running-training.md §"Volume progression rules"
 * Bound by RAMP.general-case-ceiling (via GENERAL_RAMP_CEILING).
 */
export const WEEKLY_STEP_GROWTH: number = GENERAL_RAMP_CEILING.intermediate;

/**
 * The headroom `lib/plan/adaptive-ramp.ts`'s `belowTierUpper` requires before
 * it will consider a bump — its own `peakHeadroomMi > ceiling × 0.05`.
 *
 * Re-exported here, not re-typed there, because `earnedWhen` below computes
 * the demonstrated volume that would satisfy it and the two must agree by
 * construction. Rule 16: one quantity, one name.
 */
export const ADAPTATION_HEADROOM_SHARE = 0.05;

/** Why a bound is the number it is. Carried on every reading so a surface, a
 *  log line or a gate can say which doctrine rule bound it without re-deriving. */
export type LoadBasis =
  /** `demonstratedPeakWeeklyMi × PER_CYCLE_PEAK_GROWTH`. */
  | 'per_cycle_growth_on_demonstrated_peak'
  /** The runner's own biggest week — a build may never peak below it. */
  | 'demonstrated_peak_floor'
  /** The least volume the distance table asks of anyone racing this distance. */
  | 'distance_floor'
  /** As far as the week-over-week ceiling can climb in the weeks available. */
  | 'reachable_by_weekly_growth'
  /** The volume the runner has held repeatedly. */
  | 'sustained_demonstrated_volume'
  /** What the runner is carrying right now, grown by one week's step. */
  | 'held_volume_plus_one_step';

/**
 * A load number, or an honest refusal. Rule 11.
 *
 * The refusal branch has NO `mi` field, deliberately: `reading.mi` is a type
 * error until the caller has narrowed on `known`. A guard that cannot run must
 * not be able to silently contribute a zero.
 */
export type LoadReading =
  | { readonly known: true; readonly mi: number; readonly basis: LoadBasis; readonly citation: string }
  | { readonly known: false; readonly reason: string };

const known = (mi: number, basis: LoadBasis, citation: string): LoadReading =>
  ({ known: true, mi: Math.round(mi * 10) / 10, basis, citation });
const refused = (reason: string): LoadReading => ({ known: false, reason });

const CITE_VOLUME_RULES = 'Research/00a-distance-running-training.md §"Volume progression rules"';

/** A measured number, or null for "not measured". Never 0-as-absent (Rule 11). */
type Measured = number | null;

const positive = (v: Measured | undefined): number | null =>
  v != null && Number.isFinite(v) && v > 0 ? v : null;

/**
 * WHAT THE RUNNER HAS ACTUALLY DONE, as of one instant.
 *
 * Every field is a MEASUREMENT or null. Nothing here is typed, reported or
 * inferred from a category, and `asOfISO` is what makes the whole contract
 * time-aware: the same runner produces a different contract in November than
 * in September because these numbers move, and moving them is the only way the
 * envelope advances.
 */
export interface DemonstratedLoad {
  /** Biggest rolling 7-day block in the look-back. Null = not measured. */
  readonly peakWeeklyMi: Measured;
  /** The volume reached REPEATEDLY (the rank-3 week), not once. */
  readonly sustainedWeeklyMi: Measured;
  /** What the runner is demonstrably carrying right now. */
  readonly heldWeeklyMi: Measured;
  /** Representative trailing mean over the look-back. */
  readonly meanWeeklyMi: Measured;
  /** The day these readings are as of. The contract's time axis. */
  readonly asOfISO: string;
}

/**
 * Q4 · WHAT MUST ACCUMULATE BEFORE THE PLANNED PEAK IS ACTIONABLE.
 *
 * Stated as a number the runner can actually run, not as a disposition. Rule
 * 21: "compute what the runner would have had to DO to trigger it, then check
 * whether any week they have actually run would have."
 */
export interface PeakEarnedCondition {
  /**
   * The demonstrated peak week that would give a plan peaking at
   * `plannedPeakMi` the headroom `belowTierUpper` requires. Null when the peak
   * itself could not be bounded, in which case nothing is pending.
   */
  readonly demonstratedPeakWeeklyMiRequired: number | null;
  /** How far that is above what has been demonstrated so far. */
  readonly aboveCurrentDemonstratedMi: number | null;
  /** Plain-English, derived here so no surface re-derives it (Rule 17). */
  readonly statement: string;
}

/**
 * Q5 · WHAT HAPPENS WHEN THE RUNNER DOES NOT DEMONSTRATE THE PROGRESSION.
 *
 * One value, because there is one answer and it is the doctrine's: the
 * envelope simply does not advance. No cut, no re-phase, no punishment — under
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` automatic downward adaptation is
 * disabled too, and the authored calendar stands. The peak stops being
 * reachable because the evidence that would have earned it never arrived, and
 * the next authoring reads the smaller demonstrated peak and plans a smaller
 * one.
 */
export const SHORTFALL_POSTURE = 'envelope-does-not-advance' as const;
export type ShortfallPosture = typeof SHORTFALL_POSTURE;

/** The whole contract. One resolver produces it; authoring and adaptation both
 *  read it. */
export interface LoadProgressionContract {
  readonly asOfISO: string;
  readonly demonstrated: DemonstratedLoad;
  /** Q1 · What load does the existing evidence support NOW? */
  readonly currentlySupportedLoad: LoadReading;
  /** Q2 · What increase may safely be authored for the next relevant week? */
  readonly immediatelyPermittedLoad: LoadReading;
  /**
   * Q3 · The ceiling for each week from `asOfISO` forward, index 0 = the next
   * week. Conditional on every earlier week being completed. Empty when the
   * peak could not be bounded.
   */
  readonly plannedFutureLoadMi: readonly number[];
  /** Q3/Q4 · The highest peak this block may plan. */
  readonly plannedPeakLoad: LoadReading;
  /** Q4 · What evidence must accumulate before that peak is actionable. */
  readonly peakEarnedWhen: PeakEarnedCondition;
  /** Q5 · What happens if the runner does not demonstrate the progression. */
  readonly shortfall: ShortfallPosture;
  /**
   * Q6 · What load adaptation may propose TODAY — the same bound as
   * `plannedPeakLoad`, recomputed against the evidence in hand rather than the
   * evidence at authoring. It is a separate field because it is a separate
   * question asked at a separate time (Rule 10 · recompute, do not trust a
   * frozen array).
   */
  readonly adaptationCeiling: LoadReading;
  /**
   * The `Research/22` template band for this runner's archetype. A HISTORICAL
   * EVIDENCE REFERENCE — the fifth of the owner's five meanings — carried so a
   * surface can say "doctrine publishes 45-55 for this template" and explicitly
   * NOT consulted by any bound above. Null when the caller supplied none.
   */
  readonly templatePeakBandMi: readonly [number, number] | null;
}

export interface ResolveLoadContractArgs {
  /** What the runner has actually run, as of `demonstrated.asOfISO`. */
  readonly demonstrated: DemonstratedLoad;
  /**
   * How many CLIMBING weeks stand between now and the block's peak. Used only
   * to bound the peak by what is reachable at doctrine's weekly growth — a
   * peak nobody can climb to is not a plan, it is a wish.
   */
  readonly climbWeeksToPeak: number | null;
  /**
   * The least weekly volume doctrine asks of anyone racing this distance
   * (`TIER_TARGETS[cat].developing.peakWeeklyMileageBand[0]`). The contract may
   * move a runner around inside the table; it may not take them out from under
   * it. Passed in rather than looked up so this module stays free of race
   * distance and of the tier system entirely.
   */
  readonly distanceFloorMi: number;
  /** Reference only. See `templatePeakBandMi`. */
  readonly templatePeakBandMi?: readonly [number, number] | null;
}

/**
 * THE PEAK BOUND · `demonstratedPeak × PER_CYCLE_PEAK_GROWTH`, never below the
 * runner's own peak or the distance floor, never above what the weeks
 * available can climb to.
 *
 * Exported separately from the full contract because adaptation recomputes
 * exactly this and nothing else (Q6), and because a second implementation of
 * this arithmetic is the whole class of defect this file closes.
 *
 * REFUSES rather than guesses when there is no measured peak: that is the
 * cold-start case and every synthetic archetype in the sweep, and the caller's
 * correct response is to keep its template band, not to substitute a number
 * invented here.
 */
export function plannedPeakBound(args: {
  readonly demonstratedPeakWeeklyMi: Measured;
  readonly climbFromMi: Measured;
  /**
   * RULE 9 · `null` and a NUMBER are different KINDS of answer, and the
   * distinction is deliberately not expressible as a number.
   *
   * `null` means "this caller has no calendar" — a data-presence fact, not a
   * runway of zero weeks — and the reachability bound is then not applied at
   * all. Overloading `0` to mean that was written first and this file's own
   * gate caught it: 0 answered 60.1 and 1 answered 52.3, an 7.8 mi step for
   * one week of calendar. That is exactly the shape CLAUDE.md's Rule 9 example
   * fixed by resting the decision on a discrete honest fact instead of a
   * threshold on a continuous quantity, and the same fix applies here.
   *
   * Given a number, the bound is continuous and monotone in it from 0 upward.
   */
  readonly climbWeeksToPeak: number | null;
  readonly distanceFloorMi: number;
}): LoadReading {
  const peak = positive(args.demonstratedPeakWeeklyMi);
  if (peak == null) {
    return refused(
      'no demonstrated peak week · the per-cycle growth figure has nothing to '
      + 'grow from, so this contract declines to bound the peak and the caller '
      + 'keeps its template band',
    );
  }
  const floorMi = Math.max(peak, args.distanceFloorMi);
  const cycleBoundMi = peak * PER_CYCLE_PEAK_GROWTH;
  // What the block can actually climb to from where the runner is, at
  // doctrine's week-over-week ceiling. Continuous in both inputs, and never
  // allowed to pull the answer below `floorMi` — a runner already above what
  // the runway can build to still keeps their own peak.
  const climbFrom = positive(args.climbFromMi);
  const reachableMi = climbFrom != null && args.climbWeeksToPeak != null
    ? climbFrom * Math.pow(WEEKLY_STEP_GROWTH, Math.max(0, args.climbWeeksToPeak))
    : Number.POSITIVE_INFINITY;
  const bounded = Math.max(Math.min(cycleBoundMi, reachableMi), floorMi);
  const basis: LoadBasis =
    bounded === floorMi && floorMi > Math.min(cycleBoundMi, reachableMi)
      ? (peak >= args.distanceFloorMi ? 'demonstrated_peak_floor' : 'distance_floor')
      : reachableMi < cycleBoundMi
        ? 'reachable_by_weekly_growth'
        : 'per_cycle_growth_on_demonstrated_peak';
  return known(bounded, basis, CITE_VOLUME_RULES);
}

/**
 * THE ONE RESOLVER. Authoring calls it to size the block; adaptation calls it
 * with LIVE evidence to ask what it may propose today.
 */
export function resolveLoadProgressionContract(
  args: ResolveLoadContractArgs,
): LoadProgressionContract {
  const d = args.demonstrated;
  const sustained = positive(d.sustainedWeeklyMi);
  const held = positive(d.heldWeeklyMi);
  const mean = positive(d.meanWeeklyMi);

  // Q1 · what the evidence supports NOW. The volume reached REPEATEDLY, floored
  // by what is being carried right now — a runner currently above their own
  // rank-3 week is supported at what they are doing, not at what they used to.
  const supportedMi = sustained != null && held != null
    ? Math.max(sustained, held)
    : (sustained ?? held);
  const currentlySupportedLoad: LoadReading = supportedMi != null
    ? known(supportedMi, 'sustained_demonstrated_volume', CITE_VOLUME_RULES)
    : refused(
      'neither a sustained nor a currently-held weekly volume was measured · '
      + 'nothing is known about what this runner supports today',
    );

  // Q2 · the most the NEXT week may be authored at. One week-over-week step
  // above what the runner is carrying. Deliberately off `held` (or the mean),
  // never off `sustained`: the question is what the legs will experience next,
  // and that is a function of what they did, not of what they once did — the
  // absorbed-load side of Rule 8's corollary.
  const stepFrom = held ?? mean;
  const immediatelyPermittedLoad: LoadReading = stepFrom != null
    ? known(stepFrom * WEEKLY_STEP_GROWTH, 'held_volume_plus_one_step', CITE_VOLUME_RULES)
    : refused(
      'no held or mean weekly volume was measured · the week-over-week ceiling '
      + 'has nothing to step from',
    );

  // Q3/Q4 · the peak, and the envelope that reaches it.
  const plannedPeakLoad = plannedPeakBound({
    demonstratedPeakWeeklyMi: d.peakWeeklyMi,
    climbFromMi: stepFrom,
    climbWeeksToPeak: args.climbWeeksToPeak,
    distanceFloorMi: args.distanceFloorMi,
  });

  const envelope: number[] = [];
  if (plannedPeakLoad.known && stepFrom != null && (args.climbWeeksToPeak ?? 0) > 0) {
    for (let i = 1; i <= (args.climbWeeksToPeak as number); i++) {
      const step = stepFrom * Math.pow(WEEKLY_STEP_GROWTH, i);
      envelope.push(Math.round(Math.min(step, plannedPeakLoad.mi) * 10) / 10);
    }
  }

  // Q4 · what would have to be demonstrated for a plan peaking here to have the
  // headroom the bump gate requires. Derived from the gate's own share so the
  // two cannot disagree.
  const demonstratedPeak = positive(d.peakWeeklyMi);
  const requiredDemonstrated = plannedPeakLoad.known
    ? Math.round(
      (plannedPeakLoad.mi / ((1 - ADAPTATION_HEADROOM_SHARE) * PER_CYCLE_PEAK_GROWTH)) * 10,
    ) / 10
    : null;
  const peakEarnedWhen: PeakEarnedCondition = {
    demonstratedPeakWeeklyMiRequired: requiredDemonstrated,
    aboveCurrentDemonstratedMi: requiredDemonstrated != null && demonstratedPeak != null
      ? Math.round((requiredDemonstrated - demonstratedPeak) * 10) / 10
      : null,
    statement: requiredDemonstrated == null
      ? 'The peak is not bounded by demonstrated volume, so nothing is pending on it.'
      : demonstratedPeak == null
        ? `A completed week of ${requiredDemonstrated} mi would open headroom above this peak.`
        : `A completed week of ${requiredDemonstrated} mi opens headroom above this peak; `
          + `the biggest week on record is ${Math.round(demonstratedPeak * 10) / 10} mi.`,
  };

  return {
    asOfISO: d.asOfISO,
    demonstrated: d,
    currentlySupportedLoad,
    immediatelyPermittedLoad,
    plannedFutureLoadMi: envelope,
    plannedPeakLoad,
    peakEarnedWhen,
    shortfall: SHORTFALL_POSTURE,
    // Q6 · the same bound, and it is the same number BECAUSE the caller passed
    // the evidence it holds. An authoring caller passes what it measured at
    // authoring; adaptation passes what is true today. That the two differ over
    // a block is the mechanism, not an inconsistency.
    adaptationCeiling: plannedPeakLoad,
    templatePeakBandMi: args.templatePeakBandMi ?? null,
  };
}

/**
 * THE STAMP `composePlan` writes and adaptation reads back.
 *
 * Rule 10 · a derived value persisted to a row carries the anchor it was
 * computed from, so a reader holding live evidence can RECOMPUTE rather than
 * trust a frozen number. Every field here is an input to
 * `plannedPeakBound`, which is what makes the recompute possible at all.
 */
export interface LoadContractStamp {
  readonly as_of_iso: string;
  readonly demonstrated_peak_weekly_mi: number | null;
  readonly sustained_weekly_mi: number | null;
  readonly held_weekly_mi: number | null;
  readonly per_cycle_peak_growth: number;
  readonly weekly_step_growth: number;
  readonly distance_floor_mi: number;
  readonly climb_weeks_to_peak: number | null;
  readonly currently_supported_mi: number | null;
  readonly immediately_permitted_mi: number | null;
  readonly planned_peak_mi: number | null;
  readonly planned_peak_basis: LoadBasis | null;
  readonly planned_peak_refusal: string | null;
  readonly demonstrated_peak_required_for_headroom_mi: number | null;
  readonly template_peak_band_mi: readonly [number, number] | null;
  readonly shortfall_posture: ShortfallPosture;
}

export function loadContractStamp(c: LoadProgressionContract, args: {
  climbWeeksToPeak: number | null;
  distanceFloorMi: number;
}): LoadContractStamp {
  return {
    as_of_iso: c.asOfISO,
    demonstrated_peak_weekly_mi: c.demonstrated.peakWeeklyMi,
    sustained_weekly_mi: c.demonstrated.sustainedWeeklyMi,
    held_weekly_mi: c.demonstrated.heldWeeklyMi,
    per_cycle_peak_growth: PER_CYCLE_PEAK_GROWTH,
    weekly_step_growth: WEEKLY_STEP_GROWTH,
    distance_floor_mi: args.distanceFloorMi,
    climb_weeks_to_peak: args.climbWeeksToPeak,
    currently_supported_mi: c.currentlySupportedLoad.known ? c.currentlySupportedLoad.mi : null,
    immediately_permitted_mi: c.immediatelyPermittedLoad.known ? c.immediatelyPermittedLoad.mi : null,
    planned_peak_mi: c.plannedPeakLoad.known ? c.plannedPeakLoad.mi : null,
    planned_peak_basis: c.plannedPeakLoad.known ? c.plannedPeakLoad.basis : null,
    planned_peak_refusal: c.plannedPeakLoad.known ? null : c.plannedPeakLoad.reason,
    demonstrated_peak_required_for_headroom_mi:
      c.peakEarnedWhen.demonstratedPeakWeeklyMiRequired,
    template_peak_band_mi: c.templatePeakBandMi,
    shortfall_posture: c.shortfall,
  };
}

/**
 * ADAPTATION'S CEILING · Rule 10's RECOMPUTE posture, in one place.
 *
 * `readTierUpper` reads a FROZEN array struck at authoring. As the runner
 * completes weeks their demonstrated peak rises and the ceiling should rise
 * with it — that is `demonstratedLoadAfterEachCompletedWeek`, and it is the
 * only thing that can ever re-open the upward path for a plan that was
 * authored to its own ceiling.
 *
 * Given a live demonstrated peak this recomputes the bound. Given none it
 * falls back to the stamped value, and says which it did — Rule 11, because a
 * ceiling recomputed from today's evidence and a ceiling inherited from
 * authoring are different facts and a log that cannot tell them apart cannot
 * answer "has this ever pushed up" (Rule 21).
 */
export function recomputeAdaptationCeiling(args: {
  readonly stamp: LoadContractStamp | null;
  /** The runner's biggest rolling 7-day block AS OF TODAY. Null = unread. */
  readonly liveDemonstratedPeakWeeklyMi: Measured;
  /** The frozen ceiling, for the fallback. Null when the plan carries none. */
  readonly stampedCeilingMi: Measured;
}): { readonly ceiling: LoadReading; readonly source: 'recomputed' | 'stamped' | 'none' } {
  const live = positive(args.liveDemonstratedPeakWeeklyMi);
  if (live != null && args.stamp != null) {
    const r = plannedPeakBound({
      demonstratedPeakWeeklyMi: live,
      climbFromMi: args.stamp.held_weekly_mi,
      climbWeeksToPeak: args.stamp.climb_weeks_to_peak,
      distanceFloorMi: args.stamp.distance_floor_mi,
    });
    if (r.known) return { ceiling: r, source: 'recomputed' };
  }
  const stamped = positive(args.stampedCeilingMi);
  if (stamped != null) {
    return {
      ceiling: known(stamped, 'per_cycle_growth_on_demonstrated_peak', CITE_VOLUME_RULES),
      source: 'stamped',
    };
  }
  return {
    ceiling: refused(
      'no live demonstrated peak and no stamped ceiling · the load ceiling is '
      + 'unknown, which is a refusal to bump and never full headroom',
    ),
    source: 'none',
  };
}
