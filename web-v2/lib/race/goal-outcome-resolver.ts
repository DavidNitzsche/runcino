/**
 * lib/race/goal-outcome-resolver.ts · THE goal-outcome resolver.
 *
 * U4-POST-RACE-TRUTH-4 (2026-09-13) · Santa Monica 10K forensic debrief
 * (`for external review/00-master-programme/SANTA-MONICA-10K-FORENSIC-
 * DEBRIEF-2026-09-13.md`) and the master ledger's own RULING, 2026-09-13:
 * "Santa Monica must NOT be classified or interpreted as a failed goal."
 *
 * ── THE QUESTION THIS FILE ANSWERS, AND ONLY THIS QUESTION ──────────────────
 *
 * "Was the PUBLISHED GOAL a valid basis for judging this runner?" — not "did
 * he run well" (a real, separate, MEASURED fact this file never touches) and
 * not "should the fitness model move" (the Evidence Engine's and Wave 2's
 * canonical-fitness-resolver's question, not this one's). David's own words,
 * carried into the ruling: the 45:53 result is legitimate performance
 * evidence; the app's GOAL was the defective artifact.
 *
 * Santa Monica is the concrete case this resolver exists to get right: a
 * 43:05 target built 98% off one uncorroborated training session (2% weight
 * on the confirmed AFC-half race evidence — `race-outlook.ts`'s own
 * `durabilityBlend.weight`) against only 7:02 of continuous race-pace
 * preparation in the 28 days before a race whose own demand was ~43 minutes
 * continuous. Neither fact makes the RESULT (45:53) invalid — it stays a
 * real measurement, unconditionally. Both facts make the TARGET invalid,
 * which is a different claim about a different object.
 *
 * ── WHY THIS IS THE SINGLE AUTHORITY ─────────────────────────────────────────
 *
 * Per `docs/BRAIN_CONSTITUTION.md`'s ownership discipline: one question, one
 * canonical owner, no side doors. Before this file existed, "was the goal
 * fair" had no owner at all — post-run copy (`lib/postrun/experience.ts`)
 * conflated "missed the target" with "something went wrong" (the exact
 * conflation David named as this file's reason for existing), and nothing
 * anywhere excluded a race like this one from `fitness_regression` or a
 * goal-hit-rate metric. `resolveGoalOutcome` below is now the one place that
 * decision gets made. A caller that re-derives target validity from raw
 * evidence fields instead of calling this is the exact "second answer to one
 * question" `docs/BRAIN_CONSTITUTION.md` rejects.
 *
 * ── A DELIBERATE SCOPING BOUNDARY (disclosed, not silent) ────────────────────
 *
 * This resolver is PURE — no pool, no userId, no DB import at any depth,
 * same seal `lib/postrun/experience.ts` and `lib/execution/verdict.ts`
 * already carry, and for the same reason (reachable from a `'use client'`
 * graph via a dynamic import is still a bundled edge — Rule 19). It answers
 * the question off facts a caller supplies, and does NOT itself compute a
 * generic "did this runner rehearse race pace" detector for arbitrary race
 * distances. The debrief's own §"proposed lanes" explicitly scopes that
 * detection work to Track 6/Phase 3 ("not something you need to build here
 * — just make sure your resolver's OUTPUT correctly carries the 'why' so a
 * future consumer has something honest to read"). `qualifyingMarathonRehearsal`
 * (`lib/training/durability-anchor.ts`) already does this for MARATHON pace
 * specifically, with marathon-specific segment-length and HR-band constants
 * that do not generalise to a 10K by simple substitution (an 8-mile minimum
 * rehearsal segment is longer than a 10K race itself) — generalising it is a
 * training-science threshold decision this file declines to make unilaterally.
 * `preparationSupport` is therefore an INPUT here, not a computed field: a
 * caller that has one (today, a specifically-resolved read for a known race;
 * future, Track 6/Phase 3's generic detector) supplies it, and a caller that
 * does not passes `'not_measured'` — the Rule 11 third state — rather than a
 * fabricated presence or absence of preparation.
 */
