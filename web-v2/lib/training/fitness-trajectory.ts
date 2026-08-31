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
 *     = max(0, weeksToRace − taperWeeksForDistance(d))  // taper expresses fitness, doesn't build it
 *
 * currentVdot is the responsive fitness estimate (race anchor + training,
 * bestRecentVdot). executionQuality ∈ [0,1] comes from how the runner is
 * actually hitting the plan (test-point verdicts, missed-workout rate, drift
 * signals) — computed by the caller and passed in, so this stays a pure,
 * testable function. A runner nailing every session projects the full build
 * rate; one missing/downgrading sessions projects a discounted slope.
 *
 * THE BUILD RATE IS DOCTRINE, AND THERE IS NOW ONLY ONE OF IT (2026-08-18,
 * gain-rate reconciliation). This section used to say the rate was a
 * CONVENTION, because its previous citation ("Research/00a periodization" for a
 * VDOT-per-week figure) was fabricated — Research/00a never mentions VDOT. That
 * label was honest but it was not the end of the story: the engine carried
 * THREE incompatible rates (0.167-0.25 in goal-ready.ts, 0.35 here and in
 * goal-projection.ts, and a fabricated 0.5 in goal-gap.ts), and only one of
 * them was read out of the research.
 *
 * `Research/01` §"Testing cadence" states the only per-time VDOT quantum in the
 * whole corpus: reassess every 4-6 weeks, +1 VDOT per reassessment. That is a
 * band of 0.167-0.25 VDOT/wk. Every rate in the engine now comes from
 * lib/training/vdot-gain-rate.ts, which derives that band from the doc and is
 * bound by ADAPTATION.vdot-gain-rate. BASE_BUILD_RATE is its FAST edge (0.25) —
 * the most permissive rate research supports, so a projection is never
 * pessimistic by construction, and never promises more than doctrine allows.
 *
 * What Research/00a DOES ground is the SHAPE only: aerobic adaptation compounds
 * over a period of weeks and saturates as a trained runner nears their ceiling
 * (§"Aerobic Base Development"). MAX_BLOCK_GAIN is sized off the largest single
 * VDOT swing Research/01 quantifies (the >=2-week layoff drop, 3-5 points).
 *
 * TAPER_WEEKS_BY_DISTANCE replaces a flat `TAPER_WEEKS = 2` that was applied at
 * every distance while the doctrine-bound BLOCK_SHAPE.taperWeeks is 1/2/2/3/3
 * (5K/10K/HM/M/ultra). buildWeeks was therefore wrong at BOTH ends: a week too
 * generous for a marathon or ultra goal, a week too mean for a 5K. The table
 * here is pinned to BLOCK_SHAPE value-for-value by TAPER.trajectory-build-weeks
 * in the doctrine registry — it is a client-safe copy of one number, not a
 * second opinion. (This module is imported by a client component, GapPanel.tsx,
 * so it cannot import the generator, which pulls in `pg`.)
 *
 * Deliberately NOT modeled yet (documented, not hidden):
 *   · Diminishing returns near a runner's ceiling (gains slow as VDOT rises).
 *     The MAX_BLOCK_GAIN cap is a blunt stand-in. CI-followup.
 *   · Non-linear build shape (faster early, flatter near peak). Linear v1.
 */

import { predictRaceTime, vdotFromRace } from './vdot';
import {
  VDOT_GAIN_PER_WEEK_MAX,
  MAX_BLOCK_GAIN_VDOT,
  PROJECTION_NOISE_GRACE_VDOT,
  noiseGraceSec,
} from './vdot-gain-rate';
import {
  distanceCategoryOrNull,
  type DistanceCategory,
} from '@/lib/race/distance-category';

/** VDOT per week, focused block · the FAST edge of Research/01's 4-6 week,
 *  +1 VDOT reassessment band. ONE model, defined in vdot-gain-rate.ts. */
