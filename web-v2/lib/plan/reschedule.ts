/**
 * lib/plan/reschedule.ts · THE RESCHEDULING BOUNDARY.  (RS-1)
 *
 * Owner of exactly one question: **the runner has told us he cannot run a
 * prescribed session on its scheduled day. Where should it go, and what does
 * moving it cost the rest of the plan?**
 *
 * Contract: `docs/RESCHEDULING_CONTRACT.md` (locked 2026-09-03). Read with
 * `docs/MASTER_CORE_PRODUCT_PROGRAM.md` §"P1 · Workout rescheduling" (RS-1..8).
 *
 * ─── RESCHEDULING IS NOT ADAPTATION. THIS IS THE WHOLE POINT ─────────────────
 *
 *   Adaptation changes TRAINING because demonstrated capacity changed.
 *   Rescheduling changes PLACEMENT because the runner supplied a constraint.
 *
 * Separate typed decisions, owners, records and mutation paths. Concretely:
 *
 *   · The decision type is `RescheduleDecision`, whose `kind` is the literal
 *     `'RESCHEDULE'` and whose `origin` is the literal `'RUNNER_CONSTRAINT'`.
 *     It is NOT an `AdaptationTrigger` and NOT an `AdaptationAction`, and it
 *     carries `evidenceEffect: 'NONE'` as a LITERAL TYPE, so a decision that
 *     claimed to move a fitness belief would not compile.
 *   · Nothing here imports `lib/plan/adapt.ts`, `lib/plan/adaptive-ramp.ts`,
 *     `lib/plan/progression-pass.ts`, `lib/plan/auto-rebuild.ts`,
 *     `lib/plan/recompute-paces.ts` or any re-anchor.
 *     `_reschedule_not_adaptation.test.ts` walks the TRANSITIVE import graph of
 *     this module and fails if it ever reaches one.
 *   · Nothing here writes `coach_intents`, `plan_mutations`, `runs`, `profile`
 *     or any capacity column. The record goes to its own table,
 *     `plan_reschedules` (migration 163).
 *   · A rescheduled day is never a missed day. The vacated date always ends up
 *     carrying a PRESCRIBED rest row, so no missed-workout reader can see an
 *     unrun prescription there. `_reschedule_contract.test.ts` proves it.
 *
 * ─── THE TWO QUESTIONS THAT MUST NEVER COLLAPSE  (Q40) ──────────────────────
 *
 *   1. `executionGrade`      · did he execute the workout ULTIMATELY prescribed?
 *   2. `stimulusPreservation` · how much of the ORIGINAL stimulus survived?
 *
 * This module owns (2) and deliberately does not own (1) — grading needs full
 * activity reconciliation and belongs to the post-run owner. What it guarantees
 * is that (1) can never silently answer (2):
 *
 *   · A PURE DATE CHANGE keeps the SAME workout instance. It is written as a
 *     `date_iso` MOVE on the same row id, not as a content copy between two
 *     rows, precisely because Q40 says the instance survives. A content swap
 *     would give the session a new row id at the new date and quietly destroy
 *     the identity the contract requires. `stimulusPreservation: 'FULL'`.
 *   · ANY change to distance, structure, intensity or purpose creates a REVISED
 *     VERSION linked to the original. The original date, type, distance,
 *     sub-label, pace target and spec are preserved verbatim on the decision
 *     record, with a stated `reductionReason`, and `stimulusPreservation` is
 *     `'PARTIAL'` or `'SUBSTITUTED'` — never `'FULL'`.
 *   · 15 miles reduced to 12: completing 12 may grade FULL against the revised
 *     instruction. It does not earn credit for the 15-mile durability demand.
 *     Load and durability evidence use the 12 actually run, which is automatic
 *     here because the row carries 12 and nothing in this module ever rewrites
 *     a prescription after the fact.
 *   · `assertNoPostCompletionRewrite` refuses outright on a SEALED day, at
 *     apply time as well as at recommend time. "Never change the prescription
 *     after completion to convert an undercompleted workout into FULL."
 *
 * ─── NOTHING WRITES UNTIL HE APPROVES  (RS-5) ───────────────────────────────
 *
 * `recommendReschedule()` is a PURE READ: it opens no transaction and issues
 * only SELECTs. `applyReschedule()` and `undoReschedule()` are the only writers
 * in this file, both require the proposal token the runner actually read, and
 * every write goes through `mutatePlan` (`lib/plan/mutate.ts`) — the existing
 * atomic, differential-validating, rollback-on-violation boundary. This module
 * adds no second door in front of `plan_workouts`.
 *
 * ─── WHERE THIS SITS AMONG THE MOVERS THAT ALREADY EXIST ────────────────────
 *
 * Three write paths could already change a session's day, and none of them
 * answers the question above:
 *
 *   · `POST /api/today/reschedule` — the runner names BOTH days. No candidate
 *     generation, no ranking, no separation reading, no stimulus assessment.
 *     It also writes a `coach_intents` row, which is an adaptation-seam record.
 *   · `POST /api/plan/change` scenario `move_day` — the runner names both days,
 *     the destination must already be a rest day, and it refuses a cross-week
 *     move outright ("A session moves inside its own week"). For the live case
 *     that refusal alone rules out the Monday option.
 *   · `PATCH /api/plan/workout` — a raw field edit with no coaching opinion.
 *
 * This module is the DECISION owner: it generates candidates, ranks them by
 * physiological and plan disruption, states the cost of each, records the
 * lineage Q40 requires, and can be undone. It is a first-class fourth surface
 * on purpose, and the three above should be retired into it or reduced to thin
 * callers. That consolidation is NOT done here (those files belong to other
 * owners this cycle) and is reported instead.
 *
 * ─── RANKING: PHYSIOLOGICAL AND PLAN DISRUPTION, NOT CALENDAR DISTANCE ──────
 *
 * The preservation order is the master program's, in its order, with cost
 * weights an order of magnitude apart so the order actually holds rather than
 * being averaged away:
 *
 *   1 the moved session's intended stimulus     W_STIMULUS
 *   2 adequate separation from hard sessions    W_SEPARATION
 *   3 the important surrounding quality work    W_DISPLACED_QUALITY
 *   4 training continuity                       W_CONTINUITY
 *   5 weekly or rolling load                    W_ROLLING_LOAD
 *   6 the remainder of the block                W_BLOCK_DISTURBANCE
 *
 * **Rule 9.** No candidate is accepted or rejected by comparing a CONTINUOUS
 * quantity against a threshold. Rejections rest only on discrete honest facts:
 * the date is unavailable, the date is past, the day is sealed, the day is a
 * race, the destination week is a taper or an A-race week. Rolling load, week
 * totals and distance reduction enter as CONTINUOUS cost terms, so a tenth of a
 * mile can change an option's RANK and can never change whether it EXISTS.
 * Doctrine's numbers are control points on those curves, not steps.
 *
 * **Rule 16.** `separationFindings` computes the separation quantity ONCE,
 * under one name. `stimulusGapOk` in `replan-scenarios.ts` answers a DIFFERENT
 * question — "does this single week satisfy validate.ts §9's day-of-week wrap"
 * — and is left to answer it. A reschedule routinely crosses a Monday, and a
 * modulo-7 walk within one week structurally cannot see across one.
 *
 * ─── A KNOWN DOCTRINE DIVERGENCE, REPORTED RATHER THAN PICKED ───────────────
 *
 * `RESCHEDULING_CONTRACT.md` Q32's table says the next quality session needs
 * "≥1 complete easy/rest day" after intervals. `lib/plan/validate.ts` §9
 * requires TWO. This module mirrors the VALIDATOR, for the reason
 * `replan-scenarios.ts` gives in its own header: a proposal made against a
 * different number than the boundary will judge it by is worse than no
 * proposal, because the runner confirms a change that is then refused. The
 * divergence is real, is load-bearing for the live case, and is reported
 * rather than silently resolved here.
 *
 * ─── WHAT THIS MODULE NEVER DOES ────────────────────────────────────────────
 *
 *   · never touches a completed or sealed day
 *   · never changes the stated race goal, a pace, an HR anchor or any capacity
 *   · never triggers a rebuild, a pullback, a base restart or an adaptation
 *   · never offers accidental back-to-back demanding days: a candidate that
 *     leaves a separation deficit is not offered as an option. Where no clean
 *     arrangement exists it says preserving everything is impossible and shows
 *     the least-cost compromise, labelled as one.  (Q32)
 *   · never describes a split as preserving a durability or marathon-specific
 *     long run  (Q35)
 *   · never imports long-run or quality load into a taper week  (Q34)
 *   · never duplicates or loses a workout: every edit is a permutation of dates
 *     over existing rows plus in-place prescription changes. No INSERT, no
 *     DELETE.
 *   · never uses a clock, a locale or `Math.random`. `todayISO` is passed in.
 */
import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db/pool';
import { mutatePlan } from '@/lib/plan/mutate';
import { loadPlanShape, type PlanShape } from '@/lib/plan/replan-scenarios';
import { weekDosingFindings, type DosingFinding, type DosingWeek } from '@/lib/plan/dosing';
import { isDaySealed } from '@/lib/plan/seal';

// ─────────────────────────────────────────────────────────────────────────────
// shapes borrowed rather than redeclared
// ─────────────────────────────────────────────────────────────────────────────

/** One prescribed day, exactly as `loadPlanShape` already reads it. */
export type PlanDay = PlanShape['weeks'][number]['days'][number];
/** One authored week, exactly as `loadPlanShape` already reads it. */
export type PlanWeek = PlanShape['weeks'][number];

// ─────────────────────────────────────────────────────────────────────────────
// doctrine constants · mirrored, with the source of each mirror named
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search window per session family.  RESCHEDULING_CONTRACT.md Q31.
 *
 * "A search boundary, not an automatic permission." The adjacent calendar week
 * is reachable only through `allowAdjacentWeek`, which the caller sets on an
 * explicit runner request or when no in-window option preserved the stimulus.
 */
export const SEARCH_WINDOW_DAYS = {
  long: 3,
  quality: 2,
  /** Easy and recovery search their own week; expressed in days for one path. */
  easy: 6,
} as const;

/**
 * Easy or rest days required AFTER a session, before the next demanding one.
 *
 * MIRRORED from `lib/plan/validate.ts` §9 (`reqGap` in `replan-scenarios.ts`):
 * intervals 2, threshold / tempo / long 1, easy 0. The long-run rows extend it
 * with Q32's own table, which grades by distance rather than by type.
 *
 * See the header on the Q32 / §9 divergence for intervals. The validator wins,
 * because the validator is what will judge the applied change.
 */
export function requiredRecoveryDaysAfter(d: PlanDay): number {
  if (!isDemanding(d)) return 0;
  if (d.type === 'intervals') return 2;
  if (d.type === 'race') {
    // Q32 lists a raced B effort among the demanding sessions; a race costs at
    // least as much as a long run of the same distance.
    return d.distanceMi >= 20 ? 2 : 1;
  }
  if (d.isLong) {
    // Q32 · long <~16 mi → ≥1 · 16-18 → 1-2 by whether it carried quality
    // · 18+ or marathon-specific → ~2.
    if (d.distanceMi >= 18 || carriesMarathonPaceWork(d)) return 2;
    if (d.distanceMi >= 16) return d.isQuality ? 2 : 1;
    return 1;
  }
  return 1;
}

/**
 * Cost weights. An order of magnitude apart on purpose: the preservation order
 * in the master program is an ORDER, and weights within an order of each other
 * would let a small load saving outrank a lost long-run stimulus.
 */
const W_STIMULUS = 1000;
const W_SEPARATION = 200;
const W_DISPLACED_QUALITY = 60;
const W_CONTINUITY = 25;
const W_ROLLING_LOAD = 12;
const W_BLOCK_DISTURBANCE = 3;

/**
 * How much of a quality session's value is lost when it is REMOVED rather than
 * moved. Q33/Q34 license removal specifically when a B or C race in the same
 * week supplies that week's principal quality stimulus, so the loss is scored
 * lower there — and the reason is recorded on the option, so the runner reads
 * why and not merely what.
 */
const QUALITY_REMOVED_LOSS_RACE_SUPPLIES = 0.35;
const QUALITY_REMOVED_LOSS_PLAIN = 1.0;
const QUALITY_MOVED_LOSS = 0.15;

/** Flat stimulus penalty for a substitute that is not the same stimulus (Q35). */
const SUBSTITUTED_STIMULUS_LOSS = 0.6;