import { GOAL_OPTIMISM_TOLERANCE } from '@/lib/training/achievable-target';

/** The four outcomes. `'met'`/`'missed'` are honest verdicts about a VALID
 *  target; `'target_invalidated'` says the target itself failed the bar
 *  before the comparison could mean anything; `'not_assessable'` says there
 *  is not enough here to answer either question (no measured performance, or
 *  no published target to judge it against). */
export type GoalOutcome = 'met' | 'missed' | 'target_invalidated' | 'not_assessable';

/**
 * Why. An array, not one nullable string (`reason?:` in this task's own
 * sketch) — the ruling is explicit that Santa Monica carries reason
 * "`insufficient_preparation_support` and/or `target_evidence_unreliable`",
 * and a single-valued field cannot honestly hold "and". Judgment call,
 * disclosed: the suggested single `reason?` field would have forced a
 * priority order onto two independently-true facts, which is the exact
 * "asserts one thing when two are true" shape Rule 16 and the U4 postrun
 * fixes above both exist to remove.
 */
export type GoalOutcomeReason =
  /** The published target's evidence was born almost entirely from
   *  uncorroborated non-race sessions rather than confirmed race results —
   *  `targetRaceEvidenceWeight` below the floor, with no corroboration to
   *  stand in for the missing race evidence. */
  | 'target_evidence_unreliable'
  /** The runner had not demonstrated the target's own demand in training —
   *  `preparationSupport.ratio` below the floor, when a preparation read was
   *  actually supplied. */
  | 'insufficient_preparation_support'
  /** There is no measured performance to judge at all — the race has not
   *  happened, or nothing was recorded. */
  | 'no_measured_performance'
  /** There is a measured performance but no published target it was raced
   *  against — nothing here to call `met` or `missed`. */
  | 'no_published_target'
  /** The result beat the published target outright. */
  | 'exceeded_target'
  /** The result sat within doctrine's own optimism tolerance
   *  (`GOAL_OPTIMISM_TOLERANCE`) of the published target — close enough that
   *  calling it a miss would be litigating GPS/course noise, not fitness. */
  | 'within_tolerance_of_target';

/**
 * A read that is either a real measurement or an explicit "not measured" —
 * Rule 11's third state, spelled out as a type rather than left to a
 * caller's own `null` convention (which collapses "not applicable" and "not
 * yet built" into one value). `demonstratedSec` / `demandSec` are BOTH real
 * seconds when `ok`, so `ratio` is always a true division rather than a
 * caller-supplied shortcut that could disagree with the two numbers beside
 * it (Rule 16 — one owner for the derived quantity).
 */
export type PreparationSupportRead =
  | { ok: true; demonstratedSec: number; demandSec: number }
  | { ok: false; reason: 'not_measured' | 'not_applicable' };

/** The typed input. Every field here is a fact a caller resolves and hands
 *  in — this file combines them, it does not go looking for them. */
