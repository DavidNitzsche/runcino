/**
 * lib/training/capacity-resolver.ts · THE RUNNER MODEL'S OWNERSHIP LAYER.
 *
 * ONE owning service answers "what do we currently believe about this runner's
 * underlying capacity", and ONE canonical resolver exists per derived value.
 * That is `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §1-2, and
 * this file is it.
 *
 *     "Fitness is a confidence-weighted belief assembled from evidence, not a
 *      number extracted from one performance."   — BRIEF 01, Runner Model
 *
 * Four resolvers, and nothing else in this app may answer their questions:
 *
 *   · `resolveThresholdCapacity`     — what can this runner sustain at threshold
 *   · `resolveHighIntensityCapacity` — what can this runner hold at 3-5K effort
 *   · `resolveDurability`            — how well does capability survive duration
 *   · `resolveEasyCeiling`           — the boundary easy running must not cross
 *
 * ── WHY ONE FILE AND NOT FOUR ───────────────────────────────────────────────
 *
 * The brief that commissioned this layer left the split to judgement. One file,
 * because §1's unit of ownership is the SERVICE, not the capacity: the four
 * resolvers share one confidence scale, one source-mode ladder, one evidence
 * shape and one goal-isolation guarantee, and `resolveEasyCeiling`'s second
 * tier reads `resolveThresholdCapacity`'s output directly. Splitting them would
 * put the shared confidence policy in a fifth module that all four import,
 * which is the same thing with more seams — and §34's warning about duplicate
 * concepts is the specific hazard: two capacity modules would eventually grow
 * two confidence scales. The DB shells at the bottom are the only impure part;
 * every judgement above them is a pure function of its inputs, and every one of
 * them is exported so a test can drive the ladder without a database.
 *
 * ── WHAT THIS PHASE DELIBERATELY DOES NOT DO ────────────────────────────────
 *
 * NOT WIRED. `generate.ts`, `spec-builder.ts`, `reanchor-plan.ts`,
 * `recompute-paces.ts`, `zone-anchors.ts`, `sim-inputs.ts`, `goal-projection.ts`,
 * `zone-stimulus.ts` and `execution/reconstruct.ts` are all untouched by this
 * change and still resolve paces the old way. Wiring them is the NEXT phase and
 * is scoped separately, for the same reason `pace-corpus.ts` and
 * `durability-anchor.ts` landed unwired before it: a large, sensitive change to
 * the plan engine's core pace derivation deserves its own focused pass once the
 * thing it will call is trustworthy standalone. This file's public interface —
 * the four `resolve*` functions, their four estimate types, and the pure
 * `compose*` functions underneath them — is what that phase calls.
 *
 * NO PRESCRIPTION. §1 gives "given current capacity and workout purpose, what
 * intensity should be prescribed" to a DIFFERENT owner (Pace Prescription).
 * Nothing here decides a workout target, applies a readiness modifier, or reads
 * a plan. A capacity is what the runner can do; a prescription is what to ask
 * of them today, and §7 forbids collapsing the two
 * (`currentFitness = baseFitness * fatiguePenalty` is the named anti-pattern).
 *
 * NO RACE PREDICTION. §10's "race-prediction separation" invariant: capacity
 * resolution may not consume a race prediction. `lib/training/race-projection.ts`
 * consumes capacity, never the reverse.
 *
 * ── GOAL ISOLATION · STRUCTURAL, NOT CONVENTIONAL (§6) ──────────────────────
 *
 * None of the four resolvers can be handed a goal. Not "receives it and ignores
 * it" — the signature is `(userId: string, todayISO?: string)` and section 0
 * below asserts that exact parameter tuple AT COMPILE TIME for all four, so
 * adding a third parameter of any shape fails `tsc` rather than review. §6's
 * own sentence is the standard: "if the service cannot see the goal, it cannot
 * accidentally train toward it."
 *
 * One real leak used to exist here, closed rather than documented away — kept
 * below because it is exactly the shape §6 warns about and the next one will
 * look like it. `loadVdotInputs` used to resolve its honest-effort distance
 * floor through `goalRunFloorMiForUser`, which read `profile.goal_race_distance`
 * / `profile.tt_goal_distance` — so on the live engine, whether one of the
 * runner's OWN 3.4-mile hard efforts counted as fitness evidence depended on
 * what race they said they were training for. This file always passed
 * `CAPACITY_RUN_FLOOR_MI` explicitly instead, so that read never fired here —
 * see that constant's header for why 3.0 rather than 4.0 and what it costs.
 * FIXED 2026-09-01: `goalRunFloorMiForUser` is gone; every live caller
 * (`generate.ts`, `drift-monitor.ts`, `seed-from-onboarding.ts`, the three API
 * routes that used it) now passes the same flat, evidence-only
 * `EVIDENCE_RUN_FLOOR_MI` (`vdot.ts`) that this constant matches — see
 * `docs/reports/capacity-boundary-fix-2026-09-01.md`.
 *
 * IF YOU FIND YOURSELF WANTING GOAL DATA IN HERE, the logic you are writing
 * belongs in Pace Prescription or in Plan Generation. A goal legitimately
 * shapes plan duration, progression, workout emphasis, race specificity and
 * feasibility assessment — doctrine §3, "Train the runner you have" — and it
 * legitimately shapes NONE of the four numbers this file resolves.
 *
 * ── THE LADDER, AND WHERE IT LIVES (§16-17) ─────────────────────────────────
 *
 * One ordered fallback policy per capacity, inside the resolver that owns it.
 * No caller picks a tier, no caller invents an alternate order, and every
 * resolved estimate says which rung answered it (`sourceMode`) so a downstream
 * consumer can tell a threshold read backed by six of the runner's own tempo
 * sessions from a number derived off a self-reported weekly mileage.
 *
 * §16's own worked example is the threshold ladder and this file implements it
 * literally: (1) strong direct threshold evidence, (2) corroborated inferred
 * evidence, (3) recent race-derived estimate, (4) VDOT-derived estimate,
 * (5) onboarding/population prior.
 *
 * ONE APPARENT CONTRADICTION IN THE DOCTRINE, RESOLVED HERE RATHER THAN PICKED
 * SILENTLY. BRIEF 01's fallback ladder reads "Recent race → recent time trial →
 * equivalent-performance model / VDOT → historical performance → self-reported
 * → conservative population prior", which puts RACE FIRST; §16 puts DIRECT
 * TRAINING EVIDENCE first and race third. They are answering different
 * questions. BRIEF 01's ladder is the cold-start ordering for a runner whose
 * training corpus cannot corroborate anything yet — which is the case it is
 * written about ("A new runner may not have enough evidence"). §16's is the
 * ordering for a specific CAPACITY once a corpus exists, and it is the one a
 * capacity resolver needs, because a race is a single observation of a
 * different question (competition over a fixed distance) while four tempo
 * sessions are repeated observations of this one. `SOURCE_MODE_STRENGTH` below
 * encodes §16's order, and the two ladders agree at the cold-start end, which
 * is the only end BRIEF 01 is describing.
 *
 * ── CONFIDENCE (§27, §30, doctrine §27) ─────────────────────────────────────
 *
 * Three bands, and for the three LADDER capacities the TIER sets the band:
 *
 *   direct evidence        [0.50 .. 0.90]
 *   any derived fallback   [0.20 .. 0.50]
 *   population prior        0.10 flat
 *
 * The bands do not overlap, so "as direct evidence accumulates, fallback
 * assumptions lose authority" (BRIEF 01) is true by construction rather than by
 * tuning: the best possible fallback is exactly as confident as the weakest
 * admissible direct read, never more. See `CAPACITY_CONFIDENCE_BANDS` for the
 * argument behind each edge, including why direct evidence is capped at 0.90
 * and not 1.0.
 *
 * DURABILITY IS THE ARGUED EXCEPTION, and it is an exception to the BAND
 * MAPPING only, never to the ceiling. Threshold, high-intensity and easy each
 * answer one question through a ladder where a race is a FALLBACK for a
 * training-derived read. Durability's evidence hierarchy is the other way
 * round: BRIEF 06 makes race history primary evidence for the cross-distance
 * half of the trait ("personal race history can inform individual distance
 * conversion"), not a fallback for it. So the two durability sub-reads keep the
 * confidences their own files already argue — count, distance spread, race
 * authority, cross-observation consistency, freshness — and this layer applies
 * exactly one thing to them: `CAPACITY_CONFIDENCE_BANDS.directCeiling`, the
 * universal statement that no capacity in this app may claim more certainty
 * than 0.90. Mapping a race-derived durability component into the FALLBACK
 * band would be applying the threshold ladder's hierarchy to a question that
 * does not have it.
 *
 * WITHIN a band, confidence is a function of the evidence and of the clock, and
 * of NOTHING ELSE — never of the value. Staleness lowers confidence and never
 * lowers the estimate: that is doctrine §16 ("uncertainty decays with stale
 * evidence; fitness does not"), the 2026-08-31 product decision that corrected
 * the original design's `half_life` field, and the same discipline
 * `durability-anchor.ts` already enforces on its own two sub-reads. This file
 * reuses that file's `recencyWeight` rather than writing a second decay.
 *
 * ── EVIDENCE PROVENANCE (§10, doctrine §25) ─────────────────────────────────
 *
 * Every estimate carries `evidenceIds` traceable to the underlying
 * observations: `runs.id` for a training-derived read, a race slug for a
 * race-derived one. A population-prior estimate carries an EMPTY array and says
 * so in `reasons` — there is no runner-specific evidence behind a population
 * prior, and inventing an id for it would be the fabrication §38 forbids.
 * `evidenceIds` being empty is therefore meaningful, not missing:
 * `sourceMode === 'population_prior'` is the only state in which it is legal.
 *
 * ── COMPUTE AT READ TIME (Rule 10) ──────────────────────────────────────────
 *
 * Nothing here is persisted. Every call re-derives from `runs`, `races` and
 * `profile` through readers that themselves recompute. `resolvedAt` is stamped
 * anyway, because an estimate that travels into a response body or a log needs
 * to say when it was true — and because the day something DOES cache one of
 * these, Rule 10's stamp requirement is already satisfied by the shape.
 *
 * ── WHAT THIS CANNOT CATCH (Rule 22) ────────────────────────────────────────
 *
 * Stated rather than hidden, and this list is what a green test run here does
 * NOT prove:
 *
 *   · HIGH-INTENSITY CAPACITY HAS NO DIRECT-EVIDENCE READER AT ALL. Easy,
 *     threshold and durability each have one; this one starts at the VDOT
 *     fallback, so a runner whose 12×400 sessions are the best thing the app
 *     knows about them still gets an I-pace derived from a threshold-shaped
 *     scalar. That is a real gap, named here rather than papered over with a
 *     tier that pretends — see `resolveHighIntensityCapacity`'s own header for
 *     the interface seam a direct reader slots into.
 *   · CONFIDENCE IS NOT CALIBRATED. Nothing has measured whether a 0.7 here is
 *     right seven times in ten. It is an ORDERING that the bands make
 *     defensible, not a probability, and §30's monotonicity properties are what
 *     the tests can actually check.
 *   · THE INSTRUMENT BLIND SPOT PROPAGATES. `vdot-corpus.ts` names it: K
 *     sessions on the same mis-calibrated watch corroborate a wrong number as
 *     confidently as K good ones. Wrapping those readers in a confidence score
 *     does not see through them; it inherits their blindness and adds a number
 *     to it.
 *   · THE BANDS ARE ONE-SIDED IN THE SAME DIRECTION THE ENGINE ALREADY LEANS
 *     (Rule 22). Every rung below tier 1 is more conservative than the one
 *     above it, and there is no rung anywhere in this file that makes an
 *     estimate FASTER than the evidence for it. That is correct for a capacity
 *     resolver — capacity is a floor, per the standing "current fitness is a
 *     SAFETY FLOOR, not a ceiling" ruling — but it means these tests cannot
 *     fail on the engine under-reading a runner, only on it over-reading one.
 *     The upward path lives in adaptation, not here.
 *   · A REFUSED HABIT WINDOW STILL PRODUCES A NUMBER at the population-prior
 *     rung (see `composeThresholdCapacity`). It is the most conservative rung
 *     the ladder has and it says `HABIT_WINDOW_REFUSED` in `reasons`, but a
 *     consumer that reads `paceSecPerMi` and ignores `reasons` will not know.
 */

import {
  type ThresholdPaceRead,
  type EasyPaceRead,
  type PaceObservation,
  resolveEasyPaceCorpus,
  resolveThresholdPaceCorpus,
  loadThresholdCorpusInputs,
  thresholdCorpusFromInputs,
  type ThresholdMoveCap,
  THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI,
  type ExcludedObservation,
} from '@/lib/training/pace-corpus';
import {
  CORROBORATION_MIN_OBSERVATIONS,
} from '@/lib/training/vdot-corpus';
import {
  POPULATION_ENDURANCE_PRIOR,
  recencyWeight,
  resolveRaceExponent,
  resolveDecoupling,
  type RaceExponentRead,
  type DecouplingRead,
  resolveTrainingDurability,
  type TrainingDurabilityRead,
} from '@/lib/training/durability-anchor';
import {
  bestRecentVdot,
  clampToSanePace,
  easyBandFromTPace,
  iPaceFromAnchorPace,
  iPaceFromVdot,
  rPaceFromVdot,
  resolveCurrentTPace,
  tPaceFromVdot,
  vdotFromTpace,
  type BelowTableAnchor,
  type TPaceResolutionTier,
} from '@/lib/training/vdot';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { conservativeVdotFromMileage } from '@/lib/plan/spec-builder';
import { normalWeeklyMileageDetail, type NormalReading } from '@/lib/training/normal-window';
import {
  readSelfReportedPr,
  prPriorWeight,
  type SelfReportedPrRead,
} from '@/lib/training/self-reported-pr';
import type { RaceHistoryEntry } from '@/lib/training/race-history';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
// THE BELIEF-TENSION CONSUMER. `reexamination.ts` deliberately imports nothing
// from this file at run time (it writes out the half-life rather than importing
// it, with a gate keeping the two equal) precisely so this edge can be a plain
// static import and there is no module cycle to reason about.
import {
  REEXAMINATION_WINDOW_DAYS,
  accumulateReexamination,
  tensionObservationsFrom,
  type ReexaminationPressure,
} from '@/lib/evidence/reexamination';
import { classifyRecentActivities } from '@/lib/evidence/load-activity-evidence';

