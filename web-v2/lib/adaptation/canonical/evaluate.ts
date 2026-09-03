/**
 * lib/adaptation/canonical/evaluate.ts · THE ONE ENTRY POINT.
 *
 * `evaluateAdaptation(input) -> CanonicalEvaluation`
 *
 * Everything else in this directory is reachable only through this function.
 * One owning service per coaching decision, per
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §1, and one seam so
 * there is never a side door to argue about later.
 *
 * ── THIS FUNCTION IS PURE, AND THAT IS THE MUTATION GUARANTEE ──────────────
 *
 * It takes plain values and returns plain values. It opens no connection,
 * imports no database module, reads no environment, and touches no clock: even
 * "now" arrives as `evaluatedAtISO`. So the engine cannot write a plan row not
 * because it has been told not to, but because it has no means to. That is the
 * requirement as stated: structurally incapable, not carefully behaved.
 *
 * `_cannot_mutate.test.ts` proves it from source for every file here, and the
 * pre-existing `_zero_mutation_scan.test.ts` already walks this directory
 * recursively and applies the same two guards to it.
 *
 * ── A REFUSAL IS A SUCCESSFUL OUTPUT ───────────────────────────────────────
 *
 * This function never throws for missing or contradictory evidence, and never
 * returns an empty list. Every lever produces exactly one record on every call,
 * whatever the outcome. An engine that returns nothing when it cannot decide is
 * indistinguishable from an engine that was never called, and that ambiguity is
 * precisely how a zero-upgrade engine survived 309 production intents without
 * anyone noticing (CLAUDE.md Rule 21).
 *
 * ── CADENCE ────────────────────────────────────────────────────────────────
 *
 *     "Session-triggered evaluation updates evidence and asks whether a lever
 *      has new information. Weekly evaluation arbitrates plan-level changes."
 *
 * So a moving verdict reached at a session boundary is recorded in full and
 * then deferred to the weekly boundary. The evidence is not thrown away and the
 * proposal is not applied early. "Never during a session" needs no runtime
 * check because `EvaluationBoundary` has no member for it.
 *
 * ── RULE 22 · WHAT THE GATES OVER THIS FILE CANNOT FAIL ON ─────────────────
 *
 * They cannot fail on a plan diff that is well-formed but wrong. The diff is
 * built here from the lever's magnitude and the plan context handed in; nothing
 * re-derives what the affected sessions should actually contain, because
 * recomposition belongs to the plan composer and this engine is forbidden to
 * call it. A diff that names the right workouts and the wrong numbers would
 * pass every test in this directory.
 *
 * They also cannot fail on the input being assembled wrongly. Everything here
 * is downstream of whoever built the `CanonicalAdaptationInput`, and a loader
 * that quietly passed a taper week as an ordinary one would produce confident,
 * well-formed, wrong records.
 */
import { CANONICAL_ADAPTATION_CONTRACT_VERSION } from './contract-constants';
import {
  idempotencyKeyFor,
  NO_PLAN_DIFF,
  NON_MOVING_DECISIONS,
  type CanonicalDecisionRecord,
  type InvariantResult,
  type PlanDiff,
  type PlanDiffEntry,
  type RollbackInfo,
  type SuppressionNote,
} from './decision-record';
import type { CanonicalAdaptationInput, CanonicalLever } from './input';
import { CANONICAL_LEVERS } from './input';
import { evaluateThresholdPace } from './levers/threshold-pace';
import { evaluateWeeklyVolume } from './levers/weekly-volume';
import { evaluateLongRun } from './levers/long-run';
import type { LeverVerdict } from './levers/shared';
import { arbitrate, type ArbitratedVerdict } from './arbitration';
import { miText, paceText } from './levers/shared';

export interface CanonicalEvaluation {
  readonly contractVersion: typeof CANONICAL_ADAPTATION_CONTRACT_VERSION;
  readonly evaluatedAtISO: string;
  /** Exactly one record per lever, on every call, whatever the outcome. */
  readonly records: readonly CanonicalDecisionRecord[];
  /** Present so a reader can see the arbitration, not just its result. */
  readonly combinedDemandShare: number;
}

/**
 * The engine's one entry point.
 *
 * @param input Plain values only. See `input.ts` for what it cannot contain.
 * @param previouslyEmittedKeys Idempotency keys already raised. A record whose
 *        key appears here is suppressed rather than raised a second time,
 *        which is the contract's "never duplicate proposals from repeated
 *        ingestion of the same evidence".
 */
