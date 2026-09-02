/**
 * lib/training/coaching-thesis.ts · THE COACHING THESIS.
 *
 * `docs/BRAIN_CONSTITUTION.md` §F:
 *
 *     "Owns: what are we currently trying to accomplish with this runner?
 *      The strategic bridge between fitness and planning."
 *
 * Computed from the Runner Model's own canonical capacities, never invented,
 * never persisted. It states: the primary limiter, the current training
 * priority, why THIS WEEK's key sessions address it, what is deliberately held
 * constant, its confidence, its supporting evidence, and what would make it
 * change.
 *
 * ── WHAT THIS CONSUMES, AND WHAT IT DOES NOT CALCULATE ──────────────────────
 *
 * §F is explicit: "Does NOT calculate fitness — consumes canonical Runner
 * Model outputs." This resolver calls `resolveThresholdCapacity`,
 * `resolveHighIntensityCapacity` and `resolveDurability` from
 * `lib/training/capacity-resolver.ts` (THE Runner Model layer, Constitution
 * §C) and reads nothing else about fitness. It does not touch
 * `resolveEasyCeiling` — easy running is a boundary with feel-based guidance,
 * not one of the three capacities a coaching strategy trades off (§33). It
 * does not touch `lib/adaptation/*` or any race-prediction module, and it
 * cannot see a goal (the parameter tuple is asserted at the bottom).
 *
 * ── v3 (2026-09-02) · THE LIMITER IS EVIDENCE-FIRST, CONFIDENCE-SECOND ──────
 *
 * v2 picked the limiter as "among the evidenced capacities, the one the Runner
 * Model knows LEAST about" (`LOWEST_CONFIDENCE_AMONG_EVIDENCED`). That was an
 * honest proxy when nothing in the repo could say a capacity was WEAK rather
 * than thinly evidenced. It was also wrong for the only real runner this app
 * has, and it contradicted a doctrine-bound reader that already existed:
 *
 *     2026-09-02 · owner · THRESHOLD direct 0.84 · DURABILITY direct 0.90
 *       thesis v2      → primaryLimiter THRESHOLD ("Threshold is where the work goes")
 *       limiter.ts     → endurance ("5 graded races form a curve at 1.101 ·
 *                         doctrine's neutral band tops out at 1.08")
 *
 * Two engine answers to Constitution §29's "what currently matters most", both
 * printed as "the limiter" (Today's About line and the gap report), and they
 * disagreed. Rule 16. The second answer is the doctrine-cited one: `Research/02`
 * §7.1 classifies runners from the SHAPE of their race-time curve, a Riegel
 * exponent above the Combo band is a Speedster who fades with distance, and
 * `LIMITER.curve-shape-neutral-band` binds `CURVE_NEUTRAL_EXPONENT_BAND` to
 * that table. The marathon-anchor audit (`docs/reports/marathon-anchor-audit-
 * 2026-09-02.md` §5) reads the same runner the same way: a half five weeks
 * before a marathon that came in 7.4% slower than Riegel predicts.
 *
 * So the limiter now has TWO bases, in this order:
 *
 *   1 · CURVE_SHAPE_EVIDENCE · the durability read carries a personal race
 *       exponent (race_derived, this runner's own graded races) and its RAW
 *       fit sits above `CURVE_NEUTRAL_EXPONENT_BAND` → DURABILITY is the
 *       evidenced limiter. Below the band the runner is speed-limited; that
 *       capacity has no direct reader (below), so the shape is REPORTED and
 *       DURABILITY is excluded from being called the limiter (it is the
 *       evidenced strength), and the pick falls through to basis 2.
 *   2 · LOWEST_CONFIDENCE_AMONG_EVIDENCED · v2's rule, unchanged, among the
 *       rankable capacities not excluded by basis 1.
 *
 * The band is IMPORTED from `lib/coach/limiter.ts`, not restated: one
 * constant, one registry claim, two consumers (Rule 16). And the input to the
 * shape read is `rawFittedExponent`, the same quantity `limiter.ts` spends,
 * carried through the durability estimate rather than re-fitted here.
 *
 * RULE 9, argued rather than assumed. The band edge is a threshold on a
 * continuous quantity. The quantity, `rawFittedExponent`, is a pure function
 * of the runner's GRADED RACE SET — `fitRaceExponent` folds the clock into
 * `confidence` only, never into the fit — so it cannot drift day to day. It
 * moves when a race lands, which is the `NEW_RACE_RESULT` review trigger this
 * thesis already declares. `_thesis_golden.test.ts` walks `todayISO` across
 * 90 days with the races held fixed and asserts the limiter does not move.
 *
 * ── UNRANKABLE, AND UNKNOWN (Rule 11) ───────────────────────────────────────
 *
 * A capacity resolved at `vdot_fallback`, `user_prior` or `population_prior`
 * has not been LOOKED AT. It is UNRANKABLE (`NO_DIRECT_READER`) and can never
 * be the primary limiter. HIGH_INTENSITY is unrankable for every runner today,
 * because `resolveHighIntensityCapacity` has no direct rung; the moment one
 * lands the same code ranks it with no edit. `primaryLimiter` may be `UNKNOWN`,
 * which is the honest answer for a runner with no evidenced capacity at all.
 * `CapacityStanding`'s unrankable branch carries NO `confidence` field, so
 * `standing.confidence` does not compile until the caller has branched.
 *
 * ── THIS WEEK (Constitution §16, §31) ───────────────────────────────────────
 *
 * `addressedBy` is the runner's OWN authored sessions this week whose family
 * speaks to the limiter, never invented. `weekVerdict` is §16's lightweight
 * validator, applied to the week: does the week SUPPORT the thesis, merely
 * HOLD it, or CONTRADICT it (§31: "Coaching Thesis says durability →
 * generated week cannot become unjustifiably VO2-dominant")? A taper, race,
 * recovery or cutback week is NON_NORMAL and is never called a contradiction —
 * the plan is deliberately not building anything that week. A contradiction is
 * REPORTED, loudly, in the structured object and the audit; this module
 * mutates nothing (§16: "detects invalid combinations", "does not invent a new
 * decision").
 *
 * `thesisPlanDirective` is the SAME object, projected to the shape a plan
 * composer consumes (emphasis, key-session family, what to hold). The Plan
 * Generator (§H) is the intended caller; wiring it into `composePlan` is
 * `lib/plan/generate.ts`'s change, not this file's — see the report that
 * landed with v3 for the two seams.
 *
 * ── ONE VOICE (Rule 16, Rule 17) ───────────────────────────────────────────
 *
 * `coachLine` is composed HERE, once, from the structured fields, and every
 * surface quotes it. Two sentences: what holds, then where the work goes and
 * which session this week does it. `thesisLeadClause` is the day-level length
 * of the same voice for Today's "why". No surface writes its own sentence
 * about the same facts (Constitution §P).
 *
 * ── COMPUTE AT READ TIME (Rule 10), PURE CORE ───────────────────────────────
 *
 * `composeCoachingThesis` is PURE — no pool, no clock beyond `resolvedAt` —
 * so golden fixtures can drive it with no database (Rule 15: a mechanism no
 * case can reach is untested). `resolveCoachingThesis` is the DB shell.
 *
 * ── WHAT THIS CANNOT CATCH (Rule 22) ────────────────────────────────────────
 *
 *   · An endurance-biased runner's real limiter is SPEED, and this file cannot
 *     name it: HIGH_INTENSITY has no direct reader. The shape finding is
 *     reported (`curveShape`, reasons, a review trigger) and the limiter falls
 *     to the next evidenced capacity or to UNKNOWN. Naming speed off the curve
 *     alone would be this file inventing a capacity belief (§F forbids it).
 *   · The neutral band has ONE edge per side and no margin. A runner whose
 *     raw fit sits at 1.0801 is classified the same as one at 1.13. That is
 *     doctrine's own classification applied literally, and the input is
 *     event-driven (above), but a two-race fit is thin evidence and the
 *     confidence carried on the thesis says so.
 *   · `addressedBy`'s family match is coarse (`is_long`, `type`). A session
 *     that MATCHES the limiter's family is not necessarily one that can
 *     EVIDENCE it (a hill-rep day with no pace target cannot); `serves` says
 *     `MATCHES_LIMITER_FAMILY` and nothing stronger.
 *   · The week verdict reads the AUTHORED week, not the executed one.
 */