// ─────────────────────────────────────────────────────────────────────────────
// the typed decision  (RS-1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The discriminant that keeps rescheduling out of the adaptation seam. One
 * legal value, not shared with `AdaptationTriggerKind`.
 */
export type RescheduleKind = 'RESCHEDULE';

/**
 * Why the change is happening. A reschedule is ALWAYS runner-supplied. An
 * engine-initiated placement change is adaptation and belongs to `adapt.ts`.
 */
export type RescheduleOrigin = 'RUNNER_CONSTRAINT';

/** Q40 · a pure date change, or a revised version linked to the original. */
export type WorkoutIdentityChange =
  | { kind: 'SAME_INSTANCE' }
  | {
      kind: 'REVISED_VERSION';
      /** Named out loud, because a silent reduction is the forbidden case. */
      reductionReason: string;
      changed: Array<'distance' | 'structure' | 'intensity' | 'purpose'>;
    };

/**
 * Q40 · how much of the ORIGINAL intended stimulus survived. Never the same
 * question as `executionGrade`, which is answered elsewhere, later, against
 * the prescription that was ULTIMATELY given.
 */
export type StimulusPreservation =
  /** Same session, different day. Nothing about the stimulus changed. */
  | 'FULL'
  /** Same family, less of it. Load and durability evidence use what was run. */
  | 'PARTIAL'
  /** A different stimulus standing in. Not equivalent, and never called one. */
  | 'SUBSTITUTED'
  /** The original stimulus is not recoverable inside the constraint. */
  | 'LOST';

/** How the runner declared his availability. Never inferred.  (RS-2) */
export type AvailabilityConstraint =
  | { kind: 'UNAVAILABLE_DATES'; dates: readonly string[]; note?: string }
  | { kind: 'AVAILABLE_DATES'; dates: readonly string[]; note?: string }
  | {
      /**
       * He has said he cannot do the session on its day and nothing more. The
       * module MUST NOT guess which other days work: it returns every viable
       * candidate with `availabilityUnknown: true` so the phone asks.
       * "Never assume a preference when availability is unknown."
       */
      kind: 'UNKNOWN';
    };

/**
 * Resolve the declared constraint WITHOUT inventing one.  (RS-2)
 *
 * "Never assume a preference when availability is unknown." An empty request
 * yields `UNKNOWN`, which is a THIRD state and not a synonym for "no dates are
 * blocked" (Rule 11: don't know, measured zero and the read failed are three
 * facts). Returning an empty `UNAVAILABLE_DATES` instead would silently tell
 * the phone that every other day is fine, which is precisely the assumption
 * this contract forbids.
 *
 * It lives here rather than in the route so it can be tested, because the rule
 * it enforces is a coaching rule and not a parsing detail.
 */
export function resolveConstraint(
  unavailable: readonly string[], available: readonly string[], note?: string,
): AvailabilityConstraint {
  const can = available.filter(isISODate);
  const cannot = unavailable.filter(isISODate);
  if (can.length > 0) return { kind: 'AVAILABLE_DATES', dates: can, note };
  if (cannot.length > 0) return { kind: 'UNAVAILABLE_DATES', dates: cannot, note };
  return { kind: 'UNKNOWN' };
}

/** What kind of rearrangement an option is. */
export type RescheduleMoveKind =
  | 'MOVE_EARLIER'
  | 'MOVE_LATER'
  | 'SWAP_WITH_DAY'
  | 'SHIFT_SEQUENCE'
  | 'KEEP_AND_MOVE_FOLLOWING_QUALITY'
  | 'SHORTEN_IN_PLACE'
  | 'SHORTEN_AND_MOVE'
  | 'SPLIT'
  | 'DROP';

/** The prescription-and-placement state of one row. */
export interface RowState {
  dateISO: string;
  type: string;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  subLabel: string | null;
  paceTargetSPerMi: number | null;
  spec: Record<string, unknown> | null;
}

/**
 * One row this option would write. The complete diff, before anything writes.
 *
 * `dateISO` lives INSIDE before/after because a pure move is a date change on
 * the same row id (Q40's "remains the same workout instance"). Every edit set
 * is a permutation of dates over existing rows plus in-place prescription
 * changes, so nothing is ever inserted or deleted and no workout can be
 * duplicated or lost.
 */
export interface RescheduleRowEdit {
  planWorkoutId: string;
  before: RowState;
  after: RowState;
  /** Plain-language reason this specific row moved. Shown, not logged. */
  why: string;
}

/** A separation reading between two demanding sessions, after the change. */
export interface SeparationFinding {
  earlierISO: string;
  earlierLabel: string;
  laterISO: string;
  laterLabel: string;
  /** Complete days between them. Two consecutive days give 0. */
  interveningDays: number;
  requiredDays: number;
  /** `requiredDays - interveningDays`, floored at 0. Zero means satisfied. */
  deficitDays: number;
  /**
   * Nominal elapsed hours, `24 × (laterISO − earlierISO)`.
   *
   * Stated as NOMINAL and not asserted as fact: plan rows carry a DATE and no
   * time of day, so this is a day-granular figure, not a measured gap. Q32's
   * "'one day apart' can mean barely 24 hours" is exactly why the distinction
   * is kept rather than the number being dressed up as a measurement.
   */
  nominalHours: number;
}

/** What the option does to load, as continuous quantities. */
export interface LoadEffect {
  /** Peak change in the trailing-7-day total anywhere in the affected window. */
  peakRolling7DeltaMi: number;
  peakRolling7OnISO: string | null;
  rolling7BeforeMi: number;
  rolling7AfterMi: number;
  /** Per calendar week touched. Reported because he reads weeks, not windows. */
  weeks: Array<{
    weekId: string; startISO: string; weekIdx: number;
    beforeMi: number; afterMi: number;
    isCutback: boolean; isTaper: boolean;
    racePriority: 'A' | 'B' | 'C' | null;
  }>;
}

/** Downstream consequences the runner is entitled to see before approving. */
export interface DownstreamEffect {
  nextLongRun: { dateISO: string; distanceMi: number; changed: boolean } | null;
  nextRace: {
    dateISO: string; name: string; priority: 'A' | 'B' | 'C' | null;
    daysAfterMovedSession: number;
  } | null;
  nextCutbackWeek: { startISO: string; weekIdx: number; touched: boolean } | null;
  taper: { startsISO: string | null; touched: boolean };
}

/** One ranked way to solve the constraint.  (RS-3, RS-4) */
export interface RescheduleOption {
  id: string;
  rank: number;
  moveKind: RescheduleMoveKind;

  /** RS-4 · new date. */
  newDateISO: string;
  newDow: number;

  /** RS-4 · long-run distance and purpose, as they will stand. */
  session: {
    /** With the distance in it, for a sentence. "15 mi long run". */
    label: string;
    /** WITHOUT the distance, for a line that already prints one. "long run". */
    name: string;
    type: string;
    distanceMi: number;
    originalDistanceMi: number;
    purpose: string;
  };

  identity: WorkoutIdentityChange;
  stimulusPreservation: StimulusPreservation;
  /** RS-4 · training value preserved, in one sentence. */
  trainingValuePreserved: string;

  /** RS-4 · what moved. One line per row, in date order. */
  moved: string[];
  /** RS-4 · what did NOT move. Stated, because silence reads as uncertainty. */
  unchanged: string[];

  /** RS-4 · separation from surrounding hard sessions. */
  separation: SeparationFinding[];
  /** RS-4 · rolling-load change. */
  load: LoadEffect;
  /** RS-4 · effect on the next long run, race, cutback or taper. */
  downstream: DownstreamEffect;

  /** RS-4 · tradeoffs, named. Empty only when there genuinely are none. */
  tradeoffs: string[];
  /** RS-4 · why the coach ranks it HERE. Derived from the cost breakdown. */
  whyRankedHere: string;

  /**
   * True when this option is shown only because nothing clean exists. Q32
   * forbids offering accidental back-to-back hard days; a compromise appears
   * only alongside an explicit statement that preserving everything is
   * impossible.
   */
  isCompromise: boolean;

  /**
   * Enforced dosing findings that appear only because the week this option
   * takes mileage OUT of got smaller. No intensity was added; the share rose
   * because the denominator fell. Shown, never blocking — see
   * `dosingBreachesOf`. An option that ADDED intensity past a cap is not
   * offered at all, so this list can only ever hold the harmless kind.
   */
  dosingShareNotes: DosingFinding[];

  /** The complete diff. Nothing is written that is not in here. */
  edits: RescheduleRowEdit[];

  /** Ranking arithmetic, exposed so a rank can be argued with, not trusted. */
  cost: {
    total: number;
    stimulus: number;
    separation: number;
    displacedQuality: number;
    continuity: number;
    rollingLoad: number;
    blockDisturbance: number;
  };
}

/** A candidate date that cannot be used, and the honest reason.  (Rule 11) */
export interface RescheduleRefusal {
  dateISO: string;
  reason: string;
  /** Distinguishes "he said no" from "the plan says no" from "we cannot tell". */
  cause:
    | 'RUNNER_UNAVAILABLE' | 'IN_THE_PAST' | 'DAY_SEALED' | 'RACE_DAY'
    | 'PROTECTED_WEEK' | 'OUTSIDE_PLAN' | 'SEPARATION' | 'DOSING'
    | 'UNKNOWN_AVAILABILITY';
}

/** The full recommendation. Reading this writes nothing.  (RS-3) */
export interface RescheduleRecommendation {
  kind: RescheduleKind;
  origin: RescheduleOrigin;
  /** Proves, in the type, that reading a recommendation cannot move evidence. */
  evidenceEffect: 'NONE';

  planId: string;
  target: {
    planWorkoutId: string;
    dateISO: string;
    label: string;
    type: string;
    distanceMi: number;
    purpose: string;
    family: 'long' | 'quality' | 'easy';
  };
  constraint: AvailabilityConstraint;
  /** True when he has not said which days work. The phone must ask.  (RS-2) */
  availabilityUnknown: boolean;

  /** Every date the search looked at. */
  considered: string[];
  refusals: RescheduleRefusal[];

  options: RescheduleOption[];
  /**
   * Set when NO option preserves everything. Q32: "explain that preserving
   * everything is impossible and show the least-cost compromise."
   */
  impossibility: string | null;
  /** Q35 · shown whenever the target is a long run, eligible or not. */
  splitVerdict: SplitEligibility | null;

  /**
   * Hash of the plan's structural state plus this request. An apply carrying a
   * stale token is refused: a change applied to a plan the runner never read is
   * indistinguishable, to him, from a bug.
   */
  token: string;
}

/** The record written when, and only when, he approves.  (RS-5) */
export interface RescheduleDecision {
  kind: RescheduleKind;
  origin: RescheduleOrigin;
  /** Literal type. A decision that moved a fitness belief would not compile. */
  evidenceEffect: 'NONE';
  decisionId: string;
  planId: string;
  userUuid: string;
  decidedAtISO: string;
  constraint: AvailabilityConstraint;
  /** Q40 · the original workout id, date and prescription, preserved verbatim. */
  original: { planWorkoutId: string } & RowState;
  identity: WorkoutIdentityChange;
  stimulusPreservation: StimulusPreservation;
  optionId: string;
  moveKind: RescheduleMoveKind;
  newDateISO: string;
  edits: RescheduleRowEdit[];
  /** RS-6 · everything undo needs, and nothing it does not. */
  undo: { edits: RescheduleRowEdit[] };
}

export type RecommendOutcome =
  | { ok: true; recommendation: RescheduleRecommendation }
  | {
      ok: false;
      code: 'no_plan' | 'not_found' | 'bad_request' | 'sealed' | 'immovable';
      reason: string;
    };

export type ApplyOutcome =
  | { ok: true; decision: RescheduleDecision; summary: RescheduleSummary }
  | {
      ok: false;
      code: 'no_plan' | 'not_found' | 'bad_request' | 'plan_moved' | 'rejected'
          | 'sealed' | 'immovable' | 'no_record_table';
      reason: string;
      violations?: string[];
    };