export const BASE_BUILD_RATE = VDOT_GAIN_PER_WEEK_MAX;
/** VDOT ceiling for one block · the largest single swing Research/01 puts a
 *  number on (the >=2-week layoff drop, 3-5 points). */
export const MAX_BLOCK_GAIN = MAX_BLOCK_GAIN_VDOT;

/**
 * Weeks of taper by race distance · no fitness gain is modelled inside it.
 *
 * Value-for-value the same as BLOCK_SHAPE.taperWeeks in lib/plan/generate.ts,
 * which is bound to Research/08 §9.1's taper-length table by
 * TAPER.duration-by-distance. This module cannot import the generator (it is
 * pulled into a client bundle by GapPanel.tsx and generate.ts imports `pg`), so
 * TAPER.trajectory-build-weeks asserts the two tables are identical rather than
 * letting them drift. The 10k/hm and m/ultra pairs share a value because
 * doctrine gives them the same whole-week rounding; both shares are recorded in
 * the lint's SHARED_ON_PURPOSE with that reason.
 */
export const TAPER_WEEKS_BY_DISTANCE: Readonly<Record<DistanceCategory, number>> = {
  '5k': 1,
  '10k': 2,
  'hm': 2,
  'm': 3,
  'ultra': 3,
};

/**
 * Taper weeks for a race distance. An unknown/unusable distance falls back to
 * the SHORTEST taper in the table, which is the conservative direction here:
 * it maximises buildWeeks' denominator nowhere and minimises the gain the
 * runway cap will allow, so an unreadable distance can never inflate a
 * projection.
 */
export function taperWeeksForDistance(raceDistanceMi: number | null | undefined): number {
  const cat = distanceCategoryOrNull(raceDistanceMi ?? null);
  return cat == null
    ? Math.min(...Object.values(TAPER_WEEKS_BY_DISTANCE))
    : TAPER_WEEKS_BY_DISTANCE[cat];
}
/** Max unconfirmed, training-derived fitness the projection will apply on top
 *  of the race anchor (the "upgrade gear"). Training is a LEAD, not a verdict
 *  (Research/01 §triggers-to-retest) — a race/TT confirms more than this. */
export const OVERPERFORMANCE_CAP_VDOT = 4.0;