import { pool } from '@/lib/db/pool';
import { loadSettings } from '@/lib/coach/settings';
import { weekWindowFor } from '@/lib/coach/week-window';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { readSelectionRationale } from '@/lib/plan/progression-spec';
import { POPULATION_ENDURANCE_PRIOR } from '@/lib/training/durability-anchor';
import { CURVE_NEUTRAL_EXPONENT_BAND } from '@/lib/coach/limiter';
import {
  resolveThresholdCapacity,
  resolveHighIntensityCapacity,
  resolveDurability,
  type ThresholdCapacityEstimate,
  type HighIntensityCapacityEstimate,
  type DurabilityCapacityEstimate,
  type SourceMode,
} from '@/lib/training/capacity-resolver';

/** The three capacities Coaching Thesis trades off against each other — the
 *  Runner Model's own set (§33), minus the easy-ceiling boundary. */
export type PrimaryCapacity = 'THRESHOLD' | 'HIGH_INTENSITY' | 'DURABILITY';

/** The limiter, or the honest refusal. Rule 11: "no evidenced capacity" is a
 *  fact of its own, not a capacity picked off the weakest rung. */
export type ThesisLimiter = PrimaryCapacity | 'UNKNOWN';

/** How the primary limiter was picked, or why it could not be. */
export type ThesisBasis =
  | 'CURVE_SHAPE_EVIDENCE'
  | 'LOWEST_CONFIDENCE_AMONG_EVIDENCED'
  | 'NO_EVIDENCED_CAPACITY';

/** Why a capacity was excluded from the ranking. */
export type UnrankableReason = 'NO_DIRECT_READER';

/**
 * The source modes that mean a capacity has been LOOKED AT with evidence
 * belonging to this runner. Everything below these — `vdot_fallback`,
 * `user_prior`, `population_prior` — is the engine answering from a scalar, a
 * typed-in number, or nothing.
 */
export const RANKABLE_SOURCE_MODES: readonly SourceMode[] =
  Object.freeze(['direct', 'inferred', 'race_derived'] as const);

export function isRankableSourceMode(mode: SourceMode): boolean {
  return RANKABLE_SOURCE_MODES.includes(mode);
}

/** Structured, never prose (§27). */
export type ThesisReasonCode =
  | 'CURVE_SHAPE_SPEED_BIASED_FADES_WITH_DISTANCE'
  | 'CURVE_SHAPE_ENDURANCE_BIASED_NO_HIGH_INTENSITY_READER'
  | 'CURVE_SHAPE_NEUTRAL'
  | 'CURVE_SHAPE_UNAVAILABLE'
  | 'LOWEST_CONFIDENCE_AMONG_EVIDENCED'
  | 'NO_EVIDENCED_CAPACITY'
  | 'CAPACITY_UNRANKABLE_NO_DIRECT_READER'
  | 'LIMITER_HAS_DIRECT_EVIDENCE'
  | 'LIMITER_EVIDENCE_IS_INDIRECT'
  | 'KEY_SESSION_PRESENT_THIS_WEEK'
  | 'NO_KEY_SESSION_THIS_WEEK'
  | 'NO_ACTIVE_PLAN';

/** What the coach is trying to do next. §F's own vocabulary. */
export type ThesisPriority =
  | 'increase_threshold_demand'
  | 'increase_high_intensity_demand'
  | 'increase_long_run_demand'
  | 'establish_evidence_before_prioritising';