export interface GoalOutcomeInput {
  /** For the explanation string and for a caller's own logging — never
   *  branched on inside this file (the logic is the same for every race). */
  raceId: string;
  /**
   * The runner's own measured performance, in seconds — a real number the
   * instant the run exists, independent of whether `races.actual_result` has
   * been sealed. This is deliberately NOT gated on sealing: the ruling is
   * explicit that "the 45:53 result stays fully valid as performance
   * evidence" while the race sits unsealed for entirely unrelated,
   * operational reasons (Rule 23's cron-ordering gap). A caller resolves
   * this from the matched canonical run, not from `races.actual_result`
   * alone.
   */
  measuredFinishSec: number | null;
  /** The target the runner was actually racing against — the number the
   *  goal is judged FROM. A caller picks one canonical number per Rule 16;
   *  this file does not adjudicate which of a race's several live target
   *  numbers (see the debrief's §5.1 "five finish-time numbers" finding)
   *  is the right one to hand in — that is Wave 2 / U7's territory. */
  publishedTargetSec: number | null;
  /**
   * How much of the published target's own evidence blend came from
   * CONFIRMED race results, as a share in `[0, 1]` — e.g.
   * `composeRaceOutlook`'s own `currentProjection.durabilityWeight`
   * (`lib/race/race-outlook.ts`), which is exactly the number the debrief's
   * §5.2 "2% weighting" finding names. `null` when this could not be
   * resolved — treated as unknown, never as zero (Rule 11): an unresolved
   * weight must not silently manufacture an invalidation.
   */
  targetRaceEvidenceWeight: number | null;
  /**
   * Whether the NON-race branch of the target's evidence was itself
   * corroborated by at least two independent sessions — this app's own
   * corroboration bar, named verbatim in
   * `lib/postrun/experience.ts#readEvidence`'s header ("threshold pace moves
   * on at least 2 corroborating sessions"). Santa Monica's target was built
   * off exactly one cruise-interval session, so this is `false` there.
   */
  targetEvidenceCorroborated: boolean;
  /** See `PreparationSupportRead`. `{ ok: false, reason: 'not_applicable' }`
   *  for a race with no specific continuous-pace demand worth checking (this
   *  file does not decide which races qualify — a caller states it). */
  preparationSupport: PreparationSupportRead;
}

/** The typed result. `reasons` is `[]` exactly on `'met'`/`'missed'` (a valid
 *  target needs no invalidation reason) and non-empty exactly on
 *  `'target_invalidated'`; `'not_assessable'` carries its own one-item
 *  reason naming which half of the comparison was missing. */
export interface GoalOutcomeResult {
  outcome: GoalOutcome;
  reasons: GoalOutcomeReason[];
  /**
   * `true` on `'target_invalidated'` and `'not_assessable'`, `false`
   * otherwise. THE field the ruling's "must NOT count toward... must NOT
   * trigger or contribute to..." language cashes out as one boolean a
   * consumer can gate on directly, without re-deriving "is this one of the
   * bad outcomes" from the `outcome` enum itself (Rule 16 — the exclusion
   * rule lives in one place, here, not re-typed at every call site).
   */
  excludeFromAutomaticAdaptation: boolean;
  /**
   * One machine-readable sentence carrying the "why" — NOT runner-facing
   * copy (that is `lib/postrun/experience.ts`'s job, gated on doctrine's
   * coach-voice rules, em-dash scan included). A future consumer (Phase 3's
   * preparation work, Wave 2's fitness-evidence resolver) reads this to know
   * what happened without re-deriving it from the raw input fields.
   */
  explanation: string;
}

/**
 * Below this share of a published target's evidence coming from a CONFIRMED
 * race, the race-evidence branch is a minority voice in its own blend — and
 * without independent corroboration of the majority branch, that blend is
 * not evidence a runner should be judged against. Santa Monica's own
 * `durabilityWeight` was 0.02, twenty-five times under this floor.
 *
 * A threshold decision, not a doctrine citation — disclosed as a judgment
 * call. `0.5` is chosen as the natural reading of "minority voice": below it,
 * the branch that is NOT a confirmed race measurement did more than half the
 * talking.
 */
export const TARGET_EVIDENCE_WEIGHT_FLOOR = 0.5;

/**
 * Below this share of a race's own demonstrated demand, training preparation
 * is not enough to hold the runner to the target built on the assumption he
 * could. Santa Monica's own ratio was 7:02 / 43:00 ≈ 0.16, three times under
 * this floor.
 *
 * Also a disclosed judgment call, not a Research/ citation — the debrief's
 * own Track 6 investigation is what would turn this into a doctrine-cited
 * number (per-distance rehearsal requirements), and that work is explicitly
 * deferred (see this file's header). `0.5` is the same "did the majority of
 * the demand get demonstrated" reading `TARGET_EVIDENCE_WEIGHT_FLOOR` uses.
 */