/* ══════════════════════════════════════════════════════════════════════════
 * 0 · GOAL ISOLATION, ENFORCED BY THE COMPILER (§6, §10)
 *
 * `Equals` is the standard exact-type equality trick (mutual assignability of
 * two conditional types is too weak — `(a: string, b?: string, c?: Goal) => X`
 * IS assignable to `(a: string, b?: string) => X`, so a plain annotation would
 * let a goal parameter in through the optional-argument door). Comparing the
 * whole `Parameters<>` TUPLE closes it: a third parameter changes the tuple,
 * and the assertion stops compiling.
 *
 * Falsified before landing (Rule 18): adding `goalSec?: number` to any of the
 * four signatures makes `tsc --noEmit` fail on that resolver's line below.
 * ═══════════════════════════════════════════════════════════════════════ */

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;

/** The ONLY parameter tuple a capacity resolver may have. A runner, and a day.
 *  Anything else — a goal, a goal pace, a target finish time, a "runner
 *  metrics" bag that could carry one — is a compile error, which is what §6
 *  means by structural rather than conventional separation. */
type CapacityResolverParams = [userId: string, todayISO?: string];

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE DOMAIN TYPES (§5, §17, §27)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which rung of the fallback ladder produced an estimate (§17). Verbatim the
 * six modes that section names, lower-cased.
 *
 *   direct           — the runner's own classified training, corroborated
 *   inferred         — a demonstrated pace read through a conversion, not a
 *                      direct observation of THIS capacity
 *   race_derived     — anchored on a race result
 *   vdot_fallback    — routed through the Daniels equivalency scalar
 *   user_prior       — a self-reported ability, unverified by any running
 *   population_prior — no runner-specific evidence at all
 */
export type SourceMode =
  | 'direct'
  | 'inferred'
  | 'race_derived'
  | 'vdot_fallback'
  | 'user_prior'
  | 'population_prior';

/**
 * §16's ladder order, as a number, so "which of these two modes is stronger"
 * is answered in ONE place. Higher is stronger.
 *
 * See the file header for why this is §16's order and not BRIEF 01's, and why
 * the two are not actually in conflict.
 */
export const SOURCE_MODE_STRENGTH: Readonly<Record<SourceMode, number>> = Object.freeze({
  direct: 5,
  inferred: 4,
  race_derived: 3,
  vdot_fallback: 2,
  user_prior: 1,
  population_prior: 0,
});

/**
 * Structured reason codes (§27). NOT free text: the UI explanation, the debug
 * view and the tests all read the same enum, so an explanation cannot drift
 * from what the model did. A human-readable sentence is the CALLER's job, built
 * from these; §27's own warning is against generating explanations
 * independently and hoping they match.
 */
export type CapacityReasonCode =
  // ── which rung answered ──
  | 'DIRECT_CORROBORATED_THRESHOLD_EVIDENCE'
  | 'DIRECT_CORROBORATED_EASY_EVIDENCE'
  | 'EASY_DERIVED_FROM_THRESHOLD_CAPACITY'
  | 'MEASURED_VDOT_FALLBACK'
  | 'BELOW_TABLE_ANCHOR_FALLBACK'
  | 'MILEAGE_POPULATION_PRIOR'
  | 'ONBOARDING_MILEAGE_USER_PRIOR'
  // The runner ANSWERED the onboarding weekly-mileage question with zero.
  // A real self-report, and not the same fact as never having answered —
  // both imply the same number and only one of them is something the runner
  // told us (Rule 11).
  | 'ONBOARDING_MILEAGE_ANSWERED_ZERO'
  // A validated self-reported PR (`profile.race_history`) contributed to
  // this estimate, shrunk toward the mileage prior. Never evidence.
  | 'ONBOARDING_PR_USER_PRIOR'
  // Something was on file and every entry failed validation — an implausible
  // pace, an unparseable distance/time, or a VDOT off the [30,85] table.
  // A thing to tell the runner about; "no PR on file" is not.
  | 'ONBOARDING_PR_REJECTED'
  | 'PERSONAL_RIEGEL_EXPONENT'
  | 'POPULATION_ENDURANCE_PRIOR'
  | 'LONGITUDINAL_DECOUPLING'
  | 'DAY_TO_DAY_CONTINUITY_CAPPED'
  | 'CONTINUITY_UNAVAILABLE'
  | 'MARATHON_REHEARSALS_DEMONSTRATED'
  | 'NO_MARATHON_REHEARSAL_EVIDENCE'
  | 'EXPONENT_RESTS_ON_ONE_LONG_RACE'
  // ── what the evidence looked like ──
  | 'THREE_RECENT_CORROBORATING_SESSIONS'
  | 'SPARSE_CORROBORATION'
  | 'OBSERVATIONS_AGREE'
  | 'OBSERVATIONS_DISAGREE'
  | 'FRESH_EVIDENCE'
  | 'STALE_EVIDENCE'
  | 'TWO_INDEPENDENT_EVIDENCE_TYPES'
  // ── what was missing, stated rather than implied ──
  | 'NO_DIRECT_HIGH_INTENSITY_READER'
  | 'NO_DIRECT_EVIDENCE'
  | 'NO_DECOUPLING_CORROBORATION'
  | 'NO_RACE_EXPONENT_EVIDENCE'
  | 'HABIT_WINDOW_REFUSED'
  // ── the belief-tension consumer (lib/evidence/reexamination.ts) ──
  | 'REEXAMINATION_LOWERED_THE_CORROBORATION_BAR'
  // ── the evidence contract (2026-09-01, pace-corpus.ts §1b) ──
  | 'SINGLE_SESSION_MOVE_CAPPED'
  | 'REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT'
  | 'NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT'
  | 'EVIDENCE_ENGINE_READ_UNAVAILABLE';

/**
 * §31 · version the model, so a behaviour change can be attributed to new
 * evidence vs. a changed algorithm vs. a changed fallback. Bump the MINOR when
 * a ladder order or a confidence mapping changes; the PATCH when a reason code
 * or a reported field changes without moving a number.
 */
export const CAPACITY_MODEL_VERSION = '1.0.0';

/**
 * What every capacity estimate carries, whatever the capacity is (§5).
 *
 * Deliberately WITHOUT a `paceSPerMi` field, unlike the sketch this layer was
 * commissioned from. Durability is not a pace and forcing one onto the base
 * would make `resolveDurability` either lie or carry a null nobody may read —
 * so each concrete type below adds the value shape its own capacity actually
 * has, and the base carries only what is universal: how much to trust it, where
 * it came from, what evidence is behind it, and when it was resolved.
 */
export interface CapacityEstimateBase {
  /** 0..1. See `CAPACITY_CONFIDENCE_BANDS`. Never a probability; an ordering. */
  confidence: number;
  /** Which rung of this capacity's ladder answered (§17). */
  sourceMode: SourceMode;
  /**
   * Traceable to the underlying observations (§10 evidence provenance,
   * doctrine §25). `runs.id` strings for a training-derived read, race slugs
   * for a race-derived one. EMPTY only when `sourceMode` is
   * `'population_prior'`, where there is no runner-specific evidence to name.
   */
  evidenceIds: string[];
  /** ISO instant. Compute-at-read-time, so this is "now" — stamped anyway, per
   *  Rule 10, so an estimate that gets logged or cached carries its own age. */
  resolvedAt: string;
  /** Structured, never prose (§27). */
  reasons: CapacityReasonCode[];
  /** §31. */
  modelVersion: string;
}

/** What the runner can sustain at threshold — tempo, cruise intervals,
 *  sustained quality, and the anchor longer-distance prescription offsets from
 *  (BRIEF 03's routing). */
export interface ThresholdCapacityEstimate extends CapacityEstimateBase {
  /** Daniels T-pace, s/mi. */
  paceSecPerMi: number;
  /** 2026-09-02 · the day-to-day continuity cap across tiers (see
   *  `applyDayToDayContinuity`). Null when yesterday could not be resolved. */
  continuity?: { yesterdayPaceSecPerMi: number; applied: boolean; uncappedPaceSecPerMi: number } | null;
  /**
   * The equivalent VDOT, for the surfaces and conversions that still need one.
   * DERIVED DISPLAY, not the source of the number (§34's classification): the
   * pace is resolved first and this is `vdotFromTpace` of it. Null only when
   * the pace sits outside the [30,85] table, which is exactly the below-table
   * runner `BelowTableAnchor` exists for.
   */
  vdot: number | null;
  /**
   * 2026-09-01 · the evidence contract's provenance. Every observation the
   * corpus admitted (with its weight and how the weight was assembled) and
   * every one it refused (with the reason), plus how the daily move cap
   * treated the read. Present on a `direct` read; absent on the fallback
   * rungs, which have no corpus to report.
   */
  evidence?: {
    supporting: PaceObservation[];
    excluded: ExcludedObservation[];
    weightedSupport: number;
    representativeSupporting: number;
    moveCap: ThresholdMoveCap;
  };
}

/** What the runner can hold at 3-5K effort — the anchor for VO2-oriented
 *  intervals and short repetitions (BRIEF 03's routing). */
export interface HighIntensityCapacityEstimate extends CapacityEstimateBase {
  /** Daniels I-pace, s/mi — ~current 5K race pace. */
  intervalPaceSecPerMi: number;
  /**
   * Daniels R-pace, s/mi — ~mile race pace. NULLABLE on purpose and not a
   * silent zero: the below-table anchor rung has no doctrine-supported route
   * to a mile-column pace (`rPaceFromVdot` reads a VDOT table this runner is
   * off), so R is genuinely unknown there. Rule 11: a caller must branch.
   */
  repetitionPaceSecPerMi: number | null;
  /** Derived display, same status as `ThresholdCapacityEstimate.vdot`. */
  vdot: number | null;
}

/**
 * The boundary easy running must not cross.
 *
 * A CEILING, not a band and not a target — the 2026-08-31 product decision, in
 * the owner's own framing: "a band implies a target to land inside; a ceiling
 * plus feel-based guidance implies a boundary not to cross, with the runner's
 * own sense doing the rest." Doctrine §9 says the same thing from the other
 * side: "The runner should not finish an easy run wondering whether they
 * 'failed' because they ran too slowly."
 *
 * This is why easy gets its own resolver rather than being routed out of
 * threshold capacity like marathon pace is: it is not a capacity number that
 * feeds other workout types, it is a single limit with feel-based guidance
 * attached, and BRIEF 03 treats it distinctly for exactly that reason.
 */
export interface EasyCeilingEstimate extends CapacityEstimateBase {
  /** No faster than this, s/mi. Slower is always fine. */
  ceilingSecPerMi: number;
}

/**
 * One of durability's two sub-observations, present or explicitly absent.
 *
 * Rule 11 as a type: the absent branch carries no `value`, so
 * `component.value` does not compile until the caller has checked `present`.
 * A decoupling read of zero (a runner who does not drift at all) and a
 * decoupling read that could not corroborate are opposite facts, and the whole
 * reason durability reports its components rather than one blended scalar is
 * that a caller has to be able to tell them apart.
 */
export type DurabilityComponent<T> =
  | {
      present: true;
      value: T;
      confidence: number;
      sourceMode: SourceMode;
      evidenceIds: string[];
    }
  | {
      present: false;
      /** The underlying reader's own refusal reason, passed through unchanged. */
      reason: string;
      observations: number;
    };

/**
 * How well capability survives duration (BRIEF 06).
 *
 * NOT A PACE, and this is the shape the commissioning brief flagged as needing
 * thought. Durability is latent — "no single metric equals durability", BRIEF
 * 06 — and `durability-anchor.ts` already models it as TWO independent
 * sub-observations answering different halves of the question: a personal
 * Riegel exponent (how does this runner's time-distance curve BEND across
 * races) and longitudinal pace/HR decoupling (how does this runner's aerobic
 * cost drift WITHIN a long run). They are not commensurable and blending them
 * into one scalar would destroy the one thing BRIEF 06 asks for — the ability
 * to say WHICH kind of durability evidence is thin.
 *
 * So the estimate reports both components AND one number a caller can actually
 * spend: `enduranceExponent`, which always has a value because the population
 * prior is a legitimate floor for it, unlike decoupling which has no meaningful
 * population default at all.
 */