/** Why a capacity is not this block's emphasis. */
export type HeldConstantCode =
  | 'BETTER_EVIDENCED_THAN_THE_LIMITER'
  | 'EVIDENCED_STRENGTH_BY_CURVE_SHAPE'
  | 'NOT_LOOKED_AT_NO_DIRECT_READER';

/** Concrete, checkable conditions that would move the limiter. */
export type ReviewTriggerCode =
  | 'CURVE_SHAPE_RETURNS_TO_NEUTRAL'
  | 'LIMITER_CONFIDENCE_OVERTAKEN'
  | 'UNRANKABLE_GAINS_A_DIRECT_READER'
  | 'NEW_RACE_RESULT';

export const COACHING_THESIS_MODEL_VERSION = '3.0.0';

/**
 * Durability's sub-observations, passed straight through from
 * `resolveDurability` so a reader can see whether the standing rests on the
 * runner's OWN race curve or only on decoupling with the prior standing in.
 */
export interface DurabilitySubReads {
  /** The runner's own fitted exponent (shrunk, the number to prescribe from),
   *  or null when no fit is supported. NEVER the prior wearing this name. */
  raceExponent: number | null;
  /** The RAW fit, unshrunk — the SHAPE doctrine classifies on. Null with
   *  `raceExponent`. */
  rawFittedExponent: number | null;
  /** `POPULATION_ENDURANCE_PRIOR`, carried for comparison. */
  populationPrior: number;
  /** Mean pace/HR drift across qualifying long runs, or null. */
  decouplingPct: number | null;
}

/**
 * Doctrine's runner-type read off the race curve (`Research/02` §7.1,
 * `CURVE_NEUTRAL_EXPONENT_BAND`). Rule 11: `unavailable` is its own arm and
 * carries no exponent.
 */
export type CurveShapeRead =
  | {
      read: 'speed_biased' | 'endurance_biased' | 'neutral';
      rawExponent: number;
      band: readonly [number, number];
      races: number;
      /** The race component's OWN confidence — thin evidence says so here. */
      confidence: number;
      evidenceIds: string[];
    }
  | { read: 'unavailable'; reason: string };

/** One capacity's position, or its argued exclusion. Rule 11 as a type. */
export type CapacityStanding =
  | {
      capacity: PrimaryCapacity;
      rankable: true;
      /** The owning resolver's own confidence, unchanged. */
      confidence: number;
      sourceMode: SourceMode;
      durability?: DurabilitySubReads;
    }
  | {
      capacity: PrimaryCapacity;
      rankable: false;
      reason: UnrankableReason;
      sourceMode: SourceMode;
      durability?: DurabilitySubReads;
    };

/** The session family a plan row belongs to, as the thesis reads it. */
export type SessionFamily = 'long' | 'threshold' | 'intervals' | 'race' | 'other';

/** A session on the runner's OWN current-week plan whose FAMILY speaks to the
 *  primary limiter — never invented; absent entirely when the week carries
 *  none. */
export interface AddressedSession {
  planWorkoutId: string;
  dateIso: string;
  type: string;
  subLabel: string | null;
  family: SessionFamily;
  distanceMi: number | null;
  /** The catalogue selector's own rationale, or null when none was persisted. */
  selectionRationale: string | null;
  /** The strength of the claim, and deliberately the weakest true one. */
  serves: 'MATCHES_LIMITER_FAMILY';
}

export interface HeldConstant {
  capacity: PrimaryCapacity;
  code: HeldConstantCode;
  note: string;
}

export interface ReviewTrigger {
  code: ReviewTriggerCode;
  detail: string;
}

/** Constitution §16's verdict on the week, against the thesis. */
export type WeekVerdictCode =
  | 'WEEK_ADDRESSES_LIMITER'
  | 'WEEK_HOLDS_NO_KEY_SESSION'
  | 'WEEK_CONTRADICTS_THESIS'
  | 'WEEK_IS_NON_NORMAL'
  | 'NOT_ASSESSED';

export interface WeekVerdict {
  code: WeekVerdictCode;
  detail: string;
}

export interface CoachingThesis {
  primaryLimiter: ThesisLimiter;
  basis: ThesisBasis;
  priority: ThesisPriority;
  /** Doctrine's read of the race curve, or why there is none. */
  curveShape: CurveShapeRead;
  /** This week's own authored sessions whose family speaks to the limiter. */
  addressedBy: AddressedSession[];
  /** Every capacity that is NOT the emphasis, with the reason it is not. */
  heldConstant: HeldConstant[];
  /** §16's validator, applied to the authored week. */
  weekVerdict: WeekVerdict;
  /** 0..1, the basis's OWN resolved confidence — not a new score. `null`
   *  when the limiter is `UNKNOWN`. */
  confidence: number | null;
  /** Traceable to the basis's underlying observations. Empty for `UNKNOWN`. */
  evidenceIds: string[];
  reasons: ThesisReasonCode[];
  reconsiderIf: ReviewTrigger[];
  /** Every capacity's position or exclusion, so the pick is auditable. */
  standings: CapacityStanding[];
  /** THE composed coach-voice sentence set. */
  coachLine: string;
  resolvedAt: string;
  modelVersion: string;
}

/** Deterministic tie-break. Argued, not derived. */
const TIE_BREAK_ORDER: PrimaryCapacity[] = ['THRESHOLD', 'DURABILITY', 'HIGH_INTENSITY'];

/** The runner-facing word for each capacity (Rule 16). */
const CAPACITY_WORD: Record<PrimaryCapacity, string> = {
  THRESHOLD: 'threshold',
  HIGH_INTENSITY: 'speed',
  DURABILITY: 'durability',
};

/** The runner-facing word for the session that builds each capacity. */
const SESSION_WORD: Record<PrimaryCapacity, string> = {
  THRESHOLD: 'threshold session',
  HIGH_INTENSITY: 'interval session',
  DURABILITY: 'long run',
};

