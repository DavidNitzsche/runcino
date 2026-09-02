/**
 * lib/training/goal-projection.ts · plan-trusts-itself projection.
 *
 * David 2026-06-04: "not everyone, or me, is going to do another race
 * while training for a race, so we have to be sure the coaching and the
 * plan and the adaptation will get me there. if its a goal, the plan
 * should get me there until its very clear I cannot."
 *
 * Doctrine shift. The old engine was backward-looking · projection was
 * derived from the runner's last race result via Daniels predictRaceTime.
 * Without a tune-up race during a long build, the projection stayed
 * frozen at the last race time. That punished anyone in a race-prep
 * build who isn't ALSO racing every 6 weeks.
 *
 * New doctrine · the plan is the path. PROJECTION = GOAL until drift
 * signals fire. The runner is assumed to be ON TRACK while they follow
 * the plan and no specific evidence shows fitness is regressing.
 *
 * Daniels actually backs this · §VDOT chapter: "Training-pace-derived
 * VDOT is valid when training is consistent." Pfitzinger §LT-pace +
 * tempo HR is a fitness gauge that doesn't need a race to read.
 *
 * Status ladder:
 *   · on-track  · projection = goal · no drift signals
 *   · watching  · projection = goal · soft signals firing · "next quality
 *                  run will tell us more"
 *   · off-track · projection = current VDOT-derived · clear evidence the
 *                  plan won't deliver as is · gap is real and worth
 *                  renegotiating
 *   · ahead     · projection = current VDOT-derived (faster than goal) ·
 *                  2026-08-28 AHEAD-1 · [[feedback_progress_is_the_guiding_light]]
 *                  (locked 2026-08-25): current fitness is a floor, not a
 *                  ceiling — a runner demonstrably faster than their stated
 *                  goal cannot see a projection frozen at the goal forever.
 *                  Fires only from a CLEAN on-track read (no drift signal
 *                  firing in either direction), gated by the same magnitude
 *                  bar detectRecentRaceDrift's STRONG threshold uses (10%,
 *                  ~2 VDOT points, "very clear" territory) and the same
 *                  sustained-evidence bar computeOverPerformanceBonus already
 *                  requires (>= MIN_SESSIONS controlled, HR-corroborated
 *                  threshold sessions) — see resolveAheadOverride below. The
 *                  GOAL NUMBER ITSELF never moves ([[feedback_no_forced_goal_decisions]]
 *                  — the coach projects, it never renegotiates a stated goal);
 *                  only the projection admits it is honestly faster.
 *
 * Drift signals (weights):
 *   · STRONG · recent priority A/B race > 2% slower than goal pace
 *   · STRONG · VDOT trend down ≥ 1 point over 4+ weeks (snapshot history)
 *   · MEDIUM · aerobic decoupling trending up across last 3 long runs
 *   · MEDIUM · tempo/threshold paces ≥ 10s/mi slower for 3+ weeks
 *   · MEDIUM · plan adapter forced 2+ weeks of easy downgrades
 *   · WEAK   · 30%+ key sessions missed in last 4 weeks
 *
 * Status thresholds:
 *   · 1 strong OR ≥ 2 medium → off-track
 *   · 1 medium OR ≥ 2 weak  → watching
 *   · otherwise              → on-track
 */