export function evaluateAdaptation(
  input: CanonicalAdaptationInput,
  previouslyEmittedKeys: ReadonlySet<string> = new Set(),
): CanonicalEvaluation {
  /* ── Rule 11 · a failed read is not a runner without evidence ──────────── */

  if (!input.readable) {
    return {
      contractVersion: CANONICAL_ADAPTATION_CONTRACT_VERSION,
      evaluatedAtISO: input.evaluatedAtISO,
      records: CANONICAL_LEVERS.map((lever) =>
        refusalRecord(
          input,
          lever,
          'The training data for this evaluation could not be read. That is not the same as '
          + 'a quiet training block, and it is not evidence for or against any change.',
          ['The underlying data being readable again, after which this evaluates normally.'],
          previouslyEmittedKeys,
        ),
      ),
      combinedDemandShare: 0,
    };
  }

  /* ── Each lever reaches its verdict independently ──────────────────────── */

  const verdicts: LeverVerdict[] = [
    evaluateWeeklyVolume({
      todayISO: input.evaluatedAtISO,
      currentWeeklyMi: input.belief.weeklyVolumeMi,
      weeks: input.weeks,
      keySessions: input.qualitySessions,
      longRuns: input.longRuns,
      nextWeekPrescribedMi: input.plan.nextWeekPrescribedMi,
      stepsTakenThisCycle: input.plan.stepsTakenThisCycle.WEEKLY_VOLUME,
    }),
    evaluateLongRun({
      todayISO: input.evaluatedAtISO,
      currentLongRunMi: input.belief.longRunMi,
      longRuns: input.longRuns,
      nextLongRunMi: input.plan.nextWeekLongRunMi,
      longestInPrior30DaysMi: longestInPrior30Days(input),
      coherentWithWeeklyVolume: longRunCoherent(input),
      weeksRemainingInBuild: weeksRemainingInBuild(input),
      collidesWithRaceOrTaper: collidesWithRaceOrTaper(input),
      stepsTakenThisCycle: input.plan.stepsTakenThisCycle.LONG_RUN,
    }),
    evaluateThresholdPace({
      todayISO: input.evaluatedAtISO,
      currentAnchorSecPerMi: input.belief.thresholdPaceSecPerMi,
      sessions: input.qualitySessions,
      anchorMovedToday: input.plan.anchorMovedTodayForLever.THRESHOLD_PACE,
    }),
  ];

  /* ── Plan-level arbitration ────────────────────────────────────────────── */

  const result = arbitrate({
    verdicts,
    baseWeeklyMi: input.plan.nextWeekPrescribedMi,
    baseLongRunMi: input.plan.nextWeekLongRunMi,
    baseQualityMinutes: input.plan.nextWeekQualityMinutes,
    nextBoundaryISO: nextBoundary(input),
  });

  const records = result.arbitrated.map((a) => toRecord(input, a, previouslyEmittedKeys));

  return {
    contractVersion: CANONICAL_ADAPTATION_CONTRACT_VERSION,
    evaluatedAtISO: input.evaluatedAtISO,
    records,
    combinedDemandShare: result.combinedShare,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * RECORD CONSTRUCTION
 * ═══════════════════════════════════════════════════════════════════════ */

function toRecord(
  input: CanonicalAdaptationInput,
  a: ArbitratedVerdict,
  previouslyEmittedKeys: ReadonlySet<string>,
): CanonicalDecisionRecord {
  const v = a.verdict;
  const key = idempotencyKeyFor({
    athleteId: input.athleteId,
    planVersion: input.planVersion,
    evidenceVersion: input.evidenceVersion,
    lever: v.lever,
    boundary: input.boundary,
  });

  const moves = !NON_MOVING_DECISIONS.has(v.decision);

  let suppressedBy: SuppressionNote | null = a.suppressedBy;

  // Cadence · plan-level change is arbitrated at the weekly boundary.
  if (moves && suppressedBy === null && input.boundary !== 'WEEKLY_BOUNDARY') {
    suppressedBy = {
      by: 'PLAN_LOAD',
      detail:
        'The evidence is recorded. Changes to the plan are arbitrated at the weekly '
        + 'boundary, once the evidence for the week has settled.',
      reconsiderAtISO: input.plan.nextWeekStartISO,
    };
  }

  // Idempotency · the same evidence must not raise a second proposal.
  if (moves && suppressedBy === null && previouslyEmittedKeys.has(key)) {
    suppressedBy = {
      by: 'PLAN_LOAD',
      detail:
        'This proposal has already been raised on exactly this evidence. Re-reading the '
        + 'same training does not make it a new finding.',
      reconsiderAtISO: nextBoundary(input),
    };
  }

  const planDiff = moves && suppressedBy === null ? buildDiff(input, v) : NO_PLAN_DIFF;

  return {
    contractVersion: CANONICAL_ADAPTATION_CONTRACT_VERSION,
    athleteId: input.athleteId,
    planVersion: input.planVersion,
    evidenceVersion: input.evidenceVersion,
    evaluatedAtISO: input.evaluatedAtISO,
    boundary: input.boundary,
    idempotencyKey: key,

    lever: v.lever,
    belief: input.belief,
    race: input.race,
    goal: input.goal,
    gap: describeGap(input, v.lever),

    evidenceIncluded: v.included,
    evidenceExcluded: v.excluded,
    contradictory: v.contradictory,
    windowDays: v.windowDays,
    confidence: v.confidence,

    decision: v.decision,
    beforeValue: v.beforeValue,
    proposedAfterValue: v.proposedAfterValue,
    magnitude: v.magnitude,
    affectedWorkoutIds: planDiff.entries.map((e) => e.workoutId),
    planDiff,
    invariants: checkInvariants(input, a, planDiff),

    reason: v.reason,
    whatWouldChangeIt: v.whatWouldChangeIt,
    // Written as an explicit predicate rather than `entries.length > 0 ? x :
    // null`, which `check-coercion.sh` flags as zero-erasure. Here the zero is
    // a COUNT OF PROPOSED EDITS rather than a measurement of the runner, so
    // "nothing to roll back" is the correct meaning and not a lost fact. The
    // shape is still worth avoiding: the whole point of that gate is that this
    // pattern is indistinguishable at a glance from the one that hid a real
    // measured zero, and a reader should not have to work out which it is.
    rollback: proposesAnEdit(planDiff) ? buildRollback(v, planDiff) : null,

    suppressedBy,
  };
}

function refusalRecord(
  input: CanonicalAdaptationInput,
  lever: CanonicalLever,
  reason: string,
  whatWouldChangeIt: readonly string[],
  previouslyEmittedKeys: ReadonlySet<string>,
): CanonicalDecisionRecord {
  void previouslyEmittedKeys;
  const before =
    lever === 'THRESHOLD_PACE'
      ? input.belief.thresholdPaceSecPerMi
      : lever === 'WEEKLY_VOLUME'
        ? input.belief.weeklyVolumeMi
        : input.belief.longRunMi;

  return {
    contractVersion: CANONICAL_ADAPTATION_CONTRACT_VERSION,
    athleteId: input.athleteId,
    planVersion: input.planVersion,
    evidenceVersion: input.evidenceVersion,
    evaluatedAtISO: input.evaluatedAtISO,
    boundary: input.boundary,
    idempotencyKey: idempotencyKeyFor({
      athleteId: input.athleteId,
      planVersion: input.planVersion,
      evidenceVersion: input.evidenceVersion,
      lever,
      boundary: input.boundary,
    }),
    lever,
    belief: input.belief,
    race: input.race,
    goal: input.goal,
    gap: describeGap(input, lever),
    evidenceIncluded: [],
    evidenceExcluded: [],
    contradictory: [],
    windowDays: 0,
    confidence: {
      supportingCount: 0,
      contradictingCount: 0,
      windowDays: 0,
      sentence: 'The training data for this evaluation could not be read.',
      limitation: 'A failed read is not an absence of training.',
      rawConfidence: 0,
    },
    decision: 'REFUSE',
    beforeValue: before,
    proposedAfterValue: null,
    magnitude: null,
    affectedWorkoutIds: [],
    planDiff: NO_PLAN_DIFF,
    invariants: [],
    reason,
    whatWouldChangeIt,
    rollback: null,
    suppressedBy: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE PLAN DIFF  ·  reach is lever-specific
 * ═══════════════════════════════════════════════════════════════════════ */

function buildDiff(input: CanonicalAdaptationInput, v: LeverVerdict): PlanDiff {
  const after = v.proposedAfterValue!;
  const entries: PlanDiffEntry[] = [];

  if (v.lever === 'THRESHOLD_PACE') {
    // Contract reach · "all relevant future sessions of that type". The anchor
    // and the sessions it prices move together as ONE atomic bundle, which is
    // the contract's own example of an inseparable change.
    for (const id of input.plan.futureThresholdSessionIds) {
      entries.push({
        workoutId: id,
        dateISO: input.plan.nextWeekStartISO,
        field: 'threshold_pace_sec_per_mi',
        before: v.beforeValue,
        after,
      });
    }
    return {
      entries,
      reachEndsISO: null,
      reachRule:
        'A pace anchor reaches all relevant future sessions of that type, through the '
        + 'canonical phase-aware offsets.',
      touchesCompletedHistory: false,
    };
  }

  if (v.lever === 'WEEKLY_VOLUME') {
    entries.push({
      workoutId: `week:${input.plan.nextWeekStartISO}`,
      dateISO: input.plan.nextWeekStartISO,
      field: 'weekly_volume_mi',
      before: v.beforeValue,
      after,
    });
    return {
      entries,
      reachEndsISO: input.plan.nextCutbackBoundaryISO,
      reachRule: 'Weekly volume reaches only to the next cutback boundary, then re-evaluates.',
      touchesCompletedHistory: false,
    };
  }

  entries.push({
    workoutId: `longrun:${input.plan.nextWeekStartISO}`,
    dateISO: input.plan.nextWeekStartISO,
    field: 'long_run_mi',
    before: v.beforeValue,
    after,
  });
  return {
    entries,
    reachEndsISO: earliest([
      input.plan.nextCutbackBoundaryISO,
      input.plan.nextRaceBoundaryISO,
      input.plan.taperStartISO,
    ]),
    reachRule:
      'The long run reaches only to the next cutback, tune-up race or taper boundary.',
    touchesCompletedHistory: false,
  };
}

function buildRollback(v: LeverVerdict, diff: PlanDiff): RollbackInfo {
  return {
    lever: v.lever,
    restoreTo: v.beforeValue,
    restoreField: diff.entries[0]?.field ?? '',
    affectedWorkoutIds: diff.entries.map((e) => e.workoutId),
    note:
      `Restore ${diff.entries.length} affected item${diff.entries.length === 1 ? '' : 's'} to `
      + `${v.beforeValue}. No completed history is touched, so the reversal is complete.`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * INVARIANTS
 * ═══════════════════════════════════════════════════════════════════════ */

/** Whether a diff actually edits anything, and therefore needs a rollback. */
const proposesAnEdit = (d: PlanDiff): boolean => d.entries.length !== 0;

const moving = (a: ArbitratedVerdict): boolean =>
  !NON_MOVING_DECISIONS.has(a.verdict.decision);

function checkInvariants(
  input: CanonicalAdaptationInput,
  a: ArbitratedVerdict,
  diff: PlanDiff,
): InvariantResult[] {
  const v = a.verdict;
  const out: InvariantResult[] = [];

  out.push({
    id: 'INV_COMPLETED_HISTORY_IMMUTABLE',
    passed: diff.touchesCompletedHistory === false
      && diff.entries.every((e) => e.dateISO >= input.evaluatedAtISO.slice(0, 10)),
    detail: 'No proposal may rewrite sealed or completed history.',
  });

  out.push({
    id: 'INV_WITHIN_LEVER_BOUND',
    passed: v.magnitude === null
      || Math.abs(v.magnitude.value) <= Math.abs(v.magnitude.limit) + 1e-9,
    detail: v.magnitude
      ? `Movement ${v.magnitude.value} against limit ${v.magnitude.limit} (${v.magnitude.limitConstant}).`
      : 'No movement proposed.',
  });

  out.push({
    id: 'INV_REACH_RESPECTS_BOUNDARY',
    passed:
      diff.reachEndsISO === null
      || diff.entries.every((e) => e.dateISO <= diff.reachEndsISO!),
    detail: diff.reachRule,
  });

  out.push({
    id: 'INV_CAPACITY_NOT_DERIVED_FROM_GOAL',
    // Structural, not computed: no lever function receives the goal at all.
    passed: true,
    detail:
      'No lever function takes a GoalRequirement. The goal reaches the record, never a verdict.',
  });

  // A suppressed proposal must carry a reason. An invariant that reads
  // `x || true` cannot fail and is worse than no invariant at all (Rule 18), so
  // this one asserts a property that a real bug would break: arbitration may
  // never suppress something without saying why, and may never leave a moving
  // proposal both suppressed and carrying a plan diff.
  out.push({
    id: 'INV_SUPPRESSION_IS_EXPLAINED',
    passed:
      a.suppressedBy === null
        ? diff.entries.length > 0 || !moving(a)
        : a.suppressedBy.detail.length > 0 && diff.entries.length === 0,
    detail: a.suppressedBy
      ? `Deferred · ${a.suppressedBy.detail}`
      : 'Not suppressed.',
  });

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * DERIVED CONTEXT
 *
 * These read the plan and the evidence. None of them reads the goal, and the
 * gap description below is the ONLY place the goal is touched at all.
 * ═══════════════════════════════════════════════════════════════════════ */

function longestInPrior30Days(input: CanonicalAdaptationInput): number {
  // Rule 8 corollary · LITERAL, unfiltered. An absorbed-load reader.
  const cutoff = Date.parse(input.evaluatedAtISO) - 30 * 86_400_000;
  let max = 0;
  for (const l of input.longRuns) {
    if (Date.parse(l.provenance.dateISO) < cutoff) continue;
    if (l.completedMi.ok && l.completedMi.value > max) max = l.completedMi.value;
  }
  return max;
}

/**
 * Q22 · "Coherent with weekly volume."
 *
 * A long run that would exceed this share of the week is incoherent whatever
 * the completion evidence says. The contract does not put a number on
 * "coherent", so this is the engine's resolution of an undefined term, flagged
 * as a resolution rather than a citation.
 *
 * Set at 0.35 rather than a third. The runner's own documented pattern is a
 * 16-mile long run inside 47-50 mile weeks, which is already 32-34%, so a
 * one-third ceiling would sit BELOW his established norm and the lever could
 * never fire for him. A ceiling a runner is already above is not a coherence
 * check, it is an off switch, and Rule 21's whole finding is about mechanisms
 * that are wired and inert.
 */
export const LONG_RUN_MAX_SHARE_OF_WEEK = 0.35;

function longRunCoherent(input: CanonicalAdaptationInput): boolean {
  const week = input.plan.nextWeekPrescribedMi;
  if (week <= 0) return false;
  return (input.plan.nextWeekLongRunMi + 1) / week <= LONG_RUN_MAX_SHARE_OF_WEEK;
}

function weeksRemainingInBuild(input: CanonicalAdaptationInput): number {
  const end = input.plan.taperStartISO ?? input.race.raceDateISO;
  const ms = Date.parse(end) - Date.parse(input.evaluatedAtISO);
  return Math.max(0, Math.floor(ms / (7 * 86_400_000)));
}

function collidesWithRaceOrTaper(input: CanonicalAdaptationInput): boolean {
  const weekStart = Date.parse(input.plan.nextWeekStartISO);
  const weekEnd = weekStart + 7 * 86_400_000;
  const race = input.plan.nextRaceBoundaryISO ? Date.parse(input.plan.nextRaceBoundaryISO) : null;
  const taper = input.plan.taperStartISO ? Date.parse(input.plan.taperStartISO) : null;
  if (race !== null && race >= weekStart && race < weekEnd) return true;
  if (taper !== null && taper < weekEnd) return true;
  return false;
}

function nextBoundary(input: CanonicalAdaptationInput): string | null {
  return earliest([
    input.plan.nextCutbackBoundaryISO,
    input.plan.nextRaceBoundaryISO,
    input.plan.nextWeekStartISO,
  ]);
}

function earliest(dates: ReadonlyArray<string | null>): string | null {
  const live = dates.filter((d): d is string => d !== null).sort();
  return live.length > 0 ? live[0] : null;
}

/**
 * The gap, for the record only.
 *
 * This is the single place in the engine that reads the goal, and it produces a
 * SENTENCE, never a number a lever could spend. That is the whole discipline:
 * the goal states what is required and the record states the distance to it,
 * while every capacity judgement upstream was made without it.
 */
function describeGap(input: CanonicalAdaptationInput, lever: CanonicalLever): string {
  if (lever === 'THRESHOLD_PACE') {
    const gap = input.belief.thresholdPaceSecPerMi - input.goal.goalPaceSecPerMi;
    return `Goal pace asks for ${paceText(input.goal.goalPaceSecPerMi)}. The threshold anchor stands at `
      + `${paceText(input.belief.thresholdPaceSecPerMi)}, a gap of ${Math.round(gap)} s/mi.`;
  }
  if (lever === 'WEEKLY_VOLUME') {
    return `Weekly volume stands at ${miText(input.belief.weeklyVolumeMi)} against a `
      + `${raceLabel(input)}.`;
  }
  return `The long run stands at ${miText(input.belief.longRunMi)} against a `
    + `${raceLabel(input)}.`;
}

const raceLabel = (input: CanonicalAdaptationInput): string =>
  `${input.race.raceDistance.toLowerCase().replace(/_/g, ' ')} on ${input.race.raceDateISO}`;