function durabilitySubReads(durability: DurabilityCapacityEstimate): DurabilitySubReads {
  return {
    raceExponent: durability.raceExponent.present ? durability.raceExponent.value : null,
    rawFittedExponent: durability.raceExponent.present
      ? (durability.rawFittedExponent ?? null)
      : null,
    populationPrior: POPULATION_ENDURANCE_PRIOR,
    decouplingPct: durability.decoupling.present ? durability.decoupling.value : null,
  };
}

/**
 * Pure · doctrine's runner-type read off the durability estimate's race curve.
 *
 * Reads the RAW fit against `CURVE_NEUTRAL_EXPONENT_BAND` exactly as
 * `lib/coach/limiter.ts#diagnoseLimiter` does (above the band = Speedster,
 * endurance-limited; below = Endurance monster, speed-limited; inside = no
 * shape limiter). Refuses, with a reason, when the estimate carries no
 * personal fit or no raw exponent.
 */
export function curveShapeFrom(durability: DurabilityCapacityEstimate): CurveShapeRead {
  if (!durability.raceExponent.present) {
    return { read: 'unavailable', reason: durability.raceExponent.reason };
  }
  const raw = durability.rawFittedExponent;
  if (raw == null || !Number.isFinite(raw)) {
    return { read: 'unavailable', reason: 'raw fitted exponent not carried on the durability estimate' };
  }
  const [lo, hi] = CURVE_NEUTRAL_EXPONENT_BAND;
  const read = raw > hi ? 'speed_biased' : raw < lo ? 'endurance_biased' : 'neutral';
  return {
    read,
    rawExponent: raw,
    band: CURVE_NEUTRAL_EXPONENT_BAND,
    races: durability.raceExponent.evidenceIds.length,
    confidence: durability.raceExponent.confidence,
    evidenceIds: [...durability.raceExponent.evidenceIds],
  };
}

/**
 * The standings. NO NORMALIZATION OF ANY KIND — see the file header for the
 * v2 defect that removing it fixed.
 *
 * Rankable capacities sort ascending by their own resolved confidence (least
 * known first). Unrankable capacities follow, in tie-break order, and can
 * never reach the front. This is basis 2's ordering; basis 1 sits above it in
 * `composeCoachingThesis`.
 */
export function rankCapacities(
  threshold: ThresholdCapacityEstimate,
  highIntensity: HighIntensityCapacityEstimate,
  durability: DurabilityCapacityEstimate,
): CapacityStanding[] {
  const subReads = durabilitySubReads(durability);
  const build = (
    capacity: PrimaryCapacity,
    estimate: { confidence: number; sourceMode: SourceMode },
  ): CapacityStanding =>
    isRankableSourceMode(estimate.sourceMode)
      ? {
          capacity,
          rankable: true,
          confidence: estimate.confidence,
          sourceMode: estimate.sourceMode,
          ...(capacity === 'DURABILITY' ? { durability: subReads } : {}),
        }
      : {
          capacity,
          rankable: false,
          reason: 'NO_DIRECT_READER',
          sourceMode: estimate.sourceMode,
          ...(capacity === 'DURABILITY' ? { durability: subReads } : {}),
        };

  const all: CapacityStanding[] = [
    build('THRESHOLD', threshold),
    build('DURABILITY', durability),
    build('HIGH_INTENSITY', highIntensity),
  ];

  return all.sort((a, b) => {
    if (a.rankable !== b.rankable) return a.rankable ? -1 : 1;
    if (a.rankable && b.rankable && a.confidence !== b.confidence) {
      return a.confidence - b.confidence;
    }
    return TIE_BREAK_ORDER.indexOf(a.capacity) - TIE_BREAK_ORDER.indexOf(b.capacity);
  });
}

/** §F's worked example ties limiter to priority directly. */
export function priorityFor(limiter: ThesisLimiter): ThesisPriority {
  switch (limiter) {
    case 'DURABILITY': return 'increase_long_run_demand';
    case 'THRESHOLD': return 'increase_threshold_demand';
    case 'HIGH_INTENSITY': return 'increase_high_intensity_demand';
    case 'UNKNOWN': return 'establish_evidence_before_prioritising';
  }
}

/**
 * Pure · pick the limiter from the standings and the curve shape.
 *
 * Basis 1 first, basis 2 second — see the file header. Returns the pick, the
 * basis, and which capacity (if any) basis 1 EXCLUDED as an evidenced strength.
 */
export function pickLimiter(
  standings: CapacityStanding[],
  shape: CurveShapeRead,
): { limiter: ThesisLimiter; basis: ThesisBasis; excludedStrength: PrimaryCapacity | null } {
  const rankable = standings.filter((s): s is Extract<CapacityStanding, { rankable: true }> => s.rankable);
  const durabilityRankable = rankable.some((s) => s.capacity === 'DURABILITY');

  if (shape.read === 'speed_biased' && durabilityRankable) {
    return { limiter: 'DURABILITY', basis: 'CURVE_SHAPE_EVIDENCE', excludedStrength: null };
  }

  // An endurance-biased curve says durability is the STRENGTH. Calling it the
  // limiter because it happens to be the least-confident evidenced capacity
  // would contradict the runner's own races.
  const excludedStrength: PrimaryCapacity | null =
    shape.read === 'endurance_biased' && durabilityRankable ? 'DURABILITY' : null;
  const eligible = rankable.filter((s) => s.capacity !== excludedStrength);
  if (eligible.length === 0) {
    return { limiter: 'UNKNOWN', basis: 'NO_EVIDENCED_CAPACITY', excludedStrength };
  }
  return { limiter: eligible[0].capacity, basis: 'LOWEST_CONFIDENCE_AMONG_EVIDENCED', excludedStrength };
}