export interface FitnessTrajectory {
  /** Responsive current fitness (race anchor + training). */
  currentVdot: number;
  /** Where the plan + execution put fitness on race day. */
  projectedVdot: number;
  /** VDOT the goal time demands at this distance. Null when the goal maps
   *  below the Daniels table floor of 30 (AUDIT P1-56, 2026-07-07) — an
   *  honest slow goal, not a data gap. currentVdot is always real here (the
   *  function requires it), so gapSec (a direct seconds comparison, not a
   *  VDOT round-trip) stays honest without needing a synthesized VDOT. */
  goalVdot: number | null;
  /** projectedVdot − currentVdot (the build the plan is expected to deliver). */
  projectedGainVdot: number;
  /** goalVdot − projectedVdot. >0 = the plan falls short; ≤0 = on/ahead.
   *  Null when goalVdot is null (below-table goal) — gapSec still carries
   *  the honest comparison via Riegel, this field just can't be expressed
   *  in VDOT-delta terms. */
  gapVdot: number | null;
  /** 2026-07-07 · AUDIT P1-56 · true when the goal implies VDOT < 30 (below
   *  the Daniels table). currentVdot/projectedVdot/gapVdot math still runs
   *  normally (the RUNNER's fitness is real and in-table — only the GOAL is
   *  off it); gapSec is computed via Riegel scaling from the runner's own
   *  demonstrated race/run pace instead of a VDOT delta. */
  goalBelowTable: boolean;

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
  /** 2026-07-13 · S5 · true IFF the PLANNED (future) gain was clamped by the
   *  runway (buildWeeks x BASE_BUILD_RATE x executionQuality) rather than by
   *  the block/plan ceiling or by execution/goal-gap — i.e. the goal is limited
   *  by the TIME remaining, not by the runner. Lets the surface say "runway
   *  limited" instead of "stalled" when the calendar, not the athlete, is the
   *  binding constraint. */
  runwayLimited: boolean;
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
  /**
   * 2026-09-01 · goal-projection-durability follow-up · a durability-aware
   * cross-distance read of TODAY's fitness at `raceDistanceMi` — the SAME
   * confidence-weighted blend of `predictRaceTime(currentVdot, raceDistanceMi)`
   * and `durability-anchor.ts#projectWithDurabilityExponent`'s real-race-anchored
   * projection that `goal-projection.ts#computeGoalProjection` computes for
   * `vdotProjectionSec`. Resolved and blended by the CALLER (it needs a DB read,
   * `resolveRaceExponent`) and passed in as plain data, on purpose: this module
   * is imported by a client component (`GapPanel.tsx`, see file header), so it
   * must stay free of any server-only import, and `durability-anchor.ts` pulls
   * in `pg`.
   *
   * Substitutes ONLY the final cross-distance read of TODAY's fitness — the
   * VDOT-space training-response model above (gain rate, execution quality,
   * plan ceiling, all temporal reasoning grounded in Research/01 with nothing to
   * say about cross-distance shape) is untouched. `projectedSec` below then
   * preserves the SAME relative improvement that model computed
   * (`danielsProjectedSec / danielsCurrentSec`) on top of this corrected
   * baseline, rather than re-deriving a "projected durability" that has no
   * real anchor to fit (there is no race result for a day that hasn't
   * happened yet). Null/omitted → byte-identical to this function's prior
   * behavior (`predictRaceTime` throughout) — confirmed by the continuity
   * tests in `fitness-trajectory-durability.test.ts`.
   */
  currentSecOverride?: number | null;
}): FitnessTrajectory | null {
  const { currentVdot, goalSec, raceDistanceMi, weeksToRace } = args;
  if (!currentVdot || currentVdot <= 0) return null;
  if (!goalSec || goalSec <= 0) return null;
  if (!raceDistanceMi || raceDistanceMi <= 0) return null;

  const executionQuality = clamp(args.executionQuality ?? 0.7, 0, 1);
  const goalVdotRaw = vdotFromRace(goalSec, raceDistanceMi);
  // 2026-07-07 · AUDIT P1-56 · goalVdotRaw is null in TWO cases: off-the-top
  // (faster than VDOT 85 — a data error, GOAL-4 in generate.ts already guards
  // this before a goal reaches here) and off-the-bottom (slower than VDOT 30 —
  // an honest, common goal for a beginner/recovery/soft target, NOT an error).
  // Distinguish via predictRaceTime(currentVdot): currentVdot is guaranteed
  // real here (checked above), so predictRaceTime(currentVdot, raceDistanceMi)
  // is an honest "what I'd run today" time; a goal SLOWER than that reads as
  // off-the-bottom (the runner is already fitter than this goal — a valid,
  // common state, e.g. a recovery-race or "just finish" goal). Off-the-top
  // (faster than currentVdot's predicted time despite VDOT 85 clamp) is
  // deliberately NOT specially handled here — generate.ts's GOAL-4 guard is
  // the doctrine-designated gate for that; this function trusts its caller.
  const currentPredictedSec = predictRaceTime(currentVdot, raceDistanceMi);
  const goalBelowTable = goalVdotRaw == null
    && currentPredictedSec != null && goalSec >= currentPredictedSec;
  // For the gain-sizing math below, an off-table SLOW goal is treated as
  // "already met" (goalVdot ≡ currentVdot) — the runner has demonstrably
  // already exceeded it, so the modeled gain needed is correctly zero. This
  // is not a fabricated VDOT for the goal; it only participates in the
  // clamp(goalVdot - currentVdot, ...) gain formula, which floors at 0 either
  // way. Display fields (gapSec) use the direct-seconds comparison below
  // instead of this VDOT stand-in, so nothing downstream displays a
  // synthesized VDOT number for an off-table goal.
  const goalVdot = goalVdotRaw ?? (goalBelowTable ? currentVdot : null);
  if (goalVdot == null) return null; // off-the-top or otherwise unreadable — caller's GOAL-4 should have filtered this

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

  // Per-distance taper · a marathon's build is a week shorter than a 5K's
  // relative to the same weeksToRace, and the old flat 2 got both ends wrong.
  const taperWeeks = taperWeeksForDistance(raceDistanceMi);
  const buildWeeks = Math.max(0, weeksToRace - taperWeeks);
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
  // clean — but one block cannot physically deliver more than the modelled
  // build rate over the weeks that REMAIN (BASE_BUILD_RATE — a bounded
  // convention, not a doctrine number; see the file-header note — is the
  // same 0.35 midpoint computeConfidenceLabel grades the runway against).
  // Without this term a VDOT-40 runner setting a goal needing 44.5 with 3 weeks left
  // projected the full 4.5 gain → hero read ON PACE while confidenceLabel on
  // the SAME payload read LOW ("behind on this runway"). A gap the runway
  // cannot close IS David's "very clear I cannot" case — the projection must
  // say so. The cap applies to modeled FUTURE gain only; the over-performance
  // bonus is DEMONSTRATED current fitness (HR-controlled sessions already
  // run) and keeps riding on top under the original block/plan ceiling, so a
  // tapering over-performer still reads ahead.
  // 2026-07-13 · S5 · scale the runway cap by executionQuality. Before this,
  // exec scaled ONLY the goal-gap term ((goalVdot - currentVdot) x exec), which
  // is irrelevant whenever the runway is the binding cap — so a missed block on
  // a short runway produced ZERO projection penalty. One block cannot deliver
  // more than the research build rate over the weeks that REMAIN, and a runner
  // who is not executing does not even earn that full rate.
  //   [TUNABLE · the one model tweak · keep BASE_BUILD_RATE (0.35) as-is;
  //    executionQuality is applied as the multiplier so an incomplete block
  //    honestly discounts the runway ceiling, not just the goal-gap term.]
  const runwayCapGain = buildWeeks * BASE_BUILD_RATE * executionQuality;
  // Which cap binds the PLANNED (future) gain: the block/plan ceiling, or the
  // runway. Named so runwayLimited below reads off the exact same quantity.
  const plannedGainCap = Math.min(gainCap, runwayCapGain);
  const plannedGainVdot = clamp((goalVdot - currentVdot) * executionQuality, 0, plannedGainCap);
  // 2026-07-13 · S5 · runwayLimited · true IFF the planned gain was clamped by
  // the runway (time remaining) rather than by the block/plan ceiling or by
  // execution/goal-gap: the runway is the smaller cap AND the exec-scaled goal
  // gap actually reaches it. The goal is limited by the calendar, not the
  // runner — the surface uses this to say "runway limited" not "stalled".
  const runwayLimited = plannedGainCap === runwayCapGain
    && (goalVdot - currentVdot) * executionQuality >= runwayCapGain;
  // projectedGainVdot feeds route COMPUTATIONS (buildRatio, accrual), not just
  // display — keep it UNROUNDED so a sub-0.05 arithmetic swing can never flip a
  // downstream verdict. Only the display echoes below are rounded.
  const projectedGainVdot = clamp(plannedGainVdot + overPerfBonus, 0, gainCap);
  const projectedVdotRaw = currentVdot + projectedGainVdot;
  const projectedVdot = Math.round(projectedVdotRaw * 10) / 10; // display only

  // 2026-09-01 · goal-projection-durability follow-up · currentSec honors the
  // caller's durability-blended override when supplied; projectedSec then
  // scales the durability-corrected baseline by the SAME ratio the pure-Daniels
  // read would have moved by, so the modeled GAIN (a temporal question) stays
  // exactly what the VDOT-space math above computed while only the DISTANCE
  // conversion (a cross-distance question) honors personal durability. When
  // `currentSecOverride` is null/omitted, `currentSec === danielsCurrentSec`
  // and this reduces to `danielsProjectedSec` exactly (x · (y/x) = y) — the
  // untouched prior behavior.
  const danielsCurrentSec = predictRaceTime(currentVdot, raceDistanceMi);
  const danielsProjectedSec = predictRaceTime(projectedVdot, raceDistanceMi);
  const currentSec = args.currentSecOverride ?? danielsCurrentSec;
  const projectedSec =
    currentSec != null && danielsCurrentSec != null && danielsCurrentSec > 0 && danielsProjectedSec != null
      ? Math.round(currentSec * (danielsProjectedSec / danielsCurrentSec))
      : danielsProjectedSec;

  // reachable / aheadOfGoal read the UNROUNDED gap so the ±0.05 display
  // rounding of projectedVdot can never flip the verdict. gapVdot is the
  // rounded display echo of the same quantity.
  const gapVdotRaw = goalVdot - projectedVdotRaw;
  const gapVdot = Math.round(gapVdotRaw * 10) / 10;
  const gapSec = projectedSec != null ? projectedSec - goalSec : null;
  // ONE noise grace, stated in VDOT (PROJECTION_NOISE_GRACE_VDOT = 0.2), a
  // fifth of the >=1-point movement Research/01 §"Update logic" re-derives
  // paces on. The seconds form below is DERIVED from it per distance rather
  // than being a second, HM-calibrated constant.
  const reachable = gapVdotRaw <= PROJECTION_NOISE_GRACE_VDOT;
  // 2026-06-12 · the upgrade gear's headline: projected to BEAT the goal beyond
  // noise. Mirrors how the drift detectors let the projection read SHORT.
  // 2026-08-17 · P1-56 follow-up · a below-table goal can't express this in
  // VDOT space (goalVdot is the currentVdot stand-in there, so gapVdotRaw is
  // pinned at ~0 and the old `< -0.2` test could never fire) — read the direct
  // seconds gap instead.
  // 2026-08-18 · that seconds threshold was a flat 30, calibrated at HM/M
  // scale and applied at every distance: 30 seconds is a rout over 5K and
  // inside the noise over a marathon, so it could never fire correctly for a
  // 5K runner. It is now the SAME 0.2-VDOT grace, converted to seconds off the
  // Daniels table at THIS runner's VDOT and THIS distance (~4s at 5K, ~40s at
  // the marathon). When the conversion is unavailable (no usable VDOT, or an
  // ultra past the Daniels validity range) the flag stays false rather than
  // borrowing another distance's number.
  const graceSec = noiseGraceSec(currentVdot, raceDistanceMi);
  const aheadOfGoal = goalBelowTable
    ? gapSec != null && graceSec != null && gapSec < -graceSec
    : gapVdotRaw < -PROJECTION_NOISE_GRACE_VDOT;
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
    // 2026-07-07 · AUDIT P1-56 · expose the HONEST goalVdot (null when
    // off-table) rather than the internal currentVdot stand-in used only for
    // the gain-sizing clamp above — a caller must never render a synthesized
    // VDOT number for a goal that doesn't map onto the Daniels table.
    goalVdot: goalBelowTable ? null : goalVdot,
    // 2026-07-13 · S5 · UNROUNDED · the route derives buildRatio and accrual
    // from this; rounding it here (was 0.1) let a sub-0.05 swing flip those.
    projectedGainVdot,
    gapVdot: goalBelowTable ? null : gapVdot,
    goalBelowTable,
    currentSec,
    projectedSec,
    goalSec,
    // gapSec is ALREADY a direct seconds comparison (projectedSec − goalSec,
    // no VDOT round-trip) so it stays honest for a below-table goal without
    // any special-casing: a goal slower than the runner's current/projected
    // fitness naturally reads negative (ahead of goal), matching reachable=true
    // and aheadOfGoal=true below, which is the correct read for "I've already
    // exceeded this easy goal."
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
    runwayLimited,
  };
}