import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { intentValueField } from '@/lib/coach/intent-value';
import { isoDaysBefore } from '@/lib/runs/volume';
import { predictRaceTime, vdotFromRace, tPaceFromVdot, vdotFromTpace, parseRaceTime } from './vdot';
import { computeDecouplingTrend } from './decoupling-trend';
import { runnerToday, runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { heatAdjustedStatus } from '@/lib/coach/heat-band';
import { resolveWorkoutVerdict, testPointVerdictFor, type WorkoutVerdict } from '@/lib/execution/verdict';
import {
  classifySession,
  sessionToleranceSec,
  EASY_PHASE_TOLERANCE_S_PER_MI,
} from './execution-semantics';
import { projectFitnessTrajectory, type FitnessTrajectory } from './fitness-trajectory';
import { VDOT_GAIN_PER_WEEK_MAX } from './vdot-gain-rate';
import { loadPlannedTargetVdot, loadMarathonSpecificTraining } from './plan-target';
import { distanceCategoryOrNull } from '@/lib/race/distance-category';
import { expandSpecToPhases, DURATION_EST_S_PER_MI, type ExpandedPhase } from './expand-spec';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';
import { thresholdPassHrBpm } from '@/lib/training/zones';
import {
  resolveRaceExponent,
  projectWithDurabilityExponent,
  type RaceExponentRead,
} from './durability-anchor';

export type GoalStatus = 'on-track' | 'watching' | 'off-track' | 'ahead';
export type DriftWeight = 'strong' | 'medium' | 'weak';

/** 2026-07-06 · P1-10 fix · what a recent-test-point verdict compared.
 *  See GoalProjection.recentTestPoints[].verdictBasis. */
export type TestPointVerdictBasis =
  | 'work-phase-watch'
  | 'work-phase-splits'
  | 'blended-overall'
  | 'overall';

export interface DriftSignal {
  kind: 'recent_race' | 'vdot_trend' | 'aerobic_decoupling'
    | 'tempo_pace_drift' | 'plan_adapter_downgrades' | 'missed_key_workouts';
  weight: DriftWeight;
  /** Plain-language explanation the runner can verify. */
  detail: string;
  /** Raw numbers for diagnostic / debug surfaces. */
  evidence: Record<string, number | string | null>;
}

export interface ConfidenceInterval {
  /** Faster edge · seconds. */
  lo: number;
  /** Slower edge · seconds. */
  hi: number;
  /** Final half-width %, after status scaling · for display/diagnostics. */
  pct: number;
  /** Provenance · 'observed-cv' when sized off the runner's own pacing CV,
   *  'research-span' when off the Research/02 §13.7 table,
   *  'research-span-stale' when the §13.7 ±8% stale-input override fires
   *  (anchor >180 days old),
   *  'research-span-cross' when the §13.7 cross-distance row governs — the
   *  anchor is at a different distance from the target and doctrine sizes that
   *  span wider than the same-distance table (CI-CROSS-1). */
  method: 'observed-cv' | 'research-span' | 'research-span-stale' | 'research-span-cross';
  /** CI-CROSS-1 · true when §13.7's "±10% (one-sided pessimistic)" row governs:
   *  a marathon predicted from a sub-half-marathon input with no marathon
   *  block. The band then runs from the projection to +10%, with no fast edge —
   *  doctrine states the error in that case is one-directional, and §14.7 says
   *  coaches reporting a point estimate here "systematically over-predict". */
  oneSided?: boolean;
}

export interface ConfidenceLabel {
  tier: 'high' | 'medium' | 'low';
  word: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Plain-English read · "doable, not banked". */
  descriptor: string;
  /** Supporting line in time terms (no VDOT jargon) · "4:54 to find · 10
   *  weeks to do it". */
  detail: string;
  /** Raw inputs for diagnostic surfaces. */
  evidence: Record<string, number | string>;
}

export interface GoalProjection {
  status: GoalStatus;
  /** What we tell the runner: goal when ON TRACK / WATCHING, VDOT-derived
   *  when OFF TRACK or AHEAD (2026-08-28 AHEAD-1). The single projection
   *  number for the gauge. */
  projectionSec: number;
  /** The goal · always present so display can show "X projected · Y goal"
   *  when off-track or ahead. Never written by this function — only what it
   *  reports about the goal moves, never the goal itself
   *  ([[feedback_no_forced_goal_decisions]]). */
  goalSec: number;
  /** The raw current-VDOT projection · always computed. Used when status
   *  flips to off-track AND for the "soft watch" hint when WATCHING, and
   *  (2026-08-28 AHEAD-1) when status reads ahead. */
  vdotProjectionSec: number | null;
  /**
   * 2026-09-01 · goal-projection-durability follow-up · how much
   * `vdotProjectionSec` (and `trajectory.currentSec`/`projectedSec`) leaned on
   * this runner's own fitted cross-distance exponent
   * (`durability-anchor.ts#resolveRaceExponent`) instead of the population
   * Daniels-table equivalence. `weight` is `RaceExponentRead.confidence`
   * directly (already a 0..1 evidence+freshness score on its own documented
   * scale) — a CONTINUOUS blend, not a threshold: `vdotProjectionSecRaw =
   * weight · durabilityProjectionSec + (1 − weight) · danielsProjectionSec`.
   * No cliff to manufacture (Rule 9) because there is no discrete cutover — a
   * runner's confidence moving from 0.59 to 0.61 moves the number by the same
   * small amount confidence moving from 0.49 to 0.51 would. Null when the
   * durability read refused (`ok: false`) or `vdot` itself is null (cold
   * start) — `weight` is then implicitly 0 and this field is omitted rather
   * than reported as a no-op blend, so a consumer can tell "durability wasn't
   * read" from "durability was read and weighted at zero" (Rule 11 — thin
   * evidence is a fact about EVIDENCE, refusal is a fact about the READ). See
   * docs/reports/race-prediction-goal-projection-durability-2026-09-01.md.
   */
  durabilityBlend: { weight: number; anchorDistanceMi: number } | null;
  /** All firing drift signals · empty when ON TRACK. */
  driftSignals: DriftSignal[];
  /** One-liner the page can render under the gauge. */
  summary: string;
  /** 2026-06-04 · the next 1-3 quality workouts on the plan · "next test
   *  points." Renders as "Next: Wed Jun 11 · 4mi tempo." Empty when no
   *  active plan or no upcoming quality days. */
  nextTestPoints: Array<{
    dateISO: string;
    type: string;
    label: string;             // e.g. "4mi tempo"
    distanceMi: number | null;
    /** 2026-06-09 Phase 2 (3.3) · the named test. The SAME numbers the
     *  drift detectors will judge the run by, stated before the run
     *  instead of after: work-phase pace ≤ T+10 (detectTempoPaceDrift's
     *  trigger edge) and avgHr ≤ 0.975×LTHR (the Friel Z4/5a seam — at
     *  or under threshold). Null for non-T-pace test points (long/race)
     *  or when VDOT/LTHR are unknown — never invented. */
    passCriteria: { paceMaxSPerMi: number; hrMaxBpm: number | null } | null;
  }>;
  /** 2026-06-04 · the past 1-3 completed quality runs · "recent test
   *  points." Same shape + verdict from the plain (unadjusted) phase band.
   *  Lets the runner see what the recent quality work landed at without
   *  leaving the Targets page. */
  recentTestPoints: Array<{
    dateISO: string;
    type: string;
    label: string;
    distanceMi: number | null;
    /** Actual avg pace string · "7:17". Null when run lacked pace data. */
    actualPace: string | null;
    /** Plain verdict, never widened for heat · 'on' when ran inside the
     *  ±10s/mi band, 'fast' when overcooked vs plan, 'slow' when a real
     *  miss. Null when target pace unknown. */
    verdict: 'on' | 'fast' | 'slow' | null;
    /** 2026-07-06 · P1-10 fix · WHAT the verdict compared. Additive —
     *  existing fields keep their meanings.
     *    'work-phase-watch'  · watch_completion work-phase pace vs work target
     *    'work-phase-splits' · work-window pace derived from mile splits +
     *                          workout_spec phase distances vs work target
     *    'blended-overall'   · whole-run pace vs a distance-weighted blend
     *                          (WU/CD at easy pace + work at target)
     *    'overall'           · whole-run pace vs a whole-run target
     *                          (long/race · target IS the whole-run pace)
     *  Null when the verdict abstained (no honest basis · never judge a
     *  warmup-included quality run against the bare work target). */
    verdictBasis: TestPointVerdictBasis | null;
  }>;
  /** 2026-06-04 · forecast copy · "what would flip the status." Pair of
   *  human-readable conditions derived from the current signals · tells
   *  the runner WHAT moves the gauge without being prescriptive. */
  transitions: {
    /** Copy that explains what would tip the status one rung BETTER
     *  (watching → on-track, or off-track → watching). Null when
     *  already at the top (ON TRACK). */
    toBetter: string | null;
    /** Copy that explains what would tip the status one rung WORSE
     *  (on-track → watching, or watching → off-track). Null when
     *  already at the bottom (OFF TRACK). */
    toWorse: string | null;
  };
  /** 2026-06-08 · statistical band around the current-fitness projection
   *  (vdotProjectionSec). Null at cold-start. See computeConfidenceInterval. */
  confidenceInterval: ConfidenceInterval | null;
  /** CI-CROSS-1 · whether this runner's plan meets Research/02 §13.1's
   *  marathon-specificity minima, when that question could change the band
   *  (marathon target off a sub-half-marathon anchor); null otherwise, and
   *  null when the read was not attempted. Echoed so a surface that recomputes
   *  the band for its own status/pacing — `app/api/targets/projection` — sizes
   *  it off the same answer instead of a second database read that could
   *  disagree. */
  marathonSpecificTraining: boolean | null;
  /** SPEC-CENTER (2026-08-28) · non-null when Research/02 §13.1's +5%
   *  one-sided marathon-specificity adjustment moved `vdotProjectionSec`
   *  (marathon target, sub-marathon anchor, no marathon block in place —
   *  REVIEW_NOTES A5 extends the rule to half-marathon anchors). The
   *  adjusted number is MODELLED: surfaces mark it with the ~ convention. */
  specificityAdjustment: { pct: number; oneSided: true } | null;
  /** 2026-06-08 · goal-attainment confidence (HIGH/MEDIUM/LOW). Null at
   *  cold-start. See computeConfidenceLabel. */
  confidenceLabel: ConfidenceLabel | null;
  /** 2026-06-11 · the goal-seeking trajectory · current fitness + the planned
   *  build (scaled by execution quality) projected to race day, with the gap
   *  to goal and whether the plan is built to reach it. Null at cold-start
   *  (no current VDOT) or when the race date is unknown. The piece that makes
   *  the projection answer "executing this plan, where do I land on race day"
   *  instead of "where am I frozen today." See lib/training/fitness-trajectory. */
  trajectory: FitnessTrajectory | null;
}

/**
 * TODAY's equivalence at a distance — the durability-blended, specificity-
 * adjusted read of what the runner could race NOW. Race Prediction's own
 * input step (Constitution §J), shared by `computeGoalProjection` and the
 * canonical race outlook.
 *
 *   danielsSec            · `predictRaceTime(vdot, d)` — the population table
 *   durabilityProjectionSec · the runner's own fitted exponent carried from
 *                           his nearest real race to this distance
 *   blendedRawSec         · weight · durability + (1 − weight) · daniels,
 *                           weight = `RaceExponentRead.confidence` (continuous)
 *   expectedSec           · blendedRawSec after Research/02 §13.1's one-sided
 *                           marathon-specificity adjustment where it applies
 *
 * Takes NO goal. Null fields mean "could not be read", never a substitute.
 */
export interface CurrentEquivalence {
  danielsSec: number | null;
  durabilityProjectionSec: number | null;
  durabilityRead: RaceExponentRead;
  durabilityBlend: { weight: number; anchorDistanceMi: number } | null;
  blendedRawSec: number | null;
  specificityAdjustment: { pct: number; oneSided: true } | null;
  marathonSpecificTraining: boolean | null;
  expectedSec: number | null;
}

export async function computeCurrentEquivalence(args: {
  userUuid: string;
  raceDistanceMi: number;
  vdot: number | null;
  vdotAnchorDistanceMi: number | null;
  /** Pass an already-resolved read to avoid a second database round trip. */
  durabilityRead?: RaceExponentRead | null;
}): Promise<CurrentEquivalence> {
  const { userUuid, raceDistanceMi, vdot, vdotAnchorDistanceMi } = args;
  const needsMarathonBlockSignal =
    distanceCategoryOrNull(raceDistanceMi) === 'm' &&
    vdotAnchorDistanceMi != null &&
    ['5k', '10k', 'hm'].includes(distanceCategoryOrNull(vdotAnchorDistanceMi) ?? '');
  const [marathonSpecificTraining, durabilityRead] = await Promise.all([
    needsMarathonBlockSignal ? loadMarathonSpecificTraining(userUuid).catch(() => null) : Promise.resolve(null),
    args.durabilityRead
      ? Promise.resolve(args.durabilityRead)
      : resolveRaceExponent(userUuid).catch((): RaceExponentRead => ({ ok: false, reason: 'no_races', races: 0 })),
  ]);
  const specificityAdjustment = marathonSpecificityAdjustment(
    raceDistanceMi,
    vdotAnchorDistanceMi ?? null,
    marathonSpecificTraining,
  );
  const danielsProjectionSec = vdot != null ? predictRaceTime(vdot, raceDistanceMi) ?? null : null;
  const durabilityProjection = durabilityRead.ok
    ? projectWithDurabilityExponent(durabilityRead, raceDistanceMi)
    : null;
  const durabilityWeight = durabilityRead.ok ? durabilityRead.confidence : 0;
  const blendedRawSec: number | null =
    vdot == null ? null :
    durabilityProjection == null ? danielsProjectionSec :
    danielsProjectionSec == null ? durabilityProjection.sec :
    Math.round(durabilityWeight * durabilityProjection.sec + (1 - durabilityWeight) * danielsProjectionSec);
  const durabilityBlend = (vdot != null && durabilityProjection != null)
    ? { weight: durabilityWeight, anchorDistanceMi: durabilityProjection.anchorDistanceMi }
    : null;
  const expectedSec =
    blendedRawSec != null && specificityAdjustment != null
      ? Math.round(blendedRawSec * (1 + specificityAdjustment.pct / 100))
      : blendedRawSec;
  return {
    danielsSec: danielsProjectionSec,
    durabilityProjectionSec: durabilityProjection?.sec ?? null,
    durabilityRead,
    durabilityBlend,
    blendedRawSec,
    specificityAdjustment,
    marathonSpecificTraining,
    expectedSec,
  };
}

/**
 * The runner's EXECUTION signal — how well recent quality work is landing and
 * any HR-controlled over-performance — read once so the goal-relative wrapper
 * and the canonical race outlook size expected improvement off the same
 * evidence. Takes no goal.
 */
export async function resolveExecutionSignal(userUuid: string, vdot: number | null): Promise<{
  executionQuality: number;
  overPerformanceBonusVdot: number;
  overPerformanceSessions: number;
  missedKeyWorkouts: boolean;
  recentTestPoints: GoalProjection['recentTestPoints'];
  daysSinceLastRun: number | null;
  recentMissedKeyDates: string[];
}> {
  const [recentTestPoints, absence, overPerf, missedSignal] = await Promise.all([
    loadRecentTestPoints(userUuid, vdot).catch(() => [] as GoalProjection['recentTestPoints']),
    loadExecutionAbsence(userUuid).catch(() => ({ daysSinceLastRun: null as number | null, recentMissedKeyDates: [] as string[] })),
    vdot != null
      ? computeOverPerformanceBonus(userUuid, vdot).catch(() => ({ bonusVdot: 0, sessions: 0, medianBeatSPerMi: 0 }))
      : Promise.resolve({ bonusVdot: 0, sessions: 0, medianBeatSPerMi: 0 }),
    detectMissedKeyWorkoutDrift(userUuid).catch(() => null),
  ]);
  const missedKeyWorkouts = missedSignal != null;
  const executionQuality = executionQualityFromTestPoints(
    recentTestPoints, missedKeyWorkouts, absence.daysSinceLastRun, absence.recentMissedKeyDates,
  );
  return {
    executionQuality,
    overPerformanceBonusVdot: overPerf.bonusVdot,
    overPerformanceSessions: overPerf.sessions,
    missedKeyWorkouts,
    recentTestPoints,
    daysSinceLastRun: absence.daysSinceLastRun,
    recentMissedKeyDates: absence.recentMissedKeyDates,
  };
}

export async function computeGoalProjection(args: {
  userUuid: string;
  goalSec: number;
  raceDistanceMi: number;
  vdot: number | null;
  /** 2026-06-08 · days until race day · runway axis for the confidence
   *  label. Null when the race date is unknown. */
  daysToRace?: number | null;
  /** 2026-06-08 · pacing-discipline result · sizes the CI off observed split
   *  CV when source='observed'. Computed once in the seed, shared with
   *  executionBufferSec. */
  pacing?: { cv: number | null; source: 'observed' | 'default' } | null;
  /** 2026-06-08 · ISO date of the race/run that produced vdot. Null when
   *  the snapshot predates migration 125. Used for the §13.7 stale-input
   *  ±8% override in computeConfidenceInterval. */
  vdotAnchorDateISO?: string | null;
  /** 2026-06-08 · distance (miles) of that anchor race/run. Null when
   *  unknown. Threaded for Case 1 (marathon one-sided pessimism); not yet
   *  read by computeConfidenceInterval — see docs/AUDIT-FIXES.md CI-followup-1. */
  vdotAnchorDistanceMi?: number | null;
}): Promise<GoalProjection> {
  const { userUuid, goalSec, raceDistanceMi, vdot, daysToRace, pacing,
          vdotAnchorDateISO, vdotAnchorDistanceMi } = args;

  // CI-CROSS-1 · §13.7's marathon rows split on whether a marathon block is in
  // place, so the band needs to know. Only asked when it can matter — a
  // marathon target predicted off a sub-marathon anchor — so no other shape
  // pays for the query. Failure reads as "no block established", which is
  // §13.7's wider row, never the narrower one.
  //
  // 2026-08-28 · SPEC-CENTER · hoisted above the detectors (it is an
  // independent plan read), extended to HALF-MARATHON anchors, and now also
  // applied to the CENTER, not just the band. Research/02 §13.1 :382 states
  // the point adjustment outright — "for marathon prediction from a
  // sub-half-marathon input, add 5% if marathon-specific training is absent" —
  // and REVIEW_NOTES.md A5 (2026-08-28) resolves the corpus's four phrasings
  // to exactly this rule for a half-marathon input too ("+5% one-sided
  // pessimistic, and always report the ±3% CI from 02 §13.7"). Before this,
  // the band opened one-sided but the headline number itself stayed at the
  // raw equivalence — the exact point estimate §14.7 says "systematically
  // over-predict[s]". The adjusted projection is MODELLED, and
  // `specificityAdjustment` below is how a surface knows to mark it (~).
  // 2026-09-01 · Phase 3 of the P0 order · the current-equivalence read is
  // ONE exported function (`computeCurrentEquivalence`) so the canonical race
  // outlook (`lib/race/race-outlook.ts`) and this goal-relative wrapper cannot
  // blend durability two different ways. Byte-identical to the inline block it
  // replaces.
  const eq = await computeCurrentEquivalence({
    userUuid, raceDistanceMi, vdot, vdotAnchorDistanceMi: vdotAnchorDistanceMi ?? null,
  });
  const marathonSpecificTraining = eq.marathonSpecificTraining;
  const specificityAdjustment = eq.specificityAdjustment;
  const vdotProjectionSecRaw = eq.blendedRawSec;
  const durabilityBlend = eq.durabilityBlend;
  const vdotProjectionSec = eq.expectedSec;

  // 2026-08-28 · AHEAD-1 · hoisted from below (was computed only for the
  // trajectory) so the primary status ladder can read the same sustained,
  // HR-corroborated over-performance evidence resolveAheadOverride gates on.
  // Independent of driftSignals, so hoisting changes nothing else — same
  // call, just earlier.
  const overPerf = vdot != null
    ? await computeOverPerformanceBonus(userUuid, vdot).catch(() => ({ bonusVdot: 0, sessions: 0, medianBeatSPerMi: 0 }))
    : { bonusVdot: 0, sessions: 0, medianBeatSPerMi: 0 };

  // Collect drift signals · each detector returns 0 or 1 signal. Failures
  // (DB error, missing data) silently produce no signal · we never punish
  // a healthy runner because a query timed out.
  const driftSignals: DriftSignal[] = [];
  const detectors = [
    () => detectRecentRaceDrift(userUuid, goalSec, raceDistanceMi),
    () => detectVdotTrendDrift(userUuid),
    () => detectAerobicDecouplingDrift(userUuid),
    () => detectTempoPaceDrift(userUuid, vdot),
    () => detectPlanAdapterDrift(userUuid),
    () => detectMissedKeyWorkoutDrift(userUuid),
  ];
  for (const detect of detectors) {
    try {
      const signal = await detect();
      if (signal) driftSignals.push(signal);
    } catch {
      // swallow · a broken detector ≠ drift
    }
  }

  // Status ladder
  const strongCount = driftSignals.filter((s) => s.weight === 'strong').length;
  const mediumCount = driftSignals.filter((s) => s.weight === 'medium').length;
  const weakCount = driftSignals.filter((s) => s.weight === 'weak').length;

  let status: GoalStatus = 'on-track';
  if (strongCount >= 1 || mediumCount >= 2) {
    status = 'off-track';
  } else if (mediumCount >= 1 || weakCount >= 2) {
    status = 'watching';
  }

  // 2026-08-28 · AHEAD-1 · the ladder's missing rung. See resolveAheadOverride
  // for the full rationale + the exact thresholds it mirrors. Only ever
  // promotes a CLEAN on-track read; never overrides watching/off-track.
  status = resolveAheadOverride({
    status,
    vdotProjectionSec,
    goalSec,
    overPerformanceSessions: overPerf.sessions,
  });

  // Projection = goal until off-track OR genuinely ahead. The GOAL number
  // (goalSec) never moves either way — only which number this function
  // hands back as "the projection".
  const projectionSec = (status === 'off-track' || status === 'ahead') && vdotProjectionSec != null
    ? vdotProjectionSec
    : goalSec;

  const summary = composeSummary(status, driftSignals, goalSec, vdotProjectionSec);
  const [nextTestPoints, recentTestPoints] = await Promise.all([
    loadNextTestPoints(userUuid, vdot).catch(() => []),
    loadRecentTestPoints(userUuid, vdot).catch(() => []),
  ]);
  const transitions = composeTransitions(status, driftSignals);

  // 2026-06-11 · the goal-seeking trajectory. Current fitness + the planned
  // build, scaled by how the runner is actually executing the plan, projected
  // to race day. executionQuality reads the recent quality-session verdicts +
  // missed-workout signal; plannedTargetVdot reads the plan's prescribed
  // ceiling (so the gain can't exceed what the plan trains toward, and an
  // under-built plan gets flagged). Null when there's no current VDOT or the
  // race date is unknown — the display falls back to the static projection.
  // 2026-06-16 · computed BEFORE the confidence band so the band can center on
  // the race-day projection, not the frozen current-fitness number.
  // 2026-07-13 · S1 · absence awareness for execution quality. Execution is
  // the lever (CLAUDE.md) — a break has to MOVE the number, not be invisible.
  // Failure produces the neutral no-absence shape, so a query timeout can
  // never fabricate a break.
  const executionAbsence = await loadExecutionAbsence(userUuid)
    .catch(() => ({ daysSinceLastRun: null, recentMissedKeyDates: [] as string[] }));
  const executionQuality = executionQualityFromTestPoints(
    recentTestPoints,
    driftSignals.some((s) => s.kind === 'missed_key_workouts'),
    executionAbsence.daysSinceLastRun,
    executionAbsence.recentMissedKeyDates,
  );
  const plannedTargetVdot = vdot != null
    ? await loadPlannedTargetVdot(userUuid).catch(() => null)
    : null;
  // 2026-06-12 · the UPGRADE gear · symmetric opposite of the drift detectors.
  // Controlled over-performance on recent threshold work → unconfirmed
  // training-derived fitness the projection can read PAST goal with. Projection
  // space only — never moves vdot or any prescribed pace. 0 unless he's beating
  // the plan, so this is dormant for a runner who's merely on track.
  // 2026-08-28 · AHEAD-1 · hoisted above the status ladder (see there) — reused
  // here, not recomputed, so the primary status and the trajectory read the
  // same evidence.
  // 2026-09-01 · goal-projection-durability follow-up · reuses the SAME
  // blended value `vdotProjectionSecRaw` above already computed for
  // `predictRaceTime(vdot, raceDistanceMi)` — `projectFitnessTrajectory`'s own
  // internal `predictRaceTime(currentVdot, raceDistanceMi)` is byte-identical
  // to that quantity's Daniels-only half (same vdot, same distance), so
  // passing the resolved blend in once, rather than re-resolving durability a
  // second time inside the trajectory call, is not a new duplication — it is
  // the existing one this file already had, now correctly kept in sync
  // instead of drifting into two different answers.
  const trajectory = (vdot != null && daysToRace != null)
    ? projectFitnessTrajectory({
        currentVdot: vdot,
        goalSec,
        raceDistanceMi,
        weeksToRace: daysToRace / 7,
        executionQuality,
        plannedTargetVdot,
        overPerformanceBonusVdot: overPerf.bonusVdot,
        currentSecOverride: vdotProjectionSecRaw,
      })
    : null;

  // 2026-06-08 · confidence band + 2026-06-16 · RE-ANCHORED to the race-day
  // projection. The band centers on trajectory.projectedSec so it reads "where
  // you'll likely finish" with the goal sitting inside it — not the frozen
  // current-fitness number (whose band sat slower than the projection shown
  // above it, which read as a contradiction). Falls back to vdotProjectionSec
  // when there's no trajectory. The confidence label (goal attainment) is
  // computed once here so web / iPhone / watch all read one number.
  // (marathonSpecificTraining resolved at the top of this function — SPEC-CENTER
  // hoisted it so the +5% center adjustment and this band read one answer.)
  const confidenceInterval = computeConfidenceInterval({
    centerSec: trajectory?.projectedSec ?? vdotProjectionSec,
    raceDistanceMi,
    status,
    pacing: pacing ?? null,
    vdotAnchorDateISO: vdotAnchorDateISO ?? null,
    vdotAnchorDistanceMi: vdotAnchorDistanceMi ?? null,
    marathonSpecificTraining,
  });
  const confidenceLabel = computeConfidenceLabel({
    goalSec,
    raceDistanceMi,
    vdot,
    daysToRace: daysToRace ?? null,
    status,
  });

  return {
    status,
    projectionSec,
    goalSec,
    vdotProjectionSec,
    durabilityBlend,
    driftSignals,
    summary,
    nextTestPoints,
    recentTestPoints,
    transitions,
    confidenceInterval,
    confidenceLabel,
    marathonSpecificTraining,
    specificityAdjustment,
    trajectory,
  };
}

/** 2026-08-28 · AHEAD-1 · margin that promotes a clean on-track read to
 *  'ahead'. Mirrors detectRecentRaceDrift's STRONG threshold (`strongAt = 10
 *  + marginPct`, see that detector's threshold comment) applied in the OTHER
 *  direction — no cross-distance margin applies here because
 *  vdotProjectionSec is already expressed at raceDistanceMi, the same
 *  distance as goalSec, so marginPct is always 0. 10% is the same "~2 VDOT
 *  points, very clear territory" bar the off-track side calls undeniable;
 *  not a new number invented for this rung. */
export const AHEAD_STRONG_PCT = 10;

/**
 * 2026-08-28 · AHEAD-1 · [[feedback_progress_is_the_guiding_light]] (locked
 * 2026-08-25): current fitness is a floor, not a ceiling. Before this, the
 * status ladder had no rung for "genuinely beating the goal" — projectionSec
 * stayed pinned at goalSec for on-track AND watching, so a runner who was
 * demonstrably faster than their stated goal still saw the goal number
 * staring back, forever, unless something went WRONG. Drift already reads
 * short (off-track); this is the missing symmetric read.
 *
 * Two gates, both mirrored from existing rigor rather than invented:
 *
 *   1. MAGNITUDE · AHEAD_STRONG_PCT (10%), the same bar detectRecentRaceDrift
 *      calls STRONG / "very clear" territory, applied to vdotProjectionSec
 *      vs goalSec instead of a past race vs goalSec.
 *   2. SUSTAINED EVIDENCE · overPerformanceSessions >= MIN_SESSIONS, the
 *      exact gate computeOverPerformanceBonus already enforces before it will
 *      credit ANY training-derived over-performance (>= 2 controlled,
 *      HR-corroborated threshold sessions beating prescribed pace within the
 *      last 28 days — see that function's doc comment). Reusing its `sessions`
 *      count here (not a new threshold) is what stops one fast tempo, or a
 *      single old PR sitting far ahead of a since-lowered goal, from flipping
 *      the headline. Note the gate is on SESSION COUNT, not `bonusVdot` — a
 *      runner can clear this floor with well-executed, HR-controlled
 *      threshold work even in a stretch where the demonstrated pace doesn't
 *      itself exceed current VDOT; the corroboration is "is this runner
 *      training in a way that supports a faster read right now", not "did
 *      training add extra VDOT on top of the race anchor".
 *
 * Only ever promotes a CLEAN 'on-track' read — a runner with an active
 * drift signal (watching/off-track) never gets bumped to 'ahead', even if
 * vdotProjectionSec momentarily clears the margin; a real gap the OTHER way
 * is exactly the case doctrine says stays honest, not softened. And this
 * never touches goalSec — [[feedback_no_forced_goal_decisions]] (the coach
 * projects, it never renegotiates a stated goal): the runner's number is
 * theirs; only what the projection reports about it can move.
 *
 * Pure + exported so it is unit-testable without the DB every detector in
 * this file needs.
 */
export function resolveAheadOverride(args: {
  status: GoalStatus;
  vdotProjectionSec: number | null;
  goalSec: number;
  /** computeOverPerformanceBonus's `sessions` count — controlled, HR-gated
   *  threshold sessions beating prescribed pace, regardless of whether they
   *  cleared MIN_SESSIONS for a nonzero bonusVdot (see doc comment above). */
  overPerformanceSessions: number;
}): GoalStatus {
  const { status, vdotProjectionSec, goalSec, overPerformanceSessions } = args;
  if (status !== 'on-track') return status; // never override watching/off-track
  if (vdotProjectionSec == null || !(goalSec > 0)) return status;
  const MIN_SESSIONS = 2; // [mirrors computeOverPerformanceBonus's MIN_SESSIONS]
  if (overPerformanceSessions < MIN_SESSIONS) return status;
  const aheadPct = (goalSec - vdotProjectionSec) / goalSec * 100;
  return aheadPct >= AHEAD_STRONG_PCT ? 'ahead' : status;
}

/** 2026-06-11 · execution quality 0..1 from recent quality-session verdicts +
 *  whether key workouts are being missed. Feeds the fitness trajectory's slope:
 *  a runner hitting every session projects the full planned build; one missing
 *  or under-hitting sessions projects a discounted slope. Recency-weighted —
 *  the most recent session counts most. Default 0.7 when there's no verdict
 *  signal yet (assume roughly-following the plan, not nailing it). */
export function executionQualityFromTestPoints(
  points: GoalProjection['recentTestPoints'],
  missedKeyWorkouts: boolean,
  // 2026-07-13 · S1 · absence inputs (optional, defaulted so the pre-fix
  // 2-arg call stays byte-identical):
  //   · daysSinceLastRun · drives the inactivity decay.
  //   · recentMissedKeyDates · dates of recent unrun key sessions, merged by
  //     DATE with the completed verdicts (not jammed to the front).
  // When both are at their defaults the result is byte-identical to the
  // pre-fix verdict-only average (no folded skips, no decay).
  daysSinceLastRun: number | null = null,
  recentMissedKeyDates: string[] = [],
): number {
  // ── S1 tunables · execution honesty only (NO physiological fitness decay).
  // A break lowers q because the plan is not being RUN, not because fitness is
  // being measured as lost.
  const STALE_ONSET_DAYS = 7;   // [TUNABLE] days off before inactivity decay begins
  const STALE_FULL_DAYS = 14;   // [TUNABLE] days off at which decay reaches the floor
  const STALE_FLOOR = 0.5;      // [TUNABLE] decay multiplier floor at STALE_FULL_DAYS
  const MISSED_KEY_SCORE = 0.0; // [TUNABLE] a fully-skipped key session = zero-execution point

  // fast = over-eager but hitting the work; slow = a real miss vs target.
  const score = (v: 'on' | 'fast' | 'slow' | null): number =>
    v === 'on' ? 1.0 : v === 'fast' ? 0.9 : 0.45;

  // 2026-07-13 · fix · merge completed verdicts and missed key sessions into
  // ONE date-ordered sequence (most-recent first) BEFORE recency-weighting, so
  // a skip that is OLDER than your latest completed sessions weighs LESS than
  // them — not more. The prior version folded every missed session at the top
  // (weights 1.0, 0.5, …) regardless of date, so a runner who missed a stretch
  // and then CAME BACK still read as if the misses were the newest signal
  // (e.g. real case: missed 07-05/07-07, completed 07-09/07-12, yet execution
  // read 34% because the two zeros took the top two weights ahead of the
  // comeback runs). Merging by date puts the completed comeback runs first.
  const merged: Array<{ dateISO: string; val: number }> = [
    ...points.filter((p) => p.verdict != null).map((p) => ({ dateISO: p.dateISO, val: score(p.verdict) })),
    ...(recentMissedKeyDates ?? []).map((d) => ({ dateISO: d, val: MISSED_KEY_SCORE })),
  ].sort((a, b) => (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : 0));

  let q: number;
  if (merged.length === 0) {
    q = missedKeyWorkouts ? 0.5 : 0.7;
  } else {
    let wsum = 0, w = 0;
    merged.forEach((pt, i) => {
      const weight = 1 / (i + 1);
      wsum += pt.val * weight;
      w += weight;
    });
    q = w > 0 ? wsum / w : 0.7;
  }
  if (missedKeyWorkouts) q *= 0.8;

  // Inactivity decay · once the gap reaches STALE_ONSET_DAYS the decay already
  // bites (the onset day is the first decremented step, not a free day), and
  // it ramps linearly to STALE_FLOOR at STALE_FULL_DAYS, clamped to the floor
  // beyond that. Extended time away from running keeps pulling q down after the
  // missed-session fold has been absorbed by newer completed work. Modeling the
  // gap, not fitness: the plan is not being run.
  if (daysSinceLastRun != null && daysSinceLastRun >= STALE_ONSET_DAYS) {
    const span = Math.max(1, STALE_FULL_DAYS - STALE_ONSET_DAYS + 1);
    const step = Math.min(span, daysSinceLastRun - STALE_ONSET_DAYS + 1);
    const t = step / span;
    const decay = 1 - (1 - STALE_FLOOR) * t;
    q *= decay;
  }

  return Math.round(Math.max(0, Math.min(1, q)) * 100) / 100;
}

/** 2026-07-13 · S1 · absence inputs for executionQuality. Execution is the
 *  lever (CLAUDE.md) — a rest week that logs no new completed sessions used to
 *  leave q frozen at its prior value, so a real break was invisible. Two reads,
 *  both dedup-aware (`NOT (data ? 'mergedIntoId')` — the ONE canonical-row
 *  predicate, `CANONICAL_ROW_SQL` in lib/runs/volume.ts) and runner-local.
 *  2026-08-24 · the `absorbed_into_canonical_at IS NULL` clause that used to
 *  sit beside it was REMOVED from all five queries in this file. The stamp is
 *  not a loser marker: a row promoted back to canonical keeps a stale stamp,
 *  and six of this runner's canonical rows carry one — 55.17 of 1114.72 mi,
 *  including the 18.00 mi long run of 2026-07-25 and the 13.13 mi of
 *  2026-06-14. Every one of those days read as ZERO miles here, so a run he
 *  completed was graded as a missed key session:
 *    · daysSinceLastRun · calendar days since the most recent honest run.
 *    · recentMissedKeyDates · dates of key sessions (long/tempo/threshold/
 *      intervals) in the PAST within the last 14 runner-local days with NO
 *      matching completed run (date match via
 *      COALESCE(data->>'date', LEFT(data->>'startLocal',10))). Dates (not a
 *      bare count) so executionQualityFromTestPoints can merge them by date
 *      with the completed verdicts instead of front-loading them.
 *  Honesty only · this counts unrun plan work, it does not model fitness loss. */
async function loadExecutionAbsence(userUuid: string): Promise<{
  daysSinceLastRun: number | null;
  recentMissedKeyDates: string[];
}> {
  const NONE = { daysSinceLastRun: null as number | null, recentMissedKeyDates: [] as string[] };
  const today = await runnerToday(userUuid);
  const MISSED_WINDOW_DAYS = 14; // [TUNABLE] look-back for recent missed key sessions
  const since = isoDaysBefore(today, MISSED_WINDOW_DAYS);

  const lastRow = (await pool.query<{ last_date: string | null }>(
    `SELECT MAX(COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))) AS last_date
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND NOT (r.data ? 'mergedIntoId')
        AND COALESCE((r.data->>'distanceMi')::numeric, 0) >= 1.0`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];

  let daysSinceLastRun: number | null = null;
  if (lastRow?.last_date) {
    const lastMs = Date.parse(lastRow.last_date + 'T12:00:00Z');
    const todayMs = Date.parse(today + 'T12:00:00Z');
    if (!isNaN(lastMs) && !isNaN(todayMs)) {
      daysSinceLastRun = Math.max(0, Math.round((todayMs - lastMs) / 86_400_000));
    }
  }

  const missedRows = (await pool.query<{ date_iso: string }>(
    `SELECT pw.date_iso
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.type IN ('long','tempo','threshold','intervals')
        AND pw.date_iso >= $2
        AND pw.date_iso < $3
        AND NOT EXISTS (
          SELECT 1 FROM runs r
           WHERE r.user_uuid = $1::uuid
             AND NOT (r.data ? 'mergedIntoId')
             AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) = pw.date_iso
             AND COALESCE((r.data->>'distanceMi')::numeric, 0) >= 1.0
        )
      ORDER BY pw.date_iso DESC`,
    [userUuid, since, today],
  ).catch(() => ({ rows: [] }))).rows;

  return {
    daysSinceLastRun,
    recentMissedKeyDates: missedRows.map((r) => r.date_iso).filter(Boolean),
  };
}

/** 2026-06-12 · the UPGRADE gear · the symmetric opposite of the drift detectors.
 *  Sustained, controlled over-performance on THRESHOLD work → unconfirmed
 *  training-derived fitness the forward projection can apply (projection space
 *  only — never moves currentVdot or any prescribed pace).
 *
 *  Research basis: VDOT updates canonically from races/TTs; a tempo landing
 *  "notably easier" is a +1-estimated LEAD that must be field-tested
 *  (Research/01 §triggers-to-retest). This productizes that lead as a labeled,
 *  capped projection bonus — NOT a canonical VDOT change. Intervals/long are
 *  excluded: the research treats them as stimulus, not fitness reads.
 *
 *  Gate (David 2026-06-12): a session counts only when the work-phase pace beat
 *  the prescribed target by ≥ BEAT_FLOOR s/mi AND avgHr stayed at/under LTHR —
 *  faster at threshold effort = fitter; faster with HR spiking = just overcooked,
 *  no signal. Needs ≥ MIN_SESSIONS so one hot tempo can't swing it. The bonus is
 *  the median demonstrated VDOT gain; the trajectory clamps it to the hard cap. */
async function computeOverPerformanceBonus(
  userUuid: string,
  currentVdot: number | null,
): Promise<{ bonusVdot: number; sessions: number; medianBeatSPerMi: number }> {
  const NONE = { bonusVdot: 0, sessions: 0, medianBeatSPerMi: 0 };
  if (!currentVdot) return NONE;
  const BEAT_FLOOR = 10;   // s/mi faster than prescribed to count as beating it
  const MIN_SESSIONS = 2;  // ≥2 controlled-fast sessions before the projection moves
  const today = await runnerToday(userUuid);
  const since = isoDaysBefore(today, 28);
  // 2026-07-06 · audit P1-11/P1-52 · bucket ci.ts (UTC sync instant) into
  // the RUNNER'S calendar day before joining to pw.date_iso (runner-local).
  // Was hardcoded 'America/Los_Angeles'; LA fallback for null-tz profiles
  // keeps the pre-fix behavior byte-identical.
  const ciTz = await runnerTimezoneOrPacific(userUuid);

  const lthr = (await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1::uuid LIMIT 1`, [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0]?.lthr ?? null;
  if (lthr == null) return NONE; // no HR governor → can't confirm "controlled"

  const rows = (await pool.query<{
    target_s: number | string | null;
    work_pace_s: number | string | null;
    avg_hr: number | string | null;
  }>(
    `SELECT pw.pace_target_s_per_mi AS target_s,
            ( SELECT AVG((phase->>'actualPaceSPerMi')::numeric)
                FROM coach_intents ci, jsonb_array_elements(
                  CASE jsonb_typeof(ci.value::jsonb) WHEN 'object'
                    THEN ci.value::jsonb->'phases' ELSE '[]'::jsonb END) AS phase
               WHERE COALESCE(ci.user_uuid, ci.user_id::uuid) = $1::uuid
                 AND ci.reason = 'watch_completion'
                 AND (ci.ts AT TIME ZONE $4::text)::date = pw.date_iso::date
                 AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                               WHERE COALESCE(ci2.user_uuid, ci2.user_id::uuid) = $1::uuid
                                 AND ci2.reason = 'watch_completion'
                                 AND (ci2.ts AT TIME ZONE $4::text)::date = pw.date_iso::date)
                 AND phase->>'type' = 'work' AND (phase->>'actualPaceSPerMi')::numeric > 0
            ) AS work_pace_s,
            -- AUDIT #35 · read the WORK-PHASE avg HR, not the whole-run avg HR.
            -- The honesty gate ("ran hot → overcooked") must compare HR from the
            -- SAME phase the pace is credited from. Whole-run avgHr is diluted by
            -- warm-up/cool-down (the route documents ~168 work-weighted → ~156
            -- whole-run), so an overcooked work block could clear hr > lthr.
            -- Mirrors the work_pace_s subquery above exactly: same latest
            -- watch_completion intent for the day, same phase->>'type' = 'work'
            -- filter, AVG across the work phases.
            ( SELECT AVG((phase->>'avgHr')::numeric)
                FROM coach_intents ci, jsonb_array_elements(
                  CASE jsonb_typeof(ci.value::jsonb) WHEN 'object'
                    THEN ci.value::jsonb->'phases' ELSE '[]'::jsonb END) AS phase
               WHERE COALESCE(ci.user_uuid, ci.user_id::uuid) = $1::uuid
                 AND ci.reason = 'watch_completion'
                 AND (ci.ts AT TIME ZONE $4::text)::date = pw.date_iso::date
                 AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                               WHERE COALESCE(ci2.user_uuid, ci2.user_id::uuid) = $1::uuid
                                 AND ci2.reason = 'watch_completion'
                                 AND (ci2.ts AT TIME ZONE $4::text)::date = pw.date_iso::date)
                 AND phase->>'type' = 'work' AND (phase->>'avgHr')::numeric > 0
            ) AS avg_hr
       FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
        AND pw.type IN ('tempo','threshold','race_week_tuneup')
        AND pw.date_iso >= $2 AND pw.date_iso <= $3`,
    [userUuid, since, today, ciTz],
  ).catch(() => ({ rows: [] }))).rows;

  const bonuses: number[] = [];
  const beats: number[] = [];
  for (const r of rows) {
    const target = r.target_s != null ? Number(r.target_s) : null;
    const work = r.work_pace_s != null ? Number(r.work_pace_s) : null;
    const hr = r.avg_hr != null ? Number(r.avg_hr) : null; // AUDIT #35 · work-phase HR
    if (target == null || work == null || hr == null) continue;
    const beatBy = target - work;      // +ve = faster than prescribed
    if (beatBy < BEAT_FLOOR) continue; // not meaningfully faster
    if (hr > lthr) continue;           // work-phase HR over LTHR → overcooked, not a fitness read
    const demonstrated = vdotFromTpace(work);
    if (demonstrated == null) continue;
    bonuses.push(Math.max(0, demonstrated - currentVdot));
    beats.push(beatBy);
  }
  if (bonuses.length < MIN_SESSIONS) return { ...NONE, sessions: bonuses.length };
  const median = (a: number[]): number => {
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return {
    bonusVdot: Math.round(median(bonuses) * 10) / 10,
    sessions: bonuses.length,
    medianBeatSPerMi: Math.round(median(beats)),
  };
}

/** Load the next 1-3 quality workouts from the active plan · tempo,
 *  threshold, intervals, long, race. Quality days are the test points
 *  · each one tells us something about current fitness.
 *
 *  2026-06-04 · exclude days where a real run already landed. Without
 *  this, today's completed tempo stays in the list as a "next" test
 *  point ("I did June 4 today · should we show its impact or remove
 *  it?" · David's QC). NOT EXISTS join against canonical runs (the
 *  same dedup-aware filter the rest of the system uses · skips
 *  absorbed/merged rows). Run-day-of-week 1mi-minimum guard so a tiny
 *  shake-out doesn't accidentally clear a planned tempo. */
async function loadNextTestPoints(
  userUuid: string,
  /** Current VDOT · drives the pass-criteria T-pace. Null → no criteria. */
  vdot: number | null = null,
): Promise<GoalProjection['nextTestPoints']> {
  const today = await runnerToday(userUuid);
  // 2026-06-09 Phase 2 (3.3) · pass criteria for T-pace test points.
  // paceMax = T + 10 (the exact slow edge detectTempoPaceDrift tolerates
  // before counting drift); hrMax = 0.975 × LTHR (at-or-under threshold ·
  // same line the tune-up's pass note uses). Computed once per call.
  const tPace = tPaceFromVdot(vdot);
  const lthr = (await pool.query<{ lthr: number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0]?.lthr ?? null;
  const T_PACE_CRITERIA_TYPES = new Set(['tempo', 'threshold', 'race_week_tuneup']);
  const criteriaFor = (type: string): { paceMaxSPerMi: number; hrMaxBpm: number | null } | null => {
    if (tPace == null || !T_PACE_CRITERIA_TYPES.has(type)) return null;
    return {
      paceMaxSPerMi: Math.round(tPace + 10),
      hrMaxBpm: lthr != null ? thresholdPassHrBpm(lthr) : null,
    };
  };
  const rows = (await pool.query<{
    date_iso: string;
    type: string;
    sub_label: string | null;
    distance_mi: number | string | null;
  }>(
    // 2026-07-13 · S3 · DISTINCT ON (pw.id) collapses to one row per plan day
    // before LIMIT so a duplicated plan row can't push a real test point out of
    // the window. Run/plan-day match uses COALESCE(date, startLocal[:10]) —
    // startLocal-only ingest rows (no top-level 'date') were previously invisible
    // to the completed-run guard, so a run landed day could still surface as a
    // "next" test point.
    `SELECT dedup.date_iso, dedup.type, dedup.sub_label, dedup.distance_mi
       FROM (
         SELECT DISTINCT ON (pw.id)
                pw.date_iso, pw.type, pw.sub_label, pw.distance_mi
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1::uuid
            AND tp.archived_iso IS NULL
            AND pw.type IN ('tempo','threshold','intervals','long','race','race_week_tuneup')
            AND pw.date_iso >= $2
            AND NOT EXISTS (
              SELECT 1 FROM runs r
               WHERE r.user_uuid = $1::uuid
                 AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) = pw.date_iso
                 AND NOT (r.data ? 'mergedIntoId')
                 AND COALESCE((r.data->>'distanceMi')::numeric, 0) >= 1.0
            )
          ORDER BY pw.id
       ) dedup
      ORDER BY dedup.date_iso ASC
      LIMIT 3`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows;

  return rows.map((r) => {
    const dist = r.distance_mi != null ? Number(r.distance_mi) : null;
    const distLabel = dist != null ? `${dist.toFixed(dist % 1 === 0 ? 0 : 1)}mi` : '';
    // sub_label like "4 mi @ T" preserves the workout architecture · use
    // it when present, else fall back to "4mi tempo" pattern.
    const label = r.sub_label && r.sub_label.length < 40
      ? `${distLabel} ${r.type}${r.sub_label !== r.type.toUpperCase() ? ' · ' + r.sub_label : ''}`.trim()
      : `${distLabel} ${r.type}`.trim();
    return {
      dateISO: r.date_iso,
      type: r.type,
      label,
      distanceMi: dist,
      passCriteria: criteriaFor(r.type),
    };
  });
}

// ── 2026-07-06 · P1-10 fix · honest execution basis for quality runs ──────
//
// The bug: for runs with no watch_completion payload (Strava-only / HK-only /
// manual — most of the universal population) the verdict fell back to WHOLE-RUN
// pace judged against the WORK-PHASE target. A tempo session is WU + work + CD,
// so overall pace reads ~30-50 s/mi slower than the work target (this file's
// own drift-detector comment quantifies it) — every correctly-executed tempo
// graded 'slow', executionQuality collapsed to ~0.45, and the Targets hero
// flipped BEHIND. detectTempoPaceDrift was fixed to abstain without watch data;
// this is the same honest-absence doctrine applied to the verdict path, plus
// two recoveries that keep a verdict alive when the data supports one:
//
//   1. work-phase-splits · mile splits + workout_spec phase distances locate
//      the work window inside the run; pace over that window vs the work
//      target. Only for a CONTIGUOUS work block (tempo) — mile splits can't
//      resolve sub-mile reps interleaved with jog recoveries.
//   2. blended-overall · whole-run pace vs a distance-weighted expectation
//      (WU/CD at easy pace + work at target + timed recoveries), built from
//      the same expandSpecToPhases every other consumer uses.
//
// When neither basis exists (no spec, no splits, no watch) the verdict is
// null — executionQualityFromTestPoints already filters null verdicts and
// falls back to its no-signal default (0.7), so absence reads as "roughly
// following the plan", never as a fabricated miss.
// Cite: Research/01-pace-zones-vdot.md (E/T bands · easy = T+80..T+120 per
// spec-builder/derivePaces); Research/06-weather-adjustments.md §1 (heat band).

/** Per-mile split reduced to the two numbers the window math needs. */
interface PaceSplit { distMi: number; timeS: number }

/** "8:44" / "8:44/mi" → 524 s/mi. Watch + HK ingest rows carry the per-mile
 *  pace ONLY as this display string (verified against live rows 2026-07-06 ·
 *  keys: hr, mile, pace, cadence, elev_ft, distanceMi) — without parsing it
 *  the splits basis would never fire for the watch/HK population. */
function paceStrToSec(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const s = Number(m[1]) * 60 + Number(m[2]);
  return s > 0 ? s : null;
}

/** Normalize runs.data.splits across source shapes · mirrors the resolution
 *  order in lib/coach/run-state.ts (paceSPerMi legacy · paceSecPerMi watch/HK
 *  numeric · pace_s_per_mi snake · "m:ss" pace string (watch/HK ingest) ·
 *  average_speed Strava m/s · elapsed_time+distance Strava fallback).
 *  Returns [] when any split lacks a resolvable pace — a hole breaks the
 *  cumulative-distance window math, so all-or-nothing. Single-split stubs on
 *  multi-mile runs are legacy phase summaries, not per-mile splits
 *  (run-state.ts 2026-06-05 rule) → []. */
export function normalizePaceSplits(raw: unknown): PaceSplit[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: PaceSplit[] = [];
  for (const s of raw as Array<Record<string, unknown>>) {
    if (!s || typeof s !== 'object') return [];
    const distM = Number(s.distance) || null;
    const distMi = Number(s.distanceMi ?? s.distance_mi)
      || (distM && distM > 0 ? distM / 1609.34 : 1.0);
    const avgSpeedMps = Number(s.average_speed) || null;
    const elapsedS = Number(s.elapsed_time ?? s.moving_time) || null;
    const sPerMi = Number(s.paceSPerMi)
      || Number(s.paceSecPerMi)
      || Number(s.pace_s_per_mi)
      || paceStrToSec(s.pace ?? s.pace_min_per_mi)
      || (avgSpeedMps && avgSpeedMps > 0 ? 1609.34 / avgSpeedMps : 0)
      || (elapsedS && elapsedS > 0 && distM && distM > 0 ? (elapsedS * 1609.34) / distM : 0);
    if (!sPerMi || sPerMi <= 0 || !isFinite(sPerMi) || distMi <= 0) return [];
    out.push({ distMi, timeS: sPerMi * distMi });
  }
  const totalMi = out.reduce((a, s) => a + s.distMi, 0);
  if (out.length === 1 && totalMi > 1.5) return [];
  return out;
}

/** Locate the single contiguous work window (miles from run start) in an
 *  expanded phase list. Returns null when work is split across disjoint
 *  blocks (threshold/intervals reps · mile splits can't resolve those) or
 *  the window is under half a mile. Time-only phases (jog recoveries)
 *  contribute their pace-implied distance to the cumulative axis. */
export function contiguousWorkWindowMi(
  phases: ExpandedPhase[],
): { startMi: number; endMi: number } | null {
  let cum = 0;
  let start: number | null = null;
  let end: number | null = null;
  let workClosed = false;
  for (const p of phases) {
    // RECOVERY-BYFEEL-1 (2026-09-01) · a between-rep jog now carries no
    // `targetPaceSPerMi` (it goes out by feel on the card and the wrist).
    // This is pure accounting — how far did the jog cover, so the cumulative
    // mile axis below stays right — not a target shown anywhere, so it falls
    // back to the same internal estimate `expandSpecToPhases` itself uses to
    // size a by-feel phase's `durationSec`.
    const d = p.distanceMi
      ?? (p.durationSec != null ? p.durationSec / (p.targetPaceSPerMi ?? DURATION_EST_S_PER_MI) : 0);
    if (p.type === 'work') {
      if (workClosed) return null; // second disjoint work block
      if (start == null) start = cum;
      end = cum + d;
    } else if (start != null) {
      workClosed = true;
    }
    cum += d;
  }
  if (start == null || end == null || end - start < 0.5) return null;
  return { startMi: start, endMi: end };
}

/** Average pace (s/mi) over a distance window, using only splits that sit
 *  FULLY inside the window (±0.05mi slack). Straddling splits are excluded —
 *  a mile that is half warmup, half tempo averages the two paces, and the
 *  uniform-pace-within-a-split assumption is systematically wrong exactly at
 *  phase transitions (it read a perfectly-executed tempo ~10-15 s/mi hot at
 *  the edges). Requires the inside splits to cover ≥ half the window and
 *  ≥ 1 mile — under that there's no honest read → null. */
export function paceOverWindow(
  splits: PaceSplit[],
  startMi: number,
  endMi: number,
): number | null {
  const EPS = 0.05;
  let cum = 0, t = 0, d = 0;
  for (const s of splits) {
    const sStart = cum;
    const sEnd = cum + s.distMi;
    if (sStart >= startMi - EPS && sEnd <= endMi + EPS && s.distMi > 0) {
      t += s.timeS;
      d += s.distMi;
    }
    cum = sEnd;
  }
  if (d < Math.max(1.0, (endMi - startMi) * 0.5)) return null;
  return t / d;
}

/** Total expected time + distance from an expanded phase list:
 *  WU/CD at easy pace + work at target + timed recoveries at recovery pace.
 *  Null when any phase can't resolve both axes. */
export function blendedExpectation(
  phases: ExpandedPhase[],
): { timeS: number; distMi: number } | null {
  let t = 0, d = 0;
  for (const p of phases) {
    // RECOVERY-BYFEEL-1 (2026-09-01) · see the identical comment in
    // `contiguousWorkWindowMi` — a by-feel jog's distance-equivalent for THIS
    // accounting question falls back to the same internal estimate
    // `expandSpecToPhases` already sizes its own `durationSec` from, rather
    // than aborting the whole blend the moment one phase declines to name a
    // pace it was never going to be graded against.
    const pace = p.targetPaceSPerMi ?? DURATION_EST_S_PER_MI;
    const dist = p.distanceMi
      ?? (p.durationSec != null ? p.durationSec / pace : null);
    const dur = p.durationSec
      ?? (dist != null ? dist * pace : null);
    if (dist == null || dur == null || dist < 0 || dur < 0) return null;
    t += dur;
    d += dist;
  }
  return d > 0 ? { timeS: t, distMi: d } : null;
}

/** Distance-weighted whole-run pace expectation · Σtime / Σdistance. */
export function blendedOverallTargetSPerMi(phases: ExpandedPhase[]): number | null {
  const e = blendedExpectation(phases);
  return e ? e.timeS / e.distMi : null;
}

/** Easy pace for WU/CD in the blend. Canonical: T-pace from VDOT + 100
 *  (midpoint of the spec-builder/derivePaces easy band T+80..T+120 ·
 *  Research/01-pace-zones-vdot.md). No-VDOT fallback anchors on the work
 *  target itself: tempo/threshold/tuneup targets ≈ T (PACE-T-1); intervals
 *  target = I = T−18 (derivePaces intervalSec). WU/CD carry ~30% of a
 *  quality day's distance, so a ±20 s/mi easy-pace error moves the blend
 *  ≤ ~6 s/mi — inside the band. Null only when both anchors are missing. */
export function easyPaceForBlend(
  vdot: number | null,
  type: string,
  targetS: number | null,
): number | null {
  const t = tPaceFromVdot(vdot);
  if (t != null) return t + 100;
  if (targetS == null || targetS <= 0) return null;
  return type === 'intervals' ? targetS + 118 : targetS + 100;
}

/** Work-target quality types · pace_target_s_per_mi is the WORK-phase pace,
 *  never a fair whole-run comparison (spec-builder tempo/threshold/intervals/
 *  race_week_tuneup branches all return paceTargetSPerMi = work pace). */
const WORK_TARGET_TYPES = new Set(['tempo', 'threshold', 'intervals', 'race_week_tuneup']);

/**
 * 2026-07-06 · P1-10 fix · pure verdict resolution for one recent test point.
 * Exported for tests. Basis ladder (first honest read wins):
 *   1. work-phase-watch  · watch_completion work pace vs work target, at
 *                          `sessionToleranceSec` for this session's class
 *   2. work-phase-splits · splits-derived work-window pace vs work target,
 *                          same width
 *   3. blended-overall   · overall pace vs WU/CD/work blend, at doctrine's own
 *                          E width — the blend is dominated by easy running
 *   4. abstain           · verdict null (honest absence · matches
 *                          detectTempoPaceDrift's no-watch-data doctrine)
 * Non-work-target types (long/race) keep the whole-run comparison — there the
 * target IS the whole-run pace (long guide band mid / race pace).
 */
export function judgeTestPointExecution(input: {
  type: string;
  targetS: number | null;
  watchWorkS: number | null;
  overallS: number | null;
  rawSplits: unknown;
  splitsUnreliable: boolean;
  spec: WorkoutSpec;
  plannedDistanceMi: number | null;
  actualDistanceMi: number | null;
  vdot: number | null;
  heatSlowdownPct: number;
  /** VERDICT-1 · THE canonical grade for the day, when the caller resolved
   *  one. Rung 1 reads it; a session graded `executed` is `on`, one graded
   *  `off_target` is `slow`, and only a mixed set falls back to the mean. */
  grade?: WorkoutVerdict | null;
}): {
  actualS: number | null;
  verdict: 'on' | 'fast' | 'slow' | null;
  basis: TestPointVerdictBasis | null;
} {
  const { type, targetS, watchWorkS, overallS, heatSlowdownPct } = input;
  /* THE tolerance, from THE owner (`lib/training/execution-semantics.ts`).
   *
   * This was `type === 'long' ? 40 : 10` — a THIRD width, on the pipeline
   * that feeds evidence and adaptation, against a ±8 the runner was shown and
   * a ±8 the wrist graded. On the owner's 2026-09-01 threshold session the two
   * engines returned opposite answers for the same four reps, and he only ever
   * saw the harsher one. One table now, keyed off the same classifier the
   * phone and the wrist use. */
  const tolerance = sessionToleranceSec(
    classifySession(type, input.spec as unknown as Record<string, unknown>),
  );
  const hasTarget = targetS != null && targetS > 0;

  // 1 · watch work phases · THE canonical grade when the caller resolved one.
  //     The per-rep verdicts decide; the mean is only asked when the set was
  //     mixed, because a mean of 435 over a 425 and a 445 is not "on".
  const g = input.grade;
  if (g && g.basis === 'watch-phases' && g.work.graded > 0) {
    const actualS = g.work.paceSPerMi ?? (watchWorkS != null && watchWorkS > 0 ? Math.round(watchWorkS) : null);
    return {
      actualS,
      verdict: hasTarget
        ? testPointVerdictFor(g, () => (actualS != null
            ? heatAdjustedStatus(targetS!, actualS, heatSlowdownPct, tolerance) : null))
        : null,
      basis: 'work-phase-watch',
    };
  }
  // 1b · the work-phase MEAN alone, for a caller with no grade.
  if (watchWorkS != null && watchWorkS > 0) {
    const actualS = Math.round(watchWorkS);
    return {
      actualS,
      verdict: hasTarget ? heatAdjustedStatus(targetS!, actualS, heatSlowdownPct, tolerance) : null,
      basis: 'work-phase-watch',
    };
  }

  // Long/race · pace_target_s_per_mi is a whole-run pace → overall pace is
  // a fair comparison. Preserves pre-fix behavior for these types.
  if (!WORK_TARGET_TYPES.has(type)) {
    if (overallS == null || overallS <= 0) return { actualS: null, verdict: null, basis: null };
    return {
      actualS: overallS,
      verdict: hasTarget ? heatAdjustedStatus(targetS!, overallS, heatSlowdownPct, tolerance) : null,
      basis: 'overall',
    };
  }

  // Quality day without watch data. Never judge overall pace against the
  // bare work target — that's the P1-10 bug.
  if (!hasTarget || overallS == null || overallS <= 0) {
    return { actualS: overallS ?? null, verdict: null, basis: null };
  }

  const easyPaceSec = easyPaceForBlend(input.vdot, type, targetS);
  const phases = (input.spec && easyPaceSec != null)
    ? expandSpecToPhases({
        spec: input.spec,
        totalMi: input.plannedDistanceMi ?? input.actualDistanceMi ?? 8,
        easyPaceSec,
        recoveryPaceSec: 540,
      })
    : null;
  if (!phases || phases.length === 0) {
    // No spec (pre-migration rows) → abstain. Pre-fix these fabricated
    // 'slow'; honest absence beats a wrong number.
    return { actualS: overallS, verdict: null, basis: null };
  }

  // 2 · splits-derived work-window pace. Requires reliable per-mile splits,
  // a contiguous work block, and an actual distance near plan (a rerouted
  // 6mi run can't be windowed by an 8mi plan's mile axis).
  if (!input.splitsUnreliable) {
    const splits = normalizePaceSplits(input.rawSplits);
    const distOk = input.actualDistanceMi != null && input.plannedDistanceMi != null
      && Math.abs(input.actualDistanceMi - input.plannedDistanceMi)
           <= Math.max(1.0, input.plannedDistanceMi * 0.15);
    if (splits.length >= 2 && distOk) {
      const window = contiguousWorkWindowMi(phases);
      const workPace = window ? paceOverWindow(splits, window.startMi, window.endMi) : null;
      if (workPace != null && workPace > 0) {
        const actualS = Math.round(workPace);
        return {
          actualS,
          verdict: heatAdjustedStatus(targetS!, actualS, heatSlowdownPct, tolerance),
          basis: 'work-phase-splits',
        };
      }
    }
  }

  // 3 · blended whole-run expectation, reconciled with the ACTUAL distance
  //     (live rows show runners tack extra miles onto the planned shape ·
  //     e.g. a 3mi tempo spec inside a 5.8mi run):
  //   · ran LONGER  · pad the expectation with the extra miles at easy pace —
  //                   nobody runs bonus tempo; extra distance is easy volume.
  //   · ran well SHORT of the spec (> 1mi / 15%) · abstain — we can't know
  //     whether the work block or the WU/CD got cut, so no honest blend.
  const exp = blendedExpectation(phases);
  if (exp != null && exp.timeS > 0 && exp.distMi > 0) {
    let { timeS, distMi } = exp;
    const actual = input.actualDistanceMi;
    if (actual != null && actual > distMi + 0.1) {
      timeS += (actual - distMi) * easyPaceSec!; // easyPaceSec non-null when phases exist
      distMi = actual;
    } else if (actual != null && actual < distMi - Math.max(1.0, distMi * 0.15)) {
      return { actualS: overallS, verdict: null, basis: null };
    }
    const blend = timeS / distMi;
    return {
      actualS: overallS,
      /* The blended basis compares a WHOLE-RUN average against a blend of the
       * session's own legs, so it inherits the widest band in the blend rather
       * than inventing one: the WU/CD legs are easy running
       * (`EASY_PHASE_TOLERANCE_S_PER_MI`, doctrine's own E row) and that is
       * what dominates a run-level comparison. Was a bare `15`. */
      verdict: heatAdjustedStatus(
        Math.round(blend), overallS, heatSlowdownPct, EASY_PHASE_TOLERANCE_S_PER_MI,
      ),
      basis: 'blended-overall',
    };
  }

  // 4 · abstain.
  return { actualS: overallS, verdict: null, basis: null };
}

/**
 * 2026-06-04 · the past 3 quality workouts that landed a real run.
 * Mirrors loadNextTestPoints in shape but joins to canonical runs to
 * pull the actual pace + weather, then derives a verdict on the fly.
 * Same band rule as lib/coach/run-state.ts loadPhaseBreakdown so the
 * Targets page agrees with the phase breakdown table on the Run Detail
 * page.
 *
 * Verdict bands · plain, symmetric, never widened for heat (removed
 * 2026-08-27 per David — he paces off feel, not a heat allowance; see
 * `heatAdjustedStatus` in lib/coach/heat-band.ts):
 *   · 'on'   · actual ∈ [target − 10s, target + 10s]
 *   · 'fast' · actual < target − 10s (overcooked vs plan)
 *   · 'slow' · actual > target + 10s (real miss)
 *
 * 2026-07-06 · P1-10 fix · WHAT gets compared is now resolved per-point by
 * judgeTestPointExecution (work-phase pace when watch or splits carry it,
 * blended whole-run expectation otherwise, abstention when nothing honest
 * exists). vdot threads through for the easy-pace leg of the blend.
 */
/**
 * 2026-08-17 · exported and windowable for the adaptation model.
 *
 * The projection wants the last handful of test points; the adaptation model
 * wants every judged session in its window. Same judgement either way — the
 * basis ladder and the double-ingest dedup must not be reimplemented
 * anywhere, which is what a second copy of this query would be.
 *
 * @param limit    how many points, newest first. Default 3 (the projection's).
 * @param sinceISO oldest date to include. Null keeps the original behaviour.
 */
export async function loadRecentTestPoints(
  userUuid: string,
  vdot: number | null,
  limit = 3,
  sinceISO: string | null = null,
  includeArchivedPlans = false,
): Promise<GoalProjection['recentTestPoints']> {
  const today = await runnerToday(userUuid);
  // 2026-07-06 · audit P1-11 · runner-local day bucketing for ci.ts
  // (see computeOverPerformanceBonus).
  const ciTz = await runnerTimezoneOrPacific(userUuid);
  // 2026-06-04 · pull the work-phase pace from coach_intents
  // (watch_completion) when available · otherwise fall back to
  // overall pace. Overall pace on tempo/intervals/threshold is
  // dragged down by WU + CD + recovery jogs and isn't a fair
  // comparison to the tempo block pace target.
  const rows = (await pool.query<{
    date_iso: string;
    type: string;
    sub_label: string | null;
    distance_mi: number | string | null;
    pace_target_s: number | string | null;
    distance_actual: string | null;
    duration_s: string | null;
    weather: unknown;
    work_pace_s: number | string | null;
    work_phases: unknown;
    workout_spec: WorkoutSpec;
    splits: unknown;
    splits_unreliable: boolean | null;
  }>(
    // 2026-07-13 · S3 · DISTINCT ON (pw.id) collapses a double-ingest (two
    // canonical runs on one plan day) to a single row BEFORE the LIMIT, so it
    // can't double-count into the recency-weighted execution average. Canonical
    // pick prefers the richer row (has splits, then longer distance, then newer
    // id). Run/plan-day match uses COALESCE(date, startLocal[:10]) so
    // startLocal-only ingest rows still join.
    `SELECT dedup.date_iso, dedup.type, dedup.sub_label,
            dedup.distance_mi, dedup.pace_target_s, dedup.workout_spec,
            dedup.distance_actual, dedup.duration_s, dedup.weather,
            dedup.splits, dedup.splits_unreliable, dedup.work_pace_s,
            dedup.work_phases
       FROM (
         SELECT DISTINCT ON (pw.id)
                pw.id AS pw_id, pw.date_iso, pw.type, pw.sub_label,
                pw.distance_mi, pw.pace_target_s_per_mi AS pace_target_s,
                pw.workout_spec,
                r.data->>'distanceMi' AS distance_actual,
                r.data->>'durationSec' AS duration_s,
                r.data->'weather' AS weather,
                -- P1-10 fix · per-mile splits + reliability flag so non-watch
                -- runs can still get a work-phase read (see judgeTestPointExecution).
                r.data->'splits' AS splits,
                (r.data->>'splits_unreliable')::boolean AS splits_unreliable,
                -- Work-phase actual pace from the watch_completion blob.
                -- jsonb_path_query_first returns the first matching value ·
                -- we then cast to numeric. NULL when no watch payload exists
                -- for the date (Strava-only / HK-only / manual runs).
                (
                  SELECT AVG((phase->>'actualPaceSPerMi')::numeric)
                    FROM coach_intents ci,
                         jsonb_array_elements(
                           CASE jsonb_typeof(ci.value::jsonb)
                             WHEN 'object' THEN ci.value::jsonb->'phases'
                             ELSE '[]'::jsonb
                           END
                         ) AS phase
                   WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
                     AND ci.reason = 'watch_completion'
                     AND (ci.ts AT TIME ZONE $3::text)::date = pw.date_iso::date
                     AND phase->>'type' = 'work'
                     AND (phase->>'actualPaceSPerMi')::numeric > 0
                ) AS work_pace_s,
                -- VERDICT-1 · the LATEST completion's phase array for the day,
                -- so the test point is graded by the canonical resolver rather
                -- than by a comparator over the AVG above. Same date match.
                (
                  SELECT CASE jsonb_typeof(ci.value::jsonb)
                           WHEN 'object' THEN ci.value::jsonb->'phases'
                           ELSE NULL
                         END
                    FROM coach_intents ci
                   WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
                     AND ci.reason = 'watch_completion'
                     AND (ci.ts AT TIME ZONE $3::text)::date = pw.date_iso::date
                   ORDER BY ci.id DESC
                   LIMIT 1
                ) AS work_phases
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
           JOIN runs r
             ON r.user_uuid = $1::uuid
            AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) = pw.date_iso
            AND NOT (r.data ? 'mergedIntoId')
            AND COALESCE((r.data->>'distanceMi')::numeric, 0) >= 1.0
          WHERE tp.user_uuid = $1::uuid
            AND ($6::boolean OR tp.archived_iso IS NULL)
            AND pw.type IN ('tempo','threshold','intervals','long','race','race_week_tuneup')
            AND pw.date_iso <= $2
            AND ($5::text IS NULL OR pw.date_iso >= $5)
          ORDER BY pw.id,
                   (r.data ? 'splits') DESC,
                   COALESCE((r.data->>'distanceMi')::numeric, 0) DESC,
                   r.id DESC
       ) dedup
      ORDER BY dedup.date_iso DESC
      LIMIT $4`,
    [userUuid, today, ciTz, limit, sinceISO, includeArchivedPlans],
  ).catch(() => ({ rows: [] }))).rows;

  if (rows.length === 0) return [];

  const { judgeWeather } = await import('@/lib/coach/weather-adjust');

  return rows.map((r) => {
    const dist = r.distance_mi != null ? Number(r.distance_mi) : null;
    const distLabel = dist != null ? `${dist.toFixed(dist % 1 === 0 ? 0 : 1)}mi` : '';
    const label = r.sub_label && r.sub_label.length < 40
      ? `${distLabel} ${r.type}${r.sub_label !== r.type.toUpperCase() ? ' · ' + r.sub_label : ''}`.trim()
      : `${distLabel} ${r.type}`.trim();

    // Heat context resolved per test point (per-finding context filters ·
    // CLAUDE.md 2026-05-19 round 4) before any comparison happens.
    const w = (r.weather && typeof r.weather === 'object') ? r.weather as Record<string, unknown> : null;
    let heatSlowdownPct = 0;
    if (w) {
      try {
        const j = judgeWeather({
          tempF: typeof w.temp_f === 'number' ? w.temp_f : null,
          tempF_start: typeof w.temp_f_start === 'number' ? w.temp_f_start : null,
          tempF_end: typeof w.temp_f_end === 'number' ? w.temp_f_end : null,
          tempF_peak: typeof w.temp_f_peak === 'number' ? w.temp_f_peak : null,
          humidityPct: typeof w.humidity_pct === 'number' ? w.humidity_pct : null,
          windMph: typeof w.wind_mph === 'number' ? w.wind_mph : null,
          conditions: typeof w.conditions === 'string' ? w.conditions : null,
          cloudCoverPct: typeof w.cloud_cover_pct === 'number' ? w.cloud_cover_pct : null,
          durationS: r.duration_s != null ? Number(r.duration_s) : null,
        });
        heatSlowdownPct = j.slowdownPct ?? 0;
      } catch { /* leave 0 · band collapses to symmetric */ }
    }

    const workS = r.work_pace_s != null ? Number(r.work_pace_s) : null;
    const overallS = (() => {
      const distAct = r.distance_actual != null ? Number(r.distance_actual) : 0;
      const durS = r.duration_s != null ? Number(r.duration_s) : 0;
      if (distAct > 0 && durS > 0) return Math.round(durS / distAct);
      return null;
    })();
    const targetS = r.pace_target_s != null ? Number(r.pace_target_s) : null;

    // P1-10 fix · basis ladder replaces the old "overall pace vs work
    // target" fallback that flipped every warmup-included quality run to
    // 'slow'. Easy/long band note (David 2026-06-11) lives inside the
    // judge: long keeps the generous ±40, quality keeps the tight ±10
    // on work-phase bases and ±15 on the blended whole-run basis.
    const judged = judgeTestPointExecution({
      type: r.type,
      targetS,
      watchWorkS: workS,
      overallS,
      rawSplits: r.splits,
      splitsUnreliable: r.splits_unreliable === true,
      spec: r.workout_spec ?? null,
      plannedDistanceMi: dist,
      actualDistanceMi: r.distance_actual != null ? Number(r.distance_actual) || null : null,
      vdot,
      heatSlowdownPct,
      grade: r.work_phases != null
        ? resolveWorkoutVerdict({
            type: r.type,
            spec: (r.workout_spec ?? null) as unknown as Record<string, unknown> | null,
            phases: r.work_phases,
          })
        : null,
    });
    const actualS = judged.actualS;
    const actualPace = actualS && actualS > 0
      ? `${Math.floor(actualS / 60)}:${String(actualS % 60).padStart(2, '0')}`
      : null;

    return {
      dateISO: r.date_iso,
      type: r.type,
      label,
      distanceMi: dist,
      actualPace,
      verdict: judged.verdict,
      verdictBasis: judged.basis,
    };
  });
}

/** Compose human-readable "what flips the status" copy. Tied to the
 *  current signals · tells the runner WHAT moves the gauge without
 *  being prescriptive. */
function composeTransitions(
  status: GoalStatus,
  signals: DriftSignal[],
): GoalProjection['transitions'] {
  if (status === 'ahead') {
    // 2026-08-28 · AHEAD-1 · the top of the ladder now. Nothing to promote
    // to; show what would settle it back to on-track (never a demotion word —
    // on-track isn't worse, it's just no longer showing a demonstrated edge).
    return {
      toBetter: null,
      toWorse: 'Settles back to on track if the fitness margin over the goal narrows below 10%, or the sustained threshold work behind it stops landing.',
    };
  }
  if (status === 'on-track') {
    // ON TRACK · already at the top. Show what would tip to WATCHING.
    return {
      toBetter: null,
      toWorse: 'Watching fires if a recent race lands 5%+ off goal · OR if aerobic decoupling widens · OR if tempo paces drift 10s/mi slower for 3 weeks · OR if the plan adapter forces 2+ weeks of downgrades.',
    };
  }
  if (status === 'watching') {
    // WATCHING · could flip either direction. Build "to better" from
    // the active signals · whatever clears the medium signal puts us
    // back ON TRACK.
    const medium = signals.find((s) => s.weight === 'medium');
    const toBetter = medium
      ? clearSignalCopy(medium)
      : 'Clear the soft signals · the next quality run hitting plan pace puts the plan back on the path.';
    return {
      toBetter,
      toWorse: 'OFF TRACK fires if another medium signal stacks on this one · OR if a recent race lands 10%+ off goal · OR if VDOT trend drops 1+ point over 4 weeks.',
    };
  }
  // OFF TRACK · already at the bottom. Show what would tip back to
  // WATCHING.
  const strong = signals.find((s) => s.weight === 'strong');
  if (strong && strong.kind === 'recent_race') {
    return {
      toBetter: 'A new race result within 5% of goal (or sustained tempo/threshold work at goal pace) lifts the status back to watching.',
      toWorse: null,
    };
  }
  if (strong && strong.kind === 'vdot_trend') {
    return {
      toBetter: 'A VDOT-yielding quality session that beats the current 4-week-ago estimate reverses the trend.',
      toWorse: null,
    };
  }
  return {
    toBetter: 'Clearing the strongest drift signal lifts the status back to watching · a tune-up race or a few weeks of plan-paced quality work usually does it.',
    toWorse: null,
  };
}

/** Per-signal "what clears this" copy. The runner sees exactly what
 *  the engine is waiting for. */
function clearSignalCopy(signal: DriftSignal): string {
  switch (signal.kind) {
    case 'recent_race':
      return 'A new race within 5% of goal pace clears this. Or 3+ weeks of tempo/threshold paces hitting plan targets, which lets the engine update VDOT from training.';
    case 'aerobic_decoupling':
      return 'Aerobic decoupling tightening back toward 5% (current band) on the next 2-3 long runs clears this. Hydration + carb fueling on long runs is the biggest lever.';
    case 'tempo_pace_drift':
      return 'Tempo paces hitting plan target for 2-3 sessions clears this. Cooler conditions, more carb fueling pre-session, or backing off a bit if cumulative fatigue is the culprit.';
    case 'plan_adapter_downgrades':
      return 'A clean 2 weeks where the adapter doesn\'t need to step in (steady readiness, no streaks) clears this.';
    case 'missed_key_workouts':
      return 'Hit the next 3-4 key workouts as planned · the engine reweighs every week.';
    case 'vdot_trend':
      return 'A quality session that yields a VDOT estimate above the 4-week-ago number clears this · usually a tempo or threshold workout at goal pace or faster.';
    default:
      return 'Clearing the soft signal puts the plan back on the path.';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Detectors · each returns 0 or 1 signal. All independent + side-effect
// free · order doesn't matter, double-firing is fine (each is a distinct
// kind).
// ────────────────────────────────────────────────────────────────────────

/**
 * The extra slowdown a CROSS-DISTANCE anchor must show before it is allowed to
 * speak, in percent — `Research/02` §13.7's own confidence intervals, reused as
 * the margin on this detector's triggers.
 *
 * ── 2026-08-19 · WHY THIS REPLACED A ±30% DISTANCE BAND ──────────────────
 *
 * `detectRecentRaceDrift` used to admit only races within ±30% of the goal
 * distance. For a 5K goal that window is 2.17-4.04 miles, so a 10K raced three
 * weeks ago — very often the runner's single best piece of evidence — was
 * dropped before the detector saw it. This is the STRONG detector, so its
 * silence is the difference between telling a runner they are off-track and
 * telling them they are on-track.
 *
 * The band's stated reason was that "marathons don't count against half goals
 * · different endurance skill". That reason was already spent about twenty
 * lines further down, where the detector stopped comparing raw paces and
 * started VDOT-normalising the race to the goal distance (2026-06-04). Once
 * both sides are expressed at the same race length, the distance window is not
 * protecting against anything the normalisation has not already handled — it is
 * just discarding evidence, hardest at the short distances where a ±30% window
 * is barely a mile wide.
 *
 * What a cross-distance anchor DOES carry is prediction error, and doctrine
 * publishes that error per span in §13.7 rather than telling anyone to throw
 * the race away. So the span's stated CI becomes the margin: a cross-distance
 * race must be that much further off goal before it counts, and a same-distance
 * race is graded exactly as it was.
 *
 * COMPOSES WITH, DOES NOT DOUBLE-COUNT, `PREDICTION.cross-distance-span-bands`.
 * That model widens the confidence BAND drawn around a projection. This is the
 * TRIGGER on a drift detector. They read the same doctrine rows for two
 * different questions and neither is applied twice to one number.
 *
 * One-sided rows are the exception that proves the rule. §13.7's "5K →
 * marathon, no marathon block | ±10% (one-sided pessimistic)" means the error
 * runs one way: the predicted marathon is optimistic and the real finish is
 * SLOWER. The detector's equivalent time from a short anchor is therefore
 * already the runner's best case, and firing on it understates the gap rather
 * than overstating it. Adding margin there would suppress a signal doctrine
 * says is conservative, so one-sided spans take no margin at all.
 */
/** `crossSpanCi`'s third argument selects between §13.7's two 5K→marathon rows.
 *  This detector asks about a race the runner has ALREADY RUN, so whether a
 *  marathon block is in place is not a property of the anchor. `null` takes the
 *  no-block row, which is the one-sided-pessimistic one — and one-sided rows
 *  take no margin, so the ambiguity cannot cost the runner a signal. */
const MARATHON_SPECIFIC_TRAINING_UNKNOWN = null;

function driftAnchorMarginPct(
  anchorDistanceMi: number,
  goalDistanceMi: number,
): number | null {
  const from = distanceCategoryOrNull(anchorDistanceMi);
  const to = distanceCategoryOrNull(goalDistanceMi);
  if (from == null || to == null) return null;
  if (from === to) return 0;

  // `Research/02` §14 rule 6 takes ultras out of this machinery by name — "use
  // Cameron or exponent >= 1.10; switch to time-on-feet models beyond 100K" —
  // so a VDOT normalisation across an ultra boundary is not a prediction
  // doctrine endorses in either direction. Same-category ultra anchors still
  // pass above; cross-category ones are declined rather than guessed at.
  if (from === 'ultra' || to === 'ultra') return null;

  // A span §13.7 states outright. `oneSided` takes no margin, per the note above.
  const stated = crossSpanCi(anchorDistanceMi, goalDistanceMi, MARATHON_SPECIFIC_TRAINING_UNKNOWN);
  if (stated != null) return stated.oneSided ? 0 : stated.pct;

  // A span §13.7 does not print. Rather than interpolate a number nobody
  // published, take the widest published row that BRACKETS this span — a
  // conservative bound is a doctrine-stated number used where it cannot be too
  // narrow, which is the opposite of inventing one.
  //
  //   · shortening (anchor longer than goal) · the only shortening row §13.7
  //     publishes is "Marathon → 5K, recent base | ±3%", the widest shortening
  //     span there is. Every unpublished shortening span (10K→5K, half→10K,
  //     marathon→half) is a NARROWER extrapolation than that one.
  //   · lengthening · "5K → marathon, marathon-trained | ±5%" is the widest
  //     lengthening row with a stated block, and 5K→half is inside it.
  return anchorDistanceMi > goalDistanceMi
    ? CROSS_SPAN_CI_PCT.marathonToFiveK
    : CROSS_SPAN_CI_PCT.shortToMarathonTrained;
}

/** STRONG · a finished priority A/B race within 180 days whose VDOT, expressed
 *  at the goal's distance, comes in materially slower than the goal.
 *
 *  Any distance is admissible: the comparison is VDOT-normalised to the goal
 *  distance, and a cross-distance anchor pays for its span with the margin
 *  `driftAnchorMarginPct` reads out of `Research/02` §13.7.
 *
 *  Picks the race showing the BEST FITNESS (highest VDOT), not the fastest raw
 *  pace and not the most recent · "what have you shown you can do."
 *
 *  2026-08-19 · ranking by raw pace was safe only while every candidate sat
 *  within ±30% of one distance. Across distances it is not a comparison at all
 *  — a 5K is run faster per mile than a 10K by definition, so a pace ranking
 *  would have picked the shortest race in the window every time regardless of
 *  the fitness behind it. VDOT is the quantity that means the same thing at
 *  every distance, and the detector already computes it. */
async function detectRecentRaceDrift(
  userUuid: string,
  goalSec: number,
  raceDistanceMi: number,
): Promise<DriftSignal | null> {
  const goalPacePerMi = goalSec / Math.max(raceDistanceMi, 0.1);
  const today = await runnerToday(userUuid);
  const cutoff = new Date(Date.parse(today + 'T12:00:00Z') - 180 * 86400000)
    .toISOString().slice(0, 10);
  // FITTEST qualifying race · ranked by VDOT, which is the only quantity
  // comparable across distances. The runner has proven this fitness · we use it
  // as the "current fitness" anchor.
  //
  // 2026-06-16 · finish seconds are resolved in JS, NOT cast in SQL.
  // meta.finishTime is an H:MM:SS display string ("1:32:45"); the old
  // `NULLIF(meta->>'finishTime','')::numeric` threw `invalid input syntax for
  // type numeric` whenever actual_result.finishS was unset (every inline-edited
  // race row). The throw was swallowed by .catch + the detector loop, so the
  // single STRONG signal that flips a goal off-track silently never fired.
  // Parse the string the canonical way (parseRaceTime), then rank in JS.
  const rows = (await pool.query<{
    slug: string;
    name: string | null;
    date: string;
    dist: string | null;
    finish_s: number | string | null;
    finish_time: string | null;
  }>(
    `SELECT slug,
            meta->>'name' AS name,
            meta->>'date' AS date,
            meta->>'distanceMi' AS dist,
            (actual_result->>'finishS')::numeric AS finish_s,
            NULLIF(meta->>'finishTime','') AS finish_time
       FROM races
      WHERE user_uuid = $1::uuid
        AND meta->>'priority' IN ('A','B')
        AND meta->>'date' < $2
        AND meta->>'date' >= $3
        AND (meta->>'distanceMi')::numeric > 0
        AND (
          (actual_result->>'finishS') IS NOT NULL
          OR NULLIF(meta->>'finishTime','') IS NOT NULL
        )`,
    [userUuid, today, cutoff],
  ).catch(() => ({ rows: [] }))).rows;

  // 2026-08-21 · race-data source-of-truth re-audit · TWO ABSENT FILTERS, one
  // of them absent ON PURPOSE. Recorded here so the next audit does not
  // "fix" the deliberate one.
  //
  // · `actual_result.provisional` · NOT filtered, and correct. This detector
  //   only fires DOWNWARD (`slowdownPct` has to clear `mediumAt` before it
  //   returns anything), and `lib/race/auto-result.ts` §"FITNESS doctrine"
  //   establishes that both residual errors in a provisional watch time bias
  //   it FASTER. A provisional row therefore UNDERSTATES a slowdown, so
  //   admitting it is the conservative direction — the same reasoning that
  //   admits provisional times to `detectFitnessRegression` and blocks them
  //   from the upward re-anchor.
  //
  // · REPRESENTATIVENESS · genuinely absent, unlike the two re-anchor
  //   detectors in `lib/plan/adapt.ts`, which call
  //   `assessRaceRepresentativeness` before moving anything. A B race run in
  //   heat or on a hard course can raise a `strong` signal here on a
  //   shortfall that was the day rather than fitness. Not closed in this pass:
  //   whether a drift signal should be authority-weighted or authority-gated
  //   is a threshold decision with two defensible answers, and picking one
  //   silently is how unbacked models get built.
  //
  // Resolve finish seconds (finishS, else parse the HMS string), admit the
  // spans doctrine can normalise, and rank by VDOT — all in JS, so a string
  // finish can never throw and the admission rule stays readable and testable.
  let best: {
    slug: string; name: string | null; date: string;
    dist: number; finishS: number; vdot: number; marginPct: number;
  } | null = null;
  for (const row of rows) {
    const d = Number(row.dist);
    if (!d || d <= 0) continue;
    const fs = row.finish_s != null ? Number(row.finish_s) : parseRaceTime(row.finish_time);
    if (!fs || fs <= 0) continue;
    // Null = a span `Research/02` does not normalise (an ultra on one side, an
    // unrecognised distance). Declined rather than guessed at.
    const marginPct = driftAnchorMarginPct(d, raceDistanceMi);
    if (marginPct == null) continue;
    const v = vdotFromRace(fs, d);
    if (v == null) continue;
    if (!best || v > best.vdot) {
      best = { slug: row.slug, name: row.name, date: row.date, dist: d, finishS: fs, vdot: v, marginPct };
    }
  }

  if (!best) return null;
  const r = { slug: best.slug, name: best.name, date: best.date };
  const dist = best.dist;
  const finishS = best.finishS;
  const marginPct = best.marginPct;

  // 2026-06-04 · compare DISTANCE-NORMALIZED times, not raw paces.
  // Comparing marathon pace (484 s/mi) to half-marathon goal pace
  // (408 s/mi) flagged false positives because marathon pace is
  // naturally slower than half pace · the runner was ON TRACK but the
  // detector said -18% slow.
  //
  // Right move · compute VDOT from the race result, then predict what
  // that VDOT would yield at the GOAL race's distance. Compare to the
  // goal time. Same fitness, same effort, just normalized to the same
  // race length.
  const raceVdot = best.vdot;
  const equivalentGoalDistTime = predictRaceTime(raceVdot, raceDistanceMi);
  if (equivalentGoalDistTime == null) return null;
  const slowdownPct = (equivalentGoalDistTime - goalSec) / goalSec * 100;
  // Goal pace + slowdown context (kept in evidence for the diagnostic
  // line but no longer drives the trigger).
  void goalPacePerMi;

  // Thresholds calibrated to David's "very clear cannot get there"
  // standard. A 6.6% slowdown from a 4-month-old race isn't undeniable
  // · 4 months of training can close that. The plan deserves the
  // benefit of the doubt unless the gap is structural.
  //
  //   < 5%       · no signal · plan is in close range
  //   5% to 10%  · MEDIUM    · trending behind · one of several signals
  //                              before declaring off-track
  //   ≥ 10%      · STRONG    · ~2 VDOT points off · "very clear"
  //                              territory
  //
  // 10% maps roughly to "the runner's recent best time corresponds to
  // a VDOT 2 points below the goal VDOT" · in Daniels-speak that's
  // a real fitness gap, not a training-can-close-it gap.
  //
  // A cross-distance anchor pays for its span first. `marginPct` is §13.7's
  // published CI for exactly this pair, so the runner is never told they are
  // drifting on a gap the prediction itself cannot resolve. Same-distance
  // anchors carry margin 0 and grade at the original 5 / 10.
  const mediumAt = 5 + marginPct;
  const strongAt = 10 + marginPct;
  if (slowdownPct < mediumAt) return null;
  const weight: DriftWeight = slowdownPct >= strongAt ? 'strong' : 'medium';

  // Say which race and, when it was a different distance, that the span was
  // paid for. A runner reading "your 10K says you are behind on a 5K goal"
  // deserves to see the engine account for the translation.
  const spanNote = marginPct > 0
    ? ` Different distance, so the gap had to clear an extra ${marginPct.toFixed(1)}% before it counted.`
    : '';

  return {
    kind: 'recent_race',
    weight,
    detail: `${r.name ?? r.slug} on ${r.date} implies ${formatGoalTime(equivalentGoalDistTime)} at this race's distance · ${slowdownPct.toFixed(1)}% slower than the goal.${spanNote}`,
    evidence: {
      slug: r.slug,
      raceDate: r.date,
      raceFinishSec: finishS,
      raceDistanceMi: dist,
      raceVdot: Number(raceVdot.toFixed(1)),
      equivalentGoalDistTime,
      goalSec,
      slowdownPct: Number(slowdownPct.toFixed(2)),
      crossDistanceMarginPct: marginPct,
    },
  };
}