function heldConstantFor(
  standing: CapacityStanding,
  excludedStrength: PrimaryCapacity | null,
  shape: CurveShapeRead,
): HeldConstant {
  if (!standing.rankable) {
    return {
      capacity: standing.capacity,
      code: 'NOT_LOOKED_AT_NO_DIRECT_READER',
      note: `no direct, inferred or race-derived reader exists for this capacity yet `
        + `(resolved at ${standing.sourceMode}), so it is not ranked and is not being `
        + `called a weakness`,
    };
  }
  if (standing.capacity === excludedStrength && shape.read === 'endurance_biased') {
    return {
      capacity: standing.capacity,
      code: 'EVIDENCED_STRENGTH_BY_CURVE_SHAPE',
      note: `the race curve (raw exponent ${shape.rawExponent.toFixed(3)}) sits below doctrine's `
        + `neutral band [${shape.band[0]}, ${shape.band[1]}], so this runner holds pace across `
        + `distance better than the reference and durability is an evidenced strength`,
    };
  }
  return {
    capacity: standing.capacity,
    code: 'BETTER_EVIDENCED_THAN_THE_LIMITER',
    note: `holding steady at confidence ${standing.confidence.toFixed(2)} `
      + `(${standing.sourceMode}), which is ahead of the limiter's`,
  };
}

/** The plan-day shape that speaks to each capacity's family. Coarse by design. */
export function matchesCapacity(
  capacity: PrimaryCapacity,
  row: { type: string; is_long: boolean },
): boolean {
  return familyOf(row) === familyFor(capacity);
}

export function familyFor(capacity: PrimaryCapacity): SessionFamily {
  if (capacity === 'DURABILITY') return 'long';
  if (capacity === 'THRESHOLD') return 'threshold';
  return 'intervals';
}

export function familyOf(row: { type: string; is_long: boolean }): SessionFamily {
  const t = row.type.toLowerCase();
  if (t === 'race' || t === 'race_week_tuneup') return 'race';
  if (row.is_long || t === 'long') return 'long';
  if (t === 'threshold' || t === 'tempo') return 'threshold';
  if (t === 'intervals' || t === 'interval' || t === 'vo2max') return 'intervals';
  return 'other';
}

/** A plan row as the thesis reads it — the week's authored truth, with the
 *  context that decides whether the week is a normal training week. */
export interface ThesisWeekRow {
  id: string;
  dateIso: string;
  type: string;
  subLabel: string | null;
  isLong: boolean;
  distanceMi: number | null;
  workoutSpec: unknown;
  /** `plan_phases.label` for the week the row sits in, or null. */
  phaseLabel: string | null;
  /** `plan_weeks.is_race_week` / `is_cutback`. */
  isRaceWeek: boolean;
  isCutback: boolean;
}

/** Phase labels under which the plan is deliberately not building. */
const NON_NORMAL_PHASES: ReadonlySet<string> = new Set(['TAPER', 'RECOVERY']);

/**
 * Pure · Constitution §16 applied to one authored week.
 *
 *   ADDRESSES     · the week carries a session of the limiter's family.
 *   HOLDS         · it carries none, and no session of another quality family
 *                   crowds the slot the limiter would have used.
 *   CONTRADICTS   · §31's case: the limiter's family is absent AND the week
 *                   carries two or more sessions of a different quality
 *                   family (e.g. durability is the limiter, no long run, two
 *                   interval days). Reported, never repaired here.
 *   NON_NORMAL    · taper, recovery, race week or cutback: the plan is not
 *                   building anything on purpose. Never a contradiction.
 *   NOT_ASSESSED  · limiter UNKNOWN, or no plan rows to read.
 */
export function assessWeekAgainstThesis(
  limiter: ThesisLimiter,
  rows: readonly ThesisWeekRow[] | null,
): WeekVerdict {
  if (limiter === 'UNKNOWN') return { code: 'NOT_ASSESSED', detail: 'no evidenced limiter to assess the week against' };
  if (rows == null || rows.length === 0) return { code: 'NOT_ASSESSED', detail: 'no authored rows for this week' };

  const nonNormal = rows.find((r) => r.isRaceWeek || r.isCutback || (r.phaseLabel != null && NON_NORMAL_PHASES.has(r.phaseLabel.toUpperCase())));
  if (nonNormal) {
    const why = nonNormal.isRaceWeek ? 'race week' : nonNormal.isCutback ? 'cutback week' : `${nonNormal.phaseLabel} phase`;
    return { code: 'WEEK_IS_NON_NORMAL', detail: `${why}: the plan is deliberately not building this week` };
  }

  const wanted = familyFor(limiter);
  const families = rows.map((r) => familyOf({ type: r.type, is_long: r.isLong }));
  const addressing = families.filter((f) => f === wanted).length;
  if (addressing > 0) {
    return { code: 'WEEK_ADDRESSES_LIMITER', detail: `${addressing} ${wanted} session(s) this week` };
  }
  const otherQuality = families.filter((f) => f !== wanted && f !== 'other' && f !== 'race');
  const dominant = countMax(otherQuality);
  if (dominant && dominant.count >= 2) {
    return {
      code: 'WEEK_CONTRADICTS_THESIS',
      detail: `no ${wanted} session, and ${dominant.count} ${dominant.family} sessions in the same week`,
    };
  }
  return { code: 'WEEK_HOLDS_NO_KEY_SESSION', detail: `no ${wanted} session this week` };
}

function countMax(families: readonly SessionFamily[]): { family: SessionFamily; count: number } | null {
  const counts = new Map<SessionFamily, number>();
  for (const f of families) counts.set(f, (counts.get(f) ?? 0) + 1);
  let best: { family: SessionFamily; count: number } | null = null;
  for (const [family, count] of counts) if (!best || count > best.count) best = { family, count };
  return best;
}

/**
 * THE coach-voice sentence set. One composer, quoted by every surface.
 *
 * Two sentences: what holds, then where the work goes — and, when the week
 * carries it, which session this week does the work. No em dashes, no
 * exclamation marks, no interpuncts, no engine vocabulary.
 */
