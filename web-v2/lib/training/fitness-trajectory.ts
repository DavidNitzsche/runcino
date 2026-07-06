/**
 * fitness-trajectory.ts — the goal-seeking projection.
 *
 * The old projection answered "at your fitness TODAY, this race would take T."
 * That's a snapshot, and it's why the number sat frozen on a 130-day-old race
 * while a whole training block went by. This module answers the question a
 * runner in a build actually asks:
 *
 *   "Executing this plan, where will my fitness BE on race day — and does that
 *    trajectory hit the goal, or fall short, and by how much?"
 *
 * It is the bridge David asked for between the coach/plan and the prediction:
 * the plan sets the build trajectory, execution quality scales it, and the
 * projection moves toward the goal as the work gets done (or reveals an honest
 * gap when it doesn't).
 *
 * Model (all in VDOT space, converted to time at the end):
 *
 *   projectedRaceDayVdot
 *     = currentVdot + projectedGain
 *   projectedGain                            // 2026-06-16 "plan trusts itself" +
 *     = clamp( (goalVdot − currentVdot) × executionQuality,   // 2026-07-06 runway cap
 *              0, min(MAX_BLOCK_GAIN, planCeiling, buildWeeks × BASE_BUILD_RATE) )
 *       + overPerformanceBonus               // demonstrated · rides under block/plan ceiling
 *   buildWeeks
 *     = max(0, weeksToRace − TAPER_WEEKS)     // taper expresses fitness, doesn't build it
 *
 * currentVdot is the responsive fitness estimate (race anchor + training,
 * bestRecentVdot). executionQuality ∈ [0,1] comes from how the runner is
 * actually hitting the plan (test-point verdicts, missed-workout rate, drift
 * signals) — computed by the caller and passed in, so this stays a pure,
 * testable function. A runner nailing every session projects the full build
 * rate; one missing/downgrading sessions projects a discounted slope.
 *
 * Research basis:
 *   · BASE_BUILD_RATE 0.35 VDOT/wk — a focused block moves ~3–5 VDOT over
 *     12–16 weeks (≈0.25–0.4/wk). Research/00a periodization; same midpoint
 *     already used by computeConfidenceLabel (goal-projection.ts).
 *   · MAX_BLOCK_GAIN 5.0 — the upper end of that same range; a single build
 *     block does not deliver more, so the projection never promises it.
 *   · TAPER_WEEKS 2 — standard HM/M taper; no fitness gain is modeled in the
 *     taper window (freshness, not fitness). Research/00a, Pfitzinger taper.
 *
 * Deliberately NOT modeled yet (documented, not hidden):
 *   · Diminishing returns near a runner's ceiling (gains slow as VDOT rises).
 *     The MAX_BLOCK_GAIN cap is a blunt stand-in. CI-followup.
 *   · Non-linear build shape (faster early, flatter near peak). Linear v1.
 */

import { predictRaceTime, vdotFromRace } from './vdot';

export const BASE_BUILD_RATE = 0.35; // VDOT per week, focused block
export const MAX_BLOCK_GAIN = 5.0;   // VDOT, ceiling for one block
export const TAPER_WEEKS = 2;        // no fitness gain modeled in taper
/** Max unconfirmed, training-derived fitness the projection will apply on top
 *  of the race anchor (the "upgrade gear"). Training is a LEAD, not a verdict
 *  (Research/01 §triggers-to-retest) — a race/TT confirms more than this. */
export const OVERPERFORMANCE_CAP_VDOT = 4.0;

export interface FitnessTrajectory {
  /** Responsive current fitness (race anchor + training). */
  currentVdot: number;
  /** Where the plan + execution put fitness on race day. */
  projectedVdot: number;
  /** VDOT the goal time demands at this distance. */
  goalVdot: number;
  /** projectedVdot − currentVdot (the build the plan is expected to deliver). */
  projectedGainVdot: number;
  /** goalVdot − projectedVdot. >0 = the plan falls short; ≤0 = on/ahead. */
  gapVdot: number;

  /** predictRaceTime(currentVdot) — fitness today, seconds. */
  currentSec: number | null;
  /** predictRaceTime(projectedVdot) — projected race-day time, seconds. */
  projectedSec: number | null;
  /** The goal time, seconds (echoed for display math). */
  goalSec: number;
  /** projectedSec − goalSec. >0 = projected behind goal; ≤0 = on/ahead. */
  gapSec: number | null;