/** STRONG · VDOT trend over 4+ weeks has dropped by ≥ 1 point.
 *  Read from projection_snapshots history. */
async function detectVdotTrendDrift(userUuid: string): Promise<DriftSignal | null> {
  const r = (await pool.query<{
    recent: string | null; older: string | null;
    recent_anchor: string | null; older_anchor: string | null;
  }>(
    `WITH ranked AS (
       SELECT vdot, snapshot_date, vdot_anchor_date,
              ROW_NUMBER() OVER (ORDER BY snapshot_date DESC) AS rn
         FROM projection_snapshots
        WHERE user_uuid = $1::uuid
          AND vdot IS NOT NULL
          AND snapshot_date >= CURRENT_DATE - INTERVAL '60 days'
        GROUP BY vdot, snapshot_date, vdot_anchor_date
     )
     SELECT
       (SELECT AVG(vdot)::text FROM ranked WHERE rn <= 7) AS recent,
       (SELECT vdot_anchor_date::text FROM ranked WHERE rn = 1) AS recent_anchor,
       (SELECT vdot::text FROM ranked WHERE snapshot_date <= CURRENT_DATE - INTERVAL '28 days' ORDER BY snapshot_date DESC LIMIT 1) AS older,
       (SELECT vdot_anchor_date::text FROM ranked WHERE snapshot_date <= CURRENT_DATE - INTERVAL '28 days' ORDER BY snapshot_date DESC LIMIT 1) AS older_anchor`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r || !r.recent || !r.older) return null;
  const recent = Number(r.recent);
  const older = Number(r.older);
  if (recent >= older - 1) return null;

  /* 2026-08-17 · RULE 1. "Time passing cannot decrease demonstrated fitness."
   *
   * This detector compared two points on the snapshot series and called any
   * drop "points of fitness loss", at weight STRONG, which pushes goal status
   * to off-track. But the snapshot IS `bestRecentVdot`'s output, and that
   * number falls on the CALENDAR by design: an aging anchor fades 0.1 VDOT per
   * fortnight, expires outright at 84 days, and the read then drops to whatever
   * training candidates remain. A runner who trains perfectly and simply does
   * not race will watch this fire.
   *
   * `vdot_anchor_date` has been written to this table since migration 125 and
   * never read. Reading it separates the two cases:
   *
   *   · SAME anchor  → the only thing that moved is the fade. Calendar.
   *   · DIFFERENT    → new evidence arrived. Real, but it is the same evidence
   *                    `detectFitnessRegression` already evaluates behind a
   *                    representativeness gate. One gated path beats one gated
   *                    and one ungated saying the same thing louder.
   *
   * Doctrine's own prescription for stale evidence is to preserve the estimate
   * and lower CONFIDENCE, never to record a loss. So neither case is a fitness
   * finding, and this now stays quiet in both. Kept rather than deleted because
   * an anchor-less drop (no anchor recorded on either endpoint) is still an
   * honest signal on pre-migration rows. */
  if (r.recent_anchor != null && r.older_anchor != null) {
    return null;
  }

  return {
    kind: 'vdot_trend',
    weight: 'medium',
    detail: `Fitness estimate is ${(older - recent).toFixed(1)} lower than four weeks ago · ${older.toFixed(1)} then, ${recent.toFixed(1)} now.`,
    evidence: {
      vdotRecent: recent,
      vdot4wAgo: older,
      delta: Number((recent - older).toFixed(2)),
      anchorProvenance: 'unrecorded',
    },
  };
}

/** MEDIUM · aerobic decoupling trending up across recent long runs.
 *  Worsening drift = aerobic engine slipping. */
async function detectAerobicDecouplingDrift(userUuid: string): Promise<DriftSignal | null> {
  const trend = await computeDecouplingTrend(userUuid).catch(() => null);
  if (!trend) return null;
  if (trend.direction !== 'declining') return null;
  // A "declining" trend means decoupling is INCREASING (worse aerobic
  // efficiency). 0.5pp+ worse is the threshold for medium signal.
  if (trend.currentDriftPct - trend.blockStartDriftPct < 0.5) return null;

  return {
    kind: 'aerobic_decoupling',
    weight: 'medium',
    detail: `Aerobic decoupling is widening · ${trend.blockStartDriftPct.toFixed(1)}% drift at block start, ${trend.currentDriftPct.toFixed(1)}% now. The engine is working harder for the same effort.`,
    evidence: {
      currentDriftPct: trend.currentDriftPct,
      blockStartDriftPct: trend.blockStartDriftPct,
      runsCount: trend.runsCount,
      weeksTracked: trend.weeksTracked,
    },
  };
}

/** MEDIUM · recent tempo/threshold paces drifting slower than the
 *  VDOT-implied T-pace by ≥ 10 s/mi for 3+ sessions in 21 days.
 *
 *  2026-06-09 state-audit fix · the old query was dead twice over:
 *  it filtered on data->>'workoutType' (a field no device-ingested run
 *  carried until the ingest stamp landed the same day) and averaged
 *  data->>'avgPaceSecPerMi' (a field NO run row carries · AVG was
 *  always null). And even alive it would have been dishonest ·
 *  overall pace on a WU + 4mi T + CD session reads ~30-50 s/mi slower
 *  than the tempo block, so comparing overall pace to T-pace fires on
 *  every well-executed tempo. Now mirrors loadRecentTestPoints: walk
 *  the PLAN's tempo/threshold days and read the watch_completion
 *  work-phase pace for each · the same number the Targets test-point
 *  verdicts use. Sessions without a watch payload contribute nothing
 *  (no watch → no signal, same net behavior as the dead detector ·
 *  honest absence beats a fabricated average). */
async function detectTempoPaceDrift(
  userUuid: string,
  vdot: number | null,
): Promise<DriftSignal | null> {
  if (!vdot) return null;
  // T-pace implied by current VDOT (Daniels: T-pace ≈ HM-pace minus
  // ~5 s/mi). Use predictRaceTime for HM, derive pace, subtract 5.
  const hmSec = predictRaceTime(vdot, 13.1);
  if (!hmSec) return null;
  const tPacePerMi = hmSec / 13.1 - 5;

  const projToday = await runnerToday(userUuid);
  // 2026-07-06 · audit P1-11 · runner-local day bucketing for ci.ts
  // (see computeOverPerformanceBonus).
  const ciTz = await runnerTimezoneOrPacific(userUuid);
  const r = (await pool.query<{
    avg_pace_s: number | string | null;
    count: number | string;
  }>(
    `SELECT AVG(t.work_pace) AS avg_pace_s, COUNT(*) AS count
       FROM (
         SELECT pw.date_iso,
                (
                  SELECT AVG((phase->>'actualPaceSPerMi')::numeric)
                    FROM coach_intents ci,
                         jsonb_array_elements(
                           CASE jsonb_typeof(ci.value::jsonb)
                             WHEN 'object' THEN ci.value::jsonb->'phases'
                             ELSE '[]'::jsonb
                           END
                         ) AS phase
                   WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
                     AND ci.reason = 'watch_completion'
                     AND (ci.ts AT TIME ZONE $4::text)::date = pw.date_iso::date
                     -- 2026-06-11 · latest completion only. A day can carry
                     -- more than one watch_completion (a stale 1-phase push +
                     -- the real 3-phase run); averaging across both pulled a
                     -- 7:17 tempo to ~7:45 and fired a false drift signal.
                     -- Mirror loadRecentTestPoints, which already does this.
                     AND ci.id = (SELECT MAX(ci2.id) FROM coach_intents ci2
                                   WHERE COALESCE(ci2.user_uuid, ci2.user_id) = $1::uuid
                                     AND ci2.reason = 'watch_completion'
                                     AND (ci2.ts AT TIME ZONE $4::text)::date = pw.date_iso::date)
                     AND phase->>'type' = 'work'
                     AND (phase->>'actualPaceSPerMi')::numeric > 0
                ) AS work_pace
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1::uuid
            AND tp.archived_iso IS NULL
            AND pw.type IN ('tempo','threshold')
            AND pw.date_iso >= $3
            AND pw.date_iso <= $2
       ) t
      WHERE t.work_pace IS NOT NULL`,
    [userUuid, projToday, isoDaysBefore(projToday, 21), ciTz],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r || !r.avg_pace_s || Number(r.count) < 3) return null;
  const observedPaceSec = Number(r.avg_pace_s);
  const driftSecPerMi = observedPaceSec - tPacePerMi;
  if (driftSecPerMi < 10) return null;

  return {
    kind: 'tempo_pace_drift',
    weight: 'medium',
    detail: `Recent tempo paces averaging ${Math.round(driftSecPerMi)} s/mi slower than the VDOT-implied T-pace across ${r.count} sessions in the last 3 weeks.`,
    evidence: {
      observedPaceSec: Math.round(observedPaceSec),
      vdotTPaceSec: Math.round(tPacePerMi),
      driftSecPerMi: Math.round(driftSecPerMi),
      sessionCount: Number(r.count),
    },
  };
}

/** MEDIUM · plan adapter has forced 2+ weeks of downgrades. The
 *  adapter doesn't fire unless something's tripping it · sustained
 *  firing is a fitness drift signal. */
async function detectPlanAdapterDrift(userUuid: string): Promise<DriftSignal | null> {
  // 2026-08-17 · a volume_overshoot shave fires when the runner ran MORE than
  // the plan scheduled. Counting it as evidence that they are not absorbing the
  // plan is exactly inverted. The trigger that caused each action is stamped on
  // the intent; rows written before that stamp carry no source_trigger and keep
  // their prior treatment.
  //
  // 2026-08-24 · swallowed-failure sweep · that exclusion was written as
  // `ci.value->>'source_trigger'` and `coach_intents.value` is a TEXT column.
  // `operator does not exist: text ->> unknown`, every call, caught into
  // `rows: []`, `if (!r) return null` — so the fix that meant to drop ONE
  // trigger from the count instead dropped the whole signal. `detectPlanAdapterDrift`
  // has returned null for every runner since. Both weeks and exclusion are
  // resolved in TS now; see lib/coach/intent-value.ts for why not in SQL.
  const rows = await rowsOrNull<{ wk: string; value: string | null }>(
    'training/goal-projection · planAdapterDrift',
    pool.query<{ wk: string; value: string | null }>(
      `SELECT date_trunc('week', ci.ts)::text AS wk, ci.value
       FROM coach_intents ci
      WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
        AND ci.reason IN ('plan_adapt_downgrade','plan_adapt_shave')
        AND ci.ts >= NOW() - INTERVAL '28 days'`,
      [userUuid],
    ),
  );
  // A failed read is not "the adapter has been quiet". No signal either way.
  if (rows === null) return null;
  const weeks = new Set<string>();
  for (const row of rows) {
    if (intentValueField(row.value, 'source_trigger') === 'volume_overshoot') continue;
    weeks.add(row.wk);
  }
  const weeksWithAdapts = weeks.size;
  if (weeksWithAdapts < 2) return null;

  return {
    kind: 'plan_adapter_downgrades',
    weight: 'medium',
    detail: `Plan adapter has stepped in ${weeksWithAdapts} of the last 4 weeks · sustained downgrades signal the runner isn't absorbing the plan as designed.`,
    // NOTE · downgrades still arrive from several triggers (niggle, illness,
    // heat bail, readiness). Only the inverted one — a shave for running MORE
    // than scheduled — is excluded above. The rest genuinely belong here.
    evidence: { weeksWithAdaptations: weeksWithAdapts },
  };
}

/** WEAK / MEDIUM · missed key workouts (quality + long) in the last 4 weeks.
 *
 *  2026-07-13 · S2 · window bounds are now RUNNER-LOCAL (runnerToday), not
 *  server-UTC CURRENT_DATE — a runner west of UTC could otherwise have a plan
 *  day graded a day early. The completed-EXISTS subquery gained a dedup guard
 *  and the ::uuid cast on user_uuid to match the sibling queries.
 *
 *  2026-08-24 · that dedup guard was `absorbed_into_canonical_at IS NULL` and
 *  it is GONE. The stamp is not a loser marker (see loadExecutionAbsence
 *  above); on six of this runner's canonical rows it is stale residue, and
 *  this query counted each of those completed sessions as MISSED. Drift is
 *  allowed to say a week was missed only when it was.
 *
 *  Weight ladder:
 *   · MEDIUM · a FULL missed week — a trailing stretch of >= FULL_WEEK_DAYS
 *     consecutive days that contains >= 1 scheduled key session with none
 *     completed. One bad week can now reach 'watching' on its own.
 *   · WEAK   · scattered sub-week misses — >= MISSED_PCT_TRIGGER of the 4-week
 *     window's key sessions missed (the pre-existing 0.30 trigger, kept as an
 *     additional, stronger-coverage path). */
async function detectMissedKeyWorkoutDrift(userUuid: string): Promise<DriftSignal | null> {
  const FULL_WEEK_DAYS = 7;         // [TUNABLE] trailing consecutive-day span that counts as a full missed week
  const MISSED_PCT_TRIGGER = 0.30;  // [TUNABLE] share of window key sessions missed for the scattered (weak) trigger
  const today = await runnerToday(userUuid);
  const windowStart = isoDaysBefore(today, 28);

  const rows = (await pool.query<{ date_iso: string; completed: boolean }>(
    `SELECT kw.date_iso,
            EXISTS (
              SELECT 1 FROM runs r
               WHERE r.user_uuid = $1::uuid
                 AND NOT (r.data ? 'mergedIntoId')
                 AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) = kw.date_iso
                 AND (r.data->>'distanceMi')::numeric >= kw.distance_mi * 0.8
            ) AS completed
       FROM (
         SELECT pw.id, pw.date_iso, pw.distance_mi
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1::uuid
            AND tp.archived_iso IS NULL
            AND pw.type IN ('long','tempo','threshold','intervals','race')
            AND pw.date_iso >= $2
            AND pw.date_iso < $3
       ) kw
      ORDER BY kw.date_iso ASC`,
    [userUuid, windowStart, today],
  ).catch(() => ({ rows: [] }))).rows;

  const scheduled = rows.length;
  if (scheduled === 0) return null;
  const completed = rows.filter((row) => row.completed).length;
  const missedCount = scheduled - completed;
  const missedPct = scheduled > 0 ? missedCount / scheduled : 0;

  // Full missed week · the trailing stretch of uncompleted key sessions (those
  // after the most recent completed key session, or all of them when none were
  // completed). If the earliest such session is >= FULL_WEEK_DAYS ago, the last
  // week-plus contains >= 1 scheduled key session with none completed.
  const dayDiff = (from: string, to: string): number =>
    Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86_400_000);
  const lastCompleted = rows.filter((row) => row.completed).map((row) => row.date_iso).sort().at(-1) ?? null;
  const trailingMissed = rows
    .filter((row) => !row.completed && (lastCompleted == null || row.date_iso > lastCompleted))
    .map((row) => row.date_iso)
    .sort();
  let fullMissedWeek = false;
  let missedStreakDays = 0;
  if (trailingMissed.length >= 1) {
    missedStreakDays = dayDiff(trailingMissed[0], today);
    fullMissedWeek = missedStreakDays >= FULL_WEEK_DAYS;
  }

  const scatteredTrigger = scheduled >= 3 && missedPct >= MISSED_PCT_TRIGGER;
  if (!fullMissedWeek && !scatteredTrigger) return null;

  const weight: DriftWeight = fullMissedWeek ? 'medium' : 'weak';
  const detail = fullMissedWeek
    ? `Full week missed · no key session completed in ${missedStreakDays} days · ${missedCount} of ${scheduled} key workouts skipped in the last 4 weeks.`
    : `${missedCount} of ${scheduled} key workouts missed in the last 4 weeks · ${Math.round(missedPct * 100)}%.`;

  return {
    kind: 'missed_key_workouts',
    weight,
    detail,
    evidence: {
      scheduledCount: scheduled,
      completedCount: completed,
      missedCount,
      missedPct: Number(missedPct.toFixed(2)),
      missedStreakDays,
      fullMissedWeek: fullMissedWeek ? 1 : 0,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Summary composition
// ────────────────────────────────────────────────────────────────────────

function composeSummary(
  status: GoalStatus,
  signals: DriftSignal[],
  goalSec: number,
  vdotProjectionSec: number | null,
): string {
  // 2026-06-04 · sub-headline copy. Pairs with the panel headline
  // ("The plan is the path." / "Watching · soft signals firing.") ·
  // the SUB is the supporting line. The actual drift signals get
  // listed below as their own chips (don't repeat them in the body).
  if (status === 'on-track') {
    return 'Keep doing the work · the plan is delivering as designed.';
  }
  if (status === 'watching') {
    return 'Hold the plan · the next quality run will tell us more.';
  }
  if (status === 'ahead') {
    // 2026-08-28 · AHEAD-1 · coach voice, not a renegotiation prompt. States
    // what training is showing; never suggests the goal itself should change
    // ([[feedback_no_forced_goal_decisions]]).
    return 'Training is reading faster than the goal · the number above reflects it.';
  }
  // off-track · the signals get listed as chips below so this stays
  // a one-liner framing the moment.
  return 'The math is honest · time to look at what the plan can still close, and what it can\'t.';
}

// ────────────────────────────────────────────────────────────────────────
// Confidence interval + label
// ────────────────────────────────────────────────────────────────────────

/**
 * Statistical band around the CURRENT-FITNESS projection (vdotProjectionSec),
 * NOT the goal. The honest "if you raced today, here's the spread."
 *
 * Base half-width · Research/02 §13.7 ("Confidence intervals to report with
 * predictions") + §4.3 (Daniels same-distance prediction error 1-3% in
 * well-trained runners) + §11.1 (single-input race noise ±1-3%). Keyed on
 * the TARGET race span:
 *    ≤10K        → ±2.0%   (§13.7 "5K→10K recent ±1.5%" + input-noise margin)
 *    HM (≤16mi)  → ±2.5%   (§13.7 "10K→half, recent input ±2.5%")
 *    marathon+   → ±3.0%   (§13.7 "half→marathon, marathon-trained ±3%")
 *
 * Observed-CV upgrade · once the runner has demonstrated pacing consistency
 * (pacing-discipline source='observed'), size off their own median split CV
 * instead of the table default. Same 0.02 / 0.04 buckets as
 * lib/coach/pacing-discipline.ts, floored at 2.0% — never claim tighter than
 * the §4.3 fundamental error even for a metronome pacer.
 *
 * Status scaling · drift signals add uncertainty (faff overlay on §13.7):
 *    ahead ×1.0 · on-track ×1.0 · watching ×1.25 · off-track ×1.5
 * (ahead falls to the same default as on-track below — evidenced-faster is
 * not less certain than on-pace, so it earns no widening.)
 *
 * ── CI-CROSS-1 (2026-08-19) · the span is a PAIR, not a target ─────────────
 *
 * §13.7's table is keyed on a SPAN — "5K → 10K", "half → marathon" — and this
 * function read only the right-hand side of the arrow. `vdotAnchorDistanceMi`
 * has been threaded here from `computeGoalProjection` since 2026-06-08 with a
 * comment saying it was for the one-sided-pessimism case and "not yet consumed
 * here"; it was destructured out of `computeGoalProjection`'s args, passed in,
 * and never read. So a marathon-goal runner anchored on a 5K PR — the exact
 * case §13.1 calls "the single largest error source" and §14.7 warns produces
 * systematic over-prediction — got the same ±3% band as one anchored on a
 * half, and the band was symmetric, implying the projection was as likely to
 * be pessimistic as optimistic when doctrine says it is not.
 *
 * The rows are now read as spans:
 *
 *   · target = marathon, anchor SUB-HALF-MARATHON. §13.1's adjustment rule is
 *     stated for exactly that shape — "for marathon prediction from a
 *     sub-half-marathon input" — and §13.7 gives it two rows: ±5% with a
 *     marathon block in place, ±10% ONE-SIDED PESSIMISTIC without one.
 *     `marathonSpecificTraining` carries which, read off the runner's own plan
 *     against §13.1's stated minima (see loadMarathonSpecificTraining).
 *   · every other stated span (5K→10K, 10K→half, half→marathon, marathon→5K)
 *     is read from the table, and can only ever WIDEN the band: the existing
 *     target-keyed defaults already carry an input-noise margin over §13.7's
 *     narrowest rows, and nothing here should make a cross-distance prediction
 *     read tighter than a same-distance one.
 *   · an unknown anchor distance changes nothing. Not knowing the span is not
 *     evidence about it.
 */
export function computeConfidenceInterval(args: {
  centerSec: number | null;
  raceDistanceMi: number;
  status: GoalStatus;
  pacing?: { cv: number | null; source: 'observed' | 'default' } | null;
  /** ISO date of the VDOT anchor race/run. When supplied and >180 days before
   *  today, the §13.7 stale-input override fires: basePct → 8.0%, symmetric,
   *  superseding both observed-CV and the standard distance table. */
  vdotAnchorDateISO?: string | null;
  /** Distance (miles) of the anchor race/run · CI-CROSS-1 reads it as the
   *  left-hand side of §13.7's span. Null = span unknown, table unchanged. */
  vdotAnchorDistanceMi?: number | null;
  /** CI-CROSS-1 · does this runner have marathon-specific training in place, by
   *  §13.1's stated minima? Only consulted for a marathon target off a
   *  sub-half-marathon anchor. `false`/`null` both select §13.7's "no marathon
   *  block" row: doctrine's own instruction on which way to lean here is
   *  unambiguous (§14.7), and "we could not establish a block" is not evidence
   *  that one exists. */
  marathonSpecificTraining?: boolean | null;
}): ConfidenceInterval | null {
  const { centerSec, raceDistanceMi, status, pacing, vdotAnchorDateISO } = args;
  if (centerSec == null || centerSec <= 0) return null; // cold-start · no band

  // Research/02 §13.7 "cross-prediction with >6-month-old input → ±8%".
  // 180 days matches the bestRecentVdot lookback window so a VDOT that just
  // barely survives the freshness cut can still trigger the wider band if
  // the anchor race itself is older.
  const STALE_DAYS = 180;
  if (vdotAnchorDateISO) {
    const anchorMs = Date.parse(vdotAnchorDateISO + 'T12:00:00Z');
    if (!isNaN(anchorMs)) {
      const ageDays = (Date.now() - anchorMs) / 86_400_000;
      if (ageDays > STALE_DAYS) {
        const mult = status === 'off-track' ? 1.5 : status === 'watching' ? 1.25 : 1.0;
        const half = Math.round((centerSec * CROSS_SPAN_CI_PCT.staleInput * mult) / 100);
        const pct = Math.round(CROSS_SPAN_CI_PCT.staleInput * mult * 10) / 10;
        return { lo: centerSec - half, hi: centerSec + half, pct, method: 'research-span-stale' };
      }
    }
  }

  let basePct: number;
  let method: ConfidenceInterval['method'];
  if (pacing?.source === 'observed' && pacing.cv != null) {
    // Observed split-CV buckets (mirror pacing-discipline thresholds), floored
    // at the §4.3 minimum.
    basePct = pacing.cv < 0.02 ? 2.0 : pacing.cv < 0.04 ? 2.5 : 3.5;
    method = 'observed-cv';
  } else {
    // Research/02 §13.7 span table, keyed on target distance.
    basePct = researchSpanBasePct(raceDistanceMi);
    method = 'research-span';
  }

  // CI-CROSS-1 · the left-hand side of §13.7's arrow.
  const cross = crossSpanCi(
    args.vdotAnchorDistanceMi ?? null,
    raceDistanceMi,
    args.marathonSpecificTraining ?? null,
  );
  let oneSided = false;
  if (cross != null && cross.pct > basePct) {
    basePct = cross.pct;
    oneSided = cross.oneSided;
    method = 'research-span-cross';
  }

  const mult = status === 'off-track' ? 1.5 : status === 'watching' ? 1.25 : 1.0;
  const half = Math.round((centerSec * basePct * mult) / 100);
  const pct = Math.round(basePct * mult * 10) / 10;

  // "One-sided pessimistic" means the error runs one way: the prediction is
  // optimistic and the real finish is SLOWER. So the band opens toward slow and
  // has no fast edge to speak of — `lo` stays at the projection itself rather
  // than promising an upside doctrine does not support.
  return oneSided
    ? { lo: centerSec, hi: centerSec + half, pct, method, oneSided: true }
    : { lo: centerSec - half, hi: centerSec + half, pct, method };
}

/**
 * CI-CROSS-1 · `Research/02` §13.7's cross-distance rows, read as spans.
 *
 * Returns null when doctrine states nothing about this pair (including an
 * unknown anchor and a same-category anchor, which §13.7's arrow rows do not
 * describe). The caller only ever widens.
 *
 * Bound by `PREDICTION.cross-distance-span-bands` in lib/doctrine/registry.ts,
 * which parses these percentages out of §13.7's own table.
 *
 * Exported (2026-08-28) so the coach-set goal engine (lib/race/coach-goal.ts)
 * sizes its A/C band off the SAME rows the projection band uses — a coach
 * goal wider or tighter than the band the app draws would be two answers to
 * one question.
 */
export function crossSpanCi(
  anchorDistanceMi: number | null,
  targetDistanceMi: number,
  marathonSpecificTraining: boolean | null,
): { pct: number; oneSided: boolean } | null {
  if (anchorDistanceMi == null || !(anchorDistanceMi > 0)) return null;
  const from = distanceCategoryOrNull(anchorDistanceMi);
  const to = distanceCategoryOrNull(targetDistanceMi);
  if (from == null || to == null || from === to) return null;

  // §13.1 "Adjustment rule": "for marathon prediction from a sub-half-marathon
  // input, add 5% if marathon-specific training is absent". §13.7 gives that
  // shape its two rows — and the fact that the doc writes them as "5K →
  // marathon" while §13.1 writes the same rule as "sub-half-marathon input" is
  // what says the 10K anchor belongs in the same row rather than in a gap.
  if (to === 'm' && (from === '5k' || from === '10k')) {
    return marathonSpecificTraining === true
      ? { pct: CROSS_SPAN_CI_PCT.shortToMarathonTrained, oneSided: false }
      : { pct: CROSS_SPAN_CI_PCT.shortToMarathonNoBlock, oneSided: true };
  }
  if (from === '5k' && to === '10k') return { pct: CROSS_SPAN_CI_PCT.fiveKToTenK, oneSided: false };
  if (from === '10k' && to === 'hm') return { pct: CROSS_SPAN_CI_PCT.tenKToHalf, oneSided: false };
  if (from === 'hm' && to === 'm') return { pct: CROSS_SPAN_CI_PCT.halfToMarathon, oneSided: false };
  if (from === 'm' && to === '5k') return { pct: CROSS_SPAN_CI_PCT.marathonToFiveK, oneSided: false };
  // Every other pair — ultras at either end, half→10K, marathon→half and the
  // rest — is a span doctrine's table does not state. Left to the target-keyed
  // default rather than interpolated into a number nobody published.
  return null;
}

/**
 * SPEC-CENTER (2026-08-28) · Research/02 §13.1's marathon-specificity point
 * adjustment, stated at :382: "for marathon prediction from a sub-half-marathon
 * input, add 5% if marathon-specific training is absent". REVIEW_NOTES.md's
 * 2026-08-28 addendum (A5) resolves the corpus's four overlapping phrasings to
 * this same rule for a HALF-MARATHON input as well — "+5% (one-sided
 * pessimistic) and always report the ±3% CI from 02 §13.7" — and forbids
 * stacking it with the 1.5-VDOT subtraction (which is 01's rule for MP
 * *prescription*, not prediction; this engine applies that one in the pace
 * path, never here).
 *
 * Bound by `PREDICTION.marathon-specificity-point-adjustment` in the registry.
 */
export const MARATHON_SPECIFICITY_PENALTY_PCT = 5;

/**
 * Does the §13.1 one-sided adjustment govern this prediction? Non-null when
 * the target is a marathon, the evidence anchor is sub-marathon (5K/10K/HM),
 * and no marathon-specific block is established (`false` and `null` both
 * qualify — "we could not establish a block" is not evidence one exists, and
 * §14.7's instruction on which way to lean is unambiguous).
 *
 * The returned pct adjusts the CENTER of a marathon prediction; the CI band
 * around it stays `crossSpanCi`'s row for the span. Callers must label the
 * adjusted number modelled (the ~ convention).
 */
export function marathonSpecificityAdjustment(
  targetDistanceMi: number | null | undefined,
  anchorDistanceMi: number | null | undefined,
  marathonSpecificTraining: boolean | null,
): { pct: number; oneSided: true } | null {
  if (targetDistanceMi == null || anchorDistanceMi == null) return null;
  if (distanceCategoryOrNull(targetDistanceMi) !== 'm') return null;
  const from = distanceCategoryOrNull(anchorDistanceMi);
  if (from == null || !['5k', '10k', 'hm'].includes(from)) return null;
  if (marathonSpecificTraining === true) return null;
  return { pct: MARATHON_SPECIFICITY_PENALTY_PCT, oneSided: true };
}

/**
 * The SAME-distance half-width for a target race, %, before status scaling.
 *
 * `Research/02` §13.7's rows are spans, and this is the engine's read of them
 * when the anchor is at (or near) the target distance: the narrowest stated row
 * that reaches this target, plus the input-noise margin §11.1 describes. It is
 * exported because the B-target lever must use the same number — a B-target
 * wider or tighter than the band the app draws would be two answers to one
 * question (`lib/coach/projection-levers.ts#bTargetSec`).
 */
export function researchSpanBasePct(raceDistanceMi: number): number {
  return raceDistanceMi <= 6.5 ? 2.0 : raceDistanceMi <= 16 ? 2.5 : 3.0;
}

/**
 * `Research/02` §13.7 "Confidence Intervals to Report with Predictions", one
 * key per row of the table. Named rather than inlined so the doctrine claim can
 * check each against the passage.
 */
export const CROSS_SPAN_CI_PCT = {
  /** "5K → 10K, recent input | ±1.5%" */
  fiveKToTenK: 1.5,
  /** "10K → half, recent input | ±2.5%" */
  tenKToHalf: 2.5,
  /** "Half → marathon, marathon-trained | ±3%" */
  halfToMarathon: 3.0,
  /** "5K → marathon, marathon-trained | ±5%" */
  shortToMarathonTrained: 5.0,
  /** "5K → marathon, no marathon block | ±10% (one-sided pessimistic)" */
  shortToMarathonNoBlock: 10.0,
  /** "Marathon → 5K, recent base | ±3%" */
  marathonToFiveK: 3.0,
  /** "Cross-prediction with > 6-month-old input | ±8%" · the stale override
   *  above, named here so the whole table lives in one place. */
  staleInput: 8.0,
} as const;

/**
 * Goal-attainment confidence (the LABEL on the goal, distinct from the band).
 * Answers "solidly on track or barely?" by comparing the fitness gap to what
 * the runway can plausibly close, then gating by drift status.
 *
 * BUILD_RATE_VDOT_PER_WEEK IS DOCTRINE NOW, AND IT IS NOT A SECOND OPINION
 * (2026-08-18, gain-rate reconciliation). This comment used to cite
 * "Research/00a periodization" for a VDOT-per-week figure — Research/00a never
 * mentions VDOT at all — and the fix at the time was to relabel the 0.35 as a
 * CONVENTION. That was honest but incomplete: the engine still held three
 * different rates (0.167-0.25 in goal-ready.ts, 0.35 here and in
 * fitness-trajectory.ts, a fabricated 0.5 in goal-gap.ts), so the same runner
 * got a different answer depending on which surface asked.
 *
 * `Research/01` §"Testing cadence" states the only per-time VDOT quantum in the
 * corpus: reassess every 4-6 weeks, +1 VDOT per reassessment — 0.167-0.25
 * VDOT/wk. This constant is now the FAST edge of that band, re-exported from
 * lib/training/vdot-gain-rate.ts so there is exactly ONE definition, bound by
 * ADAPTATION.vdot-gain-rate. What Research/00a DOES ground is the SHAPE only:
 * adaptation compounds over weeks and saturates near a runner's ceiling
 * (§"Aerobic Base Development").
 *
 * The confidence tiers below are unchanged in shape and now read slightly more
 * conservatively, which is the point — the old rate declared gaps closable
 * that doctrine does not support.
 */
export const BUILD_RATE_VDOT_PER_WEEK = VDOT_GAIN_PER_WEEK_MAX;

export function computeConfidenceLabel(args: {
  goalSec: number;
  raceDistanceMi: number;
  vdot: number | null; // current
  daysToRace: number | null;
  status: GoalStatus;
}): ConfidenceLabel | null {
  const { goalSec, raceDistanceMi, vdot, daysToRace, status } = args;
  if (vdot == null) return null; // cold-start · no honest read
  const goalVdotRaw = vdotFromRace(goalSec, raceDistanceMi);
  // 2026-07-07 · AUDIT P1-56 · same off-table-goal honesty fix as
  // fitness-trajectory.ts's projectFitnessTrajectory (see its comment for the
  // full rationale). goalVdotRaw null below VDOT 30 is an honest slow goal —
  // when it's slower than the runner's OWN current-fitness predicted time,
  // treat it as "already met" for the gap math (gapVdot floors at 0 either
  // way) instead of discarding the whole confidence label. Off-the-top
  // (>VDOT 85) stays null → null return, unchanged (generate.ts's GOAL-4
  // guards that case before a goal reaches here).
  const currentPredictedForGoal = predictRaceTime(vdot, raceDistanceMi);
  const goalBelowTable = goalVdotRaw == null
    && currentPredictedForGoal != null && goalSec >= currentPredictedForGoal;
  const goalVdot = goalVdotRaw ?? (goalBelowTable ? vdot : null);
  if (goalVdot == null) return null;

  const gapVdot = goalVdot - vdot; // +ve = behind the goal
  const gapSec = (predictRaceTime(vdot, raceDistanceMi) ?? goalSec) - goalSec;
  const runwayWeeks = daysToRace != null ? daysToRace / 7 : null;

  // Base tier · gap vs what the runway can close.
  let tier: ConfidenceLabel['tier'];
  if (gapVdot <= 0) {
    tier = 'high'; // already at or ahead of the goal's fitness
  } else if (runwayWeeks == null) {
    tier = 'medium'; // gap exists, runway unknown → middling
  } else if (runwayWeeks < 2) {
    tier = 'low'; // no time left to close it
  } else {
    const closable = runwayWeeks * BUILD_RATE_VDOT_PER_WEEK;
    const ratio = gapVdot / Math.max(closable, 0.1);
    tier = ratio <= 0.5 ? 'high' : ratio <= 1.0 ? 'medium' : 'low';
  }

  // Drift-status cap · soft/hard signals can't co-exist with high confidence.
  if (status === 'off-track' && tier !== 'low') tier = 'low';
  if (status === 'watching' && tier === 'high') tier = 'medium';

  const word: ConfidenceLabel['word'] =
    tier === 'high' ? 'HIGH' : tier === 'medium' ? 'MEDIUM' : 'LOW';
  const descriptor =
    tier === 'high' ? 'tracking to hit it'
    : tier === 'medium' ? 'doable, not banked'
    : 'behind on this runway';
  const detail = gapVdot <= 0
    ? 'ahead of the number · hold the plan'
    : runwayWeeks != null
      ? `${formatGoalTime(Math.round(gapSec))} to find · ${Math.round(runwayWeeks)} weeks to do it`
      : `${formatGoalTime(Math.round(gapSec))} to find`;

  return {
    tier,
    word,
    descriptor,
    detail,
    evidence: {
      gapVdot: Number(gapVdot.toFixed(1)),
      gapSec: Math.round(gapSec),
      currentVdot: vdot,
      // 2026-07-07 · AUDIT P1-56 · goalVdot is the stand-in (= vdot) internally
      // for a below-table goal so the gap math floors correctly; the evidence
      // block must not present that stand-in as a real goal VDOT. Same
      // 'unknown'-style honest string marker runwayWeeks already uses below.
      goalVdot: goalBelowTable ? 'below_table' : Number(goalVdot.toFixed(1)),
      runwayWeeks: runwayWeeks != null ? Number(runwayWeeks.toFixed(1)) : 'unknown',
      status,
    },
  };
}

/**
 * 2026-07-06 · P1-14 reconciliation · a LOW goal-attainment confidence and an
 * ON PACE hero cannot coexist on one payload. The runway cap in
 * fitness-trajectory closes the main path (an unclosable gap no longer
 * projects reachable), but one edge survives it: runway < 2 weeks with a tiny
 * positive gap (≤ 0.2 VDOT, inside the trajectory's noise grace) grades LOW
 * ("no time left to close it") while the trajectory still reads reachable.
 * Whatever surface derives a status from the trajectory runs it through this
 * gate so the two signals agree: LOW demotes on_track → watch; every other
 * combination passes through untouched.
 */
export type TargetsStatus = 'on_track' | 'watch' | 'off' | 'race_week' | 'cold';
export function reconcileStatusWithConfidence(
  status: TargetsStatus,
  confidenceTier: ConfidenceLabel['tier'] | null | undefined,
): TargetsStatus {
  return status === 'on_track' && confidenceTier === 'low' ? 'watch' : status;
}

/** Format helper · seconds → "1:30:00" or "30:00". */
export function formatGoalTime(sec: number | null): string {
  if (sec == null) return '·';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