export function composeCoachLine(
  limiter: ThesisLimiter,
  heldConstant: HeldConstant[],
  opts?: { basis?: ThesisBasis; addressedThisWeek?: boolean },
): string {
  if (limiter === 'UNKNOWN') {
    return 'There is not enough direct evidence yet to say which part of your fitness is '
      + 'holding you back. The next few weeks are about building that evidence rather '
      + 'than pushing one trait.';
  }
  const word = CAPACITY_WORD[limiter];
  const holds = heldConstant.find(
    (h) => h.code === 'BETTER_EVIDENCED_THAN_THE_LIMITER' || h.code === 'EVIDENCED_STRENGTH_BY_CURVE_SHAPE',
  );
  const weekTail = opts?.addressedThisWeek
    ? `, and this week's ${SESSION_WORD[limiter]} is the session that builds it`
    : '';

  if (opts?.basis === 'CURVE_SHAPE_EVIDENCE' && limiter === 'DURABILITY') {
    const first = 'Your races fade with distance faster than your speed predicts, so durability '
      + 'is where the work goes';
    if (!holds) return `${first}${weekTail}.`;
    return `${first}. Your ${CAPACITY_WORD[holds.capacity]} holds${weekTail}.`;
  }

  const work = `${capitalise(word)} is where the work goes${weekTail}.`;
  if (!holds) return work;
  const holdsWhy = holds.code === 'EVIDENCED_STRENGTH_BY_CURVE_SHAPE'
    ? `Your ${CAPACITY_WORD[holds.capacity]} is an evidenced strength, so it holds.`
    : `Your ${CAPACITY_WORD[holds.capacity]} is the best evidenced part of your training `
      + `right now, so it holds.`;
  return `${holdsWhy} ${work}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * THE DAY-LEVEL half of the same voice, for Today's "why". Opening clause
 * only, no leading capital, no full stop; `composeWhy`'s `sentence()` owns
 * punctuation. `servesToday` is the honest half: a quality day that does not
 * address the limiter must not be described as the session that moves it.
 */
export function thesisLeadClause(thesis: CoachingThesis, servesToday: boolean): string {
  if (thesis.primaryLimiter === 'UNKNOWN') {
    return 'there is not enough direct evidence yet to name what is limiting you, so this '
      + 'block is building it';
  }
  const word = CAPACITY_WORD[thesis.primaryLimiter];
  return servesToday
    ? `${word} is the limiter right now, and this is the session that moves it`
    : `${word} is the limiter right now, so that is what the block is building toward`;
}

/**
 * The one coach-safe fragment of a persisted `selection_rationale`: the
 * catalogue workout's own NAME. `null` on a row with no rationale stored
 * (Rule 11: absent is not empty).
 */
export function coachSafeSessionName(selectionRationale: string | null): string | null {
  if (!selectionRationale) return null;
  const head = selectionRationale.split(/\s*[(·;]/)[0]?.trim() ?? '';
  if (!head || head.length > 60) return null;
  return head;
}

/** §F's "what evidence would change the strategy", in coach voice. */
export function composeReviewTrigger(thesis: CoachingThesis): string {
  if (thesis.primaryLimiter === 'UNKNOWN') {
    return 'This gets revisited as soon as there is enough evidence to name a limiter.';
  }
  const word = CAPACITY_WORD[thesis.primaryLimiter];
  if (thesis.basis === 'CURVE_SHAPE_EVIDENCE') {
    return 'This gets revisited when a new race result lands, or when a long race or a '
      + 'race-pace long run shows your pace holding with distance.';
  }
  return `This gets revisited when a new race result lands, or when the evidence behind `
    + `your ${word} catches up with the rest.`;
}

/**
 * THE WIRE SHAPE, and the only one. Both `/api/v5/today` and `/api/v5/block`
 * emit exactly this object under the key `thesis`. Deliberately five keys.
 */
export interface ThesisWire {
  limiter: ThesisLimiter;
  priority: ThesisPriority;
  confidence: number | null;
  coachLine: string;
  reviewTrigger: string;
}

export function wireThesis(thesis: CoachingThesis): ThesisWire {
  return {
    limiter: thesis.primaryLimiter,
    priority: thesis.priority,
    confidence: thesis.confidence,
    coachLine: thesis.coachLine,
    reviewTrigger: composeReviewTrigger(thesis),
  };
}

/**
 * The thesis, projected to the shape a PLAN COMPOSER consumes. The SAME
 * object, not a second strategy: every field is read off `CoachingThesis`.
 *
 * `emphasis` is what the block's quality character should lean toward;
 * `keySessionFamily` is the one session family the week must carry to
 * support the thesis; `hold` are the capacities the composer keeps at
 * maintenance; `doNotAdd` is §F's `not_priority` — the family that must not
 * be added without explanation (§15's coaching-strategy contradiction).
 */
export interface ThesisPlanDirective {
  emphasis: 'durability' | 'threshold' | 'high_intensity' | 'establish_evidence';
  keySessionFamily: SessionFamily | null;
  hold: PrimaryCapacity[];
  doNotAdd: SessionFamily | null;
  basis: ThesisBasis;
  confidence: number | null;
}

/**
 * THESIS-PLAN-1 (2026-09-02) · the limiter → plan-emphasis mapping, extracted so
 * there is exactly ONE of it (Rule 16).
 *
 * `thesisPlanDirective` needs a whole resolved `CoachingThesis`. The plan
 * composer carries only the slice `ThesisAtAuthoring` persists — the limiter,
 * the priority and the confidence — because that is all `authored_state` holds
 * and all a pure `composePlan` caller can be handed. Both now read the same
 * table, so a block cannot be built against one reading of the limiter while
 * the coach line quotes another.
 */
export function planEmphasisForLimiter(limiter: ThesisLimiter): {
  emphasis: ThesisPlanDirective['emphasis'];
  keySessionFamily: SessionFamily | null;
  doNotAdd: SessionFamily | null;
} {
  switch (limiter) {
    case 'DURABILITY':
      return { emphasis: 'durability', keySessionFamily: 'long', doNotAdd: 'intervals' };
    case 'THRESHOLD':
      return { emphasis: 'threshold', keySessionFamily: 'threshold', doNotAdd: null };
    case 'HIGH_INTENSITY':
      return { emphasis: 'high_intensity', keySessionFamily: 'intervals', doNotAdd: null };
    case 'UNKNOWN':
      return { emphasis: 'establish_evidence', keySessionFamily: null, doNotAdd: null };
  }
}

export function thesisPlanDirective(thesis: CoachingThesis): ThesisPlanDirective {
  const hold = thesis.heldConstant
    .filter((h) => h.code !== 'NOT_LOOKED_AT_NO_DIRECT_READER')
    .map((h) => h.capacity);
  const { emphasis, keySessionFamily, doNotAdd } = planEmphasisForLimiter(thesis.primaryLimiter);
  return {
    emphasis,
    keySessionFamily,
    hold,
    doNotAdd,
    basis: thesis.basis,
    confidence: thesis.primaryLimiter === 'UNKNOWN' ? null : thesis.confidence,
  };
}

function reviewTriggersFor(
  limiter: ThesisLimiter,
  basis: ThesisBasis,
  shape: CurveShapeRead,
  standings: CapacityStanding[],
): ReviewTrigger[] {
  const triggers: ReviewTrigger[] = [];
  const rankable = standings.filter((s): s is Extract<CapacityStanding, { rankable: true }> => s.rankable);

  if (basis === 'CURVE_SHAPE_EVIDENCE' && shape.read !== 'unavailable') {
    triggers.push({
      code: 'CURVE_SHAPE_RETURNS_TO_NEUTRAL',
      detail: `the raw race-curve exponent (currently ${shape.rawExponent.toFixed(3)} over ${shape.races} `
        + `graded races) returns inside doctrine's neutral band [${shape.band[0]}, ${shape.band[1]}]`,
    });
  } else if (limiter !== 'UNKNOWN' && rankable.length >= 2) {
    const [primary, next] = rankable;
    triggers.push({
      code: 'LIMITER_CONFIDENCE_OVERTAKEN',
      detail: `${next.capacity}'s confidence (currently ${next.confidence.toFixed(2)}) `
        + `falls below ${primary.capacity}'s (currently ${primary.confidence.toFixed(2)})`,
    });
  }

  for (const s of standings) {
    if (s.rankable) continue;
    triggers.push({
      code: 'UNRANKABLE_GAINS_A_DIRECT_READER',
      detail: `${s.capacity} gains a direct, inferred or race-derived reader and becomes `
        + `rankable (it resolves at ${s.sourceMode} today, and the ranking admits nothing `
        + `below ${RANKABLE_SOURCE_MODES.join('/')})`,
    });
  }

  triggers.push({
    code: 'NEW_RACE_RESULT',
    detail: 'a new race result changes any capacity\'s sourceMode or the race-curve fit, which '
      + 'can both admit a capacity to the ranking and move the shape read',
  });

  return triggers;
}