  /** Is the goal reachable on the current trajectory (within a small grace)? */
  reachable: boolean;
  /** VDOT the plan's peak prescribed work trains toward · null when no plan
   *  signal was supplied. The projected gain can't exceed this — the plan is
   *  the stimulus ceiling, you don't out-train what it prescribes. */
  plannedTargetVdot: number | null;
  /** Does the plan's prescribed ceiling reach the goal? null when unknown.
   *  false ⇒ the plan is under-built for the goal — the fix is a more
   *  aggressive plan, not a harder-trying runner. */
  planBuiltForGoal: boolean | null;
  weeksToRace: number;
  buildWeeks: number;
  executionQuality: number;
  /** The extra VDOT/wk over the projected slope needed to reach goal. 0 when
   *  already on track. Drives the "what closes it" coaching line. */
  rateShortfallPerWeek: number;
  /** 2026-06-12 · unconfirmed, training-derived fitness applied to the projection
   *  (HR-controlled over-performance on recent threshold work). Lives in PROJECTION
   *  space only — it never moves currentVdot or any prescribed pace. Capped at
   *  OVERPERFORMANCE_CAP_VDOT. 0 when the runner isn't beating the plan. */
  overPerformanceBonusVdot: number;
  /** 2026-06-12 · the upgrade gear: projected to BEAT the goal beyond noise.
   *  The projection can finally read PAST the goal, mirroring how drift reads short. */
  aheadOfGoal: boolean;
  /** 2026-06-12 · the trajectory has reached/passed the plan's prescribed ceiling
   *  — the plan trains for LESS than the runner is tracking toward. The trigger to
   *  offer a faster goal + rebuild (the plan is the limiter, not the runner).
   *  null when no plan signal supplied. */
  planUnderBuilt: boolean | null;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Project race-day fitness from current fitness + the planned build, scaled by
 * how well the runner is executing.
 *
 * @param currentVdot       responsive current fitness (bestRecentVdot)
 * @param goalSec           goal finish time, seconds
 * @param raceDistanceMi    goal race distance
 * @param weeksToRace       weeks from today to race day (fractional ok)
 * @param executionQuality  0..1, how well recent quality work is landing.
 *                          Default 0.7 (a runner with no execution signal yet
 *                          is assumed to roughly follow the plan, not nail it).
 */
export function projectFitnessTrajectory(args: {
  currentVdot: number;
  goalSec: number;
  raceDistanceMi: number;
  weeksToRace: number;
  executionQuality?: number;
  /** VDOT implied by the plan's peak prescribed quality work (caller derives
   *  it from plan_workouts pace targets). When supplied, the projected gain is
   *  capped at (plannedTargetVdot − currentVdot): the plan is the stimulus
   *  ceiling. Omit for a plan-agnostic projection (research build rate only). */
  plannedTargetVdot?: number | null;
  /** 2026-06-12 · unconfirmed training-derived over-performance (VDOT), from the
   *  caller's HR-controlled signal. Applied in projection space on top of the
   *  anchor; never touches currentVdot or paces. Capped at OVERPERFORMANCE_CAP_VDOT. */
  overPerformanceBonusVdot?: number | null;
}): FitnessTrajectory | null {
  const { currentVdot, goalSec, raceDistanceMi, weeksToRace } = args;
  if (!currentVdot || currentVdot <= 0) return null;
  if (!goalSec || goalSec <= 0) return null;
  if (!raceDistanceMi || raceDistanceMi <= 0) return null;

  const executionQuality = clamp(args.executionQuality ?? 0.7, 0, 1);
  const goalVdot = vdotFromRace(goalSec, raceDistanceMi);
  if (goalVdot == null) return null;

  const plannedTargetVdot = args.plannedTargetVdot ?? null;

  // 2026-06-12 · the UPGRADE gear. Over-performance is demonstrated-but-
  // unconfirmed fitness (HR-controlled threshold work beating prescribed pace)
  // that the race anchor hasn't caught up to. It rides in PROJECTION space on
  // top of the anchor — currentVdot and every prescribed pace stay put. Capped
  // so training alone can't manufacture a wild jump (research: training is a
  // lead, confirm with a race/TT to lock it).
  const overPerfBonus = clamp(args.overPerformanceBonusVdot ?? 0, 0, OVERPERFORMANCE_CAP_VDOT);
  // What the runner has actually shown they are, for sizing the remaining build.
  const effectiveCurrentVdot = currentVdot + overPerfBonus;

  const buildWeeks = Math.max(0, weeksToRace - TAPER_WEEKS);
  // 2026-06-16 · "the plan trusts itself" (David's doctrine). When the plan is
  // built for the goal and the runner is executing it, project that they REACH
  // the goal — do NOT tax a sound, well-executed plan with a generic population
  // build rate. The old `buildWeeks × 0.35 × exec` undershot even a goal-built,
  // perfectly-executed plan, which both contradicted the doctrine and read as
  // a contradiction next to "plan trains above goal."
  //
  // The gain the goal needs is (goalVdot − currentVdot). executionQuality
  // credits how much of it the projection trusts — and since executionQuality
  // is driven by recent test-point verdicts + missed-workout signal, REAL
  // evidence (a slow session, skipped work) is what pulls the projection short,
  // not a generic rate. The plan's prescribed ceiling caps the gain (an
  // under-built plan can't deliver the goal no matter the effort), and
  // over-performance rides on top, up to that same ceiling.
  const planCeilingGain = plannedTargetVdot != null
    ? Math.max(0, plannedTargetVdot - currentVdot)
    : Infinity;
  const gainCap = Math.min(MAX_BLOCK_GAIN, planCeilingGain);
  // 2026-07-06 · P1-14 · runway cap on the PLANNED (future-build) gain.
  // "The plan trusts itself" credits the full goal gap when execution is
  // clean — but one block cannot physically deliver more than the research
  // build rate over the weeks that REMAIN (~0.25–0.4 VDOT/wk over 12–16
  // weeks · Research/00a periodization; BASE_BUILD_RATE is the same 0.35
  // midpoint computeConfidenceLabel grades the runway against). Without this
  // term a VDOT-40 runner setting a goal needing 44.5 with 3 weeks left
  // projected the full 4.5 gain → hero read ON PACE while confidenceLabel on
  // the SAME payload read LOW ("behind on this runway"). A gap the runway
  // cannot close IS David's "very clear I cannot" case — the projection must
  // say so. The cap applies to modeled FUTURE gain only; the over-performance
  // bonus is DEMONSTRATED current fitness (HR-controlled sessions already
  // run) and keeps riding on top under the original block/plan ceiling, so a
  // tapering over-performer still reads ahead.
  const runwayCapGain = buildWeeks * BASE_BUILD_RATE;
  const plannedGainVdot = clamp((goalVdot - currentVdot) * executionQuality, 0, Math.min(gainCap, runwayCapGain));
  const projectedGainVdot = clamp(plannedGainVdot + overPerfBonus, 0, gainCap);
  const projectedVdot = Math.round((currentVdot + projectedGainVdot) * 10) / 10;

  const currentSec = predictRaceTime(currentVdot, raceDistanceMi);
  const projectedSec = predictRaceTime(projectedVdot, raceDistanceMi);

  const gapVdot = Math.round((goalVdot - projectedVdot) * 10) / 10;
  const gapSec = projectedSec != null ? projectedSec - goalSec : null;
  // 0.2 VDOT ≈ 10-12s at HM · within noise, call it reachable.
  const reachable = gapVdot <= 0.2;
  // 2026-06-12 · the upgrade gear's headline: projected to BEAT the goal beyond
  // noise. Mirrors how the drift detectors let the projection read SHORT.
  const aheadOfGoal = gapVdot < -0.2;
  // Is the plan's prescribed ceiling enough to reach the goal? (Same 0.3 grace.)
  const planBuiltForGoal = plannedTargetVdot != null
    ? plannedTargetVdot >= goalVdot - 0.3
    : null;
  // 2026-06-12 · the runner's DEMONSTRATED fitness (anchor + over-performance)
  // has reached/passed what the plan trains for — the plan now asks for LESS
  // than they're already showing. The signal to offer a faster goal + rebuild.
  // (2026-06-16 · keyed off effectiveCurrentVdot, not projectedVdot, since the
  // gain now caps AT the ceiling so projectedVdot can't exceed it.)
  const planUnderBuilt = plannedTargetVdot != null
    ? effectiveCurrentVdot > plannedTargetVdot + 0.3
    : null;

  // What rate would close the remaining gap over the build window — the
  // honest "you need a bit more than you're getting" number. Only meaningful
  // when behind and there's build time left.
  const neededGainVdot = Math.max(0, goalVdot - currentVdot);
  const neededRate = buildWeeks > 0 ? neededGainVdot / buildWeeks : Infinity;
  const projectedRate = buildWeeks > 0 ? projectedGainVdot / buildWeeks : 0;
  const rateShortfallPerWeek = reachable
    ? 0
    : Math.round(Math.max(0, neededRate - projectedRate) * 100) / 100;

  return {
    currentVdot,
    projectedVdot,
    goalVdot,
    projectedGainVdot: Math.round(projectedGainVdot * 10) / 10,
    gapVdot,
    currentSec,
    projectedSec,
    goalSec,
    gapSec,
    reachable,
    plannedTargetVdot,
    planBuiltForGoal,
    weeksToRace: Math.round(weeksToRace * 10) / 10,
    buildWeeks: Math.round(buildWeeks * 10) / 10,
    executionQuality: Math.round(executionQuality * 100) / 100,
    rateShortfallPerWeek,
    overPerformanceBonusVdot: Math.round(overPerfBonus * 10) / 10,
    aheadOfGoal,
    planUnderBuilt,
  };
}