/** RS-8 · what the runner reads AFTER approving. */
export interface RescheduleSummary {
  headline: string;
  whatMoved: string[];
  whatIsUnchanged: string[];
  why: string;
  /** Any instruction for the rearranged days. Empty when there is none to give. */
  instructions: string[];
  undoAvailable: true;
  decisionId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// small date + shape helpers
// ─────────────────────────────────────────────────────────────────────────────

const DOW_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const roundHalf = (n: number): number => Math.round(n * 2) / 2;

export const isISODate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

export function dowOfISO(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/**
 * Is this session one the plan treats as DEMANDING for separation purposes?
 *
 * A shakeout is a quality-flagged two-miler the day before a race; counting it
 * as demanding would make every race week look illegal. A rest day obviously is
 * not. Everything else carrying a quality or long flag is.
 */
export function isDemanding(d: Pick<PlanDay, 'type' | 'isQuality' | 'isLong' | 'distanceMi'>): boolean {
  if (d.type === 'rest' || d.type === 'shakeout' || d.type === 'race_week_tuneup') return false;
  return Boolean(d.isQuality || d.isLong) && d.distanceMi > 0;
}

/**
 * TWO QUANTITIES, TWO NAMES.  (Rule 16)
 *
 * The first version of this module had one predicate, `isMarathonSpecific`,
 * answering both questions below, and it was wrong in a way the falsification
 * pass exposed: it returned true for ANY long run carrying a fuelling ladder,
 * so a 10-mile fuelled long run demanded the same two recovery days as a
 * 20-mile marathon-pace rehearsal. Q32 grades recovery by DISTANCE (`<~16 mi`
 * gets one day) and Q35 forbids splitting on the basis of what a split
 * DESTROYS. Those are not the same property of a run.
 *
 * · A FUELLING LADDER is what a split destroys. Two shorter runs cannot
 *   rehearse taking gels at mile 13. This is Q35's question.
 * · MARATHON-PACE WORK is what costs recovery. A sustained block at race
 *   effort inside a long run is the thing that needs two easy days after it.
 *   This is Q32's question.
 *
 * A run can carry either without the other, and the live 15-miler does exactly
 * that: `fuel_mi [5, 9, 13]` and no marathon-pace segment.
 */
export function carriesFuellingLadder(d: Pick<PlanDay, 'spec'>): boolean {
  const spec = (d.spec ?? {}) as Record<string, unknown>;
  return Array.isArray(spec.fuel_mi) && (spec.fuel_mi as unknown[]).length > 0;
}

export function carriesMarathonPaceWork(d: Pick<PlanDay, 'spec' | 'subLabel' | 'type'>): boolean {
  const spec = (d.spec ?? {}) as Record<string, unknown>;
  if (spec.finish_pace_s_per_mi != null || Array.isArray(spec.finish_segments)) return true;
  const kind = String(spec.kind ?? '');
  if (kind === 'mp' || kind === 'marathon_pace' || kind === 'long_with_mp') return true;
  const label = ` ${String(d.subLabel ?? '')} ${d.type} `.toLowerCase();
  return label.includes('marathon pace') || label.includes(' mp ') || label.includes('mp block');
}

/** The session family, which decides the search window (Q31). */
export function familyOf(d: Pick<PlanDay, 'isLong' | 'isQuality'>): 'long' | 'quality' | 'easy' {
  if (d.isLong) return 'long';
  if (d.isQuality) return 'quality';
  return 'easy';
}

/**
 * The session's NAME, without its distance.
 *
 * `labelOf` bakes the miles into the string ("15 mi long run"), which is right
 * in a sentence and wrong beside a distance: the phone drew "15 mi · 15 mi long
 * run" (seen on device, 2026-09-02). The two are different quantities and now
 * have different names (Rule 16), and the miles are printed once (Rule 17).
 */
export function nameOf(d: PlanDay): string {
  if (d.type === 'rest') return 'rest';
  if (d.type === 'race') return 'race';
  if (d.isLong) return 'long run';
  if (d.isQuality) return `${d.type} session`;
  return 'easy run';
}

/** A human label for a prescribed day. One quantity, one name (Rule 16). */
export function labelOf(d: PlanDay | RowState): string {
  if (d.type === 'rest') return 'rest';
  if (d.type === 'race') return 'race';
  if (d.isLong) return `${round1(d.distanceMi)} mi long run`;
  if (d.isQuality) return `${d.type} session`;
  return `${round1(d.distanceMi)} mi easy`;
}

/** What the session is FOR, in the coach's words. Shown on every option (RS-4). */
export function purposeOf(d: PlanDay): string {
  if (d.isLong && carriesMarathonPaceWork(d)) {
    return 'Continuous time on feet with a block at race effort inside it. Marathon-specific work.';
  }
  if (d.isLong && carriesFuellingLadder(d)) {
    return 'Continuous time on feet with the fuelling ladder rehearsed. Marathon-specific durability.';
  }
  if (d.isLong) return 'Continuous aerobic durability. Time on feet is the stimulus.';
  if (d.type === 'intervals') return 'High-intensity capacity. Repeatable hard efforts with full recovery.';
  if (d.type === 'threshold' || d.type === 'tempo') return 'Threshold capacity. Sustained work at controlled effort.';
  if (d.type === 'race') return 'A race. A real fitness read.';
  return 'Aerobic volume at conversational effort.';
}

const isRunnable = (d: { type: string; distanceMi: number }): boolean =>
  d.type !== 'rest' && d.distanceMi > 0;

const stateOf = (d: PlanDay): RowState => ({
  dateISO: d.dateISO, type: d.type, distanceMi: d.distanceMi,
  isQuality: d.isQuality, isLong: d.isLong, subLabel: d.subLabel,
  paceTargetSPerMi: d.paceTargetSPerMi, spec: d.spec,
});

/** The same prescription, on a different date. A pure move (Q40). */
const movedTo = (s: RowState, dateISO: string): RowState => ({ ...s, dateISO });

/**
 * Rest, on this date.
 *
 * `spec: null` is correct here and only here: `plan_workouts`'s
 * `workout_spec_required` CHECK exempts `rest`, `cross` and `strength`.
 */
const restOn = (dateISO: string): RowState => ({
  dateISO, type: 'rest', distanceMi: 0, isQuality: false, isLong: false,
  subLabel: 'REST', paceTargetSPerMi: null, spec: null,
});

/**
 * An easy run on this date.
 *
 * The spec is `{ kind: 'easy' }` and never null, because
 * `workout_spec_required` demands a non-null spec on every non-rest row. A
 * kind-only spec is the shape production already carries for a downgraded row;
 * it deliberately does NOT invent a pace band, because this module has no
 * business asserting a pace and `recompute-paces` owns that question.
 */
const easyOn = (dateISO: string, distanceMi: number, from: RowState): RowState => ({
  dateISO,
  type: 'easy',
  distanceMi: roundHalf(distanceMi),
  isQuality: false,
  isLong: false,
  subLabel: 'EASY',
  // Keep the easy pace target if the row already had one; otherwise leave it
  // for the pace owner rather than guessing a number here.
  paceTargetSPerMi: from.type === 'easy' ? from.paceTargetSPerMi : null,
  spec: { kind: 'easy' },
});

// ─────────────────────────────────────────────────────────────────────────────
// week roles · protect the PURPOSE, not the label  (Q34)
// ─────────────────────────────────────────────────────────────────────────────

export interface RaceEntry {
  slug: string;
  name: string;
  dateISO: string;
  priority: 'A' | 'B' | 'C' | null;
  distanceMi: number | null;
}

export interface WeekRole {
  week: PlanWeek;
  isCutback: boolean;
  isTaper: boolean;
  /**
   * Resolved from the RACE CALENDAR, not from `plan_weeks.is_race_week`.
   *
   * Verified against production on 2026-09-02: the week starting 2026-09-07,
   * which ENDS on the Santa Monica 10k, carries `is_race_week = false`. Q34's
   * instruction is "protect the PURPOSE, not the label", and this row is the
   * case that instruction was written for.
   */
  race: RaceEntry | null;
}

/**
 * Load the runner's race calendar: date and priority only.
 *
 * Reported rather than hidden: there is no shared race-calendar loader in
 * `lib/plan` — `adapt.ts` issues four separate `FROM races` reads of its own,
 * and this is a fifth. It should be consolidated with them by whoever owns that
 * file. It is NOT a second answer to anything `lib/race` owns: nothing here
 * reads a result, a finish time, a goal or a projection.
 */
export async function loadRaceCalendar(
  userUuid: string,
  client: { query: typeof pool.query } = pool,
): Promise<RaceEntry[]> {
  const res = await client.query<{
    slug: string; name: string | null; date_iso: string | null;
    priority: string | null; distance_mi: string | null;
  }>(
    `SELECT slug,
            meta->>'name'       AS name,
            meta->>'date'       AS date_iso,
            meta->>'priority'   AS priority,
            meta->>'distanceMi' AS distance_mi
       FROM races
      WHERE user_uuid = $1::uuid
      ORDER BY meta->>'date' ASC`,
    [userUuid],
  );
  const out: RaceEntry[] = [];
  for (const r of res.rows) {
    if (!isISODate(r.date_iso)) continue;
    const p = r.priority;
    out.push({
      slug: r.slug,
      name: r.name ?? r.slug,
      dateISO: r.date_iso,
      priority: p === 'A' || p === 'B' || p === 'C' ? p : null,
      distanceMi: r.distance_mi != null && Number.isFinite(Number(r.distance_mi))
        ? Number(r.distance_mi) : null,
    });
  }
  return out;
}

const TAPER_PHASES = new Set(['TAPER', 'RACE WEEK', 'PEAK/TAPER', 'RACE-WEEK']);

export function weekRolesOf(shape: PlanShape, races: readonly RaceEntry[]): Map<string, WeekRole> {
  const out = new Map<string, WeekRole>();
  for (const w of shape.weeks) {
    const endISO = w.days.length ? w.days[w.days.length - 1].dateISO : w.startISO;
    const race = races.find((r) => r.dateISO >= w.startISO && r.dateISO <= endISO) ?? null;
    out.set(w.id, {
      week: w,
      isCutback: Boolean(w.isCutback),
      isTaper: TAPER_PHASES.has(String(w.phase ?? '').toUpperCase()),
      race,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// the timeline · date-linear, so a move can cross a week boundary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every prescribed day in the plan, in date order, indexed by date.
 *
 * "Calendar weeks are not physiologically sacred." A Sunday long run moving to
 * Monday must be judged on rolling load and recovery spacing, and neither can
 * be read from a per-week structure. Every physiological question in this
 * module is asked of this timeline; the per-week view is used only to REPORT
 * what a week total does, because that is what he reads.
 */
export interface Timeline {
  byDate: Map<string, PlanDay>;
  byId: Map<string, PlanDay>;
  dates: string[];
  weekIdOfDate: Map<string, string>;
}

export function timelineOf(shape: PlanShape): Timeline {
  const byDate = new Map<string, PlanDay>();
  const byId = new Map<string, PlanDay>();
  const weekIdOfDate = new Map<string, string>();
  for (const w of shape.weeks) {
    for (const d of w.days) {
      byDate.set(d.dateISO, d);
      byId.set(d.id, d);
      weekIdOfDate.set(d.dateISO, w.id);
    }
  }
  return { byDate, byId, dates: [...byDate.keys()].sort(), weekIdOfDate };
}

/**
 * The timeline with an option's edits applied, keyed by the date each row ENDS
 * UP on. Pure; the input is untouched.
 *
 * Because every edit set is a permutation of dates plus in-place changes, this
 * cannot silently drop or duplicate a day: rows vacate their `before.dateISO`
 * and land on their `after.dateISO`, and `assertPermutation` proves the two
 * multisets are equal before anything is offered.
 */
export function applyEditsToTimeline(
  tl: Timeline, edits: readonly RescheduleRowEdit[],
): Map<string, PlanDay> {
  const out = new Map(tl.byDate);
  for (const e of edits) out.delete(e.before.dateISO);
  for (const e of edits) {
    const base = tl.byId.get(e.planWorkoutId);
    if (!base) continue;
    out.set(e.after.dateISO, {
      ...base,
      dateISO: e.after.dateISO,
      dow: dowOfISO(e.after.dateISO),
      type: e.after.type,
      distanceMi: e.after.distanceMi,
      isQuality: e.after.isQuality,
      isLong: e.after.isLong,
      subLabel: e.after.subLabel,
      paceTargetSPerMi: e.after.paceTargetSPerMi,
      spec: e.after.spec,
    });
  }
  return out;
}

/**
 * "never duplicate or lose a workout" — checked, not asserted (Rule 20).
 *
 * Returns null when the edit set's before-dates and after-dates are the same
 * multiset and no row is edited twice. A non-null string is a bug in candidate
 * construction and disqualifies the candidate outright.
 */
export function permutationFault(edits: readonly RescheduleRowEdit[]): string | null {
  const ids = new Set<string>();
  for (const e of edits) {
    if (ids.has(e.planWorkoutId)) return `row ${e.planWorkoutId} is edited twice`;
    ids.add(e.planWorkoutId);
  }
  const before = edits.map((e) => e.before.dateISO).sort();
  const after = edits.map((e) => e.after.dateISO).sort();
  if (before.length !== after.length) return 'edit count mismatch';
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) {
      return `dates are not a permutation: ${before.join(',')} vs ${after.join(',')}`;
    }
  }
  return null;
}

/** Trailing 7-day mileage ending on `iso`, inclusive. Continuous by construction. */
export function rolling7(days: Map<string, PlanDay>, iso: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = days.get(addDaysISO(iso, -i));
    if (d) sum += d.distanceMi;
  }
  return round1(sum);
}

/**
 * Every separation reading between consecutive demanding sessions in a window.
 *
 * ONE quantity, ONE name, computed ONCE (Rule 16). Date-linear, and therefore
 * able to see across a week boundary, which `stimulusGapOk`'s modulo-7 walk
 * structurally cannot.
 */
export function separationFindings(
  days: Map<string, PlanDay>, fromISO: string, toISO: string,
): SeparationFinding[] {
  const hard: PlanDay[] = [];
  for (let iso = fromISO; iso <= toISO; iso = addDaysISO(iso, 1)) {
    const d = days.get(iso);
    if (d && isDemanding(d)) hard.push(d);
  }
  hard.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
  const out: SeparationFinding[] = [];
  for (let i = 0; i + 1 < hard.length; i++) {
    const a = hard[i];
    const b = hard[i + 1];
    const gap = daysBetweenISO(a.dateISO, b.dateISO);
    const intervening = Math.max(0, gap - 1);
    const required = requiredRecoveryDaysAfter(a);
    out.push({
      earlierISO: a.dateISO, earlierLabel: labelOf(a),
      laterISO: b.dateISO, laterLabel: labelOf(b),
      interveningDays: intervening,
      requiredDays: required,
      deficitDays: Math.max(0, required - intervening),
      nominalHours: gap * 24,
    });
  }
  return out;
}

export const totalDeficit = (f: readonly SeparationFinding[]): number =>
  f.reduce((s, x) => s + x.deficitDays, 0);

// ─────────────────────────────────────────────────────────────────────────────
// dosing · priced BEFORE the boundary, because the boundary will not price it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Daniels' weekly dosing caps, checked before an option is offered.
 *
 * `validateComposedPlan` treats §10 as advisory and `mutatePlan` does not
 * request the `onDosing` callback, so a dosing breach would COMMIT quietly.
 * `replan-scenarios.ts` closes the same hole the same way for the same reason.
 * An option carrying an INTRODUCED enforced breach is disqualified, not merely
 * captioned.
 *
 * DIFFERENTIAL, like `mutatePlan` itself: a breach the week already carried is
 * not this reschedule's fault, and refusing every option on an inherited
 * violation would make the feature go dark on exactly the plans that need it.
 * That is the difference between a boundary and a booby trap.
 *
 * ─── AND DIFFERENTIAL ON THE DOSE, NOT ON THE SHARE ─────────────────────────
 *
 * Found by running this against the live case, and it disqualified EVERY
 * option on the first pass. Daniels' cap is a SHARE of weekly mileage, so
 * moving a 15-mile long run out of a 45-mile week leaves the week at 30 miles
 * with its threshold session untouched — and 4 miles of T goes from 8.9% to
 * 13.3% without one yard of threshold work being added or moved.
 *
 * Refusing on that is the booby trap in its purest form: the reschedule is
 * blamed for a ratio it moved only the DENOMINATOR of, and the runner is told
 * he cannot move his long run because of a session he did not touch.
 *
 * So the split is on the DOSE. A finding whose miles-at-pace actually ROSE is
 * this reschedule's doing and disqualifies the option. A finding that appeared
 * only because the week got smaller is reported as a TRADEOFF and shown, never
 * swallowed (Rule 11: the fact is real, it is just not a refusal).
 */
export interface DosingReading {
  /** The reschedule added intensity. Disqualifying. */
  introduced: DosingFinding[];
  /** The share rose because the week shrank. Reported, never blocking. */
  denominatorOnly: DosingFinding[];
}

export function dosingBreachesOf(
  shape: PlanShape, tl: Timeline, edits: readonly RescheduleRowEdit[],
  roles: Map<string, WeekRole>,
): DosingReading {
  const after = applyEditsToTimeline(tl, edits);
  const touched = new Set<string>();
  for (const e of edits) {
    touched.add(tl.weekIdOfDate.get(e.before.dateISO) ?? '');
    touched.add(tl.weekIdOfDate.get(e.after.dateISO) ?? '');
  }
  const weekOf = (w: PlanWeek, use: Map<string, PlanDay> | null): DosingWeek => ({
    startISO: w.startISO,
    phase: w.phase,
    // Protect the PURPOSE, not the label (Q34): dosing's race-week relief must
    // follow the race calendar, since `is_race_week` is demonstrably false on a
    // production week that ENDS on a race.
    isRaceWeek: Boolean(w.isRaceWeek) || Boolean(roles.get(w.id)?.race),
    days: w.days.map((d) => {
      const src = use ? use.get(d.dateISO) : d;
      if (!src) return { type: 'rest', distanceMi: 0, subLabel: 'REST', isLong: false };
      return {
        type: src.type, distanceMi: src.distanceMi,
        subLabel: src.subLabel ?? null, isLong: Boolean(src.isLong),
      };
    }),
  });

  // Did this option put MORE quality mileage into the week than it took out?
  // `weekDosingFindings` reports breaches only, so a week that was under the
  // cap before reports nothing and cannot supply a prior dose to compare
  // against. The edits can, and they answer the question exactly: intensity
  // arrives in a week only when a quality row lands in it.
  const qualityDelta = (weekId: string): number => {
    let delta = 0;
    for (const e of edits) {
      if (tl.weekIdOfDate.get(e.after.dateISO) === weekId && e.after.isQuality) {
        delta += e.after.distanceMi;
      }
      if (tl.weekIdOfDate.get(e.before.dateISO) === weekId && e.before.isQuality) {
        delta -= e.before.distanceMi;
      }
    }
    return delta;
  };

  const out: DosingReading = { introduced: [], denominatorOnly: [] };
  for (const w of shape.weeks) {
    if (!touched.has(w.id)) continue;
    const known = new Set(
      weekDosingFindings(weekOf(w, null))
        .filter((f) => f.enforced)
        .map((f) => `${f.pace}|${f.scope}|${f.basis}`),
    );
    const gained = qualityDelta(w.id) > 0.001;
    for (const f of weekDosingFindings(weekOf(w, after))) {
      if (!f.enforced) continue;
      if (known.has(`${f.pace}|${f.scope}|${f.basis}`)) continue;   // inherited
      if (gained) out.introduced.push(f); else out.denominatorOnly.push(f);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// candidate construction
// ─────────────────────────────────────────────────────────────────────────────

/** Is this date usable at all, and if not, why? Discrete facts only (Rule 9). */
export function dateVerdict(opts: {
  dateISO: string;
  todayISO: string;
  tl: Timeline;
  roles: Map<string, WeekRole>;
  constraint: AvailabilityConstraint;
  sealed: ReadonlySet<string>;
  movingIsDemanding: boolean;
}): RescheduleRefusal | null {
  const { dateISO, todayISO, tl, roles, constraint, sealed, movingIsDemanding } = opts;
  if (dateISO <= todayISO) {
    return {
      dateISO, cause: 'IN_THE_PAST',
      reason: 'That day has already been. A day already gone is a run you did or did not do.',
    };
  }
  const day = tl.byDate.get(dateISO);
  if (!day) return { dateISO, cause: 'OUTSIDE_PLAN', reason: 'That day is outside this training block.' };
  if (sealed.has(dateISO)) {
    return { dateISO, cause: 'DAY_SEALED', reason: 'You have already run that day. Completed days do not change.' };
  }
  if (day.type === 'race') {
    return { dateISO, cause: 'RACE_DAY', reason: 'That is a race day. The race does not move and nothing moves onto it.' };
  }
  if (constraint.kind === 'UNAVAILABLE_DATES' && constraint.dates.includes(dateISO)) {
    return { dateISO, cause: 'RUNNER_UNAVAILABLE', reason: 'You said you cannot run that day.' };
  }
  if (constraint.kind === 'AVAILABLE_DATES' && !constraint.dates.includes(dateISO)) {
    return { dateISO, cause: 'RUNNER_UNAVAILABLE', reason: 'That day is not one of the days you said you can run.' };
  }
  const role = roles.get(tl.weekIdOfDate.get(dateISO) ?? '');
  if (role && movingIsDemanding) {
    // Q34 · the taper is absolute. No importing long-run or quality load, ever.
    if (role.isTaper) {
      return {
        dateISO, cause: 'PROTECTED_WEEK',
        reason: 'That week is the taper. Long runs and quality do not move into a taper.',
      };
    }
    // Q34 · an A-race week takes no additional long or quality work.
    if (role.race?.priority === 'A') {
      return {
        dateISO, cause: 'PROTECTED_WEEK',
        reason: `That week holds ${role.race.name}, your A race. No extra long or quality work moves into it.`,
      };
    }
  }
  return null;
}

interface Candidate {
  moveKind: RescheduleMoveKind;
  newDateISO: string;
  edits: RescheduleRowEdit[];
  distanceMi: number;
  identity: WorkoutIdentityChange;
  preservation: StimulusPreservation;
  displacedQualityLoss: number;
  displacedQualityNote: string | null;
  droppedMi: number;
  notes: string[];
}

/**
 * Build one TRANSACTION: move `target` to `newDateISO`, then repair whatever
 * that breaks, in the preservation order. Returns null when the arrangement
 * cannot be built.
 *
 * The surrounding training is evaluated as ONE transaction, which is the whole
 * of "moving Sunday to Monday may require Tuesday's quality to move". That
 * session is PRESERVED rather than deleted wherever a defensible date exists.
 */
type CandidateOutcome = Candidate | { refusal: string };

function buildCandidate(opts: {
  target: PlanDay;
  newDateISO: string;
  tl: Timeline;
  roles: Map<string, WeekRole>;
  todayISO: string;
  constraint: AvailabilityConstraint;
  sealed: ReadonlySet<string>;
  shortenToMi?: number;
}): CandidateOutcome {
  const { target, newDateISO, tl, roles, todayISO, constraint, sealed, shortenToMi } = opts;
  const dest = tl.byDate.get(newDateISO);
  if (!dest || dest.id === target.id) return { refusal: 'That is the day it is already on.' };

  const edits: RescheduleRowEdit[] = [];
  const notes: string[] = [];
  let droppedMi = 0;
  let displacedQualityLossSeed = 0;
  let displacedQualityNoteSeed: string | null = null;

  const movedMi = shortenToMi != null ? roundHalf(shortenToMi) : target.distanceMi;
  const shortened = movedMi < target.distanceMi;

  // 1 · THE SESSION MOVES. Same row id, new date. Q40's "same instance".
  // A shortened run cannot rehearse a gel at mile 13 if it ends at mile 11.
  // Truncating the ladder is part of the reduction, not a separate decision,
  // and leaving it intact would print an instruction the run cannot carry.
  const shortenedSpec = (): Record<string, unknown> | null => {
    if (!shortened || target.spec == null) return target.spec;
    const spec = { ...target.spec } as Record<string, unknown>;
    if (Array.isArray(spec.fuel_mi)) {
      spec.fuel_mi = (spec.fuel_mi as number[]).filter((mi) => mi <= movedMi);
    }
    return spec;
  };
  const targetAfter: RowState = {
    ...movedTo(stateOf(target), newDateISO),
    distanceMi: movedMi,
    spec: shortenedSpec(),
  };
  edits.push({
    planWorkoutId: target.id,
    before: stateOf(target),
    after: targetAfter,
    why: shortened
      ? `Your long run moves to ${DOW_NAME[dowOfISO(newDateISO)]} ${newDateISO}, cut to ${round1(movedMi)} mi.`
      : `Your ${labelOf(target)} moves to ${DOW_NAME[dowOfISO(newDateISO)]} ${newDateISO}.`,
  });

  // 2 · THE ROW THAT WAS THERE TAKES THE VACATED DATE. A straight date swap:
  //     no insert, no delete, both instance identities intact, and the vacated
  //     day always ends up carrying a PRESCRIBED row, so it can never read as
  //     unrun prescribed training.
  const destOnOldDate = movedTo(stateOf(dest), target.dateISO);
  if (isRunnable(dest)) {
    const oldDateUsable =
      !sealed.has(target.dateISO)
      && target.dateISO > todayISO
      && !(constraint.kind === 'UNAVAILABLE_DATES' && constraint.dates.includes(target.dateISO))
      && !(constraint.kind === 'AVAILABLE_DATES' && !constraint.dates.includes(target.dateISO));

    // "Do not sacrifice another key workout unless no viable arrangement
    // exists." A demanding session on the destination day may only be SWAPPED,
    // never stood down to make room. Without a usable vacated date there is no
    // swap, so this arrangement does not exist and is not offered.
    //
    // Caught by running the live case: the first version turned Thursday's
    // 10×60s hill session into a rest day to land the long run on it, reported
    // the loss as "6.5 mi of easy running", and ranked the result FIRST.
    if (isDemanding(dest) && !oldDateUsable) {
      return { refusal: `That day already holds your ${labelOf(dest)}, and with ${DOW_NAME[target.dow]} out there is nowhere for it to go.` };
    }

    if (oldDateUsable) {
      edits.push({
        planWorkoutId: dest.id,
        before: stateOf(dest),
        after: destOnOldDate,
        why: `${DOW_NAME[dest.dow]}'s ${labelOf(dest)} takes the slot the ${labelOf(target)} left.`,
      });
      notes.push(`${DOW_NAME[dest.dow]}'s ${labelOf(dest)} swaps onto ${DOW_NAME[target.dow]}.`);
      if (isDemanding(dest)) {
        // It survived, but it moved, and a moved quality session is not free.
        displacedQualityLossSeed = QUALITY_MOVED_LOSS;
        displacedQualityNoteSeed =
          `Your ${labelOf(dest)} swaps onto ${DOW_NAME[target.dow]} ${target.dateISO} rather than being dropped.`;
      }
    } else {
      // He cannot run the vacated day either. The miles come out, and that is
      // said out loud rather than absorbed.
      droppedMi += dest.distanceMi;
      edits.push({
        planWorkoutId: dest.id,
        before: stateOf(dest),
        after: restOn(target.dateISO),
        why: `${DOW_NAME[target.dow]} becomes rest.`,
      });
      notes.push(
        `The ${labelOf(dest)} on ${DOW_NAME[dest.dow]} comes out of the week. Those miles are not made up elsewhere.`,
      );
    }
  } else {
    edits.push({
      planWorkoutId: dest.id,
      before: stateOf(dest),
      after: restOn(target.dateISO),
      why: `${DOW_NAME[target.dow]} becomes rest.`,
    });
  }

  // 3 · REPAIR SEPARATION. Evaluate the arrangement, then fix what broke.
  const lo = target.dateISO < newDateISO ? target.dateISO : newDateISO;
  const hi = target.dateISO > newDateISO ? target.dateISO : newDateISO;
  const windowFrom = addDaysISO(lo, -9);
  const windowTo = addDaysISO(hi, 9);

  let displacedQualityLoss = displacedQualityLossSeed;
  let displacedQualityNote: string | null = displacedQualityNoteSeed;

  for (let pass = 0; pass < 3; pass++) {
    const after = applyEditsToTimeline(tl, edits);
    const findings = separationFindings(after, windowFrom, windowTo);
    const broken = findings.find((f) => f.deficitDays > 0);
    if (!broken) break;

    // Which side may move? Never the session the runner just placed, never a
    // race, never a sealed or past day.
    const victimISO = broken.earlierISO === newDateISO ? broken.laterISO
      : broken.laterISO === newDateISO ? broken.earlierISO
      : broken.laterISO;
    const victim = after.get(victimISO);
    if (!victim || victim.type === 'race' || sealed.has(victimISO) || victimISO <= todayISO) break;
    if (edits.some((e) => e.planWorkoutId === victim.id)) break;   // already spent

    // 3a · PRESERVE IT. Look for a defensible date inside the victim's OWN
    //      search window that resolves every deficit.
    const win = SEARCH_WINDOW_DAYS[familyOf(victim)];
    const tries: string[] = [];
    for (let k = 1; k <= win; k++) {
      tries.push(addDaysISO(victimISO, k));
      tries.push(addDaysISO(victimISO, -k));
    }
    let relocated = false;
    for (const cand of tries) {
      if (cand === newDateISO || cand === victimISO) continue;
      if (edits.some((e) => e.after.dateISO === cand)) continue;
      const v = dateVerdict({
        dateISO: cand, todayISO, tl, roles, constraint, sealed,
        movingIsDemanding: isDemanding(victim),
      });
      if (v) continue;
      const candDay = after.get(cand);
      if (!candDay || isRunnable(candDay) || candDay.id === victim.id) continue;
      const trial: RescheduleRowEdit[] = [
        ...edits,
        {
          planWorkoutId: victim.id,
          before: stateOf(victim),
          after: movedTo(stateOf(victim), cand),
          why: `Your ${labelOf(victim)} moves to ${DOW_NAME[dowOfISO(cand)]} so it is not stacked on the long run.`,
        },
        {
          planWorkoutId: candDay.id,
          before: stateOf(candDay),
          after: restOn(victimISO),
          why: `${DOW_NAME[dowOfISO(victimISO)]} becomes rest.`,
        },
      ];
      if (permutationFault(trial)) continue;
      if (totalDeficit(separationFindings(applyEditsToTimeline(tl, trial), windowFrom, windowTo)) === 0) {
        edits.length = 0;
        edits.push(...trial);
        displacedQualityLoss = Math.max(displacedQualityLoss, QUALITY_MOVED_LOSS);
        displacedQualityNote =
          `Your ${labelOf(victim)} moves to ${DOW_NAME[dowOfISO(cand)]} ${cand} rather than being dropped.`;
        relocated = true;
        break;
      }
    }
    if (relocated) continue;

    // 3b · STAND IT DOWN. Q33/Q34: a B or C race in that week normally SUPPLIES
    //      the week's principal quality stimulus, so the displaced session is
    //      not simply lost. Where no race supplies it, the loss is real and is
    //      priced as such.
    const role = roles.get(tl.weekIdOfDate.get(victimISO) ?? '');
    const raceSupplies = Boolean(role?.race && (role.race.priority === 'B' || role.race.priority === 'C'));
    edits.push({
      planWorkoutId: victim.id,
      before: stateOf(victim),
      after: easyOn(victimISO, Math.min(victim.distanceMi, 5), stateOf(victim)),
      why: raceSupplies
        ? `${DOW_NAME[dowOfISO(victimISO)]} goes easy. ${role!.race!.name} is this week's quality.`
        : `${DOW_NAME[dowOfISO(victimISO)]} goes easy so the long run is not stacked against it.`,
    });
    displacedQualityLoss = Math.max(
      displacedQualityLoss,
      raceSupplies ? QUALITY_REMOVED_LOSS_RACE_SUPPLIES : QUALITY_REMOVED_LOSS_PLAIN,
    );
    displacedQualityNote = raceSupplies
      ? `Your ${labelOf(victim)} comes out. ${role!.race!.name} on ${role!.race!.dateISO} supplies that week's quality stimulus, so the week is not left without one.`
      : `Your ${labelOf(victim)} comes out and is not replaced. That is a real loss.`;
  }

  const fault = permutationFault(edits);
  if (fault) return { refusal: 'That arrangement is not internally consistent.' };

  const identity: WorkoutIdentityChange = shortened
    ? {
        kind: 'REVISED_VERSION',
        changed: ['distance'],
        reductionReason:
          `Cut from ${round1(target.distanceMi)} mi to ${round1(movedMi)} mi so the week it lands in keeps most of the reduction it was authored with. Every fuelling point past ${round1(movedMi)} mi comes off with it.`,
      }
    : { kind: 'SAME_INSTANCE' };

  return {
    moveKind: shortened ? 'SHORTEN_AND_MOVE'
      : isRunnable(dest) ? 'SWAP_WITH_DAY'
      : newDateISO < target.dateISO ? 'MOVE_EARLIER' : 'MOVE_LATER',
    newDateISO,
    edits,
    distanceMi: movedMi,
    identity,
    preservation: shortened ? 'PARTIAL' : 'FULL',
    displacedQualityLoss,
    displacedQualityNote,
    droppedMi,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// splitting  (Q35)
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitEligibility { eligible: boolean; reason: string }

/**
 * May this long run be offered as a split?
 *
 * Q35: a split does not reproduce continuous time on feet, fuelling practice,
 * late-run mechanics or sustained marathon effort. For a durability or
 * marathon-specific long run the answer is NO, and the REFUSAL IS SHOWN rather
 * than the option being quietly withheld — a runner who is not told why an
 * obvious idea is missing assumes the app did not think of it. Where a split IS
 * offered, it is a SUBSTITUTED stimulus, ranked last, with the lost benefit
 * stated in the same sentence.
 */
export function splitEligibility(d: PlanDay): SplitEligibility {
  if (!d.isLong) return { eligible: false, reason: 'Only a long run raises the question of splitting.' };
  if (carriesFuellingLadder(d) || carriesMarathonPaceWork(d)) {
    return {
      eligible: false,
      reason: 'This long run rehearses race day. It carries a fuelling ladder, and two shorter runs do not reproduce continuous time on feet, fuelling practice or late-run mechanics. Splitting it would not preserve what it is for.',
    };
  }
  if (d.distanceMi >= 14) {
    return {
      eligible: false,
      reason: `At ${round1(d.distanceMi)} mi the point of this run is sustained durability. Two shorter runs are a different stimulus, not the same one rearranged.`,
    };
  }
  return {
    eligible: true,
    reason: 'This is general aerobic volume, so the miles can be split across two days. You lose the continuous-duration benefit, which is the main thing a long run trains.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// costing and ranking  (RS-3)
// ─────────────────────────────────────────────────────────────────────────────

function loadEffectOf(
  tl: Timeline, shape: PlanShape, roles: Map<string, WeekRole>,
  edits: readonly RescheduleRowEdit[], fromISO: string, toISO: string,
): LoadEffect {
  const after = applyEditsToTimeline(tl, edits);
  let peak = 0; let peakOn: string | null = null;
  let peakBefore = 0; let peakAfter = 0;
  for (let iso = fromISO; iso <= toISO; iso = addDaysISO(iso, 1)) {
    const b = rolling7(tl.byDate, iso);
    const a = rolling7(after, iso);
    if (Math.abs(a - b) > Math.abs(peak)) {
      peak = round1(a - b); peakOn = iso; peakBefore = b; peakAfter = a;
    }
  }
  const touched = new Set<string>();
  for (const e of edits) {
    touched.add(tl.weekIdOfDate.get(e.before.dateISO) ?? '');
    touched.add(tl.weekIdOfDate.get(e.after.dateISO) ?? '');
  }
  const weeks: LoadEffect['weeks'] = [];
  for (const w of shape.weeks) {
    if (!touched.has(w.id)) continue;
    const role = roles.get(w.id);
    let b = 0; let a = 0;
    for (const d of w.days) {
      b += d.distanceMi;
      a += after.get(d.dateISO)?.distanceMi ?? 0;
    }
    weeks.push({
      weekId: w.id, startISO: w.startISO, weekIdx: w.weekIdx,
      beforeMi: round1(b), afterMi: round1(a),
      isCutback: Boolean(role?.isCutback), isTaper: Boolean(role?.isTaper),
      racePriority: role?.race?.priority ?? null,
    });
  }
  return {
    peakRolling7DeltaMi: peak, peakRolling7OnISO: peakOn,
    rolling7BeforeMi: round1(peakBefore), rolling7AfterMi: round1(peakAfter),
    weeks,
  };
}

/**
 * The rolling-load cost. CONTINUOUS in miles, with no threshold anywhere: a
 * tenth of a mile moves the number slightly and can never flip a verdict.
 *
 * Two terms. The first is the honest physiological one, the peak change in the
 * trailing-7-day total relative to what it was — which is the reading that
 * makes "calendar weeks are not physiologically sacred" true rather than
 * merely stated, because a one-day shift across a Monday barely moves it. The
 * second prices IMPORT into a week whose authored purpose is reduction: a
 * cutback, or a week carrying a B race. Q34 says a cutback must still perform
 * its recovery function, so import is PRICED — never forbidden, because
 * forbidding it would be a threshold, and because a week total is a reporting
 * boundary rather than a physiological one.
 */
function rollingLoadCost(load: LoadEffect): number {
  const base = Math.abs(load.peakRolling7DeltaMi) / Math.max(load.rolling7BeforeMi, 1);
  let protectedImport = 0;
  for (const w of load.weeks) {
    if (w.afterMi <= w.beforeMi) continue;
    const gain = (w.afterMi - w.beforeMi) / Math.max(w.beforeMi, 1);
    if (w.isCutback) protectedImport += 2.0 * gain;
    if (w.racePriority === 'B') protectedImport += 1.0 * gain;
    if (w.racePriority === 'C') protectedImport += 0.4 * gain;
  }
  return base + protectedImport;
}

interface Costed {
  cost: RescheduleOption['cost'];
  separation: SeparationFinding[];
  load: LoadEffect;
  dosing: DosingReading;
}

function costOf(opts: {
  c: Candidate; target: PlanDay;
  tl: Timeline; shape: PlanShape; roles: Map<string, WeekRole>;
  windowFrom: string; windowTo: string;
}): Costed {
  const { c, target, tl, shape, roles, windowFrom, windowTo } = opts;
  const after = applyEditsToTimeline(tl, c.edits);
  const separation = separationFindings(after, windowFrom, windowTo);
  const load = loadEffectOf(tl, shape, roles, c.edits, windowFrom, windowTo);
  const dosing = dosingBreachesOf(shape, tl, c.edits, roles);

  const stimulus = c.preservation === 'SUBSTITUTED'
    ? SUBSTITUTED_STIMULUS_LOSS
    : Math.max(0, (target.distanceMi - c.distanceMi) / Math.max(target.distanceMi, 1));

  const continuity = c.droppedMi / Math.max(target.distanceMi, 1)
    + c.edits.filter((e) => e.before.type !== 'rest' && e.after.type === 'rest').length * 0.1;

  const touchedWeeks = new Set(
    c.edits.flatMap((e) => [
      tl.weekIdOfDate.get(e.before.dateISO) ?? '',
      tl.weekIdOfDate.get(e.after.dateISO) ?? '',
    ]),
  ).size;
  const blockDisturbance = c.edits.length + Math.max(0, touchedWeeks - 1) * 2;

  const sep = totalDeficit(separation);
  const rl = rollingLoadCost(load);

  const total = W_STIMULUS * stimulus + W_SEPARATION * sep
    + W_DISPLACED_QUALITY * c.displacedQualityLoss + W_CONTINUITY * continuity
    + W_ROLLING_LOAD * rl + W_BLOCK_DISTURBANCE * blockDisturbance;

  return {
    separation, load, dosing,
    cost: {
      stimulus: round3(W_STIMULUS * stimulus),
      separation: round3(W_SEPARATION * sep),
      displacedQuality: round3(W_DISPLACED_QUALITY * c.displacedQualityLoss),
      continuity: round3(W_CONTINUITY * continuity),
      rollingLoad: round3(W_ROLLING_LOAD * rl),
      blockDisturbance: round3(W_BLOCK_DISTURBANCE * blockDisturbance),
      total: round3(total),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// prose  (RS-4) · coach voice: short, direct, no hype, no em dashes
// ─────────────────────────────────────────────────────────────────────────────

function whyRankedHere(o: {
  rank: number; sepDeficit: number; displacedQualityCost: number;
  displacedQualityKind: 'none' | 'moved' | 'stood_down' | 'lost';
  preservation: StimulusPreservation; load: LoadEffect; isCompromise: boolean;
}): string {
  const bits: string[] = [];
  if (o.preservation === 'FULL') bits.push('the session is kept whole');
  else if (o.preservation === 'PARTIAL') bits.push('the session is cut short');
  else bits.push('the stimulus is substituted rather than preserved');

  if (o.sepDeficit === 0) bits.push('every hard day keeps its recovery');
  else bits.push(`${o.sepDeficit} day of recovery is missing between hard sessions`);

  if (o.displacedQualityKind === 'none') bits.push('nothing else moves');
  else if (o.displacedQualityKind === 'moved') bits.push('one other session moves to keep its spacing');
  else if (o.displacedQualityKind === 'stood_down') bits.push('one session stands down because the race supplies that stimulus');
  else bits.push('one key session is lost outright');

  const imported = o.load.weeks.find((w) => (w.isCutback || w.racePriority) && w.afterMi > w.beforeMi);
  if (imported) {
    bits.push(
      `${round1(imported.afterMi - imported.beforeMi)} mi lands in a week authored to be lighter`,
    );
  } else if (Math.abs(o.load.peakRolling7DeltaMi) < 0.05) {
    bits.push('the rolling seven-day load does not change');
  } else {
    bits.push(`the rolling seven-day load moves by ${round1(Math.abs(o.load.peakRolling7DeltaMi))} mi at its peak`);
  }

  const head = o.isCompromise
    ? `Ranked ${o.rank} as a compromise. Nothing available preserves everything, and this gives up the least`
    : `Ranked ${o.rank} because`;
  return `${head} ${o.isCompromise ? ': ' : ''}${bits.join(', ')}.`;
}

function trainingValueSentence(c: Candidate, target: PlanDay): string {
  if (c.preservation === 'FULL') {
    return `The full ${round1(target.distanceMi)} mi is run, at the same effort, for the same reason. ${purposeOf(target)}`;
  }
  if (c.preservation === 'PARTIAL') {
    return `${round1(c.distanceMi)} mi of the ${round1(target.distanceMi)} mi is run. The aerobic work is largely kept. The last ${round1(target.distanceMi - c.distanceMi)} mi of continuous time on feet is not, and that is the part this run exists for.`;
  }
  return 'This is a different stimulus standing in for the original. It is not the same run rearranged.';
}

// ─────────────────────────────────────────────────────────────────────────────
// RS-3 · recommend.  READS ONLY. NOTHING IS WRITTEN.
// ─────────────────────────────────────────────────────────────────────────────

export interface RecommendInput {
  userUuid: string;
  todayISO: string;
  /** The workout he cannot do, by its `plan_workouts` id, or by its date. */
  planWorkoutId?: string;
  dateISO?: string;
  constraint: AvailabilityConstraint;
  /** Q31 · an adjacent calendar week is reachable only on an explicit request. */
  allowAdjacentWeek?: boolean;
  client?: { query: typeof pool.query };
}

export async function recommendReschedule(input: RecommendInput): Promise<RecommendOutcome> {
  const client = input.client ?? pool;
  const shape = await loadPlanShape(input.userUuid, client);
  if (!shape) return { ok: false, code: 'no_plan', reason: 'There is no active training plan.' };

  const tl = timelineOf(shape);
  const target = input.planWorkoutId
    ? tl.byId.get(input.planWorkoutId) ?? null
    : input.dateISO ? tl.byDate.get(input.dateISO) ?? null : null;

  if (!target) return { ok: false, code: 'not_found', reason: 'There is nothing prescribed on that day.' };
  if (target.type === 'rest') {
    return { ok: false, code: 'immovable', reason: 'That day is already rest. There is nothing to move.' };
  }
  if (target.type === 'race') {
    return { ok: false, code: 'immovable', reason: 'A race does not move. Change the race date if the race moved.' };
  }
  if (target.dateISO <= input.todayISO) {
    // Q36 · "A past workout cannot literally be moved into the future."
    return {
      ok: false, code: 'sealed',
      reason: 'That day has already been. A past session is not rescheduled. If you want its value back, schedule a new session on a future day.',
    };
  }
  if (await isDaySealed(input.userUuid, target.dateISO)) {
    return { ok: false, code: 'sealed', reason: 'You have already run that day. Completed days do not change.' };
  }

  const races = await loadRaceCalendar(input.userUuid, client);
  const roles = weekRolesOf(shape, races);
  const family = familyOf(target);

  // Q31 · the search boundary. The adjacent week only on an explicit request.
  const spread = SEARCH_WINDOW_DAYS[family] + (input.allowAdjacentWeek ? 7 : 0);
  const considered: string[] = [];
  for (let k = -spread; k <= spread; k++) {
    if (k !== 0) considered.push(addDaysISO(target.dateISO, k));
  }
  considered.sort();

  // Sealed reads are per date and never guessed: `isDaySealed` seals when the
  // read FAILS, so a database problem cannot quietly authorise a rewrite of a
  // completed day (Rule 11).
  const sealed = new Set<string>();
  await Promise.all(considered.map(async (iso) => {
    if (await isDaySealed(input.userUuid, iso)) sealed.add(iso);
  }));

  const refusals: RescheduleRefusal[] = [];
  const viable: string[] = [];
  for (const iso of considered) {
    const v = dateVerdict({
      dateISO: iso, todayISO: input.todayISO, tl, roles,
      constraint: input.constraint, sealed, movingIsDemanding: isDemanding(target),
    });
    if (v) refusals.push(v); else viable.push(iso);
  }

  const windowFrom = addDaysISO(considered[0] ?? target.dateISO, -9);
  const windowTo = addDaysISO(considered[considered.length - 1] ?? target.dateISO, 9);

  const clean: Array<{ c: Candidate; costed: Costed }> = [];
  const compromises: Array<{ c: Candidate; costed: Costed }> = [];

  const consider = (built: CandidateOutcome, dateISO: string): void => {
    if ('refusal' in built) {
      refusals.push({ dateISO, cause: 'SEPARATION', reason: built.refusal });
      return;
    }
    const c = built;
    const costed = costOf({ c, target, tl, shape, roles, windowFrom, windowTo });
    if (costed.dosing.introduced.length > 0) {
      refusals.push({
        dateISO: c.newDateISO, cause: 'DOSING',
        reason: `Moving it there would add intensity past the weekly dosing caps. ${costed.dosing.introduced.map((f) => f.message).join(' · ')}`,
      });
      return;
    }
    if (totalDeficit(costed.separation) === 0) clean.push({ c, costed });
    else compromises.push({ c, costed });
  };

  for (const iso of viable) {
    consider(buildCandidate({
      target, newDateISO: iso, tl, roles, todayISO: input.todayISO,
      constraint: input.constraint, sealed,
    }), iso);
  }

  // ── SHORTENING · a last resort, and only where it answers something ───────
  //
  // RS-3 puts "shorten or replace" last, and it stays last: a shortened session
  // always carries the full stimulus cost, so it can never outrank an
  // arrangement that keeps the run whole.
  //
  // It is generated in exactly two situations, both of which are questions the
  // full-length move cannot answer:
  //
  //   1 · NOTHING KEPT IT WHOLE. Every viable date left a separation deficit.
  //       A shorter long run needs less recovery after it (Q32 grades by
  //       distance), so cutting it can be the difference between a legal week
  //       and no week.
  //   2 · THE ONLY DATES ARE IN A WEEK AUTHORED TO BE LIGHTER. Q34: a cutback
  //       "only if the resulting week still performs its recovery function",
  //       and "do not preserve one workout by destroying the planned
  //       reduction". Where the full move imports material load into a cutback
  //       or a B-race week, he is entitled to the other choice as well: the
  //       same day, less of the run, and the reduction largely intact.
  //
  // Without (2) this path was UNREACHABLE for the live case and for every case
  // the suite could express, which Rule 15 says is the same as untested. It was
  // found by falsifying `preservation: shortened ? 'PARTIAL' : 'FULL'` and
  // watching nothing fail.
  const shortenTargets: Array<{ iso: string; toMi: number }> = [];
  if (clean.length === 0) {
    for (const iso of viable) {
      for (const frac of [0.85, 0.7]) shortenTargets.push({ iso, toMi: target.distanceMi * frac });
    }
  } else {
    for (const x of clean) {
      const imported = x.costed.load.weeks.find(
        (w) => (w.isCutback || w.racePriority === 'B') && w.afterMi > w.beforeMi,
      );
      if (!imported) continue;
      const excess = imported.afterMi - imported.beforeMi;
      // Continuous in the excess, with a doctrine-shaped floor: never cut more
      // than a quarter off the run, because past that it is a different
      // session rather than a shortened one.
      const toMi = Math.max(0.75 * target.distanceMi, target.distanceMi - excess);
      if (toMi < target.distanceMi - 0.4) shortenTargets.push({ iso: x.c.newDateISO, toMi });
    }
  }
  const seenShort = new Set<string>();
  for (const t of shortenTargets) {
    const key = `${t.iso}|${roundHalf(t.toMi)}`;
    if (seenShort.has(key)) continue;
    seenShort.add(key);
    const built = buildCandidate({
      target, newDateISO: t.iso, tl, roles, todayISO: input.todayISO,
      constraint: input.constraint, sealed, shortenToMi: t.toMi,
    });
    if ('refusal' in built) continue;
    const costed = costOf({ c: built, target, tl, shape, roles, windowFrom, windowTo });
    if (costed.dosing.introduced.length > 0) continue;
    if (totalDeficit(costed.separation) === 0) clean.push({ c: built, costed });
    else compromises.push({ c: built, costed });
  }

  // "Do not sacrifice another key workout unless no viable arrangement
  // exists." A candidate that destroys a quality session outright is offered
  // ONLY when nothing else survives. This is a discrete fact about the
  // arrangement, not a threshold on a continuous quantity, so filtering here
  // does not create a Rule 9 cliff.
  const lossless = clean.filter((x) => x.c.displacedQualityLoss < QUALITY_REMOVED_LOSS_PLAIN);
  if (lossless.length > 0 && lossless.length < clean.length) {
    for (const dropped of clean.filter((x) => !lossless.includes(x))) {
      refusals.push({
        dateISO: dropped.c.newDateISO, cause: 'SEPARATION',
        reason: `Landing it there would cost you a key session outright, and there is an arrangement that does not. ${dropped.c.displacedQualityNote ?? ''}`.trim(),
      });
    }
    clean.length = 0;
    clean.push(...lossless);
  }

  const pool_ = clean.length ? clean : compromises;
  pool_.sort((a, b) => a.costed.cost.total - b.costed.cost.total
    || (a.c.newDateISO < b.c.newDateISO ? -1 : 1));

  const split = target.isLong ? splitEligibility(target) : null;
  const isCompromise = clean.length === 0;

  const options: RescheduleOption[] = pool_.slice(0, 5).map((x, i) => {
    const sepDeficit = totalDeficit(x.costed.separation);
    const tradeoffs: string[] = [];
    if (x.c.displacedQualityNote) tradeoffs.push(x.c.displacedQualityNote);
    tradeoffs.push(...x.c.notes);
    for (const w of x.costed.load.weeks) {
      if (w.afterMi > w.beforeMi && w.isCutback) {
        tradeoffs.push(
          `The week of ${w.startISO} was authored as a cutback at ${round1(w.beforeMi)} mi and becomes ${round1(w.afterMi)} mi. Its planned reduction is smaller than intended.`,
        );
      }
      if (w.afterMi > w.beforeMi && w.racePriority === 'B') {
        tradeoffs.push(
          `That load lands in the week of your B race. The lead-in is ${round1(w.afterMi - w.beforeMi)} mi heavier than the plan intended.`,
        );
      }
    }
    if (sepDeficit > 0) {
      const worst = x.costed.separation.find((s) => s.deficitDays > 0)!;
      tradeoffs.push(
        `${worst.earlierLabel} on ${worst.earlierISO} and ${worst.laterLabel} on ${worst.laterISO} sit ${worst.interveningDays} easy day apart where doctrine asks for ${worst.requiredDays}. That is the compromise.`,
      );
    }
    // Shown, not swallowed. The reschedule added no intensity, but the week it
    // took mileage out of is now a harder week by proportion, and he is
    // entitled to read that before choosing.
    const seenPaces = new Set<string>();
    for (const f of x.costed.dosing.denominatorOnly) {
      if (seenPaces.has(f.pace)) continue;
      seenPaces.add(f.pace);
      tradeoffs.push(
        `The week of ${f.weekStartISO ?? 'that week'} keeps all of its hard running on a smaller total, so it is a harder week by proportion than it was written to be. Nothing hard was added to it.`,
      );
    }

    return {
      id: optionId(shape.planId, target.id, x.c),
      rank: i + 1,
      moveKind: x.c.moveKind,
      newDateISO: x.c.newDateISO,
      newDow: dowOfISO(x.c.newDateISO),
      session: {
        label: labelOf(target), name: nameOf(target), type: target.type,
        distanceMi: x.c.distanceMi, originalDistanceMi: target.distanceMi,
        purpose: purposeOf(target),
      },
      identity: x.c.identity,
      stimulusPreservation: x.c.preservation,
      trainingValuePreserved: trainingValueSentence(x.c, target),
      moved: x.c.edits
        .slice()
        .sort((a, b) => (a.after.dateISO < b.after.dateISO ? -1 : 1))
        .map((e) => `${e.after.dateISO} · ${e.why}`),
      unchanged: unchangedLines(tl, x.c.edits, target, races, input.todayISO),
      separation: x.costed.separation,
      load: x.costed.load,
      downstream: downstreamOf(tl, shape, roles, races, x.c),
      tradeoffs,
      whyRankedHere: whyRankedHere({
        rank: i + 1, sepDeficit, displacedQualityCost: x.costed.cost.displacedQuality,
        displacedQualityKind:
          x.c.displacedQualityLoss === 0 ? 'none'
          : x.c.displacedQualityLoss <= QUALITY_MOVED_LOSS ? 'moved'
          : x.c.displacedQualityLoss <= QUALITY_REMOVED_LOSS_RACE_SUPPLIES ? 'stood_down'
          : 'lost',
        preservation: x.c.preservation, load: x.costed.load, isCompromise,
      }),
      isCompromise,
      dosingShareNotes: x.costed.dosing.denominatorOnly,
      edits: x.c.edits,
      cost: x.costed.cost,
    };
  });

  const availabilityUnknown = input.constraint.kind === 'UNKNOWN';
  if (availabilityUnknown) {
    refusals.push({
      dateISO: target.dateISO, cause: 'UNKNOWN_AVAILABILITY',
      reason: 'You have not said which days you can run. Every option below assumes only that this one day is out. Mark the days that work and the list will narrow.',
    });
  }

  return {
    ok: true,
    recommendation: {
      kind: 'RESCHEDULE',
      origin: 'RUNNER_CONSTRAINT',
      evidenceEffect: 'NONE',
      planId: shape.planId,
      target: {
        planWorkoutId: target.id, dateISO: target.dateISO, label: labelOf(target),
        type: target.type, distanceMi: target.distanceMi, purpose: purposeOf(target), family,
      },
      constraint: input.constraint,
      availabilityUnknown,
      considered,
      refusals,
      options,
      impossibility: options.length === 0
        ? 'No day inside the search window works. Widen the search, or mark more days you can run.'
        : isCompromise
          ? 'Nothing available preserves the whole week. Every option below gives something up, and each one says what.'
          : null,
      splitVerdict: split,
      token: proposalToken(shape, target.id, input.constraint),
    },
  };
}

function unchangedLines(
  tl: Timeline, edits: readonly RescheduleRowEdit[], target: PlanDay,
  races: readonly RaceEntry[], todayISO: string,
): string[] {
  const touched = new Set(edits.flatMap((e) => [e.before.dateISO, e.after.dateISO]));
  const out: string[] = [];
  const kept: string[] = [];
  for (let iso = addDaysISO(target.dateISO, -7); iso <= addDaysISO(target.dateISO, 14); iso = addDaysISO(iso, 1)) {
    const d = tl.byDate.get(iso);
    if (!d || touched.has(iso) || !isRunnable(d) || iso <= todayISO) continue;
    if (isDemanding(d)) kept.push(`${DOW_NAME[d.dow]} ${iso} · ${labelOf(d)}`);
  }
  if (kept.length) out.push(`These stay exactly where they are: ${kept.join(' · ')}.`);
  const nextRace = races.find((r) => r.dateISO > todayISO);
  if (nextRace) out.push(`${nextRace.name} on ${nextRace.dateISO} does not move.`);
  out.push('Your race goal, your paces and your heart-rate ceilings are untouched. This is a calendar change, not a training change.');
  return out;
}

function downstreamOf(
  tl: Timeline, shape: PlanShape, roles: Map<string, WeekRole>,
  races: readonly RaceEntry[], c: Candidate,
): DownstreamEffect {
  const touched = new Set(c.edits.flatMap((e) => [e.before.dateISO, e.after.dateISO]));
  // Read the AFTER state. Reading the pre-edit timeline reported the moved
  // session itself as "the next long run", which is the same run twice under
  // one name (Rule 16).
  const after = applyEditsToTimeline(tl, c.edits);
  let nextLong: DownstreamEffect['nextLongRun'] = null;
  for (const iso of tl.dates) {
    if (iso <= c.newDateISO) continue;
    const d = after.get(iso);
    if (d && d.isLong && d.type !== 'race') {
      nextLong = { dateISO: iso, distanceMi: d.distanceMi, changed: touched.has(iso) };
      break;
    }
  }
  const race = races.find((r) => r.dateISO > c.newDateISO) ?? null;
  let nextCutback: DownstreamEffect['nextCutbackWeek'] = null;
  for (const w of shape.weeks) {
    // `>= newDateISO` on the week's END, not `> newDateISO` on its START: a
    // move that lands ON the first day of a cutback week is precisely the case
    // the runner needs told about, and a start-date test skipped it.
    if (w.endISO < c.newDateISO) continue;
    if (roles.get(w.id)?.isCutback) {
      nextCutback = {
        startISO: w.startISO, weekIdx: w.weekIdx,
        touched: w.days.some((d) => touched.has(d.dateISO)),
      };
      break;
    }
  }
  const taperWeek = shape.weeks.find((w) => roles.get(w.id)?.isTaper) ?? null;
  return {
    nextLongRun: nextLong,
    nextRace: race ? {
      dateISO: race.dateISO, name: race.name, priority: race.priority,
      daysAfterMovedSession: daysBetweenISO(c.newDateISO, race.dateISO),
    } : null,
    nextCutbackWeek: nextCutback,
    taper: {
      startsISO: taperWeek?.startISO ?? null,
      touched: Boolean(taperWeek && taperWeek.days.some((d) => touched.has(d.dateISO))),
    },
  };
}

function optionId(planId: string, targetId: string, c: Candidate): string {
  return 'rso_' + createHash('sha256')
    .update([
      planId, targetId, c.moveKind, c.newDateISO, String(c.distanceMi),
      ...c.edits.map((e) => `${e.planWorkoutId}:${e.after.dateISO}:${e.after.type}:${e.after.distanceMi}`),
    ].join('|'))
    .digest('hex').slice(0, 16);
}

/**
 * The structural state the runner READ, hashed. An apply carrying a stale token
 * is refused. Same discipline as `/api/plan/change`'s proposal token: a change
 * applied to a plan the runner never read is, to him, indistinguishable from a
 * bug.
 */
export function proposalToken(
  shape: PlanShape, targetId: string, constraint: AvailabilityConstraint,
): string {
  const rows: string[] = [];
  for (const w of shape.weeks) {
    for (const d of w.days) {
      rows.push(`${d.id}|${d.dateISO}|${d.type}|${d.distanceMi}|${d.isQuality ? 1 : 0}|${d.isLong ? 1 : 0}`);
    }
  }
  const c = constraint.kind === 'UNKNOWN'
    ? 'UNKNOWN'
    : `${constraint.kind}:${[...constraint.dates].sort().join(',')}`;
  return createHash('sha256').update([shape.planId, targetId, c, ...rows].join('\n'))
    .digest('hex').slice(0, 24);
}

// ─────────────────────────────────────────────────────────────────────────────
// RS-5 · apply.  ONE OF THE TWO WRITERS IN THIS FILE.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Q40's absolute: "Never change the prescription after completion to convert an
 * undercompleted workout into FULL."
 *
 * Enforced by refusing, not by trusting. Every date an option touches is
 * re-checked for a completed run at APPLY time and not only at recommend time,
 * because a run can land between reading and approving.
 */
export async function assertNoPostCompletionRewrite(
  userUuid: string, dates: readonly string[],
): Promise<string | null> {
  for (const iso of [...new Set(dates)]) {
    if (await isDaySealed(userUuid, iso)) {
      return `You have already run ${iso}. A completed day is not rewritten, and a completed run is never re-scored against a changed prescription.`;
    }
  }
  return null;
}

export interface ApplyInput {
  userUuid: string;
  todayISO: string;
  planWorkoutId?: string;
  dateISO?: string;
  constraint: AvailabilityConstraint;
  optionId: string;
  token: string;
  allowAdjacentWeek?: boolean;
}

export async function applyReschedule(input: ApplyInput): Promise<ApplyOutcome> {
  // Re-derive rather than trust a blob the client handed back. The same request
  // produces the same options, so the confirm applies exactly what the propose
  // described.
  const rec = await recommendReschedule({
    userUuid: input.userUuid, todayISO: input.todayISO,
    planWorkoutId: input.planWorkoutId, dateISO: input.dateISO,
    constraint: input.constraint, allowAdjacentWeek: input.allowAdjacentWeek,
  });
  if (!rec.ok) return rec;
  const r = rec.recommendation;

  if (r.token !== input.token) {
    return {
      ok: false, code: 'plan_moved',
      reason: 'Your plan has changed since you read these options. Have another look before choosing.',
    };
  }
  const option = r.options.find((o) => o.id === input.optionId);
  if (!option) {
    return { ok: false, code: 'not_found', reason: 'That option is no longer on the list. Have another look.' };
  }

  const fault = permutationFault(option.edits);
  if (fault) {
    return { ok: false, code: 'rejected', reason: 'That option is not internally consistent and was not applied.', violations: [fault] };
  }

  const sealBlock = await assertNoPostCompletionRewrite(
    input.userUuid, option.edits.flatMap((e) => [e.before.dateISO, e.after.dateISO]),
  );
  if (sealBlock) return { ok: false, code: 'sealed', reason: sealBlock };

  const decisionId = 'rsd_' + createHash('sha256')
    .update([r.planId, r.target.planWorkoutId, option.id, input.todayISO].join('|'))
    .digest('hex').slice(0, 20);

  const originalEdit = option.edits.find((e) => e.planWorkoutId === r.target.planWorkoutId);
  const decision: RescheduleDecision = {
    kind: 'RESCHEDULE',
    origin: 'RUNNER_CONSTRAINT',
    evidenceEffect: 'NONE',
    decisionId,
    planId: r.planId,
    userUuid: input.userUuid,
    decidedAtISO: input.todayISO,
    constraint: input.constraint,
    original: {
      planWorkoutId: r.target.planWorkoutId,
      ...(originalEdit?.before ?? {
        dateISO: r.target.dateISO, type: r.target.type, distanceMi: r.target.distanceMi,
        isQuality: false, isLong: false, subLabel: null, paceTargetSPerMi: null, spec: null,
      }),
    },
    identity: option.identity,
    stimulusPreservation: option.stimulusPreservation,
    optionId: option.id,
    moveKind: option.moveKind,
    newDateISO: option.newDateISO,
    edits: option.edits,
    undo: { edits: option.edits },
  };

  let recordMissing = false;
  const res = await mutatePlan<RescheduleDecision>({
    userUuid: input.userUuid,
    source: 'plan/reschedule apply',
    todayISO: input.todayISO,
    planId: r.planId,
    touches: 'structural',
    detail: { decisionId, optionId: option.id, moveKind: option.moveKind },
    apply: async (tx, planId) => {
      await writeEdits(tx, planId, option.edits);
      try {
        await recordDecision(tx, decision);
      } catch (e) {
        if (e instanceof RescheduleRecordUnavailable) { recordMissing = true; }
        throw e;
      }
      return decision;
    },
  }).catch((e) => {
    if (e instanceof RescheduleRecordUnavailable || recordMissing) return null;
    throw e;
  });

  if (res === null || recordMissing) {
    return {
      ok: false, code: 'no_record_table',
      reason: 'The change was not made. This app cannot record a reschedule yet, and a reschedule with no record could not be explained or undone later.',
    };
  }

  if (!res.ok || !res.value) {
    return {
      ok: false, code: 'rejected',
      reason: res.violations.length
        ? 'That move would break the plan. Nothing was changed.'
        : 'That move could not be applied. Nothing was changed.',
      violations: res.violations,
    };
  }

  return { ok: true, decision: res.value, summary: summaryOf(r, option, res.value) };
}

/**
 * The row writes.
 *
 * `plan_id = $2` pins the statement to one plan, which is what ACTIVEPLAN-1
 * asks of every `plan_workouts` statement, and `week_id` is re-homed from the
 * week that owns the new date so a session that crosses a Monday is not left
 * counted in the week it left.
 *
 * There is no unique index on `(plan_id, date_iso)` (verified against
 * production 2026-09-02), so the two halves of a date swap may be issued in
 * either order inside the transaction without a transient collision.
 */
async function writeEdits(
  tx: PoolClient, planId: string, edits: readonly RescheduleRowEdit[],
): Promise<void> {
  for (const e of edits) {
    await tx.query(
      `UPDATE plan_workouts pw
          SET date_iso = $3,
              dow = $4,
              week_id = COALESCE(
                (SELECT w.id FROM plan_weeks w
                  WHERE w.plan_id = $2
                    AND $3 >= w.week_start_iso
                    AND $3 <  (w.week_start_iso::date + 7)::text
                  LIMIT 1),
                pw.week_id),
              type = $5,
              distance_mi = $6,
              is_quality = $7,
              is_long = $8,
              sub_label = $9,
              pace_target_s_per_mi = $10,
              workout_spec = $11::jsonb,
              original_date_iso = COALESCE(pw.original_date_iso, pw.date_iso),
              original_type = COALESCE(pw.original_type, pw.type),
              original_distance_mi = COALESCE(pw.original_distance_mi, pw.distance_mi),
              original_sub_label = COALESCE(pw.original_sub_label, pw.sub_label)
        WHERE pw.id = $1 AND pw.plan_id = $2`,
      [
        e.planWorkoutId, planId, e.after.dateISO, dowOfISO(e.after.dateISO),
        e.after.type, e.after.distanceMi, e.after.isQuality, e.after.isLong,
        e.after.subLabel, e.after.paceTargetSPerMi,
        e.after.spec == null ? null : JSON.stringify(e.after.spec),
      ],
    );
  }
}

/**
 * The reschedule's OWN record, in its OWN table.
 *
 * Deliberately not `plan_mutations`: that table is the adaptation seam's
 * record, carrying `trigger_kind` and `signal_snapshot`, and writing a
 * runner-supplied calendar constraint into it would collapse two decisions into
 * one row and make "has this engine ever pushed" unanswerable in exactly the
 * way Rule 21 describes.
 *
 * `db/migrations/163_plan_reschedules.sql` creates it. Per the migrations
 * README a CREATE TABLE migration may land in either order PROVIDED the code
 * naming it treats absence honestly. It does: this function throws a named
 * error, the boundary rolls the whole transaction back, and the runner is told
 * the change was NOT made. It does not proceed with an unrecorded mutation,
 * because a reschedule with no lineage cannot be undone and cannot answer
 * Q40's second question.
 */
export class RescheduleRecordUnavailable extends Error {
  constructor() {
    super('plan_reschedules table is not present');
    this.name = 'RescheduleRecordUnavailable';
  }
}

async function recordDecision(tx: PoolClient, d: RescheduleDecision): Promise<void> {
  try {
    await tx.query(
      `INSERT INTO plan_reschedules
         (id, user_uuid, plan_id, plan_workout_id, decided_at,
          kind, origin, move_kind, stimulus_preservation, identity_kind,
          original_date_iso, new_date_iso, decision)
       VALUES ($1, $2::uuid, $3, $4, now(),
               'RESCHEDULE', 'RUNNER_CONSTRAINT', $5, $6, $7,
               $8, $9, $10::jsonb)`,
      [
        d.decisionId, d.userUuid, d.planId, d.original.planWorkoutId,
        d.moveKind, d.stimulusPreservation, d.identity.kind,
        d.original.dateISO, d.newDateISO, JSON.stringify(d),
      ],
    );
  } catch (e) {
    if (/relation .*plan_reschedules.* does not exist/i.test(String((e as Error)?.message ?? ''))) {
      throw new RescheduleRecordUnavailable();
    }
    throw e;
  }
}

function summaryOf(
  r: RescheduleRecommendation, o: RescheduleOption, d: RescheduleDecision,
): RescheduleSummary {
  const instructions: string[] = [];
  if (o.identity.kind === 'REVISED_VERSION') {
    instructions.push(
      `Run ${round1(o.session.distanceMi)} mi, not ${round1(o.session.originalDistanceMi)}. The shorter run is what you are being asked for, and it is what you will be read against.`,
    );
  }
  for (const e of o.edits) {
    if (e.before.isQuality && e.after.type === 'easy') {
      instructions.push(
        `${e.after.dateISO} is now easy. Run it easy. It is not a shortened version of the session that came off.`,
      );
    }
  }
  if (o.separation.some((s) => s.interveningDays === 1)) {
    instructions.push('The day between your two hard sessions is a real easy day. Treat it as one.');
  }
  return {
    headline: `Your ${r.target.label} moves from ${DOW_NAME[dowOfISO(r.target.dateISO)]} ${r.target.dateISO} to ${DOW_NAME[o.newDow]} ${o.newDateISO}.`,
    whatMoved: o.moved,
    whatIsUnchanged: o.unchanged,
    why: `${o.whyRankedHere} ${o.trainingValuePreserved}`,
    instructions,
    undoAvailable: true,
    decisionId: d.decisionId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RS-6 · undo
// ─────────────────────────────────────────────────────────────────────────────

export type UndoOutcome =
  | { ok: true; decisionId: string; restored: number }
  | {
      ok: false;
      code: 'not_found' | 'sealed' | 'rejected' | 'already_undone' | 'read_failed';
      reason: string; violations?: string[];
    };

/**
 * Put it back. Exact, and it loses nothing: undo re-applies each edit's BEFORE
 * state, which is the state the row actually held, read at propose time and
 * stored verbatim on the decision. Undoing an undo would be the same statements
 * the other way round.
 *
 * It refuses on a sealed day for the same reason apply does. If he ran the new
 * date before undoing, the run is real and the prescription under it stays.
 */
export async function undoReschedule(opts: {
  userUuid: string; todayISO: string; decisionId: string;
  client?: { query: typeof pool.query };
}): Promise<UndoOutcome> {
  const client = opts.client ?? pool;

  // Rule 11 · "not on file" and "we could not read the file" are different
  // facts, and collapsing them here would be worse than usual: a swallowed
  // read makes an undo say the change never happened, over a plan that still
  // carries it. The catch returns a THIRD outcome rather than an empty set.
  let rec: { rows: Array<{ decision: RescheduleDecision; undone_at: string | null; plan_id: string }> };
  try {
    rec = await client.query<{ decision: RescheduleDecision; undone_at: string | null; plan_id: string }>(
      `SELECT decision, undone_at, plan_id FROM plan_reschedules
        WHERE id = $1 AND user_uuid = $2::uuid LIMIT 1`,
      [opts.decisionId, opts.userUuid],
    );
  } catch (e) {
    console.error('[plan/reschedule] undo · decision read UNREADABLE:', e);
    return {
      ok: false, code: 'read_failed',
      reason: 'We could not read that change to put it back. Your plan has not been touched. Try again.',
    };
  }

  const row = rec.rows[0];
  if (!row) return { ok: false, code: 'not_found', reason: 'That change is not on file.' };
  if (row.undone_at) return { ok: false, code: 'already_undone', reason: 'That change has already been put back.' };

  const d = row.decision;
  const block = await assertNoPostCompletionRewrite(
    opts.userUuid, d.undo.edits.flatMap((e) => [e.before.dateISO, e.after.dateISO]),
  );
  if (block) return { ok: false, code: 'sealed', reason: block };

  const res = await mutatePlan<number>({
    userUuid: opts.userUuid,
    source: 'plan/reschedule undo',
    todayISO: opts.todayISO,
    planId: row.plan_id,
    touches: 'structural',
    detail: { decisionId: opts.decisionId },
    apply: async (tx, planId) => {
      // The inverse edit set: after and before exchanged.
      await writeEdits(tx, planId, d.undo.edits.map((e) => ({
        planWorkoutId: e.planWorkoutId, before: e.after, after: e.before,
        why: 'Put back.',
      })));
      await tx.query(
        `UPDATE plan_reschedules SET undone_at = now() WHERE id = $1 AND user_uuid = $2::uuid`,
        [opts.decisionId, opts.userUuid],
      );
      return d.undo.edits.length;
    },
  });

  if (!res.ok || res.value == null) {
    return {
      ok: false, code: 'rejected',
      reason: 'Putting that back would break the plan as it now stands. Nothing was changed.',
      violations: res.violations,
    };
  }
  return { ok: true, decisionId: opts.decisionId, restored: res.value };
}