/** Everything `composeCoachingThesis` needs. Pure input (Rule 18). */
export interface CoachingThesisInputs {
  threshold: ThresholdCapacityEstimate;
  highIntensity: HighIntensityCapacityEstimate;
  durability: DurabilityCapacityEstimate;
  /** The runner's authored week, or null when there is no active plan. */
  week: readonly ThesisWeekRow[] | null;
  todayISO: string;
}

/**
 * THE canonical Coaching Thesis's pure core. §F's answer, computed.
 */
export function composeCoachingThesis(inputs: CoachingThesisInputs): CoachingThesis {
  const { threshold, highIntensity, durability, week } = inputs;
  const resolvedAt = new Date().toISOString();

  const standings = rankCapacities(threshold, highIntensity, durability);
  const shape = curveShapeFrom(durability);
  const { limiter, basis, excludedStrength } = pickLimiter(standings, shape);

  const estimateFor: Record<PrimaryCapacity, { confidence: number; evidenceIds: string[]; sourceMode: SourceMode }> = {
    THRESHOLD: threshold,
    HIGH_INTENSITY: highIntensity,
    DURABILITY: durability,
  };

  // The basis's OWN confidence and evidence, never a new score. A limiter
  // picked off the race curve rests on the race-exponent component, so it
  // carries THAT component's confidence and race slugs — not the durability
  // aggregate, which decoupling could inflate past what the shape claim earns.
  const primaryEstimate = limiter === 'UNKNOWN' ? null : estimateFor[limiter];
  const confidence = limiter === 'UNKNOWN'
    ? null
    : basis === 'CURVE_SHAPE_EVIDENCE' && shape.read !== 'unavailable'
      ? shape.confidence
      : primaryEstimate!.confidence;
  const evidenceIds = limiter === 'UNKNOWN'
    ? []
    : basis === 'CURVE_SHAPE_EVIDENCE' && shape.read !== 'unavailable'
      ? shape.evidenceIds
      : [...primaryEstimate!.evidenceIds];

  const reasons: ThesisReasonCode[] = [];
  switch (shape.read) {
    case 'speed_biased': reasons.push('CURVE_SHAPE_SPEED_BIASED_FADES_WITH_DISTANCE'); break;
    case 'endurance_biased': reasons.push('CURVE_SHAPE_ENDURANCE_BIASED_NO_HIGH_INTENSITY_READER'); break;
    case 'neutral': reasons.push('CURVE_SHAPE_NEUTRAL'); break;
    case 'unavailable': reasons.push('CURVE_SHAPE_UNAVAILABLE'); break;
  }
  reasons.push(basis === 'NO_EVIDENCED_CAPACITY' ? 'NO_EVIDENCED_CAPACITY'
    : basis === 'CURVE_SHAPE_EVIDENCE' ? 'CURVE_SHAPE_SPEED_BIASED_FADES_WITH_DISTANCE'
    : 'LOWEST_CONFIDENCE_AMONG_EVIDENCED');
  if (standings.some((s) => !s.rankable)) reasons.push('CAPACITY_UNRANKABLE_NO_DIRECT_READER');
  if (primaryEstimate) {
    reasons.push(primaryEstimate.sourceMode === 'direct' ? 'LIMITER_HAS_DIRECT_EVIDENCE' : 'LIMITER_EVIDENCE_IS_INDIRECT');
  }

  const heldConstant = standings
    .filter((s) => s.capacity !== limiter)
    .map((s) => heldConstantFor(s, excludedStrength, shape));

  const addressedBy: AddressedSession[] = [];
  if (week == null) {
    reasons.push('NO_ACTIVE_PLAN');
  } else if (limiter !== 'UNKNOWN') {
    for (const row of week) {
      if (!matchesCapacity(limiter, { type: row.type, is_long: row.isLong })) continue;
      addressedBy.push({
        planWorkoutId: row.id,
        dateIso: row.dateIso,
        type: row.type,
        subLabel: row.subLabel,
        family: familyOf({ type: row.type, is_long: row.isLong }),
        distanceMi: row.distanceMi,
        selectionRationale: readSelectionRationale(row.workoutSpec),
        serves: 'MATCHES_LIMITER_FAMILY',
      });
    }
  }
  reasons.push(addressedBy.length > 0 ? 'KEY_SESSION_PRESENT_THIS_WEEK' : 'NO_KEY_SESSION_THIS_WEEK');

  const weekVerdict = assessWeekAgainstThesis(limiter, week);
  const uniqueReasons = [...new Set(reasons)];

  return {
    primaryLimiter: limiter,
    basis,
    priority: priorityFor(limiter),
    curveShape: shape,
    addressedBy,
    heldConstant,
    weekVerdict,
    confidence,
    evidenceIds,
    reasons: uniqueReasons,
    reconsiderIf: reviewTriggersFor(limiter, basis, shape, standings),
    standings,
    coachLine: composeCoachLine(limiter, heldConstant, {
      basis,
      addressedThisWeek: weekVerdict.code === 'WEEK_ADDRESSES_LIMITER',
    }),
    resolvedAt,
    modelVersion: COACHING_THESIS_MODEL_VERSION,
  };
}