export const PREPARATION_SUPPORT_RATIO_FLOOR = 0.5;

function explain(outcome: GoalOutcome, reasons: GoalOutcomeReason[], detail: string): GoalOutcomeResult {
  return {
    outcome,
    reasons,
    excludeFromAutomaticAdaptation: outcome === 'target_invalidated' || outcome === 'not_assessable',
    explanation: detail,
  };
}

/**
 * THE resolver. Pure, total (never throws), and the single authority other
 * systems consume — see this file's header for the ownership argument.
 */
export function resolveGoalOutcome(input: GoalOutcomeInput): GoalOutcomeResult {
  if (input.measuredFinishSec == null) {
    return explain(
      'not_assessable',
      ['no_measured_performance'],
      `Race ${input.raceId}: no measured performance exists yet to judge against any target.`,
    );
  }
  if (input.publishedTargetSec == null) {
    return explain(
      'not_assessable',
      ['no_published_target'],
      `Race ${input.raceId}: a performance was measured (${input.measuredFinishSec}s) but no published target exists to judge it against.`,
    );
  }

  const reasons: GoalOutcomeReason[] = [];
  const weightUnreliable = input.targetRaceEvidenceWeight != null
    && input.targetRaceEvidenceWeight < TARGET_EVIDENCE_WEIGHT_FLOOR
    && !input.targetEvidenceCorroborated;
  if (weightUnreliable) reasons.push('target_evidence_unreliable');

  const prepInsufficient = input.preparationSupport.ok
    && input.preparationSupport.demandSec > 0
    && (input.preparationSupport.demonstratedSec / input.preparationSupport.demandSec) < PREPARATION_SUPPORT_RATIO_FLOOR;
  if (prepInsufficient) reasons.push('insufficient_preparation_support');

  if (reasons.length > 0) {
    const weightNote = input.targetRaceEvidenceWeight != null
      ? `race-evidence weight ${(input.targetRaceEvidenceWeight * 100).toFixed(0)}% (floor ${(TARGET_EVIDENCE_WEIGHT_FLOOR * 100).toFixed(0)}%), corroborated=${input.targetEvidenceCorroborated}`
      : 'race-evidence weight unresolved';
    const prepNote = input.preparationSupport.ok
      ? `preparation ${input.preparationSupport.demonstratedSec}s of ${input.preparationSupport.demandSec}s demanded (${((input.preparationSupport.demonstratedSec / input.preparationSupport.demandSec) * 100).toFixed(0)}%, floor ${(PREPARATION_SUPPORT_RATIO_FLOOR * 100).toFixed(0)}%)`
      : `preparation ${input.preparationSupport.reason}`;
    return explain(
      'target_invalidated',
      reasons,
      `Race ${input.raceId}: the published target was not a valid basis for judging this result. ${weightNote}; ${prepNote}. The measured performance (${input.measuredFinishSec}s) stays valid; the target does not.`,
    );
  }

  const withinTolerance = input.measuredFinishSec <= input.publishedTargetSec * (1 + GOAL_OPTIMISM_TOLERANCE);
  if (withinTolerance) {
    const exceeded = input.measuredFinishSec <= input.publishedTargetSec;
    return explain(
      'met',
      [exceeded ? 'exceeded_target' : 'within_tolerance_of_target'],
      `Race ${input.raceId}: measured ${input.measuredFinishSec}s against a valid ${input.publishedTargetSec}s target. Met.`,
    );
  }
  return explain(
    'missed',
    [],
    `Race ${input.raceId}: measured ${input.measuredFinishSec}s against a valid ${input.publishedTargetSec}s target. Missed by ${input.measuredFinishSec - input.publishedTargetSec}s.`,
  );
}