export interface DurabilityCapacityEstimate extends CapacityEstimateBase {
  /**
   * The number to spend on a cross-distance conversion — the personal Riegel
   * exponent shrunk toward `POPULATION_ENDURANCE_PRIOR`, or that prior itself
   * when no fit is possible. Always present; `sourceMode` and `raceExponent`
   * say which.
   */
  enduranceExponent: number;
  /** The fitted exponent's own read, or its argued absence. */
  raceExponent: DurabilityComponent<number>;
  /**
   * 2026-09-02 · marathon rehearsals (`Research/02` §12.2/§12.4): the median
   * pace the runner has HELD at marathon heart rate over the rehearsal
   * distance, on the number of occasions doctrine requires. Present only past
   * that bar. Consumed by `marathonPaceFromDurability` as a cap from the fast
   * side — the mechanism by which marathon pace is EARNED in the block.
   */
  trainingDurability?: DurabilityComponent<number>;
  /**
   * The RAW weighted log-log fit behind `raceExponent.value`, UNSHRUNK —
   * `RaceExponentRead.rawFittedExponent`, carried through unchanged. Null
   * whenever `raceExponent` is absent.
   *
   * TWO CONSUMERS, ONE FIELD, ONE NAME (Rule 16), and they arrived from
   * opposite directions on the same day. Phase 1 added it so a consumer can
   * state the honest RANGE around `enduranceExponent`; the Coaching Thesis
   * needs it because doctrine's runner-type classification (`Research/02`
   * §7.1, `CURVE_NEUTRAL_EXPONENT_BAND`) reads the SHAPE of the observed
   * curve, and `lib/coach/limiter.ts` already spends the raw fit for exactly
   * that reason ("the shrunk value would pull every runner toward the neutral
   * band"). `raceExponent.value` stays the number to PRESCRIBE from.
   *
   * Optional so fixtures that build this estimate by hand and never read the
   * shape stay valid; `composeDurability` always sets it, and
   * `_thesis_golden.test.ts` pins that.
   */
  rawFittedExponent?: number | null;
  /** Mean pace/HR drift across qualifying long runs, percentage points.
   *  Positive = HR climbed faster than pace over the back half. */
  decoupling: DurabilityComponent<number>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · CONFIDENCE (§27, §30) — the bands, and the mapping into them
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * FOUR NON-OVERLAPPING BANDS, AND THE TIER PICKS THE BAND.
 *
 * THESE NUMBERS ARE A CONVENTION, NOT A RESEARCH FINDING, in exactly the sense
 * `CORROBORATION_MIN_OBSERVATIONS` (vdot-corpus.ts) and
 * `DURABILITY_HALF_LIFE_DAYS` (durability-anchor.ts) are conventions. No
 * `Research/` file models how much to trust a capacity estimate; what doctrine
 * grounds is the ORDERING, and each edge below is argued from a real sentence
 * rather than picked to feel right.
 *
 * ── directCeiling = 0.90 · why direct evidence never reads 1.0 ─────────────
 *
 * `vdot-corpus.ts` names a blind spot corroboration cannot close: K independent
 * sessions on the same mis-calibrated watch, the same short-measuring GPS, the
 * same fast treadmill belt, corroborate a wrong number exactly as confidently
 * as K good ones. A reader that cannot see that class must not be able to
 * report certainty about it. Doctrine §27 licenses the top of the scale as "we
 * know this pretty damn well", which is what 0.90 is; 1.0 would be a claim this
 * apparatus has no way to earn.
 *
 * ── directFloor = 0.50 = fallbackCeiling · why they touch exactly ──────────
 *
 * BRIEF 01: "As direct evidence accumulates, fallback assumptions should lose
 * authority." Making the direct floor equal the fallback ceiling turns that
 * sentence into a structural property instead of a tuning outcome — the best
 * possible fallback can only ever TIE the weakest admissible direct read, and
 * can never beat it. §17 is the same point stated as a warning: "a direct
 * threshold estimate with four supporting workouts is not equivalent to a guess
 * derived from a self-reported 10K."
 *
 * 0.50 specifically, for the fallback ceiling, is the number the commissioning
 * brief proposed and it survives its own argument: a VDOT-derived estimate is
 * one inference removed from any observation (a pace, read as a scalar, read
 * back out as a different pace through a table), and BRIEF 03 demotes VDOT to
 * "fallback, initialization, equivalency, sanity check" precisely because that
 * round trip loses information. Something one inference removed from the
 * evidence should not be able to cross into the half of the scale reserved for
 * the evidence itself.
 *
 * ── fallbackFloor = 0.20 · why a fallback is not near-zero ─────────────────
 *
 * Doctrine §26, "FALLBACKS ARE GOOD": a recent race routed through an
 * equivalency model is a real, defensible answer for a runner whose training
 * corpus cannot corroborate anything yet, and pricing it at almost nothing
 * would make the app behave as if it knew nothing about a runner it has real
 * information about. 0.20 keeps it clearly subordinate while leaving it visibly
 * above the prior.
 *
 * ── populationPrior = 0.10 flat · why not zero, and why it does not scale ──
 *
 * `conservativeVdotFromMileage`'s own header states what it owes: "monotonic,
 * bounded, and conservative — never that it is measured", and its output is
 * marked `provisional_mileage` all the way through, with three readers refusing
 * to inherit it. That is an honest, doctrine-shaped guess about a real runner,
 * so it is not zero. It does not scale with anything, because there is nothing
 * runner-specific to scale it with — a self-reported weekly mileage is one
 * number the runner typed, and grading confidence off it would manufacture the
 * precision §38 forbids.
 *
 * ── userPrior = 0.15 flat · a self-report is still runner-specific, and still
 *    not evidence ─────────────────────────────────────────────────────────
 *
 * FIXED 2026-09-01 (`docs/reports/cold-start-prior-fix-2026-09-01.md`). Before
 * this, a zero-run account's threshold pace floored straight to
 * `populationPrior` off `conservativeVdotFromMileage(0)` — VDOT 30, ~10:42/mi
 * — no matter what the runner had typed at onboarding about their own running
 * history. The legacy VDOT cascade (`generate.ts`'s `COLD-2`/`HIGHVOL-1`
 * comments) has always seeded exactly this rung from
 * `profile.history_avg_weekly_mi`, the runner's own self-reported onboarding
 * weekly mileage; this resolver's `loadVdotFallback` never wired that in,
 * which is the ~35% pace divergence the shadow-compare audit in
 * `docs/reports/canonical-authoring-migration-2026-09-01.md` §5.1 found on
 * every real zero-run account this database holds.
 *
 * `SourceMode.user_prior` already existed for exactly this shape ("a
 * self-reported ability, unverified by any running") and already sat strictly
 * between `vdot_fallback` and `population_prior` in `SOURCE_MODE_STRENGTH` —
 * it was declared and ranked but never once assigned by either resolver. No
 * new mode was needed; only the missing wire.
 *
 * WHY IT IS ITS OWN BAND AND NOT JUST `populationPrior` RELABELLED. §17's
 * whole point is that the label says how much to trust the number — a
 * self-report the runner actually typed about their own history is a
 * different epistemic state than the resolver knowing nothing about them at
 * all, and collapsing the two into one flat 0.10 would erase that distinction
 * downstream (a caller reading `reasons` could no longer tell "he told us
 * something" from "we have nothing").
 *
 * WHY 0.15 AND NOT SOMEWHERE ELSE. Flat, for the same reason
 * `populationPrior` is flat: a self-reported weekly-mileage BUCKET midpoint
 * (`HIST_AVG_MIDPOINTS`, `lib/onboarding/state.ts`) is one number the runner
 * picked from a chip, with no corroboration count, no freshness date and no
 * cross-observation spread to score — inventing one of those would be the
 * fake specificity §38 forbids. The VALUE sits strictly between the two bands
 * it sits between in `SOURCE_MODE_STRENGTH`: it must never touch
 * `fallbackFloor` (0.20), because a self-report is still not an observation
 * of this runner running, and it must sit strictly above `populationPrior`
 * (0.10), because unlike the population prior it IS runner-specific — the
 * runner told the app something true about themselves, even if unverified.
 *
 * ── THE BOUNDARY THIS BAND DOES NOT MOVE ────────────────────────────────────
 *
 * Self-reported onboarding mileage informs a LOW-CONFIDENCE PRIOR here and
 * nothing more. It never reaches `direct` or `inferred` — those require an
 * actual observation of the runner running, which a chip tapped at onboarding
 * is not. `loadVdotFallback` only ever substitutes it into the WEEKLY-MILEAGE
 * input the mileage-estimate rung already consumed (`conservativeVdotFromMileage`
 * still does the same monotonic, bounded, conservative conversion it always
 * did) — it is never used to fabricate a VDOT, a race result, or any evidence
 * id. And it only substitutes when the runner's OWN FILTERED training data
 * reads zero: the moment any real run lands with nonzero representative
 * weekly mileage, `priorWeeklyMi` prefers it over the self-report
 * automatically, with no special-case code — the same fall-through property
 * every other rung in this ladder already has.
 */
export const CAPACITY_CONFIDENCE_BANDS = Object.freeze({
  directFloor: 0.50,
  directCeiling: 0.90,
  fallbackFloor: 0.20,
  fallbackCeiling: 0.50,
  userPrior: 0.15,
  populationPrior: 0.10,
});

/**
 * How many corroborating observations count as "fully evidenced" for the count
 * component of confidence — beyond this, more sessions stop adding.
 *
 * CONVENTION, and deliberately the same value as
 * `DECOUPLING_SATURATION_OBSERVATIONS` (durability-anchor.ts) because it is the
 * same shape of question — "how many independent readings before more readings
 * stop telling us anything about how much to trust the level". A SEPARATE
 * constant rather than an import, per Rule 16: these are two quantities that
 * currently share a value, not one quantity with two names, and a future pass
 * that finds threshold sessions saturate faster than long runs should be able
 * to move one without silently moving the other.
 *
 * Eight, for a runner training four or more days a week: one quality session a
 * week over the threshold reader's 60-day window, or one long run a week over
 * the easy reader's 90-day window, both land in this range without the constant
 * being fitted to any one runner's cadence.
 */
export const CAPACITY_SATURATION_OBSERVATIONS = 8;

/**
 * Half-life, in days, for how fast a capacity estimate's CONFIDENCE fades with
 * no fresh corroborating evidence. Governs `confidence` and NOTHING ELSE — it
 * is never an input to any resolved value, which is doctrine §16 and the
 * 2026-08-31 decision that corrected the original design's `half_life` field.
 *
 * CONVENTION, not a research finding. What grounds the number: this file's
 * sibling states, in `DURABILITY_HALF_LIFE_DAYS`'s own header and on the
 * owner's instruction, that durability should decay "far more slowly than a
 * speed anchor's 3-4 week half-life". That sentence is the closest thing in
 * this repo to a stated rate for a pace anchor, so it is reused here rather
 * than re-derived from zero: 28 days, the upper edge of the range it names.
 *
 * SANITY, not physiology: this is also comfortably inside `VDOT_EXPIRY_DAYS`
 * (84), so an observation the VDOT machinery would still admit at all has
 * already lost most of its confidence weight here — which is the correct
 * direction for a confidence term.
 */
export const CAPACITY_CONFIDENCE_HALF_LIFE_DAYS = 28;

/**
 * Relative spread across the corroborating observations at which the
 * consistency component of confidence is FULL (`low`) and at which it reads
 * ZERO (`high`). Fractions of the median observed value.
 *
 * CONVENTION for the placement, grounded in a real doctrine number, exactly as
 * `RACE_EXPONENT_CONSISTENCY_LOOSE_LN` (durability-anchor.ts) is: `Research/02`
 * §2.3's own reported accuracy table gives "Half → marathon | ±3-8%" as the
 * error band doctrine itself expects between two honest readings of one stable
 * trait through a conversion. Observations agreeing to within 3% agree to
 * within the tightest band doctrine reports anywhere; observations disagreeing
 * by more than 8% disagree by more than doctrine's loosest reported band
 * explains, which is BRIEF 02's "observations conflict" case and should cost
 * confidence rather than be averaged into a confident-looking mean.
 */
export const CAPACITY_CONSISTENCY_BAND = Object.freeze({ low: 0.03, high: 0.08 });

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Whole days between two ISO dates, never negative. Noon-anchored, DST-safe. */
function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + 'T12:00:00Z');
  const b = Date.parse(toISO + 'T12:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** What a direct-evidence read offers a confidence score. Pure data, so the
 *  mapping below is testable one component at a time (§30's monotonicity
 *  properties need exactly that). */
export interface DirectEvidenceQuality {
  /** How many qualifying observations the window held. */
  observations: number;
  /** ISO dates of the observations that SET the level. */
  supportingDates: readonly string[];
  /** The values those observations carried, in whatever unit the capacity uses
   *  — only their SPREAD is read, so the unit does not matter as long as it is
   *  consistent within one call. */
  supportingValues: readonly number[];
  /** The corroboration floor the reader used, so a caller that overrode
   *  `minObservations` is scored against its own bar rather than the default. */
  minObservations: number;
}

/** The three components of a direct-evidence confidence, reported alongside
 *  the blend so a caller (or a human) can see WHY it sits where it does
 *  without re-deriving it — same transparency `RaceExponentRead.evidenceScore`
 *  gives. */
export interface ConfidenceComponents {
  countScore: number;
  consistencyScore: number;
  freshnessScore: number;
  /** `(evidenceScore + freshnessScore) / 2`, the 0..1 position within the
   *  band. Same blend shape `aggregateDecoupling` uses, reused rather than
   *  re-argued. */
  blended: number;
}

/**
 * Pure · score a direct-evidence read into the DIRECT band.
 *
 * MONOTONE IN EVIDENCE BY CONSTRUCTION (§30): `countScore` is non-decreasing in
 * `observations`, `consistencyScore` is non-increasing in spread, and
 * `freshnessScore` is non-increasing in age. Nothing here reads the VALUE of
 * the estimate, so a faster or slower reading cannot move its own confidence —
 * which is the property that keeps §29's "readiness contradiction" check
 * meaningful one layer up.
 */
export function directEvidenceConfidence(
  q: DirectEvidenceQuality,
  todayISO: string,
): { confidence: number; components: ConfidenceComponents } {
  const k = Math.max(1, q.minObservations);
  const saturation = Math.max(k + 1, CAPACITY_SATURATION_OBSERVATIONS);
  const countScore = clamp01((q.observations - k) / (saturation - k));

  const values = q.supportingValues.filter((v) => Number.isFinite(v) && v > 0);
  let consistencyScore = 0;
  if (values.length >= 2) {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const spread = median > 0 ? (sorted[sorted.length - 1] - sorted[0]) / median : Number.POSITIVE_INFINITY;
    consistencyScore = clamp01(
      1 - (spread - CAPACITY_CONSISTENCY_BAND.low)
        / (CAPACITY_CONSISTENCY_BAND.high - CAPACITY_CONSISTENCY_BAND.low),
    );
  } else if (values.length === 1) {
    // One supporting value has no spread to read. Not "perfectly consistent" —
    // unknown. Scoring it as full agreement would let a single observation
    // out-score three that genuinely agree, which inverts BRIEF 02's whole
    // corroboration principle.
    consistencyScore = 0;
  }

  const dates = q.supportingDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const freshnessScore = dates.length === 0
    ? 0
    : recencyWeight(
        Math.min(...dates.map((d) => daysBetween(d, todayISO))),
        CAPACITY_CONFIDENCE_HALF_LIFE_DAYS,
      );

  const evidenceScore = clamp01((countScore + consistencyScore) / 2);
  const blended = clamp01((evidenceScore + freshnessScore) / 2);
  const { directFloor, directCeiling } = CAPACITY_CONFIDENCE_BANDS;
  return {
    confidence: directFloor + (directCeiling - directFloor) * blended,
    components: { countScore, consistencyScore, freshnessScore, blended },
  };
}

/**
 * Pure · score a DERIVED estimate into the fallback band.
 *
 * The only thing a fallback offers is how recent the thing it was derived from
 * is — there is no corroboration count and no cross-observation agreement to
 * read, because a fallback is by definition one observation (or one
 * self-report) put through a conversion. Pretending otherwise by inventing a
 * count would be the fake specificity §38 forbids.
 */
export function fallbackConfidence(anchorDateISO: string | null, todayISO: string): number {
  const { fallbackFloor, fallbackCeiling } = CAPACITY_CONFIDENCE_BANDS;
  if (anchorDateISO == null || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDateISO)) return fallbackFloor;
  const freshness = recencyWeight(daysBetween(anchorDateISO, todayISO), CAPACITY_CONFIDENCE_HALF_LIFE_DAYS);
  return fallbackFloor + (fallbackCeiling - fallbackFloor) * clamp01(freshness);
}

/** Evidence-shaped reason codes shared by every direct-evidence rung, so the
 *  same observation quality produces the same vocabulary whichever capacity
 *  read it. */
function evidenceReasons(
  q: DirectEvidenceQuality,
  c: ConfidenceComponents,
): CapacityReasonCode[] {
  const out: CapacityReasonCode[] = [];
  out.push(
    q.observations > q.minObservations ? 'THREE_RECENT_CORROBORATING_SESSIONS' : 'SPARSE_CORROBORATION',
  );
  out.push(c.consistencyScore >= 0.5 ? 'OBSERVATIONS_AGREE' : 'OBSERVATIONS_DISAGREE');
  out.push(c.freshnessScore >= 0.5 ? 'FRESH_EVIDENCE' : 'STALE_EVIDENCE');
  return out;
}

/** `DirectEvidenceQuality` from a pace reader's supporting observations. Both
 *  pace readers report the same `PaceObservation` shape, so this is written
 *  once rather than twice. */
function qualityFromPaceObservations(
  observations: number,
  supporting: readonly PaceObservation[],
  minObservations: number,
): DirectEvidenceQuality {
  return {
    observations,
    supportingDates: supporting.map((o) => o.date),
    supportingValues: supporting.map((o) => o.paceSecPerMi),
    minObservations,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE LEGACY VDOT FALLBACK, BEHIND ONE ADAPTER (§4)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The honest-effort distance floor this layer admits a training run at.
 *
 * §6 IN ONE CONSTANT. Until 2026-09-01 the live engine resolved this through
 * `goalRunFloorMiForUser`, which read the runner's stated goal distance — so
 * on that path, whether one of the runner's OWN 3.4-mile hard efforts was
 * admissible fitness evidence depended on what race they said they were
 * training for. That was goal data reaching a capacity read, and §6 is
 * explicit that the fitness resolver should not be able to see the goal at
 * all. This file never replicated that leak — it always passed
 * `CAPACITY_RUN_FLOOR_MI` explicitly — and the live engine has now been fixed
 * to match: `goalRunFloorMiForUser` is deleted, and every call site that used
 * it passes the OLD engine's own evidence-only floor
 * (`EVIDENCE_RUN_FLOOR_MI`, `vdot.ts`) instead. See
 * `docs/reports/capacity-boundary-fix-2026-09-01.md`.
 *
 * 3.0 AND NOT 4.0, and the choice is argued rather than defaulted:
 * admissibility is a property of the EFFORT, not of the runner's ambition. A
 * 3.1-mile all-out effort demonstrates the same physiology whoever ran it, and
 * `EVIDENCE_RUN_FLOOR_MI`'s own header says so — 3.0 is there because "a 5K
 * time trial IS a valid VDOT input", which is a statement about the test, not
 * about the tester. Keying it to the goal produces the incoherent result that
 * a runner's own past effort becomes invisible to the engine on the day they
 * change their goal, and it is what FLOOR-1 (2026-06-15) already had to fix
 * once in the other direction, when a flat 4.0 fabricated VDOTs for 5K
 * runners by hiding their real efforts.
 *
 * WHAT IT COSTS, stated rather than hidden: a half/marathon-goal runner's
 * 3.0-3.9 mile hard efforts are now admissible to the fallback tier where the
 * live engine used to exclude them. Three things bound that. It is the
 * FALLBACK tier only — a runner with direct threshold evidence never reaches
 * it. `passesRunHonestyGate` still requires a quality label or a hard HR, so a
 * brisk 3.5-mile Tuesday does not qualify. And `bestRecentVdot`'s corpus
 * ceiling still bounds any single training read against what K sessions
 * corroborate.
 *
 * FOLLOW-UP, still open: the right long-term answer is a floor keyed to the
 * distances this runner has actually RACED — a runner-model question,
 * answerable without the goal — rather than the flat constant here. Named as
 * follow-up work, not attempted in this fix.
 */
export const CAPACITY_RUN_FLOOR_MI = 3.0;

/**
 * Everything the ladder's non-direct rungs need, loaded once.
 *
 * §4 · THE LEGACY ADAPTER. `bestRecentVdot` / `resolveCurrentTPace` /
 * `conservativeVdotFromMileage` are the VDOT-first resolution this architecture
 * demotes to a fallback. They are not deleted yet because every existing
 * consumer still calls them directly, and deleting them under those consumers
 * is the wiring phase's job, not this one's. What this file guarantees is the
 * half §4 asks for TODAY: no NEW feature code reaches them through here, and
 * the capacity resolvers are the only intended caller of this function.
 *
 * §3's distinction is the one that matters and it is preserved exactly: VDOT is
 * allowed to matter when direct evidence is insufficient, decided HERE, by the
 * canonical resolver — never by arbitrary plan code helping itself to
 * `vdotToThreshold(user.vdot)`.
 */
export interface VdotFallbackRead {
  /** `bestRecentVdot().best.vdot`, faded, or null when nothing qualified. */
  measuredVdot: number | null;
  /** Race slug or `runs.id` behind `measuredVdot`. Null with it. */
  measuredVdotEvidenceId: string | null;
  /** ISO date of that candidate, for the freshness term. Null with it. */
  measuredVdotDate: string | null;
  /** Whether the winning candidate was a race — decides `race_derived` vs
   *  `inferred` for the below-table rung, and is reported for the measured
   *  rung so a caller can see it. */
  measuredVdotSource: 'race' | 'run' | null;
  /** The honest demonstrated pace of a runner the [30,85] table cannot
   *  represent. Null for everyone the table can. */
  belowTableAnchor: BelowTableAnchor | null;
  /**
   * The Rule 8-FILTERED habit volume, for the population-prior rung.
   *
   * `normalWeeklyMileage`, not `recentWeeklyMileageMi`: "what volume does this
   * runner normally train at" is a capability question and Rule 8 puts it
   * squarely on the filtered side — sizing a cold-start fitness prior off a
   * window the engine itself prescribed as taper is the exact defect that rule
   * was locked for. The refusal branch is honoured rather than coerced; see
   * `composeThresholdCapacity`.
   */
  normalWeeklyMi: NormalReading<number>;
  /**
   * HOW MANY of the Rule 8-filtered representative days the runner actually
   * ran on — the COVERAGE half of the same read `normalWeeklyMi` is the RATE
   * half of (`normalWeeklyMileageDetail`, one query, one filter, so the two
   * cannot disagree).
   *
   * This is the quantity that retires the onboarding self-report CONTINUOUSLY
   * (`priorWeeklyMi`, and `USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS`'s header
   * for why a rate could not do it). Zero when the habit window refused —
   * which is not a claim that the runner ran nothing, only that no
   * representative day was available to count; `normalWeeklyMi.ok === false`
   * is where that fact lives (Rule 11), and `priorWeeklyMi` reads both.
   */
  normalRunDays: number;
  /**
   * The runner's own SELF-REPORTED onboarding weekly mileage
   * (`profile.history_avg_weekly_mi`), for the `user_prior` rung — FIXED
   * 2026-09-01, see `CAPACITY_CONFIDENCE_BANDS.userPrior`'s header for the
   * defect this closes and the boundary it does not cross.
   *
   * Null when the profile row is missing, the field was never answered, or the
   * read itself failed (`rowOrNull`, `lib/db/read.ts` — three states collapse
   * to one here on purpose: whichever of the three is true, the ladder's
   * correct move is identical, fall through to the real population prior).
   * Never coerced to zero — `priorWeeklyMi` treats `null` and "answered zero"
   * differently, because a runner who typed "0-5 mi/wk" DID answer, at
   * `HIST_AVG_MIDPOINTS['0-5'] = 3`, not null.
   */
  selfReportedWeeklyMi: number | null;
  /**
   * The runner's own SELF-REPORTED onboarding PRs (`profile.race_history`),
   * VALIDATED — the typed-PR rung the canonical ladder was missing.
   *
   * The legacy cascade has consumed this field since `PARITY-1` (2026-06-23),
   * raw, straight into `bestRecentVdot`; this ladder ignored it entirely,
   * which the 2026-09-01 independent audit measured as a ~101 s/mi residual
   * on a real cold-start account. Neither is right. It enters here as a
   * validated, conservative, LOW-CONFIDENCE `user_prior` shrunk toward the
   * mileage prior, and never as `direct` / `inferred` / `race_derived`.
   *
   * Rule 11 as a shape: `readSelfReportedPr` distinguishes "nothing on file"
   * from "something on file and every entry failed validation", and the
   * rejection reasons travel so a surface can tell the runner which.
   *
   * See `lib/training/self-reported-pr.ts`.
   */
  selfReportedPr: SelfReportedPrRead;
}

/**
 * The runner's own onboarding self-report of weekly mileage, or `null` when
 * there is none to read (missing profile, unanswered field, or a failed read
 * — see `VdotFallbackRead.selfReportedWeeklyMi`'s header for why the three
 * collapse here). `rowOrNull` (Rule 11/`lib/db/read.ts`) so a DB failure is
 * LOGGED rather than silently indistinguishable from "the runner never said"
 * — both still fall through to the same conservative rung, which is the
 * argued exemption this reader owes the swallowed-failure gate.
 */
async function loadOnboardingWeeklyMiPrior(userId: string): Promise<number | null> {
  const row = await rowOrNull<{ history_avg_weekly_mi: number | string | null }>(
    'capacity-resolver/onboarding-weekly-mi-prior',
    pool.query(
      `SELECT history_avg_weekly_mi FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId],
    ),
  );
  // `row == null` is "missing profile row" or "the read itself failed" — both
  // collapse to null, argued above. `row.history_avg_weekly_mi == null` is
  // "the runner never answered this question" — also null, same argument.
  // NEITHER of those is the same fact as the runner answering `HIST_AVG_MIDPOINTS['0']
  // = 0` — "I said I don't run yet" is a real, measured self-report (ZEROSAY-1,
  // lib/onboarding/state.ts) and must survive as `0`, not be coerced into the
  // same null a missing answer produces (Rule 11's zero-vs-absent distinction,
  // caught here by `check-coercion.sh` on first run). `priorWeeklyMi`'s own
  // `> 0` gate is what decides whether a self-reported 0 is USABLE to
  // substitute — that policy question belongs one layer up, not folded into
  // this reader erasing the value before it gets there.
  if (row == null || row.history_avg_weekly_mi == null) return null;
  const n = Number(row.history_avg_weekly_mi);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The runner's own onboarding self-reported PRs (`profile.race_history`),
 * validated. `rowOrNull` for the same reason `loadOnboardingWeeklyMiPrior`
 * uses it: a failed read is LOGGED, and then falls through to the same
 * conservative rung a runner who typed nothing would get.
 *
 * The validation itself is `readSelfReportedPr` and is PURE — this reader
 * only fetches, so every rejection reason is falsifiable without a database
 * (Rule 18).
 */
async function loadSelfReportedPr(userId: string): Promise<SelfReportedPrRead> {
  const row = await rowOrNull<{ race_history: unknown }>(
    'capacity-resolver/onboarding-race-history',
    pool.query(
      `SELECT race_history FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId],
    ),
  );
  const raw = row?.race_history;
  return readSelfReportedPr(Array.isArray(raw) ? (raw as RaceHistoryEntry[]) : null);
}

async function loadVdotFallback(userId: string, todayISO: string): Promise<VdotFallbackRead> {
  const [inputs, normalDetail, selfReportedWeeklyMi, selfReportedPr] = await Promise.all([
    // The floor is passed EXPLICITLY on both halves so `goalRunFloorMiForUser`
    // never fires and the loader and the ranker cannot disagree about which
    // floor gated the pool — the mismatch `vdot-inputs.ts`'s own comment warns
    // about, closed here by construction rather than by remembering.
    loadVdotInputs(userId, todayISO, undefined, CAPACITY_RUN_FLOOR_MI),
    // ONE read for the rate AND the coverage, so the two halves of the same
    // window cannot disagree (Rule 16).
    normalWeeklyMileageDetail(userId, todayISO),
    loadOnboardingWeeklyMiPrior(userId),
    loadSelfReportedPr(userId),
  ]);
  const { best, belowTableAnchor } = bestRecentVdot(
    inputs.raceCandidates,
    todayISO,
    undefined,
    inputs.runCandidates,
    CAPACITY_RUN_FLOOR_MI,
  );
  const normalWeeklyMi: NormalReading<number> = normalDetail.ok
    ? {
        ok: true,
        value: normalDetail.value.weeklyMi,
        representativeDays: normalDetail.representativeDays,
        excludedDays: normalDetail.excludedDays,
      }
    : normalDetail;
  return {
    measuredVdot: best?.vdot ?? null,
    measuredVdotEvidenceId: best == null ? null : (best.source === 'race' ? best.slug : best.id),
    measuredVdotDate: best?.date ?? null,
    measuredVdotSource: best?.source ?? null,
    belowTableAnchor,
    normalWeeklyMi,
    normalRunDays: normalDetail.ok ? normalDetail.value.runDays : 0,
    selfReportedWeeklyMi,
    selfReportedPr,
  };
}

/** The below-table rung's source mode. A demonstrated RACE pace is
 *  `race_derived`; a demonstrated TRAINING pace read through the same
 *  distance-tier offset table is `inferred` — it is a real observation of a
 *  pace, but not a direct observation of the capacity being resolved, which is
 *  precisely §17's distinction. */
function belowTableSourceMode(anchor: BelowTableAnchor): SourceMode {
  return anchor.source === 'race' ? 'race_derived' : 'inferred';
}

/**
 * HOW MUCH REAL RUNNING RETIRES A SELF-REPORTED PRIOR, in representative days
 * the runner actually ran on.
 *
 * 16 — four weeks at four running days a week. The brief this closes is the
 * 2026-09-01 audit's own sentence: "one logged run moves the prior a little
 * and a full month of logged running retires it." Four days a week is the
 * frequency `Research/00a` §1's easy/general-aerobic dose assumes for a runner
 * building a base, and a month is the shortest window over which the Rule
 * 8-filtered habit reader can see a training pattern rather than a week.
 *
 * CONVENTION, and the number is a RATE OF FORGETTING, not a physiological
 * claim — which is why it is here and not in a doctrine registry entry. What
 * it must do is bounded on both ends and it does: one run out of sixteen buys
 * 1/16th of the weight (the self-report still leads, correctly — one run is
 * not a training history), and sixteen buys all of it (the self-report is
 * gone, correctly — a month of logged running IS a training history).
 */
export const USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS = 16;

/**
 * How much of this runner's actual running the app has seen, on [0,1].
 *
 * Continuous and monotone non-decreasing in `runDays` by construction, which
 * is the whole point: it is the term that makes the transition from "we have
 * only what they typed" to "we have what they ran" a RAMP rather than the
 * `real > 0` switch that shipped on 2026-09-01 and that the independent audit
 * measured at a 188 s/mi step (Rule 9's own diagnostic signature — the runner
 * who does MORE getting the categorically worse plan).
 */
export function evidenceCoverageFromRunDays(runDays: number): number {
  if (!Number.isFinite(runDays) || runDays <= 0) return 0;
  return Math.min(1, runDays / USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS);
}

/** What the mileage-based rung (`composeThresholdCapacity` tiers 2-4,
 *  `composeHighIntensityCapacity` tier 4) may spend: a CONTINUOUS blend of the
 *  real, Rule 8-filtered habit mileage and the runner's own onboarding
 *  self-report, weighted by how much real running the app has actually seen. */
export interface PriorWeeklyMiResult {
  weeklyMi: number;
  /** The REAL habit window itself refused to answer (Rule 11 — a different
   *  fact from "he ran nothing", and reported separately in `reasons` via
   *  `HABIT_WINDOW_REFUSED` regardless of whether a self-report filled the
   *  gap). */
  refused: boolean;
  /** True while the self-report still carries ANY weight — the fact that
   *  decides `user_prior` vs `population_prior` one level up. False at full
   *  evidence coverage, where the blend has already converged on the real
   *  number, so the source-mode flip happens at a point where the VALUE does
   *  not move (Rule 9: a behaviour may be discrete, the pace may not step). */
  usedSelfReport: boolean;
  /** The runner ANSWERED the onboarding mileage question with zero. A real
   *  self-report, and a different fact from never having answered — the
   *  distinction `loadOnboardingWeeklyMiPrior`'s header promises to keep and
   *  that the original `> 0` gate erased one function later (Rule 20's prose
   *  corollary). Reported so `reasons` can carry it. */
  answeredZero: boolean;
  /** The coverage weight the blend used, on [0,1]. Carried for the PR rung,
   *  which shrinks by the same complement so the two priors retire together. */
  evidenceCoverage: number;
}

/**
 * The weekly mileage the mileage-based rung may spend.
 *
 * ── THE CLIFF THIS REPLACES (Rule 9) ────────────────────────────────────────
 *
 * The 2026-09-01 cold-start fix substituted the self-report on a hard
 * `real > 0` switch. The independent audit walked it and found the textbook
 * Rule 9 signature: a runner who self-reported 40 mi/wk and then logged one
 * short run went from a prescribed threshold of 7:34/mi to 10:42/mi — a
 * **+188 s/mi step for 0.05 mi of running** — and stayed there for weeks,
 * because the sparse-history case (1-2 runs, the first month of every new
 * account) landed in a WORSE bucket than the zero-run case the fix was
 * written for. The evidence-precedence PRINCIPLE was right; the switch was
 * the defect.
 *
 * ── THE BLEND ───────────────────────────────────────────────────────────────
 *
 *     weeklyMi = coverage · real + (1 − coverage) · selfReport
 *
 * `coverage` is `evidenceCoverageFromRunDays(runDays)` — how many
 * representative days the runner actually ran on, over a month of running.
 * It is continuous in `runDays` and the expression is continuous and monotone
 * in `real`, so there is no step anywhere on the path from "nothing logged"
 * to "a month logged":
 *
 *   · 0 run days   → the self-report, exactly (the cold-start case)
 *   · 1 run day    → 1/16 real + 15/16 self-report (one run moves it a little)
 *   · 16 run days  → the real number, exactly, and the self-report is gone
 *
 * WHY COVERAGE AND NOT THE VALUE. Weighting by how CLOSE the real mileage is
 * to the self-report would mean a runner honestly training 10 mi/wk after
 * typing 40 never escapes their own onboarding chip. Coverage asks the only
 * question that should retire a prior: how much of this runner have we
 * actually watched. Rule 8 has already thrown the taper and post-race days
 * out of both halves of it.
 *
 * EVIDENCE STILL WINS, and now it wins CONTINUOUSLY. `SOURCE_MODE_STRENGTH`
 * puts `user_prior` below every observation-backed rung and this function is
 * only ever reached when all of those refused; within it, real running
 * displaces the self-report at a rate set by how much real running there is.
 *
 * Rule 11 is unchanged: a REFUSAL is still not coerced into a measurement.
 * A refused habit window contributes `real = 0` at `coverage = 0`, which
 * means it contributes nothing at all rather than a fabricated zero, and
 * `refused` is reported separately so `HABIT_WINDOW_REFUSED` still fires.
 */
export function priorWeeklyMi(
  r: NormalReading<number>,
  selfReportedWeeklyMi: number | null,
  runDays: number,
): PriorWeeklyMiResult {
  const real = r.ok ? r.value : 0;
  const refused = !r.ok;
  // A refused window has seen nothing representative, whatever `runDays` the
  // caller computed off it — the coverage term must not credit days the
  // refusal says are not there.
  const evidenceCoverage = refused ? 0 : evidenceCoverageFromRunDays(runDays);
  const answeredZero = selfReportedWeeklyMi === 0;

  if (selfReportedWeeklyMi == null || selfReportedWeeklyMi <= 0) {
    // Nothing to blend toward. `answeredZero` still travels, because "he told
    // us he does not run yet" and "he never answered" are two facts that
    // happen to imply the same number and must not become one.
    return { weeklyMi: real, refused, usedSelfReport: false, answeredZero, evidenceCoverage };
  }

  const blended = evidenceCoverage * real + (1 - evidenceCoverage) * selfReportedWeeklyMi;
  return {
    weeklyMi: blended,
    refused,
    // At full coverage the blend IS `real`, so flipping the label here cannot
    // move a pace — the discrete change sits exactly where the continuous one
    // has already finished.
    usedSelfReport: evidenceCoverage < 1,
    answeredZero,
    evidenceCoverage,
  };
}

/**
 * The typed-PR rung's contribution to a threshold pace, or null when there is
 * nothing usable to contribute.
 *
 * SHRINKAGE, NOT SUBSTITUTION. The returned pace is
 *
 *     w · prTPace + (1 − w) · mileagePriorTPace,   w = prPriorWeight(...)
 *
 * so the app's own conservative mileage anchor is always in the answer, the
 * PR can never own more than `USER_PR_MAX_WEIGHT` of it, and the weight falls
 * continuously to zero as real running arrives (`evidenceCoverage`) and as
 * the PR ages (`freshness`). See `lib/training/self-reported-pr.ts` for why
 * each term is shaped the way it is.
 *
 * It is only ever consulted on the MILEAGE rung — i.e. when no measured VDOT
 * and no demonstrated below-table pace exist. A typed PR never outranks, and
 * never even reaches, an observation of the runner running.
 */
function prShrunkTPace(
  pr: SelfReportedPrRead,
  mileagePriorTPaceSec: number,
  evidenceCoverage: number,
): { tPaceSec: number; weight: number } | null {
  if (!pr.ok) return null;
  const w = prPriorWeight(pr.best.freshness, evidenceCoverage);
  if (!(w > 0)) return null;
  const blended = w * pr.best.tPaceSecPerMi + (1 - w) * mileagePriorTPaceSec;
  if (!Number.isFinite(blended) || blended <= 0) return null;
  return { tPaceSec: blended, weight: w };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THRESHOLD CAPACITY
 * ═══════════════════════════════════════════════════════════════════════ */

/** Everything `composeThresholdCapacity` needs. Pure input, so the ladder is
 *  falsifiable without a database (Rule 18). */
export interface ThresholdCapacityInputs {
  /** Tier 1 · `resolveThresholdPaceCorpus`. */
  direct: ThresholdPaceRead;
  /** Tiers 2-5 · the legacy adapter. */
  fallback: VdotFallbackRead;
  todayISO: string;
  /** The corroboration floor tier 1 was read at. Defaults to the reader's. */
  minObservations?: number;
  /**
   * THE BELIEF-TENSION CONSUMER'S INPUT (`lib/evidence/reexamination.ts`).
   *
   * Repeated same-direction disagreement between recent activities and the
   * belief we already held may lower tier 1's corroboration floor by ONE, never
   * below two. It cannot move a pace, cannot raise the bar, and cannot make one
   * activity sufficient. Absent → the floor is untouched and this resolver
   * behaves byte-for-byte as it did before the consumer existed, which is the
   * property `_capacity_resolver.test.ts` asserts.
   *
   * The pressure is measured against the belief that was held when each
   * activity ARRIVED, which is why the caller resolves once without it before
   * classifying — see `resolveThresholdCapacity`.
   */
  reexamination?: ReexaminationPressure | null;
}

/**
 * THE canonical threshold-capacity resolver's pure core.
 *
 * §16's ladder, literally, and the ONLY place its order is decided:
 *
 *   1 · direct           — corroborated threshold-zone evidence from the
 *                          runner's own training (`resolveThresholdPaceCorpus`)
 *   2 · vdot_fallback    — a measured VDOT off the best race/run candidate,
 *                          through the Daniels T column
 *   3 · race_derived     — a demonstrated pace the VDOT table cannot represent,
 *     / inferred          offset to T by doctrine's distance-tier table
 *   4 · user_prior        — real logged mileage reads zero, but the runner's
 *     / population_prior   OWN ONBOARDING SELF-REPORT of weekly volume exists
 *                          (`user_prior`) or does not (`population_prior`),
 *                          through the cold-start anchor either way —
 *                          `priorWeeklyMi` decides which, see
 *                          `CAPACITY_CONFIDENCE_BANDS.userPrior`'s header
 *
 * Rungs 2-4 are `resolveCurrentTPace`, called rather than reimplemented: it is
 * the proven encoding of that cascade, it already carries the
 * `clampToSanePace` backstop that stops an offset landing faster than the
 * anchor it came from, and §24's ban on cross-layer shortcuts cuts both ways —
 * writing a second cascade here to avoid touching the legacy one is exactly
 * how two answers to one question appear.
 *
 * THE LADDER FALLS THROUGH, and this is the specific defect the falsification
 * test aims at: tier 1 REFUSING must not be reported as tier 1 answering. The
 * refusal branch of `ThresholdPaceRead` carries no `tPaceSecPerMi` at all, so
 * that mistake does not compile — the type is doing the work, per the pattern
 * `normal-window.ts` set.
 */
export function composeThresholdCapacity(
  inputs: ThresholdCapacityInputs,
): ThresholdCapacityEstimate {
  const { direct, fallback, todayISO } = inputs;
  const baseMinObservations = inputs.minObservations ?? CORROBORATION_MIN_OBSERVATIONS;
  // The consumer may only ever LOWER the floor, and `accumulateReexamination`
  // guarantees that on its side. Re-clamped here so this file's own behaviour
  // does not depend on a caller having used the sanctioned accumulator — a
  // hand-built pressure object cannot raise the bar through this seam.
  const relaxed = inputs.reexamination?.effectiveMinObservations;
  const minObservations = relaxed != null && relaxed < baseMinObservations
    ? relaxed
    : baseMinObservations;
  const barLowered = minObservations < baseMinObservations;
  const resolvedAt = new Date().toISOString();

  // ── TIER 1 · DIRECT ──────────────────────────────────────────────────────
  if (direct.ok) {
    const q = qualityFromPaceObservations(direct.observations, direct.supporting, minObservations);
    const { confidence, components } = directEvidenceConfidence(q, todayISO);
    const contractReasons: CapacityReasonCode[] = [];
    if (direct.moveCap.applied) contractReasons.push('SINGLE_SESSION_MOVE_CAPPED');
    if (direct.supporting.some((o) => o.weight < 1)) contractReasons.push('REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT');
    if (direct.supporting.some((o) => !o.representative)) contractReasons.push('NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT');
    if (direct.supporting.some((o) => o.authority.evidenceKind === 'unavailable')) contractReasons.push('EVIDENCE_ENGINE_READ_UNAVAILABLE');
    return {
      paceSecPerMi: direct.tPaceSecPerMi,
      vdot: direct.vdot,
      confidence,
      sourceMode: 'direct',
      evidenceIds: direct.supporting.map((o) => o.id),
      resolvedAt,
      reasons: [
        'DIRECT_CORROBORATED_THRESHOLD_EVIDENCE',
        ...evidenceReasons(q, components),
        ...(barLowered ? ['REEXAMINATION_LOWERED_THE_CORROBORATION_BAR' as const] : []),
        ...contractReasons,
      ],
      modelVersion: CAPACITY_MODEL_VERSION,
      evidence: {
        supporting: direct.supporting,
        excluded: direct.excluded,
        weightedSupport: direct.weightedSupport,
        representativeSupporting: direct.representativeSupporting,
        moveCap: direct.moveCap,
      },
    };
  }

  // ── TIERS 2-4 · THE LEGACY CASCADE ───────────────────────────────────────
  const prior = priorWeeklyMi(
    fallback.normalWeeklyMi, fallback.selfReportedWeeklyMi, fallback.normalRunDays,
  );
  const cascade = resolveCurrentTPace(
    fallback.measuredVdot,
    fallback.belowTableAnchor,
    prior.weeklyMi,
    conservativeVdotFromMileage,
  );

  // `resolveCurrentTPace` returns `tPaceSec: null` only when its LAST rung's
  // own conversion failed, which `conservativeVdotFromMileage`'s floor makes
  // unreachable — kept as an explicit conservative substitution rather than a
  // non-null assertion, because a silent `!` here would be a fabricated pace.
  const mileagePaceSecPerMi = cascade.tPaceSec
    ?? tPaceFromVdot(conservativeVdotFromMileage(0))
    ?? 0;

  /* ── THE TYPED-PR RUNG ────────────────────────────────────────────────────
   *
   * Consulted ONLY on the mileage rung — i.e. when no measured VDOT and no
   * demonstrated below-table pace exist. A PR the runner typed into
   * onboarding never outranks, and never even reaches, an observation of the
   * runner running; `SOURCE_MODE_STRENGTH` says so and this gate enforces it.
   *
   * What it does when it fires: shrinks the conservative mileage pace toward
   * the PR-implied pace by `prPriorWeight`, which falls continuously to zero
   * as the PR ages and as real running arrives. See
   * `lib/training/self-reported-pr.ts` for every term.
   */
  const prBlend = cascade.tier === 'mileage_estimate'
    ? prShrunkTPace(fallback.selfReportedPr, mileagePaceSecPerMi, prior.evidenceCoverage)
    : null;
  const paceSecPerMi = prBlend?.tPaceSec ?? mileagePaceSecPerMi;

  const tierMap: Record<TPaceResolutionTier, SourceMode> = {
    measured_vdot: 'vdot_fallback',
    below_table_anchor: fallback.belowTableAnchor
      ? belowTableSourceMode(fallback.belowTableAnchor)
      : 'inferred',
    // FIXED 2026-09-01 · `user_prior` when the number this rung spent came
    // from the runner's own onboarding self-report — a weekly-mileage chip, a
    // typed PR, or both — rather than only from real logged running. See
    // `CAPACITY_CONFIDENCE_BANDS.userPrior`'s header.
    mileage_estimate: (prior.usedSelfReport || prBlend != null) ? 'user_prior' : 'population_prior',
  };
  const sourceMode = tierMap[cascade.tier];

  const reasons: CapacityReasonCode[] = ['NO_DIRECT_EVIDENCE'];
  if (cascade.tier === 'measured_vdot') reasons.push('MEASURED_VDOT_FALLBACK');
  if (cascade.tier === 'below_table_anchor') reasons.push('BELOW_TABLE_ANCHOR_FALLBACK');
  if (cascade.tier === 'mileage_estimate') {
    if (prior.usedSelfReport) reasons.push('ONBOARDING_MILEAGE_USER_PRIOR');
    else reasons.push('MILEAGE_POPULATION_PRIOR');
    // A runner who answered "0 mi/wk" told us something. A runner who never
    // answered did not. The two imply the same number and are not the same
    // fact (Rule 11), and until now nothing downstream could tell them apart.
    if (prior.answeredZero) reasons.push('ONBOARDING_MILEAGE_ANSWERED_ZERO');
    if (prBlend != null) reasons.push('ONBOARDING_PR_USER_PRIOR');
    // Reported whether or not a PR was ultimately used: an entry that failed
    // validation is a thing worth surfacing to the runner ("that half
    // marathon time looks wrong"), and silence would be the swallow.
    if (!fallback.selfReportedPr.ok && fallback.selfReportedPr.reason === 'ALL_PRS_REJECTED') {
      reasons.push('ONBOARDING_PR_REJECTED');
    }
    if (prior.refused) reasons.push('HABIT_WINDOW_REFUSED');
  }

  const anchorDate = cascade.tier === 'measured_vdot'
    ? fallback.measuredVdotDate
    : cascade.tier === 'below_table_anchor'
      ? (fallback.belowTableAnchor?.date ?? null)
      : null;

  const evidenceIds: string[] = [];
  if (cascade.tier === 'measured_vdot' && fallback.measuredVdotEvidenceId != null) {
    evidenceIds.push(fallback.measuredVdotEvidenceId);
  }
  if (cascade.tier === 'below_table_anchor' && fallback.belowTableAnchor != null) {
    evidenceIds.push(fallback.belowTableAnchor.refId);
  }

  return {
    paceSecPerMi,
    vdot: vdotFromTpace(paceSecPerMi),
    confidence: sourceMode === 'population_prior'
      ? CAPACITY_CONFIDENCE_BANDS.populationPrior
      : sourceMode === 'user_prior'
        ? CAPACITY_CONFIDENCE_BANDS.userPrior
        : fallbackConfidence(anchorDate, todayISO),
    sourceMode,
    evidenceIds,
    resolvedAt,
    reasons,
    modelVersion: CAPACITY_MODEL_VERSION,
  };
}

/**
 * What can this runner sustain at threshold? THE canonical answer (§2).
 *
 * No goal parameter, structurally (section 0). Compute-at-read-time (Rule 10).
 */
export async function resolveThresholdCapacity(
  userId: string,
  todayISO?: string,
): Promise<ThresholdCapacityEstimate> {
  const today = todayISO ?? await runnerToday(userId);
  // The corpus INPUTS are loaded once — rows, HR context, phases, prescribed
  // windows and the Evidence Engine's per-run verdicts — so the two passes
  // below classify identical evidence and can only differ in the bar.
  const [corpusInputs, fallback] = await Promise.all([
    loadThresholdCorpusInputs(userId, today),
    loadVdotFallback(userId, today),
  ]);
  const direct = thresholdCorpusFromInputs(corpusInputs);
  const base = composeThresholdCapacity({ direct, fallback, todayISO: today });
  const { estimate: todayEstimate, tension } = await resolveThresholdWithTension(userId, today, corpusInputs, fallback, base);
  // 2026-09-02 · DAY-TO-DAY CONTINUITY ACROSS TIERS (Phase 1 of the brain
  // completion). The corpus caps a corroborated read against its own prior;
  // nothing capped the belief when it changed TIER — a race-derived fallback
  // one day, a relaxed one-session direct read the next — and June 2026
  // flipped 456 → 430 → 455 → 430 on exactly that seam, with every individual
  // day arithmetically correct.
  //
  // THE CHAIN IS WALKED, NOT SAMPLED, AND THE RECONSTRUCTION IS FAITHFUL.
  // Comparing today against yesterday's UNCAPPED belief only moves the seam a
  // day later. Reconstructing yesterday with a DIFFERENT procedure than the
  // one that actually ran (today's fallback reused for every day, today's
  // corroboration bar not applied) is worse: it erases the very move the cap
  // exists to catch, which is what a first cut of this did — 2026-06-09's
  // 26 s/mi fallback jump read as "no move" because both days were handed the
  // same fallback. The walk below recomputes each day of the window from the
  // same corpus rows FILTERED TO THAT DAY, with THAT DAY'S fallback, at the
  // bar today's tension established, and carries the CAPPED value forward.
  // The number returned is the one a runner reading the app every morning
  // would actually have held.
  //
  // COST, AND WHEN IT IS PAID: only when today's read is not a fully
  // corroborated direct one — the runner whose belief is unstable is exactly
  // the runner this is for. The per-day fallbacks are loaded in parallel.
  //
  // WHAT THIS CANNOT SEE (Rule 22): tension is measured for today and applied
  // to the whole window, so a past day whose bar was relaxed by a tension that
  // has since expired is reconstructed at today's bar. Both directions of that
  // error are bounded by the cap itself, which is the point.
  const fullyCorroborated = (e: ThresholdCapacityEstimate) => e.sourceMode === 'direct'
    && !e.reasons.includes('SPARSE_CORROBORATION')
    && !e.reasons.includes('REEXAMINATION_LOWERED_THE_CORROBORATION_BAR');
  if (fullyCorroborated(todayEstimate)) return todayEstimate;

  const windowDays = Array.from({ length: THRESHOLD_CONTINUITY_WINDOW_DAYS }, (_, i) =>
    new Date(Date.parse(today + 'T12:00:00Z') - (THRESHOLD_CONTINUITY_WINDOW_DAYS - i) * 86_400_000)
      .toISOString().slice(0, 10));
  let dayFallbacks: Array<Awaited<ReturnType<typeof loadVdotFallback>>> | null = null;
  try {
    dayFallbacks = await Promise.all(windowDays.map((d) => loadVdotFallback(userId, d)));
  } catch {
    dayFallbacks = null; // Rule 11 · reported below, never silently "no move"
  }
  if (!dayFallbacks) {
    return { ...todayEstimate, reasons: [...todayEstimate.reasons, 'CONTINUITY_UNAVAILABLE'], continuity: null };
  }
  const bar = tension?.effectiveMinObservations;
  let prior: ThresholdCapacityEstimate | null = null;
  windowDays.forEach((day, i) => {
    const dayInputs = { ...corpusInputs, todayISO: day, rows: corpusInputs.rows.filter((r) => r.date <= day) };
    const dayEstimate = composeThresholdCapacity({
      direct: thresholdCorpusFromInputs(dayInputs, bar),
      fallback: dayFallbacks![i],
      todayISO: day,
      ...(tension ? { reexamination: tension } : {}),
    });
    prior = fullyCorroborated(dayEstimate) ? dayEstimate : applyDayToDayContinuity(dayEstimate, prior);
  });
  return applyDayToDayContinuity(todayEstimate, prior);
}

/**
 * How far back the continuity walk reconstructs the belief. CONVENTION for
 * model stability: long enough that a quiet week cannot hide a tier flip (the
 * June 2026 incident spanned six days), short enough that the walk stays one
 * parallel round trip.
 */
export const THRESHOLD_CONTINUITY_WINDOW_DAYS = 7;

/**
 * Pure · hold a belief within one day's move cap of yesterday's belief when
 * either side is not a fully corroborated direct read. The corpus' own cap
 * governs the corroborated regime; this governs the seams between tiers.
 */
export function applyDayToDayContinuity(
  today: ThresholdCapacityEstimate,
  yesterday: ThresholdCapacityEstimate | null,
): ThresholdCapacityEstimate {
  if (!yesterday) {
    return { ...today, reasons: [...today.reasons, 'CONTINUITY_UNAVAILABLE'], continuity: null };
  }
  const delta = today.paceSecPerMi - yesterday.paceSecPerMi;
  const cap = THRESHOLD_ANCHOR_DAILY_MOVE_CAP_S_PER_MI;
  if (Math.abs(delta) <= cap) {
    return { ...today, continuity: { yesterdayPaceSecPerMi: yesterday.paceSecPerMi, applied: false, uncappedPaceSecPerMi: today.paceSecPerMi } };
  }
  const paceSecPerMi = Math.round(yesterday.paceSecPerMi + Math.sign(delta) * cap);
  return {
    ...today,
    paceSecPerMi,
    vdot: vdotFromTpace(paceSecPerMi),
    reasons: [...today.reasons, 'DAY_TO_DAY_CONTINUITY_CAPPED'],
    continuity: { yesterdayPaceSecPerMi: yesterday.paceSecPerMi, applied: true, uncappedPaceSecPerMi: today.paceSecPerMi },
  };
}

/** Pass 2 · the belief-tension consumer, factored so the same two passes can
 *  be run for yesterday. */
async function resolveThresholdWithTension(
  userId: string,
  today: string,
  corpusInputs: Awaited<ReturnType<typeof loadThresholdCorpusInputs>>,
  fallback: Awaited<ReturnType<typeof loadVdotFallback>>,
  base: ThresholdCapacityEstimate,
): Promise<{ estimate: ThresholdCapacityEstimate; tension: ReexaminationPressure | null }> {

  /* ── PASS 2 · THE BELIEF-TENSION CONSUMER ────────────────────────────────
   *
   * `lib/evidence/reexamination.ts` owns the policy; this is the two lines that
   * apply it. TWO PASSES, and the order is the whole point: tension is measured
   * against THE BELIEF THAT WAS HELD WHEN THE ACTIVITY ARRIVED, so the base
   * estimate above has to exist first. It terminates because pass 2 can only
   * ever LOWER the corroboration floor, and a lower floor can only move tier 1
   * from refusing to answering — never back.
   *
   * WHY THE RE-READ IS CONDITIONAL. When nothing relaxed the floor, the second
   * corpus read would return exactly what the first did, so it is skipped and
   * `base` is returned unchanged. That is what keeps this resolver's behaviour
   * byte-identical for every runner with no repeated same-direction tension —
   * which today is every runner, and is the property the existing capacity
   * tests assert.
   *
   * NO GOAL IS VISIBLE HERE. `loadRecentTension` takes a user, a date and a
   * pace; the compile-time assertion in section 8 still holds. */
  const tension = await loadRecentTension(userId, today, base);
  if (tension == null || tension.effectiveMinObservations >= CORROBORATION_MIN_OBSERVATIONS) {
    return { estimate: base, tension: null };
  }
  const relaxedDirect = thresholdCorpusFromInputs(corpusInputs, tension.effectiveMinObservations);
  return {
    estimate: composeThresholdCapacity({
      direct: relaxedDirect,
      fallback,
      todayISO: today,
      reexamination: tension,
    }),
    tension,
  };
}

/**
 * Read the runner's recent belief-tension, or say honestly that we could not.
 *
 * Returns `null` — not an empty pressure — when the read FAILS, so a database
 * hiccup reads as "we did not look" rather than "we looked and found no
 * tension" (Rule 11). Both produce the same estimate today; they must not
 * produce the same LOG entry, and a future consumer that treats an absence as
 * evidence would be reading a swallowed failure.
 *
 * The window is `REEXAMINATION_WINDOW_DAYS`, the same one the accumulator
 * filters on, so the classifier is never run over activities the policy will
 * discard.
 */
async function loadRecentTension(
  userId: string,
  todayISO: string,
  belief: ThresholdCapacityEstimate,
): Promise<ReexaminationPressure | null> {
  try {
    const from = new Date(Date.parse(`${todayISO}T00:00:00Z`) - REEXAMINATION_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const classified = await classifyRecentActivities(userId, from, todayISO, {
      currentBelief: {
        thresholdPaceSecPerMi: belief.paceSecPerMi,
        thresholdConfidence: belief.confidence,
        asOf: todayISO,
      },
    });
    const observations = tensionObservationsFrom(
      classified.map((c) => ({
        activityId: c.runId,
        dateISO: c.dateISO,
        tension: c.result.beliefTension,
      })),
    );
    return accumulateReexamination({
      capacity: 'threshold',
      observations,
      baseMinObservations: CORROBORATION_MIN_OBSERVATIONS,
      todayISO,
    });
  } catch (err) {
    // Named, never swallowed into an empty reading.
    console.warn('[capacity/reexamination] tension read failed', err);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · HIGH-INTENSITY CAPACITY
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Everything `composeHighIntensityCapacity` needs.
 *
 * NOTE THE ABSENT FIELD, and that it is absent on purpose. There is no
 * `direct:` here because NO DIRECT HIGH-INTENSITY EVIDENCE READER EXISTS in
 * this app yet — easy, threshold and durability each got one; this capacity did
 * not. Building one is real work (BRIEF 02's two-stage classification applied
 * to interval sessions, where `Research/03` §8's own footnote says HR is
 * unreliable for short reps and pace-plus-duration has to carry the whole
 * admission decision) and it is deliberately NOT attempted in this phase.
 *
 * THE SEAM, so the later pass changes nothing else: add `direct?:
 * HighIntensityRead` to this interface and a tier-1 branch at the top of
 * `composeHighIntensityCapacity`. The resolver's own signature, the estimate
 * type, and every consumer stay exactly as they are — which is the whole point
 * of resolving through an owning service rather than at each call site.
 */
export interface HighIntensityCapacityInputs {
  fallback: VdotFallbackRead;
  todayISO: string;
}

/**
 * THE canonical high-intensity-capacity resolver's pure core.
 *
 * The ladder, with its top rung MISSING and said out loud rather than faked:
 *
 *   1 · direct           — NOT BUILT. `NO_DIRECT_HIGH_INTENSITY_READER` is on
 *                          every estimate this function returns, so a consumer
 *                          can see that the strongest available evidence for
 *                          this capacity is not being read.
 *   2 · vdot_fallback    — I from the Daniels 5K column, R from the mile
 *                          column, both off the measured VDOT
 *   3 · race_derived     — I by Riegel projection from a demonstrated
 *     / inferred          below-table pace. R is NULL here: the mile column is
 *                          a VDOT table this runner is off, and there is no
 *                          doctrine-supported route to R without it.
 *   4 · user_prior        — the cold-start anchor, same as threshold's tier
 *     / population_prior   4 — `user_prior` when the runner's own onboarding
 *                          self-report fills in for a real-zero mileage read,
 *                          `population_prior` when neither exists
 *
 * §38 is the standard this is written to: "Threshold based on race-derived
 * fallback; direct evidence currently insufficient" beats silently pretending
 * confidence. A tier that read interval sessions badly would be worse than a
 * tier that says it does not exist.
 */
export function composeHighIntensityCapacity(
  inputs: HighIntensityCapacityInputs,
): HighIntensityCapacityEstimate {
  const { fallback, todayISO } = inputs;
  const resolvedAt = new Date().toISOString();
  const reasons: CapacityReasonCode[] = ['NO_DIRECT_HIGH_INTENSITY_READER'];

  // ── TIER 2 · MEASURED VDOT ───────────────────────────────────────────────
  if (fallback.measuredVdot != null) {
    const i = iPaceFromVdot(fallback.measuredVdot);
    const r = rPaceFromVdot(fallback.measuredVdot);
    if (i != null) {
      reasons.push('MEASURED_VDOT_FALLBACK');
      return {
        intervalPaceSecPerMi: i,
        repetitionPaceSecPerMi: r,
        vdot: fallback.measuredVdot,
        confidence: fallbackConfidence(fallback.measuredVdotDate, todayISO),
        sourceMode: 'vdot_fallback',
        evidenceIds: fallback.measuredVdotEvidenceId != null ? [fallback.measuredVdotEvidenceId] : [],
        resolvedAt,
        reasons,
        modelVersion: CAPACITY_MODEL_VERSION,
      };
    }
  }

  // ── TIER 3 · A DEMONSTRATED PACE THE TABLE CANNOT REPRESENT ──────────────
  if (fallback.belowTableAnchor != null) {
    const anchor = fallback.belowTableAnchor;
    const i = iPaceFromAnchorPace(anchor.anchor);
    if (i != null) {
      reasons.push('BELOW_TABLE_ANCHOR_FALLBACK');
      return {
        // The same non-negotiable invariant `resolveCurrentTPace`'s tier 2
        // applies: no prescribed pace may be faster than the demonstrated
        // pace it was derived from. `iPaceFromAnchorPace` already clamps;
        // repeating it here costs nothing and survives a future edit to that
        // function that forgets to.
        intervalPaceSecPerMi: clampToSanePace(i, anchor.anchor.paceSPerMi) ?? i,
        // R is genuinely unknown for a below-table runner — see this
        // function's header. Rule 11: an explicit null, never a zero and
        // never a silently-substituted I-pace.
        repetitionPaceSecPerMi: null,
        vdot: null,
        confidence: fallbackConfidence(anchor.date, todayISO),
        sourceMode: belowTableSourceMode(anchor),
        evidenceIds: [anchor.refId],
        resolvedAt,
        reasons,
        modelVersion: CAPACITY_MODEL_VERSION,
      };
    }
  }

  // ── TIER 4 · MILEAGE PRIOR (population, or the runner's own onboarding
  //    self-report when real logged mileage reads zero — FIXED 2026-09-01,
  //    see `CAPACITY_CONFIDENCE_BANDS.userPrior`'s header) ──────────────────
  const prior = priorWeeklyMi(
    fallback.normalWeeklyMi, fallback.selfReportedWeeklyMi, fallback.normalRunDays,
  );
  const mileageVdot = conservativeVdotFromMileage(prior.weeklyMi);
  /* THE TYPED-PR RUNG, mirrored from threshold and derived through the same
   * shrinkage — so the two capacities cannot disagree about how much of a
   * typed PR they believe (Rule 16). It is applied in T-PACE space and read
   * back out as a VDOT rather than blending two VDOTs, because that is the
   * quantity `prShrunkTPace` owns and a second blend formula here would be a
   * second answer to one question. */
  const mileageTPace = tPaceFromVdot(mileageVdot);
  const prBlend = mileageTPace != null
    ? prShrunkTPace(fallback.selfReportedPr, mileageTPace, prior.evidenceCoverage)
    : null;
  const priorVdot = prBlend != null ? (vdotFromTpace(prBlend.tPaceSec) ?? mileageVdot) : mileageVdot;
  const usedAnySelfReport = prior.usedSelfReport || prBlend != null;
  reasons.push(prior.usedSelfReport ? 'ONBOARDING_MILEAGE_USER_PRIOR' : 'MILEAGE_POPULATION_PRIOR');
  if (prior.answeredZero) reasons.push('ONBOARDING_MILEAGE_ANSWERED_ZERO');
  if (prBlend != null) reasons.push('ONBOARDING_PR_USER_PRIOR');
  if (!fallback.selfReportedPr.ok && fallback.selfReportedPr.reason === 'ALL_PRS_REJECTED') {
    reasons.push('ONBOARDING_PR_REJECTED');
  }
  if (prior.refused) reasons.push('HABIT_WINDOW_REFUSED');
  const sourceMode: SourceMode = usedAnySelfReport ? 'user_prior' : 'population_prior';
  return {
    intervalPaceSecPerMi: iPaceFromVdot(priorVdot) ?? 0,
    repetitionPaceSecPerMi: rPaceFromVdot(priorVdot),
    vdot: priorVdot,
    confidence: usedAnySelfReport
      ? CAPACITY_CONFIDENCE_BANDS.userPrior
      : CAPACITY_CONFIDENCE_BANDS.populationPrior,
    sourceMode,
    evidenceIds: [],
    resolvedAt,
    reasons,
    modelVersion: CAPACITY_MODEL_VERSION,
  };
}

/**
 * What can this runner hold at 3-5K effort? THE canonical answer (§2).
 *
 * Currently answered entirely from fallbacks — see
 * `composeHighIntensityCapacity` for why, and for the seam a direct reader
 * slots into without changing this signature.
 */
export async function resolveHighIntensityCapacity(
  userId: string,
  todayISO?: string,
): Promise<HighIntensityCapacityEstimate> {
  const today = todayISO ?? await runnerToday(userId);
  const fallback = await loadVdotFallback(userId, today);
  return composeHighIntensityCapacity({ fallback, todayISO: today });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · EASY CEILING
 * ═══════════════════════════════════════════════════════════════════════ */

export interface EasyCeilingInputs {
  /** Tier 1 · `resolveEasyPaceCorpus`. */
  direct: EasyPaceRead;
  /** Tier 2 · the already-resolved threshold capacity. Passing the ESTIMATE
   *  rather than a bare pace is deliberate: the easy ceiling inherits the
   *  threshold read's provenance and cannot claim more certainty than the
   *  number it was derived from. */
  threshold: ThresholdCapacityEstimate;
  todayISO: string;
  minObservations?: number;
}

/**
 * THE canonical easy-ceiling resolver's pure core.
 *
 *   1 · direct   — the fastest pace corroborated at genuinely-easy effort
 *                  (`resolveEasyPaceCorpus`), Rule 8-filtered by that reader
 *   2 · derived  — the fast edge of doctrine's easy band off the resolved
 *                  threshold pace (`easyBandFromTPace`, Research/01
 *                  §"Pace conversion from a race time", gated by
 *                  `PACE.easy-band-off-threshold`)
 *
 * NO THIRD RUNG, because tier 2 cannot fail: `resolveThresholdCapacity` always
 * resolves (its own last rung is the population prior), so the easy ceiling
 * always has a threshold pace to offset from. The ladder inherits threshold's
 * honesty rather than duplicating it.
 *
 * TIER 2'S SOURCE MODE IS NEVER `direct`, even when the threshold read was.
 * An easy ceiling derived from a direct threshold observation is an INFERENCE
 * about easy running — nobody observed the runner running easy — and §17 exists
 * to keep exactly that distinction visible downstream. When threshold was
 * itself a fallback, its mode is carried through unchanged, because a further
 * inference cannot make a weaker source stronger.
 *
 * THE FAST EDGE, not the middle of the band. The prescription is "no faster
 * than X", so the number that matters is where the band starts, which is
 * `lo` — `hi` describes how slow easy may go and doctrine §9's answer to that
 * is "whatever feels genuinely easy", not a number.
 */
export function composeEasyCeiling(inputs: EasyCeilingInputs): EasyCeilingEstimate {
  const { direct, threshold, todayISO } = inputs;
  const minObservations = inputs.minObservations ?? CORROBORATION_MIN_OBSERVATIONS;
  const resolvedAt = new Date().toISOString();

  // ── TIER 1 · DIRECT ──────────────────────────────────────────────────────
  if (direct.ok) {
    const q = qualityFromPaceObservations(direct.observations, direct.supporting, minObservations);
    const { confidence, components } = directEvidenceConfidence(q, todayISO);
    return {
      ceilingSecPerMi: direct.ceilingSecPerMi,
      confidence,
      sourceMode: 'direct',
      evidenceIds: direct.supporting.map((o) => o.id),
      resolvedAt,
      reasons: ['DIRECT_CORROBORATED_EASY_EVIDENCE', ...evidenceReasons(q, components)],
      modelVersion: CAPACITY_MODEL_VERSION,
    };
  }

  // ── TIER 2 · DERIVED FROM THRESHOLD CAPACITY ─────────────────────────────
  const band = easyBandFromTPace(threshold.paceSecPerMi);
  const sourceMode: SourceMode = threshold.sourceMode === 'direct' ? 'inferred' : threshold.sourceMode;
  return {
    // `easyBandFromTPace` returns null only for a non-finite or non-positive
    // threshold pace, which `composeThresholdCapacity` cannot produce. The
    // fallback is the threshold pace itself — a ceiling equal to threshold
    // pace is absurdly strict rather than dangerously loose, which is the
    // right direction for a value nothing should ever reach.
    ceilingSecPerMi: band?.lo ?? threshold.paceSecPerMi,
    // Capped into the fallback band: an inference cannot be more trustworthy
    // than the reading behind it, and it must not cross into the direct band.
    confidence: Math.min(threshold.confidence, CAPACITY_CONFIDENCE_BANDS.fallbackCeiling),
    sourceMode,
    // Inherited, so "which runs said this" still resolves one level up.
    evidenceIds: [...threshold.evidenceIds],
    resolvedAt,
    reasons: ['NO_DIRECT_EVIDENCE', 'EASY_DERIVED_FROM_THRESHOLD_CAPACITY'],
    modelVersion: CAPACITY_MODEL_VERSION,
  };
}

/**
 * The boundary easy running must not cross. THE canonical answer (§2).
 *
 * Resolves threshold capacity internally because tier 2 needs it — the ONE
 * canonical resolver, called, never a second derivation of the same number
 * (§2, §34).
 */
export async function resolveEasyCeiling(
  userId: string,
  todayISO?: string,
): Promise<EasyCeilingEstimate> {
  const today = todayISO ?? await runnerToday(userId);
  const [direct, threshold] = await Promise.all([
    resolveEasyPaceCorpus(userId, today),
    resolveThresholdCapacity(userId, today),
  ]);
  return composeEasyCeiling({ direct, threshold, todayISO: today });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · DURABILITY
 * ═══════════════════════════════════════════════════════════════════════ */

export interface DurabilityInputs {
  raceExponent: RaceExponentRead;
  decoupling: DecouplingRead;
  /** Optional so every existing caller and fixture keeps composing; absent
   *  reads as "not corroborated", never as a demonstrated pace (Rule 11). */
  trainingDurability?: TrainingDurabilityRead;
}

/**
 * Combine two independent confidences about one latent trait.
 *
 * NOISY-OR — `1 - (1-a)(1-b)`. BRIEF 01 lists "different evidence types
 * corroborate each other" among the things that INCREASE confidence, and this
 * is the standard combination for two independent sources that each support a
 * claim: it is monotone non-decreasing in both inputs (so §30's property holds
 * on each axis), it reduces to `a` when the other source is absent, and it
 * cannot exceed 1.
 *
 * CAPPED AT THE DIRECT CEILING. Two moderate readings combining to 0.75 is the
 * right behaviour; two moderate readings combining past what a corroborated
 * direct pace read can reach is not, and the same instrument-blindness argument
 * that caps direct evidence at 0.90 applies at least as hard to a latent trait
 * inferred from race times and HR drift.
 */
export function combineIndependentConfidence(a: number, b: number): number {
  // CAP THE INPUTS, NOT ONLY THE OUTPUT — found by the Rule 13 render against
  // the owner's real account, and it was a live monotonicity defect rather
  // than a tidiness point. `resolveDecoupling`'s own confidence formula can
  // reach 1.0, and on that account it read 0.937. Capping only the RESULT
  // produced durability = 0.900 against a component that said 0.937, so
  // ADDING a second corroborating evidence type LOWERED the number — the exact
  // inversion §30 forbids, and the reason the components are capped onto this
  // layer's scale before they are combined and before they are reported.
  const x = capToLayerCeiling(a);
  const y = capToLayerCeiling(b);
  return Math.min(CAPACITY_CONFIDENCE_BANDS.directCeiling, 1 - (1 - x) * (1 - y));
}

/**
 * A confidence produced by another module, expressed on THIS layer's scale.
 *
 * The only transformation this layer applies to an inherited confidence: the
 * universal ceiling. It is not a re-derivation (§2 — the underlying reader
 * already owns that question and can see inputs this function cannot), and it
 * is not a band remap (see the file header on why durability's evidence
 * hierarchy is not the ladder's). It is the one statement that holds for every
 * capacity here: nothing in this app claims to know a runner's physiology
 * better than `CAPACITY_CONFIDENCE_BANDS.directCeiling`.
 */
export function capToLayerCeiling(confidence: number): number {
  return Math.min(CAPACITY_CONFIDENCE_BANDS.directCeiling, clamp01(confidence));
}

/**
 * THE canonical durability resolver's pure core.
 *
 * NOT A LADDER, and that difference is the point. Threshold, high-intensity and
 * easy each answer ONE question and fall back to progressively weaker ways of
 * answering it. Durability is BRIEF 06's latent trait — "no single metric
 * equals durability ... these observations collectively inform it" — so its two
 * sub-observations are not competing rungs. They are different evidence about
 * different halves of the question, and both are reported.
 *
 * The one thing that IS a ladder here is `enduranceExponent`: the fitted
 * personal exponent when races support one, `POPULATION_ENDURANCE_PRIOR`
 * otherwise. That is a genuine fallback, and it identifies itself through
 * `sourceMode` like every other one.
 *
 * CONFIDENCE IS REUSED, NOT RECOMPUTED. `resolveRaceExponent` and
 * `resolveDecoupling` each already carry an argued 0..1 confidence — evidence
 * count, distance spread, race authority, cross-observation consistency, and a
 * freshness term on the anchor's own 12-week half-life. Re-deriving a second
 * confidence here from their outputs would be a second answer to a question
 * that already has one (§2), and would silently drop the inputs those functions
 * can see and this one cannot.
 */
export function composeDurability(inputs: DurabilityInputs): DurabilityCapacityEstimate {
  const { raceExponent, decoupling } = inputs;
  const training: TrainingDurabilityRead = inputs.trainingDurability ?? { ok: false, reason: 'no_observations', observations: 0 };
  const resolvedAt = new Date().toISOString();
  const reasons: CapacityReasonCode[] = [];
  const evidenceIds: string[] = [];
  const trainingComponent: DurabilityComponent<number> = training.ok
    ? {
        present: true,
        value: training.demonstratedPaceSecPerMi,
        confidence: capToLayerCeiling(training.confidence),
        sourceMode: 'direct',
        evidenceIds: training.supporting.map((o) => o.id),
      }
    : { present: false, reason: training.reason, observations: training.observations };

  const raceComponent: DurabilityComponent<number> = raceExponent.ok
    ? {
        present: true,
        value: raceExponent.value,
        confidence: capToLayerCeiling(raceExponent.confidence),
        sourceMode: 'race_derived',
        evidenceIds: raceExponent.supporting.map((r) => r.slug),
      }
    : { present: false, reason: raceExponent.reason, observations: raceExponent.races };

  const decouplingComponent: DurabilityComponent<number> = decoupling.ok
    ? {
        present: true,
        value: decoupling.value,
        confidence: capToLayerCeiling(decoupling.confidence),
        // A direct measurement off the runner's own long runs — the same
        // status the pace corpus readers get, for the same reason.
        sourceMode: 'direct',
        evidenceIds: decoupling.supporting.map((o) => o.id),
      }
    : { present: false, reason: decoupling.reason, observations: decoupling.observations };

  if (raceComponent.present) {
    reasons.push('PERSONAL_RIEGEL_EXPONENT');
    evidenceIds.push(...raceComponent.evidenceIds);
  } else {
    reasons.push('NO_RACE_EXPONENT_EVIDENCE', 'POPULATION_ENDURANCE_PRIOR');
  }
  if (decouplingComponent.present) {
    reasons.push('LONGITUDINAL_DECOUPLING');
    evidenceIds.push(...decouplingComponent.evidenceIds);
  } else {
    reasons.push('NO_DECOUPLING_CORROBORATION');
  }
  if (raceComponent.present && decouplingComponent.present) {
    reasons.push('TWO_INDEPENDENT_EVIDENCE_TYPES');
  }
  if (trainingComponent.present) {
    reasons.push('MARATHON_REHEARSALS_DEMONSTRATED');
    evidenceIds.push(...trainingComponent.evidenceIds);
  } else {
    reasons.push('NO_MARATHON_REHEARSAL_EVIDENCE');
  }
  if (raceExponent.ok && (raceExponent.reasons ?? []).includes('SINGLE_LONG_END_OBSERVATION')) {
    reasons.push('EXPONENT_RESTS_ON_ONE_LONG_RACE');
  }

  const raceConf = raceComponent.present ? raceComponent.confidence : 0;
  const decouplingConf = decouplingComponent.present ? decouplingComponent.confidence : 0;
  const anyPresent = raceComponent.present || decouplingComponent.present;

  // The aggregate mode is the STRONGEST component present — `direct` when
  // decoupling corroborated, `race_derived` when only the exponent did,
  // `population_prior` when neither. One ordering, `SOURCE_MODE_STRENGTH`,
  // never a second opinion about which evidence is stronger.
  const modes: SourceMode[] = [];
  if (raceComponent.present) modes.push(raceComponent.sourceMode);
  if (decouplingComponent.present) modes.push(decouplingComponent.sourceMode);
  const sourceMode: SourceMode = modes.length === 0
    ? 'population_prior'
    : modes.reduce((a, b) => (SOURCE_MODE_STRENGTH[b] > SOURCE_MODE_STRENGTH[a] ? b : a));

  return {
    enduranceExponent: raceComponent.present ? raceComponent.value : POPULATION_ENDURANCE_PRIOR,
    raceExponent: raceComponent,
    rawFittedExponent: raceExponent.ok ? raceExponent.rawFittedExponent : null,
    trainingDurability: trainingComponent,
    decoupling: decouplingComponent,
    confidence: anyPresent
      ? combineIndependentConfidence(raceConf, decouplingConf)
      : CAPACITY_CONFIDENCE_BANDS.populationPrior,
    sourceMode,
    evidenceIds,
    resolvedAt,
    reasons,
    modelVersion: CAPACITY_MODEL_VERSION,
  };
}

/**
 * How well does this runner's capability survive duration? THE canonical
 * answer (§2).
 *
 * `todayISO` is accepted for signature parity with the other three resolvers —
 * the goal-isolation assertion in section 0 requires all four to have the same
 * parameter tuple, and a uniform interface is what lets a consumer hold "a
 * capacity resolver" rather than four differently-shaped functions. The
 * underlying readers resolve the runner's own today internally
 * (`resolveRaceExponent` / `resolveDecoupling` both call `runnerToday`), so
 * passing a different date here does NOT retro-date the read. Stated plainly
 * rather than left for someone to discover: this parameter is currently inert
 * for durability, and a historical-replay pass (§12) will need to thread it
 * into those two readers before it means anything.
 */
export async function resolveDurability(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  todayISO?: string,
): Promise<DurabilityCapacityEstimate> {
  const [raceExponent, decoupling] = await Promise.all([
    resolveRaceExponent(userId),
    resolveDecoupling(userId),
  ]);
  const trainingDurability = await resolveTrainingDurability(userId, todayISO);
  return composeDurability({ raceExponent, decoupling, trainingDurability });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · THE COMPILE-TIME GOAL-ISOLATION ASSERTIONS (§6, §10)
 *
 * Placed at the bottom so they reference the real declarations above. Each line
 * fails `tsc --noEmit` if that resolver's parameter tuple ever changes — which
 * is what makes "the resolver cannot see the goal" a build error rather than a
 * code-review convention. Falsify by adding `goalSec?: number` to any of the
 * four and watching the matching line go red.
 * ═══════════════════════════════════════════════════════════════════════ */

type _GoalFreeThreshold = AssertTrue<
  Equals<Parameters<typeof resolveThresholdCapacity>, CapacityResolverParams>
>;
type _GoalFreeHighIntensity = AssertTrue<
  Equals<Parameters<typeof resolveHighIntensityCapacity>, CapacityResolverParams>
>;
type _GoalFreeEasy = AssertTrue<
  Equals<Parameters<typeof resolveEasyCeiling>, CapacityResolverParams>
>;
type _GoalFreeDurability = AssertTrue<
  Equals<Parameters<typeof resolveDurability>, CapacityResolverParams>
>;

/** Exported so the assertions above are not dead code an unused-locals lint
 *  could delete along with the guarantee they carry. Reading this type is
 *  reading "all four resolvers are goal-free". */
export type CapacityResolversAreGoalFree =
  _GoalFreeThreshold & _GoalFreeHighIntensity & _GoalFreeEasy & _GoalFreeDurability;