/**
 * The runner's authored week, on the ACTIVE plan only (Rule 14), with the
 * phase and week context the verdict needs. `null` when there is no active
 * plan — a different fact from an empty week (Rule 11).
 */
export async function loadThesisWeek(
  userId: string,
  todayISO: string,
): Promise<readonly ThesisWeekRow[] | null> {
  const settings = await loadSettings(userId);
  const { startISO, endISO } = weekWindowFor(settings.long_run_day, todayISO);
  const planRow = (await pool.query<{ id: string }>(
    `SELECT id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!planRow) return null;
  return loadThesisWeekRows(planRow.id, startISO, endISO);
}

/** One plan's rows between two dates, in the thesis's own row shape. */
export async function loadThesisWeekRows(
  planId: string,
  startISO: string,
  endISO: string,
): Promise<ThesisWeekRow[]> {
  const rows = (await pool.query<{
    id: string; date_iso: string; type: string; sub_label: string | null;
    is_long: boolean; distance_mi: number | string | null; workout_spec: unknown;
    phase_label: string | null; is_race_week: boolean | null; is_cutback: boolean | null;
  }>(
    `SELECT pw.id::text AS id, pw.date_iso, pw.type, pw.sub_label, pw.is_long,
            pw.distance_mi, pw.workout_spec,
            pp.label AS phase_label, pwk.is_race_week, pwk.is_cutback
       FROM plan_workouts pw
       LEFT JOIN plan_weeks pwk ON pwk.id = pw.week_id
       LEFT JOIN plan_phases pp ON pp.id = pwk.phase_id
      WHERE pw.plan_id = $1
        AND pw.date_iso::date BETWEEN $2::date AND $3::date
      ORDER BY pw.date_iso ASC`,
    [planId, startISO, endISO],
  )).rows;
  return rows.map((r) => ({
    id: r.id,
    dateIso: r.date_iso,
    type: r.type,
    subLabel: r.sub_label,
    isLong: r.is_long === true,
    distanceMi: r.distance_mi == null ? null : Number(r.distance_mi),
    workoutSpec: r.workout_spec,
    phaseLabel: r.phase_label,
    isRaceWeek: r.is_race_week === true,
    isCutback: r.is_cutback === true,
  }));
}

/**
 * THE canonical Coaching Thesis. §F's answer, computed, not templated.
 *
 * No goal parameter — the same structural discipline `capacity-resolver.ts`
 * enforces (Constitution §6). Compute-at-read-time (Rule 10).
 */
export async function resolveCoachingThesis(
  userId: string,
  todayISO?: string,
): Promise<CoachingThesis> {
  const today = todayISO ?? await runnerToday(userId);
  const [threshold, highIntensity, durability, week] = await Promise.all([
    resolveThresholdCapacity(userId, today),
    resolveHighIntensityCapacity(userId, today),
    resolveDurability(userId, today),
    loadThesisWeek(userId, today),
  ]);
  return composeCoachingThesis({ threshold, highIntensity, durability, week, todayISO: today });
}

/* ══════════════════════════════════════════════════════════════════════════
 * GOAL ISOLATION, ENFORCED BY THE COMPILER (Constitution §6) — the same
 * parameter-tuple assertion `capacity-resolver.ts` section 0 uses.
 * ═══════════════════════════════════════════════════════════════════════ */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;
type ThesisResolverParams = [userId: string, todayISO?: string];
type _GoalFreeThesis = AssertTrue<Equals<Parameters<typeof resolveCoachingThesis>, ThesisResolverParams>>;
export type CoachingThesisResolverIsGoalFree = _GoalFreeThesis;
