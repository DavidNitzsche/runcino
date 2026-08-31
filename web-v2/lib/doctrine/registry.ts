/**
 * lib/doctrine/registry.ts · THE DOCTRINE GATE.
 *
 * Every constant in this app that asserts something about human physiology has
 * a justification somewhere in `Research/`. Until now those two things lived in
 * different files with nothing holding them together, and the only mechanism
 * keeping a number honest was that somebody remembered why it was that number.
 *
 * The incident that made this file exist (2026-08-17, fixed in `52174bcd`):
 * post-race recovery for a half marathon prescribed 15 miles across 14 days —
 * five straight rest days — for a 33 mi/wk runner with a goal marathon 16 weeks
 * out. `Research/00b-recovery-protocols.md` has TWO adjacent columns: "total
 * recovery days (no quality)" (half = 10-14) and "days of zero/very-light
 * running" (half = 3-5). The engine encoded the first and spent it as if it
 * were the second, then sized every distance's recovery weeks off the MARATHON
 * reverse taper. Two weeks of no quality became two weeks of no running. The
 * owner found it on his phone. No test caught it, because the existing gates
 * (`_maint_invariants`, `_sweep_allusers`) check plan STRUCTURE — placement,
 * distance, alignment, counts — and nothing checked CONFORMANCE TO DOCTRINE.
 *
 * ── How this works ─────────────────────────────────────────────────────────
 *
 * Each entry names an engine constant, the doctrine file, a VERBATIM anchor
 * string in that file, a plain-English claim, and a `check` that must hold.
 * `_doctrine_gate.test.ts` resolves every anchor against the real file and runs
 * every check.
 *
 * Two rules make the mechanism worth having rather than ceremonial:
 *
 *   · ANCHOR ON QUOTED TEXT, NEVER LINE NUMBERS. Line numbers rot on the next
 *     edit; a table header survives everything except a change to what the
 *     table says — which is precisely when a human should be re-reading.
 *
 *   · READ THE NUMBERS OUT OF THE DOC. Wherever the doctrine states a band, the
 *     check parses that band at run time and compares the engine against it.
 *     A check that hardcodes both sides only proves the test agrees with
 *     itself. `RECOVERY.half-protocol-run-days` is the sharpest example: it
 *     counts the running days in the doc's own 14-day table and asserts the
 *     engine's `RECOVERY_RUN_DAYS.hm` equals that count.
 *
 * ── Adding a claim ─────────────────────────────────────────────────────────
 *
 * See CLAUDE.md §"Doctrine gate". Short version: append an entry. Nothing else
 * needs touching. If your claim reveals a real violation, DO NOT loosen the
 * claim — add an `exempt` key with an honest reason and report it.
 */
import {
  POST_RACE_RECOVERY_WEEKS,
  postRaceRecoveryWeeks,
  RECOVERY_WEEKLY_PCT_OF_BASE,
  RECOVERY_RUN_DAYS,
  RECOVERY_LONG_PCT,
  RECOVERY_HALF_WEEKLY_MINUTES,
  recoveryBlockCeilingPct,
  RECOVERY_EFFORT_SCALE,
  recoveryEffortScale,
  TAPER_RACE_WEEK_PCT_OF_PEAK,
  taperFactor,
  GENERAL_RAMP_CEILING,
  COMEBACK_RAMP_CEILING,
  CYCLE_GROWTH_CEILING,
  PEAK_HOLD_WEEKS,
  MLR_MAX_WEEK_SHARE,
  MLR_MIN_MI,
  TIER_TARGETS,
  MAINTENANCE_BY_TIER,
  BUILD_WINDOW_WEEKS,
  pickPlanMode,
  type DistCategory,
  type GoalTier,
} from '@/lib/plan/goal-tiers';
import { openBlockMode } from '@/lib/plan/race-lifecycle';
import { PLAN_TEMPLATES, RECOVERY_DAY_AFTER_LONG_MI } from '@/lib/plan/plan-templates';
import {
  WORKOUT_CATALOGUE,
  CROSS_REFERENCES,
  VARIATION_LEDGER,
  workoutBySlug,
} from '@/lib/workout-catalogue/catalogue';
import { DOCTRINE_PHASES } from '@/lib/workout-catalogue/types';
import { ZONE_TARGET, raceZoneTargets, zoneTargetsForWorkout } from '@/lib/coach/zone-target';
import {
  capFamilyOf,
  combinationViolation,
  rampedReps,
  selectWorkout,
  LONG_RUN_WEEKLY_SHARE_CAP,
  PHASE_FROM_ENGINE,
} from '@/lib/workout-catalogue/select';
import {
  RACE_CARB_G_PER_HR,
  RACE_OPENING_ALLOWANCE,
  RACE_HR_PCT_LTHR,
  RACE_HR_PCT_MAX,
  RACE_WARMUP,
  RACE_CARB_LOAD,
  RACE_PRERACE_MEAL_G_PER_KG,
  RACE_CAFFEINE_FRACTIONS,
  ULTRA_CAFFEINE_INTERVAL_MIN,
  warmupTotalMin,
} from '@/lib/race/distance-doctrine';
import {
  DISTANCE_CATEGORIES,
  DISTANCE_CATEGORY_MAX_MI,
  distanceCategoryOrNull,
} from '@/lib/race/distance-category';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { A_RACE_COLLISION_DAYS } from '@/lib/training/race-card';
import { HR_TARGET_MIN_REP_SEC } from '@/lib/training/spec-card';
import { anchorsFor, doctrinePhasesForWeek, renderPrescription } from '@/lib/plan/catalogue-rx';
import { WALK_RUN_LADDER } from '@/lib/plan/injury-protocols';
import { MIN_SESSIONS_PER_STAGE } from '@/lib/plan/return-ladder';
import {
  VDOT_FULL_VALUE_DAYS,
  VDOT_EXPIRY_DAYS,
  FADE_TAIL_DAYS,
  DANIELS_VDOT_MIN,
  DANIELS_VDOT_MAX,
  iPaceFromVdot,
  // CONVENTION.corpus-corroboration-count runs the real selector rather than
  // only reading its source — see that claim for why a regex was not enough.
  bestRecentVdot,
} from '@/lib/training/vdot';
import {
  zonePaceAtVdot,
  vdotFromZonePace,
  stimulusVdotForRow,
} from '@/lib/training/zone-stimulus';
import type { PaceZone } from '@/lib/workout-catalogue/types';
import {
  BASE_BUILD_RATE,
  MAX_BLOCK_GAIN,
  TAPER_WEEKS_BY_DISTANCE,
  taperWeeksForDistance,
} from '@/lib/training/fitness-trajectory';
// RACEPACE-1 · the prescribed-race-pace ceiling and the two 5% constants it
// must stay pinned to.
import {
  GOAL_OPTIMISM_TOLERANCE,
  seasonalVdotCeiling,
  achievableRaceTarget,
} from '@/lib/training/achievable-target';
import { TRAINING_ESTIMATE_SOFT_CAP_VDOT } from '@/lib/training/vdot';
import {
  TRAINING_LEAD_DELTA_THRESHOLD,
  TRAINING_LEAD_MIN_SESSIONS,
  TRAINING_LEAD_MIN_SPAN_DAYS,
  REGRESSION_DELTA_THRESHOLD,
} from '@/lib/plan/adapt';
import {
  MAX_GOAL_OPTIMISM_FRACTION,
  resolveEffectiveRaceTarget,
} from '@/lib/race/effective-race-target';
import { maxSeasonalVdotGain } from '@/lib/plan/recompute-paces';
import {
  ASSESSMENT_BLOCK_WEEKS_FAST,
  ASSESSMENT_BLOCK_WEEKS_SLOW,
  VDOT_PER_ASSESSMENT_BLOCK,
  VDOT_GAIN_PER_WEEK_MAX,
  VDOT_GAIN_PER_WEEK_CONSERVATIVE,
  VDOT_GAIN_PER_DAY_MAX,
  VDOT_GAIN_PER_DAY_CONSERVATIVE,
  MAX_BLOCK_GAIN_VDOT,
  LATENT_VDOT_UPGRADE_MAX,
  PROJECTION_NOISE_GRACE_VDOT,
  closableSecPerWeek,
} from '@/lib/training/vdot-gain-rate';
import { MIN_WEEKLY_MI_FOR_DISTANCE } from '@/lib/training/goal-assessment';
import {
  BUILD_RATE_VDOT_PER_WEEK,
  MARATHON_SPECIFICITY_PENALTY_PCT,
  marathonSpecificityAdjustment,
} from '@/lib/training/goal-projection';
import {
  deriveCoachGoal,
  fitPersonalExponent,
  courseIsHilly,
  gradeCourse,
  hillAdjustmentSec,
  HILLY_GAIN_FT_PER_MI,
  STEEP_GAIN_FT_PER_MI,
  HILL_RATE_SEC_PER_MI_PER_100FT,
  HILL_ADJUSTMENT_MAX_PCT,
  EXPONENT_FIT_WINDOW_DAYS,
  type ExponentFitRace,
} from '@/lib/race/coach-goal';
import { gradeGetsTheAsk } from '@/lib/race/goal-framing';
import { expectedDaysForAnchor } from '@/lib/coach/recovery-phase';
import {
  GAP_SHAVE_FRACTIONS,
  RERAMP_RESUME_FRACTION,
  RERAMP_MIN_BASE_SIGNAL_MI,
  RERAMP_WEEKLY_GROWTH,
  classifyGapBand,
  OVERSHOOT_RACE_RECENCY_DAYS,
  OVERSHOOT_RACE_LOOKBACK_DAYS,
  overshootRaceRecencyDays,
  raceSuppressesOvershoot,
} from '@/lib/plan/adapt';
import { EASY_SHARE_FLOOR } from '@/lib/plan/intensity-distribution';
import {
  qualityFamilyFor,
  MP_LONG_CADENCE_WEEKS,
  PROGRESSION_TAIL_SHARE,
  racePaceLongThisWeek,
  TAPER_MP_DOSE,
  taperMpDose,
  RAMP_BASE_RESUME_FRACTION,
  RESUME_SEQUENCE,
  cycleBoundedPeak,
  type RampBaseEvidence,
  SHORT_LAYOFF_WEEKS,
  RAMP_BASE_SUSTAINED_RANK,
  absenceWeeksEquivalent,
  resolveRampBase,
  restoreSteps,
  RESTORE_STEP_FRACTION,
  QUALITY_RETURN_MIN_SESSIONS,
  GENERAL_AEROBIC_MIN_MINUTES,
  GENERAL_AEROBIC_MAX_MINUTES,
  RECOVERY_RUN_MAX_MINUTES,
  BASE_REBUILT_SHARE,
  BASE_QUALITY_TYPES,
  FAST_FINISH_MIN_MI,
  TENK_PROGRESSION_FINISH_MI,
  BEGINNER_SURGE_REPS_BAND,
  BEGINNER_SURGE_MINUTES_BAND,
  beginnerSurgeDose,
  BEGINNER_HILL_SURGE_S,
  BEGINNER_HILL_REPS_BAND,
  beginnerHillReps,
  QUALITY_LOOKBACK_DAYS,
  qualityLookbackDays,
  RACE_RUNUP_DAYS,
  POST_RACE_PRIORITY_SCALE,
  postRaceNoQualityDays,
  NET_DOWNHILL_LONG_RUN_SHARE,
  LATE_TAPER_DOWNHILL_DAYS,
  R3_MIN_TRAINING_DAYS,
  MIDRACE_RESUME_RX,
  CUTBACK_LONG_DROP,
  HOLD_BLOCK_MAX_WEEKS,
  HOLD_PROGRESSION_MIN_WEEKS,
  HOLD_CYCLE_GROWTH,
} from '@/lib/plan/generate';
import {
  DRESS_REHEARSAL,
  DRESS_REHEARSAL_WINDOW_DAYS,
  dressRehearsalDose,
  isDressRehearsalSlot,
} from '@/lib/plan/long-run-rows';
import {
  BLEND_GRACE_FRACTION,
  blendedTPaceForWeek,
  gatedBlendFraction,
} from '@/lib/plan/recompute-paces';
import {
  THRESHOLD_HR_CEILING_OF_TARGET,
  THRESHOLD_HR_FLOOR_OF_TARGET,
  fastQualityLeftTheBand,
  slowQualityNeverReachedTheBand,
} from '@/lib/training/threshold-band';
import { conservativeVdotFromMileage, hrCapEasy } from '@/lib/plan/spec-builder';
import { MAX_LONG_BUMP_MI, MAX_WEEKLY_BUMP_MI, MAX_PER_EASY_BUMP_MI } from '@/lib/plan/adaptive-ramp';
import { COLD_START_CALIBRATION, simulate } from '@/lib/plan/simulator';
import {
  MARATHON_PACE_WORKOUT_CAP,
  CUMULATIVE_CEILING_KM,
  weeklyShareCap,
  capEnforced,
  duplicatePaceFamily,
  weeklyDoseBudgetMi,
  weekDosingFindings,
  dosePaceOf,
  dayDoses,
} from '@/lib/plan/dosing';
import {
  CALIBRATION_INTRO_WEEKS,
  EFFORT_CUED_TYPES,
  isProvisionalAnchor,
  isUnverifiedAnchor,
  paceBlendAnchorIsProvisional,
} from '@/lib/plan/anchor-provenance';
import {
  STRIDE_DURATION_S,
  STRIDE_RECOVERY_S,
  STRIDE_DEFAULT_REPS,
  STRIDE_DAYS_PER_WEEK,
  STRIDE_REPS_BY_PHASE,
  strideRepsForPhase,
  buildWorkoutSpec,
  marathonPaceSPerMi,
} from '@/lib/plan/spec-builder';
import {
  AT_PACE_SESSION_MI,
  AT_PACE_WEEKLY_SHARE_CAP,
  CRUISE_RECOVERY_MIN_PER_WORK_MI,
  INTERVAL_MIN_REPS,
  INTERVAL_REP_MINUTES,
  CONTINUOUS_TEMPO_MINUTES,
  REPETITION_REP_METRES,
  REPETITION_REP_MINUTES_MAX,
  advanceShape,
  atPaceSessionCapMi,
} from '@/lib/prescription/levers';
import { ST_OFFSET_S_PER_MI, resolveZoneAnchors } from '@/lib/plan/zone-anchors';
import { rPaceFromVdot, racePaceFromVdot, TABLE_RACE_DISTANCE_MI } from '@/lib/training/vdot';
import { parsePrescription, parseSegments, parseZones } from '@/lib/plan/prescription-parser';
import { SESSION_LADDER } from '@/lib/prescription/trajectory';
import {
  QUALITY_WARMUP_MI,
  QUALITY_COOLDOWN_MI,
  composeQualityDay,
} from '@/lib/plan/quality-day';
import {
  MIN_QUALITY_REP_MINUTES,
  clampToWeek,
  OverloadTrajectory,
} from '@/lib/prescription/trajectory';
import {
  GRADE_COST_PER_PCT,
  GRADE_MODEL_MAX_PCT,
  DESCENT_GIVEBACK_FRACTION,
  TREADMILL_AIR_RESISTANCE_GRADE_PCT,
  TREADMILL_COST_PER_PCT,
  composeEffortFactor,
  gradeFactor,
  treadmillEffectiveGradePct,
} from '@/lib/terrain/grade-adjust';
import {
  aerobicCeilingBpm, friel7Zones, judgeEasyRunHr, lthrZones, pctMaxZones, tanakaMaxHr, zoneIdxForBpm,
  FRIEL_5_ZONE_EDGES, FRIEL_7_ZONE_EDGES, PCT_MAX_ZONE_BANDS,
} from '@/lib/training/zones';
import { deriveReadingScopes, HR_REP_KINETICS_FLOOR_SEC } from '@/lib/coach/reading-scope';
import { lthrFromMaxHr, lthrFromRace } from '@/lib/training/lthr';
import {
  LTHR_MATERIAL_CHANGE_BPM,
  LTHR_QUALIFYING_MAX_MI,
  LTHR_QUALIFYING_MIN_MI,
  LTHR_RETEST_CADENCE_DAYS,
  LTHR_RETEST_MAX_WEEKS,
  LTHR_RETEST_MIN_WEEKS,
} from '@/lib/training/lthr-reanchor';
import { LTHR_TO_HRMAX_CONSERVATIVE_PCT, hrMaxImpliedByLthr } from '@/lib/training/max-hr';
import { RHR_ROLLING_WINDOW_DAYS } from '@/lib/training/biometrics-refresh';
import {
  EASY_HRMAX_CEILING_PCT,
  HEAT_CONFOUND_TEMP_C,
  DRIFT_CONFOUND_MINUTES,
  TERRAIN_CONFOUND_GAP_PCT,
  TERRAIN_CONFOUND_FT_PER_MI,
  OVER_CEILING_MAJORITY,
  raceWindowFor,
} from '@/lib/coach/easy-discipline';
import { vdotFromRace, predictRaceTime } from '@/lib/training/vdot';
import {
  EASY_PCT_HRMAX_BAND,
  THRESHOLD_PCT_HRMAX_BAND,
  EASY_PCT_LTHR_BAND,
  THRESHOLD_PCT_LTHR_BAND,
  THRESHOLD_MIN_QUALIFYING_SEC,
  THRESHOLD_MAX_QUALIFYING_SEC,
  THRESHOLD_MAX_REP_SEC,
  THRESHOLD_MIN_SESSION_TOTAL_SEC,
} from '@/lib/training/pace-corpus';
import {
  READINESS_WEIGHTS,
  LOAD_CONTEXT_MULTIPLIER,
  LOAD_CONTEXT_CURVE,
  loadContextMultiplier,
  computeReadiness,
  computeDynamicSleepTarget,
} from '@/lib/coach/readiness';
import {
  ACWR_BANDS,
  SLEEP_FLOOR_TOLERANCE_H,
  SLEEP_TARGET_BY_MPW,
  sleepFloorForMileage,
  sleepTargetForMileage,
  tierRulesFor,
  type ExperienceLevel,
} from '@/lib/coach/tier-rules';
// 2026-08-19 · the convergence rule · the owner's ruling that readiness may
// change a session only on a convergence of independent signals.
import {
  CONVERGENCE,
  gradeConvergence,
  hrvFallbackLnDrop,
} from '@/lib/coach/convergence';
import {
  GRADE_COST_PER_PCT as ELEV_GRADE_COST_PER_PCT,
  GRADE_LINEAR_LIMIT_PCT,
  DESCENT_RECOVERY_FRACTION,
  MAX_DESCENT_CREDIT_S_PER_MI,
  DESCENT_HARD_CAP_S_PER_MI,
} from '@/lib/training/elevation-model';
import {
  dewpointAddPct,
  INTERVAL_ADJUSTMENT_FACTOR,
  effortSlowdownPct,
} from '@/lib/training/heat-model';
import {
  WBGT_FLAGS,
  heatBandForFlag,
  // 2026-08-21 · the eight thresholds that used to cite line numbers.
  HEAT_DOSE_TAIR_F,
  HEAT_DOSE_WBGT_F,
  TD_TIME_ON_FEET_F,
  WBGT_TIME_ON_FEET_F,
  WBGT_BAIL_F,
  TD_BAIL_F,
  AQI_BAIL,
  AQI_TIME_ON_FEET_LOW,
} from '@/lib/coach/heat-gate';
import { HEAT_HR_CONFOUNDER, heatHrBumpBpm } from '@/lib/weather/heat-adjustment';
import {
  MAUGHAN_HEAT_SLOWDOWN,
  maughanSlowdownPct,
  maughanSlowdownPctForVdot,
  abilityTierFromVdot,
} from '@/lib/training/heat-model';
import type { AbilityTier } from '@/lib/training/heat-model';
import {
  REPRESENTATIVE_FLOOR,
  UNREPRESENTATIVE_FLOOR,
  HEAT_GATE_SUM_F,
  HEAT_GATE_DEWPOINT_F,
  ALTITUDE_GATE_FT,
  WIND_GATE_MPH,
  FLAT_COURSE_GAIN_FT,
  HEAT_ALTITUDE_COMPOUND_THRESHOLD_PCT,
  HEAT_ALTITUDE_COMPOUND_HAIRCUT,
  PACING_CV_CEILING_PCT,
  PACING_CV_DOC_ROW,
  ALTITUDE_SLOWDOWN_PCT,
  HEADWIND_COST_S_PER_MI,
  TAILWIND_BENEFIT_S_PER_MI,
  assessRepresentativeness,
  composeSlowdown,
  effectiveEffortClass,
} from '@/lib/race/representativeness';
import {
  authorityTier,
  isGradedRacePriority,
  selectionAuthority,
  GRADED_RACE_PRIORITIES,
} from '@/lib/race/effort-authority';
import { provisionalResultPatch } from '@/lib/race/auto-result';
import {
  ACWR_ACUTE_DAYS,
  ACWR_CHRONIC_DAYS,
  ACWR_MIN_COVERAGE_DAYS,
  acwrFromDailyMileage,
} from '@/lib/coach/acwr';
import { ATL_WINDOW_DAYS, CTL_WINDOW_DAYS, labelForTsb } from '@/lib/coach/training-form';
import {
  CURVE_NEUTRAL_EXPONENT_BAND,
  DECOUPLING_ENDURANCE_GAP_PCT,
  DECOUPLING_HEAT_ARTIFACT_PCT,
  DEFAULT_LIMITER,
  HARD_DAY_GAP_DAYS,
  INCOMPLETE_RECOVERY_WORKOUTS,
  LEVERS,
  fitRiegelExponent,
  type Limiter,
} from '@/lib/coach/limiter';
// ── Rule 7 · 2026-08-19 · constants that asserted physiology and cited a line
// number, or cited nothing at all. See the claim block at the end of the file.
import {
  ACCLIMATION_TIMELINE,
  FULL_ACCLIM_DAYS,
  MAX_PENALTY_BPM_AT_PEAK,
  expectedHeatPenaltyBpm,
} from '@/lib/coach/heat-acclimatization';
import { sessionRpeAu } from '@/lib/coach/strength-load';
import {
  MAX_WALK_RUN_STAGE,
  MAX_STAGE_ADVANCE_PER_WEEK,
  ALTERNATE_DAY_THROUGH_STAGE,
  INJURY_PLAN_MAX_WEEKS,
  resolveInjuryProtocol,
} from '@/lib/plan/injury-protocols';
import {
  ACWR_MIN_RUN_DAYS,
  ACWR_MIN_CHRONIC_MI_PER_DAY,
  RUN_DAY_MIN_MI,
} from '@/lib/coach/acwr';
import {
  DENSITY_PENALTY,
  PLATEAU_FLOOR_VDOT,
  QUALITY_DENSITY_CEILING,
  RAMP_FLAG_THRESHOLD,
  SIGMA_SEC_PER_MILE,
  BAND_SIGMAS,
} from '@/lib/plan/simulator';
// RACEROLE-1 (2026-08-28) · tune-up race-role recommendation bands + the
// recovery windows an answered role imposes. See the two RACEROLE claims.
import {
  HALF_B_EFFORT_GAP_DAYS,
  HALF_HONEST_RACE_GAP_DAYS,
  ROLE_POST_QUALITY_FREE_DAYS,
  recommendRaceRole,
} from '@/lib/race/race-role';
import type { DoctrineClaim } from './types';
import { matchLiteral, parseBand, parseBands, parsePaceBandSec, parsePctBand, resolveCitation, sourceOf } from './resolve';
import {
  SHOE_LIFESPAN,
  SHOE_TYPES,
  SUPER_SHOE_MAX_SESSIONS_PER_WEEK,
  defaultCapMi,
  resolveShoeCapMi,
} from '@/lib/shoe/lifespan';

const CATS: DistCategory[] = ['5k', '10k', 'hm', 'm', 'ultra'];

/** A `RampBaseEvidence` with nothing in it · claims that exercise
 *  `cycleBoundedPeak` spread one field over this so a new field on the
 *  interface cannot silently change what they are testing. */
const EVIDENCE_ZERO: RampBaseEvidence = {
  baseMi: 0, meanMi: 0, sustainedMi: 0, peakMi: 0,
  interruptionWeeks: 0, allowedInterruptionWeeks: 0, lifted: false,
  heldMi: 0, returning: false, heldByCurrent: false,
};
const TIERS: GoalTier[] = ['elite', 'advanced', 'intermediate', 'developing'];

/** DistCategory → the row label it maps to in the Research/ distance tables. */
const DOC_ROW: Record<DistCategory, string> = {
  '5k': '5K',
  '10k': '10K',
  hm: 'Half marathon',
  m: 'Marathon',
  ultra: '50K',
};

/** Seconds a VDOT delta is worth at a distance · the same derivation
 *  ADAPTATION.closable-gap-is-derived asserts the engine uses, computed here
 *  independently so the claim compares two routes to the number rather than
 *  the engine to itself. */
function secondsForDelta(vdot: number, distanceMi: number, delta: number): number {
  const now = predictRaceTime(vdot, distanceMi);
  const fitter = predictRaceTime(vdot + delta, distanceMi);
  if (now == null || fitter == null) throw new Error('predictRaceTime returned null for an in-table runner');
  return now - fitter;
}

/** The seconds form of the projection noise grace, derived the same way. */
function noiseGraceSecFor(vdot: number, distanceMi: number): number | null {
  const now = predictRaceTime(vdot, distanceMi);
  const fitter = predictRaceTime(vdot + PROJECTION_NOISE_GRACE_VDOT, distanceMi);
  return now == null || fitter == null ? null : now - fitter;
}

function within(value: number, [lo, hi]: [number, number], what: string): void {
  if (value < lo || value > hi) {
    throw new Error(`${what}: engine has ${value}, doctrine says ${lo}–${hi}`);
  }
}

/**
 * A SIGNED band written the way Research/08 §3.1 writes it — "-2 to +5
 * sec/mile", "+10 to +20 sec/mile slower". `parseBand` cannot read these: it
 * strips parentheses and then looks for a hyphen BETWEEN two numbers, which a
 * leading minus sign and the word "to" both defeat.
 */
function signedBand(cell: string): [number, number] {
  const nums = [...cell.replace(/\([^)]*\)/g, ' ').matchAll(/([+-]?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (nums.length < 2) throw new Error(`DOCTRINE · no signed band in doctrine cell "${cell}"`);
  return [nums[0], nums[1]];
}

/**
 * ZONE-BANDS-1 · read Friel's percent EDGES out of the doctrine table's own
 * cells, rather than restating them here.
 *
 * The rows are `< 85%`, `85–89%`, … `103–106%`, `> 106%` — whole-percent runs
 * that tile the whole percents exactly. Each bounded row's stated FLOOR is an
 * edge; the open top row's floor is the row before it plus one whole percent,
 * which is the only reading under which the rows tile.
 */
function frielEdgesFromDoctrine(cells: string[]): number[] {
  if (cells.length < 3) throw new Error(`DOCTRINE · Friel table has only ${cells.length} rows`);
  const bounded = cells.slice(1, -1).map((c) => parsePctBand(c));
  const [openLowPct] = parsePctBand(cells[0]);
  if (Math.abs(openLowPct - bounded[0][0]) > 1e-9) {
    throw new Error(
      `DOCTRINE · the table's open bottom row says "${cells[0]}" but the next row starts at ` +
      `${bounded[0][0]} · those must be the same edge`,
    );
  }
  const [openHighPct] = parsePctBand(cells[cells.length - 1]);
  const lastBoundedHi = bounded[bounded.length - 1][1];
  if (Math.abs(openHighPct - lastBoundedHi) > 1e-9) {
    throw new Error(
      `DOCTRINE · the table's open top row says "${cells[cells.length - 1]}" but the row before ` +
      `it ends at ${lastBoundedHi} · those must be the same edge`,
    );
  }
  // Floors of the bounded rows, then one whole percent above the last of them.
  const edges = bounded.map(([lo]) => lo);
  edges.push(Number((lastBoundedHi + 0.01).toFixed(4)));
  return edges;
}

/**
 * ZONE-BANDS-1 · assert a table's bpm bands ARE the percent buckets.
 *
 * No tolerance. The derivation is deterministic — band k runs from
 * `ceil(anchor × eₖ)` to `ceil(anchor × eₖ₊₁) − 1` — so an engine that agrees
 * with doctrine agrees exactly. The `± 1` slack these claims used to carry is
 * precisely what let two independently-rounded edges leave a 1-bpm hole
 * between every pair of adjacent zones and pass the gate for a year.
 */
function assertBandsMatchEdges(
  zones: Array<{ shortLabel: string; lower: number | null; upper: number | null }>,
  anchorBpm: number,
  edges: number[],
  what: string,
  opts: { openLow: boolean } = { openLow: true },
): void {
  const floors: Array<number | null> = opts.openLow
    ? [null, ...edges.map((e) => Math.ceil(anchorBpm * e))]
    : edges.map((e) => Math.ceil(anchorBpm * e));
  if (floors.length !== zones.length) {
    throw new Error(`${what}: ${zones.length} zones for ${floors.length} bands`);
  }
  zones.forEach((z, i) => {
    const wantLower = floors[i];
    const wantUpper = i + 1 < floors.length ? floors[i + 1]! - 1 : null;
    if (z.lower !== wantLower || z.upper !== wantUpper) {
      throw new Error(
        `${what} ${z.shortLabel} @ anchor ${anchorBpm}: engine has ` +
        `${z.lower ?? '-inf'}-${z.upper ?? '+inf'}, the doctrine percents give ` +
        `${wantLower ?? '-inf'}-${wantUpper ?? '+inf'}`,
      );
    }
  });
}

function atMost(value: number, ceiling: number, what: string): void {
  if (value > ceiling) {
    throw new Error(`${what}: engine has ${value}, doctrine ceiling is ${ceiling}`);
  }
}


/**
 * EFFORT-RAMP-1 · a doctrine Reps row that states a BUILD, checked end to end.
 *
 * Both ends come out of the doc cell — the START the row opens at and the
 * BUILT dose it arrives at — and the engine is asked to reproduce both. A check
 * that hardcoded 4 and 12 would only prove the test agrees with itself; this
 * one fails the moment the row is reworded, which is what the gate is for.
 *
 * `cell` is the doc's own words, e.g. "Start 4–6, build to 8–12" (§7.3) or
 * "8–16 (start 8, build to 16)" (§8.2).
 */
function assertStatedBuild(cell: string, slug: string): void {
  const dashed = cell.replace(/[–—]/g, '-');
  const start = dashed.match(/start\s+(\d+)/i);
  const build = dashed.match(/build\s+to\s+(\d+)(?:\s*-\s*(\d+))?/i);
  if (!start || !build) {
    throw new Error(
      `the Reps row for ${slug} no longer states a start and a build: "${cell}"\n` +
        '  Doctrine changed. Read the row, then decide whether the engine should still ramp\n' +
        '  this session at all — do not relax this claim to make it pass.',
    );
  }
  const startAt = Number(start[1]);
  const builtTo = Number(build[2] ?? build[1]);

  const entry = workoutBySlug(slug);
  if (!entry) throw new Error(`catalogue has no ${slug}`);
  const s = entry.structures[0];
  if (s.kind !== 'reps') throw new Error(`${slug} is not a rep set`);
  if (s.repBuild == null) {
    throw new Error(
      `${slug} carries no \`repBuild\`, so it is sized at the top of its band in every week ` +
        `of every phase. Doctrine states "${cell}".`,
    );
  }
  if (s.repBuild.replace(/[–—]/g, '-').trim() !== dashed.trim()) {
    throw new Error(
      `${slug} quotes "${s.repBuild}" and §-row now reads "${cell}" — re-quote it verbatim`,
    );
  }
  within(s.reps.min, [startAt, startAt], `${slug} opening rep count`);
  within(s.reps.max, [builtTo, builtTo], `${slug} built rep count`);

  // The ramp itself: it opens where the doc starts, ends where the doc builds
  // to, and never goes backwards on the way. Sampled across the block rather
  // than at the two ends alone, because a non-monotone ramp reads to a runner
  // as a session getting easier mid-block.
  within(rampedReps(s.reps, 0), [startAt, startAt], `${slug} reps at the block's first week`);
  within(rampedReps(s.reps, 1), [builtTo, builtTo], `${slug} reps at the block's last week`);
  within(rampedReps(s.reps, null), [startAt, startAt], `${slug} reps with no block position`);
  let prev = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const n = rampedReps(s.reps, i / 40);
    if (n < prev) throw new Error(`${slug} rep ramp goes backwards at position ${i / 40}`);
    if (n < startAt || n > builtTo) {
      throw new Error(`${slug} rep ramp leaves the doc's ${startAt}-${builtTo} band at ${n}`);
    }
    prev = n;
  }
}

/** Research/00a §"Volume progression rules" long-run cap, as a fraction band. */
function resolveShareCap(): [number, number] {
  const cite = resolveCitation('Research/00a-distance-running-training.md', '### Volume progression rules');
  const spec = cite.table().cell('Long-run cap', 'Specification');
  const [lo, hi] = parseBand(spec);
  return [lo / 100, hi / 100];
}

/**
 * Source with comments removed, for the checks that assert a call or a symbol
 * is GONE from a file.
 *
 * The same rule the lint's bare-attribution check already applies to backticked
 * spans: a comment that writes down the mistake it replaced is not making the
 * mistake. Several of the claims below assert `vdotFromRace(` or `T_PACE_TABLE`
 * no longer appears in a file whose header explains, at length, why it used to.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

import {
  DECOUPLING_PROTOCOL_MIN_MINUTES,
  DECOUPLING_BAND_STRONG_PCT,
  DECOUPLING_BAND_ACCEPTABLE_PCT,
  DECOUPLING_BAND_ABOVE_AET_PCT,
} from '@/lib/training/aerobic-decoupling';
import { FUELLING_RELEVANT_MIN_MINUTES } from '@/lib/coach/run-recap';
import { CROSS_SPAN_CI_PCT } from '@/lib/training/goal-projection';
import {
  VALID_WEEKLY_MI,
  HIST_AVG_MIDPOINTS,
  HIST_LONG_MIDPOINTS,
} from '@/lib/onboarding/state';

export const DOCTRINE_REGISTRY: DoctrineClaim[] = [
  // == LONG-RUN ROWS · Research/04 4.1's five rows, kept apart ===============
  {
    id: 'LONGRUN.dress-rehearsal',
    binds: [
      'lib/plan/long-run-rows.ts#DRESS_REHEARSAL',
      'lib/plan/long-run-rows.ts#dressRehearsalDose',
      'lib/plan/long-run-rows.ts#isDressRehearsalSlot',
      'lib/plan/generate.ts#authorDressRehearsal',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 4.6 Dress rehearsal long run',
    claim:
      'The dress rehearsal is its own long-run row, not a fast finish. It is 18-22 mi for a ' +
      'marathoner and 12-14 mi for a half marathoner — the Distance row states BOTH races — ' +
      'it carries 4-8 mi at marathon pace inside an easy bulk, it lands three weeks ' +
      'before the race, and its own contraindication row says it is not a fitness test. The ' +
      'engine must place it where the doc places it, dose it inside the band the doc states, ' +
      'never size it above that band however long the run is, and carry BOTH distance bands ' +
      '— until 2026-08-28 it authored only the marathon\'s and the half had no rehearsal at all.',
    check({ cite }) {
      const t = cite.table();
      // 1 · placement, in the doc's own words.
      const when = t.cell('When in cycle', 'Prescription');
      const weeksOut = parseBand(when)[0];
      if (DRESS_REHEARSAL.daysBeforeRace !== weeksOut * 7) {
        throw new Error(
          `DRESS_REHEARSAL.daysBeforeRace = ${DRESS_REHEARSAL.daysBeforeRace}, doctrine says "${when}"`,
        );
      }
      // 2 · the marathon distance band, read off the Distance row's first
      //     half; the half marathon's is the second half of the same row —
      //     "18–22 mi (marathon); 12–14 mi (HM)".
      const distRow = t.cell('Distance', 'Prescription');
      const distBand = parseBand(distRow.split(';')[0]);
      if (DRESS_REHEARSAL.totalMiBand[0] !== distBand[0] || DRESS_REHEARSAL.totalMiBand[1] !== distBand[1]) {
        throw new Error(
          `DRESS_REHEARSAL.totalMiBand = ${DRESS_REHEARSAL.totalMiBand.join('-')}, doctrine says ${distBand.join('-')}`,
        );
      }
      const hmHalf = distRow.split(';')[1];
      if (!hmHalf || !/HM|half/i.test(hmHalf)) {
        throw new Error(
          `§4.6's Distance row no longer states an HM band ("${distRow}") — the half's rehearsal loses its citation; re-read the section`,
        );
      }
      const hmBand = parseBand(hmHalf);
      if (DRESS_REHEARSAL.hmTotalMiBand[0] !== hmBand[0] || DRESS_REHEARSAL.hmTotalMiBand[1] !== hmBand[1]) {
        throw new Error(
          `DRESS_REHEARSAL.hmTotalMiBand = ${DRESS_REHEARSAL.hmTotalMiBand.join('-')}, doctrine says ${hmBand.join('-')}`,
        );
      }
      // 3 · the MP dose. The Pace row reads "Easy bulk + 2-3 segments at MP
      //     (4-8 mi total at MP)" — the band in the parenthesis is the total,
      //     which is what the engine doses; the 2-3 in front counts segments.
      const paceRow = t.cell('Pace', 'Prescription');
      const mpBand = parseBands(paceRow).find((b) => /mi total at MP/i.test(paceRow) && b[1] > 3);
      if (!mpBand) throw new Error(`LONGRUN.dress-rehearsal: no "N-N mi total at MP" band in "${paceRow}"`);
      if (DRESS_REHEARSAL.mpMiBand[0] !== mpBand[0] || DRESS_REHEARSAL.mpMiBand[1] !== mpBand[1]) {
        throw new Error(
          `DRESS_REHEARSAL.mpMiBand = ${DRESS_REHEARSAL.mpMiBand.join('-')}, doctrine says ${mpBand.join('-')}`,
        );
      }
      // 4 · and the engine actually obeys the band it just read. A long run in
      //     the middle of the distance band gets a dose in the middle of the MP
      //     band; an enormous long run never gets more than the band's top.
      const mid = dressRehearsalDose((distBand[0] + distBand[1]) / 2, 99, 2);
      if (!mid) throw new Error('dressRehearsalDose refuses the band midpoint');
      within(mid.mpMi, mpBand, 'dressRehearsalDose at the distance-band midpoint');
      const huge = dressRehearsalDose(40, 99, 2);
      if (huge && huge.mpMi > mpBand[1]) {
        throw new Error(`dressRehearsalDose(40 mi) = ${huge.mpMi} mi at MP, over doctrine's ${mpBand[1]}`);
      }
      // 4b · the same obedience for the half: a rehearsal in the middle of the
      //      HM's own distance band doses inside the one MP band the Pace row
      //      states, and an oversized long still cannot exceed its top.
      const hmMid = dressRehearsalDose((hmBand[0] + hmBand[1]) / 2, 99, 2, false, DRESS_REHEARSAL.hmTotalMiBand);
      if (!hmMid) throw new Error('dressRehearsalDose refuses the HM band midpoint');
      within(hmMid.mpMi, mpBand, 'dressRehearsalDose at the HM distance-band midpoint');
      const hmHuge = dressRehearsalDose(20, 99, 2, false, DRESS_REHEARSAL.hmTotalMiBand);
      if (hmHuge && hmHuge.mpMi > mpBand[1]) {
        throw new Error(`dressRehearsalDose(20 mi, HM band) = ${hmHuge.mpMi} mi at MP, over doctrine's ${mpBand[1]}`);
      }
      // 5 · the slot is exactly one long run wide. Wider selects two, narrower
      //     selects none, and both are silent failures.
      const slots = [];
      for (let d = 0; d <= 60; d++) if (isDressRehearsalSlot(d)) slots.push(d);
      if (slots.length !== DRESS_REHEARSAL_WINDOW_DAYS * 2 + 1 || slots.length !== 7) {
        throw new Error(`the dress-rehearsal window is ${slots.length} days wide; a long run is weekly, so it must be 7`);
      }
      if (!isDressRehearsalSlot(DRESS_REHEARSAL.daysBeforeRace)) {
        throw new Error('the dress-rehearsal window does not contain its own centre');
      }
    },
  },
  {
    id: 'LONGRUN.tenk-progression',
    binds: [
      'lib/plan/generate.ts#TENK_PROGRESSION_FINISH_MI',
      'lib/plan/generate.ts#longFinishSegment',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '### 10K — Intermediate',
    claim:
      'A 10K build\'s long runs are not all plain. The 10K Intermediate template names the ' +
      'progression LR among its Key workout types and its sample peak week states the dose: ' +
      '"9-10 mi E w/ last 2 mi @ M" — a fixed two-mile marathon-pace tail, NOT the marathon ' +
      'build\'s 30-50% fractions. Research/04 §4.3 gives the session its cadence ("Every 2-3 ' +
      'weeks in specific phase"), the same rhythm racePaceLongThisWeek already walks. Before ' +
      '2026-08-28 racePaceTag null meant a 10K plan\'s sixteen long runs were sixteen ' +
      'identical easy runs. 5K long runs stay plain (every long in Research/22\'s three 5K ' +
      'rows is E, and no 5K row names a progression LR), as do 10K beginners ("E with ' +
      'optional walk breaks").',
    check({ cite }) {
      // The template still names the session.
      const keyTypes = cite.table().cell('Key workout types', 'Value');
      if (!/progression LR/i.test(keyTypes)) {
        throw new Error(
          `§"10K — Intermediate" no longer lists a progression LR ("${keyTypes}") — the 10K tail loses its citation; re-read the section`,
        );
      }
      // The dose, read out of the sample week's own cell rather than restated.
      const sample = cite.text().match(/last\s+(\d+(?:\.\d+)?)\s*mi\s*@\s*M\b/i);
      if (!sample) {
        throw new Error('§"10K — Intermediate" no longer states a "last N mi @ M" sample long — re-derive the tail dose');
      }
      if (TENK_PROGRESSION_FINISH_MI !== Number(sample[1])) {
        throw new Error(
          `TENK_PROGRESSION_FINISH_MI = ${TENK_PROGRESSION_FINISH_MI}, the sample week says "last ${sample[1]} mi @ M"`,
        );
      }
      // §4.3's cadence still reads "every 2-3 weeks", the band MP_LONG_CADENCE_WEEKS
      // sits in (that constant's own claim holds the value; this holds the citation).
      const p43 = resolveCitation('Research/04-workout-vocabulary.md', '### 4.3 Progression long run');
      const [cLo, cHi] = parseBand(p43.table().cell('Frequency', 'Prescription'));
      if (2 < cLo || 2 > cHi) {
        throw new Error(`§4.3's cadence is every ${cLo}-${cHi} weeks and no longer admits the engine's 2-week rhythm`);
      }
      // 5K stays plain: the claim's own negative half. If a 5K row starts
      // naming a progression LR, this fix must be revisited, not assumed.
      for (const lvl of ['Beginner', 'Intermediate', 'Advanced']) {
        const five = resolveCitation('Research/22-plan-templates.md', `### 5K — ${lvl}`);
        if (/progression LR/i.test(five.table().cell('Key workout types', 'Value'))) {
          throw new Error(`§"5K — ${lvl}" now names a progression LR — the 5K's plain-long ruling needs re-reading`);
        }
      }
      // And the fixed tail is at least the smallest legal race-pace segment,
      // so it can never be authored and then zeroed by the finish floor.
      if (TENK_PROGRESSION_FINISH_MI < FAST_FINISH_MIN_MI) {
        throw new Error(
          `TENK_PROGRESSION_FINISH_MI (${TENK_PROGRESSION_FINISH_MI}) is below FAST_FINISH_MIN_MI (${FAST_FINISH_MIN_MI}) — every tail would be authored and immediately zeroed`,
        );
      }
    },
  },

  {
    id: 'LONGRUN.intensity-cadence',
    binds: [
      'lib/plan/generate.ts#longFinishSegment',
      'lib/plan/generate.ts#layoutWeek.qualityIntensityLongWeek',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Long-run rules of thumb',
    claim:
      'Intensity inserts on the long run come one in every two to three long runs across the ' +
      'whole marathon/half block, not only in the race-specific phase. The QUALITY warm-in ' +
      'ramp used to put a race-pace finish on each of the phase\'s last THREE weeks — three ' +
      'consecutive intensity longs, which this rule forbids — so the warm-in window now walks ' +
      'the same racePaceLongThisWeek cadence the race-specific arm walks, anchored on its own ' +
      'phase end. The cadence band is read out of the rule\'s own sentence and the engine\'s ' +
      'constant must sit inside it; the source-level check holds the QUALITY arm to the gate.',
    check({ cite }) {
      const rule = cite.text().split('\n').find((l) => /intensity inserts/i.test(l));
      if (!rule) {
        throw new Error('§"Long-run rules of thumb" no longer states the intensity-insert rhythm — re-read the section');
      }
      const band = rule.match(/1 in every (\d+)\s*[–—-]\s*(\d+) long runs/i);
      if (!band) {
        throw new Error(`the rule no longer states a "1 in every N-N long runs" band: "${rule.trim()}"`);
      }
      const [lo, hi] = [Number(band[1]), Number(band[2])];
      if (MP_LONG_CADENCE_WEEKS < lo || MP_LONG_CADENCE_WEEKS > hi) {
        throw new Error(
          `MP_LONG_CADENCE_WEEKS is ${MP_LONG_CADENCE_WEEKS}, doctrine's long-run intensity rhythm is 1 in every ${lo}-${hi}`,
        );
      }
      // The QUALITY arm gates on the cadence, unconditionally — the regression
      // this claim exists to catch is the three-consecutive-week window coming
      // back.
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      matchLiteral(
        src,
        /if \(phase !== 'QUALITY'\) return null;[\s\S]{0,1600}?if \(!cadenceWeek\) return null;/,
        "longFinishSegment's QUALITY arm gates on the cadence",
      );
      matchLiteral(
        src,
        /const qualityIntensityLongWeek = phase === 'QUALITY' && racePaceTag != null\s*\n\s*&& racePaceLongThisWeek\(weekIdx, weeksToPhaseEnd, cutbackEveryN\);/,
        'the QUALITY intensity-long cadence flag walks the same picker as the race-specific arm',
      );
    },
  },

  {
    id: 'LONGRUN.modified-block-doses-its-own-row',
    binds: [
      'lib/plan/generate.ts#modifiedBlockSegFor',
      'lib/plan/dosing.ts#MARATHON_PACE_WORKOUT_CAP',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 11.1 Canova special block',
    claim:
      'SEGLONG-3 · §11.1\'s modified block is sized off §11.1, and the two numbers that size it ' +
      'are both read rather than written. Its at-pace total is the catalogue entry\'s own ' +
      '`atPace` band, which carries the doc\'s Structure row in the doc\'s own unit; its ' +
      'ceiling is Research/01\'s "the lesser of 18 mi or 20% of weekly mi", the cap on ONE ' +
      'session\'s marathon-pace work. The composer used to bound it by `finishMi` instead — ' +
      '§4.5\'s "final 2-6 mi at MP", a different session\'s number — and since doctrine writes ' +
      '"n/a" in M\'s WEEKLY column there was no other bound at all, so the block came out ' +
      'smaller than the same block\'s §4.4 weeks and split in two: strictly worse than the ' +
      'fast finish it displaced. The claim is that the entry still carries an at-pace band and ' +
      'that the band the composer reads is the doc\'s, not a number typed into the engine.',
    check({ cite }) {
      const text = cite.text();
      if (!/sub-elite runners scale to ~30[–—-]40 km total/i.test(text)) {
        throw new Error('§11.1 no longer states the sub-elite total — the block loses the row it scales against');
      }
      const entry = WORKOUT_CATALOGUE.find((e) => e.slug === 'canova-modified-block');
      if (!entry) throw new Error('canova-modified-block is gone from the catalogue');
      if (!entry.atPace) {
        throw new Error('canova-modified-block carries no atPace band — modifiedBlockSegFor would fall back to Infinity and be bounded only by Daniels');
      }
      // The composer converts through MI_PER_KM, so the unit has to stay one
      // it knows. A band that quietly became 'min' would size the session in
      // minutes-as-miles without failing anywhere else.
      if (!['km', 'm', 'mi'].includes(entry.atPace.unit)) {
        throw new Error(`canova-modified-block atPace is stated in ${entry.atPace.unit}; modifiedBlockSegFor converts only km/m/mi`);
      }
      // The doc's PM example is the source of the at-pace figure; if that row
      // stops naming kilometres at MP the band has nothing behind it.
      if (!/10[–—-]12 km at MP/i.test(text)) {
        throw new Error('§11.1 PM example no longer states its at-pace kilometres — entry.atPace loses its citation');
      }
    },
  },

  {
    id: 'LONGRUN.variant-rotation',
    binds: [
      'lib/plan/generate.ts#PROGRESSION_TAIL_SHARE',
      'lib/plan/catalogue-rx.ts#selectLongRunVariant',
      'lib/plan/catalogue-rx.ts#LONG_ROTATION_EXCLUDED',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '## Long-Run Variations',
    claim:
      'Long runs are not monolithic and no variant runs every time: the progression row\'s own ' +
      'Caution column reads "Don\'t make every long run a progression — rotate." The engine\'s ' +
      'cadence weeks therefore consult the catalogue\'s long family for WHICH §4 row the ' +
      'intensity long is, least-recently-used, with §4.6\'s dress rehearsal excluded (it is ' +
      'placed by days-before-race and authored by its own pass — offering it to the rotation ' +
      'is how it double-fires) and §4.2\'s base long excluded (it is what every off-cadence ' +
      'week already runs). The progression shape itself is §4.3\'s: an M middle and a T tail, ' +
      'the tail PROGRESSION_TAIL_SHARE of the intensity block, which must keep the tail under ' +
      'the doc\'s own "final 1/4 to 1/3" ceiling when read against the whole run.',
    check({ cite }) {
      const text = cite.text();
      if (!/Don't make every long run a progression\s*[–—-]\s*rotate/i.test(text)) {
        throw new Error('§"Long-Run Variations" no longer carries the rotate caution — the rotation loses its citation');
      }
      if (!/Long runs are not monolithic/i.test(text)) {
        throw new Error('§"Long-Run Variations" no longer opens with the variants ruling — re-read the section');
      }
      // §4.3's final-segment ceiling, read from its own Structure row. The
      // engine's tail is a share of the INTENSITY block, and the block is at
      // most half the run (hasFinish requires finishMi < longMi, and every
      // authored fraction is ≤ 0.5), so tail-of-run ≤ share × 0.5.
      const p43 = resolveCitation('Research/04-workout-vocabulary.md', '### 4.3 Progression long run');
      const finalSeg = p43.table().cell('Structure', 'Prescription')
        .match(/final\s+1\/(\d+)\s+to\s+1\/(\d+)\s+at\s+M\s+to\s+T/i);
      if (!finalSeg) {
        throw new Error('§4.3\'s Structure row no longer states a "final 1/4 to 1/3 at M to T" segment — re-derive the tail');
      }
      const ceiling = 1 / Math.min(Number(finalSeg[1]), Number(finalSeg[2]));
      if (PROGRESSION_TAIL_SHARE * 0.5 > ceiling + 1e-9) {
        throw new Error(
          `PROGRESSION_TAIL_SHARE (${PROGRESSION_TAIL_SHARE.toFixed(3)} of the intensity block, ≤ ` +
            `${(PROGRESSION_TAIL_SHARE * 0.5).toFixed(3)} of the run) exceeds §4.3's final-segment ceiling of 1/${Math.min(Number(finalSeg[1]), Number(finalSeg[2]))}`,
        );
      }
      // The exclusions are structural, not remembered: the wrapper must keep
      // both slugs out of the rotation.
      const rx = sourceOf('web-v2/lib/plan/catalogue-rx.ts');
      matchLiteral(
        rx,
        /LONG_ROTATION_EXCLUDED[\s\S]{0,400}?'dress-rehearsal-long-run',\s*\n\s*'base-long-run',/,
        'the long rotation excludes the dress rehearsal and the base long',
      );
      // And the composer actually consults it — a declared-but-unreachable
      // slot is the defect this whole workstream closes.
      matchLiteral(
        sourceOf('web-v2/lib/plan/generate.ts'),
        /selectLongRunVariant\(\{/,
        'layoutWeek consults the long-run rotation',
      );
    },
  },

  // == COURSE · Research/11, which lib/plan/ could not read until 2026-08-25 ==
  {
    id: 'COURSE.net-downhill-long-run-share',
    binds: [
      'lib/plan/generate.ts#NET_DOWNHILL_LONG_RUN_SHARE',
      'lib/plan/generate.ts#applyCourseGuidance',
    ],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Net-Downhill Training Adjustments',
    claim:
      'Preparing for a net-downhill race is a LONG-RUN instruction with a stated dose: most of ' +
      "the long run's mileage should be run on terrain matching the race's descent. The engine " +
      "surfaces the band's low edge, which is the instruction that holds for every runner.",
    check({ cite }) {
      const line = cite.text().split('\n').find((l) => /long-run mileage/i.test(l));
      if (!line) {
        throw new Error('COURSE.net-downhill-long-run-share: the long-run-mileage bullet is gone from this section');
      }
      const band = parsePctBand(line);
      within(NET_DOWNHILL_LONG_RUN_SHARE, band, 'NET_DOWNHILL_LONG_RUN_SHARE');
      if (NET_DOWNHILL_LONG_RUN_SHARE !== band[0]) {
        throw new Error(
          `NET_DOWNHILL_LONG_RUN_SHARE = ${NET_DOWNHILL_LONG_RUN_SHARE}; doctrine's band is ` +
          `${band[0]}-${band[1]} and the engine states its LOW edge (${band[0]})`,
        );
      }
    },
  },
  {
    id: 'COURSE.late-taper-downhill-window',
    binds: ['lib/plan/generate.ts#LATE_TAPER_DOWNHILL_DAYS'],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Avoid the Late-Taper Trap',
    claim:
      'Downhill running close to race day races the runner on damaged quads. Doctrine gives the ' +
      'window twice in one paragraph — a heavy session inside about ten days, and a last ' +
      'race-pace downhill two to three weeks out — so the engine stops prescribing downhill ' +
      'terrain somewhere between ten and twenty-one days, and takes the safe end of it.',
    check({ cite }) {
      const text = cite.text();
      const heavy = text.match(/inside\s*~?(\d+)\s*days/i);
      const last = text.match(/(\d+)\s*[-–]\s*(\d+)\s*weeks out/i);
      if (!heavy || !last) {
        throw new Error('COURSE.late-taper-downhill-window: this section no longer states both edges of the window');
      }
      const lo = Number(heavy[1]);
      const hi = Number(last[2]) * 7;
      within(LATE_TAPER_DOWNHILL_DAYS, [lo, hi], 'LATE_TAPER_DOWNHILL_DAYS');
      if (LATE_TAPER_DOWNHILL_DAYS < lo) {
        throw new Error(
          `LATE_TAPER_DOWNHILL_DAYS = ${LATE_TAPER_DOWNHILL_DAYS} is inside the ${lo}-day window ` +
          'doctrine says to stay out of',
        );
      }
    },
  },
  // ══ RECOVERY · the incident ═══════════════════════════════════════════════
  {
    id: 'RECOVERY.post-race-duration',
    binds: ['lib/plan/goal-tiers.ts#POST_RACE_RECOVERY_WEEKS'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'How long a runner stays off quality work after a race is set per distance by the ' +
      '"total recovery days (no quality)" column. The engine expresses it in whole weeks, ' +
      'so each value must land inside its distance band once converted to days. The single ' +
      'ultra bucket spans four doctrine rows (50K through 100-mile) and is checked against ' +
      'the widest of them.',
    check({ cite, exempt }) {
      const t = cite.table();
      const col = 'Total recovery days (no quality)';
      for (const cat of CATS) {
        const days = POST_RACE_RECOVERY_WEEKS[cat] * 7;
        const band =
          cat === 'ultra'
            ? ([parseBand(t.cell('50K', col))[0], parseBand(t.cell('100-mile', col))[1]] as [number, number])
            : parseBand(t.cell(DOC_ROW[cat], col));
        if (days < band[0] && exempt(`floor-${cat}`)) continue;
        within(days, band, `POST_RACE_RECOVERY_WEEKS.${cat} = ${days} days`);
      }
    },
    exempt: {
      'floor-5k':
        '5K doctrine is 3-5 days, which is not expressible in whole weeks: 0 undershoots by ' +
        '3 days, 1 overshoots the ceiling by 2. The engine takes 0 because over-resting a 5K ' +
        'runner costs a whole training week, and the sub-week protocol is carried by the ' +
        'day-level recovery composer rather than the plan-mode gate.',
    },
  },
  {
    id: 'RECOVERY.priority-scale',
    binds: [
      'lib/plan/generate.ts#POST_RACE_PRIORITY_SCALE',
      'lib/plan/generate.ts#postRaceNoQualityDays',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Race priority | Effort given | Taper before | Recovery scale |',
    claim:
      'How long a runner stays off quality after a race depends on what the race WAS, not ' +
      'only on how far it was. This table scales the by-distance window by priority: an A ' +
      'race takes the full window, a B race 60-70% of it, a C race 25-50%. The engine takes ' +
      "each band's slow edge, because a window read too short authors quality onto legs that " +
      'have not recovered while one read too long costs a single session. The doc states the ' +
      'B-race half case in days as well, and the engine must land inside that too.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Recovery scale';
      // A · the row states no percentage ("Full table above"), which is 100%.
      if (!/full table/i.test(t.cell('A race', col))) {
        throw new Error(`RECOVERY.priority-scale: the A row no longer says "Full table above": "${t.cell('A race', col)}"`);
      }
      if (POST_RACE_PRIORITY_SCALE.A !== 1) {
        throw new Error(`POST_RACE_PRIORITY_SCALE.A = ${POST_RACE_PRIORITY_SCALE.A}, doctrine gives an A race the full window`);
      }
      // B and C · the band is in the cell; the engine takes its slow edge.
      for (const [p, row] of [['B', 'B race'], ['C', 'C race / hard workout substitute']] as const) {
        const band = parsePctBand(t.cell(row, col));
        within(POST_RACE_PRIORITY_SCALE[p], band, `POST_RACE_PRIORITY_SCALE.${p}`);
        if (POST_RACE_PRIORITY_SCALE[p] !== band[1]) {
          throw new Error(
            `POST_RACE_PRIORITY_SCALE.${p} = ${POST_RACE_PRIORITY_SCALE[p]}, doctrine's band is ` +
            `${band[0]}-${band[1]} and the engine takes the SLOW edge (${band[1]})`,
          );
        }
      }
      // And the worked case the section states in prose, in days.
      const prose = cite.text().split('\n').find((l) => /B-race half marathon/i.test(l));
      if (!prose) {
        throw new Error('RECOVERY.priority-scale: the "B-race half marathon" sentence is gone from this section');
      }
      within(postRaceNoQualityDays(13.1, 'B'), parseBand(prose), `postRaceNoQualityDays(half, B)`);
    },
  },
  {
    id: 'RECOVERY.overshoot-race-recency-is-per-distance',
    binds: [
      'lib/plan/adapt.ts#OVERSHOOT_RACE_RECENCY_DAYS',
      'lib/plan/adapt.ts#overshootRaceRecencyDays',
      'lib/plan/adapt.ts#raceSuppressesOvershoot',
      'lib/plan/adapt.ts#detectVolumeOvershoot',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'A race legitimately inflates completed volume for as long as doctrine still calls the ' +
      'runner recovering, and the volume-overshoot finding stays quiet for that whole window. ' +
      'How long that is comes from this table\'s "total recovery days (no quality)" column and ' +
      'is different for every distance — 5K 3-5 days, 10K 5-7, half 10-14, marathon 21-28, the ' +
      'ultras 14-42. The engine\'s window must land inside its distance\'s band, must actually ' +
      'be spent (still suppressing on the last doctrine day, live the day after), and must ' +
      'agree with POST_RACE_RECOVERY_WEEKS, which is read off this same column.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Total recovery days (no quality)';
      const MI: Record<DistCategory, number> = { '5k': 3.1, '10k': 6.2, 'hm': 13.1, 'm': 26.2, 'ultra': 50 };
      const RACE = '2026-03-01';
      const dayAfter = (n: number) =>
        new Date(Date.parse(RACE + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

      for (const cat of CATS) {
        // The single 'ultra' bucket spans four doctrine rows; checked against
        // the widest of them, exactly as RECOVERY.post-race-duration does.
        const band =
          cat === 'ultra'
            ? ([parseBand(t.cell('50K', col))[0], parseBand(t.cell('100-mile', col))[1]] as [number, number])
            : parseBand(t.cell(DOC_ROW[cat], col));
        const days = OVERSHOOT_RACE_RECENCY_DAYS[cat];

        // 1 · the constant sits inside the band the doc states for its row.
        within(days, band, `OVERSHOOT_RACE_RECENCY_DAYS.${cat} = ${days} days`);

        // 2 · the lookup reaches that row from a real race distance, rather
        //     than the table being right and nothing reading it.
        if (overshootRaceRecencyDays(MI[cat]) !== days) {
          throw new Error(
            `overshootRaceRecencyDays(${MI[cat]}mi) returned ` +
              `${overshootRaceRecencyDays(MI[cat])}, but the ${cat} row is ${days}`,
          );
        }

        // 3 · the window is SPENT — suppressing on its last day, live the day
        //     after. A constant nothing acts on is decoration.
        if (!raceSuppressesOvershoot(RACE, dayAfter(days), MI[cat])) {
          throw new Error(`a ${cat} race stops suppressing before its own day ${days}`);
        }
        if (raceSuppressesOvershoot(RACE, dayAfter(days + 1), MI[cat])) {
          throw new Error(`a ${cat} race still suppresses on day ${days + 1}, past its window`);
        }

        // 4 · THE DEFECT THIS CLAIM EXISTS TO STOP. The window must cover at
        //     least the FLOOR of the doc's band. The old flat 7 days failed
        //     this for the half (floor 10) and the marathon (floor 21).
        if (!raceSuppressesOvershoot(RACE, dayAfter(band[0]), MI[cat])) {
          throw new Error(
            `a ${cat} race is unprotected on day ${band[0]}, inside doctrine's own ` +
              `${band[0]}-${band[1]} day no-quality window`,
          );
        }

        // 5 · two constants read off ONE doctrine column may not disagree.
        //     POST_RACE_RECOVERY_WEEKS expresses the same band in whole weeks
        //     and takes 0 for the 5K, which is not expressible that way (see
        //     RECOVERY.post-race-duration · floor-5k); wherever it states a
        //     duration at all, the two must be the same number of days.
        const weeksAsDays = POST_RACE_RECOVERY_WEEKS[cat] * 7;
        if (weeksAsDays > 0 && weeksAsDays !== days) {
          throw new Error(
            `POST_RACE_RECOVERY_WEEKS.${cat} is ${weeksAsDays} days and ` +
              `OVERSHOOT_RACE_RECENCY_DAYS.${cat} is ${days} — same column, two answers`,
          );
        }
      }

      // 6 · an unresolvable race distance takes the widest window, never a
      //     substituted row. lib/race/distance.ts: callers must treat null as
      //     "unknown", and here the safe reading of unknown is the longest.
      const widest = Math.max(...CATS.map((c) => OVERSHOOT_RACE_RECENCY_DAYS[c]));
      if (OVERSHOOT_RACE_LOOKBACK_DAYS !== widest) {
        throw new Error(
          `OVERSHOOT_RACE_LOOKBACK_DAYS is ${OVERSHOOT_RACE_LOOKBACK_DAYS}, but the widest ` +
            `window in the table is ${widest} — the SQL would not see the race it must judge`,
        );
      }
      for (const unknown of [null, undefined, 0, NaN]) {
        if (overshootRaceRecencyDays(unknown) !== widest) {
          throw new Error(`an unresolvable race distance (${String(unknown)}) does not take the widest window`);
        }
      }

      // 7 · a race that has not happened yet suppresses nothing.
      if (raceSuppressesOvershoot('2026-04-01', RACE, 26.2)) {
        throw new Error('a FUTURE race silences a finding about training already completed');
      }
    },
  },
  {
    id: 'RECOVERY.zero-running-days',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_RUN_DAYS'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'The second column is a SEPARATE, much shorter quantity: days of zero or very-light ' +
      'running. Reading the first column as if it were this one is the exact defect that ' +
      'shipped. Rest days in the first recovery week must fall inside this band — neither ' +
      'fewer (under-recovered) nor more (the shipped bug).',
    check({ cite, exempt }) {
      const t = cite.table();
      const col = 'Days of zero/very-light running';
      for (const cat of CATS) {
        if (POST_RACE_RECOVERY_WEEKS[cat] === 0 && exempt(`unreachable-${cat}`)) continue;
        const restDays = 7 - RECOVERY_RUN_DAYS[cat][0];
        within(restDays, parseBand(t.cell(DOC_ROW[cat], col)), `${cat} recovery week 1 rest days`);
      }
    },
    exempt: {
      'unreachable-5k':
        'POST_RACE_RECOVERY_WEEKS["5k"] is 0, so no 5K recovery week is ever composed and ' +
        'RECOVERY_RUN_DAYS["5k"] is unreachable. It is kept for shape symmetry. If a 5K ' +
        'recovery week is ever enabled, delete this exemption first — the profile currently ' +
        'gives 3 rest days against a doctrine band of 1-2.',
    },
  },
  {
    id: 'RECOVERY.half-protocol-run-days',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_RUN_DAYS'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Half Marathon Recovery (14-day)',
    claim:
      'The half has its own day-by-day protocol, and it is not a shutdown: day 3 a jog, day ' +
      '4 easy, day 6 easy plus strides, day 7 a medium-long, then most of the second week. ' +
      "The engine's running-day counts are read straight off that table — a doc edit that " +
      'adds or removes a running day must move the constant with it.',
    check({ cite }) {
      const t = cite.table();
      const runs = (from: number, to: number) =>
        t.rows.filter((r) => {
          const day = Number(r.Day);
          if (!Number.isFinite(day) || day < from || day > to) return false;
          const s = r.Session ?? '';
          return !/^rest/i.test(s) && !/^resume/i.test(s);
        }).length;
      const [wk1, wk2] = [runs(1, 7), runs(8, 13)];
      if (RECOVERY_RUN_DAYS.hm[0] !== wk1 || RECOVERY_RUN_DAYS.hm[1] !== wk2) {
        throw new Error(
          `RECOVERY_RUN_DAYS.hm is [${RECOVERY_RUN_DAYS.hm}], but the 14-day protocol in ` +
            `${cite.doc} prescribes running on ${wk1} days in week 1 and ${wk2} in week 2`,
        );
      }
      if (RECOVERY_WEEKLY_PCT_OF_BASE.hm.length !== 2) {
        throw new Error('the half protocol is a 14-day table · RECOVERY_WEEKLY_PCT_OF_BASE.hm must cover 2 weeks');
      }
    },
  },
  {
    id: 'RECOVERY.half-duration-not-peak',
    binds: [
      'lib/plan/goal-tiers.ts#RECOVERY_HALF_WEEKLY_MINUTES',
      'lib/plan/generate.ts#composeRecoveryPlan.wkWeekly',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Half Marathon Recovery (14-day)',
    claim:
      'Unlike the marathon table, the half\'s 14-day protocol has no "volume vs. peak" column ' +
      '— it prescribes MINUTES per day. The engine\'s week-1 and week-2 minute bands are the sum ' +
      'of that table\'s own running-day minutes (the same days RECOVERY.half-protocol-run-days ' +
      'already counts) — a doc edit to any running day\'s duration must move this sum with it, ' +
      'the same way a doc edit to a running day\'s presence moves the run-day count.',
    check({ cite }) {
      const t = cite.table();
      const sumMinutes = (from: number, to: number): [number, number] => {
        let lo = 0, hi = 0;
        for (const r of t.rows) {
          const day = Number(r.Day);
          if (!Number.isFinite(day) || day < from || day > to) continue;
          const s = r.Session ?? '';
          if (/^rest/i.test(s) || /^resume/i.test(s)) continue;
          const [dLo, dHi] = parseBand(s);
          lo += dLo; hi += dHi;
        }
        return [lo, hi];
      };
      const wk1 = sumMinutes(1, 7);
      const wk2 = sumMinutes(8, 13);
      const bands: [number, number][] = [wk1, wk2];
      bands.forEach(([lo, hi], i) => {
        const [cLo, cHi] = RECOVERY_HALF_WEEKLY_MINUTES[i] ?? [NaN, NaN];
        if (cLo !== lo || cHi !== hi) {
          throw new Error(
            `RECOVERY_HALF_WEEKLY_MINUTES[${i}] is [${cLo},${cHi}], but the 14-day protocol's ` +
              `week ${i + 1} running days sum to [${lo},${hi}] minutes in ${cite.doc}`,
          );
        }
      });
      // And the engine must actually be spending it — a constant nobody reads
      // is the failure mode this whole gate exists for.
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/RECOVERY_HALF_WEEKLY_MINUTES\[blockWeekIdx\]/.test(src)) {
        throw new Error(
          'composeRecoveryPlan no longer reads RECOVERY_HALF_WEEKLY_MINUTES · the half may have ' +
            'reverted to peakAnchor * pct, which is what shipped the 45mi/week defect',
        );
      }
    },
  },
  {
    id: 'RECOVERY.marathon-reverse-taper',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_WEEKLY_PCT_OF_BASE'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Marathon Recovery (4-week reverse taper)',
    claim:
      'The marathon (and, by the engine bucketing, the ultra) rebuilds through a four-week ' +
      'reverse taper whose weekly volumes are stated as percentages of peak. Each engine ' +
      'percentage must sit inside its own week band.',
    check({ cite }) {
      const t = cite.table();
      const bands = t.rows.map((r) => parsePctBand(r['Volume vs. peak']));
      for (const cat of ['m', 'ultra'] as const) {
        const seq = RECOVERY_WEEKLY_PCT_OF_BASE[cat];
        if (seq.length !== bands.length) {
          throw new Error(
            `RECOVERY_WEEKLY_PCT_OF_BASE.${cat} has ${seq.length} weeks · the reverse taper in ` +
              `${cite.doc} has ${bands.length}`,
          );
        }
        seq.forEach((pct, i) => within(pct, bands[i], `RECOVERY_WEEKLY_PCT_OF_BASE.${cat} week ${i + 1}`));
      }
    },
  },
  {
    id: 'RECOVERY.reverse-taper-ceiling-is-the-pre-race-peak',
    binds: [
      'lib/plan/goal-tiers.ts#recoveryBlockCeilingPct',
      'lib/plan/generate.ts#enforceWeeklyRampCeiling',
      'lib/plan/generate.ts#reverseTaperCeilingMi',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Marathon Recovery (4-week reverse taper)',
    claim:
      'A reverse taper is bounded by the PRE-RACE PEAK it is unwinding, never by its own weeks. ' +
      'Every week in the block is a deload, so a week-over-week ramp rule measured against the ' +
      'block\'s own prior peak compounds the first deload and the block can never reach its last ' +
      'row. The ceiling is the deepest fraction of peak doctrine publishes for the distance ' +
      'raced, and it is below 1: doctrine puts the full return to peak AFTER the block.',
    check({ cite }) {
      // ── the ceiling is doctrine's own deepest row, read out of the doc ──
      const bands = cite.table().rows.map((r) => parsePctBand(r['Volume vs. peak']));
      if (bands.length === 0) throw new Error('the reverse-taper table has no rows · re-read the claim');
      const deepest = bands[bands.length - 1];
      for (const cat of ['m', 'ultra'] as const) {
        within(recoveryBlockCeilingPct(cat), deepest, `recoveryBlockCeilingPct("${cat}")`);
        // and it is DERIVED from the sequence the weeks are sized off, not a
        // second table beside it that could drift from the first.
        const seq = RECOVERY_WEEKLY_PCT_OF_BASE[cat];
        if (recoveryBlockCeilingPct(cat) !== Math.max(...seq)) {
          throw new Error(
            `recoveryBlockCeilingPct("${cat}") is ${recoveryBlockCeilingPct(cat)} but the deepest ` +
              `week in RECOVERY_WEEKLY_PCT_OF_BASE.${cat} is ${Math.max(...seq)} · the ceiling ` +
              'must be the block\'s own deepest row, or the two can disagree',
          );
        }
      }
      // ── below 100%, because doctrine says full return is AFTER the block ──
      // Read the week the doc names rather than asserting "< 1" on faith.
      const note = /full return to peak training load typically week\s*(\d+)\s*[–—-]\s*(\d+)/i.exec(cite.text());
      if (!note) {
        throw new Error(
          'the reverse-taper section no longer states when full return to peak happens · that ' +
            'sentence is what puts the ceiling below 100% of peak, so re-read the claim',
        );
      }
      const returnsAtWeek = Number(note[1]);
      if (!(returnsAtWeek > POST_RACE_RECOVERY_WEEKS.m)) {
        throw new Error(
          `doctrine now returns to peak in week ${returnsAtWeek}, inside the ` +
            `${POST_RACE_RECOVERY_WEEKS.m}-week recovery block · the ceiling can no longer be ` +
            'below peak by construction',
        );
      }
      for (const cat of ['5k', '10k', 'hm', 'm', 'ultra'] as const) {
        if (recoveryBlockCeilingPct(cat) >= 1) {
          throw new Error(
            `recoveryBlockCeilingPct("${cat}") is ${recoveryBlockCeilingPct(cat)} · a recovery ` +
              `block that reaches the pre-race peak has stopped being recovery, and doctrine ` +
              `puts the full return at week ${returnsAtWeek}`,
          );
        }
      }
      // ── and the ceiling actually REACHES the pass that enforces it ────────
      // A constant nothing spends is the DOCTRINE-5 defect: RECOVERY_EFFORT_SCALE
      // was added and imported nowhere for four hours. Trace the whole wire.
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/export function enforceWeeklyRampCeiling\([\s\S]{0,400}?blockCeilingMi\?/.test(gen)) {
        throw new Error('enforceWeeklyRampCeiling no longer accepts a whole-block ceiling · a reverse taper is being graded against its own deload weeks again');
      }
      // WKRESUME-1 (2026-08-25) · the trailing `\)` is gone from this pattern.
      // It used to pin the call to a single line with the ceiling as the LAST
      // argument, which made the tripwire fire the moment the pass gained a
      // fifth parameter — a signature change, not a doctrine one. What the
      // claim asserts is that the computed ceiling REACHES the pass; the
      // pattern now says exactly that and nothing about argument count.
      if (!/enforceWeeklyRampCeiling\(\s*composed\.weeks,\s*composed\.vols,\s*level,\s*reverseTaperCeilingMi\(composed\)/.test(gen)) {
        throw new Error('finalizeComposedPlan no longer passes the reverse-taper ceiling · the ceiling is computed and then discarded');
      }
      if (!/block_ceiling_mi: recoveryCeilingMi/.test(gen) || !/recoveryBlockCeilingPct\(lastCat\)/.test(gen)) {
        throw new Error('composeRecoveryPlan no longer publishes block_ceiling_mi off recoveryBlockCeilingPct · nothing downstream can read the block\'s bound');
      }
    },
  },
  {
    id: 'RECOVERY.sub-marathon-is-a-cutback',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_WEEKLY_PCT_OF_BASE'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'Below the marathon, post-race recovery is a cutback and never a shutdown. A distance ' +
      'whose zero-running band tops out under a week cannot be given marathon-depth volume ' +
      'percentages: the engine must keep every sub-marathon recovery week at or above half ' +
      'of base. This is the invariant the shipped defect broke.',
    check({ cite }) {
      const t = cite.table();
      for (const cat of ['5k', '10k', 'hm'] as const) {
        const zeroDays = parseBand(t.cell(DOC_ROW[cat], 'Days of zero/very-light running'));
        if (zeroDays[1] >= 7) continue; // doctrine really does want a week off · not our case
        for (const [i, pct] of RECOVERY_WEEKLY_PCT_OF_BASE[cat].entries()) {
          if (pct < 0.5) {
            throw new Error(
              `RECOVERY_WEEKLY_PCT_OF_BASE.${cat} week ${i + 1} is ${pct} of base · doctrine ` +
                `allows only ${zeroDays[0]}-${zeroDays[1]} very-light days for this distance, ` +
                'so a week at marathon depth would mean near-total rest',
            );
          }
        }
      }
    },
  },
  {
    id: 'RECOVERY.effort-scale',
    binds: [
      'lib/plan/goal-tiers.ts#RECOVERY_EFFORT_SCALE',
      'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
      'lib/plan/goal-tiers.ts#pickPlanMode',
      'lib/plan/generate.ts#composeRecoveryPlan',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Recovery by Effort (A vs. B vs. C Race)',
    claim:
      'Not every race earns the full recovery table. A B race takes 60-70% of A-race recovery ' +
      'duration and a C race 25-50%. The engine scales DURATION, so an A race is exactly 1.0 ' +
      'and the other two sit inside their stated bands — AND the constant is actually SPENT. A ' +
      'scale that is declared and imported nowhere means every tune-up triggers full A-race ' +
      'recovery, which is what shipped when this constant was first added.',
    check({ cite }) {
      const t = cite.table();
      const scale = (row: string) => parsePctBand(t.cell(row, 'Recovery scale'));
      if (RECOVERY_EFFORT_SCALE.A !== 1.0) throw new Error('an A race earns the full table · scale must be 1.0');
      within(RECOVERY_EFFORT_SCALE.B, scale('B race'), 'RECOVERY_EFFORT_SCALE.B');
      within(RECOVERY_EFFORT_SCALE.C, scale('C race / hard workout substitute'), 'RECOVERY_EFFORT_SCALE.C');
      // WIRED: a B race must actually get a shorter hole than an A race.
      for (const cat of CATS) {
        const a = postRaceRecoveryWeeks(cat, 'A');
        const b = postRaceRecoveryWeeks(cat, 'B');
        const c = postRaceRecoveryWeeks(cat, 'C');
        if (a !== POST_RACE_RECOVERY_WEEKS[cat]) {
          throw new Error(`postRaceRecoveryWeeks(${cat}, 'A') is ${a} · an A race earns the full table (${POST_RACE_RECOVERY_WEEKS[cat]})`);
        }
        if (b > a || c > b) {
          throw new Error(`postRaceRecoveryWeeks(${cat}) does not shorten with priority: A=${a} B=${b} C=${c}`);
        }
        if (a >= 2 && b >= a) {
          throw new Error(`postRaceRecoveryWeeks(${cat}, 'B') is ${b} · a B race must be a SHORTER hole than ${a}`);
        }
      }
      // And the two places a recovery window is decided both consult it.
      for (const [file, needle] of [
        ['web-v2/lib/plan/goal-tiers.ts', 'postRaceRecoveryWeeks(lastCat, lastRacePriority)'],
        ['web-v2/lib/plan/generate.ts', 'postRaceRecoveryWeeks(lastCat,'],
        // 2026-08-19 · the THIRD place a recovery window is now decided: the
        // open block a runner gets when they finish a race with nothing
        // booked. It must consult the same scaled reader or a C-race parkrun
        // would park them in a maintenance-suppressing recovery block.
        ['web-v2/lib/plan/race-lifecycle.ts', 'postRaceRecoveryWeeks(cat,'],
      ] as const) {
        if (!sourceOf(file).includes(needle)) {
          throw new Error(`${file} decides a recovery window without the effort scale · it will give a tune-up the full A-race hole`);
        }
      }
    },
  },
  {
    id: 'LIFECYCLE.open-block-recovery-window',
    binds: [
      'lib/plan/race-lifecycle.ts#openBlockMode',
      'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
      'lib/plan/goal-tiers.ts#pickPlanMode',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'A runner who finishes a race with nothing booked is still recovering. The block they ' +
      'are given must be recovery for the whole doctrine window and only then maintenance, ' +
      'and that window must be the SAME one pickPlanMode uses for a runner who does have a ' +
      'race booked. One runner, two entry points, one answer — the failure this guards is ' +
      'the RECOVERY.quality-ready-day shape, where two surfaces read the same table and gave ' +
      'opposite advice. The window is also checked against the doc: it must cover at least ' +
      'the floor of the "total recovery days (no quality)" band for every distance the ' +
      'engine recognises a recovery window for.',
    check({ cite, exempt }) {
      const t = cite.table();
      const col = 'Total recovery days (no quality)';
      const RACE_DATE = '2026-03-01';
      const dayAfter = (n: number) =>
        new Date(Date.parse(RACE_DATE + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
      const MI: Record<DistCategory, number> = { '5k': 3.1, '10k': 6.2, 'hm': 13.1, 'm': 26.2, 'ultra': 50 };

      for (const cat of CATS) {
        for (const priority of ['A', 'B', 'C'] as const) {
          const weeks = postRaceRecoveryWeeks(cat, priority);
          const engineDays = weeks * 7;
          // 1 · openBlockMode and pickPlanMode must flip on the same day.
          for (const day of [0, Math.max(0, engineDays - 1), engineDays, engineDays + 1]) {
            const todayISO = dayAfter(day);
            const open = openBlockMode({
              lastRaceDateISO: RACE_DATE,
              lastRaceDistanceMi: MI[cat],
              lastRacePriority: priority,
              todayISO,
            });
            const picked = pickPlanMode(todayISO, null, null, RACE_DATE, MI[cat], priority);
            const pickedOpen = picked === 'recovery' ? 'recovery' : 'maintenance';
            if (open !== pickedOpen) {
              throw new Error(
                `open block and pickPlanMode disagree for ${cat}/${priority} on day ${day}: ` +
                  `openBlockMode=${open}, pickPlanMode=${picked}`,
              );
            }
          }
        }
        // 2 · and the A-race window covers the doc's floor.
        const aDays = postRaceRecoveryWeeks(cat, 'A') * 7;
        const band =
          cat === 'ultra'
            ? ([parseBand(t.cell('50K', col))[0], parseBand(t.cell('100-mile', col))[1]] as [number, number])
            : parseBand(t.cell(DOC_ROW[cat], col));
        if (aDays < band[0] && exempt(`floor-${cat}`)) continue;
        if (aDays < band[0]) {
          throw new Error(
            `open block leaves recovery after ${aDays} days for ${cat} · doctrine floor is ${band[0]}`,
          );
        }
      }
    },
    exempt: {
      'floor-5k':
        'Inherited from RECOVERY.post-race-duration: POST_RACE_RECOVERY_WEEKS["5k"] is 0 ' +
        'because 3-5 days is not expressible in whole weeks. The open block therefore hands ' +
        'a 5K runner maintenance immediately, which matches pickPlanMode exactly — the ' +
        'consistency half of this claim still holds. Fix the constant and this entry must go.',
    },
  },
  {
    id: 'DOCTRINE.midblock-window-skips-mandated-no-quality',
    binds: [
      'lib/plan/generate.ts#QUALITY_LOOKBACK_DAYS',
      'lib/plan/generate.ts#qualityLookbackDays',
      'lib/plan/generate.ts#detectMidBlock',
      'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'The mid-block detector asks whether the runner has been doing quality, and after a race ' +
      'doctrine has already answered for them: this table\'s "total recovery days (no quality)" ' +
      'column mandates 10-14 days without quality after a half and 21-28 after a marathon, and ' +
      'the engine spends exactly that window authoring a phase whose own rationale reads "Easy ' +
      'running only · no quality". A flat 28-day count therefore reads the engine\'s own ' +
      'prescription as an absence of fitness, and cannot tell "has not been doing quality" from ' +
      '"was told not to do quality". The window skips the days doctrine blanked, so the detector ' +
      'always sees training from BEFORE the race rather than a window doctrine guaranteed empty. ' +
      'A taper is deliberately NOT allowed for: Research/08 §9.1 keeps intensity through it.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Total recovery days (no quality)';
      const MI: Record<DistCategory, number> = { '5k': 3.1, '10k': 6.2, 'hm': 13.1, 'm': 26.2, 'ultra': 50 };
      const RACE = '2026-03-01';
      const dayAfter = (n: number) =>
        new Date(Date.parse(RACE + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

      // 1 · The engine's no-quality window is the doc's, for the two distances
      //     whose bands this claim leans on. Read out of the table, not copied.
      for (const cat of ['hm', 'm'] as const) {
        const band = parseBand(t.cell(DOC_ROW[cat], col));
        const engineDays = postRaceRecoveryWeeks(cat, 'A') * 7;
        if (engineDays < band[0] || engineDays > band[1]) {
          throw new Error(
            `POST_RACE_RECOVERY_WEEKS.${cat} spends ${engineDays} no-quality days · ` +
              `doctrine's band for ${DOC_ROW[cat]} is ${band[0]}-${band[1]}`,
          );
        }
      }

      // 2 · THE PROPERTY THE FIX EXISTS FOR. While the runner is inside the
      //     mandated no-quality window, the detector must be looking back past
      //     the race — otherwise every signal reads a window doctrine emptied.
      //     A flat 28-day window fails this for any race ≥28 days back, which
      //     is precisely the marathon case (21-28 mandated days).
      for (const cat of CATS) {
        for (const priority of ['A', 'B', 'C'] as const) {
          const engineDays = postRaceRecoveryWeeks(cat, priority) * 7;
          if (engineDays <= 0) continue;   // 5K · no whole-week window to skip
          for (let d = 1; d <= engineDays; d++) {
            const look = qualityLookbackDays(dayAfter(d), {
              date: RACE, distanceMi: MI[cat], priority,
            });
            if (look <= d) {
              throw new Error(
                `${cat}/${priority}: ${d} days after the race the detector looks back ${look} ` +
                  'days · it sees only the window doctrine mandated be empty, so a runner who ' +
                  'obeyed their recovery block reads as a runner who stopped training',
              );
            }
          }
        }
      }

      // 3 · Self-limiting. Once the mandated window has fallen out of the base
      //     window entirely, the lookback is flat again — this buys an
      //     allowance, not a permanently longer memory.
      const far = qualityLookbackDays(dayAfter(28 + QUALITY_LOOKBACK_DAYS + 1), {
        date: RACE, distanceMi: MI.m, priority: 'A',
      });
      if (far !== QUALITY_LOOKBACK_DAYS) {
        throw new Error(`the allowance outlives the window it explains · lookback is ${far}`);
      }

      // 4 · No finished race, or one whose distance resolves to nothing, buys
      //     nothing. Every runner without a race is byte-identical to before.
      if (qualityLookbackDays(dayAfter(10), null) !== QUALITY_LOOKBACK_DAYS) {
        throw new Error('a runner with no finished race no longer gets the flat window');
      }
      if (qualityLookbackDays(dayAfter(10), { date: RACE, distanceMi: 0, priority: 'A' })
          !== QUALITY_LOOKBACK_DAYS) {
        throw new Error('an unresolvable race distance extends the window · it explains nothing');
      }

      // 5 · A taper must NOT extend it. Research/08 §9.1: "intensity is
      //     preserved through the taper", so a tapering runner is doing
      //     quality and the detector can see it unaided. The only allowance
      //     this function grants is keyed on a FINISHED race.
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      if (/function qualityLookbackDays[\s\S]{0,1400}TAPER/.test(src)) {
        throw new Error(
          'qualityLookbackDays reasons about TAPER · doctrine keeps intensity through a taper, ' +
          'so a taper is not a blanked window and must buy no allowance',
        );
      }

      // 6 · And the detector actually spends it. A pure function nobody calls
      //     is the failure mode this gate was built for.
      if (!/const lookback = qualityLookbackDays\(today, lastRaceFinished\)/.test(src)) {
        throw new Error('detectMidBlock no longer resolves its window through qualityLookbackDays');
      }
      if (/date_iso::date BETWEEN \(\$2::date - 28\)/.test(src)) {
        throw new Error('detectMidBlock still carries a hard-coded 28-day quality window');
      }
    },
  },
  {
    id: 'RECOVERY.denominator-is-peak',
    binds: [
      'lib/plan/goal-tiers.ts#RECOVERY_WEEKLY_PCT_OF_BASE',
      'lib/plan/generate.ts#recentPeakWeeklyMileage',
      'lib/plan/generate.ts#composeRecoveryPlan.peakAnchor',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Marathon Recovery (4-week reverse taper)',
    claim:
      'The reverse taper\'s weekly volumes are stated as a percentage of PEAK — the column ' +
      'header says so in as many words. Multiplying them by a trailing AVERAGE instead lands ' +
      'the whole recovery block roughly a third low, because the four weeks before a marathon ' +
      'are peak-taper-taper-race and their mean is nothing the runner ever trained at. The ' +
      'engine must therefore read a real peak week, and the reader must exist.',
    check({ cite }) {
      if (!/vs\.\s*peak/i.test(cite.table().headers.join(' '))) {
        throw new Error('the reverse-taper column is no longer stated "vs. peak" · re-read the claim');
      }
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/async function recentPeakWeeklyMileage\(/.test(src)) {
        throw new Error('no peak-week reader in generate.ts · the reverse taper is being multiplied by an average');
      }
      if (/recentPeakWeeklyMi: inputs\.compose\.recentWeeklyMi\b/.test(src)) {
        throw new Error(
          'recentPeakWeeklyMi is wired to the 28-day mean again ("proxy when peak unknown") · ' +
            'a percentage of peak multiplied by an average is not a percentage of peak',
        );
      }
      if (!/recentPeakWeeklyMi: Math\.max\(recentPeakWeeklyMi,/.test(src)) {
        throw new Error('composeRecoveryPlan is no longer fed the real peak week');
      }
    },
  },
  {
    id: 'RECOVERY.quality-ready-day',
    binds: ['lib/coach/recovery-phase.ts#expectedDays'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Distance | Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'The day a runner may next do quality work after a race is a column in the distance ' +
      'table — "Return to quality workouts" — and the coach surface must read it. It used to ' +
      'answer day 5 for a half while the plan engine, reading the SAME document one column ' +
      'over, held quality for 14 days. One runner, two surfaces, opposite advice. The surface ' +
      'may take the earliest day its band allows, never earlier, and never later than the ' +
      'band ends.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Return to quality workouts';
      const probe: [DistCategory, number][] = [['5k', 3.1], ['10k', 6.2], ['hm', 13.1], ['m', 26.2]];
      for (const [cat, mi] of probe) {
        const cell = t.cell(DOC_ROW[cat], col);
        // Marathon is stated in WEEKS ("Week 3-4"); the rest in days.
        const mult = /week/i.test(cell) ? 7 : 1;
        const [lo, hi] = parseBand(cell).map((n) => n * mult) as [number, number];
        within(expectedDaysForAnchor('race', mi), [lo, hi], `recovery-phase quality-ready day after a ${cat}`);
      }
      // And it must not contradict the plan engine, which holds quality for the
      // whole of POST_RACE_RECOVERY_WEEKS.
      for (const [cat, mi] of probe) {
        const engineDays = POST_RACE_RECOVERY_WEEKS[cat] * 7;
        if (engineDays > 0 && expectedDaysForAnchor('race', mi) * 2 < engineDays) {
          throw new Error(
            `recovery-phase says quality-ready on day ${expectedDaysForAnchor('race', mi)} after a ${cat} ` +
              `while the plan engine holds quality for ${engineDays} days · the two surfaces disagree`,
          );
        }
      }
    },
  },

  // ══ TAPER ═════════════════════════════════════════════════════════════════
  {
    id: 'TAPER.duration-by-distance',
    binds: ['lib/plan/generate.ts#BLOCK_SHAPE.taperWeeks'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | Taper length | Volume reduction (peak week) |',
    claim:
      'Taper length rises with race distance: days for a 5K, three weeks for a marathon. ' +
      'The engine plans in whole weeks, so each value must be a whole-week rounding of the ' +
      'doctrine band for that distance.',
    check({ cite }) {
      const t = cite.table();
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const docRow: Record<DistCategory, string> = { ...DOC_ROW, ultra: 'Ultra (50K-100M)' };
      for (const cat of CATS) {
        const m = matchLiteral(
          src,
          new RegExp(`'${cat}':\\s*\\{\\s*taperWeeks:\\s*(\\d+)`),
          `BLOCK_SHAPE['${cat}'].taperWeeks`,
        );
        const weeks = Number(m[1]);
        const [lo, hi] = parseBand(t.cell(docRow[cat], 'Taper length'));
        within(weeks, [Math.ceil(lo / 7), Math.ceil(hi / 7)], `BLOCK_SHAPE['${cat}'].taperWeeks`);
      }
    },
  },
  {
    id: 'TAPER.depth-per-week',
    binds: [
      'lib/plan/goal-tiers.ts#TAPER_RACE_WEEK_PCT_OF_PEAK',
      'lib/plan/goal-tiers.ts#taperFactor',
      'lib/plan/generate.ts#volumeCurve',
      'lib/plan/generate.ts#finalizeComposedPlan',
    ],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | Taper length | Volume reduction (peak week) |',
    claim:
      'How deep the taper cuts is set PER DISTANCE: a 5K sheds a quarter to a third of peak ' +
      'volume, a marathon nearly half, an ultra more. The race-week factor for every distance ' +
      'must land inside its own row of the reduction table — and there must be exactly ONE ' +
      'model, called from both places the engine writes a taper, because the defect this ' +
      'replaces was the marathon row hardcoded at two sites and applied to all five distances.',
    check({ cite }) {
      const t = cite.table();
      const docRow: Record<DistCategory, string> = { ...DOC_ROW, ultra: 'Ultra (50K-100M)' };
      for (const cat of CATS) {
        // §9.1 states the REDUCTION; the engine stores what REMAINS.
        const [cutLo, cutHi] = parsePctBand(t.cell(docRow[cat], 'Volume reduction (peak week)'));
        const remains: [number, number] = [1 - cutHi, 1 - cutLo];
        within(TAPER_RACE_WEEK_PCT_OF_PEAK[cat], remains, `TAPER_RACE_WEEK_PCT_OF_PEAK.${cat}`);
        // taperFactor must agree with the table at the race week, and must
        // DESCEND monotonically toward it from further out. A taper that goes
        // back up is not a taper.
        if (taperFactor(cat, 1) !== TAPER_RACE_WEEK_PCT_OF_PEAK[cat]) {
          throw new Error(`taperFactor(${cat}, 1) does not equal the race-week depth for that distance`);
        }
        for (const w of [2, 3]) {
          if (taperFactor(cat, w) <= taperFactor(cat, w - 1)) {
            throw new Error(`taperFactor(${cat}) does not descend between ${w} and ${w - 1} weeks out`);
          }
          if (taperFactor(cat, w) > 1) throw new Error(`taperFactor(${cat}, ${w}) exceeds peak volume`);
        }
      }
      // ONE model, both sites. The two hardcoded ternaries are gone; both
      // callers now go through goal-tiers' taperFactor.
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const calls = [...src.matchAll(/taperFactor\(taperCat, wksLeft\)/g)].length;
      if (calls < 2) {
        throw new Error(
          `expected both the volumeCurve and finalizeComposedPlan sites to call the shared ` +
            `taperFactor model · found ${calls}`,
        );
      }
      if (/wksLeft === 1 \? [\d.]+ : wksLeft === 2 \?/.test(src)) {
        throw new Error('a hardcoded taper-factor ternary is back in generate.ts · it must read the shared model');
      }
    },
  },
  {
    id: 'TAPER.marathon-descent-shape',
    binds: ['lib/plan/goal-tiers.ts#taperFactor'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.2 Marathon taper structure (3 weeks)',
    claim:
      'The marathon is the one distance whose week-by-week descent doctrine states outright: ' +
      '80-90% of peak three weeks out, 60-70% two weeks out, 40-50% race week. The shared ' +
      'descent shape every distance is rescaled from is the marathon\'s own, so the marathon ' +
      'must reproduce all three of its bands exactly.',
    check({ cite }) {
      const t = cite.table();
      const bandFor = (wk: string) => parsePctBand(t.cell(wk, 'Volume'));
      within(taperFactor('m', 3), bandFor('-3'), 'marathon taper factor, three weeks out');
      within(taperFactor('m', 2), bandFor('-2'), 'marathon taper factor, two weeks out');
      within(taperFactor('m', 1), bandFor('-1'), 'marathon taper factor, race week');
    },
  },
  {
    id: 'TAPER.validator-band-is-two-sided',
    binds: [
      'lib/plan/validate.ts#CONSTRAINTS.taperDropMinPct',
      'lib/plan/validate.ts#CONSTRAINTS.taperDropMaxPct',
    ],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | Taper length | Volume reduction (peak week) |',
    claim:
      'Every doctrine band has two ends and the validator must check both. The floor may not ' +
      'be stricter than the shallowest reduction doctrine allows for that distance (a validator ' +
      'demanding more than doctrine rejects correct plans) and may never be zero. The CEILING ' +
      'is the deepest reduction the row allows — without it, a taper that cuts a 5K by 55% ' +
      'passes clean, which is exactly how the marathon row survived being applied to all five ' +
      'distances.',
    check({ cite }) {
      const t = cite.table();
      const src = sourceOf('web-v2/lib/plan/validate.ts');
      const docRow: Record<DistCategory, string> = { ...DOC_ROW, ultra: 'Ultra (50K-100M)' };
      for (const cat of CATS) {
        const row = new RegExp(
          `'${cat}':\\s*\\{[^}]*taperDropMinPct:\\s*(\\d+)[^}]*taperDropMaxPct:\\s*(\\d+)`,
        );
        const m = matchLiteral(src, row, `CONSTRAINTS['${cat}'] taper band`);
        const [floorPct, ceilPct] = [Number(m[1]), Number(m[2])];
        const [lo, hi] = parseBand(t.cell(docRow[cat], 'Volume reduction (peak week)'));
        if (floorPct <= 0) throw new Error(`CONSTRAINTS['${cat}'].taperDropMinPct is ${floorPct} · a taper must drop volume`);
        atMost(floorPct, lo, `CONSTRAINTS['${cat}'].taperDropMinPct`);
        if (ceilPct !== hi) {
          throw new Error(
            `CONSTRAINTS['${cat}'].taperDropMaxPct is ${ceilPct} · doctrine's deepest stated ` +
              `reduction for this distance is ${hi}%`,
          );
        }
        if (floorPct >= ceilPct) {
          throw new Error(`CONSTRAINTS['${cat}'] taper band is inverted: floor ${floorPct} ≥ ceiling ${ceilPct}`);
        }
      }
    },
  },

  // ══ LONG RUN · ABSOLUTE TIME ══════════════════════════════════════════════
  {
    id: 'LONGRUN.absolute-time-cap',
    binds: ['lib/plan/generate.ts#LONG_RUN_MAX_HOURS', 'lib/plan/generate.ts#layoutWeek'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      "Doctrine's long-run cap has two clauses and the second is an ABSOLUTE TIME bound: " +
      '"or by absolute time: <3.0-3.5 h for marathoners". The engine cited that clause as its ' +
      'reason for letting the marathon long exceed the percentage cap, and never implemented ' +
      'it — so the bound doing the permitting did no bounding. The ceiling is read out of the ' +
      'doctrine cell, and the cap is actually applied against the runner\'s own easy pace.',
    check({ cite }) {
      const spec = cite.table().cell('Long-run cap', 'Specification');
      // The parenthetical carries the hours; parseBand strips parentheses, so
      // read the clause directly.
      const clause = spec.match(/absolute time:\s*[^)]*/i);
      if (!clause) {
        throw new Error('the long-run cap no longer states an absolute-time alternative · re-read the claim');
      }
      const hours = parseBand(clause[0].replace(/[–—]/g, '-'));
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const engine = Number(matchLiteral(src, /const LONG_RUN_MAX_HOURS = (\d*\.?\d+);/, 'LONG_RUN_MAX_HOURS')[1]);
      within(engine, hours, 'LONG_RUN_MAX_HOURS');
      // And it is WIRED. A ceiling nobody multiplies by is the defect this claim exists for.
      if (!/LONG_RUN_MAX_HOURS \* 3600/.test(src)) {
        throw new Error('LONG_RUN_MAX_HOURS is declared but never applied to a long run · implement the cap or delete it');
      }
    },
  },

  // ══ WEEKLY RAMP ═══════════════════════════════════════════════════════════
  {
    id: 'RAMP.ten-percent-is-regime-specific',
    binds: [
      'lib/plan/goal-tiers.ts#COMEBACK_RAMP_CEILING',
      'lib/plan/adapt.ts#RERAMP_WEEKLY_GROWTH',
      'lib/plan/seed-from-onboarding.ts#buildProgressiveCurve',
    ],
    doc: 'Research/05-injury-return-protocols.md',
    anchor: 'weekly mileage +≤10%/week',
    claim:
      'The ten-percent rule is doctrine for COMEBACK regimes — injury return, post-layoff, ' +
      'youth — and the engine holds those paths to it exactly, reading the number out of the ' +
      'doctrine sentence. It is NOT the general-case ramp; see RAMP.general-case-ceiling for ' +
      'why, and note that the doc states it as "convention, not strongly evidence-supported ' +
      'but a reasonable safety margin", which is an honest basis for a comeback cap and not ' +
      'for a universal one.',
    check({ cite }) {
      const stated = parseBand(cite.section[0].replace(/.*weekly mileage \+/, ''))[0];
      const ceiling = 1 + stated / 100;
      if (COMEBACK_RAMP_CEILING !== ceiling) {
        throw new Error(`COMEBACK_RAMP_CEILING is ${COMEBACK_RAMP_CEILING} · doctrine states ${ceiling}`);
      }
      atMost(RERAMP_WEEKLY_GROWTH, ceiling, 'RERAMP_WEEKLY_GROWTH');
      const seed = Number(
        matchLiteral(
          sourceOf('web-v2/lib/plan/seed-from-onboarding.ts'),
          /current \* (\d*\.?\d+)\)\);/,
          'buildProgressiveCurve',
        )[1],
      );
      atMost(seed, ceiling, 'onboarding-seed weekly ramp factor');
    },
  },
  {
    id: 'RAMP.general-case-ceiling',
    binds: [
      'lib/plan/goal-tiers.ts#GENERAL_RAMP_CEILING',
      'lib/plan/generate.ts#volumeCurve.climbFactor',
      'lib/plan/validate.ts#safe-ramp ceiling',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'For a runner who is not coming back from anything, doctrine\'s general ramp figures are ' +
      'in the base-growth row: trained athletes 5-15%, novices "safely +20-25% over 8 weeks". ' +
      'The engine\'s per-experience ceiling must sit inside those figures — no higher than the ' +
      'novice number doctrine actually reports for a novice, no higher than the trained number ' +
      'for everyone else, and never below the comeback cap (a healthy runner may not be held ' +
      'to a stricter ramp than someone returning from injury). Both places the app bounds a ' +
      'ramp — the generator and the validator that judges it — must read this same table, ' +
      'because "one doctrinal quantum, N disagreeing constants" is how the validator ended up ' +
      'rejecting plans the generator was correctly authoring.',
    check({ cite }) {
      const spec = cite.table().cell('Year-on-year base growth', 'Specification');
      const trained = parseBand(spec.split(';')[0]);            // 5-15
      const novice = parseBand(spec.replace(/^[^;]*;\s*/, ''));  // 20-25
      const trainedCeil = 1 + trained[1] / 100;
      const noviceCeil = 1 + novice[1] / 100;
      for (const [level, v] of Object.entries(GENERAL_RAMP_CEILING)) {
        const ceiling = level === 'beginner' ? noviceCeil : trainedCeil;
        atMost(v, ceiling, `GENERAL_RAMP_CEILING.${level}`);
        if (v < COMEBACK_RAMP_CEILING) {
          throw new Error(
            `GENERAL_RAMP_CEILING.${level} is ${v}, below the ${COMEBACK_RAMP_CEILING} comeback ` +
              'cap · a healthy runner may not ramp more slowly than an injury return',
          );
        }
      }
      // A novice ramps at least as fast as a trained runner · that is the whole
      // point of the exception doctrine records.
      if (GENERAL_RAMP_CEILING.beginner < GENERAL_RAMP_CEILING.intermediate) {
        throw new Error('GENERAL_RAMP_CEILING gives a novice a stricter ramp than a trained runner · doctrine says the opposite');
      }
      // Both bounding sites read the table · neither hardcodes a factor.
      for (const file of ['web-v2/lib/plan/generate.ts', 'web-v2/lib/plan/validate.ts']) {
        if (!/GENERAL_RAMP_CEILING\[/.test(sourceOf(file))) {
          throw new Error(`${file} does not read GENERAL_RAMP_CEILING · it is bounding a ramp with its own number`);
        }
      }
      // The dead per-experience table this replaced must stay dead.
      if (/^\s*const RAMP_PCT\b/m.test(sourceOf('web-v2/lib/plan/generate.ts'))) {
        throw new Error('RAMP_PCT is back in generate.ts · the live ramp table is GENERAL_RAMP_CEILING');
      }
    },
  },
  {
    id: 'RAMP.single-session-spike',
    binds: [
      'lib/plan/generate.ts#rampCeiling',
      'lib/plan/generate.ts#recentPeakLongMi',
      'lib/plan/generate.ts#enforceSpikeRule',
      'lib/plan/generate.ts#SPIKE_MAX_SHARE',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'A single run beyond 110% of the longest run in the prior 30 days raises overuse-injury ' +
      'risk by about 64%. This — not the weekly ramp — is the load constraint doctrine actually ' +
      'evidences, so the long-run ramp ceiling must not step past that multiple. The multiple is ' +
      'taken against THE longest run in the window, whatever its length: the lookback that feeds ' +
      'the ceiling may carry no minimum-distance filter, because filtering short runs out makes a ' +
      'low-volume runner read as no history and `rampCeiling` then returns the unbounded doctrine ' +
      'cap — the guard switched off for exactly the runners it protects (LOWVOL-1, 2026-08-19: a ' +
      '6 mi longest read 0 and was authored a 10 mi week-1 long, 167% of prior-30d).' +
      ' SPIKEROLL-1 (2026-08-31): `rampCeiling` is `layoutWeek`\'s AUTHORING-TIME expression of ' +
      'this same threshold, and it reads a pre-finalization curve that is always looser than what ' +
      'ships — every pass after `layoutWeek` (embedded races, cutbacks, the taper rescale) can only ' +
      'shrink a week further. `enforceSpikeRule` in `finalizeComposedPlan` is the SAME 110% figure ' +
      'applied to the plan that actually ships, rolling across the whole block rather than seeded ' +
      'once — the two are complementary, not duplicate, and this claim now watches both: the ' +
      'authoring-time expression stays inside the threshold as before, AND the finishing pass is ' +
      'demonstrably WIRED rather than defined-and-inert (Rule 20 — `void enforceSpikeRule;` shipped ' +
      'for one cycle before this).',
    check({ cite }) {
      const t = cite.table();
      const stated = parseBand(t.cell('Single-session spike threshold', 'Specification'))[0] / 100;
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const seed = Number(
        matchLiteral(src, /const seed = Math\.floor\(spikeAnchorMi \* (\d*\.?\d+) \* 2\) \/ 2;/, 'rampCeiling seed')[1],
      );
      const step = Number(
        matchLiteral(src, /const stepCeil = spikeAnchorMi \* Math\.pow\((\d*\.?\d+),/, 'rampCeiling step')[1],
      );
      atMost(seed, stated, 'long-run ramp seed vs the single-session spike threshold');
      atMost(step, stated, 'long-run per-step ramp vs the single-session spike threshold');
      // The anchor the multiple is taken against must be the real longest run.
      const fn = src.slice(src.indexOf('async function recentPeakLongMi'));
      const body = fn.slice(0, fn.indexOf('\n}'));
      if (/distanceMi'\)::numeric\s*>=/.test(body)) {
        throw new Error(
          'recentPeakLongMi filters the lookback by a minimum distance again · a runner whose ' +
            'longest run is below that floor reads 0 and rampCeiling stops bounding their long run',
        );
      }

      // SPIKEROLL-1 · the finishing-pass half. `SPIKE_MAX_SHARE` (the literal
      // `finalizeComposedPlan` clamps against) must still equal the same
      // doctrine threshold this claim already reads.
      const shareM = src.match(/export const SPIKE_MAX_SHARE = (\d*\.?\d+);/);
      if (!shareM) throw new Error('SPIKE_MAX_SHARE is gone or no longer a literal · enforceSpikeRule has no doctrine-bound ceiling');
      const share = Number(shareM[1]);
      if (Math.abs(share - stated) > 1e-9) {
        throw new Error(
          `SPIKE_MAX_SHARE is ${share}, the cited threshold is ${stated} · the finishing-pass ` +
            'ceiling has drifted from the same table this claim already binds',
        );
      }
      // WIRED, not inert (Rule 20's own named failure mode — `void
      // enforceSpikeRule;` shipped for one cycle after this pass was written
      // and before the owner ruled on landing it). A call site must exist and
      // the old no-op marker must be gone.
      if (/void enforceSpikeRule;/.test(src)) {
        throw new Error(
          '`void enforceSpikeRule;` is back in generate.ts · the finishing-pass spike guard has ' +
            'been switched off again while its own doctrine claim stays green',
        );
      }
      if (!/^\s*enforceSpikeRule\(\);\s*$/m.test(src)) {
        throw new Error(
          'no bare `enforceSpikeRule();` call site found in generate.ts · the guard may be defined ' +
            'but never invoked',
        );
      }
    },
  },
  {
    id: 'CONVENTION.spike-rule-coherence-floor',
    binds: ['lib/plan/generate.ts#SPIKE_MIN_COHERENT_ANCHOR_MI'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Practical load rules',
    claim:
      'The 110% single-session spike ceiling (`RAMP.single-session-spike`) degenerates on the ' +
      'half-mile authoring grid for a small anchor: `floor(anchor * 1.10 * 2) / 2` EQUALS `anchor` ' +
      'itself whenever a 10% move does not cross a half-mile boundary — the norm, not the edge ' +
      'case, for an anchor already authored on that grid (`floor(2 * 1.10 * 2) / 2 = 2.0`). Below ' +
      'that floor the guard cannot express the doctrine ratio at every anchor — some anchors can ' +
      '(2.3 -> 2.5 is +8.7%), others structurally cannot (2.0 -> 2.0 is +0%) — which is an anchor- ' +
      'dependent, incoherent guard rather than a strict one. THE 5 MI FLOOR ITSELF IS A ' +
      'CONVENTION, NOT A RESEARCH FINDING: `Research/00a` states the 110% ratio and says nothing ' +
      'about a minimum coherent long-run distance for it to operate on a half-mile grid — this ' +
      'claim exists to enforce the SHAPE (the guard must not be incoherent below its own floor) ' +
      'and that the module never advertises the floor as measured, on the same discipline as ' +
      '`CONVENTION.corpus-corroboration-count` and `CONVENTION.cold-start-mileage-anchor`.',
    check({ cite }) {
      // The doctrine sentence the SHAPE rests on, read at run time (Rule 18):
      // the 110% ratio this floor exists to keep coherent must still be there.
      const spec = cite.table().cell('Long-run cap rule', 'Specification');
      if (!/110%/.test(spec)) {
        throw new Error(
          'Research/00a §"Practical load rules" no longer states the long-run cap at 110% · that ' +
            'figure is the entire reason a coherence floor is needed on the authoring grid',
        );
      }
      const growthShare = parseBand(spec)[0] / 100 - 1; // 110% -> 0.10
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const m = src.match(/export const SPIKE_MIN_COHERENT_ANCHOR_MI = (\d*\.?\d+);/);
      if (!m) throw new Error('SPIKE_MIN_COHERENT_ANCHOR_MI is gone or no longer a literal');
      const floor = Number(m[1]);
      // The honest label must stay — same discipline as the two CONVENTION
      // siblings this claim's own comment names.
      if (!/THIS NUMBER IS A CONVENTION, NOT A RESEARCH FINDING/.test(src)) {
        throw new Error(
          'generate.ts no longer states that the spike-rule coherence floor is a convention · that ' +
            'sentence is the whole point of this claim',
        );
      }
      // The floor must actually sit where the degeneracy the claim describes
      // stops being universal: at the floor itself, a half-mile step must be
      // AT LEAST the doctrine growth share (0.5 / floor >= 0.10 · floor <= 5),
      // parsed from the SAME row above rather than hardcoded on both sides.
      if (!(0.5 / floor >= growthShare - 1e-9)) {
        throw new Error(
          `SPIKE_MIN_COHERENT_ANCHOR_MI is ${floor} · a half-mile grid step there is smaller than ` +
            "the doctrine ratio, so the floor sits past the point it claims to fix — the guard is " +
            'STILL incoherent at its own boundary',
        );
      }
      if (!(floor >= 2)) {
        throw new Error(
          `SPIKE_MIN_COHERENT_ANCHOR_MI is ${floor} · too small to be a meaningful coherence floor ` +
            '(the degeneracy this claim describes is worst well above 2 mi)',
        );
      }
      // And it must actually be SPENT as the exemption — defined but inert is
      // how every rule in this file has failed before (Rule 20).
      if (!/anchor >= SPIKE_MIN_COHERENT_ANCHOR_MI/.test(src)) {
        throw new Error(
          'SPIKE_MIN_COHERENT_ANCHOR_MI is declared but `enforceSpikeRule` no longer gates on it · ' +
            'the exemption may be inert',
        );
      }
    },
  },

  // ══ CYCLE-OVER-CYCLE VOLUME GROWTH ════════════════════════════════════════
  {
    id: 'RAMP.cycle-over-cycle-peak-growth',
    binds: [
      'lib/plan/goal-tiers.ts#CYCLE_GROWTH_CEILING',
      'lib/plan/generate.ts#cycleBoundedPeak',
      'lib/plan/generate.ts#volumeCurve.peakTarget',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'The base-growth row states a figure PER TRAINING CYCLE — "5-15% per training cycle for ' +
      'trained athletes" — and the engine spent it entirely on the week-over-week climb ' +
      '(RAMP.general-case-ceiling, above). The quantity the row literally bounds is how far ' +
      'this block\'s peak may sit above the last peak the runner demonstrated, and until ' +
      'WKPEAK-1 nothing bounded it: `volumeCurve` built to the tier band floor from wherever ' +
      'the runner happened to be. So the per-cycle ceiling must exist, must sit inside the ' +
      'band doctrine states, must apply only to the cohort doctrine states it FOR (the row ' +
      'says "for trained athletes"; the novice clause is about ramp rate over 8 vs 12 weeks, ' +
      'and reading it as a cycle bound caps a first-time marathoner off 15 mi/wk at 19 ' +
      'against a Research/22 beginner row that asks 30-35), and must never be able to pull a ' +
      'target BELOW either the peak the runner has already held or the least volume the ' +
      'distance table asks of anyone racing that distance.',
    check({ cite }) {
      const spec = cite.table().cell('Year-on-year base growth', 'Specification');
      if (!/for trained athletes/i.test(spec)) {
        throw new Error(
          'the base-growth row no longer says the 5-15% figure is "for trained athletes" · ' +
            'CYCLE_GROWTH_CEILING excludes beginners on exactly that wording — re-read the row',
        );
      }
      const trained = parseBand(spec.split(';')[0]);      // 5-15
      const lo = 1 + trained[0] / 100;
      const hi = 1 + trained[1] / 100;
      for (const [level, v] of Object.entries(CYCLE_GROWTH_CEILING)) {
        if (level === 'beginner') {
          if (v != null) {
            throw new Error(
              `CYCLE_GROWTH_CEILING.beginner is ${v} · doctrine states its per-cycle figure ` +
                'for TRAINED athletes only, so a novice carries no cycle bound here',
            );
          }
          continue;
        }
        if (v == null) {
          throw new Error(`CYCLE_GROWTH_CEILING.${level} is null · a trained runner IS bounded by this row`);
        }
        within(v, [lo, hi], `CYCLE_GROWTH_CEILING.${level}`);
      }
      // The generator must READ the table rather than carry its own factor.
      if (!/CYCLE_GROWTH_CEILING\[/.test(sourceOf('web-v2/lib/plan/generate.ts'))) {
        throw new Error('generate.ts does not read CYCLE_GROWTH_CEILING · the peak target is bounded by its own number');
      }
      // The two floors, exercised rather than asserted: for every distance and
      // every trained level, a runner whose measured peak is ABSURDLY small
      // still gets at least what the distance's own developing row asks, and a
      // runner already above the tier target is never built below themselves.
      for (const cat of CATS) {
        const developingFloor = TIER_TARGETS[cat].developing.peakWeeklyMileageBand[0];
        const advTarget = TIER_TARGETS[cat].advanced.peakWeeklyMileageBand[0];
        for (const level of ['intermediate', 'advanced', 'advanced_plus'] as const) {
          const tiny = cycleBoundedPeak(advTarget, { ...EVIDENCE_ZERO, peakMi: 2 }, level, cat);
          if (tiny < developingFloor) {
            throw new Error(
              `cycleBoundedPeak(${cat}/${level}) took a 2 mi/wk runner to ${tiny}, below the ` +
                `${developingFloor} the ${cat} developing row asks of anyone racing it`,
            );
          }
          const big = cycleBoundedPeak(advTarget, { ...EVIDENCE_ZERO, peakMi: advTarget + 20 }, level, cat);
          if (big < advTarget + 20) {
            throw new Error(
              `cycleBoundedPeak(${cat}/${level}) built a ${advTarget + 20} mi/wk runner down to ${big}`,
            );
          }
          // Nothing measured → nothing bounded. A refusal, not a guess.
          if (cycleBoundedPeak(advTarget, { ...EVIDENCE_ZERO, peakMi: 0 }, level, cat) !== advTarget) {
            throw new Error(`cycleBoundedPeak(${cat}/${level}) bounded a target with no measured peak`);
          }
        }
      }
    },
  },
  {
    id: 'RAMP.short-layoff-resume-sequence',
    binds: [
      'lib/plan/generate.ts#RESUME_SEQUENCE',
      'lib/plan/generate.ts#RAMP_BASE_RESUME_FRACTION',
      'lib/plan/generate.ts#volumeCurve.resumeSteps',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '### Return from Short Layoff (1-2 weeks off)',
    claim:
      'The 8-14-day row publishes a THREE-WEEK return — 70% of pre-layoff volume for week 1, ' +
      '85% for week 2, full for week 3 — and the engine read only the first number, made it ' +
      'the base of a nine-week geometric climb, and got the runner back to full volume in ' +
      'week five. All three numbers must be encoded, in order, ending at full; the first must ' +
      'BE `RAMP_BASE_RESUME_FRACTION` so the resume and the base the lift is computed from ' +
      'cannot disagree; and the curve must spend the sequence rather than only its first cell.',
    check({ cite }) {
      const row = cite.table().cell('8-14 days', 'Restart approach');
      // The doc's own numbers: every percentage in the cell, plus "full" = 100.
      const pcts = [...row.matchAll(/(\d+)\s*%/g)].map((m) => Number(m[1]));
      if (!/\bfull\b/i.test(row)) {
        throw new Error('the 8-14-day row no longer ends at "full" · re-read the return protocol');
      }
      const doctrineSeq = [...pcts, 100].map((p) => p / 100);
      if (RESUME_SEQUENCE.length !== doctrineSeq.length) {
        throw new Error(
          `RESUME_SEQUENCE has ${RESUME_SEQUENCE.length} steps, the doctrine row publishes ` +
            `${doctrineSeq.length} (${doctrineSeq.join(' · ')})`,
        );
      }
      doctrineSeq.forEach((want, i) => {
        if (Math.abs(RESUME_SEQUENCE[i] - want) > 1e-9) {
          throw new Error(`RESUME_SEQUENCE[${i}] is ${RESUME_SEQUENCE[i]}, doctrine says ${want}`);
        }
      });
      if (RESUME_SEQUENCE[0] !== RAMP_BASE_RESUME_FRACTION) {
        throw new Error(
          'RESUME_SEQUENCE[0] is not RAMP_BASE_RESUME_FRACTION · the resume and the ramp base ' +
            'are two readings of one doctrine number and must be one constant',
        );
      }
      if (!/RESUME_SEQUENCE\b/.test(sourceOf('web-v2/lib/plan/generate.ts'))) {
        throw new Error('volumeCurve does not spend RESUME_SEQUENCE · the other two weeks are dropped again');
      }
    },
  },
  {
    id: 'RAMP.restoration-is-continuous',
    binds: [
      'lib/plan/generate.ts#RESTORE_STEP_FRACTION',
      'lib/plan/generate.ts#restoreSteps',
      'lib/plan/generate.ts#volumeCurve.resumeSteps',
      'lib/plan/_restore_continuity.test.ts#CONTINUOUS-RESTORE-1',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '### Return from Short Layoff (1-2 weeks off)',
    claim:
      'The row states a RATE, not a membership test: 70% of pre-layoff volume, then 85%, then ' +
      'full — even steps of 15% of the pre-layoff level, restoring a runner in two of them. ' +
      'The engine spent it as a fixed three-rung ladder switched on by `RampBaseEvidence.' +
      'lifted` (`0.70 x sustained > mean`), whose logical complement is the `baseRebuilt` ' +
      'gate — so one comparison of two near-identical numbers decided between restoration in ' +
      'three weeks and a geometric crawl from a depressed 28-day mean, with an infinitely ' +
      'sharp discontinuity at the threshold. A runner at 69% of sustained was restored; a ' +
      'runner at 71% was not, and the fitter runner therefore received the worse plan. ' +
      'Restoration must be spent as the rate doctrine states, from wherever the runner ' +
      'actually is, so the authored volumes move continuously with the runner\'s own volume ' +
      'and no threshold can flip a categorical behaviour.',
    check({ cite }) {
      const row = cite.table().cell('8-14 days', 'Restart approach');
      const pcts = [...row.matchAll(/(\d+)\s*%/g)].map((m) => Number(m[1]) / 100);
      if (!/\bfull\b/i.test(row)) {
        throw new Error('the 8-14-day row no longer ends at "full" · re-read the return protocol');
      }
      const rungs = [...pcts, 1.0];
      // The doc's rungs must be EVENLY spaced, or "a rate" is the wrong reading of them.
      const gaps = rungs.slice(1).map((v, i) => v - rungs[i]);
      for (const g of gaps) {
        if (Math.abs(g - gaps[0]) > 1e-9) {
          throw new Error(
            `the return rungs (${rungs.join(' · ')}) are not evenly spaced, so they do not state ` +
              'a single restoration rate · re-derive RESTORE_STEP_FRACTION from the row',
          );
        }
      }
      if (Math.abs(RESTORE_STEP_FRACTION - gaps[0]) > 1e-9) {
        throw new Error(
          `RESTORE_STEP_FRACTION is ${RESTORE_STEP_FRACTION}, the doctrine row steps by ${gaps[0]}`,
        );
      }
      // Spending the rate from doctrine's own starting rung must REPRODUCE the row.
      const sustained = 45;
      const fromDoctrine = restoreSteps(sustained * rungs[0], sustained);
      const want = rungs.map((f) => Math.round(sustained * f * 10) / 10);
      if (JSON.stringify(fromDoctrine) !== JSON.stringify(want)) {
        throw new Error(
          `restoreSteps at ${rungs[0] * 100}% of sustained gives ${fromDoctrine.join(' · ')}, ` +
            `the doctrine row publishes ${want.join(' · ')}`,
        );
      }
      // …and it must degrade smoothly, not fall off a cliff. Walk the runner up
      // in 0.1 mi steps and require the first restored week to move with them.
      let prevFirst = -Infinity;
      for (let held = sustained * rungs[0]; held <= sustained + 1e-9; held += 0.1) {
        const steps = restoreSteps(held, sustained);
        const first = steps.length > 0 ? steps[0] : sustained;
        if (first < prevFirst - 1e-9) {
          throw new Error(
            `restoreSteps is not monotonic: a runner at ${held.toFixed(1)} mi starts at ` +
              `${first} after one at ${prevFirst} · a fitter runner may never get a smaller week`,
          );
        }
        if (first - prevFirst > 0.75 && Number.isFinite(prevFirst)) {
          throw new Error(
            `restoreSteps jumps ${(first - prevFirst).toFixed(2)} mi for 0.1 mi of input at ` +
              `${held.toFixed(1)} · the cliff has been relocated, not removed`,
          );
        }
        prevFirst = first;
        if (steps.length > 0 && steps[steps.length - 1] !== sustained) {
          throw new Error(`a restoration ending at ${steps[steps.length - 1]} never reaches the sustained level`);
        }
      }
      // The switch must be gone from the curve: the ladder is gated on the
      // QUANTITY (`returning`), never on the near-tie (`lifted`).
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      if (/resumeSteps[^\n]*\n?[^\n]*evidence\?\.lifted/.test(src)) {
        throw new Error(
          'volumeCurve gates the resume ladder on `lifted` again · that boolean is ' +
            '`0.70 x sustained > mean` and using it as a switch is the cliff this claim exists for',
        );
      }
      if (!/evidence\?\.returning/.test(src)) {
        throw new Error('volumeCurve no longer gates restoration on `returning` · re-read RAMP.restoration-is-continuous');
      }
      // And the base must reach the curve on EVERY authoring, not only lifted ones.
      if (/if \(ramp\.lifted\) inputs\.compose\.rampBaseMi/.test(src)) {
        throw new Error(
          '`rampBaseMi` is conditional on `lifted` again · when false the curve silently falls ' +
            'back to the 28-day mean and RAMPBASE-1 disengages for the runners nearest the threshold',
        );
      }
    },
  },
  {
    id: 'RAMP.post-race-return-is-not-a-layoff-return',
    binds: [
      'lib/plan/generate.ts#restoreSteps',
      'lib/plan/generate.ts#RampBaseEvidence.heldByCurrent',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Marathon Recovery (4-week reverse taper)',
    claim:
      'Research/22 §14\'s ladder is titled "Return from Short Layoff (1-2 weeks OFF)" and keys on ' +
      'DAYS OFF; its first rung, 70% of pre-layoff volume, is the week a runner spends coming ' +
      'back from not running. A runner who ran THROUGH a post-race window has just spent that ' +
      'week, and the protocol that governs them is this reverse taper, which restores as a ' +
      'percentage of PEAK on a fixed schedule and far faster than §14 does. So a build opening ' +
      'for a runner who never stopped must STEP UP from the volume they are holding, not repeat ' +
      'it — otherwise the build\'s first week is a copy of the recovery block it replaces and ' +
      'the recovery never ends.',
    check({ cite }) {
      const t = cite.table();
      // Doctrine's own post-race week-over-week steps, read out of the table.
      const pctOf = (row: string): number => {
        const [lo] = parseBand(t.cell(row, 'Volume vs. peak'));
        return lo;
      };
      const w2 = pctOf('Week 2');
      const w3 = pctOf('Week 3');
      const w4 = pctOf('Week 4');
      if (!(w2 > 0 && w3 > w2 && w4 > w3)) {
        throw new Error(
          `the reverse taper no longer climbs (${w2} -> ${w3} -> ${w4}) · this claim reads its ` +
            'week-over-week steps to establish that post-race restoration outpaces §14',
        );
      }
      // The point being claimed: post-race restoration steps are LARGER than
      // the short-layoff ladder's 15%-of-sustained. If that ever stops being
      // true, stepping up rather than repeating needs re-arguing.
      const postRaceStep = (w3 - w2) / 100;
      if (!(postRaceStep > RESTORE_STEP_FRACTION)) {
        throw new Error(
          `Research/00b's week 2->3 step is ${(postRaceStep * 100).toFixed(0)}% of peak, no larger ` +
            `than the short-layoff rate of ${(RESTORE_STEP_FRACTION * 100).toFixed(0)}% · the ` +
            'reasoning that a post-race runner may step up rather than repeat no longer holds',
        );
      }
      // The behaviour itself: spending the entry week drops exactly the leading
      // rung, and both ladders still arrive at the sustained level.
      const sustained = 45;
      const fresh = restoreSteps(sustained * RAMP_BASE_RESUME_FRACTION, sustained, 0);
      const spent = restoreSteps(sustained * RAMP_BASE_RESUME_FRACTION, sustained, sustained * RAMP_BASE_RESUME_FRACTION);
      if (JSON.stringify(spent) !== JSON.stringify(fresh.slice(1))) {
        throw new Error(
          `a runner who already spent the re-entry week gets ${spent.join(' · ')}, which is not ` +
            `${fresh.join(' · ')} minus its first rung`,
        );
      }
      if (spent.length > 0 && spent[spent.length - 1] !== sustained) {
        throw new Error('a post-race restoration no longer arrives at the sustained level');
      }
      if (!/heldMi >= baseMi - 1e-9/.test(sourceOf('web-v2/lib/plan/generate.ts'))) {
        throw new Error(
          '`heldByCurrent` is no longer derived from the demonstrated volume setting the base · ' +
            'without it the engine cannot tell a runner who ran through from one coming back',
        );
      }
    },
  },
  {
    id: 'AEROBIC.general-aerobic-run-is-a-duration',
    binds: [
      'lib/plan/generate.ts#GENERAL_AEROBIC_MIN_MINUTES',
      'lib/plan/generate.ts#GENERAL_AEROBIC_MAX_MINUTES',
      'lib/plan/generate.ts#RECOVERY_RUN_MAX_MINUTES',
      'lib/plan/generate.ts#layoutWeek.easyCount',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### 2. General aerobic (easy run)',
    claim:
      'Doctrine states every easy category in MINUTES, never miles — §1 recovery 20-45 min, ' +
      '§2 general aerobic 40-75 min — because three miles is a real run for one runner and a ' +
      'warm-up for another. Rule 12: the engine sized easy days as whatever the long run and ' +
      'the quality sessions left over, and handed a 3:00-goal marathoner 2-mile easy days. ' +
      'The three constants must equal the bands the cited tables publish, and the engine must ' +
      'SPEND them: cutting the NUMBER of easy days rather than authoring any below the §2 ' +
      'floor, and shortening the day after the long run into §1\'s band while the others take ' +
      'the miles it gives up.',
    check({ cite }) {
      // §2's own row, read at run time rather than hardcoded on both sides.
      const [aeroLo, aeroHi] = parseBand(cite.table().cell('Duration', 'Specification'));
      if (GENERAL_AEROBIC_MIN_MINUTES !== aeroLo) {
        throw new Error(
          `GENERAL_AEROBIC_MIN_MINUTES is ${GENERAL_AEROBIC_MIN_MINUTES}, §2 states ${aeroLo}-${aeroHi} min`,
        );
      }
      if (GENERAL_AEROBIC_MAX_MINUTES !== aeroHi) {
        throw new Error(
          `GENERAL_AEROBIC_MAX_MINUTES is ${GENERAL_AEROBIC_MAX_MINUTES}, §2 states ${aeroLo}-${aeroHi} min`,
        );
      }
      // §1 is a different section · resolve it explicitly rather than assuming
      // the two tables sit under one anchor.
      const rec = resolveCitation('Research/00a-distance-running-training.md', '### 1. Recovery run');
      const [recLo, recHi] = parseBand(rec.table().cell('Duration', 'Specification'));
      if (RECOVERY_RUN_MAX_MINUTES !== recHi) {
        throw new Error(
          `RECOVERY_RUN_MAX_MINUTES is ${RECOVERY_RUN_MAX_MINUTES}, §1 states ${recLo}-${recHi} min`,
        );
      }
      // The two bands OVERLAP in doctrine (20-45 against 40-75) and that is
      // fine — they are different jobs, not disjoint lengths. What has to hold
      // is that recovery is the SHORTER of the two at both ends, or "shorten
      // the day after the long run into §1" would not shorten anything.
      if (!(recLo < aeroLo && recHi < aeroHi)) {
        throw new Error(
          `§1 recovery is ${recLo}-${recHi} min and §2 aerobic is ${aeroLo}-${aeroHi} · recovery ` +
            'is no longer the shorter category, so varying between them is meaningless',
        );
      }
      // And the engine spends them. Rule 18: an assertion that only checks the
      // constants proves the file agrees with itself.
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/while \(easyCount > 1 && remainingMi \/ easyCount < genAerobicFloorMi\) easyCount--;/.test(src)) {
        throw new Error(
          'layoutWeek no longer cuts the NUMBER of easy days when the remainder cannot fund the ' +
            '§2 floor · easy running is back to being the leftover (Rule 12)',
        );
      }
      if (!/RECOVERY_RUN_MAX_MINUTES \* 60\) \/ easyPaceSecPerMi/.test(src)) {
        throw new Error(
          'the day after the long run is no longer priced into §1\'s recovery band · Rule 12\'s ' +
            'variation clause is unspent and every easy day is the same number again',
        );
      }
      // TAPER and BASE are excluded on purpose (owner ruling 2026-08-30: a
      // taper's short easy days are legitimate §1 runs). If that exclusion
      // disappears, the taper gets "fixed" and the let-down stops working.
      if (!/phase !== 'BASE' && phase !== 'TAPER'/.test(src)) {
        throw new Error(
          'the easy-day rules no longer exclude BASE and TAPER · a taper deliberately cuts ' +
            'volume and its short easy days are doctrine, not a defect',
        );
      }
    },
  },
  {
    id: 'RULE5.quality-returns-it-does-not-vanish',
    binds: [
      'lib/plan/generate.ts#QUALITY_RETURN_MIN_SESSIONS',
      'lib/plan/generate.ts#composePlan.densityForWeek',
      'lib/plan/generate.ts#recentQualityPerWeek',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Distance | Total recovery days (no quality) | Days of zero/very-light running | Return to long runs | Return to quality workouts | Earliest reasonable next race-effort |',
    claim:
      'Every row of the recovery table names a day on which quality COMES BACK — 5K day 6-8, ' +
      'half marathon day 10-14, marathon week 3-4. The no-quality window before it belongs to ' +
      'the recovery composer, so a race-prep quality-bearing week is past that day by ' +
      'construction and may never author zero quality sessions. Rule 5\'s density ramp reads a ' +
      '28-day habit window, and for a runner who has just raced most of that window IS the ' +
      'no-quality recovery this engine itself prescribed — so a literal reading ramps from ~0 ' +
      'and hands an experienced marathoner a build week with no hard running in it. That is ' +
      'RAMPBASE-1\'s error (reading the engine\'s own prescription back as the runner\'s ' +
      'capability) arriving at density instead of volume.',
    check({ cite }) {
      const t = cite.table();
      // The column must still exist, and every distance must still name a return.
      for (const row of ['5K', 'Half marathon', 'Marathon']) {
        const cell = t.cell(row, 'Return to quality workouts');
        if (!/\d/.test(cell)) {
          throw new Error(
            `Research/00b no longer names when quality returns for ${row} ("${cell}") · ` +
              'QUALITY_RETURN_MIN_SESSIONS is read off this column existing at all',
          );
        }
        if (/never|none/i.test(cell)) {
          throw new Error(`the ${row} row says quality never returns ("${cell}") · re-read the protocol`);
        }
      }
      if (QUALITY_RETURN_MIN_SESSIONS < 1) {
        throw new Error(
          `QUALITY_RETURN_MIN_SESSIONS is ${QUALITY_RETURN_MIN_SESSIONS} · a build week that ` +
            'prescribes no quality at all has not returned the runner to training',
        );
      }
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/Math\.max\(QUALITY_RETURN_MIN_SESSIONS, ramped\)/.test(src)) {
        throw new Error('densityForWeek no longer floors the ramp · it can author a zero-quality build week again');
      }
      // …and the habit that feeds the ramp must be MEASURED, not counted off
      // plan versions, and a measured zero must survive the hand-off.
      if (/JOIN training_plans[\s\S]{0,400}?pw\.type IN \('tempo','threshold','intervals'\)/.test(src)) {
        throw new Error(
          'a quality-habit reader joins training_plans again · that join reaches every plan ' +
            'version the runner has ever had and counts one session once per rebuild',
        );
      }
      if (/recentQualityPerWeek: recentQualityPW > 0 \? recentQualityPW : undefined/.test(src)) {
        throw new Error(
          'a measured zero is being coerced to `undefined` again · densityForWeek reads that as ' +
            'a cold start and answers with FULL quality density, the opposite of Rule 5',
        );
      }
    },
  },
  {
    id: 'PLAN.peak-is-a-phase-not-a-week',
    binds: [
      'lib/plan/goal-tiers.ts#PEAK_HOLD_WEEKS',
      'lib/plan/generate.ts#volumeCurve.hold',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '### Marathon — Beginner',
    claim:
      'The marathon phase row names a PEAK PHASE with a length — "peak (3 wk)" — so a build ' +
      'that touches its target on one week and tapers has not run the phase doctrine ' +
      'describes. `volumeCurve` was a pure geometric climb reaching the peak on the last ' +
      'climbing week. The engine\'s marathon hold must equal the length the row states, and ' +
      'must not be silently carried across to distances whose rows name no peak phase.',
    check({ cite }) {
      const phases = cite.table().cell('Phases', 'Value');
      const m = phases.match(/peak\s*\((\d+)\s*wk\)/i);
      if (!m) {
        throw new Error(
          `the Marathon — Beginner Phases row no longer names a peak phase: "${phases}" · ` +
            'PEAK_HOLD_WEEKS.m is read off that phrase',
        );
      }
      const stated = Number(m[1]);
      if (PEAK_HOLD_WEEKS.m !== stated) {
        throw new Error(`PEAK_HOLD_WEEKS.m is ${PEAK_HOLD_WEEKS.m}, doctrine's marathon peak phase is ${stated} wk`);
      }
      // The ultra takes the FLOOR of its own rows, the same way every other
      // band in this engine is read.
      const ultraPhases = resolveCitation('Research/22-plan-templates.md', '### 50 Mile')
        .table().cell('Phases', 'Value');
      const um = ultraPhases.match(/peak\s*\((\d+)(?:-\d+)?\s*wk\)/i);
      if (!um) {
        throw new Error(`the 50 Mile Phases row no longer names a peak phase: "${ultraPhases}"`);
      }
      if (PEAK_HOLD_WEEKS.ultra !== Number(um[1])) {
        throw new Error(`PEAK_HOLD_WEEKS.ultra is ${PEAK_HOLD_WEEKS.ultra}, the 50 Mile row says ${um[1]} wk`);
      }
      // The distances whose own phase rows name no peak phase hold ZERO. Read
      // out of the doc across all three rungs, not asserted: if any 5K, 10K or
      // half plan ever grows a peak phase, this fails rather than going quiet.
      for (const [cat, label] of [['5k', '5K'], ['10k', '10K'], ['hm', 'Half Marathon']] as const) {
        for (const rung of ['Beginner', 'Intermediate', 'Advanced'] as const) {
          const row = resolveCitation('Research/22-plan-templates.md', `### ${label} — ${rung}`)
            .table().cell('Phases', 'Value');
          if (/\bpeak\b/i.test(row) && PEAK_HOLD_WEEKS[cat] === 0) {
            throw new Error(
              `${label} — ${rung} now names a peak phase ("${row}") and PEAK_HOLD_WEEKS.${cat} is still 0`,
            );
          }
          if (!/\bpeak\b/i.test(row) && PEAK_HOLD_WEEKS[cat] !== 0) {
            throw new Error(
              `PEAK_HOLD_WEEKS.${cat} is ${PEAK_HOLD_WEEKS[cat]} but ${label} — ${rung} names no peak ` +
                `phase ("${row}") · that is the marathon's number carried across`,
            );
          }
        }
      }
      if (!/PEAK_HOLD_WEEKS\[/.test(sourceOf('web-v2/lib/plan/generate.ts'))) {
        throw new Error('volumeCurve does not read PEAK_HOLD_WEEKS · the peak is a single week again');
      }
    },
  },

  {
    id: 'PLAN.medium-long-run',
    binds: [
      'lib/plan/goal-tiers.ts#TierTarget.mlrPeakMi',
      'lib/plan/goal-tiers.ts#MLR_MAX_WEEK_SHARE',
      'lib/plan/goal-tiers.ts#MLR_MIN_MI',
      'lib/plan/generate.ts#layoutWeek.mlr',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### 3. Medium-long run',
    claim:
      'The medium-long run is one of the seven workout categories, with its own purpose, its own ' +
      'duration band and its own frequency row — "1×/wk in marathon and half cycles; optional in ' +
      '5K/10K". The engine had none at any volume for any runner: layoutWeek gave every easy day ' +
      'the same number, so a 61-mile advanced-marathon week was a long run and three identical ' +
      'eight-mile days. So: the distances doctrine PRESCRIBES it for must carry a ceiling and the ' +
      'ones it calls optional must carry none (optional is not prescribed, and inventing one for ' +
      'a 5K plan is the carry-across this lint exists to stop); the marathon ceilings must be the ' +
      'numbers Research/22 publishes in its own MLR rows; the beginner rungs, none of which names ' +
      'an MLR, must be null; the floor below which the engine authors no MLR at all must be the ' +
      'floor of THIS row\'s duration band; and the share of a week it may take must not exceed the ' +
      'share doctrine\'s own sample peak weeks spend on it.',
    check({ cite }) {
      const t = cite.table();
      const freq = t.cell('Frequency', 'Specification');
      const dur = t.cell('Duration', 'Specification');
      if (!/marathon and half/i.test(freq) || !/optional in\s*5K\/10K/i.test(freq)) {
        throw new Error(
          `the medium-long-run frequency row now reads "${freq}" · the engine's per-distance ` +
            'nulls are read off "1×/wk in marathon and half cycles; optional in 5K/10K"',
        );
      }
      // MLR_MIN_MI is the floor of this row's own mile band.
      const miBand = dur.replace(/[–—−]/g, "-").match(/(\d+)-(\d+)\s*mi(?![a-z])/);
      if (!miBand) throw new Error(`the medium-long-run duration row no longer states a mile band: "${dur}"`);
      if (MLR_MIN_MI !== Number(miBand[1])) {
        throw new Error(`MLR_MIN_MI is ${MLR_MIN_MI}, doctrine's medium-long band opens at ${miBand[1]} mi`);
      }
      // PRESCRIBED vs OPTIONAL, per distance.
      for (const cat of ['5k', '10k'] as const) {
        for (const tier of TIERS) {
          if (TIER_TARGETS[cat][tier].mlrPeakMi != null) {
            throw new Error(
              `TIER_TARGETS.${cat}.${tier}.mlrPeakMi is ${TIER_TARGETS[cat][tier].mlrPeakMi} · doctrine ` +
                'calls the MLR OPTIONAL at these distances and no Research/22 5K or 10K row names one',
            );
          }
        }
      }
      for (const cat of ['m', 'hm'] as const) {
        if (!TIERS.some((tier) => TIER_TARGETS[cat][tier].mlrPeakMi != null)) {
          throw new Error(`no ${cat} tier carries an MLR ceiling · doctrine prescribes one 1×/wk in ${cat} cycles`);
        }
      }
      // The marathon ceilings ARE the numbers Research/22 publishes.
      for (const [tier, heading] of [
        ['advanced', '### Marathon — Advanced'],
        ['intermediate', '### Marathon — Intermediate'],
      ] as const) {
        const row = resolveCitation('Research/22-plan-templates.md', heading)
          .table().cell('Key workout types', 'Value');
        const band = row.replace(/[–—−]/g, '-').match(/MLR\s*\((\d+)-(\d+)\s*mi\)/i);
        if (!band) throw new Error(`${heading} Key workout types no longer publishes an MLR band: "${row}"`);
        if (TIER_TARGETS.m[tier].mlrPeakMi !== Number(band[2])) {
          throw new Error(
            `TIER_TARGETS.m.${tier}.mlrPeakMi is ${TIER_TARGETS.m[tier].mlrPeakMi}, doctrine's row says ` +
              `${band[1]}-${band[2]} mi`,
          );
        }
      }
      // Every BEGINNER rung is null, read out of the doc rather than asserted.
      for (const [cat, heading] of [
        ['5k', '### 5K — Beginner'],
        ['10k', '### 10K — Beginner'],
        ['hm', '### Half Marathon — Beginner'],
        ['m', '### Marathon — Beginner'],
      ] as const) {
        const row = resolveCitation('Research/22-plan-templates.md', heading)
          .table().cell('Key workout types', 'Value');
        const namesMlr = /\bMLR\b|medium-long/i.test(row);
        if (!namesMlr && TIER_TARGETS[cat].developing.mlrPeakMi != null) {
          throw new Error(
            `TIER_TARGETS.${cat}.developing.mlrPeakMi is set but ${heading} names no MLR ("${row}")`,
          );
        }
        if (namesMlr && TIER_TARGETS[cat].developing.mlrPeakMi == null) {
          throw new Error(`${heading} now names an MLR ("${row}") and the developing row is still null`);
        }
      }
      // The share bound sits at or under the smallest share doctrine's own
      // sample peak weeks give it. Both numbers come out of each section.
      const sampleShare = (heading: string): number => {
        const sec = resolveCitation('Research/22-plan-templates.md', heading).text();
        const wk = sec.match(/Sample peak week[^)]*~\s*(\d+)\s*mpw/i);
        const mlr = sec.match(/(\d+)\s*mi\s*MLR/i);
        if (!wk || !mlr) {
          throw new Error(`${heading}'s sample peak week no longer publishes both an MLR and a weekly total`);
        }
        return Number(mlr[1]) / Number(wk[1]);
      };
      const shares = [
        '### Marathon — Advanced',
        '### Marathon — Intermediate',
        '### Half Marathon — Advanced',
      ].map(sampleShare);
      atMost(MLR_MAX_WEEK_SHARE, Math.min(...shares) + 1e-9, 'MLR_MAX_WEEK_SHARE vs doctrine sample peak weeks');
      // And the layout actually spends all three.
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      for (const sym of ['tierTarget.mlrPeakMi', 'MLR_MAX_WEEK_SHARE', 'MLR_MIN_MI']) {
        if (!gen.includes(sym)) {
          throw new Error(`layoutWeek does not read ${sym} · the medium-long run is unbounded or absent`);
        }
      }
    },
  },

  // ══ CUTBACK / DOWN WEEKS ══════════════════════════════════════════════════
  {
    id: 'CUTBACK.cadence',
    binds: ['lib/plan/generate.ts#cutbackCadence', 'lib/plan/seed-from-onboarding.ts#buildProgressiveCurve'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Frequency',
    claim:
      'A cutback week comes every third or fourth week of load — three for injury-prone, ' +
      'returning, or late-block runners, four for the higher-mileage experienced. Every ' +
      'cadence the engine uses must be one of the cycles doctrine lists.',
    check({ cite }) {
      const cycles = new Set(cite.table().rows.map((r) => parseBand(r.Cycle)[0]));
      const engineCadences = [
        Number(
          matchLiteral(
            sourceOf('web-v2/lib/plan/generate.ts'),
            /tsbAtStart < -10\) \? (\d+) : (\d+)/,
            'cutbackCadence',
          )[1],
        ),
        Number(
          matchLiteral(
            sourceOf('web-v2/lib/plan/generate.ts'),
            /tsbAtStart < -10\) \? \d+ : (\d+)/,
            'cutbackCadence',
          )[1],
        ),
        Number(
          matchLiteral(
            sourceOf('web-v2/lib/plan/seed-from-onboarding.ts'),
            /const cutback = \(i \+ 1\) % (\d+) === 0;/,
            'onboarding seed cutback cadence',
          )[1],
        ),
      ];
      for (const n of engineCadences) {
        if (!cycles.has(n)) {
          throw new Error(
            `a cutback every ${n} weeks is not a cycle doctrine lists (${[...cycles].sort().join(', ')})`,
          );
        }
      }
    },
  },
  {
    id: 'CUTBACK.depth',
    binds: ['lib/plan/generate.ts#volumeCurve.deload', 'lib/plan/seed-from-onboarding.ts#buildProgressiveCurve'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Depth of Cutback by Mileage Tier',
    claim:
      'A cutback cuts 20-30% off the highest week of the preceding block. Shallower and the ' +
      'fatigue does not dissipate; deeper and it stops being a cutback and starts being a ' +
      'rest week, which doctrine explicitly says it is not.',
    check({ cite, exempt }) {
      const t = cite.table();
      const lows = t.rows.map((r) => parseBand(r['% reduction'])[0]);
      const highs = t.rows.map((r) => parseBand(r['% reduction'])[1]);
      const band: [number, number] = [Math.min(...lows) / 100, Math.max(...highs) / 100];
      const sites: [string, string, RegExp][] = [
        ['web-v2/lib/plan/generate.ts', 'volumeCurve deload', /const deload = Math\.round\(lastClimb \* (\d*\.?\d+)\)/],
        [
          'web-v2/lib/plan/seed-from-onboarding.ts',
          'onboarding-seed cutback',
          /volumeMi\.push\(round1\(current \* (\d*\.?\d+)\)\);/,
        ],
      ];
      for (const [file, binding, re] of sites) {
        const factor = Number(matchLiteral(sourceOf(file), re, binding)[1]);
        const cut = Math.round((1 - factor) * 1000) / 1000;
        if (cut < band[0] && exempt(binding)) continue;
        within(cut, band, `${binding} · cuts ${(cut * 100).toFixed(0)}%`);
      }
    },
    exempt: {
      'onboarding-seed cutback':
        'KNOWN VIOLATION (found seeding this registry, 2026-08-17). ' +
        'seed-from-onboarding.ts:197 cuts to 0.82 of the prior week — an 18% reduction, below ' +
        "doctrine's 20% floor and shallower than generate.ts's own 0.80 (which was raised from " +
        '0.85 for exactly this reason, see RC2-4 at generate.ts:794). Not fixed here because ' +
        'this gate is not the place to change generated plans; the engine audit owns it.',
    },
  },
  {
    id: 'CUTBACK.requested-depth',
    binds: ['lib/plan/replan-scenarios.ts#REQUESTED_CUTBACK_WEEK_CUT'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Depth of Cutback by Mileage Tier',
    claim:
      'A cutback the RUNNER asks for is the same cutback the generator schedules, so its depth ' +
      'obeys the same table. One requested depth has to be legal at every mileage tier a runner ' +
      'of this app can be in, so it sits in the INTERSECTION of the tiers\' reduction bands, not ' +
      'merely inside one of them.',
    check({ cite }) {
      const t = cite.table();
      const lows = t.rows.map((r) => parseBand(r['% reduction'])[0]);
      const highs = t.rows.map((r) => parseBand(r['% reduction'])[1]);
      // The intersection · legal at 20-40 mpw AND at 80+, not just at one of them.
      const intersection: [number, number] = [Math.max(...lows) / 100, Math.min(...highs) / 100];
      if (!(intersection[0] <= intersection[1])) {
        throw new Error(
          'the tiers\' reduction bands no longer overlap · a single requested depth cannot be ' +
            'legal for every runner, so the engine needs a tier dimension it does not have',
        );
      }
      const engine = Number(
        matchLiteral(
          sourceOf('web-v2/lib/plan/replan-scenarios.ts'),
          /export const REQUESTED_CUTBACK_WEEK_CUT = (\d*\.?\d+);/,
          'REQUESTED_CUTBACK_WEEK_CUT',
        )[1],
      );
      within(engine, intersection, `requested cutback · cuts ${(engine * 100).toFixed(0)}%`);
    },
  },
  {
    id: 'CUTBACK.requested-long-run-band',
    binds: ['lib/plan/replan-scenarios.ts#REQUESTED_CUTBACK_LONG_CUT_BAND'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Depth of Cutback by Mileage Tier',
    claim:
      'The same table states the long run\'s own reduction separately from the week\'s, in its ' +
      'Notes column, and every tier names a figure. The engine picks a depth per plan rather ' +
      'than a fixed one (the following week\'s long is not moving, so too deep a cut turns into ' +
      'a week-over-week jump), and the band it picks from is exactly the span of the figures ' +
      'doctrine publishes.',
    check({ cite }) {
      const t = cite.table();
      // Read the long-run figures out of the Notes column · "Drop the long run by 20-30%",
      // "Long run -25%", "Long run -25-30%", "Long run -30%". Never hand-copied.
      const pcts: number[] = [];
      for (const r of t.rows) {
        const note = String(r['Notes'] ?? '');
        const m = note.match(/long run[^.]*?((?:\d+\s*[–-]\s*)?\d+)\s*%/i);
        if (!m) continue;
        for (const n of m[1].split(/\s*[–-]\s*/)) {
          const v = Number(n);
          if (Number.isFinite(v)) pcts.push(v);
        }
      }
      if (pcts.length < 2) {
        throw new Error(
          'Research/00b\'s cutback table no longer states a long-run reduction in its Notes ' +
            'column · re-read it before this band is justified',
        );
      }
      const doctrineBand: [number, number] = [Math.min(...pcts) / 100, Math.max(...pcts) / 100];
      const src = sourceOf('web-v2/lib/plan/replan-scenarios.ts');
      const engine = matchLiteral(
        src,
        /export const REQUESTED_CUTBACK_LONG_CUT_BAND: readonly \[number, number\] = \[(\d*\.?\d+), (\d*\.?\d+)\];/,
        'REQUESTED_CUTBACK_LONG_CUT_BAND',
      );
      const lo = Number(engine[1]);
      const hi = Number(engine[2]);
      if (lo !== doctrineBand[0] || hi !== doctrineBand[1]) {
        throw new Error(
          `REQUESTED_CUTBACK_LONG_CUT_BAND is [${lo}, ${hi}] · doctrine's own long-run figures ` +
            `span [${doctrineBand[0]}, ${doctrineBand[1]}]. The band is read off the table, not chosen.`,
        );
      }
    },
  },
  {
    id: 'CUTBACK.long-run-depth',
    binds: ['lib/plan/generate.ts#CUTBACK_LONG_DROP'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Depth of Cutback by Mileage Tier',
    claim:
      'The cutback week\'s LONG RUN drops by the figure the table\'s Notes column states for the ' +
      'runner\'s peak-load tier — 20-30% at 20-40 mpw, 25% at 40-60, 25-30% at 60-80, 30% at 80+. ' +
      'The engine\'s per-tier drop table aligns row-for-row with the doc\'s table (boundaries read ' +
      'from the doc\'s own "Peak-load mpw" column) and each drop sits inside its row\'s band.',
    check({ cite }) {
      const rows = cite.table().rows;
      if (CUTBACK_LONG_DROP.length !== rows.length) {
        throw new Error(
          `CUTBACK_LONG_DROP has ${CUTBACK_LONG_DROP.length} tiers · doctrine's table has ` +
            `${rows.length} rows. The engine table mirrors the doc's, row for row.`,
        );
      }
      rows.forEach((r, i) => {
        const mpwCell = String(r['Peak-load mpw'] ?? '');
        const [, mpwHi] = parseBand(mpwCell);
        const openEnded = /\+/.test(mpwCell);
        const engine = CUTBACK_LONG_DROP[i];
        const expectedMax = openEnded ? Infinity : mpwHi;
        if (engine.maxMpw !== expectedMax) {
          throw new Error(
            `CUTBACK_LONG_DROP row ${i} caps at ${engine.maxMpw} mpw · doctrine's row is ` +
              `"${mpwCell}" (upper bound ${openEnded ? 'open' : mpwHi}). Boundaries come off the table.`,
          );
        }
        const note = String(r['Notes'] ?? '');
        const m = note.match(/long run[^.]*?((?:\d+\s*[–-]\s*)?\d+)\s*%/i);
        if (!m) {
          throw new Error(
            `Research/00b's cutback row "${mpwCell}" no longer states a long-run reduction in ` +
              'its Notes column · re-read it before this tier\'s drop is justified',
          );
        }
        within(engine.drop * 100, parseBand(m[1]), `cutback long-run drop · tier "${mpwCell}"`);
      });
    },
  },
  {
    id: 'MIDRACE.resume-quality-light',
    binds: ['lib/plan/generate.ts#MIDRACE_RESUME_RX'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.3 Cruise intervals (Daniels)',
    claim:
      'The first quality day back after an embedded race\'s recovery window is a cruise-interval ' +
      'set at the light end of §5.3: rep count and rep distance inside the doc\'s own Structure ' +
      'row ("3-6 x 1 mi with 1 min jog, or 2-4 x 2 mi with 2 min jog"), recovery at least the ' +
      'doc\'s 1-min-jog-per-mile rule, and total at-pace volume STRICTLY BELOW the doc\'s ' +
      'full-session "Total volume at pace" floor — Research/00b\'s reverse taper reintroduces ' +
      'short tempo before a full quality session, so the re-entry must be smaller than the ' +
      'smallest full cruise session doctrine describes.',
    check({ cite }) {
      const parsed = parsePrescription(MIDRACE_RESUME_RX);
      if (!parsed || parsed.restS == null) {
        throw new Error(
          `MIDRACE_RESUME_RX ("${MIDRACE_RESUME_RX}") does not parse as a rep prescription · ` +
            'an unparseable resume day is exactly the unprescribed-slot bug this constant fixes',
        );
      }
      const structure = cite.table().cell('Structure', 'Prescription');
      const alts = [...structure.replace(/[–—]/g, '-').matchAll(/(\d+)\s*-\s*(\d+)\s*×\s*(\d+(?:\.\d+)?)\s*mi/g)];
      if (alts.length === 0) {
        throw new Error(`no "N-M × D mi" structure found in doctrine cell "${structure}"`);
      }
      const countBand: [number, number] = [
        Math.min(...alts.map((a) => Number(a[1]))),
        Math.max(...alts.map((a) => Number(a[2]))),
      ];
      const distBand: [number, number] = [
        Math.min(...alts.map((a) => Number(a[3]))),
        Math.max(...alts.map((a) => Number(a[3]))),
      ];
      within(parsed.reps, countBand, 'resume-day cruise rep count');
      within(parsed.repDistanceMi, distBand, 'resume-day cruise rep distance (mi)');
      // "Recovery | 1 min jog per mile of work segment" · generous means ≥.
      if (parsed.restS < 60 * parsed.repDistanceMi) {
        throw new Error(
          `resume-day jog ${parsed.restS}s is under doctrine's 1 min per mile of work ` +
            `(${Math.round(60 * parsed.repDistanceMi)}s for a ${parsed.repDistanceMi} mi rep)`,
        );
      }
      const [fullLo] = parseBand(cite.table().cell('Total volume at pace', 'Prescription'));
      const atPaceMi = parsed.reps * parsed.repDistanceMi;
      if (!(atPaceMi < fullLo)) {
        throw new Error(
          `resume-day at-pace volume ${atPaceMi} mi is not below the §5.3 full-session floor ` +
            `${fullLo} mi · a re-entry at full dose is not a re-entry`,
        );
      }
    },
  },
  {
    id: 'CONVENTION.replan-mirrors-the-validator',
    binds: [
      'lib/plan/replan-scenarios.ts#REENTRY_ACWR_CEILING',
      'lib/plan/replan-scenarios.ts#REENTRY_ACWR_CHRONIC_WEEKS',
      'lib/plan/replan-scenarios.ts#REENTRY_SMALL_STEP_MI',
      'lib/plan/replan-scenarios.ts#LONG_RUN_WOW_MAX_PCT',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### ACWR risk zones',
    claim:
      'CONVENTION, not physiology · these four numbers are not a second reading of doctrine. ' +
      'The "Change the plan" sheet has to PREDICT what validateComposedPlan will say about a ' +
      'shape it has not written yet, and the only honest way to do that is to compute against ' +
      'the validator\'s own numbers. A travel gap creates zero weeks; the climb back has to be ' +
      'ramped against the same acute-to-chronic line the validator judges it by, or the sheet ' +
      'shows a runner a change the boundary then rolls back. So the claim is a MIRROR CHECK: ' +
      'every mirrored constant must still equal the one it mirrors in lib/plan/validate.ts. ' +
      'The physiology itself is claimed by RAMP.acute-chronic-ratio-red-line, which reads the ' +
      'ratio and the window out of this same doc.',
    check() {
      const validator = sourceOf('web-v2/lib/plan/validate.ts');
      const sheet = sourceOf('web-v2/lib/plan/replan-scenarios.ts');
      const pairs: Array<[string, RegExp, RegExp]> = [
        [
          'ACWR ceiling',
          /const ACWR_HIGH_RISK = (\d*\.?\d+);/,
          /export const REENTRY_ACWR_CEILING = (\d*\.?\d+);/,
        ],
        [
          'ACWR chronic window',
          /const ACWR_CHRONIC_WEEKS = (\d+);/,
          /export const REENTRY_ACWR_CHRONIC_WEEKS = (\d+);/,
        ],
        [
          'small-absolute step exemption',
          /if \(!\(prev > 0\) \|\| curr - prev <= (\d+)\) continue;/,
          /export const REENTRY_SMALL_STEP_MI = (\d+);/,
        ],
      ];
      for (const [what, vRe, sRe] of pairs) {
        const a = Number(matchLiteral(validator, vRe, `validate.ts ${what}`)[1]);
        const b = Number(matchLiteral(sheet, sRe, `replan-scenarios.ts ${what}`)[1]);
        if (a !== b) {
          throw new Error(
            `the ${what} is ${a} in validate.ts and ${b} in replan-scenarios.ts · the sheet ` +
              'would propose changes the mutation boundary refuses',
          );
        }
      }
      // The long-run week-over-week ceiling is one number repeated across every
      // distance row, so the mirror is against the whole column rather than a
      // single literal · a per-distance split would make one mirrored value wrong.
      const wow = [...validator.matchAll(/longRunWoWMaxPct: (\d+)/g)].map((m) => Number(m[1]));
      if (wow.length === 0) throw new Error('validate.ts no longer declares longRunWoWMaxPct');
      const distinct = [...new Set(wow)];
      if (distinct.length !== 1) {
        throw new Error(
          `validate.ts now carries ${distinct.length} different longRunWoWMaxPct values ` +
            `(${distinct.join(', ')}) · the sheet mirrors a single number and can no longer do so`,
        );
      }
      const mirrored = Number(
        matchLiteral(sheet, /export const LONG_RUN_WOW_MAX_PCT = (\d+);/, 'LONG_RUN_WOW_MAX_PCT')[1],
      );
      if (mirrored !== distinct[0]) {
        throw new Error(
          `LONG_RUN_WOW_MAX_PCT is ${mirrored} · validate.ts's ceiling is ${distinct[0]}`,
        );
      }
    },
  },

  // ══ LONG RUN ══════════════════════════════════════════════════════════════
  {
    id: 'LONGRUN.share-is-tier-and-distance-dependent',
    binds: ['lib/plan/goal-tiers.ts#TIER_TARGETS.longRunShare'],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 4. Marathon Plans',
    claim:
      'TWO DOCTRINE SOURCES DISAGREE HERE, AND THE OWNER RULED ON THE RECONCILIATION ' +
      '(David, 2026-08-17). Research/00a §"Volume progression rules" caps the long run at ' +
      '25-30% of the week. Research/22\'s own sample peak weeks run far above that at the ' +
      'low-volume end — a Marathon-Beginner long is 20 miles inside a 37-mile week — and ' +
      'settle into 00a\'s band as volume rises. The ruling: "a marathon beginner\'s long run ' +
      'legitimately IS a bigger share of a small week; a 70-mpw runner\'s isn\'t." So the ' +
      'share is a function of tier and distance, read off Research/22\'s actual sample weeks; ' +
      '00a\'s 25-30% governs the higher-volume tiers where the sample plans already agree with ' +
      'it; and the safety bound for the low-volume, slow-runner case is 00a\'s OWN absolute-time ' +
      'clause, checked by LONGRUN.absolute-time-cap. This claim holds the reconciliation to its ' +
      'terms: every share must be under the doctrine row it came from, the shares must DESCEND ' +
      'as the tier rises (that is the whole ruling), and the advanced tiers must land inside ' +
      "00a's band.",
    check({ cite }) {
      // The engine's tiers map onto Research/22's named cohorts.
      const TIER_ROW: Record<string, string> = {
        developing: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
      };
      const DOC_SECTION: Partial<Record<DistCategory, string>> = {
        '5k': '5K', '10k': '10K', hm: 'Half Marathon', m: 'Marathon',
      };
      const doc = cite.doc;
      const all = sourceOf(doc).split('\n');
      /** peak weekly + peak long bands off a "### <Distance> — <Cohort>" block. */
      const rowBands = (distance: string, cohort: string): { weekly: [number, number]; long: [number, number] } => {
        const at = all.findIndex((l) => l.startsWith(`### ${distance} —`) && l.includes(cohort));
        if (at < 0) throw new Error(`DOCTRINE · no "### ${distance} — ${cohort}" section in ${doc}`);
        const block = all.slice(at, at + 20);
        const cell = (label: string) => {
          const line = block.find((l) => l.includes(`| ${label} |`));
          if (!line) throw new Error(`DOCTRINE · no "${label}" row under ${distance} — ${cohort} in ${doc}`);
          return line.split('|')[2];
        };
        return { weekly: parseBand(cell('Peak weekly volume')), long: parseBand(cell('Peak long run')) };
      };

      const [ceilLo, ceilHi] = (() => {
        const spec = resolveShareCap();
        return spec;
      })();

      for (const cat of CATS) {
        const section = DOC_SECTION[cat];
        // Ultra rows map to race DISTANCES, not experience tiers, and the
        // back-to-back long option makes a single-run share non-comparable.
        if (!section) continue;
        let prev = Infinity;
        for (const tier of ['developing', 'intermediate', 'advanced'] as const) {
          const share = TIER_TARGETS[cat][tier].longRunShare;
          const { weekly, long } = rowBands(section, TIER_ROW[tier]);
          // Read off the doc: the largest share the row can express — its
          // biggest long inside its smallest week. Research/22 prints a literal
          // sample peak week for several of these cohorts (HM-Advanced is 16 mi
          // in 63, Marathon-Beginner 20 in 37) and every one of them falls
          // inside this bound, so it accommodates the sample weeks the ruling
          // says to derive from while still catching an invented number.
          const docShare = long[1] / weekly[0];
          if (share > docShare + 0.01) {
            throw new Error(
              `TIER_TARGETS.${cat}.${tier}.longRunShare is ${share} · Research/22 ` +
                `§"${section} — ${TIER_ROW[tier]}" implies ${docShare.toFixed(2)}`,
            );
          }
          // THE RULING: the share must fall as the tier rises.
          if (share > prev) {
            throw new Error(
              `TIER_TARGETS.${cat}: ${tier} takes a LARGER long-run share (${share}) than the ` +
                `tier below it (${prev}) · the ruling is that the share shrinks as volume grows`,
            );
          }
          prev = share;
          // And the top tiers land inside 00a's band, where the sample plans agree with it.
          if (tier === 'advanced' && share > ceilHi + 0.005) {
            throw new Error(
              `TIER_TARGETS.${cat}.advanced.longRunShare is ${share} · at this volume the sample ` +
                `plans agree with Research/00a's ${ceilLo * 100}-${ceilHi * 100}% cap`,
            );
          }
        }
        // `elite` has no Research/22 row · hold it to the advanced share.
        if (TIER_TARGETS[cat].elite.longRunShare > TIER_TARGETS[cat].advanced.longRunShare + 0.01) {
          throw new Error(`TIER_TARGETS.${cat}.elite.longRunShare exceeds the advanced tier's · elite trains more volume, not a bigger share`);
        }
      }
    },
  },
  {
    id: 'LONGRUN.recovery-share',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_LONG_PCT'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'A recovery week is still a training week: its long run obeys the same share ceiling. ' +
      'No recovery profile may schedule a peak-sized long.',
    check({ cite }) {
      const share = parseBand(cite.table().cell('Long-run cap', 'Specification'))[1] / 100;
      for (const cat of CATS) atMost(RECOVERY_LONG_PCT[cat], share, `RECOVERY_LONG_PCT.${cat}`);
    },
  },
  {
    id: 'VOLUME.tier-peak-bands',
    binds: ['lib/plan/goal-tiers.ts#TIER_TARGETS.peakWeeklyMileageBand'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume table',
    claim:
      'Peak weekly volume by race distance has a doctrine range spanning beginner through ' +
      'elite. Every tier band the engine plans to must overlap that range — a tier target ' +
      'outside it is either prescribing volume no cohort trains at or holding a runner below ' +
      'the floor for the distance.',
    check({ cite }) {
      const t = cite.table();
      const docRow: Record<DistCategory, string> = {
        '5k': '5K',
        '10k': '10K',
        hm: 'Half-marathon',
        m: 'Marathon',
        ultra: '50K',
      };
      for (const cat of CATS) {
        const row = t.row(docRow[cat]);
        const cols = t.headers.slice(1);
        const lo = Math.min(...cols.map((c) => parseBand(row[c])[0]));
        const hi = Math.max(...cols.map((c) => parseBand(row[c])[1]));
        for (const tier of TIERS) {
          const [tLo, tHi] = TIER_TARGETS[cat][tier].peakWeeklyMileageBand;
          if (tHi < lo || tLo > hi) {
            throw new Error(
              `TIER_TARGETS.${cat}.${tier}.peakWeeklyMileageBand [${tLo}, ${tHi}] does not overlap ` +
                `the doctrine volume range for ${docRow[cat]} (${lo}-${hi} mi/wk)`,
            );
          }
        }
      }
    },
  },
  {
    id: 'VOLUME.band-floor-is-what-plans-are-built-to',
    binds: [
      'lib/plan/goal-tiers.ts#TIER_TARGETS.peakWeeklyMileageBand',
      'lib/plan/goal-tiers.ts#TIER_TARGETS.peakLongMiBand',
      'lib/plan/generate.ts#volumeCurve.peakTarget',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 4. Marathon Plans',
    claim:
      'volumeCurve builds to peakWeeklyMileageBand[0], so a band FLOOR set below the doctrine ' +
      "row is not a conservative choice — it is the number the plan reaches. Equally, a band " +
      'CEILING resting exactly on the doctrine row\'s floor caps the peak long at the least ' +
      'doctrine allows. Every tier band must therefore contain its Research/22 row rather than ' +
      'sit under it. This is the shape XTIER-1 fixed for one row in June without sweeping the ' +
      'class, which is how a sub-3 marathoner came to be built to 55 mi/wk against a 65-90 row.',
    check({ cite }) {
      const TIER_ROW: Record<string, string> = {
        developing: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
      };
      const DOC_SECTION: Partial<Record<DistCategory, string>> = {
        '5k': '5K', '10k': '10K', hm: 'Half Marathon', m: 'Marathon',
      };
      const all = sourceOf(cite.doc).split('\n');
      const rowBands = (distance: string, cohort: string) => {
        const at = all.findIndex((l) => l.startsWith(`### ${distance} —`) && l.includes(cohort));
        if (at < 0) throw new Error(`DOCTRINE · no "### ${distance} — ${cohort}" section in ${cite.doc}`);
        const block = all.slice(at, at + 20);
        const cell = (label: string) => {
          const line = block.find((l) => l.includes(`| ${label} |`));
          if (!line) throw new Error(`DOCTRINE · no "${label}" row under ${distance} — ${cohort}`);
          return line.split('|')[2];
        };
        return { weekly: parseBand(cell('Peak weekly volume')), long: parseBand(cell('Peak long run')) };
      };
      for (const cat of CATS) {
        const section = DOC_SECTION[cat];
        if (!section) continue;   // ultra rows are distance-keyed · see VOLUME.tier-peak-bands
        for (const tier of ['developing', 'intermediate', 'advanced'] as const) {
          const { weekly, long } = rowBands(section, TIER_ROW[tier]);
          const [wLo] = TIER_TARGETS[cat][tier].peakWeeklyMileageBand;
          const [, lHi] = TIER_TARGETS[cat][tier].peakLongMiBand;
          if (wLo < weekly[0]) {
            throw new Error(
              `TIER_TARGETS.${cat}.${tier}.peakWeeklyMileageBand floor is ${wLo} · plans are BUILT ` +
                `to this number and Research/22 §"${section} — ${TIER_ROW[tier]}" says ${weekly[0]}-${weekly[1]}`,
            );
          }
          if (lHi < long[0]) {
            throw new Error(
              `TIER_TARGETS.${cat}.${tier}.peakLongMiBand ceiling is ${lHi}, at or under the ` +
                `doctrine row's FLOOR of ${long[0]} · the XTIER-1 shape`,
            );
          }
        }
      }
    },
  },

  // ══ PLAN TEMPLATE STRUCTURE ═══════════════════════════════════════════════
  /**
   * 2026-08-18 · doctrine sweep, "not yet seeded" item. Every PLAN_TEMPLATES
   * row is transcribed from a Research/22 distance × level section (the file
   * header says so), but each row's `source` field cites a book (Higdon,
   * Pfitzinger, Daniels…) instead of the Research/ passage the gate can
   * actually open. Of the row's seven fields, `templateFor` / `isBaseBuildingPlan`
   * only ever READ `qualityCharacter` at runtime — durationWeeks, daysPerWeek,
   * keyWorkouts and `source` are not consumed anywhere in the engine today, so
   * this claim does not pretend they are load-bearing. peakWeeklyMi/peakLongMi
   * are likewise unread, but they are still numbers the code carries as if
   * they were doctrine, so they get the same drift check as everything else
   * that is transcribed from a Research/ table, at no extra cost.
   */
  {
    id: 'PLAN.ultra-authorship-is-refused',
    binds: [
      'lib/plan/supported-distances.ts#planAuthorshipUnsupported',
      'lib/plan/supported-distances.ts#ULTRA_UNSUPPORTED_REASON',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 5. Ultramarathon Plans',
    claim:
      'Faff does not currently write ultra plans, and it says so rather than substituting a ' +
      'shorter one. This is a PRODUCT decision, not a doctrine one — Research/22 §5 is intact ' +
      'and keeps its four ultra sections, which is why the anchor is checked here: the doctrine ' +
      'is what re-opening authorship would be built from. What doctrine DOES establish is that ' +
      'those sections are keyed by DISTANCE (50K / 50 Mile / 100K / 100 Mile), while ' +
      'PLAN_TEMPLATES keys its four ultra rows by EXPERIENCE and copies one doctrine distance ' +
      'into each — so the engine grades a first-time 100-miler "beginner" and hands them a 50K ' +
      'plan. Refusing out loud is the honest answer to an axis the engine does not have; ' +
      'quietly capping an ultra at the marathon model is the defect this codebase has already ' +
      'paid for twice (raceDistanceCategory(null) returning hm, distanceCategoryOf(0) ' +
      'returning 5k).',
    check({ cite }) {
      const gate = sourceOf('web-v2/lib/plan/supported-distances.ts');
      matchLiteral(gate, /export function planAuthorshipUnsupported/, 'ultra authorship gate');
      const reason = matchLiteral(
        gate,
        /export const ULTRA_UNSUPPORTED_REASON =\s*\n?\s*"([^"]+)"/,
        'ultra refusal reason',
      )[1];
      // The runner is told plainly. Not a silent null, not a shrug.
      if (!/ultra/i.test(reason)) {
        throw new Error(
          `the ultra refusal reason does not mention the ultra ("${reason}") · the runner has to ` +
            'be told what Faff declined and why, or the refusal reads as a bug',
        );
      }

      // Every authorship entry point refuses. A gate one caller skips is not a
      // gate — the 2026-07-07 audit found exactly that shape, where the race
      // path refused and the no-race goal path did not.
      const ENTRY: Array<[string, string]> = [
        ['web-v2/lib/plan/generate.ts', 'the race path and the no-race goal path'],
        ['web-v2/lib/plan/sim-inputs.ts', 'the simulator'],
      ];
      for (const [file, what] of ENTRY) {
        if (!/planAuthorshipUnsupported\(/.test(sourceOf(file))) {
          throw new Error(`${what} (${file}) no longer consults planAuthorshipUnsupported`);
        }
      }

      // And nobody re-inlines the string, which is how three accounts of one
      // refusal start.
      for (const [file] of ENTRY) {
        if (/Ultra plans aren't built yet/.test(stripComments(sourceOf(file)))) {
          throw new Error(
            `${file} inlines the ultra refusal text · it must read ULTRA_UNSUPPORTED_REASON so ` +
              'the three entry points cannot drift into three different explanations',
          );
        }
      }

      // The doctrine is untouched · §5 still carries the four DISTANCE-keyed
      // subsections that re-opening authorship would have to be built from,
      // and it is their existence — four distances, no cohorts — that makes
      // PLAN_TEMPLATES' experience keying provably the wrong axis rather than
      // merely an odd choice. Read from the file rather than `cite.text()`:
      // the resolver ends a section at the next heading of ANY level, so §5's
      // own text stops at the first `###` subsection.
      const lines = sourceOf('Research/22-plan-templates.md').split('\n');
      const start = lines.indexOf(cite.section[0]);
      let stop = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        if (/^## /.test(lines[i])) { stop = i; break; }
      }
      const subs = lines.slice(start, stop).filter((l) => /^### /.test(l));
      for (const d of ['50K', '50 Mile', '100K', '100 Mile']) {
        if (!subs.some((l) => l.includes(d))) {
          throw new Error(
            `Research/22 §5 no longer carries a "${d}" subsection · the ultra doctrine this ` +
              'refusal defers to is being edited away rather than left intact for when ' +
              'authorship returns',
          );
        }
      }
      if (subs.some((l) => /beginner|intermediate|advanced/i.test(l))) {
        throw new Error(
          'Research/22 §5 has grown experience-keyed ultra subsections · if doctrine now ' +
            'publishes ultra plans by cohort, PLAN_TEMPLATES\' ultra rows may finally be ' +
            'well-formed and this refusal should be re-argued rather than left standing',
        );
      }
    },
  },

  {
    id: 'TEMPLATE.recovery-day-after-long-matches-doctrine',
    binds: [
      'lib/plan/plan-templates.ts#RECOVERY_DAY_AFTER_LONG_MI',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 4. Marathon Plans',
    claim:
      'The day after the long run is sized from the tier\'s OWN sample-week cell, never from ' +
      'Research/00a §1\'s generic 20-45 min recovery band. Every entry in ' +
      'RECOVERY_DAY_AFTER_LONG_MI must equal the miles stated in that tier\'s sample peak week ' +
      'on the day following its long run, and a tier whose cell prescribes no run (Marathon ' +
      'Intermediate reads "Rest", Beginner "XT or rest") must carry NO entry — the caller then ' +
      'keeps the generic band, which is correct for a runner doctrine tells to rest.',
    check() {
      const doc = 'Research/22-plan-templates.md';
      const all = sourceOf(doc).split('\n');
      const DOC_DISTANCE: Record<string, string> = { hm: 'Half Marathon', m: 'Marathon' };
      const COHORT: Record<string, string> = {
        beginner: 'Beginner', intermediate: 'Intermediate',
        advanced: 'Advanced', advanced_plus: 'Advanced',
      };

      /** The sample-week row for a tier, as seven trimmed cells Mon..Sun. */
      const sampleWeek = (distance: string, cohort: string): string[] => {
        // Exact-prefix match · "Marathon" is a substring of "Half Marathon",
        // so `.includes` silently reads the wrong section (the sibling claim
        // was caught by exactly that on its first run).
        const at = all.findIndex((l) => l.startsWith(`### ${distance} —`) && l.includes(cohort));
        if (at < 0) throw new Error(`DOCTRINE · no "### ${distance} — ${cohort}" in ${doc}`);
        const block = all.slice(at, at + 30);
        const hdr = block.findIndex((l) => l.replace(/\s/g, '').startsWith('|Mon|Tue|Wed|Thu|Fri|Sat|Sun|'));
        if (hdr < 0) throw new Error(`DOCTRINE · no Mon..Sun sample week under ${distance} — ${cohort}`);
        const row = block[hdr + 2];
        if (!row) throw new Error(`DOCTRINE · sample week under ${distance} — ${cohort} has no data row`);
        const cells = row.split('|').slice(1, 8).map((c) => c.trim());
        if (cells.length !== 7) throw new Error(`DOCTRINE · sample week under ${distance} — ${cohort} is not 7 cells`);
        return cells;
      };

      /** Leading whole/decimal mileage in a cell, or null when it states none. */
      const milesIn = (cell: string): number | null => {
        const m = cell.match(/(\d+(?:\.\d+)?)\s*mi\b/);
        return m ? Number(m[1]) : null;
      };

      for (const [cat, byLevel] of Object.entries(RECOVERY_DAY_AFTER_LONG_MI)) {
        const distance = DOC_DISTANCE[cat];
        if (!distance) {
          throw new Error(
            `DOCTRINE · RECOVERY_DAY_AFTER_LONG_MI has a '${cat}' entry with no Research/22 ` +
            'sample week to read it out of. Add the mapping or drop the entry.',
          );
        }
        for (const [level, engineMi] of Object.entries(byLevel ?? {})) {
          const cells = sampleWeek(distance, COHORT[level]);
          // The cell must genuinely BE the day after the long run: these tables
          // run Mon..Sun, so this only holds when the long run is on Sunday.
          const sunday = cells[6];
          if (!/\bLR\b|long run/i.test(sunday)) {
            throw new Error(
              `DOCTRINE · ${distance} — ${COHORT[level]}'s sample week does not put its long ` +
              `run on Sunday ("${sunday}"), so its Monday cell is not the day after it. ` +
              'That tier must not carry an entry.',
            );
          }
          const docMi = milesIn(cells[0]);
          if (docMi == null) {
            throw new Error(
              `DOCTRINE · ${distance} — ${COHORT[level]} reads "${cells[0]}" on the day after ` +
              `the long run — no distance — but the engine carries ${engineMi}. A tier doctrine ` +
              'tells to rest must have no entry.',
            );
          }
          if (Math.abs(docMi - (engineMi as number)) > 1e-9) {
            throw new Error(
              `DOCTRINE · ${distance} — ${COHORT[level]} reads ${docMi} mi on the day after the ` +
              `long run ("${cells[0]}"); the engine carries ${engineMi}.`,
            );
          }
        }
      }

      // The negative half · a tier whose cell prescribes rest must be ABSENT,
      // not present-with-a-guess. This is what stops the table quietly growing
      // a number doctrine never published.
      for (const level of ['beginner', 'intermediate'] as const) {
        if ((RECOVERY_DAY_AFTER_LONG_MI.m ?? {})[level] != null) {
          throw new Error(
            `DOCTRINE · Marathon — ${COHORT[level]} prescribes rest the day after the long run; ` +
            'the engine must carry no entry for it.',
          );
        }
      }
    },
  },
  {
    id: 'TEMPLATE.quality-character-and-volume-match-doctrine',
    binds: [
      'lib/plan/plan-templates.ts#PLAN_TEMPLATES.qualityCharacter',
      'lib/plan/plan-templates.ts#PLAN_TEMPLATES.peakWeeklyMi',
      'lib/plan/plan-templates.ts#PLAN_TEMPLATES.peakLongMi',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 4. Marathon Plans',
    claim:
      '`qualityCharacter` is the one field `isBaseBuildingPlan` actually gates on — whether a ' +
      'runner gets structured interval/rep work at all — so it is the doctrine boundary the ' +
      'code is acting on. A `base_building` row must draw from a Research/22 "Key workout ' +
      'types" cell with no interval/rep notation; any other row must draw from a cell that has ' +
      'it. peakWeeklyMi/peakLongMi must still overlap their doctrine row so the table cannot ' +
      'silently drift from the research it was built from even while those two fields sit dormant.',
    check() {
      const doc = 'Research/22-plan-templates.md';
      const DOC_DISTANCE: Record<'5k' | '10k' | 'hm' | 'm', string> = {
        '5k': '5K', '10k': '10K', hm: 'Half Marathon', m: 'Marathon',
      };
      const COHORT: Record<'beginner' | 'intermediate' | 'advanced', string> = {
        beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
      };
      const all = sourceOf(doc).split('\n');
      // Structured reps show up as "I reps"/"R reps", "R 200s"/"I 1000-1600 m"
      // (a bare I/R zone letter directly against a number), or "×" multiplication
      // notation (e.g. "3-5×1 mi", "5×1000 m") — every doctrine cell that
      // prescribes intervals uses at least one of these; every base-building
      // cell (E runs, strides, fartlek, optional tempo/MP) uses none.
      const REP_NOTATION = /\bI\s+reps\b|\bR\s+reps\b|\bR\s+\d|\bI\s+\d|×/;
      const section = (distance: string, cohort: string) => {
        // Exact-prefix match, not `.includes` · "Marathon" is a substring of
        // "Half Marathon", so an includes-based search silently reads the HALF
        // marathon's row for every Marathon lookup (same shape as the lint's
        // "distance table read at a fixed distance" check — caught here on
        // first run, when `m/beginner`'s [30,35] mi/wk didn't overlap the
        // Half-Marathon-Beginner row's 22-28 it was actually being matched to).
        const at = all.findIndex((l) => l.startsWith(`### ${distance} —`) && l.includes(cohort));
        if (at < 0) throw new Error(`DOCTRINE · no "### ${distance} — ${cohort}" section in ${doc}`);
        const block = all.slice(at, at + 20);
        const cell = (label: string) => {
          const line = block.find((l) => l.includes(`| ${label} |`));
          if (!line) throw new Error(`DOCTRINE · no "${label}" row under ${distance} — ${cohort} in ${doc}`);
          return line.split('|')[2].trim();
        };
        return {
          keyWorkouts: cell('Key workout types'),
          weekly: parseBand(cell('Peak weekly volume')),
          long: parseBand(cell('Peak long run')),
        };
      };
      // ULTRA-OUT-1 (2026-08-19) · 'ultra' IS EXCLUDED, AND THIS IS THE
      // STATEMENT OF IT. It was absent from this list before, silently, which
      // read as an oversight; it is now a decision with a reason and a
      // tripwire. The reason: Research/22's ultra sections are keyed by
      // DISTANCE (50K / 50 Mile / 100K / 100 Mile) while PLAN_TEMPLATES' four
      // ultra rows are keyed by EXPERIENCE, so `section(distance, cohort)`
      // has no cohort to look up and the comparison this claim makes is not
      // defined for them. The tripwire: that mismatch is only tolerable
      // because the rows are unreachable, so assert exactly that before
      // skipping them.
      if (!/export function planAuthorshipUnsupported/.test(
        sourceOf('web-v2/lib/plan/supported-distances.ts'),
      )) {
        throw new Error(
          'the ultra authorship gate is gone · PLAN_TEMPLATES\' four ultra rows are reachable ' +
            'again, and they map four ultra DISTANCES onto four EXPERIENCE levels. Either ' +
            'restore the gate or give this claim a distance-keyed ultra comparison.',
        );
      }
      for (const cat of ['5k', '10k', 'hm', 'm'] as const) {
        const docDistance = DOC_DISTANCE[cat];
        for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
          const row = PLAN_TEMPLATES.find((t) => t.distance === cat && t.level === level);
          if (!row) throw new Error(`PLAN_TEMPLATES has no ${cat}/${level} row`);
          const d = section(docDistance, COHORT[level]);
          const hasReps = REP_NOTATION.test(d.keyWorkouts);
          const isBaseBuilding = row.qualityCharacter === 'base_building';
          if (isBaseBuilding && hasReps) {
            throw new Error(
              `PLAN_TEMPLATES ${cat}/${level} is 'base_building' but Research/22's ${docDistance} — ` +
                `${COHORT[level]} key-workout cell prescribes structured reps: "${d.keyWorkouts}"`,
            );
          }
          if (!isBaseBuilding && !hasReps) {
            throw new Error(
              `PLAN_TEMPLATES ${cat}/${level} is '${row.qualityCharacter}' but Research/22's ${docDistance} — ` +
                `${COHORT[level]} key-workout cell has no interval/rep notation: "${d.keyWorkouts}"`,
            );
          }
          const [wLo, wHi] = row.peakWeeklyMi;
          if (wHi < d.weekly[0] || wLo > d.weekly[1]) {
            throw new Error(
              `PLAN_TEMPLATES ${cat}/${level}.peakWeeklyMi [${wLo}, ${wHi}] does not overlap Research/22's ` +
                `${d.weekly[0]}-${d.weekly[1]} mi/wk`,
            );
          }
          const [lLo, lHi] = row.peakLongMi;
          if (lHi < d.long[0] || lLo > d.long[1]) {
            throw new Error(
              `PLAN_TEMPLATES ${cat}/${level}.peakLongMi [${lLo}, ${lHi}] does not overlap Research/22's ` +
                `${d.long[0]}-${d.long[1]} mi`,
            );
          }
        }
        // advanced_plus has no doctrine section of its own; it must never be
        // LESS structured than Advanced — doctrine has no cohort above
        // Advanced that regresses to unstructured work.
        const plus = PLAN_TEMPLATES.find((t) => t.distance === cat && t.level === 'advanced_plus');
        if (plus?.qualityCharacter === 'base_building') {
          throw new Error(
            `PLAN_TEMPLATES ${cat}/advanced_plus is 'base_building' · no doctrine cohort above ` +
              'Advanced regresses to unstructured work',
          );
        }
      }
    },
  },

  {
    id: 'TEMPLATE.source-attribution-matches-research22',
    binds: ['lib/plan/plan-templates.ts#PLAN_TEMPLATES.source'],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 4. Marathon Plans',
    claim:
      "Each PLAN_TEMPLATES row's `source` field names the book(s) its structure was built from " +
      "— it is a citation, not free text. Research/22 states the same attribution in prose " +
      "directly under each section heading, so a row's source is checked against that prose " +
      'rather than trusted as an uncrossed comment. (2026-08-29: promoted from a CLAUDE.md ' +
      "\"not yet seeded\" line — the sibling claim below already cross-checks qualityCharacter " +
      'and peak volume/long against the same doc; only the citation label itself was unwatched.)',
    check() {
      const doc = 'Research/22-plan-templates.md';
      const DOC_DISTANCE: Record<'5k' | '10k' | 'hm' | 'm', string> = {
        '5k': '5K', '10k': '10K', hm: 'Half Marathon', m: 'Marathon',
      };
      const COHORT: Record<'beginner' | 'intermediate' | 'advanced', string> = {
        beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
      };
      const all = sourceOf(doc).split('\n');
      // Book/author families this catalog draws from, per Research/22's own
      // "## Sources" list — kept as substring-safe stems so "Pfitzinger" and
      // "Pfitz" resolve to the same family, matched case-insensitively.
      const FAMILIES = [
        'higdon', 'pfitz', 'daniels', 'hansons', 'galloway', 'mayo', 'koop',
        'mottiv', 'inov-8', 'inov8', 'runnersconnect', 'hudson', 'c25k', 'furman',
      ];
      const familiesIn = (text: string): Set<string> => {
        const t = text.toLowerCase();
        return new Set(FAMILIES.filter((f) => t.includes(f)));
      };
      // The attribution sentence is the first non-blank, non-table line after
      // the heading — same section-start anchor as the sibling claim's
      // exact-prefix `section()` lookup, walked forward instead of pulled
      // from a table cell.
      const proseFor = (distance: string, cohort: string): string => {
        const at = all.findIndex((l) => l.startsWith(`### ${distance} —`) && l.includes(cohort));
        if (at < 0) throw new Error(`DOCTRINE · no "### ${distance} — ${cohort}" section in ${doc}`);
        for (let i = at + 1; i < at + 6; i++) {
          const line = all[i]?.trim();
          if (line && !line.startsWith('|')) return line;
        }
        throw new Error(`DOCTRINE · no prose line under ${distance} — ${cohort} in ${doc}`);
      };
      for (const cat of ['5k', '10k', 'hm', 'm'] as const) {
        const docDistance = DOC_DISTANCE[cat];
        for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
          const row = PLAN_TEMPLATES.find((t) => t.distance === cat && t.level === level);
          if (!row) throw new Error(`PLAN_TEMPLATES has no ${cat}/${level} row`);
          const prose = proseFor(docDistance, COHORT[level]);
          const docFamilies = familiesIn(prose);
          // Research/22's own prose sometimes describes structure without
          // naming a book at all (10K — Beginner: "Runners who finished a 5K
          // and want to step up," no attribution) — nothing to cross-check a
          // citation against there, so skip rather than force a false match.
          if (docFamilies.size === 0) continue;
          const rowFamilies = familiesIn(row.source);
          const overlap = [...rowFamilies].some((f) => docFamilies.has(f));
          if (!overlap) {
            throw new Error(
              `PLAN_TEMPLATES ${cat}/${level}.source is "${row.source}" (families: ` +
                `${[...rowFamilies].join(', ') || 'none recognized'}) but Research/22's ${docDistance} — ` +
                `${COHORT[level]} prose is "${prose}" (families: ${[...docFamilies].join(', ')}) — no overlap`,
            );
          }
        }
      }
    },
  },

  // ══ VDOT ANCHOR FRESHNESS ═════════════════════════════════════════════════
  {
    id: 'VDOT.anchor-freshness-window',
    binds: [
      'lib/training/vdot.ts#VDOT_FULL_VALUE_DAYS',
      'lib/training/vdot.ts#VDOT_EXPIRY_DAYS',
      'lib/training/vdot.ts#bestRecentVdot',
      'lib/training/vdot-inputs.ts#loadVdotInputs',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '| Time since race | Validity for current fitness                                  |',
    claim:
      'A race result is a reading of fitness ON RACE DAY, and doctrine states exactly how long ' +
      'it stays usable: fresh to 4 weeks, slightly stale to 8, stale to 12 ("use only as a ' +
      'floor"), expired after that ("Don\'t anchor pace prescription on this VDOT"). This one ' +
      'constant sets every prescribed pace for every runner in the app, so the full-value ' +
      'window and the expiry line are read out of the doctrine table rather than chosen: the ' +
      'full-value window is where "still usable" ends, and expiry is where "use only as a ' +
      'floor" ends. No caller may widen them.',
    check({ cite }) {
      const t = cite.table();
      // Rows are stated in weeks; the boundary of each band is its upper edge.
      const upperWeeks = (predicate: RegExp) => {
        const row = t.rows.find((r) => predicate.test(r[t.headers[1]]));
        if (!row) throw new Error(`DOCTRINE · no freshness row matching ${predicate} in ${cite.doc}`);
        return parseBand(row[t.headers[0]])[1];
      };
      const stillUsableDays = upperWeeks(/still usable/i) * 7;              // 8 weeks → 56
      const floorOnlyDays = upperWeeks(/only as a floor/i) * 7;             // 12 weeks → 84
      if (VDOT_FULL_VALUE_DAYS !== stillUsableDays) {
        throw new Error(
          `VDOT_FULL_VALUE_DAYS is ${VDOT_FULL_VALUE_DAYS} · doctrine's "still usable" band ends ` +
            `at ${stillUsableDays} days`,
        );
      }
      if (VDOT_EXPIRY_DAYS !== floorOnlyDays) {
        throw new Error(
          `VDOT_EXPIRY_DAYS is ${VDOT_EXPIRY_DAYS} · doctrine calls an anchor expired after ` +
            `${floorOnlyDays} days`,
        );
      }
      // The doc writes the rule at this engine in prose too · both must agree.
      const stated = resolveCitation(cite.doc, 'use ≤56 days as the canonical freshness window');
      if (!stated.text().includes('canonical freshness window')) {
        throw new Error('the implementation note stating the canonical window has moved · re-read the claim');
      }
      // The fade tail must land exactly on the expiry line, or the loader
      // fetches a band the selector will not honour (or starves one it will).
      if (VDOT_FULL_VALUE_DAYS + FADE_TAIL_DAYS !== VDOT_EXPIRY_DAYS) {
        throw new Error(
          `the fade tail (${FADE_TAIL_DAYS}d) does not carry the full-value window to expiry · ` +
            `${VDOT_FULL_VALUE_DAYS} + ${FADE_TAIL_DAYS} ≠ ${VDOT_EXPIRY_DAYS}`,
        );
      }
      // No caller may pass its own, wider window. The 180-day literal that used
      // to appear at four call sites is the defect this guards.
      for (const file of [
        'web-v2/lib/plan/drift-monitor.ts',
        'web-v2/lib/plan/seed-from-onboarding.ts',
        'web-v2/app/api/cron/snapshot-projections/route.ts',
        'web-v2/app/api/targets/projection/route.ts',
      ]) {
        if (/bestRecentVdot\([^)]*,\s*\d+\s*,/.test(sourceOf(file))) {
          throw new Error(`${file} passes a hardcoded lookback to bestRecentVdot · it must pass VDOT_FULL_VALUE_DAYS`);
        }
      }
    },
  },

  // ══ QUALITY ═══════════════════════════════════════════════════════════════
  {
    id: 'QUALITY.sessions-per-week',
    binds: ['lib/plan/goal-tiers.ts#TIER_TARGETS.qualityPerWeek'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Workout dose by race distance',
    claim:
      'Doctrine gives every road distance a VO2max dose, a threshold dose and a ' +
      'race-specific block, so at least one quality session a week is always warranted, and ' +
      'three is the ceiling any tier runs. Ultra distances get their stimulus from the long ' +
      'run rather than from repetitions, so they cap at one.',
    check({ cite }) {
      const t = cite.table();
      const ultraRows = t.rows.filter((r) => /50K|100K|100 mi/i.test(r.Race));
      const ultraIsLongRunDriven = ultraRows.every((r) => /rarely|sparingly/i.test(r.VO2max));
      for (const cat of CATS) {
        for (const tier of TIERS) {
          const q = TIER_TARGETS[cat][tier].qualityPerWeek;
          if (q < 1) throw new Error(`TIER_TARGETS.${cat}.${tier}.qualityPerWeek is ${q} · doctrine doses every distance`);
          if (q > 3) throw new Error(`TIER_TARGETS.${cat}.${tier}.qualityPerWeek is ${q} · three is the ceiling`);
          if (cat === 'ultra' && ultraIsLongRunDriven && q > 1) {
            throw new Error(
              `TIER_TARGETS.ultra.${tier}.qualityPerWeek is ${q} · doctrine calls ultra VO2max work ` +
                '"rarely" and puts the stimulus in the long run',
            );
          }
        }
      }
    },
  },
  {
    id: 'QUALITY.maintenance-never-two',
    binds: ['lib/plan/goal-tiers.ts#MAINTENANCE_BY_TIER'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Workout dose by race distance',
    claim:
      'With no race in the build window there is nothing to be race-specific for. Maintenance ' +
      'holds at most one quality session a week and never runs VO2max work, which is pure ' +
      'stress with no adaptation target.',
    check() {
      for (const tier of TIERS) {
        const shape = MAINTENANCE_BY_TIER[tier];
        if (shape.qualityPerWeek > 1) {
          throw new Error(`MAINTENANCE_BY_TIER.${tier}.qualityPerWeek is ${shape.qualityPerWeek} · maintenance is at most 1`);
        }
        if (/vo2|interval/i.test(shape.qualityType)) {
          throw new Error(`MAINTENANCE_BY_TIER.${tier}.qualityType is "${shape.qualityType}" · no VO2max work in maintenance`);
        }
      }
    },
  },

  // ══ PACE DERIVATION ═══════════════════════════════════════════════════════
  {
    id: 'PACE.threshold-anchor',
    binds: ['lib/training/vdot.ts#tPaceFromVdot'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Pace conversion from a race time',
    claim:
      'Threshold pace sits between half-marathon and 15K race pace — that is, at or slightly ' +
      'faster than HM pace, never slower. The engine anchors T to predicted HM pace with a ' +
      'small offset in that direction.',
    check({ cite }) {
      if (!/half-marathon pace to 15K pace/i.test(cite.text())) {
        throw new Error('the T-pace relationship no longer reads as half-marathon-to-15K · re-read the claim');
      }
      const off = Number(
        matchLiteral(
          sourceOf('web-v2/lib/training/vdot.ts'),
          /Math\.round\(hmPaceSPerMi - (\d+)\)/,
          'tPaceFromVdot HM offset',
        )[1],
      );
      if (off <= 0) throw new Error('T pace must be at least as fast as HM pace');
      if (off > 30) throw new Error(`T = HM - ${off}s/mi overshoots 15K pace · doctrine bounds T between HM and 15K`);
    },
  },
  {
    id: 'PACE.easy-band-off-threshold',
    binds: [
      'lib/plan/spec-builder.ts#buildWorkoutSpec.easyLo',
      'lib/plan/spec-builder.ts#buildWorkoutSpec.easyHi',
      // 2026-08-17 · fork sweep. `easyPaceBandFromAnchorPace` is a second copy
      // of these two offsets. It has no non-test callers today, which is
      // exactly what makes it dangerous: a twin nobody exercises is a twin
      // nobody notices going stale. The check below now reads both literals
      // and fails if they ever disagree.
      'lib/training/vdot.ts#easyPaceBandFromAnchorPace',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Pace conversion from a race time',
    claim:
      'Research/01:142 gives E = MP + 60-90 s/mi. The engine derives M as T+18 (see ' +
      'PACE.marathon-offset), so that rule is E = T+78..T+108, and the engine emits ' +
      'T+80..T+120: floor +2, ceiling +12, both conservative-slow. RESOLVED 2026-08-17 ' +
      "after the owner asked which of two contradicting conclusions was right. The doc " +
      'contradicts ITSELF: its own §Numerical equivalencies VDOT-50 row gives ' +
      'E = T+104..T+156, 20-40 s/mi slower, which falsifies line 138\'s "within ' +
      '+/-2 sec/mi" accuracy claim. Settling it needs Daniels 3rd ed. Table 2, not in ' +
      'repo. Executed-data check: both candidate bands sit inside Daniels 65-78 %HRmax; ' +
      'the runner himself averages 81 %HRmax on easy days, faster than either. HR is the ' +
      'governor, so neither band is a safety violation. This claim binds the passage the ' +
      'engine actually derives from; the prior claim bound the other one, and the prior ' +
      'code comment cited the table row while quoting a figure computed off MP+60.',
    check({ cite }) {
      // E = MP + 60..90 (Research/01:142), and M = T + MARATHON_OFFSET_SEC.
      const mpOffset = 18;
      const want: [number, number] = [mpOffset + 60, mpOffset + 90];
      const src = sourceOf('web-v2/lib/plan/spec-builder.ts');
      const m = matchLiteral(
        src,
        /const easyLo = easyAnchorT \+ (\d+), easyHi = easyAnchorT \+ (\d+);/,
        'buildWorkoutSpec easy band',
      );
      const [lo, hi] = [Number(m[1]), Number(m[2])];
      within(lo, [want[0] - 15, want[0] + 15], 'easy-pace floor offset off T (Research/01:142 MP+60)');
      within(hi, [want[1] - 15, want[1] + 15], 'easy-pace ceiling offset off T (Research/01:142 MP+90)');

      // The twin in lib/training/vdot.ts must state the SAME offsets. It is a
      // public export with no callers, so nothing else would ever catch it
      // drifting — and "one copy fixed, the other left behind" is the failure
      // this repo has now paid for three times (the cadence-target fork, the
      // backfill route's hrCapEasy, this band).
      const twin = matchLiteral(
        sourceOf('web-v2/lib/training/vdot.ts'),
        /return \{ lo: t \+ (\d+), hi: t \+ (\d+) \};/,
        'easyPaceBandFromAnchorPace easy band',
      );
      if (Number(twin[1]) !== lo || Number(twin[2]) !== hi) {
        throw new Error(
          `the easy band is stated twice and the two disagree: spec-builder T+${lo}/T+${hi}, ` +
          `lib/training/vdot.ts easyPaceBandFromAnchorPace T+${twin[1]}/T+${twin[2]}. ` +
          'Re-point one at the other or delete the unused twin — do not edit only one.',
        );
      }
    },
  },
  {
    id: 'PACE.tempo-is-threshold',
    binds: [
      'lib/plan/spec-builder.ts#buildWorkoutSpec.tempo',
      // The second copy. `derivePaces` re-derives every zone off T for the
      // spec-less fallback card, and this offset is the one that drifted:
      // spec-builder was corrected to tempo == T on 2026-06-23 (PACE-T-1) and
      // this copy kept the old sub-threshold band for two months, so a tempo
      // day with no authored spec rendered a pace 5-18 s/mi slower than the
      // approved definition. Both literals are read below.
      'lib/training/prescriptions.ts#derivePaces.tempoSecLo',
      'lib/training/prescriptions.ts#derivePaces.tempoSecHi',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.1 Threshold family overview',
    claim:
      'A continuous tempo is run AT threshold — the doctrine table\'s own Pace cell for the ' +
      '"Continuous tempo" row is T, flat, with no offset. The slower band that looks like a ' +
      'tempo is a DIFFERENT workout in the same table: sub-threshold intervals, ST, which the ' +
      'table defines as 10-15 s/mi slower than T. Shipping the ST band under a tempo label is ' +
      'the defect PACE-T-1 fixed in the composer and PACE-T-2 fixed in the fallback card, so ' +
      'this binds BOTH expressions and fails if either reintroduces an offset or they disagree.',
    check({ cite }) {
      // 1 · doctrine still says the continuous tempo is run at T.
      const paceCell = cite.table().cell('Continuous tempo', 'Pace').trim();
      if (paceCell !== 'T') {
        throw new Error(
          `Research/04 §5.1's "Continuous tempo" row now prices the workout at "${paceCell}" ` +
            'rather than T · the engine anchors tempo to threshold on the strength of that cell',
        );
      }

      // 2 · the composer states it as exactly tPaceSec, no arithmetic.
      const composer = matchLiteral(
        sourceOf('web-v2/lib/plan/spec-builder.ts'),
        /const tempo\s*=\s*([^;]+);/,
        'buildWorkoutSpec tempo',
      )[1].trim();
      if (composer !== 'tPaceSec') {
        throw new Error(
          `spec-builder's tempo is "${composer}" · doctrine puts a continuous tempo AT T, so ` +
            'this must be tPaceSec with no offset (see PACE-T-1, 2026-06-23)',
        );
      }

      // 3 · the fallback card's band is zero-width and also exactly T. Read
      // whatever follows each key so a reintroduced `t + 5` is caught by
      // value, not merely by the shape of the expression.
      const src = sourceOf('web-v2/lib/training/prescriptions.ts');
      for (const key of ['tempoSecLo', 'tempoSecHi'] as const) {
        const expr = matchLiteral(
          src,
          new RegExp(`${key}:\\s*([^,\\n]+),`),
          `derivePaces ${key}`,
        )[1].trim();
        if (expr !== 't') {
          throw new Error(
            `derivePaces.${key} is "${expr}" · a continuous tempo is run at T, so both edges of ` +
              'the band are the bare threshold. "t + 5".."t + 18" is Research/04 §5.1\'s ' +
              'SUB-THRESHOLD (ST) row wearing a tempo label — the exact drift PACE-T-2 closed.',
          );
        }
      }
    },
  },
  {
    id: 'PACE.marathon-offset',
    binds: ['lib/plan/spec-builder.ts#buildWorkoutSpec.mp'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Numerical equivalencies',
    claim:
      'Marathon pace sits just slower than threshold — 7:17 against 6:51 in the worked ' +
      'example, a 26 s/mi gap. The engine derives M as a fixed offset off T and must land ' +
      'within 10 s/mi of that, the width over which the gap varies across the VDOT range.',
    check({ cite }) {
      const t = cite.table();
      const [tPace] = parsePaceBandSec(t.cell('Daniels T', 'Pace (min/mi)'));
      const [mPace] = parsePaceBandSec(t.cell('Daniels M', 'Pace (min/mi)'));
      const off = Number(
        matchLiteral(sourceOf('web-v2/lib/plan/spec-builder.ts'), /const mp = tPaceSec \+ (\d+);/, 'buildWorkoutSpec mp')[1],
      );
      within(off, [mPace - tPace - 10, mPace - tPace + 10], 'marathon-pace offset off T');
    },
  },
  {
    id: 'PACE.interval-offset',
    binds: ['lib/plan/spec-builder.ts#buildWorkoutSpec.interval'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Numerical equivalencies',
    claim:
      'Interval pace is 3K-5K race pace: 6:18 against a 6:51 threshold in the worked example, ' +
      '33 s/mi faster. The engine derives I as a fixed offset off T.',
    check({ cite, exempt }) {
      const t = cite.table();
      const [tPace] = parsePaceBandSec(t.cell('Daniels T', 'Pace (min/mi)'));
      const [iPace] = parsePaceBandSec(t.cell('Daniels I', 'Pace (min/mi)'));
      const [rPace] = parsePaceBandSec(t.cell('Daniels R', 'Pace (min/mi)'));
      const off = Number(
        matchLiteral(
          sourceOf('web-v2/lib/plan/spec-builder.ts'),
          /const interval = tPaceSec - (\d+);/,
          'buildWorkoutSpec interval',
        )[1],
      );
      const band: [number, number] = [tPace - iPace - 10, tPace - iPace + 10];
      // GATEAUDIT-1 (2026-08-30) · the exemption used to be `if (exempt(...)) return;`
      // on the line ABOVE the only assertion in this claim, so granting it did not
      // excuse the known deviation — it switched the claim off. Changing the engine
      // from T-18 to T-5 would have passed. Every other exemption in this file is
      // guarded by the specific violating condition; this one now is too.
      if (off >= band[0] && off <= band[1]) return;   // engine agrees with doctrine

      // Two properties hold whatever the deviation, and neither is excusable.
      // Both are read out of the doc's own table, not written here.
      if (off <= 0) {
        throw new Error(
          `interval offset is ${off}s · I must be FASTER than T, and the exemption on this ` +
          'claim covers a conservative deviation, not an inverted one',
        );
      }
      if (off >= tPace - rPace) {
        throw new Error(
          `interval offset is ${off}s · that is at or past Daniels R (${tPace - rPace}s off T). ` +
          'I must sit between T and R; the exemption does not cover rep pace.',
        );
      }
      // And the exemption was granted for ONE number. If the engine's offset moves,
      // the deviation on record is not the deviation being run, so the exemption
      // stops applying and this claim fails until a human re-reads it. `18` here is
      // not a doctrine value and is not asserted as one — it is the provenance of
      // the exemption itself, which is what Rule 7's staleness discipline is for.
      const EXEMPTED_OFFSET_SEC = 18;
      if (off !== EXEMPTED_OFFSET_SEC || off > band[1]) {
        within(off, band, 'interval-pace offset off T');
        return;
      }
      if (exempt('interval-runs-slow')) return;
      within(off, band, 'interval-pace offset off T');
    },
    exempt: {
      'interval-runs-slow':
        'KNOWN VIOLATION, self-documented in the engine. `spec-builder.ts` (search ' +
        '`const interval = tPaceSec -`) states plainly that I = T-18 "is a deliberate ' +
        'conservative deviation" from Daniels\' T-33, landing nearer 10-12K pace than 3-5K ' +
        'pace. Deliberate, but it is a departure from cited doctrine and should be visible ' +
        'as one rather than reading as Daniels. GATEAUDIT-1 (2026-08-30) scoped this entry ' +
        'to the deviation actually on record: it excuses T-18 in the conservative direction ' +
        'only, and the claim still fails if the offset moves, inverts, or reaches rep pace. ' +
        'The previous form returned before the assertion and excused everything.',
    },
  },
  {
    id: 'PACE.rep-offset',
    binds: ['lib/training/prescriptions.ts#derivePaces.rep'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Numerical equivalencies',
    claim:
      'Repetition pace is roughly mile race pace — 5:50 against a 6:51 threshold, 61 s/mi ' +
      'faster. It is the only pace targeting economy and recruitment rather than lactate ' +
      'clearance, so substituting a slower one wastes the workout.',
    check({ cite }) {
      const t = cite.table();
      const [tPace] = parsePaceBandSec(t.cell('Daniels T', 'Pace (min/mi)'));
      const [rPace] = parsePaceBandSec(t.cell('Daniels R', 'Pace (min/mi)'));
      const off = Number(
        matchLiteral(
          sourceOf('web-v2/lib/training/prescriptions.ts'),
          /repSec:\s*t\s*!=\s*null\s*\?\s*t\s*-\s*(\d+)\s*:\s*null/,
          'derivePaces repSec',
        )[1],
      );
      within(off, [tPace - rPace - 10, tPace - rPace + 10], 'repetition-pace offset off T');
    },
  },

  // ══ HEART RATE ════════════════════════════════════════════════════════════
  {
    id: 'HR.friel-lthr-zones',
    binds: ['lib/training/zones.ts#friel7Zones'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Friel 7-Zone Running HR Table',
    claim:
      'The seven Friel running zones are defined as percentages of LTHR, not of HRmax. Every ' +
      'boundary the engine emits is read straight off the doctrine table.',
    check({ cite }) {
      const t = cite.table();
      const edges = frielEdgesFromDoctrine(t.rows.map((r) => r['% LTHR']));
      const lthr = 160;
      const zones = friel7Zones(lthr);
      if (zones.zones.length !== t.rows.length) {
        throw new Error(`friel7Zones emits ${zones.zones.length} zones · the doctrine table has ${t.rows.length}`);
      }
      // The engine's own edge list must BE the doc's, to the percent.
      if (FRIEL_7_ZONE_EDGES.length !== edges.length
          || FRIEL_7_ZONE_EDGES.some((e, i) => Math.abs(e - edges[i]) > 1e-9)) {
        throw new Error(
          `FRIEL_7_ZONE_EDGES is [${FRIEL_7_ZONE_EDGES.join(', ')}] · the doctrine table's edges ` +
          `are [${edges.join(', ')}]`,
        );
      }
      // And the bpm bands must be exactly that percent bucketing — no
      // tolerance, because the derivation is now deterministic. A ±1 slack is
      // what let the two-independent-roundings bug sit under this claim.
      assertBandsMatchEdges(zones.zones, lthr, edges, 'Friel 7-zone');
    },
  },
  {
    id: 'HR.lthr-five-zone-collapse',
    binds: ['lib/training/zones.ts#lthrZones'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Friel 7-Zone Running HR Table',
    claim:
      'The five-zone view the app shows is the Friel table with 5a/5b/5c merged into one Z5. ' +
      'Zones 1-4 must keep the exact Friel boundaries; collapsing the top three must not ' +
      'quietly move the threshold line.',
    check({ cite }) {
      const t = cite.table();
      const seven = frielEdgesFromDoctrine(t.rows.map((r) => r['% LTHR']));
      // Merging 5a/5b/5c means dropping the two edges INSIDE them (103%, 107%)
      // and keeping the one that separates Z4 from Z5 — the threshold line at
      // 100% LTHR. Derived from the doc, not restated.
      const five = seven.slice(0, 4);
      const lthr = 160;
      const z = lthrZones(lthr).zones;
      if (z.length !== 5) throw new Error(`lthrZones emits ${z.length} zones · the five-zone view must emit 5`);
      if (FRIEL_5_ZONE_EDGES.length !== five.length
          || FRIEL_5_ZONE_EDGES.some((e, i) => Math.abs(e - five[i]) > 1e-9)) {
        throw new Error(
          `FRIEL_5_ZONE_EDGES is [${FRIEL_5_ZONE_EDGES.join(', ')}] · collapsing 5a/5b/5c out of ` +
          `the doctrine table leaves [${five.join(', ')}]`,
        );
      }
      // Zones 1-4 keep the seven-zone bands byte for byte; Z5 is open above.
      assertBandsMatchEdges(z, lthr, five, 'Friel 5-zone');
      const seven7 = friel7Zones(lthr).zones;
      for (let i = 0; i < 4; i++) {
        if (z[i].lower !== seven7[i].lower || z[i].upper !== seven7[i].upper) {
          throw new Error(
            `collapsing the top three moved Z${i + 1}: five-zone has ${z[i].lower}-${z[i].upper}, ` +
            `seven-zone has ${seven7[i].lower}-${seven7[i].upper}`,
          );
        }
      }
      if (z[4].lower !== seven7[4].lower) {
        throw new Error(`the threshold line moved · Z5 floor ${z[4].lower} vs 5a floor ${seven7[4].lower}`);
      }
    },
  },
  {
    id: 'HR.pct-hrmax-zones',
    binds: ['lib/training/zones.ts#pctMaxZones'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### 5-Zone (ACSM / generic / commercial wearables)',
    claim:
      'When no LTHR is known the app falls back to the standard five %HRmax zones. Those are ' +
      'a published table, not a house convention, and must match it exactly. The one departure ' +
      'is the top band, which is open above: this app\'s HRmax is frequently an ESTIMATE and ' +
      'real efforts exceed it, and a reading with no zone is worse than a reading in the ' +
      'highest one there is.',
    check({ cite }) {
      const t = cite.table();
      const maxHr = 190;
      const z = pctMaxZones(maxHr).zones;
      if (z.length !== t.rows.length) throw new Error(`pctMaxZones emits ${z.length} zones · doctrine has ${t.rows.length}`);
      const bands = t.rows.map((row) => parsePctBand(row['% HRmax']));
      // The doctrine table is contiguous already · each row's ceiling is the
      // next row's floor. Assert that, then the floors ARE the edges.
      for (let i = 0; i + 1 < bands.length; i++) {
        if (Math.abs(bands[i][1] - bands[i + 1][0]) > 1e-9) {
          throw new Error(
            `Research/03 §4 zone ${i + 1} ends at ${bands[i][1]} but zone ${i + 2} starts at ` +
            `${bands[i + 1][0]} · the table is no longer contiguous, so the edge model is wrong`,
          );
        }
      }
      const edges = bands.map(([lo]) => lo);
      // Closed below (the table states a 50% floor), open above.
      assertBandsMatchEdges(z, maxHr, edges, '%HRmax', { openLow: false });
      // The published top ceiling is still checked — as the point beyond which
      // the band is open, not as a ceiling that drops readings.
      if (z[z.length - 1].upper !== null) {
        throw new Error(`%HRmax top zone must be open above · it caps at ${z[z.length - 1].upper}`);
      }
    },
  },
  {
    id: 'HR.zone-bands-tile-the-line',
    binds: ['lib/training/zones.ts#bandsFromPctEdges', 'lib/training/zones.ts#zoneIdxForBpm'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Friel 7-Zone Running HR Table',
    claim:
      'A zone table must answer for every heart rate, exactly once. The doctrine rows tile the ' +
      'whole percents with no gap and no overlap, so the bpm bands derived from them must tile ' +
      'the integers the same way: each band starts one beat above the last, zone 1 is open ' +
      'below and the top zone open above. The four faults this ends were all one mistake — ' +
      'rounding a band\'s two percent bounds to bpm INDEPENDENTLY, which at LTHR 162 left 145, ' +
      '153 and 161 in no zone, put 138 in two, floored zone 1 at 0 bpm, and capped the top at ' +
      '1.10 x LTHR so a 182 bpm rep finish fell off the table.',
    check({ cite }) {
      const t = cite.table();
      const edges = frielEdgesFromDoctrine(t.rows.map((r) => r['% LTHR']));
      // The doctrine rows themselves must still tile the whole percents. If a
      // future edit opens a gap in the doc, this claim says so rather than
      // quietly propagating it.
      const bands = t.rows.slice(1, -1).map((r) => parsePctBand(r['% LTHR']));
      for (let i = 0; i + 1 < bands.length; i++) {
        if (Math.abs((bands[i][1] + 0.01) - bands[i + 1][0]) > 1e-9) {
          throw new Error(
            `Research/03 §6 row ${i + 2} ends at ${bands[i][1]} and row ${i + 3} starts at ` +
            `${bands[i + 1][0]} · the doctrine rows no longer tile the whole percents`,
          );
        }
      }
      for (const lthr of [140, 150, 162, 171, 185, 199]) {
        for (const table of [lthrZones(lthr), friel7Zones(lthr), pctMaxZones(lthr + 20)]) {
          const zs = table.zones;
          if (zs[0].lower !== null && table.method === 'lthr-friel') {
            throw new Error(`LTHR ${lthr}: Friel zone 1 must be open below · it floors at ${zs[0].lower}`);
          }
          if (zs[zs.length - 1].upper !== null) {
            throw new Error(`LTHR ${lthr}: the top zone must be open above · it caps at ${zs[zs.length - 1].upper}`);
          }
          for (let i = 0; i + 1 < zs.length; i++) {
            if (zs[i].upper == null || zs[i + 1].lower == null) {
              throw new Error(`LTHR ${lthr}: only the outermost edges may be open`);
            }
            if (zs[i].upper! + 1 !== zs[i + 1].lower!) {
              throw new Error(
                `LTHR ${lthr}: ${zs[i].shortLabel} ends at ${zs[i].upper} and ${zs[i + 1].shortLabel} ` +
                `starts at ${zs[i + 1].lower} · ${zs[i].upper! + 1 < zs[i + 1].lower! ? 'a hole' : 'an overlap'}`,
              );
            }
          }
          // Every plausible running heart rate gets exactly one zone, and it
          // is the one whose printed band contains it.
          for (let bpm = 30; bpm <= 240; bpm++) {
            const idx = zoneIdxForBpm(bpm, table);
            if (idx == null) throw new Error(`LTHR ${lthr}: ${bpm} bpm belongs to no zone`);
            const z = zs.find((x) => x.idx === idx)!;
            const inside = (z.lower == null || bpm >= z.lower) && (z.upper == null || bpm <= z.upper);
            // A reading outside every closed band is CLAMPED to the outermost
            // one, which is the only honest answer; anywhere else it must sit
            // inside the band it was given.
            const clamped = (zs[0].lower != null && bpm < zs[0].lower && idx === zs[0].idx);
            if (!inside && !clamped) {
              throw new Error(
                `LTHR ${lthr}: ${bpm} bpm classified ${z.shortLabel}, whose band is ` +
                `${z.lower ?? '-inf'}-${z.upper ?? '+inf'}`,
              );
            }
          }
        }
        // And the bpm edges are the percent edges, exactly.
        assertBandsMatchEdges(friel7Zones(lthr).zones, lthr, edges, `Friel 7-zone @ LTHR ${lthr}`);
      }
    },
  },
  {
    id: 'HR.lthr-from-hrmax',
    binds: ['lib/training/lthr.ts#lthrFromMaxHr'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: "## 8. Daniels' HR Zones",
    claim:
      'When only HRmax is known, LTHR is crosswalked from it. Threshold effort sits at a ' +
      'stated %HRmax band, so the crosswalk fraction must fall inside that band — outside it ' +
      'and every LTHR-anchored zone in the app shifts with it.',
    check({ cite }) {
      const band = parsePctBand(cite.table().cell('T (Threshold)', '%HRmax'));
      const maxHr = 190;
      const lthr = lthrFromMaxHr(maxHr);
      if (lthr == null) throw new Error('lthrFromMaxHr returned null for a valid HRmax');
      within(lthr / maxHr, band, 'lthrFromMaxHr fraction of HRmax');
    },
  },
  {
    id: 'LTHR.retest-cadence-is-the-shelf-life',
    binds: [
      'lib/training/lthr-reanchor.ts#LTHR_RETEST_MIN_WEEKS',
      'lib/training/lthr-reanchor.ts#LTHR_RETEST_MAX_WEEKS',
      'lib/training/lthr-reanchor.ts#LTHR_RETEST_CADENCE_DAYS',
    ],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: 'Re-test every 6–12 weeks.',
    claim:
      'LTHR is a measurement with a shelf life, not a constant of the runner: Friel ends the ' +
      '30-minute time-trial protocol by telling you when to do it again. The engine treats an ' +
      'anchor older than the CEILING of that stated band as stale, and both ends of the band ' +
      'are read out of the sentence rather than written down here.',
    check({ cite }) {
      // The sentence is the anchor line itself, and `parseBand` normalises the
      // en dash the doc uses. Both ends matter: the floor is what stops the
      // engine nagging on the near edge of a range doctrine states as a range,
      // and the ceiling is what makes an anchor stale.
      const [lo, hi] = parseBand(cite.section[0]);
      if (LTHR_RETEST_MIN_WEEKS !== lo) {
        throw new Error(
          `LTHR_RETEST_MIN_WEEKS is ${LTHR_RETEST_MIN_WEEKS} · the doc's re-test band opens at ${lo} weeks`,
        );
      }
      if (LTHR_RETEST_MAX_WEEKS !== hi) {
        throw new Error(
          `LTHR_RETEST_MAX_WEEKS is ${LTHR_RETEST_MAX_WEEKS} · the doc's re-test band closes at ${hi} weeks`,
        );
      }
      // The staleness limb, the field-test detector and the profile tile all
      // work in DAYS. One derivation, from the weeks the doc states.
      if (LTHR_RETEST_CADENCE_DAYS !== hi * 7) {
        throw new Error(
          `LTHR_RETEST_CADENCE_DAYS is ${LTHR_RETEST_CADENCE_DAYS} · ${hi} weeks is ${hi * 7} days`,
        );
      }
    },
  },
  {
    id: 'LTHR.material-change-is-the-retest-noise-floor',
    binds: ['lib/training/lthr-reanchor.ts#LTHR_MATERIAL_CHANGE_BPM'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: 'Reproducibility on retest 1–2 weeks later: ±3 bpm.',
    claim:
      'A repeated HR field test does not return the same number twice; doctrine states how far ' +
      'apart two honest readings of an unchanged athlete can be. The engine will not re-write ' +
      'the threshold anchor — which redraws every zone edge and both HR ceilings — for a move ' +
      'smaller than that stated repeatability, because inside it the two readings agree.',
    check({ cite }) {
      // "±3 bpm" · parseBand strips the ± and reads the magnitude.
      const tolerance = parseBand(
        (cite.section[0].match(/±\s*\d+(?:\.\d+)?\s*bpm/) ?? ['±3 bpm'])[0],
      )[0];
      if (LTHR_MATERIAL_CHANGE_BPM !== tolerance) {
        throw new Error(
          `LTHR_MATERIAL_CHANGE_BPM is ${LTHR_MATERIAL_CHANGE_BPM} · doctrine puts retest ` +
          `reproducibility at ±${tolerance} bpm, so that is the floor a real change must clear`,
        );
      }
    },
  },
  {
    id: 'LTHR.half-marathon-inverts-at-the-band-top',
    binds: [
      'lib/training/lthr.ts#lthrFromRace',
      'lib/training/lthr-reanchor.ts#LTHR_QUALIFYING_MIN_MI',
      'lib/training/lthr-reanchor.ts#LTHR_QUALIFYING_MAX_MI',
    ],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 6.1 Heart-rate ceilings by distance',
    claim:
      'A half marathon is raced at a stated fraction of LTHR, so a half average HR inverts to an ' +
      'LTHR estimate. The engine reads the TOP of that band — a well-run half is AT threshold, ' +
      'which is the conservative end and the one that cannot over-state fitness — and it accepts ' +
      'only the half, because it is the tightest band the table publishes.',
    check({ cite }) {
      const t = cite.table();
      const half = parsePctBand(t.cell('Half', '%LTHR'));
      const marathon = parsePctBand(t.cell('Marathon', '%LTHR'));
      // The inversion: LTHR = avgHR / (top of the band). The engine's
      // `lthrFromRace` returns the average unchanged, which is only correct
      // while the doc's top edge is 100%.
      const avgHr = 168;
      const derived = lthrFromRace(13.1, avgHr);
      if (derived == null) throw new Error('lthrFromRace refused a 13.1 mi race at a plausible HR');
      const want = Math.round(avgHr / half[1]);
      if (derived !== want) {
        throw new Error(
          `lthrFromRace(13.1, ${avgHr}) is ${derived} · Research/08 §6.1 races a half at ` +
          `${Math.round(half[0] * 100)}-${Math.round(half[1] * 100)}% of LTHR, which inverts to ${want}`,
        );
      }
      // The half is chosen over the marathon because its band is tighter, and
      // that ordering is read out of the doc rather than asserted. If a future
      // edit ever made the marathon row the narrower one, the reason this
      // module rejects marathons would no longer hold and someone must re-read
      // it rather than discover it in a runner's zones.
      if ((half[1] - half[0]) >= (marathon[1] - marathon[0])) {
        throw new Error(
          "Research/08 §6.1's Half band is no longer tighter than its Marathon band · " +
          'the half-only qualifying rule in lib/training/lthr-reanchor.ts rests on that ordering',
        );
      }
      // And the accepted distance window actually contains a half marathon,
      // with room for the GPS spread a real race carries, and never reaches
      // far enough to swallow a 10K or a marathon.
      if (!(LTHR_QUALIFYING_MIN_MI < 13.1 && LTHR_QUALIFYING_MAX_MI > 13.1)) {
        throw new Error(
          `the LTHR qualifying window ${LTHR_QUALIFYING_MIN_MI}-${LTHR_QUALIFYING_MAX_MI} mi does not contain 13.1`,
        );
      }
      if (LTHR_QUALIFYING_MIN_MI <= 6.3 || LTHR_QUALIFYING_MAX_MI >= 26.2) {
        throw new Error(
          `the LTHR qualifying window ${LTHR_QUALIFYING_MIN_MI}-${LTHR_QUALIFYING_MAX_MI} mi reaches a ` +
          'distance Research/08 §6.1 gives its own, different %LTHR band',
        );
      }
    },
  },
  {
    id: 'HR.lthr-implied-maxhr-conservative-floor',
    binds: [
      'lib/training/max-hr.ts#LTHR_TO_HRMAX_CONSERVATIVE_PCT',
      'lib/training/max-hr.ts#hrMaxImpliedByLthr',
    ],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '%HRmax 86–92%  ≈  %HRR 83–90%  ≈  %LTHR 95–102%  ≈  Daniels T',
    claim:
      'The Threshold crosswalk names %HRmax and %LTHR on the SAME line, so a T-effort\'s HR is ' +
      'both a stated fraction of HRmax and (by LTHR\'s own definition, §6) approximately LTHR ' +
      'itself — combining the two inverts to an implied HRmax floor. The engine reads the ' +
      'CONSERVATIVE end: dividing LTHR by the HIGH edge of the %HRmax band (92%) gives the ' +
      'smaller of the two implied ceilings, because overshooting HRmax would make a genuinely ' +
      'hard effort read as artificially easy on every %HRmax-gated guard downstream. The ' +
      'incident this closes: a runner whose only recent max-HR evidence was training and a ' +
      'threshold half marathon resolved to an "observed" HRmax that was actually a floor.',
    check({ cite }) {
      // The %HRmax band on the anchor's own line — parsed at run time so the
      // engine constant cannot drift from the doc without this claim noticing.
      const m = cite.text().match(/%HRmax\s+(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)%/);
      if (!m) {
        throw new Error(
          `Research/03's Threshold crosswalk line no longer states a %HRmax band: "${cite.section[0]}"`,
        );
      }
      const hrmaxHi = Number(m[2]) / 100;
      if (Math.abs(LTHR_TO_HRMAX_CONSERVATIVE_PCT - hrmaxHi) > 1e-9) {
        throw new Error(
          `LTHR_TO_HRMAX_CONSERVATIVE_PCT is ${LTHR_TO_HRMAX_CONSERVATIVE_PCT} · the crosswalk's own ` +
          `%HRmax band tops out at ${hrmaxHi} (${m[1]}-${m[2]}%), which is the conservative divisor`,
        );
      }
      // And the derivation actually does what the claim says: for the
      // runner this closed the incident for, LTHR=168 must imply an HRmax
      // strictly above the stale observed ceiling (180) it was written to fix.
      const implied = hrMaxImpliedByLthr(168);
      if (implied == null || implied <= 180) {
        throw new Error(
          `hrMaxImpliedByLthr(168) is ${implied} · must exceed the 180 bpm observed ceiling this ` +
          'floor exists to correct, or the mechanism has stopped doing its job',
        );
      }
    },
  },
  {
    id: 'HR.rep-kinetics-floor',
    binds: ['lib/coach/reading-scope.ts#HR_REP_KINETICS_FLOOR_SEC'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Decision Table',
    claim:
      'Below a stated rep length, doctrine says to IGNORE heart rate rather than measure it more ' +
      'carefully — the rep ends before HR reaches its band, so the reading is the sensor rise ' +
      'time. The engine refuses to report an HR average on reps shorter than that, and the ' +
      'length is the one the doctrine table names, not a round number picked to look about right.',
    check({ cite }) {
      const rows = cite.table().rows;
      const repRow = rows.find((r) => /reps\s*\/\s*r-pace/i.test(r['Workout type'] ?? ''));
      if (!repRow) {
        throw new Error("Research/03 §14 no longer carries a 'Reps / R-pace' row");
      }
      // The instruction itself. If doctrine ever softens "Ignore HR" into
      // something else, this file's whole refusal branch needs re-reading.
      if (!/ignore hr/i.test(repRow['Notes'] ?? '')) {
        throw new Error(
          `Research/03 §14 'Reps / R-pace' no longer says to ignore HR · it says "${repRow['Notes']}"`,
        );
      }
      if (!/^pace$/i.test((repRow['Primary'] ?? '').trim())) {
        throw new Error(`Research/03 §14 'Reps / R-pace' primary is now "${repRow['Primary']}", not pace`);
      }
      // The number, read out of the row's own label — "Reps / R-pace (<2 min)".
      const m = /\(\s*<\s*(\d+(?:\.\d+)?)\s*min\s*\)/i.exec(repRow['Workout type'] ?? '');
      if (!m) {
        throw new Error(
          `Research/03 §14 'Reps / R-pace' row no longer states its duration: "${repRow['Workout type']}"`,
        );
      }
      const doctrineSec = Number(m[1]) * 60;
      if (HR_REP_KINETICS_FLOOR_SEC !== doctrineSec) {
        throw new Error(
          `reading-scope refuses HR below ${HR_REP_KINETICS_FLOOR_SEC}s · Research/03 §14 states ${doctrineSec}s`,
        );
      }
      // And the refusal is real, not just a constant sitting in a file.
      const shortRep = deriveReadingScopes({
        phases: [
          { type: 'work', actual_duration_sec: doctrineSec - 1, avg_hr: 150 },
          { type: 'work', actual_duration_sec: doctrineSec - 1, avg_hr: 150 },
        ],
        wholeHrBpm: 150,
      });
      if (shortRep.hr.scope !== 'none') {
        throw new Error(
          `reps of ${doctrineSec - 1}s produced an HR reading at scope '${shortRep.hr.scope}' · doctrine says ignore HR`,
        );
      }
    },
  },
  {
    id: 'HR.easy-run-ceiling',
    binds: [
      'lib/training/zones.ts#aerobicCeilingBpm',
      'lib/plan/spec-builder.ts#hrCapEasy',
      'lib/watch/build-workout.ts#hrCeilingBpm',
      'lib/training/zones.ts#judgeEasyRunHr',
    ],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Friel 7-Zone Running HR Table',
    claim:
      'An easy run is capped at the top of the aerobic zone. The prescription side, the watch ' +
      'and the judgement side use the same ceiling, and it is the Friel Z2 upper bound — not a ' +
      'rounder number chosen because it looked about right. ZONE-BANDS-1: all three used to ' +
      'write `round(0.89 x LTHR)` out by hand, which is 144 at LTHR 162 while the band Z3 ' +
      'starts above actually tops out at 145. One derivation now, and it is the zone table\'s.',
    check({ cite }) {
      const rows = cite.table().rows.map((r) => r['% LTHR']);
      // The ceiling is the band below the one Z3 opens: everything under the
      // 90% edge. Read the edge out of the doc, never restate it.
      const z3floor = frielEdgesFromDoctrine(rows)[1];
      for (const lthr of [140, 162, 185, 199]) {
        const want = Math.ceil(lthr * z3floor) - 1;
        if (aerobicCeilingBpm(lthr) !== want) {
          throw new Error(
            `aerobicCeilingBpm(${lthr}) is ${aerobicCeilingBpm(lthr)} · the last beat below the ` +
            `doctrine's ${z3floor} Z3 floor is ${want}`,
          );
        }
        // And it must BE the zone table's Z2 upper, not a parallel derivation.
        const z2 = lthrZones(lthr).zones.find((z) => z.idx === 2)!;
        if (z2.upper !== want) {
          throw new Error(`lthrZones(${lthr}) Z2 tops at ${z2.upper} · the easy ceiling is ${want}`);
        }
        // The judgement side agrees with the prescription side, beat for beat.
        const j = judgeEasyRunHr({ avgHrBpm: want, thresholdBpm: lthr })!;
        if (j.easyCeilingBpm !== want || j.verdict !== 'aerobic') {
          throw new Error(
            `judgeEasyRunHr calls ${want} bpm "${j.verdict}" against a ${j.easyCeilingBpm} ceiling ` +
            `· the prescription caps easy at exactly ${want}`,
          );
        }
      }
      // The two remaining call sites must route through the helper rather than
      // re-deriving. A literal here is how the three drifted apart before.
      //
      // ANCHOR-SPLIT-1 (2026-08-30) · the watch pattern was re-pointed. Its
      // ceiling moved into the exported `resolveHrCeiling`, which now resolves
      // the PRESCRIBED `workout_spec.hr_cap_bpm` first and only falls back to
      // this derivation when the plan authored none — so the derived branch is
      // still exactly the zone table's, which is all this claim asserts, but it
      // no longer sits in a nested ternary. This gate caught that refactor on
      // the first run and refused it, which is the gate working: the claim is
      // re-pointed, not widened.
      //
      // The behavioural half — that the fallback equals aerobicCeilingBpm and
      // that a prescribed cap wins over it, labelled — is asserted against the
      // owner's real spec rows in `lib/watch/_watch_anchor_split.test.ts`. Kept
      // as a source match here rather than importing the resolver, because
      // `build-workout.ts` reaches `lib/db/pool` and this registry has no
      // business pulling a database edge into the doctrine gate.
      for (const [file, binding, re] of [
        ['web-v2/lib/plan/spec-builder.ts', 'hrCapEasy', /const lthrCap = lthr \? aerobicCeilingBpm\(lthr\)/],
        ['web-v2/lib/watch/build-workout.ts', 'hrCeilingBpm', /const derived = lthr\s+\? aerobicCeilingBpm\(lthr\)/],
      ] as [string, string, RegExp][]) {
        matchLiteral(sourceOf(file), re, binding);
      }
    },
  },

  // ══ VDOT & PREDICTION ═════════════════════════════════════════════════════
  {
    id: 'VDOT.table-range',
    binds: [
      'lib/training/vdot.ts#vdotFromRace',
      // CEIL-ZONE-1 (2026-08-19) · the same range is now NAMED
      // (DANIELS_VDOT_MIN/MAX) and read by every inversion in the engine —
      // vdotFromRace's clamp, vdotFromTpace's and vdotFromMpace's search
      // bounds, and zone-stimulus.ts#vdotFromZonePace. It was four bare literal
      // pairs; a fifth reader was one copy too many.
      'lib/training/vdot.ts#DANIELS_VDOT_MIN',
      'lib/training/vdot.ts#DANIELS_VDOT_MAX',
      'lib/training/zone-stimulus.ts#vdotFromZonePace',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '## VDOT lookup table',
    claim:
      'The published table this app inverts spans a fixed VDOT range. A value outside it is ' +
      'extrapolation, not lookup, so the engine must reject exactly the range the table ' +
      'covers — the bounds are read off the first and last rows of the doc table, and every ' +
      'inversion in the engine searches that one named range rather than its own copy of it.',
    check({ cite }) {
      const vdots = cite
        .table()
        .rows.map((r) => Number(r.VDOT))
        .filter((n) => Number.isFinite(n));
      const [lo, hi] = [Math.min(...vdots), Math.max(...vdots)];
      // A time exactly on the slowest row must resolve; one meaningfully slower must not.
      // Probe one row inside the floor rather than exactly on it · the published
      // table is rounded to the second, so the slowest row can compute a hair
      // under `lo` and a knife-edge probe would test the rounding, not the clamp.
      const inside = cite.table().rows.find((r) => Number(r.VDOT) > lo)!;
      const [fiveKSec] = parsePaceBandSec(inside['5K']);
      if (vdotFromRace(fiveKSec, 3.10686) == null) {
        throw new Error(`a VDOT ${inside.VDOT} 5K does not resolve · the engine floor sits above the doctrine table`);
      }
      if (vdotFromRace(fiveKSec * 1.5, 3.10686) != null) {
        throw new Error(`a time far slower than VDOT ${lo} still resolves · the engine has no floor`);
      }
      const src = sourceOf('web-v2/lib/training/vdot.ts');
      const engineLo = Number(matchLiteral(src, /DANIELS_VDOT_MIN = (\d+);/, 'DANIELS_VDOT_MIN')[1]);
      const engineHi = Number(matchLiteral(src, /DANIELS_VDOT_MAX = (\d+);/, 'DANIELS_VDOT_MAX')[1]);
      if (engineLo !== lo || engineHi !== hi) {
        throw new Error(`the engine's named table range is ${engineLo}-${engineHi} · the doctrine table spans ${lo}-${hi}`);
      }
      if (DANIELS_VDOT_MIN !== lo || DANIELS_VDOT_MAX !== hi) {
        throw new Error('the exported range disagrees with its own literal · impossible unless the file moved');
      }
      // CEIL-ZONE-1 · every inversion reads the named range. Four bare `30`/`85`
      // pairs is how a lookup table gets forked, which is the shape DRIFT-T-1
      // found in the drift monitor.
      if (/vdot < 30 \|\| vdot > 85|let lo = 30, hi = 85;/.test(stripComments(src))) {
        throw new Error('an inversion in vdot.ts hardcodes the table range again');
      }
      const zoneSrc = stripComments(sourceOf('web-v2/lib/training/zone-stimulus.ts'));
      if (!/DANIELS_VDOT_MIN/.test(zoneSrc) || !/DANIELS_VDOT_MAX/.test(zoneSrc)) {
        throw new Error('vdotFromZonePace no longer searches the named table range');
      }
    },
  },
  {
    id: 'PREDICT.riegel-exponent',
    binds: ['lib/training/vdot.ts#RIEGEL_EXPONENT'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: 'T2 = T1 × (D2 / D1)^1.06',
    claim:
      'Below the VDOT table floor the app falls back to Riegel. The fatigue exponent is not a ' +
      'tunable: it is the published constant, and it is read out of the formula as written.',
    check({ cite }) {
      const stated = Number(cite.section[0].match(/\^(\d*\.?\d+)/)![1]);
      const engine = Number(
        matchLiteral(sourceOf('web-v2/lib/training/vdot.ts'), /RIEGEL_EXPONENT = (\d*\.?\d+)/, 'RIEGEL_EXPONENT')[1],
      );
      if (engine !== stated) throw new Error(`RIEGEL_EXPONENT is ${engine} · doctrine states ${stated}`);
    },
  },
  {
    id: 'PREDICT.riegel-validity-window',
    binds: ['lib/training/vdot.ts#RIEGEL_MIN_DISTANCE_MI', 'lib/training/vdot.ts#RIEGEL_MAX_DISTANCE_MI'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: 'Designed for events 3.5–230 minutes',
    claim:
      'Riegel was fitted for events from roughly 1500m to the marathon and falls apart at ' +
      'sprints and ultras. The engine must refuse to apply it outside that window rather ' +
      'than quietly extrapolating a marathon formula onto a 100K.',
    check({ cite }) {
      if (!/1500m to marathon/i.test(cite.text())) {
        throw new Error('the stated Riegel validity window no longer reads as 1500m-to-marathon');
      }
      const src = sourceOf('web-v2/lib/training/vdot.ts');
      const min = Number(matchLiteral(src, /RIEGEL_MIN_DISTANCE_MI = (\d*\.?\d+)/, 'RIEGEL_MIN_DISTANCE_MI')[1]);
      const max = Number(matchLiteral(src, /RIEGEL_MAX_DISTANCE_MI = (\d*\.?\d+)/, 'RIEGEL_MAX_DISTANCE_MI')[1]);
      within(min, [0.9, 1.0], 'RIEGEL_MIN_DISTANCE_MI (1500m ≈ 0.932 mi)');
      within(max, [26.0, 26.3], 'RIEGEL_MAX_DISTANCE_MI (the marathon)');
    },
  },

  // ══ COMEBACK / LAYOFF ═════════════════════════════════════════════════════
  {
    id: 'COMEBACK.layoff-bands',
    binds: ['lib/plan/adapt.ts#classifyGapBand', 'lib/plan/adapt.ts#GAP_SHAVE_FRACTIONS'],
    doc: 'Research/22-plan-templates.md',
    anchor: '| 8-14 days | 70% of pre-layoff volume for 1 wk, 85% for wk 2, full for wk 3 |',
    claim:
      'A layoff of 8-14 days resumes at 70% of pre-layoff volume, then 85%, then full. ' +
      'The band edges the engine classifies on, and the two shave fractions it applies, are ' +
      'read off that row.',
    check({ cite }) {
      const row = cite.section[0];
      const [gapLo, gapHi] = parseBand(row.split('|')[1]);
      const pcts = [...row.matchAll(/(\d+)%/g)].map((m) => Number(m[1]) / 100);
      if (classifyGapBand(gapLo - 1) === 'shave_70_85') {
        throw new Error(`a ${gapLo - 1}-day gap is classified as the 8-14 day band · doctrine starts it at ${gapLo}`);
      }
      if (classifyGapBand(gapLo) !== 'shave_70_85' || classifyGapBand(gapHi) !== 'shave_70_85') {
        throw new Error(`classifyGapBand does not cover the whole ${gapLo}-${gapHi} day band`);
      }
      if (classifyGapBand(gapHi + 1) === 'shave_70_85') {
        throw new Error(`a ${gapHi + 1}-day gap still shaves · past ${gapHi} days doctrine wants a rebuild`);
      }
      const engineFractions = GAP_SHAVE_FRACTIONS.map((f) => Math.round((1 - f) * 100) / 100);
      pcts.slice(0, 2).forEach((want, i) => {
        if (Math.abs(engineFractions[i] - want) > 0.005) {
          throw new Error(`comeback week ${i + 1} resumes at ${engineFractions[i]} of plan · doctrine says ${want}`);
        }
      });
    },
  },
  {
    id: 'COMEBACK.reramp-resume-fraction',
    binds: [
      'lib/plan/adapt.ts#RERAMP_RESUME_FRACTION',
      'lib/plan/adapt.ts#RERAMP_WEEKLY_GROWTH',
      'lib/plan/adapt.ts#RERAMP_MIN_BASE_SIGNAL_MI',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: 'Volume cap: weekly mileage ≤ 50% of lowest pre-layoff week initially',
    claim:
      'Coming back from a longer absence, the resume anchor is a fraction of pre-absence ' +
      'volume and the climb from there is the 10% rule strictly enforced. The anchor must be ' +
      'no more generous than doctrine allows for the harshest case, and the growth rate is ' +
      'the same ten percent used everywhere else. Doctrine states the rule as a PROPORTION of ' +
      'the runner\'s own volume, so it applies at every volume; any floor the engine puts under ' +
      'it is a noise guard of ours, is not a doctrine number, and must stay far below a real ' +
      'runner\'s week (LOWVOL-6, 2026-08-19: the floor was five miles a week, above a ' +
      'beginner\'s entire week, so the cohort least able to absorb a full-volume return was ' +
      'the one that never got the shave).',
    check({ cite }) {
      const text = cite.text();
      if (!/10% rule strictly enforced/i.test(text)) {
        throw new Error('the comeback volume cap no longer states the 10% rule · re-read the claim');
      }
      if (RERAMP_WEEKLY_GROWTH !== 1.1) {
        throw new Error(`RERAMP_WEEKLY_GROWTH is ${RERAMP_WEEKLY_GROWTH} · doctrine enforces the 10% rule on the climb back`);
      }
      if (RERAMP_RESUME_FRACTION <= 0 || RERAMP_RESUME_FRACTION > 1) {
        throw new Error(`RERAMP_RESUME_FRACTION is ${RERAMP_RESUME_FRACTION} · it is a fraction of pre-absence volume`);
      }
      // The noise guard, held below doctrine's own smallest published weekly
      // volume — Research/00a's volume table, beginner column — so it can never
      // again exclude a runner the research describes.
      const smallestPublishedWeek = Math.min(
        ...resolveCitation(
          'Research/00a-distance-running-training.md',
          '### Volume table — miles per week (km in parentheses)',
        ).text()
          .split('\n')
          .filter((l) => l.startsWith('|') && !/^\|\s*(Distance|-)/.test(l))
          .map((l) => l.split('|').map((c) => c.trim()))
          .filter((c) => c.length > 5)
          .map((c) => parseBand(c[2])[0])
          .filter((n) => Number.isFinite(n) && n > 0),
      );
      if (!(RERAMP_MIN_BASE_SIGNAL_MI < smallestPublishedWeek)) {
        throw new Error(
          `RERAMP_MIN_BASE_SIGNAL_MI is ${RERAMP_MIN_BASE_SIGNAL_MI} mi/wk, at or above the ` +
            `smallest weekly volume doctrine publishes (${smallestPublishedWeek} mi/wk) · the ` +
            'comeback shave is being withheld from runners the research describes',
        );
      }
    },
  },

  // ══ INTENSITY DISTRIBUTION · the 80/20 rule ═══════════════════════════════
  /**
   * 2026-08-21 · the OTHER end of the easy-share floor.
   *
   * CLAUDE.md §Rule 7 lists "polarized intensity distribution" as unwatched,
   * and half of it is: `INTENSITY.easy-share-floor` pins Z1 and nothing looks
   * at Z2 or Z3 at all. The engine has no middle-band or hard-band constant to
   * bind — there is no `HARD_SHARE_CEILING` anywhere — so this claim binds what
   * the engine DOES carry, which is two independent ceilings on the same
   * quantity that had never been checked against each other:
   *
   *   · `1 - EASY_SHARE_FLOOR` — 25% of the week, the most that may not be easy
   *   · `AT_PACE_WEEKLY_SHARE_CAP` — 10% T + 8% I + 5% R, per pace
   *
   * Two ceilings on the same miles, from two different doctrine files, that
   * nothing reconciled. If the per-pace caps summed above the easy floor's
   * remainder the engine would be able to author a week that satisfies Daniels
   * and violates the TID at the same time, and both gates would pass it.
   *
   * The doc's TID table is the arbiter, read at run time. Doctrine's two
   * distance-running shapes — Polarized and Pyramidal, which §"When each TID
   * applies" assigns to every distance the engine plans — both spend ~20% of
   * the week outside Z1. That is the number the engine's ceilings are held
   * against: high enough to author the shapes doctrine prescribes, and not so
   * high that the per-pace caps can add up past it.
   */
  {
    id: 'INTENSITY.non-easy-remainder',
    binds: [
      'lib/plan/intensity-distribution.ts#EASY_SHARE_FLOOR',
      'lib/prescription/levers.ts#AT_PACE_WEEKLY_SHARE_CAP',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '| Distribution | Z1 (easy) | Z2 (threshold) | Z3 (hard) | Hallmarks |',
    claim:
      'A training week is a distribution across three zones, not a floor on one of them. The two ' +
      'shapes doctrine assigns to distance running each spend about a fifth of the week outside ' +
      'Z1, and the engine carries two separate ceilings on that fifth — the easy-share floor and ' +
      'the per-pace weekly caps. They have to agree: the caps may not sum past what the floor ' +
      'leaves, and the floor may not leave less than the shapes need.',
    check({ cite }) {
      const table = cite.table();
      const zoneSum = (shape: string) =>
        (['Z2 (threshold)', 'Z3 (hard)'] as const)
          .map((col) => parseBand(table.cell(shape, col))[1])
          .reduce((a, b) => a + b, 0);

      // Every row must still read as a distribution, or the table was edited
      // into something this claim cannot reason about.
      for (const row of table.rows) {
        const label = String(row[table.headers[0]]).trim();
        if (!label) continue;
        const z1 = parseBand(row['Z1 (easy)'])[1];
        if (!(z1 >= 50 && z1 <= 100)) {
          throw new Error(`TID row "${label}" no longer states a Z1 share (${row['Z1 (easy)']})`);
        }
      }

      // The two shapes §"When each TID applies" assigns to 5K through marathon.
      const shapes = ['Polarized', 'Pyramidal'] as const;
      const needed = Math.max(...shapes.map(zoneSum));
      const enginePct = Number(((1 - EASY_SHARE_FLOOR) * 100).toFixed(4));

      if (enginePct + 1e-9 < needed) {
        throw new Error(
          `the easy floor leaves ${enginePct}% of a week for everything that is not easy, and doctrine's ` +
            `${shapes.join(' / ')} shapes want ${needed}% · the engine cannot author the distribution it prescribes`,
        );
      }

      const capSum = Number(
        (Object.values(AT_PACE_WEEKLY_SHARE_CAP).reduce((a, b) => a + b, 0) * 100).toFixed(4),
      );
      if (capSum > enginePct + 1e-9) {
        throw new Error(
          `the per-pace weekly caps sum to ${capSum}% of a week and the easy floor leaves ${enginePct}% · ` +
            'a week can satisfy Daniels and break the TID at the same time, and both gates would pass it',
        );
      }
      // The reverse direction is not an error — the caps SHOULD sit at or under
      // the remainder — but a large gap means the easy floor is doing no work,
      // which is worth failing on rather than discovering later.
      if (enginePct - capSum > 10) {
        throw new Error(
          `the easy floor leaves ${enginePct}% but nothing may spend more than ${capSum}% · the floor has ` +
            'stopped binding, so the intensity distribution is governed by the per-pace caps alone',
        );
      }
    },
  },
  {
    id: 'INTENSITY.easy-share-floor',
    binds: ['lib/plan/intensity-distribution.ts#EASY_SHARE_FLOOR', 'lib/plan/generate.ts#applyIntensityFloor'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: 'converge on ≥75% of training volume in Z1',
    claim:
      'At least 75% of training volume is easy running. The engine had no notion of ' +
      'intensity distribution at all until 2026-08-17 — it sized volume, sized the long run ' +
      'and placed quality days without ever asking what fraction of the miles it had just ' +
      'authored were easy. The floor is read out of the sentence itself rather than written ' +
      'here, so a change to the doctrine number moves the engine and not the other way round.',
    check({ cite }) {
      const [, docFloorPct] = parseBand(cite.section[0]);
      const docFloor = docFloorPct / 100;
      if (Math.abs(EASY_SHARE_FLOOR - docFloor) > 0.001) {
        throw new Error(
          `EASY_SHARE_FLOOR is ${EASY_SHARE_FLOOR}, doctrine converges at ${docFloor}`,
        );
      }
      // The base-building table states the same floor with a ceiling. Both must
      // agree, or one of them has been edited and nobody looked at the other.
      const rules = resolveCitation(cite.doc, '### Practical base-building rules');
      const [baseLo] = parseBand(rules.table().cell('Most base running is easy', 'Application'));
      if (Math.abs(baseLo / 100 - docFloor) > 0.001) {
        throw new Error(
          `Research/00a states two different easy-volume floors: ${docFloor} in the TID ` +
          `section and ${baseLo / 100} in the base-building rules. Reconcile the doc first.`,
        );
      }
    },
  },

  // ══ WORKOUT VOCABULARY ════════════════════════════════════════════════════
  {
    id: 'STRIDES.doctrine-bands',
    binds: [
      'lib/plan/spec-builder.ts#STRIDE_DURATION_S',
      'lib/plan/spec-builder.ts#STRIDE_RECOVERY_S',
      'lib/plan/spec-builder.ts#STRIDE_DEFAULT_REPS',
      'lib/plan/spec-builder.ts#STRIDE_DAYS_PER_WEEK',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 7.2 Strides',
    claim:
      'A stride is 15-30 seconds at mile-to-5K pace, 4-8 of them, with 60-90 seconds of ' +
      'recovery, done 2-4 times a week, in every phase of every plan. The engine could not ' +
      'express one at all before 2026-08-17: expand-spec had no strides shape, so a plan row ' +
      'that read "2 mi + 4×20s strides" reached the watch as a flat two-mile jog. Each of ' +
      'the four constants is checked against its own row of the §7.2 table.',
    check({ cite }) {
      const t = cite.table();
      within(STRIDE_DURATION_S, parseBand(t.cell('Distance', 'Prescription').split('or')[1]), 'STRIDE_DURATION_S');
      within(STRIDE_DEFAULT_REPS, parseBand(t.cell('Reps', 'Prescription')), 'STRIDE_DEFAULT_REPS');
      within(STRIDE_RECOVERY_S, parseBand(t.cell('Recovery', 'Prescription')), 'STRIDE_RECOVERY_S');
      within(STRIDE_DAYS_PER_WEEK, parseBand(t.cell('Frequency', 'Prescription')), 'STRIDE_DAYS_PER_WEEK');
      // §7.2's own placement rule: strides never stop. A future edit that gates
      // them to one phase should fail here rather than pass quietly.
      if (!/all phases/i.test(t.cell('When in cycle', 'Prescription'))) {
        throw new Error('Research/04 §7.2 no longer places strides in all phases · re-read the claim');
      }
      // Research/00a's base-building rules state a narrower weekly frequency.
      // The engine must satisfy BOTH bands, not just the looser one.
      const baseRules = resolveCitation(
        'Research/00a-distance-running-training.md',
        '### Practical base-building rules',
      );
      within(
        STRIDE_DAYS_PER_WEEK,
        parseBand(baseRules.table().cell('Strides preserved', 'Application').split('strides')[1]),
        'STRIDE_DAYS_PER_WEEK (Research/00a base-building band)',
      );
    },
  },
  {
    id: 'STRIDES.rep-progression',
    binds: [
      'lib/plan/spec-builder.ts#STRIDE_REPS_BY_PHASE',
      'lib/plan/spec-builder.ts#strideRepsForPhase',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 7.2 Strides',
    claim:
      'The stride count is a 4-8 band, and the engine walks it with the block instead of ' +
      'freezing every plan at the middle: the band floor in BASE, mid-band through QUALITY, ' +
      'the band top by RACE-SPECIFIC, and back to the familiar mid-band dose in the TAPER — ' +
      'Research/08 §9.1 preserves intensity through the taper and forbids anything novel in ' +
      'the final ten days, so the taper count must be one the block has already run, never a ' +
      'first-ever dose. Every value the map can emit sits inside §7.2\'s own Reps row.',
    check({ cite }) {
      const band = parseBand(cite.table().cell('Reps', 'Prescription'));
      for (const [phase, reps] of Object.entries(STRIDE_REPS_BY_PHASE)) {
        within(reps, band, `STRIDE_REPS_BY_PHASE.${phase}`);
      }
      // The fallback for unknown phases must sit in-band too.
      within(strideRepsForPhase('MAINTENANCE-OR-ANYTHING'), band, 'strideRepsForPhase fallback');
      // The progression must actually progress: BASE opens at or below the
      // QUALITY dose, which sits at or below the RACE-SPECIFIC dose.
      if (!(STRIDE_REPS_BY_PHASE['BASE'] <= STRIDE_REPS_BY_PHASE['QUALITY']
          && STRIDE_REPS_BY_PHASE['QUALITY'] <= STRIDE_REPS_BY_PHASE['RACE-SPECIFIC'])) {
        throw new Error('the stride count no longer builds BASE → QUALITY → RACE-SPECIFIC');
      }
      if (STRIDE_REPS_BY_PHASE['BASE'] >= STRIDE_REPS_BY_PHASE['RACE-SPECIFIC']) {
        throw new Error('the stride count is flat across the block again — the frozen-at-6 defect, one number over');
      }
      // Research/08 §9.1: "Add no novel workout types. Anything new in the
      // final 10 days creates fatigue without adaptation." The taper dose must
      // be one an earlier phase already ran.
      const taper = STRIDE_REPS_BY_PHASE['TAPER'];
      const earlier = [STRIDE_REPS_BY_PHASE['BASE'], STRIDE_REPS_BY_PHASE['QUALITY'], STRIDE_REPS_BY_PHASE['RACE-SPECIFIC']];
      if (!earlier.includes(taper)) {
        throw new Error(`the taper stride count (${taper}) is a dose no earlier phase ran — a novelty in the taper window`);
      }
      const taperRules = resolveCitation('Research/08-pacing-and-race-week.md', '### 9.1 Taper duration by distance');
      if (!/no novel workout types/i.test(taperRules.text())) {
        throw new Error('Research/08 §9.1 no longer states the no-novelty taper rule · re-read the claim');
      }
    },
  },
  {
    id: 'BEGINNER.surge-progression',
    binds: [
      'lib/plan/generate.ts#BEGINNER_SURGE_REPS_BAND',
      'lib/plan/generate.ts#BEGINNER_SURGE_MINUTES_BAND',
      'lib/plan/generate.ts#beginnerSurgeDose',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '### 5K — Beginner',
    claim:
      'The beginner\'s surge fartlek opens at the 5K-Beginner sample week\'s own dose ' +
      '("4×1 min @ T effort"), climbs the rep count first (Research/00b\'s reverse-taper ' +
      'ladder states the axis: "light fartlek (4-6× 1 min)"), and only then lengthens the ' +
      'rep, arriving at the 10K-Beginner peak week\'s "6×2 min fartlek" by the end of the ' +
      'race-specific phase. Before 2026-08-28 the string "5×1 min surges" was repeated ' +
      'verbatim for every week of every beginner block — a dose that never moved.',
    check({ cite }) {
      // The opening dose, read out of the 5K-Beginner sample week.
      const open = cite.text().match(/(\d+)\s*[×x]\s*(\d+)\s*min\s*@\s*T\b/i);
      if (!open) throw new Error('§"5K — Beginner" no longer shows an "N×M min @ T" sample day — re-derive the opening dose');
      const openDose = beginnerSurgeDose('QUALITY', 99);
      if (openDose.reps !== Number(open[1]) || openDose.minutes !== Number(open[2])) {
        throw new Error(
          `the beginner surge block opens at ${openDose.reps}×${openDose.minutes} min; the 5K-Beginner sample opens it at ${open[1]}×${open[2]} min`,
        );
      }
      // The peak dose, read out of the 10K-Beginner sample peak week.
      const tenK = resolveCitation('Research/22-plan-templates.md', '### 10K — Beginner');
      const peak = tenK.text().match(/(\d+)\s*[×x]\s*(\d+)\s*min\s*fartlek/i);
      if (!peak) throw new Error('§"10K — Beginner" no longer shows an "N×M min fartlek" peak day — re-derive the peak dose');
      const peakDose = beginnerSurgeDose('RACE-SPECIFIC', 0);
      if (peakDose.reps !== Number(peak[1]) || peakDose.minutes !== Number(peak[2])) {
        throw new Error(
          `the beginner surge block peaks at ${peakDose.reps}×${peakDose.minutes} min; the 10K-Beginner peak week says ${peak[1]}×${peak[2]} min`,
        );
      }
      // Research/00b's count band, and monotone total work: every step of the
      // walk stays inside the bands and never sheds minutes mid-build.
      const ladder = resolveCitation('Research/00b-recovery-protocols.md', '### Marathon Recovery (4-week reverse taper)');
      const countBand = ladder.text().match(/fartlek\s*\((\d+)[–-](\d+)\s*[×x]\s*1\s*min/i);
      if (!countBand) throw new Error('Research/00b no longer states the light-fartlek count band — re-read the claim');
      if (BEGINNER_SURGE_REPS_BAND[0] !== Number(countBand[1]) || BEGINNER_SURGE_REPS_BAND[1] !== Number(countBand[2])) {
        throw new Error(
          `BEGINNER_SURGE_REPS_BAND = ${BEGINNER_SURGE_REPS_BAND.join('-')}, Research/00b says ${countBand[1]}-${countBand[2]}`,
        );
      }
      let prevTotal = 0;
      for (const [phase, wtpe] of [['QUALITY', 3], ['QUALITY', 2], ['QUALITY', 1], ['QUALITY', 0], ['RACE-SPECIFIC', 2], ['RACE-SPECIFIC', 1], ['RACE-SPECIFIC', 0]] as const) {
        const d = beginnerSurgeDose(phase, wtpe);
        within(d.reps, [BEGINNER_SURGE_REPS_BAND[0], BEGINNER_SURGE_REPS_BAND[1]], `beginnerSurgeDose(${phase},${wtpe}).reps`);
        within(d.minutes, [BEGINNER_SURGE_MINUTES_BAND[0], BEGINNER_SURGE_MINUTES_BAND[1]], `beginnerSurgeDose(${phase},${wtpe}).minutes`);
        const total = d.reps * d.minutes;
        if (total < prevTotal) throw new Error(`the beginner surge dose walks backwards at ${phase}/${wtpe} (${total} < ${prevTotal} min)`);
        prevTotal = total;
      }
      if (!(prevTotal > beginnerSurgeDose('QUALITY', 99).reps * beginnerSurgeDose('QUALITY', 99).minutes)) {
        throw new Error('the beginner surge dose is flat across the block again — the frozen-dose defect');
      }
    },
  },
  {
    id: 'BEGINNER.hill-day',
    binds: [
      'lib/plan/generate.ts#BEGINNER_HILL_SURGE_S',
      'lib/plan/generate.ts#BEGINNER_HILL_REPS_BAND',
      'lib/plan/generate.ts#beginnerHillReps',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 8.2 Short hill repeats (10–30 s)',
    claim:
      'The beginner\'s second weekly structured day is §8.2\'s light hills, not a second copy ' +
      'of the surge fartlek — §15\'s base row places "hill sprints, occasional fartlek/light ' +
      'hills" in the same phase and Research/22\'s 10K-Beginner row lists "light hills" among ' +
      'its key workouts. The surge duration sits in §8.2\'s 10-30 s window, the rep count ' +
      'opens at the row\'s own "start 8" and builds along its stated axis, and both values ' +
      'stay inside the row\'s bands.',
    check({ cite }) {
      const t = cite.table();
      within(BEGINNER_HILL_SURGE_S, parseBand(t.cell('Duration', 'Prescription')), 'BEGINNER_HILL_SURGE_S');
      const repsBand = parseBand(t.cell('Reps', 'Prescription'));
      if (BEGINNER_HILL_REPS_BAND[0] !== repsBand[0] || BEGINNER_HILL_REPS_BAND[1] !== repsBand[1]) {
        throw new Error(
          `BEGINNER_HILL_REPS_BAND = ${BEGINNER_HILL_REPS_BAND.join('-')}, §8.2 says ${repsBand.join('-')}`,
        );
      }
      // "start 8, build to 16": opens at the band floor, builds, stays in-band.
      if (!/start\s*8.*build/i.test(t.cell('Reps', 'Prescription'))) {
        throw new Error('§8.2\'s Reps row no longer states the start-and-build axis · re-read the claim');
      }
      const opening = beginnerHillReps('QUALITY');
      const built = beginnerHillReps('RACE-SPECIFIC');
      if (opening !== repsBand[0]) throw new Error(`the beginner hill day opens at ${opening} reps; §8.2 says start ${repsBand[0]}`);
      if (!(built > opening)) throw new Error('the beginner hill day never builds — §8.2\'s own axis is "start 8, build to 16"');
      within(built, repsBand, 'beginnerHillReps(RACE-SPECIFIC)');
      // §15 still places light hills in the base-building vocabulary.
      const p15 = resolveCitation('Research/04-workout-vocabulary.md', '## 15. Training-cycle placement summary');
      if (!/light hills/i.test(p15.table().cell('Base (8–12+ wks)', 'Primary workouts'))) {
        throw new Error('§15\'s base row no longer names light hills · the beginner hill day loses its placement citation');
      }
    },
  },
  {
    id: 'VARIETY.r3-third-quality-day',
    binds: [
      'lib/plan/generate.ts#R3_MIN_TRAINING_DAYS',
      'lib/plan/goal-tiers.ts#TIER_TARGETS.qualityPerWeek',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '### 5K — Advanced',
    claim:
      'A 5K/10K advanced week runs THREE quality days and the third is the R day. Both ' +
      'advanced rows state "Days/week | 6-7" and their sample weeks write the three sessions ' +
      'out — 5K: "6×1000 m @ I" / "4×1 mi @ T" / "WU + 8×400 m @ R, 400 jog + CD"; 10K: ' +
      '"5×1600 m @ 10K pace" / "4×1 mi @ T" / "WU + 10×400 m @ R, 400 jog + CD" — which is ' +
      'what fills the R half of Research/01\'s polarized band ("10-15% I+R"). The tier ' +
      'table\'s qualityPerWeek must equal the sample week\'s own structured-session count, ' +
      'the composer\'s frequency gate must equal the rows\' stated day floor, and the ' +
      'intermediate rows (two structured sessions, no R day) must stay at two.',
    check({ cite }) {
      /** Structured sessions in a Research/22 sample week: the "WU + …" cells. */
      const sessionsIn = (text: string): number => (text.match(/WU \+/g) ?? []).length;
      const sections: Array<{ heading: string; cat: '5k' | '10k'; tier: 'advanced' | 'intermediate'; wantR: boolean }> = [
        { heading: '### 5K — Advanced', cat: '5k', tier: 'advanced', wantR: true },
        { heading: '### 10K — Advanced', cat: '10k', tier: 'advanced', wantR: true },
        { heading: '### 5K — Intermediate', cat: '5k', tier: 'intermediate', wantR: false },
        { heading: '### 10K — Intermediate', cat: '10k', tier: 'intermediate', wantR: false },
      ];
      for (const { heading, cat, tier, wantR } of sections) {
        const sec = resolveCitation('Research/22-plan-templates.md', heading);
        const n = sessionsIn(sec.text());
        const q = TIER_TARGETS[cat][tier].qualityPerWeek;
        if (q !== n) {
          throw new Error(
            `TIER_TARGETS.${cat}.${tier}.qualityPerWeek is ${q}, but §"${heading.replace('### ', '')}"'s ` +
              `sample week runs ${n} structured session(s)`,
          );
        }
        const hasR = /@ R\b/.test(sec.text());
        if (hasR !== wantR) {
          throw new Error(
            `§"${heading.replace('### ', '')}"'s sample week ${hasR ? 'now carries' : 'no longer carries'} an ` +
              `"@ R" session — the R-day placement (VARIETY-R3-1) needs re-reading`,
          );
        }
        if (wantR) {
          const days = parseBand(sec.table().cell('Days/week', 'Value'));
          if (R3_MIN_TRAINING_DAYS !== days[0]) {
            throw new Error(
              `R3_MIN_TRAINING_DAYS is ${R3_MIN_TRAINING_DAYS}; §"${heading.replace('### ', '')}" states ` +
                `"Days/week | ${days[0]}-${days[1]}" — the gate must open at the rows' own floor`,
            );
          }
        }
      }
      // The negative half: the half marathon's advanced sample week runs TWO
      // structured sessions (its third stimulus is the long run's HMP finish),
      // so no third weekday may be inferred for hm — and the tier table agrees.
      const hm = resolveCitation('Research/22-plan-templates.md', '### Half Marathon — Advanced');
      if (sessionsIn(hm.text()) !== 2 || TIER_TARGETS.hm.advanced.qualityPerWeek !== 2) {
        throw new Error(
          '§"Half Marathon — Advanced" and TIER_TARGETS.hm.advanced no longer agree on two structured ' +
            'sessions — the hm/m exclusion from VARIETY-R3-1 needs re-reading',
        );
      }
      // The band the third day exists to fill still reads 10-15% I+R.
      const dosing = resolveCitation('Research/01-pace-zones-vdot.md', "### Dosing rules — Daniels' caps");
      if (!/10–15% I\+R/.test(dosing.text())) {
        throw new Error('Research/01 no longer states the "10–15% I+R" polarized band — re-read VARIETY-R3-1');
      }
      // And the deload drops the extra session first: the composer's gate must
      // carry the cutback exclusion (Research/00b's cut order), and the doc
      // must still state that order.
      const cut = resolveCitation('Research/00b-recovery-protocols.md', '### What to Cut First');
      if (!/quality session/i.test(cut.text())) {
        throw new Error('Research/00b §"What to Cut First" no longer names the quality session — re-read the cutback gate');
      }
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      const gate = gen.match(/const thirdSpeedDay =[\s\S]{0,400}?;/);
      if (!gate || !/!isCutback/.test(gate[0])) {
        throw new Error('the thirdSpeedDay gate no longer excludes cutback weeks — Research/00b\'s cut order requires it');
      }
    },
  },
  {
    id: 'VARIETY.r3-r-day-dose',
    binds: ['lib/workout-catalogue/catalogue.ts#400m-r-repeats'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: "### Dosing rules — Daniels' caps",
    claim:
      'The R day\'s session is bounded by Daniels\' R row: rep length inside "200–600m, ' +
      '≤2 min", weekly volume inside "5% of weekly mi (max 8K cumulative)", recovery "2–3× ' +
      'duration of rep" — and Research/22\'s sample weeks state the rep counts (8×400 and ' +
      '10×400) the entry\'s band spans. The catalogue entry must stay inside every one of ' +
      'those numbers rather than restating them.',
    check({ cite }) {
      const entry = workoutBySlug('400m-r-repeats');
      if (!entry) throw new Error('the 400m-r-repeats entry is gone — the 5K/10K R day has no session to draw');
      // The doc's R row, parsed.
      const rRow = cite.text().split('\n').find((l) => /^\|\s*R\s*\|/.test(l));
      if (!rRow) throw new Error("Research/01's dosing table no longer carries an R row");
      const repRange = rRow.match(/(\d+)–(\d+)\s*m,\s*≤\s*(\d+)\s*min/);
      if (!repRange) throw new Error("the R row no longer states a rep length range — re-read the claim");
      const [lo, hi] = [Number(repRange[1]), Number(repRange[2])];
      const recovery = rRow.match(/(\d+)–(\d+)×\s*duration of rep/);
      if (!recovery) throw new Error('the R row no longer states the recovery multiple');
      const weeklyCap = rRow.match(/max\s+(\d+)K cumulative/);
      if (!weeklyCap) throw new Error('the R row no longer states the cumulative R cap');
      for (const st of entry.structures) {
        if (st.kind !== 'reps') throw new Error('400m-r-repeats must be a plain rep structure');
        if (st.rep.unit !== 'm' || st.rep.min < lo || st.rep.max > hi) {
          throw new Error(`400m-r-repeats rep ${st.rep.min}-${st.rep.max}m sits outside the R row's ${lo}-${hi}m`);
        }
        // Recovery: the stated seconds band must reach the doc's 2× floor for
        // a plausible R-pace 400 (~75-90 s) and never dip below the rep itself.
        if (!st.recoverySec || st.recoverySec.min < 2 * 75) {
          throw new Error("400m-r-repeats recovery is under 2× a fast runner's rep — the R row says 2–3× duration");
        }
      }
      // At-pace ceiling inside the cumulative cap.
      if (!entry.atPace || entry.atPace.unit !== 'km' || entry.atPace.max > Number(weeklyCap[1])) {
        throw new Error(`400m-r-repeats at-pace band exceeds the R row's ${weeklyCap[1]}K cumulative cap`);
      }
      // The reps the entry spans are the ones Research/22's sample weeks state.
      const fiveK = resolveCitation('Research/22-plan-templates.md', '### 5K — Advanced');
      const tenK = resolveCitation('Research/22-plan-templates.md', '### 10K — Advanced');
      const m5 = fiveK.text().match(/(\d+)×400 m @ R/);
      const m10 = tenK.text().match(/(\d+)×400 m @ R/);
      if (!m5 || !m10) throw new Error('Research/22\'s advanced sample weeks no longer state the N×400 @ R session');
      for (const st of entry.structures) {
        if (st.kind === 'reps' && (st.reps.min !== Math.min(+m5[1], +m10[1]) || st.reps.max !== Math.max(+m5[1], +m10[1]))) {
          throw new Error(
            `400m-r-repeats reps ${st.reps.min}-${st.reps.max} disagree with the sample weeks' ` +
              `${m5[1]}×400 and ${m10[1]}×400`,
          );
        }
      }
      // §7.4's own contraindication still carries the rest rule the entry quotes.
      const p74 = resolveCitation('Research/04-workout-vocabulary.md', '### 7.4 200m repeats');
      if (!/don't shorten the rest/i.test(p74.text())) {
        throw new Error("§7.4 no longer says \"don't shorten the rest\" — re-transcribe the entry's recovery rule");
      }
    },
  },
  {
    id: 'VOCAB.phase-placement',
    binds: ['lib/plan/generate.ts#qualityFamilyFor'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 15. Training-cycle placement summary',
    claim:
      'Each phase of a block has its own workout vocabulary, and §15 names it phase by ' +
      'phase. The engine asked the workout library for two families out of twenty-one, so ' +
      'an eighteen-week marathon build contained three workout shapes — reps, tempo, long. ' +
      'Every family qualityFamilyFor now places must be named in the row for the phase it ' +
      'places it in.',
    check({ cite }) {
      const t = cite.table();
      // How the engine's phase labels map onto the doc's rows. QUALITY spans two
      // doctrine rows: the optional hill block and specific support.
      const ROWS: Record<string, string[]> = {
        QUALITY: ['Hill / strength (3–4 wks, optional)', 'Specific support (4–6 wks)'],
        'RACE-SPECIFIC': ['Race-specific (4–8 wks)'],
      };
      // The word to look for in the row's prose, per family.
      const KEYWORD: Record<string, RegExp> = {
        hills: /hill/i,
        fartlek: /fartlek/i,
        cutdown: /alternation|cutdown|mile repeats/i,
        combo: /alternation|race-pace/i,
        marathon_specific: /canova|MP long runs/i,
        race_specific: /race-pace workouts/i,
        // SLOT-ROTATE-1 · §15's specific-support row opens "T, cruise
        // intervals, mile repeats at slower I, alternations". The first two
        // items are the threshold and tempo slots and the third is the rep
        // slot once the hill block is behind it; the engine placed neither and
        // spent those weeks on the generic string instead.
        threshold: /cruise intervals/i,
        vo2max: /mile repeats/i,
      };
      const cats: DistCategory[] = ['5k', '10k', 'hm', 'm', 'ultra'];
      const slots = ['intervals', 'threshold', 'tempo'] as const;
      for (const [phase, labels] of Object.entries(ROWS)) {
        const prose = labels.map((l) => t.cell(l, 'Primary workouts')).join(' ');
        for (const cat of cats) {
          for (const slot of slots) {
            // Both parities of the week index, and both ends of a phase.
            for (const [weekIdx, weeksToPhaseEnd] of [[0, 5], [1, 5], [4, 1], [5, 0]] as const) {
              const family = qualityFamilyFor(cat, phase, weekIdx, weeksToPhaseEnd, slot);
              if (!family) continue;
              const kw = KEYWORD[family];
              if (!kw) {
                throw new Error(`qualityFamilyFor places "${family}" with no doctrine keyword to check it against`);
              }
              if (!kw.test(prose)) {
                throw new Error(
                  `qualityFamilyFor puts "${family}" in the ${phase} phase (${cat}), but §15's ` +
                  `row for that phase reads "${prose}" — doctrine does not place it there.`,
                );
              }
            }
          }
        }
      }
      // DOCTRINE-BASE-2 · BASE's row is now placed too, and it is checked the
      // same way as the others rather than asserted to be empty. Its Primary
      // workouts column reads "E, GA, medium-long, long, strides, hill sprints,
      // occasional fartlek/light hills", so the family the engine names there
      // must appear in that prose — and it must be the same for every distance,
      // because §15's rows are keyed on phase and not on the event.
      const baseProse = t.cell('Base (8\u201312+ wks)', 'Primary workouts');
      const BASE_KEYWORD: Record<string, RegExp> = {
        speed: /strides|hill sprints/i,
        hills: /light hills|hill sprints/i,
        fartlek: /fartlek/i,
      };
      for (const cat of cats) {
        for (const slot of slots) {
          const family = qualityFamilyFor(cat, 'BASE', 0, 5, slot);
          if (family == null) continue;
          const kw = BASE_KEYWORD[family];
          if (!kw || !kw.test(baseProse)) {
            throw new Error(
              `qualityFamilyFor puts "${family}" in BASE (${cat}, ${slot}), but §15's base row ` +
              `reads "${baseProse}" \u2014 doctrine does not place it there.`,
            );
          }
        }
      }
      if (qualityFamilyFor('m', 'BASE', 0, 5, 'intervals') == null) {
        throw new Error(
          'BASE places no quality family at all. \u00a715\u2019s base row names strides, hill sprints ' +
          'and occasional fartlek/light hills as its Primary workouts and states a ceiling of ' +
          'two quality sessions a week \u2014 a phase that carries none does not get a ceiling.',
        );
      }
    },
  },
  {
    id: 'DOCTRINE.base-quality-per-week',
    binds: [
      'lib/plan/generate.ts#BASE_QUALITY_TYPES',
      'lib/plan/generate.ts#qualityTypesFor',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Marathon Recovery (4-week reverse taper)',
    claim:
      'A BASE week carries ONE structured session, not two and not none. \u00a715 of Research/04 ' +
      'states the ceiling ("2 quality sessions/wk max") and Research/00b states the opening ' +
      'number: the four-week reverse taper puts "One light tempo" on week 4 and says in the ' +
      'same row to "Re-evaluate before adding a second quality session in week 5", and the ' +
      'six-week conservative table reaches "Two quality sessions" only on the row whose notes ' +
      'read "Resume normal block". Both ladders run 0 \u2192 1 \u2192 2 with the second session arriving ' +
      'when normal training resumes, which in this engine is the QUALITY phase.',
    check({ cite }) {
      const t = cite.table();
      // The four-week ladder's own last rebuilding row: ONE session, and an
      // instruction not to add the second yet.
      const wk4Quality = t.cell('Week 4', 'Quality');
      if (!/^\s*one\b/i.test(wk4Quality)) {
        throw new Error(
          `the reverse taper's week-4 Quality cell no longer opens with a count: "${wk4Quality}"`,
        );
      }
      const wk4Notes = t.cell('Week 4', 'Notes');
      if (!/second quality session in week 5/i.test(wk4Notes)) {
        throw new Error(
          `the reverse taper no longer defers the second quality session: "${wk4Notes}"`,
        );
      }
      // The six-week conservative ladder must agree: two sessions arrive with
      // the resumption of the normal block, not inside the rebuild.
      const slow = resolveCitation(
        'Research/00b-recovery-protocols.md',
        '### Marathon Recovery, Conservative (6-week)',
      ).table();
      const twoRows = slow.rows.filter((r) => /two quality sessions/i.test(r['Quality'] ?? ''));
      if (twoRows.length !== 1) {
        throw new Error(
          `the conservative ladder names "Two quality sessions" on ${twoRows.length} rows \u00b7 expected exactly one`,
        );
      }
      if (!/resume normal block/i.test(twoRows[0]['Notes'] ?? '')) {
        throw new Error(
          'the conservative ladder\u2019s two-session row no longer coincides with resuming the ' +
          `normal block: "${twoRows[0]['Notes']}"`,
        );
      }
      // \u00a715's ceiling, read out of the base row's own Frequency cell.
      const ceiling = parseBand(resolveCitation(
        'Research/04-workout-vocabulary.md',
        '## 15. Training-cycle placement summary',
      ).table().cell('Base (8\u201312+ wks)', 'Frequency'))[1];
      if (BASE_QUALITY_TYPES.length !== 1) {
        throw new Error(
          `BASE authors ${BASE_QUALITY_TYPES.length} structured sessions a week \u00b7 both Research/00b ` +
          'rebuild ladders open at one',
        );
      }
      if (BASE_QUALITY_TYPES.length > ceiling) {
        throw new Error(
          `BASE authors ${BASE_QUALITY_TYPES.length} sessions against \u00a715's ceiling of ${ceiling}`,
        );
      }
      // And the composer must actually be reading this constant.
      if (!/phase === 'BASE' \? baseQualityTypes/.test(sourceOf('web-v2/lib/plan/generate.ts'))) {
        throw new Error('layoutWeek no longer fills the BASE quality mix from BASE_QUALITY_TYPES');
      }
    },
  },
  {
    id: 'VOCAB.catalogue-anchors',
    binds: ['lib/plan/catalogue-rx.ts#anchorsFor'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Pace conversion from a race time',
    claim:
      'The workout catalogue declines any session whose pace zones the composer cannot anchor, ' +
      'rather than pacing it by inference. Two of those anchors are RACE-pace relations read ' +
      'off this table: T is anchored to half-marathon pace, so an @HM session is a T session; ' +
      'I is anchored to 3K-5K, so an @5K session is an I session. And the set of zones the ' +
      'catalogue may anchor is exactly the set spec-builder can PACE — every anchored zone must ' +
      'come back out of buildWorkoutSpec as the rep pace the label promised, or the engine ' +
      'writes a label the watch does not run.',
    check({ cite }) {
      const t = cite.table();
      const milesIn = (cell: string): number[] =>
        [...cell.matchAll(/(\d+(?:\.\d+)?\s*K|half[- ]marathon|marathon|mile)/gi)]
          .map((m) => distanceMiFromLabel(m[1].replace(/\s+/g, '')))
          .filter((x): x is number => x != null);

      const T_PACE = 435, I_PACE = 400;
      // The MP anchor is `marathonPaceSPerMi`'s answer for this runner, which is
      // the point: the composer calls that function to anchor the zone and
      // `buildWorkoutSpec` calls it to pace the block, so a divergence here
      // means one of the two stopped calling it.
      const MP_PACE = marathonPaceSPerMi({ tPaceSec: T_PACE, goalPaceSPerMi: null });
      const anchors = anchorsFor({ tPaceSec: T_PACE, iPaceSec: I_PACE, mpPaceSec: MP_PACE });

      // T's row must still name a half-marathon-class race, or `HM ← T` is an
      // invention rather than a reading.
      const tCats = new Set(milesIn(t.cell('T', 'Relationship')).map((mi) => distanceCategoryOrNull(mi)));
      if (anchors.HM != null && !tCats.has('hm')) {
        throw new Error(
          `catalogue-rx anchors HM off the threshold pace, but Research/01's T row now reads ` +
            `"${t.cell('T', 'Relationship')}" and names no half-marathon-class race`,
        );
      }
      if (anchors.HM != null && anchors.HM !== anchors.T) {
        throw new Error('catalogue-rx anchors HM to something other than the T pace it claims to read off');
      }

      // I's row must still name a 5K, or `5K ← I` is likewise an invention.
      const iCats = new Set(milesIn(t.cell('I', 'Relationship')).map((mi) => distanceCategoryOrNull(mi)));
      if (anchors['5K'] != null && !iCats.has('5k')) {
        throw new Error(
          `catalogue-rx anchors 5K off the rep pace, but Research/01's I row now reads ` +
            `"${t.cell('I', 'Relationship')}" and names no 5K-class race`,
        );
      }
      if (anchors['5K'] != null && anchors['5K'] !== anchors.I) {
        throw new Error('catalogue-rx anchors 5K to something other than the I pace it claims to read off');
      }

      // ── THE GATE, and it is now the strong form ─────────────────────────
      //
      // It used to be a DENYLIST: eight zones named here as forbidden, because
      // spec-builder paced a threshold slot at T and a rep slot at I whatever
      // the prescription said. That was the right gate for that engine and it
      // is the wrong one for this one — ZONE-R-1 made `resolveZoneAnchors` the
      // single answer to "what is this zone worth" and had buildWorkoutSpec
      // price its rep off the SAME function, via the zone the prescription
      // declares.
      //
      // So the claim is no longer "these zones are forbidden". It is "every
      // zone the catalogue anchors comes back out of the spec builder as the
      // pace the label promised" — checked by building a rep session at each
      // anchored zone and reading the pace back off the spec it produced.
      // A future zone added to the anchor set with no pacing behind it fails
      // here, on the same sentence, without anybody maintaining a list.
      for (const [zone, expected] of Object.entries(anchors) as Array<[string, number]>) {
        // E is a band a day carries, never a work target, and no rep set can
        // declare it. `resolveZoneAnchors` does not emit it; this is the guard
        // that says so if it ever starts.
        if (zone === 'E') {
          throw new Error('catalogue-rx anchors E · easy is a day band, not a rep target');
        }
        const rx = `4×1mi @ ${zone} pace · 90s jog`;
        for (const type of ['threshold', 'intervals'] as const) {
          const { spec } = buildWorkoutSpec(type, 9, T_PACE, 160, rx, null, null, I_PACE);
          const built = Number((spec as Record<string, unknown>)?.rep_pace_s_per_mi ?? NaN);
          if (built !== expected) {
            throw new Error(
              `catalogue-rx anchors ${zone} at ${expected} s/mi, but buildWorkoutSpec paces a ` +
                `${type} session labelled "${rx}" at ${built} s/mi. The label would promise a ` +
                `pace the watch does not run. Teach spec-builder the zone first.`,
            );
          }
        }
      }

      // And the reverse direction: a zone the catalogue can name must not be
      // silently paced as something else. Anything `resolveZoneAnchors` leaves
      // out has to be a zone the SELECTOR refuses, which it does by construction
      // — `selectWorkout` declines an entry whose zones are not all anchored.
      // The one zone that must stay out is E, checked above.
    },
  },

  // ══ ZONE-R-1 · THE ZONES THE ENGINE CAN PRICE ═════════════════════════════
  // The engine could pace two of Research/04's twelve zones. These claims bind
  // the four it learned — R, the two other published race-pace columns, and
  // ST — to the rows they were read out of.
  {
    id: 'PACE.repetition-is-mile-race-pace',
    binds: ['lib/training/vdot.ts#rPaceFromVdot'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Pace conversion from a race time',
    claim:
      'R pace is mile race pace, read off the published Mile column of the VDOT table rather ' +
      'than derived from I by an offset. The doc gives R two readings — "~mile race pace, or ' +
      '~6 sec/400m faster than I" — and the engine takes the first, because the mile is a ' +
      'column of the table and the second is an offset off a number that is itself derived.',
    check({ cite }) {
      const rel = cite.table().cell('R', 'Relationship');
      if (!/mile\s+race\s+pace/i.test(rel)) {
        throw new Error(
          `rPaceFromVdot reads the published Mile column, but Research/01's R row now reads ` +
            `"${rel}" and no longer names mile race pace`,
        );
      }
      // EVERY ROW of the published table, not a spot check. The engine carries
      // two columns transcribed as literals (Mile and 3K, both because the raw
      // Daniels & Gilbert curve measurably diverges from them at short
      // distances), and a transcription is only trustworthy if something reads
      // the source. So this walks the doc's own lookup table row by row.
      const lookup = resolveCitation('Research/01-pace-zones-vdot.md', '## VDOT lookup table').table();
      const secOf = (cell: string): number => {
        const p = cell.trim().split(':').map(Number);
        if (p.some((n) => !Number.isFinite(n))) throw new Error(`unreadable table cell "${cell}"`);
        return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
      };
      for (const row of lookup.rows) {
        const vdot = Number(row['VDOT']);
        if (!Number.isFinite(vdot)) continue;
        // The mile IS the R pace, and one mile makes the finish time and the
        // pace the same number — so this compares seconds to seconds.
        const mileSec = secOf(row['Mile']);
        const r = rPaceFromVdot(vdot);
        if (r == null || Math.abs(r - mileSec) > 1) {
          throw new Error(
            `R pace at VDOT ${vdot} is ${r} s/mi; Research/01's Mile column says ${row['Mile']} (${mileSec} s)`,
          );
        }
        // And the other three race-pace columns the anchor set reads.
        //
        // Two tolerances, and the difference between them is the point. 3K is
        // TRANSCRIBED, so it must reproduce the column to within the table's own
        // rounding — the doc says so under the table itself: "All values
        // rounded to nearest second." 5K and 10K
        // are inverted from the Daniels & Gilbert equation, and this section's
        // own opening line scopes that: "within ±2 sec/mi for VDOT 35–70". A
        // transcribed column held to the equation's tolerance would let a
        // typo through; an equation column held to the transcription's would
        // fail on the doc's own stated accuracy.
        for (const [zone, col, tol] of [
          ['3K', '3K', 1], ['5K', '5K', 2], ['10K', '10K', 2],
        ] as const) {
          const mi = TABLE_RACE_DISTANCE_MI[zone];
          const docPace = secOf(row[col]) / mi;
          const engine = racePaceFromVdot(vdot, mi);
          if (engine == null || Math.abs(engine - docPace) > tol) {
            throw new Error(
              `${zone} race pace at VDOT ${vdot} is ${engine} s/mi; Research/01's ${col} column ` +
                `says ${row[col]} over ${mi} mi = ${docPace.toFixed(1)} s/mi`,
            );
          }
        }
      }
    },
  },
  {
    id: 'PACE.sub-threshold-offset',
    binds: ['lib/plan/zone-anchors.ts#ST_OFFSET_S_PER_MI'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## Pace zone shorthand',
    claim:
      'Sub-threshold sits 10-15 s/mi slower than T, and the engine takes the SLOW edge of that ' +
      'band. §5.4 states which direction the error is dangerous in — "going too hard collapses ' +
      'the model" — and the session exists to accumulate threshold volume WITHOUT the systemic ' +
      'cost of tempo, so a midpoint would be a number doctrine does not state, chosen against ' +
      'the one instruction doctrine does give.',
    check({ cite }) {
      const band = parseBand(cite.table().cell('ST', 'Race-pace anchor'));
      if (ST_OFFSET_S_PER_MI !== band[1]) {
        throw new Error(
          `ST_OFFSET_S_PER_MI is ${ST_OFFSET_S_PER_MI}; Research/04's ST row gives ` +
            `${band[0]}-${band[1]} s/mi slower than T and the engine takes the slow edge`,
        );
      }
      // The anchor set must actually put ST there, or the constant guards nothing.
      const a = resolveZoneAnchors({ tPaceSec: 435, iPaceSec: 400, marathonPaceSec: 470 });
      if (a.ST !== 435 + band[1]) {
        throw new Error(`resolveZoneAnchors puts ST at ${a.ST}; doctrine puts it at ${435 + band[1]}`);
      }
      // And this table's own ORDER: ST sits above M on %VO2max, so a
      // sub-threshold rep may never come out at or slower than the same
      // runner's marathon pace. Where the two anchors collide — ST is read off
      // the goal-blended threshold, marathon pace off the current-fitness
      // anchor — the zone is left UNANCHORED and the session declined, rather
      // than run at marathon pace under a sub-threshold label.
      const t = cite.table();
      const [stLo, stHi] = parseBand(t.cell('ST', '% VO2max'));
      const [mLo, mHi] = parseBand(t.cell('M', '% VO2max'));
      if (!(stLo > mLo && stHi > mHi)) {
        throw new Error(
          `Research/04's shorthand table no longer puts ST above M on %VO2max ` +
            `(ST ${stLo}-${stHi}, M ${mLo}-${mHi}) · the refusal below rests on that order`,
        );
      }
      const inverted = resolveZoneAnchors({ tPaceSec: 503, iPaceSec: 460, marathonPaceSec: 515 });
      if (inverted.ST != null) {
        throw new Error(
          `resolveZoneAnchors puts ST at ${inverted.ST} against a marathon pace of 515 · ` +
            'sub-threshold is never at or slower than marathon pace, and an unpriceable zone ' +
            'is declined rather than approximated',
        );
      }
    },
  },
  {
    id: 'DOSING.repetition-session-band',
    binds: ['lib/prescription/levers.ts#AT_PACE_SESSION_MI.repetition'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: "### Dosing rules — Daniels' caps",
    claim:
      'One R session tops out at the 8K cumulative ceiling doctrine states in the R row\'s ' +
      'single-workout cell. The percentage half of that cell is already the weekly share cap; ' +
      'this is the absolute half, which binds at the top of the volume range where a percentage ' +
      'stops protecting anyone.',
    check({ cite }) {
      const cap = cite.table().cell('R', 'Single-workout cap');
      const km = cap.match(/max\s*(\d+(?:\.\d+)?)\s*K/i);
      if (!km) {
        throw new Error(`Research/01's R single-workout cell no longer states a cumulative ceiling: "${cap}"`);
      }
      const maxMi = Number(km[1]) * 1.609344 ** -1 === 0 ? 0 : Number(km[1]) / 1.609344;
      if (Math.abs(AT_PACE_SESSION_MI.repetition.max - maxMi) > 0.02) {
        throw new Error(
          `AT_PACE_SESSION_MI.repetition.max is ${AT_PACE_SESSION_MI.repetition.max} mi; ` +
            `doctrine's "${cap}" is ${maxMi.toFixed(2)} mi`,
        );
      }
      // The `min` is the reference `warmupCooldownMi` scales the easy legs
      // against, and it comes from §7.4 — the one section that states an R
      // session's at-pace total and its warm-up in the same field table.
      const total = resolveCitation('Research/04-workout-vocabulary.md', '### 7.4 200m repeats')
        .table().cell('Total', 'Prescription');
      const [loKm] = parseBand(total);
      const minMi = loKm / 1.609344;
      if (Math.abs(AT_PACE_SESSION_MI.repetition.min - minMi) > 0.02) {
        throw new Error(
          `AT_PACE_SESSION_MI.repetition.min is ${AT_PACE_SESSION_MI.repetition.min} mi; ` +
            `Research/04 §7.4's "${total}" floors at ${minMi.toFixed(2)} mi`,
        );
      }
    },
  },
  {
    id: 'PROGRESSION.repetition-rep-window',
    binds: [
      'lib/prescription/levers.ts#REPETITION_REP_METRES',
      'lib/prescription/levers.ts#REPETITION_REP_MINUTES_MAX',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: "### Dosing rules — Daniels' caps",
    claim:
      'An R repetition is 200-600 m and never longer than two minutes. Both halves bind and ' +
      'they are stated in different units on purpose: the metres are the floor a session may be ' +
      'cut to, and the two minutes is the ceiling the duration lever may grow to — without it ' +
      'the ladder would walk an R set toward the continuous-tempo ceiling and call it speed work.',
    check({ cite }) {
      const cell = cite.table().cell('R', 'Rep length range');
      const [loM, hiM] = parseBand(cell);
      if (REPETITION_REP_METRES.min !== loM || REPETITION_REP_METRES.max !== hiM) {
        throw new Error(
          `REPETITION_REP_METRES is ${REPETITION_REP_METRES.min}-${REPETITION_REP_METRES.max} m; ` +
            `doctrine's R rep length cell reads "${cell}"`,
        );
      }
      const mins = cell.match(/(\d+(?:\.\d+)?)\s*min/i);
      if (!mins) throw new Error(`Research/01's R rep-length cell no longer states a time ceiling: "${cell}"`);
      if (REPETITION_REP_MINUTES_MAX !== Number(mins[1])) {
        throw new Error(
          `REPETITION_REP_MINUTES_MAX is ${REPETITION_REP_MINUTES_MAX}; doctrine says ${mins[1]} min`,
        );
      }
    },
  },
  {
    id: 'PROGRESSION.interval-rep-count-floor',
    binds: [
      'lib/prescription/levers.ts#INTERVAL_MIN_REPS',
      'lib/prescription/levers.ts#advanceShape',
      'lib/prescription/trajectory.ts#clampToWeek',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 6.1 VO2max family overview',
    claim:
      'A VO2max session is a rep set. Every row of §6.1 states a rep-count band and the ' +
      'smallest lower bound in the column is the fewest reps any §6 session is prescribed at; ' +
      'the document describes no continuous form of one. Both the density lever and the ' +
      'week-affordability clamp must stop there, or a rep set collapses into a single long ' +
      'block still wearing the interval label.',
    check({ cite }) {
      const t = cite.table();
      const counts: number[] = [];
      for (const row of t.rows) {
        const cell = row[t.headers.find((h) => /reps/i.test(h)) ?? ''] ?? '';
        // "3–6 × 1 mi", "8–16 × 400", "4–10 × 800" · the LEADING band is the
        // rep count; everything after the × is the rep's length.
        const m = cell.replace(/[–—−]/g, '-').match(/^\s*(\d+)\s*(?:-\s*(\d+))?\s*[×xX]/);
        if (!m) continue;
        counts.push(Number(m[1]));
      }
      if (counts.length < 5) {
        throw new Error(
          `§6.1's overview table no longer states rep counts this claim can read — ` +
            `found ${counts.length} readable rows`,
        );
      }
      const floor = Math.min(...counts);
      if (INTERVAL_MIN_REPS !== floor) {
        throw new Error(
          `INTERVAL_MIN_REPS is ${INTERVAL_MIN_REPS}; §6.1's smallest stated rep count is ${floor}`,
        );
      }
      // The density lever must refuse to go under it. A 3-rep set is the floor,
      // so merging one more rep out of it is the step that has to be capped.
      const at = advanceShape({
        shape: { reps: floor, repMinutes: 7, recoveryMinutes: 1, paceSPerMi: 420, zone: 'ESTABLISHED' },
        lever: 'work_density', stepMultiplier: 1, weeklyMi: 80, family: 'interval',
      });
      if (!at.capped) {
        throw new Error(
          `the density lever took a ${floor}-rep VO2max set to ${at.shape.reps}×${at.shape.repMinutes} min; ` +
            '§6.1 states no session below that count',
        );
      }
      // And a set already at the floor must survive the week clamp with its
      // count intact — the rep shortens instead.
      const held = clampToWeek(
        { reps: floor, repMinutes: 10, recoveryMinutes: 2, paceSPerMi: 420, zone: 'ESTABLISHED' },
        40, 'interval',
      );
      if (held.reps < floor) {
        throw new Error(
          `the week clamp cut a VO2max set to ${held.reps} rep(s); §6.1's floor is ${floor}`,
        );
      }
    },
  },
  {
    id: 'VOCAB.hill-block-precedes-specific-support',
    binds: ['lib/plan/catalogue-rx.ts#doctrinePhasesForWeek'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 15. Training-cycle placement summary',
    claim:
      '§15 is an ordered sequence of phases, not a pool. The optional hill/strength block ' +
      'precedes specific support, so once it is behind, the specific-support row is the row ' +
      'that governs. The engine has one QUALITY phase where the doc has two, and resolving ' +
      'that by taking whichever row answers first let the hill row win every week — §8 is ' +
      'effort-prescribed and spends no at-pace share, so a hill session almost always fits, ' +
      'and §6\'s rep sessions (placed in specific support and nowhere else) became unreachable.',
    check({ cite }) {
      const t = cite.table();
      const labels = t.rows.map((r) => r[t.headers[0]] ?? '');
      const hill = labels.findIndex((l) => /hill\s*\/\s*strength/i.test(l));
      const spec = labels.findIndex((l) => /^specific support/i.test(l));
      if (hill < 0 || spec < 0) {
        throw new Error(
          `§15 no longer names both a hill/strength row and a specific-support row: ${labels.join(' | ')}`,
        );
      }
      if (!(hill < spec)) {
        throw new Error('§15 no longer places the hill/strength block before specific support');
      }
      const early = doctrinePhasesForWeek('QUALITY', true);
      const late = doctrinePhasesForWeek('QUALITY', false);
      if (!early.includes('hill_strength')) {
        throw new Error('the hill/strength block is unreachable in the opening part of QUALITY');
      }
      if (late.includes('hill_strength')) {
        throw new Error(
          'the hill/strength row still governs after its block is over — §15 places it before ' +
            'specific support, not alongside it',
        );
      }
      if (!late.includes('specific_support')) {
        throw new Error('the specific-support row is unreachable in the closing part of QUALITY');
      }
    },
  },
  {
    id: 'PROGRESSION.repetition-ladder-keeps-the-rest',
    binds: [
      'lib/prescription/trajectory.ts#SESSION_LADDER.repetition',
      'lib/prescription/levers.ts#advanceShape',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 7.4 200m repeats',
    claim:
      'R work grows by rep COUNT and never by shortening the recovery. §7.4 fixes the rep at ' +
      '200 m and states the band as a rep count, and its contraindication row forbids the ' +
      'recovery lever in as many words. Tightening the rest on R work turns speed development ' +
      'into an anaerobic session, which is a different workout with a different cost.',
    check({ cite }) {
      const contra = cite.table().cell('Contraindications', 'Prescription');
      if (!/don'?t\s+shorten\s+the\s+rest/i.test(contra)) {
        throw new Error(
          `§7.4's contraindication row no longer forbids shortening the rest: "${contra}"`,
        );
      }
      if (SESSION_LADDER.repetition.includes('recovery_duration')) {
        throw new Error('SESSION_LADDER.repetition offers recovery_duration, which §7.4 forbids');
      }
      if (SESSION_LADDER.repetition[0] !== 'rep_count') {
        throw new Error(
          `§7.4 states the R band as a rep count ("${cite.table().cell('Reps', 'Prescription')}"), ` +
            `so rep_count is the ladder's first rung; it is ${SESSION_LADDER.repetition[0]}`,
        );
      }
      // And the lever itself must refuse, not merely be absent from the ladder —
      // a diagnosed limiter can hand `advanceShape` any lever it likes.
      const res = advanceShape({
        shape: { reps: 8, repMinutes: 0.75, recoveryMinutes: 3, paceSPerMi: 320, zone: 'ESTABLISHED' },
        lever: 'recovery_duration',
        stepMultiplier: 1,
        weeklyMi: 50,
        family: 'repetition',
      });
      if (!res.capped || res.shape.recoveryMinutes !== 3) {
        throw new Error('advanceShape shortened an R recovery, which §7.4 forbids');
      }
    },
  },
  {
    id: 'VOCAB.unequal-step-grammar',
    binds: [
      'lib/plan/prescription-parser.ts#parseSegments',
      'lib/plan/catalogue-rx.ts#renderPrescription',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 13.2 400-800-1200-1600 ladder',
    claim:
      'A session whose steps are not all the same is expressed as its steps, not approximated ' +
      'into a uniform rep set. §13.2 gives four rungs, each at its own zone and each with its ' +
      'own recovery; a rendering that flattened them would describe a different workout. The ' +
      'rendered label parses back to the same step list, so the string the runner reads and the ' +
      'spec the watch runs are the same object twice.',
    check({ cite }) {
      const t = cite.table();
      const paces = t.cell('Pace by rep length', 'Prescription');
      const rec = t.cell('Recovery', 'Prescription');
      // Four rungs in the doc, four steps in the entry, four segments in the
      // rendered label. If the doc's row changes shape this stops matching.
      const rungs = [...paces.matchAll(/(\d{3,4})\s*at\s/gi)].map((m) => Number(m[1]));
      if (rungs.length < 4) {
        throw new Error(`§13.2's pace-by-rep-length row no longer states four rungs: "${paces}"`);
      }
      const entry = WORKOUT_CATALOGUE.find((e) => e.slug === 'ascending-ladder');
      if (!entry) throw new Error('the ascending ladder is no longer in the catalogue');
      const structure = entry.structures[0];
      if (structure.kind !== 'sequence' || structure.steps.length !== rungs.length) {
        throw new Error(
          `§13.2 states ${rungs.length} rungs; the catalogue entry carries ` +
            `${structure.kind === 'sequence' ? structure.steps.length : 0}`,
        );
      }
      for (let i = 0; i < rungs.length; i++) {
        const step = structure.steps[i];
        const m = step.unit === 'm' ? step.value : step.value * 1609.344;
        if (Math.round(m) !== rungs[i]) {
          throw new Error(`§13.2's rung ${i + 1} is ${rungs[i]} m; the entry carries ${Math.round(m)} m`);
        }
      }
      const rendered = renderPrescription(entry, {
        structure, reps: structure.steps.length, atPaceMinutes: 0, atPaceMi: 0, recoverySec: 0,
      });
      if (!rendered) throw new Error('the ascending ladder no longer renders into the prescription grammar');
      const back = parseSegments(rendered);
      if (!back || back.length !== rungs.length) {
        throw new Error(
          `"${rendered}" reads back as ${back?.length ?? 0} steps against ${rungs.length} rungs`,
        );
      }
      // Every rung's zone survives the round trip, which is what makes the
      // ladder a ladder rather than four reps at one pace.
      const zones = parseZones(rendered);
      if (new Set(zones).size < 2) {
        throw new Error(`"${rendered}" declares fewer than two zones · a ladder walks zones`);
      }
      // And the recovery row's own numbers reach the label.
      if (!/\d/.test(rec)) throw new Error(`§13.2's recovery row states no numbers: "${rec}"`);
      if (back.every((s) => s.restS === 0)) {
        throw new Error(`§13.2 states a recovery per rung; "${rendered}" carries none`);
      }
    },
  },

  // ══ EASY-DAY DISCIPLINE ═══════════════════════════════════════════════════
  // The observational twin of the 80/20 intensity-distribution constraint being
  // built in the plan engine. That work governs how much easy volume is
  // PRESCRIBED; these claims govern how the app decides the easy volume was
  // actually run easy. Same passages, opposite direction.
  {
    id: 'EASY.hr-ceiling-observational',
    binds: ['lib/coach/easy-discipline.ts#EASY_HRMAX_CEILING_PCT'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '## Daniels training paces (E, M, T, I, R)',
    claim:
      'An easy run tops out at 78% of max HR. The observational side must use the same ' +
      'ceiling the prescription side is built on, read from the E row of the Daniels pace ' +
      'table, or the app judges by one number and prescribes by another.',
    check({ cite }) {
      const band = parsePctBand(cite.table().cell('E', '%HRmax'));
      if (Math.abs(EASY_HRMAX_CEILING_PCT - band[1]) > 0.005) {
        throw new Error(
          `EASY_HRMAX_CEILING_PCT is ${EASY_HRMAX_CEILING_PCT} · Daniels E tops out at ${band[1]} of HRmax`,
        );
      }
    },
  },
  {
    id: 'EASY.cap-not-looser-than-daniels',
    binds: ['lib/plan/spec-builder.ts#hrCapEasy'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: "## 8. Daniels' HR Zones",
    claim:
      'The easy HR cap the app PRESCRIBES must not permit more than the doctrine ceiling ' +
      'allows. hrCapEasy composes two anchors from two different systems - the Friel Z2 top ' +
      '(0.89 x LTHR) and the Daniels E top (0.78 x HRmax) - and a ceiling built from two ' +
      'candidates should take the binding one, not the loosest one.',
    check({ cite, exempt }) {
      const src = sourceOf('web-v2/lib/plan/spec-builder.ts');
      // The maxHR branch itself is unguarded by HR.easy-run-ceiling, which only
      // watches the LTHR branch. Check it against the doc's own E row.
      const pct = parsePctBand(cite.table().cell('E (Easy)', '%HRmax'))[1];
      const lit = Number(
        matchLiteral(
          src,
          /const maxHrCap = maxHr \? Math\.round\(maxHr \* (\d*\.?\d+)\)/,
          'hrCapEasy maxHr branch',
        )[1],
      );
      if (Math.abs(lit - pct) > 0.005) {
        throw new Error(`hrCapEasy's HRmax branch caps easy at ${lit} · Daniels E tops out at ${pct}`);
      }
      // The composition. MAX of two ceilings always returns the more permissive.
      // Consult the exemption ONLY when the violation is actually present, so
      // fixing the engine makes the gate report the exemption as stale and
      // force its deletion. An exemption marked used unconditionally is an
      // exemption that can outlive the bug it excuses.
      const composesWithMax = /return Math\.max\(lthrCap, maxHrCap\);/.test(src);
      if (composesWithMax && !exempt('max-of-two-ceilings')) {
        throw new Error(
          'hrCapEasy returns MAX(lthrCap, maxHrCap) · a ceiling assembled from two candidate ' +
            'ceilings must take the lower, or the looser system always wins',
        );
      }
    },
    exempt: {
      'max-of-two-ceilings':
        'KNOWN VIOLATION (found building the easy-discipline detector, 2026-08-17). hrCapEasy ' +
        'returns MAX(round(0.89 x LTHR), round(0.78 x HRmax)). Because the app itself derives ' +
        'LTHR as 0.90 x HRmax (lib/training/lthr.ts#lthrFromMaxHr, watched by HR.lthr-from-maxhr), ' +
        'the LTHR branch evaluates to 0.89 x 0.90 = 0.801 x HRmax, which is ALWAYS above the ' +
        '0.78 branch. The HRmax branch is therefore unreachable for any runner who has an LTHR, ' +
        'and the effective easy cap is structurally 80% of max where doctrine says 78%. For the ' +
        'owner: LTHR 162, HRmax 179, cap 144 bpm = 80.4 %HRmax; the doctrine ceiling is 140. ' +
        'NOT fixed here for two reasons. (1) spec-builder.ts is owned by a concurrent plan-engine ' +
        'agent this session. (2) The blast radius is wide: hr_cap_bpm is written into every ' +
        'generated workout_spec, echoed by the watch build (lib/watch/build-workout.ts, which ' +
        'uses a THIRD rule - LTHR-first with HRmax as fallback, not MAX), rendered on Today, the ' +
        'glance adapter and native, and changing it silently re-paces existing plans. ' +
        'RECOMMENDATION: change MAX to Math.min and re-generate, which moves the owner from 144 ' +
        'to 140. Until then lib/coach/easy-discipline.ts deliberately judges against ' +
        'max(doctrine, prescribed) so it can never accuse the runner of obeying the app.',
    },
  },
  {
    id: 'EASY.heat-confounds-the-read',
    binds: ['lib/coach/easy-discipline.ts#HEAT_CONFOUND_TEMP_C'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Limitations and Confounders',
    claim:
      'Heat raises heart rate at a fixed effort, so a hot easy day cannot be counted as ' +
      'evidence that the runner ran it too hard. The temperature at which the app stops ' +
      'trusting an easy-day HR reading is the one doctrine names as the onset of the effect.',
    check({ cite }) {
      const row = cite.table().rows.find((r) => /^heat/i.test(r.Confounder ?? ''));
      if (!row) throw new Error('the confounders table no longer carries a Heat row');
      // The threshold lives in the row LABEL ("Heat (≥25°C)"), which parseBand
      // strips as parenthetical, so read it directly.
      const m = (row.Confounder ?? '').match(/(\d+(?:\.\d+)?)\s*°?\s*C/);
      if (!m) throw new Error(`the Heat row no longer names a temperature: "${row.Confounder}"`);
      const docC = Number(m[1]);
      if (HEAT_CONFOUND_TEMP_C !== docC) {
        throw new Error(
          `HEAT_CONFOUND_TEMP_C is ${HEAT_CONFOUND_TEMP_C} · doctrine puts the heat effect at ${docC} C`,
        );
      }
      if (!/rises/i.test(row['Effect at fixed effort'] ?? '')) {
        throw new Error('the Heat row no longer says HR RISES at fixed effort · re-read the filter');
      }
    },
  },
  {
    id: 'EASY.drift-confounds-the-read',
    binds: ['lib/coach/easy-discipline.ts#DRIFT_CONFOUND_MINUTES'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| Cardiac drift (>30 min steady) | Rises |',
    claim:
      'Cardiac drift inflates average HR on long steady efforts, so past the duration at ' +
      'which doctrine quantifies the effect an easy run contributes to the pace read only. ' +
      'The engine cut-off is that duration, not a round number.',
    check({ cite }) {
      const m = cite.text().match(/over\s+(\d+)\s*min/i);
      if (!m) throw new Error('the cardiac-drift row no longer quantifies the effect over a duration');
      const docMin = Number(m[1]);
      if (DRIFT_CONFOUND_MINUTES !== docMin) {
        throw new Error(
          `DRIFT_CONFOUND_MINUTES is ${DRIFT_CONFOUND_MINUTES} · doctrine quantifies drift over ${docMin} min`,
        );
      }
    },
  },
  {
    id: 'EASY.terrain-confounds-the-read',
    binds: ['lib/coach/easy-discipline.ts#TERRAIN_CONFOUND_GAP_PCT'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Hills (Grade-Adjusted Pace)',
    claim:
      'A hilly easy run is a different observation, not a harder one. The grade at which the ' +
      'app stops trusting an easy-day read is the first row of the doctrine multiplier table ' +
      'whose pace cost reaches ten percent, and the net-climb proxy used until grade-adjusted ' +
      'pace lands is that same grade converted for rolling terrain.',
    check({ cite }) {
      const t = cite.table();
      const mult = parseBand(t.cell('+2%', 'Pace multiplier'))[0];
      const cost = mult - 1;
      if (Math.abs(TERRAIN_CONFOUND_GAP_PCT - cost) > 0.005) {
        throw new Error(
          `TERRAIN_CONFOUND_GAP_PCT is ${TERRAIN_CONFOUND_GAP_PCT} · the +2% grade row costs ${cost.toFixed(2)} of pace`,
        );
      }
      // Rolling terrain returning to its start climbs about half the distance,
      // so an average uphill grade of g implies net gain per mile of g/2 x 5280.
      const impliedFtPerMi = (0.02 / 2) * 5280;
      within(
        TERRAIN_CONFOUND_FT_PER_MI,
        [impliedFtPerMi - 10, impliedFtPerMi + 10],
        'TERRAIN_CONFOUND_FT_PER_MI vs the +2% grade converted for rolling terrain',
      );
    },
  },
  {
    id: 'EASY.post-race-context-window',
    binds: ['lib/coach/easy-discipline.ts#raceWindowFor'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Distance | Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'Easy days inside a post-race recovery window are context, not evidence. The window is ' +
      'the "total recovery days (no quality)" column - explicitly NOT its neighbour "days of ' +
      'zero/very-light running", which is the confusion that caused the 52174bcd incident.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Total recovery days (no quality)';
      for (const [label, mi] of [
        ['5K', 3.1],
        ['10K', 6.2],
        ['Half marathon', 13.1],
        ['Marathon', 26.2],
      ] as [string, number][]) {
        const docHi = parseBand(t.cell(label, col))[1];
        const engine = raceWindowFor(mi, true);
        if (engine !== docHi) {
          throw new Error(
            `raceWindowFor(${mi}, after) is ${engine} · doctrine gives ${label} ${docHi} recovery days`,
          );
        }
      }
    },
  },
  {
    id: 'EASY.pre-race-context-window',
    binds: ['lib/coach/easy-discipline.ts#raceWindowFor'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.1 Taper duration by distance',
    claim:
      'Easy days inside a taper are deliberately conserved, not lazily run, so they are ' +
      'context rather than evidence. The pre-race window is the taper length doctrine gives ' +
      'for that race distance.',
    check({ cite }) {
      const t = cite.table();
      for (const [label, mi] of [
        ['5K', 3.1],
        ['10K', 6.2],
        ['Half marathon', 13.1],
        ['Marathon', 26.2],
      ] as [string, number][]) {
        const docHi = parseBand(t.cell(label, 'Taper length'))[1];
        const engine = raceWindowFor(mi, false);
        if (engine !== docHi) {
          throw new Error(
            `raceWindowFor(${mi}, before) is ${engine} · doctrine tapers ${label} for ${docHi} days`,
          );
        }
      }
    },
  },
  {
    id: 'EASY.share-of-volume-twin',
    binds: ['lib/coach/easy-discipline.ts#OVER_CEILING_MAJORITY'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Practical base-building rules',
    claim:
      'This detector is the observational twin of the intensity-distribution constraint in ' +
      'the plan engine: doctrine says most base running is easy, and prescribing that share ' +
      'is worthless if the easy runs are not run easy. The bar for calling it a pattern is a ' +
      'clear majority, and never stricter than the easy share doctrine itself asks for - ' +
      'requiring more bad days than doctrine requires good ones would be incoherent.',
    check({ cite }) {
      const share = parsePctBand(cite.table().cell('Most base running is easy', 'Application'))[0];
      if (share < 0.7) {
        throw new Error(
          `the base-building rule now puts only ${share} of volume in Z1 · re-read this claim`,
        );
      }
      within(
        OVER_CEILING_MAJORITY,
        [2 / 3 - 0.001, share],
        'OVER_CEILING_MAJORITY between a clear majority and the doctrine easy share',
      );
    },
  },

  // ══ TERRAIN · grade adjustment for executed runs ═══════════════════════════
  // Seeded 2026-08-17. CLAUDE.md §Doctrine gate listed "altitude, treadmill and
  // terrain pace conversions" as an unwatched claim area; the terrain half is
  // now watched. Altitude remains unseeded — nothing in the engine adjusts for
  // it yet, so there is no constant to bind.
  {
    id: 'TERRAIN.grade-cost-per-pct',
    binds: ['lib/terrain/grade-adjust.ts#GRADE_COST_PER_PCT'],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Mechanical Effects of Uphill Running',
    claim:
      'Running uphill costs a fixed fraction more per percent of grade, and that fraction is ' +
      'stated in this section. Every pace-judging surface — the post-run recap, the training ' +
      'VDOT candidates, the race split arithmetic — has to use that one number, or a hilly run ' +
      'reads as slow on one surface and as fitness on another.',
    check({ cite }) {
      const text = cite.text();
      const m = text.match(/rises\s*~?\s*(\d+(?:\.\d+)?)\s*%\s*per\s*1\s*%\s*of\s*grade/i);
      if (!m) {
        throw new Error(
          'the uphill energy-cost sentence is no longer in §Mechanical Effects of Uphill Running · ' +
            're-read the section before re-pointing this claim',
        );
      }
      const doctrinePct = Number(m[1]);
      const enginePct = GRADE_COST_PER_PCT * 100;
      if (Math.abs(enginePct - doctrinePct) > 0.05) {
        throw new Error(
          `GRADE_COST_PER_PCT is ${enginePct}% per 1% grade · doctrine says ${doctrinePct}%`,
        );
      }
      // The same coefficient must be the one the race-pacing path uses. Two
      // numbers here means the plan and the execution disagree about the
      // same hill. 2026-08-17: race/pacing.ts no longer declares its own
      // literal — the elevation consolidation moved it into
      // lib/training/elevation-model.ts, which pacing.ts and course-impact.ts
      // both call. This claim now compares the two exported constants
      // directly, which is stronger than a source scan: a refactor that moves
      // either one keeps failing here until they are reconciled.
      if (Math.abs(ELEV_GRADE_COST_PER_PCT - GRADE_COST_PER_PCT) > 1e-9) {
        throw new Error(
          `lib/training/elevation-model.ts uses ${ELEV_GRADE_COST_PER_PCT} per 1% grade but ` +
            `lib/terrain/grade-adjust.ts uses ${GRADE_COST_PER_PCT}. Planned courses and ` +
            `executed runs must cost a hill the same.`,
        );
      }
    },
  },
  {
    id: 'TERRAIN.grade-model-ceiling',
    binds: ['lib/terrain/grade-adjust.ts#GRADE_MODEL_MAX_PCT'],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Mechanical Effects of Uphill Running',
    claim:
      'The linear per-percent cost is only claimed to hold up to a stated grade. Past it the ' +
      'engine clamps rather than extrapolating, so a drifted barometer or a fat-fingered ' +
      'treadmill incline cannot produce an unbounded pace adjustment.',
    check({ cite }) {
      const m = cite.text().match(/up to\s*~?\s*(\d+)\s*[–-]\s*(\d+)\s*%/i);
      if (!m) throw new Error('the validity ceiling ("up to ~10–15%") is no longer stated in this section');
      within(GRADE_MODEL_MAX_PCT, [Number(m[1]), Number(m[2])], 'GRADE_MODEL_MAX_PCT');
    },
  },
  {
    id: 'TERRAIN.descent-giveback',
    binds: ['lib/terrain/grade-adjust.ts#DESCENT_GIVEBACK_FRACTION'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Hills (Grade-Adjusted Pace)',
    claim:
      'A descent does NOT refund what the equivalent climb charged — doctrine puts the giveback ' +
      'at a fraction of the loss. The asymmetry is the entire reason hills show up in a ' +
      'whole-run adjustment at all: with a symmetric coefficient every rolling loop would net ' +
      'to zero and terrain would be invisible to the engine.',
    check({ cite }) {
      const m = cite.text().match(/downhills give back roughly\s*(\d+)\s*[–-]\s*(\d+)\s*%/i);
      if (!m) {
        throw new Error(
          'the downhill-giveback sentence is no longer in §Hills (Grade-Adjusted Pace) · a change ' +
            'here changes how every executed run is judged',
        );
      }
      within(DESCENT_GIVEBACK_FRACTION * 100, [Number(m[1]), Number(m[2])], 'DESCENT_GIVEBACK_FRACTION');
      if (DESCENT_GIVEBACK_FRACTION >= 1) {
        throw new Error('a descent that gives back everything makes terrain invisible · doctrine says it does not');
      }
    },
  },
  {
    id: 'TERRAIN.treadmill-air-resistance-grade',
    binds: ['lib/terrain/grade-adjust.ts#TREADMILL_AIR_RESISTANCE_GRADE_PCT'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### General incline → outdoor pace conversion',
    claim:
      'One specific belt grade is metabolically equal to outdoor flat, because it stands in for ' +
      'the air resistance a treadmill runner never meets. The engine reads that grade out of ' +
      "the doc's own conversion table and treats it as zero terrain — otherwise every " +
      'treadmill run at the standard setting would be credited as a climb it was not.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Equivalent outdoor pace adjustment';
      const flatRows = t.rows.filter((r) => /^[≈~]?\s*outdoor flat\s*$/i.test((r[col] ?? '').trim()));
      if (flatRows.length !== 1) {
        throw new Error(
          `the conversion table has ${flatRows.length} grades marked "≈ outdoor flat" · expected exactly one`,
        );
      }
      const [docGrade] = parseBand(flatRows[0][t.headers[0]] ?? '');
      if (docGrade !== TREADMILL_AIR_RESISTANCE_GRADE_PCT) {
        throw new Error(
          `TREADMILL_AIR_RESISTANCE_GRADE_PCT is ${TREADMILL_AIR_RESISTANCE_GRADE_PCT}% but doctrine ` +
            `puts outdoor-flat equivalence at ${docGrade}%`,
        );
      }
      // The engine must therefore make that belt setting a genuine no-op.
      if (treadmillEffectiveGradePct(TREADMILL_AIR_RESISTANCE_GRADE_PCT) !== 0) {
        throw new Error('the outdoor-flat-equivalent belt grade is not being treated as flat');
      }
      if (gradeFactor(treadmillEffectiveGradePct(TREADMILL_AIR_RESISTANCE_GRADE_PCT), 'treadmill') !== 1) {
        throw new Error('a treadmill run at the air-resistance grade is still being adjusted');
      }
    },
  },
  {
    id: 'TERRAIN.treadmill-cost-per-pct',
    binds: ['lib/terrain/grade-adjust.ts#TREADMILL_COST_PER_PCT'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### General incline → outdoor pace conversion',
    claim:
      'Belt grade above the flat-equivalent setting costs a stated fraction more per percent, ' +
      'measured against the same belt speed. It is a different reference frame from outdoor ' +
      'grade and therefore a separate constant, not the outdoor number reused.',
    check({ cite }) {
      const m = cite.text().match(/each 1%\s*of treadmill grade adds\s*~?\s*(\d+(?:\.\d+)?)\s*%/i);
      if (!m) throw new Error('the treadmill incline cost sentence is no longer in this section');
      const doctrinePct = Number(m[1]);
      const enginePct = TREADMILL_COST_PER_PCT * 100;
      if (Math.abs(enginePct - doctrinePct) > 0.05) {
        throw new Error(
          `TREADMILL_COST_PER_PCT is ${enginePct}% per 1% belt grade · doctrine says ${doctrinePct}%`,
        );
      }
    },
  },
  {
    id: 'TERRAIN.conditions-compose-multiplicatively',
    binds: ['lib/terrain/grade-adjust.ts#composeEffortFactor'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Combined conditions',
    claim:
      'When more than one condition is working on a runner, the adjustments multiply rather ' +
      'than add. The engine has exactly one function that does that stacking, so a hot run on ' +
      'a hilly route cannot be forgiven twice by two paths that each account for the day.',
    check({ cite }) {
      const text = cite.text();
      if (!/multiplicativel?y,\s*not\s*additively/i.test(text)) {
        throw new Error('§Combined conditions no longer states multiplicative stacking');
      }
      if (!/base_pace\s*×\s*\(1\s*\+\s*heat_adj\)/i.test(text)) {
        throw new Error('the combined-conditions formula no longer shows the heat leg as (1 + heat_adj)');
      }
      const heatPct = 4;
      const grade = gradeFactor(2);
      const composed = composeEffortFactor({ heatSlowdownPct: heatPct, gradeFactor: grade });
      const expected = (1 + heatPct / 100) * grade;
      if (Math.abs(composed.factor - expected) > 1e-12) {
        throw new Error(
          `composeEffortFactor returned ${composed.factor} · doctrine's product is ${expected}`,
        );
      }
      // Neutral legs must leave the other alone, or "no heat" would quietly
      // cancel a real hill.
      if (composeEffortFactor({ heatSlowdownPct: 0, gradeFactor: grade }).factor !== grade) {
        throw new Error('a neutral heat leg is not passing the terrain factor through unchanged');
      }
      if (composeEffortFactor({ heatSlowdownPct: heatPct, gradeFactor: 1 }).factor !== 1 + heatPct / 100) {
        throw new Error('flat terrain is not passing the heat factor through unchanged');
      }
    },
  },

  // ══ TIER-2 DOCTRINE (readiness · tier · elevation · heat) ═══════════════════
  {
    id: 'ELEVATION.descent-gives-back-half',
    binds: [
      'lib/training/elevation-model.ts#DESCENT_RECOVERY_FRACTION',
      'lib/training/elevation-model.ts#MAX_DESCENT_CREDIT_S_PER_MI',
      'lib/training/elevation-model.ts#DESCENT_HARD_CAP_S_PER_MI',
    ],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Pacing Rule for Hilly Courses',
    claim:
      'Doctrine states both sides of a hill in seconds per mile: climbs add 10-30, descents ' +
      'shave 5-15 and never more than 20. So a descent hands back about half of what the ' +
      'matching climb took, the per-mile credit is capped at the top of the descent band, and ' +
      'the hard floor is the stated 20. All three come out of this one code block.',
    check({ cite }) {
      const text = cite.text();
      const climbLine = text.split('\n').find((l) => /On climbs:/.test(l));
      const descentLine = text.split('\n').find((l) => /On descents:/.test(l));
      if (!climbLine || !descentLine) {
        throw new Error('the hilly-course pacing block no longer states both a climb and a descent rule');
      }
      const [climbLo, climbHi] = parseBand(climbLine);
      const [descLo, descHi] = parseBand(descentLine);
      const ratio = ((descLo + descHi) / 2) / ((climbLo + climbHi) / 2);
      if (Math.abs(DESCENT_RECOVERY_FRACTION - ratio) > 0.02) {
        throw new Error(
          `DESCENT_RECOVERY_FRACTION is ${DESCENT_RECOVERY_FRACTION} · doctrine's bands ` +
            `(climb ${climbLo}-${climbHi}, descent ${descLo}-${descHi} s/mi) give ${ratio.toFixed(2)}`,
        );
      }
      if (MAX_DESCENT_CREDIT_S_PER_MI !== descHi) {
        throw new Error(`MAX_DESCENT_CREDIT_S_PER_MI is ${MAX_DESCENT_CREDIT_S_PER_MI}, doctrine shaves at most ${descHi} s/mi`);
      }
      const hardCap = parseBand(descentLine.slice(descentLine.indexOf('minus')))[0];
      if (DESCENT_HARD_CAP_S_PER_MI !== hardCap) {
        throw new Error(`DESCENT_HARD_CAP_S_PER_MI is ${DESCENT_HARD_CAP_S_PER_MI}, doctrine caps at goal pace minus ${hardCap} s/mi`);
      }
    },
  },
  {
    id: 'ELEVATION.grade-energy-cost',
    binds: ['lib/training/elevation-model.ts#ELEV_GRADE_COST_PER_PCT'],
    doc: 'Research/11-course-specific-training.md',
    anchor: 'Energy cost rises ~3.3% per 1% of grade',
    claim:
      'Uphill running costs a fixed fraction of pace per 1% of grade, and that fraction is ' +
      'stated in the doc. It used to live in two places at two values — the race-splits model ' +
      'read it correctly and the Targets course chunk invented +10 s/mi per 100 ft/mi, which ' +
      'lands 3-6x lighter. One constant now, read from the sentence itself.',
    check({ cite }) {
      const pct = parseBand(cite.section[0].replace(/up to.*$/, ''))[0];
      if (Math.abs(ELEV_GRADE_COST_PER_PCT - pct / 100) > 0.0005) {
        throw new Error(`ELEV_GRADE_COST_PER_PCT is ${ELEV_GRADE_COST_PER_PCT}, doctrine says ${pct}% per 1% of grade`);
      }
      // The old model is gone, not merely bypassed.
      const src = sourceOf('web-v2/lib/training/course-impact.ts');
      if (/NET_CLIMB_S_PER_MI_PER_100FT|GROSS_FATIGUE_S_PER_MI_PER_100FT/.test(src)) {
        throw new Error('course-impact.ts still defines its own per-100-ft elevation coefficients');
      }
      if (!/courseElevationCostSec/.test(src)) {
        throw new Error('course-impact.ts no longer calls the shared elevation model');
      }
    },
  },
  {
    // 2026-08-18 · doctrine sweep, "altitude/treadmill/terrain" item. This
    // sibling constant to TERRAIN.grade-model-ceiling was never bound — same
    // doctrine sentence, same shape of guard, different implementation
    // (elevation-model.ts's per-foot course-cost model vs grade-adjust.ts's
    // per-run judging model), just missed the first time.
    id: 'ELEVATION.grade-linear-limit',
    binds: ['lib/training/elevation-model.ts#GRADE_LINEAR_LIMIT_PCT'],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Mechanical Effects of Uphill Running',
    claim:
      'The linear per-percent energy cost is only claimed to hold up to a stated grade band. ' +
      'This model takes the conservative (lower) end of that band as its clamp, so a course-' +
      'library row with an extreme mean grade cannot be priced by extrapolating a relationship ' +
      'doctrine never claims past its stated range.',
    check({ cite }) {
      const m = cite.text().match(/up to\s*~?\s*(\d+)\s*[–-]\s*(\d+)\s*%/i);
      if (!m) throw new Error('the validity ceiling ("up to ~10–15%") is no longer stated in this section');
      within(GRADE_LINEAR_LIMIT_PCT, [Number(m[1]), Number(m[2])], 'GRADE_LINEAR_LIMIT_PCT');
    },
  },
  {
    id: 'HEAT.band-taxonomy-is-wbgt',
    binds: ['lib/coach/heat-gate.ts#WBGT_FLAGS', 'lib/coach/heat-gate.ts#heatBandForFlag'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '| WBGT (°F) | WBGT (°C) | Flag | Action |',
    claim:
      "Doctrine's heat taxonomy is the ACSM / Korey Stringer flag table, and the app had four " +
      'others: a slowdown-%% ladder on the verdict, a Tair ladder on the race projection, a ' +
      'different Tair ladder on the phone. Every band boundary and every flag name in the ' +
      'engine is read straight off this table, and the word the UI shows is a mapping of the ' +
      'flag rather than a scale of its own.',
    check({ cite }) {
      const t = cite.table();
      const docFlags = t.rows.map((r) => r['Flag'].toLowerCase());
      const engineFlags = WBGT_FLAGS.map((b) => b.flag);
      if (engineFlags.join(',') !== docFlags.join(',')) {
        throw new Error(`WBGT_FLAGS reads ${engineFlags.join(' · ')} · doctrine has ${docFlags.join(' · ')}`);
      }
      t.rows.forEach((row, i) => {
        const cell = row['WBGT (°F)'];
        const engine = WBGT_FLAGS[i].maxF;
        if (/^</.test(cell.trim())) {
          if (engine !== parseBand(cell)[0]) {
            throw new Error(`WBGT_FLAGS[${i}].maxF is ${engine}, doctrine's first band is ${cell}`);
          }
          return;
        }
        if (/^>/.test(cell.trim())) {
          if (engine !== Infinity) throw new Error(`WBGT_FLAGS[${i}].maxF is ${engine}, doctrine's last band is open-ended`);
          return;
        }
        const hi = parseBand(cell)[1];
        if (engine !== hi) throw new Error(`WBGT_FLAGS[${i}].maxF is ${engine}, doctrine's band ends at ${hi}`);
      });
      // The UI word must be a total mapping of the flag · a flag with no word
      // is a surface that will quietly invent one.
      for (const flag of new Set(engineFlags)) {
        if (heatBandForFlag(flag) == null) throw new Error(`flag "${flag}" maps to no display word`);
      }
      if (heatBandForFlag('unknown') != null) {
        throw new Error('an unknown flag maps to a heat word · a missing input must read as missing');
      }
    },
  },
  {
    id: 'HEAT.dewpoint-surcharge',
    binds: ['lib/training/heat-model.ts#dewpointAddPct'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: 'and +1% per 10°F dewpoint above 60°F',
    claim:
      'The dewpoint surcharge is additive on the temperature slowdown at the rate the ' +
      "quick-reference states, from the threshold it states. Every consumer gets it now — " +
      'before 2026-08-17 three of the five heat call sites never passed a dewpoint at all.',
    check({ cite }) {
      const line = cite.section[0].slice(cite.section[0].indexOf('dewpoint') - 30);
      const nums = line.match(/(\d+(?:\.\d+)?)/g)?.map(Number) ?? [];
      const [rate, per, threshold] = [nums[0], nums[1], nums[2]];
      if (dewpointAddPct(threshold) !== 0) {
        throw new Error(`the surcharge fires at exactly ${threshold}°F · doctrine says ABOVE it`);
      }
      const at = threshold + per;
      const got = dewpointAddPct(at);
      if (Math.abs(got - rate) > 0.001) {
        throw new Error(`dewpointAddPct(${at}) is ${got}% · doctrine says +${rate}% per ${per}°F above ${threshold}°F`);
      }
    },
  },
  {
    id: 'HEAT.interval-adjustment-is-half',
    binds: ['lib/training/heat-model.ts#INTERVAL_ADJUSTMENT_FACTOR'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: 'apply **half** the continuous-run adjustment',
    claim:
      'Repeats with recovery between them cool partially, so they take half the continuous-run ' +
      'heat adjustment. The halving lives in the shared model, applied by a flag on the ' +
      'conditions, not re-implemented at whichever call site happens to remember it.',
    check() {
      if (INTERVAL_ADJUSTMENT_FACTOR !== 0.5) {
        throw new Error(`INTERVAL_ADJUSTMENT_FACTOR is ${INTERVAL_ADJUSTMENT_FACTOR} · doctrine says half`);
      }
      const conditions = { tempF: 80, humidityPct: 60, durationS: 3600 } as const;
      const continuous = effortSlowdownPct(conditions);
      const repeats = effortSlowdownPct({ ...conditions, intervalStyle: true });
      if (Math.abs(repeats - continuous * 0.5) > 1e-9) {
        throw new Error(`repeats got ${repeats}% against ${continuous}% continuous · doctrine halves it`);
      }
    },
  },
  /**
   * 2026-08-21 · the largest unwatched physiology table in the app.
   *
   * `MAUGHAN_HEAT_SLOWDOWN` is twenty-seven numbers transcribed by hand from
   * `Research/06` §1, and every heat-adjusted pace, projection and race verdict
   * in the engine flows through it. Its own comment says "Research/06 §1 table,
   * verbatim" — which was true when it was written and is exactly the kind of
   * assertion that rots silently, because nothing read the doc back.
   *
   * The two adjacent columns are the trap this whole gate exists for. The doc
   * heads them "3:30 marathoner" and "4:30+ marathoner"; the engine names them
   * `midPaceMarathonerPct` and `slowMarathonerPct`. Read one row off by a
   * column and an eighty-degree morning costs a mid-pack runner 11.5% instead
   * of 7.5% — the same shape as the recovery-column defect in CLAUDE.md §Rule 7.
   */
  {
    id: 'HEAT.maughan-slowdown-table',
    binds: [
      'lib/training/heat-model.ts#MAUGHAN_HEAT_SLOWDOWN',
      'lib/training/heat-model.ts#maughanSlowdownPct',
    ],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '| Tair (°F) | Tair (°C) | Elite slowdown | 3:30 marathoner | 4:30+ marathoner |',
    claim:
      'Marathon slowdown against a 50F baseline is stated per air temperature and per ability, ' +
      'in three separate columns that widen with heat: at 90F an elite loses 6% where a 4:30 ' +
      'marathoner loses 19%. Every cell the engine carries is the cell doctrine states, in the ' +
      'column doctrine states it in.',
    check({ cite }) {
      const table = cite.table();
      // The doc's own column headings, not the engine's field names. Reading
      // them in the doc's order is what makes a column swap fail here.
      const COLUMNS = [
        ['Elite slowdown', 'elitePct'],
        ['3:30 marathoner', 'midPaceMarathonerPct'],
        ['4:30+ marathoner', 'slowMarathonerPct'],
      ] as const;

      const docRows = table.rows.filter((r) => /^\d+$/.test(String(r[table.headers[0]]).trim()));
      if (docRows.length !== MAUGHAN_HEAT_SLOWDOWN.length) {
        throw new Error(
          `doctrine states ${docRows.length} temperature rows, the engine carries ` +
            `${MAUGHAN_HEAT_SLOWDOWN.length} · a row was added or dropped without the table being re-read`,
        );
      }

      for (const [i, docRow] of docRows.entries()) {
        const tairF = Number(docRow[table.headers[0]]);
        const engineRow = MAUGHAN_HEAT_SLOWDOWN[i];
        if (engineRow.tairF !== tairF) {
          throw new Error(
            `row ${i} is ${tairF}F in doctrine and ${engineRow.tairF}F in the engine · the tables have ` +
              'drifted out of step, so every cell below this row is being compared against the wrong temperature',
          );
        }
        for (const [column, field] of COLUMNS) {
          // parseBand strips the "(optimum)" annotation on the 40/50F rows.
          const [want] = parseBand(table.cell(String(tairF), column));
          const got = engineRow[field];
          if (Math.abs(got - want) > 1e-9) {
            throw new Error(
              `at ${tairF}F doctrine's "${column}" is ${want}% and the engine's ${field} is ${got}%`,
            );
          }
        }
      }

      // The interpolator must agree with the table at the bracket points it
      // interpolates between, or the constant is right and nothing reads it.
      for (const [column, field] of COLUMNS) {
        const tier = field === 'elitePct' ? 'elite' : field === 'midPaceMarathonerPct' ? 'mid_pack' : 'slow';
        for (const row of MAUGHAN_HEAT_SLOWDOWN) {
          const got = maughanSlowdownPct(row.tairF, tier);
          if (Math.abs(got - row[field]) > 1e-9) {
            throw new Error(
              `maughanSlowdownPct(${row.tairF}, '${tier}') is ${got}% but doctrine's "${column}" row says ${row[field]}%`,
            );
          }
        }
      }

      // Below the optimum there is no penalty · the doc's baseline sentence
      // ("relative to the same runner's expected time at 50 F") read as a rule.
      if (maughanSlowdownPct(45, 'slow') !== 0 || maughanSlowdownPct(50, 'slow') !== 0) {
        throw new Error('the model charges a heat penalty at or below the 50F optimum');
      }

      // And the three columns must stay ORDERED at every temperature doctrine
      // states one. The doc's own rule under the table: "faster runners
      // accumulate less heat over the race; slower runners ... slow
      // disproportionately." An unordered set of columns means they were
      // transcribed into the wrong fields even if every number is present.
      for (const row of MAUGHAN_HEAT_SLOWDOWN) {
        if (!(row.elitePct <= row.midPaceMarathonerPct && row.midPaceMarathonerPct <= row.slowMarathonerPct)) {
          throw new Error(
            `at ${row.tairF}F the columns are out of order (${row.elitePct} / ${row.midPaceMarathonerPct} / ` +
              `${row.slowMarathonerPct}) · doctrine says the slower runner always pays more`,
          );
        }
      }

      // The tier the engine picks decides WHICH column a runner is charged, so
      // it is part of the same claim. Daniels' marathon bands: the doc's own
      // column headings are a 3:30 and a 4:30+ marathoner, which is the split
      // abilityTierFromVdot implements.
      if (abilityTierFromVdot(65) !== 'elite' || abilityTierFromVdot(50) !== 'mid_pack' || abilityTierFromVdot(38) !== 'slow') {
        throw new Error('abilityTierFromVdot no longer separates the three columns doctrine states');
      }

      // ── Rule 9 · the ability axis is interpolated, like every other axis ──
      //
      // Every other axis of this model is continuous — temperature between the
      // rows above, dewpoint, duration. Ability was two hard steps, worth up to
      // 7 points of slowdown for a hundredth of a VDOT at 90F, running the
      // WRONG WAY (the fitter runner's heat allowance collapsed). The columns
      // are still reproduced exactly, and the whole cited mid-pack band still
      // gets the mid-pack column — an anchor outside its own band would price a
      // runner as a tier doctrine does not put him in.
      for (const row of MAUGHAN_HEAT_SLOWDOWN) {
        if (row.tairF <= 50) continue;
        for (let v = 45; v <= 60; v += 0.5) {
          if (Math.abs(maughanSlowdownPctForVdot(row.tairF, v) - row.midPaceMarathonerPct) > 1e-9) {
            throw new Error(
              `VDOT ${v} is inside the cited 45-60 mid-pack band but is charged ` +
                `${maughanSlowdownPctForVdot(row.tairF, v)}% at ${row.tairF}F, not the column's ` +
                `${row.midPaceMarathonerPct}% · an anchor outside its own band prices a runner ` +
                'as a tier doctrine does not put him in',
            );
          }
        }
        let prev = maughanSlowdownPctForVdot(row.tairF, 25);
        for (let v = 25.01; v <= 80; v += 0.01) {
          const vdot = Math.round(v * 100) / 100;
          const cur = maughanSlowdownPctForVdot(row.tairF, vdot);
          if (cur > prev + 1e-9) {
            throw new Error(
              `heat slowdown ROSE with fitness at VDOT ${vdot}, ${row.tairF}F · ` +
                'the fitter runner may not be handed the larger penalty',
            );
          }
          if (Math.abs(cur - prev) > 0.05) {
            throw new Error(
              `heat slowdown steps ${Math.abs(cur - prev).toFixed(2)} points at VDOT ${vdot}, ` +
                `${row.tairF}F · the ability axis must interpolate like the temperature axis (Rule 9)`,
            );
          }
          prev = cur;
        }
      }
    },
  },
  /* ── 2026-08-21 · the eight heat thresholds that cited LINE NUMBERS ────────
   *
   * `lib/coach/heat-gate.ts` carries the highest line-number-citation debt in
   * the repo — `Research/06:483`, `:493`, `:496` and a dozen more. Rule 7's
   * first instruction is "anchor on quoted text, never a line number", and
   * these eight constants were guarded only by hand-written `.toBe(85)`
   * assertions in `_heat_doctrine.test.ts` that hardcode both sides. A test
   * that hardcodes both sides only proves the test agrees with itself, which
   * is the exact failure this gate exists to stop.
   *
   * The three claims below read the numbers back out of the doc's own tables.
   * They also close a bug the file's own header records: the shipped code
   * applied the WBGT number, 75, to AIR temperature, so an ordinary 75F morning
   * counted as heat-acclimation stimulus. Two adjacent thresholds in one
   * sentence, swapped — the same shape as the recovery columns in CLAUDE.md
   * §Rule 7, and the reason both are asserted against the sentence itself.
   */
  {
    id: 'HEAT.acclimation-dose-thresholds',
    binds: [
      'lib/coach/heat-gate.ts#HEAT_DOSE_TAIR_F',
      'lib/coach/heat-gate.ts#HEAT_DOSE_WBGT_F',
    ],
    doc: 'Research/06-weather-adjustments.md',
    anchor: 'Heat dose:   Tair ≥85°F or WBGT ≥75°F; or post-run sauna 25–40 min @ 175–195°F',
    claim:
      'A session only counts as heat-acclimation stimulus above one threshold in AIR temperature ' +
      'and a different, lower one in WBGT. They are two numbers in one sentence and they are not ' +
      'interchangeable: applying the WBGT number to air temperature turns an ordinary 75F morning ' +
      'into adaptation the runner never got.',
    check({ cite }) {
      const m = cite.section[0].match(/Tair\s*≥\s*(\d+)\s*°F\s*or\s*WBGT\s*≥\s*(\d+)\s*°F/);
      if (!m) {
        throw new Error(
          'the heat-dose sentence no longer states an air temperature and a WBGT · re-read the protocol block',
        );
      }
      const [tair, wbgt] = [Number(m[1]), Number(m[2])];
      if (HEAT_DOSE_TAIR_F !== tair) {
        throw new Error(`HEAT_DOSE_TAIR_F is ${HEAT_DOSE_TAIR_F}, doctrine's air-temperature dose is ${tair}F`);
      }
      if (HEAT_DOSE_WBGT_F !== wbgt) {
        throw new Error(`HEAT_DOSE_WBGT_F is ${HEAT_DOSE_WBGT_F}, doctrine's WBGT dose is ${wbgt}F`);
      }
      // The swap that shipped. WBGT is a composite that already includes air
      // temperature, so its threshold is necessarily the lower of the two —
      // which is what made the mistake silent rather than obvious.
      if (!(HEAT_DOSE_WBGT_F < HEAT_DOSE_TAIR_F)) {
        throw new Error(
          'the WBGT dose is no longer below the air-temperature dose · the two thresholds have been ' +
            'swapped or equalised, which is how a 75F morning became acclimation stimulus once already',
        );
      }
    },
  },
  {
    id: 'HEAT.time-on-feet-triggers',
    binds: [
      'lib/coach/heat-gate.ts#TD_TIME_ON_FEET_F',
      'lib/coach/heat-gate.ts#WBGT_TIME_ON_FEET_F',
      'lib/coach/heat-gate.ts#AQI_TIME_ON_FEET_LOW',
    ],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '### When to convert to time-on-feet (drop pace targets)',
    claim:
      'Past a stated dewpoint, WBGT or air-quality index, a session stops carrying a pace target ' +
      'and becomes time on feet. The engine holds the three triggers doctrine states in that ' +
      'table, at the numbers the table states them at, and the two it does not implement are ' +
      'recorded as violations rather than dropped.',
    check({ cite, exempt }) {
      const table = cite.table();
      const triggers = table.rows.map((r) => String(r[table.headers[0]]));
      /** The number on the row whose trigger text matches, read at run time. */
      const trigger = (re: RegExp, what: string): number => {
        const row = triggers.find((t) => re.test(t));
        if (!row) {
          throw new Error(
            `doctrine no longer lists a ${what} trigger for time-on-feet · rows are: ${triggers.join(' · ')}`,
          );
        }
        return parseBand(row)[0];
      };
      const cases: ReadonlyArray<readonly [RegExp, string, number, string]> = [
        [/^Td\b/, 'dewpoint', TD_TIME_ON_FEET_F, 'TD_TIME_ON_FEET_F'],
        [/^WBGT\b/, 'WBGT', WBGT_TIME_ON_FEET_F, 'WBGT_TIME_ON_FEET_F'],
        [/^AQI\b/, 'air-quality', AQI_TIME_ON_FEET_LOW, 'AQI_TIME_ON_FEET_LOW'],
      ];
      for (const [re, what, engine, name] of cases) {
        const want = trigger(re, what);
        if (engine !== want) throw new Error(`${name} is ${engine}, doctrine's ${what} trigger is ${want}`);
      }
      // Two triggers doctrine states here have no engine constant at all.
      // Recorded rather than quietly dropped — the exemption is what makes the
      // gap visible in CI instead of invisible in a comment.
      const gate = sourceOf('web-v2/lib/coach/heat-gate.ts');
      if (!/WIND_TIME_ON_FEET_MPH/.test(gate) && !exempt('wind-trigger-unimplemented')) {
        throw new Error('no engine constant converts a session to time-on-feet on sustained wind');
      }
      if (!/ALTITUDE_TIME_ON_FEET_FT/.test(gate) && !exempt('altitude-trigger-unimplemented')) {
        throw new Error('no engine constant converts a session to time-on-feet on altitude exposure');
      }
    },
    exempt: {
      'wind-trigger-unimplemented':
        'Research/06 §11 states "Wind ≥20 mph sustained | Intervals: time-based or move to track loops" ' +
        'and the engine has no constant for it. The wind machinery that exists (WIND_GATE_MPH, the ' +
        'headwind and tailwind tables) discounts a RACE RESULT after the fact; nothing changes what is ' +
        'prescribed on a windy morning. Recorded rather than fixed here because adding a trigger means ' +
        'deciding what the phone says when a session loses its pace target, which is a surface decision.',
      'altitude-trigger-unimplemented':
        'Research/06 §11 states "Altitude >7,000 ft + first 7 days | Time-on-feet only; no quality" and ' +
        'the engine has no constant for it. This is the same gap CLAUDE.md §Rule 7 records as "altitude ' +
        'pace conversions": altitude reaches the engine only through race representativeness, never ' +
        'through prescription, so there is no altitude-aware training path for this trigger to sit on.',
    },
  },
  {
    id: 'HEAT.hard-bail-triggers',
    binds: [
      'lib/coach/heat-gate.ts#WBGT_BAIL_F',
      'lib/coach/heat-gate.ts#TD_BAIL_F',
      'lib/coach/heat-gate.ts#AQI_BAIL',
    ],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '### Hard bail triggers (cancel/postpone)',
    claim:
      'Past a stated WBGT, dewpoint or air-quality index the session is cancelled rather than ' +
      'adjusted. These are the outermost thresholds in the app and the only ones where the right ' +
      'answer is to send the runner home, so each must be the number doctrine states and each must ' +
      'sit outside its own time-on-feet trigger.',
    check({ cite }) {
      const table = cite.table();
      const triggers = table.rows.map((r) => String(r[table.headers[0]]));
      const trigger = (re: RegExp, what: string): number => {
        const row = triggers.find((t) => re.test(t));
        if (!row) {
          throw new Error(`doctrine no longer lists a ${what} bail trigger · rows are: ${triggers.join(' · ')}`);
        }
        return parseBand(row)[0];
      };
      const cases: ReadonlyArray<readonly [RegExp, string, number, string, number]> = [
        [/^WBGT\b/, 'WBGT', WBGT_BAIL_F, 'WBGT_BAIL_F', WBGT_TIME_ON_FEET_F],
        [/^Td\b/, 'dewpoint', TD_BAIL_F, 'TD_BAIL_F', TD_TIME_ON_FEET_F],
        [/^AQI\b/, 'air-quality', AQI_BAIL, 'AQI_BAIL', AQI_TIME_ON_FEET_LOW],
      ];
      for (const [re, what, engine, name, softer] of cases) {
        const want = trigger(re, what);
        if (engine !== want) throw new Error(`${name} is ${engine}, doctrine's ${what} bail trigger is ${want}`);
        if (!(engine > softer)) {
          throw new Error(
            `${name} (${engine}) is not above its own time-on-feet trigger (${softer}) · the ladder has ` +
              'collapsed, so a runner is sent home at the condition that was only meant to drop the pace target',
          );
        }
      }
      // The black-flag bail must agree with the top of the WBGT flag table it
      // shares a doc section with. One ACSM number, transcribed twice.
      const blackFlagTop = WBGT_FLAGS[WBGT_FLAGS.length - 2]?.maxF;
      if (blackFlagTop !== WBGT_BAIL_F) {
        throw new Error(
          `the WBGT flag table's last bounded band ends at ${blackFlagTop}F and WBGT_BAIL_F is ${WBGT_BAIL_F} · ` +
            'the same ACSM black-flag threshold is transcribed twice and the copies disagree',
        );
      }
    },
  },
  {
    id: 'HR.heat-confounder-band',
    binds: ['lib/weather/heat-adjustment.ts#HEAT_HR_CONFOUNDER', 'lib/weather/heat-adjustment.ts#heatHrBumpBpm'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| Confounder | Effect at fixed effort | Magnitude |',
    claim:
      'Heat raises HR at fixed effort by the amount this table states, from the temperature ' +
      'this table states. The engine used to claim "~1 bpm per 1°F above ~60°F" and cite it to ' +
      'Research/06 §1, which carries no bpm number anywhere — and the code did not implement ' +
      "its own comment either. Both ends of the band and the threshold are read from the row.",
    check({ cite }) {
      const row = cite.table().row('Heat (≥25°C)');
      const [lo, hi] = parseBand(row['Magnitude']);
      if (HEAT_HR_CONFOUNDER.bandBpm[0] !== lo || HEAT_HR_CONFOUNDER.bandBpm[1] !== hi) {
        throw new Error(`HEAT_HR_CONFOUNDER band is ${HEAT_HR_CONFOUNDER.bandBpm.join('-')} bpm, doctrine says ${lo}-${hi}`);
      }
      // "Heat (≥25°C)" · the threshold sits inside the row label, in Celsius,
      // and parseBand strips parenthesised text — read it off the label direct.
      const label = row[cite.table().headers[0]];
      const c = label.match(/(\d+(?:\.\d+)?)\s*°?C/);
      if (!c) throw new Error(`the heat confounder row no longer states a temperature: "${label}"`);
      const thresholdC = Number(c[1]);
      const thresholdF = Math.round(thresholdC * 9 / 5 + 32);
      if (HEAT_HR_CONFOUNDER.thresholdF !== thresholdF) {
        throw new Error(`HEAT_HR_CONFOUNDER.thresholdF is ${HEAT_HR_CONFOUNDER.thresholdF}, doctrine's ${thresholdC}°C is ${thresholdF}°F`);
      }
      if (heatHrBumpBpm(thresholdF - 1) !== 0) {
        throw new Error('a heat HR bump is claimed below the doctrine threshold');
      }
      within(heatHrBumpBpm(thresholdF), [lo, hi], 'heatHrBumpBpm at the threshold');
      within(heatHrBumpBpm(120), [lo, hi], 'heatHrBumpBpm well above the band');
    },
  },
  // ══ SEX-SPECIFIC / CYCLE-PHASE ════════════════════════════════════════════
  /**
   * 2026-08-18 · doctrine sweep, "not yet seeded" item (CLAUDE.md listed this
   * as "age and sex grading, Research/13 + Research/24" — that specific VDOT
   * age/sex-tier feature does not exist in the engine yet; Research/24's own
   * "Implementation notes" describes it as a future localStorage-backed UI
   * concept, and pace targets are explicitly meant to keep flowing from raw
   * VDOT even once built. Nothing to bind there. What DOES exist and run in
   * production is Research/13's menstrual-cycle-phase adjustment, in two
   * places: the luteal HRV-baseline allowance (readiness.ts, below) and the
   * luteal HR-elevation insight (cycle-performance.ts, next claim).
   */
  {
    id: 'CONVENTION.luteal-hrv-allowance',
    binds: ['lib/coach/readiness.ts#lutealAdjustedHrvBaseline'],
    doc: 'Research/13-sex-specific-training.md',
    anchor: '| Wearable HRV / resting HR | Indirect via P4 | Trends with phase | Signal often swamped by training/sleep noise |',
    claim:
      'THE 5ms LUTEAL HRV ALLOWANCE IS A CONVENTION, NOT A RESEARCH FINDING. It cited "Luteal ' +
      'HRV runs 5-10ms lower · Research/13" for a specific millisecond figure that appears ' +
      'nowhere in the doc. What Research/13 actually says (this table row): wearable HRV ' +
      '"trends with phase" but the signal is "often swamped by training/sleep noise" — real ' +
      'grounding for a qualitative shift, and if anything a caution against a precise number, ' +
      'not a citation for one. The allowance stays (deleting it would re-flag ordinary luteal ' +
      'HRV dips as "below baseline," the false alarm doctrine warns against) but as a bounded, ' +
      'honestly-labelled convention: small relative to a typical baseline, floored so the ' +
      'adjusted baseline can never go non-positive, and gated strictly to female + luteal.',
    check({ cite }) {
      const src = sourceOf('web-v2/lib/coach/readiness.ts');
      // The unique phrase from the ORIGINAL fabricated claim (distinct from
      // this claim's own honest disclosure, which quotes the old wording
      // without the words "regardless of fitness").
      if (/5-10ms lower regardless of fitness/.test(src)) {
        throw new Error('the fabricated "5-10ms lower regardless of fitness" citation is back in readiness.ts');
      }
      if (!/THE 5ms SHIFT IS A CONVENTION, NOT A RESEARCH FINDING/.test(src)) {
        throw new Error('readiness.ts no longer states the luteal HRV allowance is a convention');
      }
      const shift = Number(matchLiteral(src, /Math\.max\(1, baseline - (\d+)\)/, 'lutealAdjustedHrvBaseline shift')[1]);
      // Bounded · a shift has to be small relative to a real HRV baseline (the
      // comment's own worked example is ~60ms) or it stops being an allowance
      // and starts manufacturing readiness. 15ms would be a quarter of that.
      if (!(shift > 0 && shift <= 15)) {
        throw new Error(`lutealAdjustedHrvBaseline shift = ${shift}ms is outside a defensible range`);
      }
      const floorMatch = matchLiteral(src, /Math\.max\((\d+), baseline - \d+\)/, 'lutealAdjustedHrvBaseline floor');
      if (Number(floorMatch[1]) < 1) {
        throw new Error('lutealAdjustedHrvBaseline no longer floors the adjusted baseline above zero');
      }
      if (!/biologicalSex === 'female' && cyclePhase === 'luteal'/.test(src)) {
        throw new Error('lutealAdjustedHrvBaseline no longer gates strictly on female + luteal');
      }
      // The doctrine row this rests on must still say what it says — a real
      // signal, explicitly noisy, not a precise millisecond finding.
      if (!/swamped by training\/sleep noise/i.test(cite.text())) {
        throw new Error(
          'Research/13\'s HRV cycle-tracking row no longer calls the signal noisy · re-read ' +
            'before this convention is justified again',
        );
      }
    },
  },
  {
    id: 'CYCLE.luteal-hr-elevation-threshold',
    binds: ['lib/coach/cycle-performance.ts#computeCyclePerformance'],
    doc: 'Research/13-sex-specific-training.md',
    anchor: 'Luteal phase elevates submaximal HR ~3–5 bpm (P4-driven plasma volume drop).',
    claim:
      'Doctrine states a real, measurable magnitude here (unlike the luteal HRV allowance ' +
      'above): submaximal HR runs ~3-5 bpm higher in luteal vs follicular, driven by ' +
      'progesterone\'s plasma-volume effect. The per-runner insight that flags "HR runs N bpm ' +
      'higher in luteal" must fire at a threshold inside this doctrine band — below it, ordinary ' +
      'day-to-day HR noise gets mislabeled a cycle signal; above it, the exact magnitude ' +
      'doctrine says is real goes unreported.',
    check({ cite }) {
      const sentence = cite.text().match(/Luteal phase elevates submaximal HR [^\n]*bpm[^\n]*\./)?.[0];
      if (!sentence) {
        throw new Error('DOCTRINE · the luteal HR-elevation sentence is gone from Research/13 §1.4');
      }
      const [lo, hi] = parseBand(sentence);
      const src = sourceOf('web-v2/lib/coach/cycle-performance.ts');
      const threshold = Number(matchLiteral(src, /hrDelta > (\d+)/, 'luteal HR-elevation insight threshold')[1]);
      within(threshold, [lo, hi], 'cycle-performance.ts luteal HR-elevation insight threshold');
    },
  },

  {
    id: 'READINESS.hrv-floor',
    binds: ['lib/coach/readiness.ts#READINESS_WEIGHTS'],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: 'Below 40% under-uses the signal; above 50% breaks on noisy nights',
    claim:
      'HRV carries a stated floor as well as a target. The methodology says below 40% ' +
      'under-uses the signal and above 50% lets one bad PPG night swing the read, so the ' +
      "engine's HRV weight has to sit inside that band — both ends of it.",
    check({ cite }) {
      // The sentence states the two edges separately ("Below 40%… above 50%"),
      // so read them as the standalone percentages on the line rather than as
      // a dashed band.
      const nums = (cite.section[0].match(/\d+(?:\.\d+)?%/g) ?? []).map((s) => Number(s.replace('%', '')));
      if (nums.length < 2) {
        throw new Error('the HRV weight sentence no longer states two bounds · re-read the claim');
      }
      within(READINESS_WEIGHTS.hrv * 100, [Math.min(...nums), Math.max(...nums)], 'READINESS_WEIGHTS.hrv (%)');
    },
  },
  {
    id: 'READINESS.load-cannot-create-a-score',
    binds: ['lib/coach/readiness.ts#computeReadiness'],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: "create* a score; it can only modulate one",
    claim:
      'A runner with training history but no biometrics has no readiness score. Load can move ' +
      'a reading that exists; it cannot conjure one, and it cannot lift a score past the ' +
      "ceiling the day's own pillars could have reached.",
    check() {
      const runsButNoBiometrics = {
        sleep7Avg: null, hrvCurrent: null, hrvBaseline: null,
        rhrCurrent: null, rhrBaseline: null,
        hrRecoveryCurrent: null, hrRecoveryBaseline: null,
        loadAcwr: 1.15, loadAcute7: 4.6, loadChronic28: 4,
      } as unknown as Parameters<typeof computeReadiness>[0];
      const r = computeReadiness(runsButNoBiometrics);
      if (r.score !== null) {
        throw new Error(`a runner with only run history scored ${r.score} · load created a score out of nothing`);
      }
      // A real biometric day, with the freshest possible load bonus, must not
      // exceed what the pillars alone could have produced.
      const neutralDay = {
        sleep7Avg: 7.5, hrvCurrent: 60, hrvBaseline: 60,
        rhrCurrent: 50, rhrBaseline: 50,
        hrRecoveryCurrent: null, hrRecoveryBaseline: null,
        loadAcwr: 0.5, loadAcute7: 2, loadChronic28: 4,
      } as unknown as Parameters<typeof computeReadiness>[0];
      const fresh = computeReadiness(neutralDay);
      const maxedPillars = {
        ...neutralDay, hrvCurrent: 200, rhrCurrent: 20, sleep7Avg: 12,
      } as unknown as Parameters<typeof computeReadiness>[0];
      const ceiling = computeReadiness({ ...maxedPillars, loadAcwr: 1.15 } as never).score ?? 100;
      if ((fresh.score ?? 0) > ceiling) {
        throw new Error(`the load bonus lifted a neutral day to ${fresh.score}, past the pillar ceiling ${ceiling}`);
      }
    },
  },
  {
    id: 'READINESS.load-is-a-multiplier',
    binds: [
      'lib/coach/readiness.ts#LOAD_CONTEXT_MULTIPLIER',
      'lib/coach/readiness.ts#loadContextMultiplier',
    ],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: 'multiplier in the range [0.85, 1.10] applied after the biometric composite',
    claim:
      'Training load modulates the composite, it is not a pillar of it. Every value the ' +
      'multiplier can take sits inside the stated range, the penalty and bonus point the way ' +
      'doctrine says (penalise an ACWR spike, reward planned freshness), and the score module ' +
      'multiplies rather than adds.',
    check({ cite }) {
      // The range is written `[0.85, 1.10]` — a comma pair, not a dashed band.
      const m = cite.section[0].match(/\[\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*\]/);
      if (!m) throw new Error('the load-multiplier sentence no longer states a [lo, hi] range');
      const [lo, hi] = [Number(m[1]), Number(m[2])] as [number, number];
      for (const [name, v] of Object.entries(LOAD_CONTEXT_MULTIPLIER)) {
        within(v, [lo, hi], `LOAD_CONTEXT_MULTIPLIER.${name}`);
      }
      // Direction, straight from the sentence: "penalize when ATL spike +
      // ACWR > 1.5; bonus when ATL drops in a planned taper".
      const spike = loadContextMultiplier(1.7, 8, 4);
      if (!(spike < 1)) throw new Error(`ACWR 1.7 gives multiplier ${spike} · doctrine penalises an ATL spike`);
      const fresh = loadContextMultiplier(0.6, 2, 4);
      if (!(fresh > 1)) throw new Error(`ACWR 0.6 gives multiplier ${fresh} · doctrine rewards a planned taper`);
      const sweet = loadContextMultiplier(1.15, 4.6, 4);
      if (sweet !== 1) throw new Error(`a sweet-spot ACWR gives ${sweet} · the sweet spot is neutral, not a bonus`);
      // And it is genuinely applied as a multiplier on the finished composite.
      matchLiteral(
        sourceOf('web-v2/lib/coach/readiness.ts'),
        /Math\.min\(composite \* loadMult, pillarCeiling\)/,
        'lib/coach/readiness.ts#computeReadiness · post-composite multiplier',
      );
    },
  },
  {
    id: 'READINESS.acwr-is-a-slope-not-a-stop-light',
    binds: ['lib/coach/readiness.ts#LOAD_CONTEXT_CURVE', 'lib/coach/readiness.ts#loadContextMultiplier'],
    doc: 'Research/15-wearable-data.md',
    anchor: '### Acute:Chronic Workload Ratio (ACWR)',
    claim:
      'Rule 9 · Gabbett\'s zone edges are kept exactly and the response runs continuously ' +
      'THROUGH them rather than stepping AT them. The section that publishes the zones also ' +
      'publishes how to spend them — "treat ACWR as a directional sanity check, not a ' +
      'stop-light ... a ratio of 1.4 in itself is not a verdict" — and a step function is a ' +
      'stop-light. The old four-branch form dropped the readiness score 5% between ACWR 1.300 ' +
      'and 1.301, on a ratio of two rolling averages that moves that far when one easy run ' +
      'lands the far side of midnight, and it handed 1.4 the full elevated penalty. The band ' +
      'edges are read out of the doc\'s own zone table; the sweet spot stays flat so no runner ' +
      'banks points for an ordinary week.',
    check({ cite }) {
      const text = cite.text();
      // The doc's own zone edges, read out of its own table rather than
      // hardcoded — a claim that hardcodes both sides only proves the test
      // agrees with itself (Rule 18).
      const zones = cite.table();
      const edges = new Set<number>();
      for (const row of zones.rows) {
        for (const m of (row[zones.headers[0]] ?? '').matchAll(/\d*\.?\d+/g)) {
          edges.add(Number(m[0]));
        }
      }
      for (const want of [0.8, 1.3, 1.5]) {
        if (!edges.has(want)) {
          throw new Error(
            `Research/15's ACWR zone table no longer publishes the ${want} edge · ` +
              `found ${[...edges].sort((a, b) => a - b).join(', ')}`,
          );
        }
      }
      // Every edge the doc names is a control point of the curve.
      const xs = new Set(LOAD_CONTEXT_CURVE.map(([x]) => x));
      for (const want of [0.8, 1.3, 1.5]) {
        if (!xs.has(want)) {
          throw new Error(
            `doctrine's ACWR edge ${want} is not a control point of LOAD_CONTEXT_CURVE ` +
              `(${[...xs].join(', ')}) · the cited number must be kept, not moved`,
          );
        }
      }
      // The instruction that makes a step function wrong must still be there.
      if (!/not a stop-?light/i.test(text)) {
        throw new Error(
          'Research/15 no longer says to treat ACWR as "not a stop-light" · the continuity ' +
            'of loadContextMultiplier rests on that sentence',
        );
      }
      if (!/1\.4 in itself is not a verdict/i.test(text)) {
        throw new Error('Research/15 no longer names 1.4 as "not a verdict"');
      }
      // And the engine actually behaves that way. A step anywhere across the
      // bands fails this, which is the whole point.
      let prev = loadContextMultiplier(0.4, 1.6, 4);
      let worst = 0;
      let worstAt = 0;
      for (let r = 0.401; r <= 2.2; r += 0.001) {
        const acwr = Math.round(r * 1000) / 1000;
        const cur = loadContextMultiplier(acwr, acwr * 4, 4);
        if (cur - prev > 1e-9) {
          throw new Error(`the load multiplier ROSE with load at ACWR ${acwr}`);
        }
        if (Math.abs(cur - prev) > worst) { worst = Math.abs(cur - prev); worstAt = acwr; }
        prev = cur;
      }
      if (worst > 0.002) {
        throw new Error(
          `the load multiplier steps ${worst.toFixed(4)} at ACWR ${worstAt.toFixed(3)} · ` +
            'Research/15 asks for a directional read, not a stop-light (Rule 9)',
        );
      }
      // 1.4 is a nudge, never the full verdict the doc rules out.
      const m14 = loadContextMultiplier(1.4, 5.6, 4);
      if (!(m14 < LOAD_CONTEXT_MULTIPLIER.neutral && m14 > LOAD_CONTEXT_MULTIPLIER.elevated)) {
        throw new Error(
          `ACWR 1.4 gives ${m14} · the doc names 1.4 as "not a verdict", so it must sit ` +
            'between neutral and the elevated value, not on either',
        );
      }
      // The sweet spot earns nothing · the 2026-08-17 audit's own finding.
      if (loadContextMultiplier(1.15, 4.6, 4) !== LOAD_CONTEXT_MULTIPLIER.neutral) {
        throw new Error('a sweet-spot ACWR has stopped being neutral');
      }
    },
  },
  {
    id: 'READINESS.pillar-weights',
    binds: ['lib/coach/readiness.ts#READINESS_WEIGHTS'],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: '| Input | Weight | Source-of-truth metric | Baseline | Confidence floor |',
    claim:
      'The readiness pillars are weighted by signal fidelity, and the methodology names the ' +
      'split: HRV highest, sleep next, RHR last. The engine had HRV and sleep tied at 28% ' +
      'each, which inverts the ordering — sleep is one night of sample, HRV is a seven-day ' +
      'trend. Each weight is read out of the table at run time.',
    check({ cite }) {
      const t = cite.table();
      const want = (row: string) => parseBand(t.cell(row, 'Weight'))[0] / 100;
      const pairs: Array<[string, number]> = [
        ['HRV (LnRMSSD)', READINESS_WEIGHTS.hrv],
        ['RHR', READINESS_WEIGHTS.rhr],
        ['Sleep Quality Index', READINESS_WEIGHTS.sleep],
        ['Training-load context', READINESS_WEIGHTS.load],
      ];
      for (const [row, engine] of pairs) {
        const doctrine = want(row);
        if (Math.abs(engine - doctrine) > 0.005) {
          throw new Error(`READINESS_WEIGHTS for "${row}" is ${engine}, doctrine says ${doctrine}`);
        }
      }
      // The ordering claim itself, not just the numbers · a future edit that
      // moved all three by the same amount would still have to keep this.
      if (!(READINESS_WEIGHTS.hrv > READINESS_WEIGHTS.sleep && READINESS_WEIGHTS.sleep > READINESS_WEIGHTS.rhr)) {
        throw new Error('pillar weights no longer run HRV > sleep > RHR · that ordering is the fidelity claim');
      }
    },
  },
  {
    id: 'TIER.acwr-bands-have-no-tier-dimension',
    binds: ['lib/coach/tier-rules.ts#ACWR_BANDS', 'lib/coach/tier-rules.ts#tierRulesFor'],
    doc: 'Research/15-wearable-data.md',
    anchor: '| ACWR | Zone |',
    claim:
      "Gabbett's zones are one table with no experience column. The engine used to raise the " +
      'caution line to 1.5 and the danger line to 1.9 for advanced_plus, which loosens the ' +
      'safety threshold for the runners carrying the most load. Every tier now reads the same ' +
      "boundaries, and those boundaries are the doc's own.",
    check({ cite }) {
      const t = cite.table();
      const boundary = (label: string) => parseBand(t.row(label)[t.headers[0]])[0];
      const detraining = boundary('< 0.8');
      const caution = parseBand(t.row('1.3 – 1.5')[t.headers[0]])[0];
      const danger = boundary('> 1.5');
      const pairs: Array<[string, number, number]> = [
        ['detraining', ACWR_BANDS.detraining, detraining],
        ['caution', ACWR_BANDS.caution, caution],
        ['danger', ACWR_BANDS.danger, danger],
      ];
      for (const [name, engine, doctrine] of pairs) {
        if (engine !== doctrine) throw new Error(`ACWR_BANDS.${name} is ${engine}, doctrine says ${doctrine}`);
      }
      const tiers: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus'];
      for (const tier of tiers) {
        const r = tierRulesFor(tier, 55);
        if (r.acwrCaution !== ACWR_BANDS.caution || r.acwrSpike !== ACWR_BANDS.danger
          || r.acwrDetraining !== ACWR_BANDS.detraining) {
          throw new Error(`tier "${tier}" carries its own ACWR thresholds · doctrine has no tier dimension`);
        }
      }
    },
  },
  {
    id: 'TIER.sleep-floor-rises-with-mileage',
    binds: [
      'lib/coach/tier-rules.ts#SLEEP_TARGET_BY_MPW',
      'lib/coach/tier-rules.ts#sleepFloorForMileage',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### 20–40 mpw',
    claim:
      'The sleep requirement scales UP with weekly mileage — 7.5-9 h at 20-40 mpw through ' +
      '9-10 h at 80+. The engine used to scale it DOWN with experience (6.8 h beginner, 6.0 ' +
      'advanced_plus), which relaxed the bar for exactly the runners doctrine raises it for. ' +
      'The four rows are read out of their own tables and the floor is each row\'s target ' +
      'less one fixed tolerance.',
    check({ cite }) {
      const rows: Array<[string, number]> = [
        ['### 20–40 mpw', 30],
        ['### 40–60 mpw', 50],
        ['### 60–80 mpw', 70],
        ['### 80+ mpw', 95],
      ];
      let previous = 0;
      rows.forEach(([anchor, mpw], i) => {
        const section = i === 0
          ? cite
          : resolveCitation('Research/00b-recovery-protocols.md', anchor);
        const target = parseBand(section.table().cell('Sleep', 'Target'))[0];
        const engineTarget = SLEEP_TARGET_BY_MPW[i].band[0];
        if (Math.abs(engineTarget - target) > 0.01) {
          throw new Error(`SLEEP_TARGET_BY_MPW row ${i} target is ${engineTarget} h, doctrine says ${target} h`);
        }
        const floor = sleepFloorForMileage(mpw);
        if (Math.abs(floor - (target - SLEEP_FLOOR_TOLERANCE_H)) > 0.01) {
          throw new Error(`sleep floor at ${mpw} mpw is ${floor} h · doctrine target ${target} h less the ${SLEEP_FLOOR_TOLERANCE_H} h tolerance`);
        }
        if (floor <= previous && i > 0) {
          throw new Error(`the sleep floor did not rise from row ${i - 1} to row ${i} · doctrine scales it up with load`);
        }
        previous = floor;
      });
      // And it is genuinely tier-blind.
      const tiers: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus'];
      const floors = new Set(tiers.map((tier) => tierRulesFor(tier, 70).sleep7AvgFloor));
      if (floors.size !== 1) {
        throw new Error(`the sleep floor still varies by experience tier: ${[...floors].join(' · ')}`);
      }
    },
  },

  // == MARATHON-PACE LONG RUN . Research/04 4.4 =============================
  {
    id: 'MPLONG.race-specific-cadence',
    binds: [
      'lib/plan/generate.ts#MP_LONG_CADENCE_WEEKS',
      'lib/plan/generate.ts#racePaceLongThisWeek',
      'lib/plan/generate.ts#longFinishSegment',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 4.4 Marathon-pace long run',
    claim:
      'The marathon-pace long run happens every two to three weeks in the race-specific ' +
      'phase, not every week. The engine read this table\'s DOSE and ignored its FREQUENCY: ' +
      'it put a 50%-of-the-long marathon-pace finish on every race-specific week and paired ' +
      'it with two structured sessions, which 16 names as a combination to avoid and which ' +
      'measured 58-71% easy against a 75% floor. The cadence band is read out of the ' +
      'Frequency row, and the check walks the generator\'s own week-picker to confirm no two ' +
      'marathon-pace longs ever sit closer or further apart than doctrine allows.',
    check({ cite }) {
      const [lo, hi] = parseBand(cite.table().cell('Frequency', 'Prescription'));
      if (MP_LONG_CADENCE_WEEKS < lo || MP_LONG_CADENCE_WEEKS > hi) {
        throw new Error(
          `MP_LONG_CADENCE_WEEKS is ${MP_LONG_CADENCE_WEEKS}, doctrine allows every ${lo}-${hi} weeks`,
        );
      }
      // Walk the picker across every plausible phase geometry. The gap between
      // consecutive marathon-pace longs must stay inside the doctrine band even
      // when the deload dodge stretches it.
      for (const cutbackEveryN of [3, 4]) {
        for (const phaseEndIdx of [5, 8, 11, 12, 13, 15, 17, 21]) {
          const hits: number[] = [];
          for (let wk = 0; wk <= phaseEndIdx; wk++) {
            if (racePaceLongThisWeek(wk, phaseEndIdx - wk, cutbackEveryN)) hits.push(wk);
          }
          for (let i = 1; i < hits.length; i++) {
            const gap = hits[i] - hits[i - 1];
            if (gap < lo || gap > hi) {
              throw new Error(
                `marathon-pace longs land ${gap} weeks apart (weeks ${hits.join(',')}, ` +
                `phase ends ${phaseEndIdx}, deload every ${cutbackEveryN}) - doctrine allows ${lo}-${hi}`,
              );
            }
          }
          // And a deload week never carries the block's biggest quality session.
          for (const wk of hits) {
            if (wk > 0 && (wk + 1) % cutbackEveryN === 0) {
              throw new Error(`a marathon-pace long landed on cutback week ${wk} (deload every ${cutbackEveryN})`);
            }
          }
        }
      }
    },
  },

  // == FAST-FINISH LONG RUN . Research/04 4.5 ==============================
  {
    id: 'HMLONG.half-shares-the-cadence',
    binds: [
      'lib/plan/generate.ts#longFinishSegment',
      'lib/plan/generate.ts#layoutWeek.racePaceLongWeek',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 4.5 Fast finish long run',
    claim:
      'The half marathon\'s race-pace long run is on the same two-to-three-week cadence as ' +
      'the marathon\'s. This table states the rhythm in its own Frequency row and names the ' +
      'half in its own When-in-cycle row, so the treatment 4.4 bought the marathon is owed ' +
      'here too. The engine put a 50%-of-the-long half-marathon-pace finish on EVERY ' +
      'race-specific week and then let the intensity floor shave it back: across the half ' +
      'archetype matrix every race-specific week carried a finish and 83% of them came out ' +
      'shaved, which is the correction pass doing the generator\'s job. The cadence band is ' +
      'read out of this table, and the RACE-SPECIFIC arm of longFinishSegment must gate on ' +
      'it for BOTH distances rather than only for the marathon.',
    check({ cite }) {
      const [lo, hi] = parseBand(cite.table().cell('Frequency', 'Prescription'));
      if (MP_LONG_CADENCE_WEEKS < lo || MP_LONG_CADENCE_WEEKS > hi) {
        throw new Error(
          `MP_LONG_CADENCE_WEEKS is ${MP_LONG_CADENCE_WEEKS}, but 4.5 allows every ${lo}-${hi} weeks`,
        );
      }
      // The claim only holds while the doc still puts this session in the
      // HALF's specific phase. If that row ever narrows to the marathon, the
      // half's cadence loses its citation and this must be re-derived.
      const when = cite.table().cell('When in cycle', 'Prescription');
      if (!/\bHM\b|half/i.test(when)) {
        throw new Error(
          `4.5 "When in cycle" no longer names the half ("${when}") - the half's cadence ` +
            'citation no longer resolves; re-read the section',
        );
      }
      // The rule, at source level: the RACE-SPECIFIC arm returns a plain easy
      // long off-cadence with NO distance condition, and the cadence flag it
      // reads is computed for every distance that has a race-pace tag. A
      // `racePaceTag === 'MP' &&` creeping back into either place is exactly
      // the regression this claim exists to catch.
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      matchLiteral(
        src,
        /const racePaceLongWeek = phase === 'RACE-SPECIFIC' && racePaceTag != null\s*\n\s*&& racePaceLongThisWeek\(weekIdx, weeksToPhaseEnd, cutbackEveryN\);/,
        'the race-pace-long cadence flag is distance-blind',
      );
      matchLiteral(
        src,
        /if \(phase === 'RACE-SPECIFIC'\) \{[\s\S]{0,600}?\n {4}if \(!cadenceWeek\) return null;/,
        "longFinishSegment's RACE-SPECIFIC arm gates on the cadence unconditionally",
      );
    },
  },

  // ══ RAMP BASE · what a build is allowed to ramp FROM ══════════════════════
  {
    id: 'RAMPBASE.interruption-is-measured-in-weeks-off',
    binds: [
      'lib/plan/generate.ts#absenceWeeksEquivalent',
      'lib/plan/generate.ts#SHORT_LAYOFF_WEEKS',
      'lib/plan/generate.ts#RAMP_BASE_RESUME_FRACTION',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '### Return from Short Layoff (1-2 weeks off)',
    claim:
      'Doctrine keys its return protocols on DAYS OFF — this section’s own row headers are ' +
      '"1-7 days" and "8-14 days", and the section after it is "Return from Moderate Layoff ' +
      '(3-8 weeks)". The engine’s proxy for that was a COUNT of consecutive most-recent 7-day ' +
      'blocks below 70% of the sustained level, which is a mileage threshold standing in for a ' +
      'days-off question, and any single week at the resume level reset it to zero: three weeks ' +
      'of interruption read as none because the front block cleared the line by a fifth of a ' +
      'mile, and an entire BASE phase appeared or disappeared on it. `absenceWeeksEquivalent` ' +
      'measures the same quantity continuously — a block at zero miles is one week off, a block ' +
      'at the resume level is none, and the shortfalls are summed over a fixed window so one ' +
      'week cannot erase the ones behind it. At doctrine’s own integer points it reproduces ' +
      'doctrine exactly.',
    check({ cite }) {
      // The section title states the short-layoff span; the boundary between it
      // and the moderate-layoff protocol is read out of the docs, not typed.
      const shortMax = parseBand(matchLiteral(
        cite.text(), /Return from Short Layoff \(([\d\s–—-]+) weeks? off\)/i, 'short-layoff window',
      )[1])[1];
      if (SHORT_LAYOFF_WEEKS !== shortMax) {
        throw new Error(`SHORT_LAYOFF_WEEKS is ${SHORT_LAYOFF_WEEKS}, doctrine's short layoff is ${shortMax} weeks`);
      }
      const moderate = resolveCitation(
        'Research/22-plan-templates.md', '### Return from Moderate Layoff (3-8 weeks)',
      );
      const moderateMin = parseBand(matchLiteral(
        moderate.text(), /Return from Moderate Layoff \(([\d\s–—-]+) weeks?\)/i, 'moderate-layoff window',
      )[1])[0];
      if (moderateMin !== shortMax + 1) {
        throw new Error(
          `doctrine's short layoff ends at ${shortMax} weeks and its moderate layoff begins at ` +
            `${moderateMin} · the two protocols no longer meet, so the allowance boundary is unclear`,
        );
      }
      const resume = 30;   // any positive resume level; the measure is a fraction of it
      // 1 · N weeks of NOT RUNNING reads as exactly N weeks off, so the engine's
      //     `interruption > allowed` test lands on doctrine's own boundary.
      for (const n of [1, 2, 3, 5]) {
        const series = [...Array(n).fill(0), resume, resume, resume, resume, resume, resume];
        const got = absenceWeeksEquivalent(series, resume, Math.max(n, 8));
        if (Math.abs(got - n) > 1e-9) {
          throw new Error(`${n} weeks at zero miles reads as ${got} weeks of absence, not ${n}`);
        }
      }
      // 2 · a runner AT the resume level is not interrupted at all, however long
      //     they have been there. This is the half the old count got right.
      if (absenceWeeksEquivalent(Array(16).fill(resume), resume, 4) !== 0) {
        throw new Error('a runner holding the resume level reads as interrupted');
      }
      // 3 · CONTINUITY (Rule 9). Walk the front block down through the resume
      //     level and require the reading to move with it, never to jump. The
      //     consecutive-run count fails this with a multi-week step.
      let prev = -Infinity;
      for (let front = resume * 1.2; front >= 0; front -= resume * 0.005) {
        const got = absenceWeeksEquivalent([front, 0, 0, resume, resume, resume], resume, 2);
        if (got < prev - 1e-9) throw new Error(`absence reading fell from ${prev} to ${got} as the front week SHRANK`);
        if (Number.isFinite(prev) && got - prev > 0.02) {
          throw new Error(
            `absence reading jumped ${(got - prev).toFixed(2)} weeks for half a percent of one ` +
              `block at front=${front.toFixed(2)} · the consecutive-run count is back`,
          );
        }
        prev = got;
      }
      // 4 · and the reset-on-one-week pathology itself, stated as a case: three
      //     empty weeks behind a full one still read as three weeks of absence.
      const behindAGoodWeek = absenceWeeksEquivalent([resume, 0, 0, 0, resume, resume], resume, 4);
      if (behindAGoodWeek < 2.999) {
        throw new Error(
          `three empty weeks behind one full week read as ${behindAGoodWeek} weeks of absence · ` +
            'a single week at the resume level must not erase the ones behind it',
        );
      }
    },
  },
  {
    id: 'RAMPBASE.resume-from-pre-interruption-volume',
    binds: [
      'lib/plan/generate.ts#RAMP_BASE_RESUME_FRACTION',
      'lib/plan/generate.ts#resolveRampBase',
      'lib/plan/generate.ts#ComposePlanInput.rampBaseMi',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '| 8-14 days | 70% of pre-layoff volume for 1 wk, 85% for wk 2, full for wk 3 |',
    claim:
      'A runner coming back from an interruption resumes at a fraction of their PRE-' +
      'interruption volume — never at the interruption\'s own volume, which is the number ' +
      'the engine was reading. `volumeCurve` ramped from a flat 28-day mean, so a build ' +
      'authored the day a mandated recovery block ends took the deload the engine itself ' +
      'prescribed as the runner\'s fitness. The resume fraction is the floor of the band ' +
      'doctrine states, and the lift is allowed only while the low stretch is no longer ' +
      'than the recovery the engine mandates; past that it is a layoff and the comeback ' +
      'protocols own the ramp.',
    check({ cite }) {
      // The doc's own number, read out of the cell rather than hand-copied.
      const stated = cite.section.find((l) => l.includes('70% of pre-layoff volume'));
      if (!stated) throw new Error('the short-layoff resume row no longer states a resume fraction');
      const docFraction = Number((stated.match(/(\d+)%\s+of\s+pre-layoff/) ?? [])[1]) / 100;
      if (!(docFraction > 0)) throw new Error(`could not read the resume fraction out of: ${stated}`);
      if (Math.abs(RAMP_BASE_RESUME_FRACTION - docFraction) > 0.001) {
        throw new Error(
          `RAMP_BASE_RESUME_FRACTION is ${RAMP_BASE_RESUME_FRACTION}, doctrine resumes at ${docFraction}`,
        );
      }
      // Research/00b's reverse taper must agree · its last week is the same band.
      const rt = resolveCitation('Research/00b-recovery-protocols.md', '### Marathon Recovery (4-week reverse taper)');
      const [lo] = parseBand(rt.table().cell('Week 4', 'Volume vs. peak'));
      if (Math.abs(lo / 100 - docFraction) > 0.001) {
        throw new Error(
          `Research/22 resumes at ${docFraction} and Research/00b's reverse taper ends at ${lo / 100}. ` +
            'Two docs, two different resume levels — reconcile them before moving the engine.',
        );
      }
      // The base must never be BELOW the mean · the lift can only ever add.
      const mean = 15.8;
      const series = [0, 17, 23, 30, 40, 44, 40, 47, 43, 40, 47, 40, 45, 39, 41, 38];
      const lifted = resolveRampBase({ meanWeeklyMi: mean, weeklySeries: series, allowedInterruptionWeeks: 4 });
      if (lifted.baseMi < mean) throw new Error('resolveRampBase returned a base below the 28-day mean');
      if (!lifted.lifted) throw new Error('a four-week mandated deload off a 40 mi/wk base did not lift the ramp base');
      // …and a genuine layoff must NOT be lifted, however good the old base was.
      const detrained = resolveRampBase({
        meanWeeklyMi: 4, weeklySeries: [0, 0, 2, 3, 5, 6, 8, 40, 44, 47, 40, 43, 45, 41, 39, 42],
        allowedInterruptionWeeks: 4,
      });
      if (detrained.lifted || detrained.baseMi !== 4) {
        throw new Error(
          `a seven-week layoff was lifted to ${detrained.baseMi} mi/wk · past the mandated window the ` +
            'comeback protocols (Research/22 §"Return from Moderate Layoff", Research/05) own the ramp',
        );
      }
      // …and one outlier week cannot set a base.
      const spike = resolveRampBase({
        meanWeeklyMi: 10, weeklySeries: [10, 10, 10, 60, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        allowedInterruptionWeeks: 4,
      });
      if (spike.sustainedMi > 10.001) {
        throw new Error(`a single 60-mile week set the sustained base to ${spike.sustainedMi}`);
      }
      if (RAMP_BASE_SUSTAINED_RANK < 3) {
        throw new Error(`RAMP_BASE_SUSTAINED_RANK is ${RAMP_BASE_SUSTAINED_RANK} · a base is a volume reached repeatedly`);
      }
      // ── CURRENTVOL-1 · and never BELOW the volume the runner is already holding ──
      //
      // The claim above says a runner resumes at a fraction of pre-interruption
      // volume, never at the interruption's own. The engine implemented that
      // only where 70% of sustained cleared the 28-day mean; where the mandated
      // deload was SHALLOW the mean governed, and the mean still contains the
      // deload. The same defect, one rung down. The owner's numbers, 2026-08-30:
      // sustained 45.0, resume level 31.50, 28-day mean 31.6 — so the base was
      // 31.6 while the seven days ending that morning totalled 34.7. The build
      // opened below the recovery block it was replacing.
      const shallow = resolveRampBase({
        meanWeeklyMi: 31.6,
        weeklySeries: [34.7, 28.4, 23.2, 39.9, 4.2, 47.5, 39.7, 43.3, 0, 27.9, 47.4, 40, 45, 39.8, 40.6, 37.5],
        allowedInterruptionWeeks: 4,
      });
      if (shallow.baseMi < 34.7 - 1e-9) {
        throw new Error(
          `the ramp base is ${shallow.baseMi} mi/wk for a runner whose most recent complete week ` +
            'was 34.7 · a build may not open below the volume the runner is already holding',
        );
      }
      if (shallow.baseMi > shallow.sustainedMi + 1e-9) {
        throw new Error(
          `the demonstrated-volume floor lifted the base to ${shallow.baseMi}, above the sustained ` +
            `level ${shallow.sustainedMi} · one big week must not be able to set a base`,
        );
      }
      // …and the floor must not reach past the allowance: a genuine layoff
      // keeps the mean, and the comeback protocols keep the ramp.
      if (detrained.heldMi !== 0 || detrained.returning) {
        throw new Error(
          'the demonstrated-volume floor applied through a seven-week layoff · past the mandated ' +
            'window Research/22 §"Return from Moderate Layoff" and Research/05 own the ramp',
        );
      }
      if (!/volumeCurve\(input\.rampBaseMi \?\? input\.recentWeeklyMi,/.test(sourceOf('web-v2/lib/plan/generate.ts'))) {
        throw new Error('volumeCurve no longer reads rampBaseMi · the build is ramping from the 28-day mean again');
      }
    },
  },

  // ══ ANCHOR FIT · the anchor is graded against the RUNNER ══════════════════
  {
    id: 'ANCHORFIT.gate-exists-and-can-see-the-runner',
    binds: [
      'lib/plan/anchor-fit.ts#checkAnchorNotCircular',
      'lib/plan/_anchor_fit.test.ts#SHAPES',
      'lib/plan/sim-inputs.ts#dailyMiMostRecentFirst',
      'lib/plan/generate.ts#resolvePeakWeekly',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '| 8-14 days | 70% of pre-layoff volume for 1 wk, 85% for wk 2, full for wk 3 |',
    claim:
      'Every other gate grades the plan against its anchor. This one grades the anchor ' +
      'against the runner, and it can only do that if the harness is able to express a ' +
      'runner with a history. `buildSimPlan` mirrors onboarding — no logged runs — so the ' +
      'two volume readers added for exactly this defect (`recentPeakWeeklyMileage`, ' +
      '`rampBaseForBuild`) were unreachable by any test in the repo, and every sweep ' +
      'archetype composed recovery off `recentPeakWeeklyMi = recentWeeklyMi`: the ' +
      'pre-DOCTRINE-4 proxy the reverse-taper defect came from. The floor the gate applies ' +
      'is doctrine\'s own resume fraction, parsed from the cited row, not a literal.',
    check({ cite }) {
      const stated = cite.section.find((l) => l.includes('70% of pre-layoff volume'));
      if (!stated) throw new Error('the short-layoff resume row moved · the anchor-fit floor has no source');
      const docFraction = Number((stated.match(/(\d+)%\s+of\s+pre-layoff/) ?? [])[1]) / 100;
      // 1 · the gate's floor is the doc's number, reached through the shared constant.
      if (Math.abs(RAMP_BASE_RESUME_FRACTION - docFraction) > 0.001) {
        throw new Error('the anchor-fit floor and the doctrine resume fraction have diverged');
      }
      const checks = sourceOf('web-v2/lib/plan/anchor-fit.ts');
      if (!/RAMP_BASE_RESUME_FRACTION/.test(checks)) {
        throw new Error('anchor-fit no longer floors on the doctrine resume fraction · it has a literal');
      }
      // 2 · the gate still runs the checks. This claim cannot be satisfied by
      //     deleting the thing it watches (the GUARD 2 posture of
      //     check-swallowed-failure.sh).
      const gate = sourceOf('web-v2/lib/plan/_anchor_fit.test.ts');
      if (!/runChecks\(/.test(gate) || !/const SHAPES: Shape\[\]/.test(gate)) {
        throw new Error('the anchor-fit gate no longer runs the checks over runner shapes');
      }
      if (!/dailyMiMostRecentFirst/.test(gate)) {
        throw new Error('the anchor-fit gate no longer feeds the harness a runner history');
      }
      // 3 · the harness regression itself. If this line comes back, the sweep
      //     is grading the pre-DOCTRINE-4 engine again and nobody will notice.
      const sim = sourceOf('web-v2/lib/plan/sim-inputs.ts');
      if (/recentPeakWeeklyMi: recentWeeklyMi,/.test(sim)) {
        throw new Error(
          'buildSimPlan pins recentPeakWeeklyMi to the 28-day mean unconditionally again · ' +
            'every archetype in _sweep_allusers is back to grading a peak that is an average',
        );
      }
      if (!/recentPeakWeeklyMi: hist \? Math\.max\(hist\.peak, recentWeeklyMi\)/.test(sim)) {
        throw new Error('buildSimPlan no longer resolves a real peak from a supplied history');
      }
      // 4 · the peak reader's pure half must still be spent by the DB half, or
      //     the gate is testing a function production does not run.
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/export function resolvePeakWeekly\(/.test(gen)) {
        throw new Error('resolvePeakWeekly is gone · the peak anchor is untestable without a database again');
      }
      if (!/return resolvePeakWeekly\(daily\);/.test(gen)) {
        throw new Error('recentPeakWeeklyMileage no longer spends resolvePeakWeekly · two implementations');
      }
      // 5 · and neither volume anchor may swallow a failed read back into a
      //     zero. An empty history and a broken query are the same value, and
      //     the value they share is "this runner is smaller than they are".
      for (const fn of ['recentPeakWeeklyMileage', 'rampBaseForBuild']) {
        const body = gen.slice(gen.indexOf(`async function ${fn}(`));
        const head = body.slice(0, body.indexOf('\n}\n'));
        if (/mileageByDay\([^)]*\)\s*\n?\s*\.catch\(/.test(head) || /mileageByDay\([^;]*\.catch\(/.test(head)) {
          throw new Error(
            `${fn} swallows a failed mileage read into an empty map · the anchor silently ` +
              'falls back to the depressed 28-day mean, which is the DOCTRINE-4 defect at runtime',
          );
        }
      }
    },
  },

  // == MARATHON TAPER . MP work survives the volume cut . Research/08 9.2 ====
  {
    id: 'TAPERMP.marathon-taper-mp-dose',
    binds: [
      'lib/plan/generate.ts#TAPER_MP_DOSE',
      'lib/plan/generate.ts#taperMpDose',
    ],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.2 Marathon taper structure (3 weeks)',
    claim:
      'The marathon taper keeps marathon-pace work: roughly 14-16 mi with 10-12 at MP three ' +
      'weeks out, and 6-8 mi at MP two weeks out. The engine set the whole taper\'s quality to ' +
      'the 5K-pace tune-up, which is the race-week row applied to all three weeks - a volume ' +
      'cut WITH the intensity cut too, the exact distinction 9.1 draws when it says the ' +
      'largest cut is to easy mileage and intensity is preserved. Both doses are read out of ' +
      'the Quality session column, parentheses included, since that is where the numbers live.',
    check({ cite }) {
      const t = cite.table();
      // parseBand strips bracketed text, and this column keeps its numbers
      // inside the brackets - "Final MP-specific (14-16 mi w/ 10-12 mi at MP)".
      // parseBands reads every band on the line in order instead.
      const minus3 = parseBands(t.cell('-3', 'Quality session'));
      const minus2 = parseBands(t.cell('-2', 'Quality session'));
      if (minus3.length < 2) throw new Error(`the -3 quality cell no longer states a total and an MP band: "${t.cell('-3', 'Quality session')}"`);
      if (minus2.length < 1) throw new Error(`the -2 quality cell no longer states an MP band: "${t.cell('-2', 'Quality session')}"`);
      within(TAPER_MP_DOSE.final.totalMi, minus3[0], 'taper -3 session total');
      within(TAPER_MP_DOSE.final.mpMi, minus3[1], 'taper -3 miles at MP');
      within(TAPER_MP_DOSE.primer.mpMi, minus2[0], 'taper -2 miles at MP');
      if (TAPER_MP_DOSE.primer.totalMi <= TAPER_MP_DOSE.primer.mpMi) {
        throw new Error('the -2 session has no room for a warm-up or cool-down around its MP block');
      }
      // The dose is a target, not a floor: an unconstrained week gets doctrine
      // exactly, and a week that cannot afford it gets a scaled-down session
      // whose MP block still dominates, or no MP session at all.
      const full = taperMpDose(2, 999);
      if (!full || full.totalMi !== TAPER_MP_DOSE.final.totalMi || full.mpMi !== TAPER_MP_DOSE.final.mpMi) {
        throw new Error(`an unconstrained -3 week did not get the doctrine dose: ${JSON.stringify(full)}`);
      }
      const primer = taperMpDose(1, 999);
      if (!primer || primer.mpMi !== TAPER_MP_DOSE.primer.mpMi) {
        throw new Error(`an unconstrained -2 week did not get the doctrine dose: ${JSON.stringify(primer)}`);
      }
      for (const budget of [4, 6, 8, 10, 12, 15, 20]) {
        for (const wtpe of [1, 2]) {
          const d = taperMpDose(wtpe, budget);
          if (!d) continue;
          if (d.totalMi > budget + 0.001) throw new Error(`taperMpDose(${wtpe}, ${budget}) returned a ${d.totalMi}mi session`);
          if (Math.abs(d.warmupMi + d.mpMi + d.cooldownMi - d.totalMi) > 0.051) {
            throw new Error(`taperMpDose(${wtpe}, ${budget}) segments do not sum to its total: ${JSON.stringify(d)}`);
          }
          if (d.mpMi / d.totalMi < 0.5) throw new Error(`taperMpDose(${wtpe}, ${budget}) is no longer MP-dominant: ${JSON.stringify(d)}`);
        }
      }
      // The race week keeps the 5K-pace tune-up doctrine gives it (9.2 row -1).
      if (taperMpDose(0, 999) != null) {
        throw new Error('the race week was handed an MP session - 9.2 row -1 is the 5K-pace tune-up');
      }
    },
  },

  /* ── Progression levers ───────────────────────────────────────────────────
   *
   * `Design/adaptive-progression-engine.md` §2 makes duration, density and rep
   * count first-class progression levers so the engine stops treating "faster"
   * as the only way to progress. That freedom needs a ceiling: without one, a
   * lever ladder walks a runner straight past Daniels' at-pace volume caps one
   * comfortable step at a time. These four claims are that ceiling, and they
   * bind the caps to the doc that states them.
   */
  {
    id: 'PROGRESSION.threshold-volume-cap',
    binds: ['lib/prescription/levers.ts#AT_PACE_WEEKLY_SHARE_CAP.threshold'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.3 Cruise intervals (Daniels)',
    claim:
      'Threshold work caps at 10% of weekly mileage. The duration and rep-count levers must ' +
      'refuse to step past it, which is why a 30 mi/wk runner cannot be progressed to 3x10 min ' +
      'of T work however well they are adapting.',
    check({ cite }) {
      const pctInDoc = Number(
        matchLiteral(cite.text(), /cap T-pace at (\d+)% of weekly mileage/, 'Daniels T-pace cap')[1],
      );
      const engine = AT_PACE_WEEKLY_SHARE_CAP.threshold * 100;
      within(engine, [pctInDoc, pctInDoc], 'threshold at-pace weekly share cap');
    },
  },
  {
    id: 'PROGRESSION.cruise-recovery-scales-with-work',
    binds: ['lib/prescription/levers.ts#CRUISE_RECOVERY_MIN_PER_WORK_MI'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.3 Cruise intervals (Daniels)',
    claim:
      'Cruise recovery is one minute of jog per mile of work segment. When the duration lever ' +
      'lengthens a rep, recovery has to grow with it — holding recovery fixed while the work ' +
      'grows is a density increase the engine did not intend and the runner did not earn.',
    check({ cite }) {
      const perMi = Number(
        matchLiteral(cite.text(), /(\d+) min jog per mile of work segment/, 'cruise recovery ratio')[1],
      );
      within(CRUISE_RECOVERY_MIN_PER_WORK_MI, [perMi, perMi], 'cruise recovery minutes per work mile');
    },
  },
  {
    id: 'PROGRESSION.interval-rep-window-and-cap',
    binds: [
      'lib/prescription/levers.ts#INTERVAL_REP_MINUTES',
      'lib/prescription/levers.ts#AT_PACE_WEEKLY_SHARE_CAP.interval',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 6. VO2max workouts',
    claim:
      'VO2 repetitions run 3-5 minutes and total at-pace volume caps at 8% of weekly mileage. ' +
      'The interval-duration lever stops at the top of the rep window rather than growing reps ' +
      'indefinitely — past five minutes the session stops being VO2 work and becomes threshold ' +
      'work wearing its name.',
    check({ cite }) {
      const text = cite.text();
      const rep = matchLiteral(text, /each interval should be (\d+)[–-](\d+) min long/, 'VO2 rep window');
      within(INTERVAL_REP_MINUTES.min, [Number(rep[1]), Number(rep[1])], 'VO2 rep minimum minutes');
      within(INTERVAL_REP_MINUTES.max, [Number(rep[2]), Number(rep[2])], 'VO2 rep maximum minutes');
      const cap = Number(
        matchLiteral(text, /total at-pace volume ≤ (\d+)% of weekly mileage/, 'VO2 volume cap')[1],
      );
      within(AT_PACE_WEEKLY_SHARE_CAP.interval * 100, [cap, cap], 'interval at-pace weekly share cap');
    },
  },
  {
    id: 'PROGRESSION.repetition-volume-cap',
    binds: ['lib/prescription/levers.ts#AT_PACE_WEEKLY_SHARE_CAP.repetition'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 7. Speed / economy workouts',
    claim:
      'R-pace work caps at 5% of weekly mileage — the tightest of the three at-pace caps, ' +
      'because repetition work targets recruitment and economy rather than lactate clearance ' +
      'and buys nothing from extra volume.',
    check({ cite }) {
      const cap = Number(
        matchLiteral(cite.text(), /cap R pace at (\d+)% of weekly mileage/, 'Daniels R-pace cap')[1],
      );
      within(AT_PACE_WEEKLY_SHARE_CAP.repetition * 100, [cap, cap], 'repetition at-pace weekly share cap');
    },
  },
  {
    id: 'PROGRESSION.continuous-tempo-window',
    binds: ['lib/prescription/levers.ts#CONTINUOUS_TEMPO_MINUTES'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.1 Threshold family overview',
    claim:
      'Continuous tempo runs 20-40 minutes. The density lever collapses reps toward a single ' +
      'continuous effort, so it needs a stopping point: a 2x15 that becomes 1x30 is doctrine, ' +
      'a 1x50 is not a tempo any more.',
    check({ cite }) {
      const m = matchLiteral(
        cite.text(),
        /\|\s*Continuous tempo\s*\|[^|]*\|[^|]*\|[^|]*\|\s*(\d+)[–-](\d+) min\s*\|/,
        'continuous tempo duration cell',
      );
      within(CONTINUOUS_TEMPO_MINUTES.min, [Number(m[1]), Number(m[1])], 'continuous tempo minimum minutes');
      within(CONTINUOUS_TEMPO_MINUTES.max, [Number(m[2]), Number(m[2])], 'continuous tempo maximum minutes');
    },
  },
  // ══ QUALITY DAY · a session is work PLUS easy legs ════════════════════════
  /**
   * `qualityShare = 0.22` sized a whole quality DAY as a share of weekly volume
   * and split it across the week's quality days. At 55 mi/wk over two of them
   * that is 6.05 miles for the day, and the warm-up and cool-down come out of
   * it first — so the runner reached about three miles of threshold against a
   * band of four to eight, on a week whose Daniels cap permitted 5.5.
   *
   * The error is a category error. The at-pace caps and the 75% easy floor
   * govern INTENSITY; §5.3's "2-3 mi E each side" is E. Charging a day's easy
   * legs to its hard budget spends the intensity allowance twice.
   *
   * These four claims bind the numbers that replaced it. The last one is the
   * behavioural one and is the point: a day must come out BIGGER than the
   * at-pace work it carries.
   */
  {
    id: 'QUALITYDAY.threshold-session-at-pace-band',
    binds: ['lib/prescription/levers.ts#AT_PACE_SESSION_MI.threshold'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.1 Threshold family overview',
    claim:
      'One cruise-interval session carries 4-8 miles at threshold. This bounds the SESSION, where ' +
      'the 10% share bounds it against the runner\'s weekly volume, and both apply: past eight ' +
      'miles at T the workout has stopped being cruise intervals however high the mileage it sits ' +
      'in, so a 100 mi/wk runner is not owed a ten-mile threshold session by their own ten percent.',
    check({ cite }) {
      const band = parseBand(cite.table().cell('Cruise intervals (Daniels)', 'Total at-pace'));
      within(AT_PACE_SESSION_MI.threshold.min, [band[0], band[0]], 'threshold session at-pace minimum');
      within(AT_PACE_SESSION_MI.threshold.max, [band[1], band[1]], 'threshold session at-pace maximum');
      // Behaviour: the tighter of the two bounds wins at both ends of the
      // mileage range, so neither is decorative.
      const small = atPaceSessionCapMi(30, 'threshold');
      if (Math.abs(small - 3) > 0.001) {
        throw new Error(`30 mi/wk should buy the share cap (3 mi), got ${small}`);
      }
      const large = atPaceSessionCapMi(120, 'threshold');
      if (Math.abs(large - band[1]) > 0.001) {
        throw new Error(`120 mi/wk should be held at the session band (${band[1]} mi), got ${large}`);
      }
    },
  },
  {
    id: 'QUALITYDAY.interval-session-at-pace-band',
    binds: ['lib/prescription/levers.ts#AT_PACE_SESSION_MI.interval'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 6.1 VO2max family overview',
    claim:
      'One VO2 rep session carries 3-6 miles at I pace — a smaller band than threshold work, ' +
      'because the same physiological return arrives in less volume and the cost of exceeding it ' +
      'is higher.',
    check({ cite }) {
      const band = parseBand(cite.table().cell('Mile repeats (3K/5K)', 'Total at-pace'));
      within(AT_PACE_SESSION_MI.interval.min, [band[0], band[0]], 'interval session at-pace minimum');
      within(AT_PACE_SESSION_MI.interval.max, [band[1], band[1]], 'interval session at-pace maximum');
      // The interval band must sit below the threshold band at both ends —
      // doctrine gives them different numbers, and a paste would not.
      if (AT_PACE_SESSION_MI.interval.max >= AT_PACE_SESSION_MI.threshold.max) {
        throw new Error('the VO2 session band is not tighter than the threshold session band');
      }
    },
  },
  {
    id: 'QUALITYDAY.warmup-cooldown-are-doctrine',
    binds: [
      'lib/plan/quality-day.ts#QUALITY_WARMUP_MI',
      'lib/plan/quality-day.ts#QUALITY_COOLDOWN_MI',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.3 Cruise intervals (Daniels)',
    claim:
      'A threshold session runs 2-3 miles of EASY running on each side of the work. The engine ' +
      'spends the bottom of the band — a warm-up is a cost paid in fatigue and in the runner\'s ' +
      'morning, and the top of it belongs to the runner who wants it rather than to a generator ' +
      'choosing on their behalf.',
    check({ cite }) {
      const band = parseBand(cite.table().cell('Warmup/cooldown', 'Prescription'));
      within(QUALITY_WARMUP_MI.threshold, band, 'threshold warm-up miles');
      within(QUALITY_COOLDOWN_MI.threshold, band, 'threshold cool-down miles');
      if (QUALITY_WARMUP_MI.threshold !== band[0] || QUALITY_COOLDOWN_MI.threshold !== band[0]) {
        throw new Error(
          `the engine should spend the bottom of the ${band[0]}-${band[1]} mi band, not ` +
          `${QUALITY_WARMUP_MI.threshold}/${QUALITY_COOLDOWN_MI.threshold}`,
        );
      }
    },
  },
  {
    id: 'QUALITYDAY.legs-are-easy-not-intensity',
    binds: [
      'lib/plan/quality-day.ts#composeQualityDay',
      'lib/plan/quality-day.ts#warmupCooldownMi',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 6.2 Mile repeats (3–6 × 1 mile)',
    claim:
      'A VO2 session runs 2-3 miles of easy warm-up and 1-2 miles of easy cool-down around the ' +
      'reps, and those miles are EASY — the at-pace caps and the easy-share floor speak to the ' +
      'reps only. So a quality DAY is always longer than the at-pace work it carries, by the ' +
      'warm-up and cool-down doctrine prescribes; sizing the day as a share of weekly volume ' +
      'charged the easy legs to the hard budget and left the session short of its own band.',
    check({ cite }) {
      // §6.2 states the two sides in one cell, separated by a semicolon.
      const cell = cite.table().cell('Warmup/cooldown', 'Prescription');
      const [wuText, cdText] = cell.split(';');
      if (!cdText) throw new Error(`§6.2 warm-up/cool-down cell no longer names both sides: "${cell}"`);
      const wuBand = parseBand(wuText);
      const cdBand = parseBand(cdText);
      within(QUALITY_WARMUP_MI.interval, wuBand, 'VO2 warm-up miles');
      within(QUALITY_COOLDOWN_MI.interval, cdBand, 'VO2 cool-down miles');
      // Behaviour · the composed day always exceeds its at-pace work by the
      // easy legs, and by doctrine's FULL legs for any session that has reached
      // the at-pace volume doctrine quoted them against (§5.3's "2-3 mi each
      // side" sits beside "4-8 mi" at pace; §6.2's beside §6.1's "3-6 mi").
      // Below that reference the legs scale in proportion — a 20 mi/wk runner
      // cannot spend four miles warming up for two miles of work — and above it
      // they stop growing, because a warm-up does not lengthen with the runner.
      // This is the assertion that the category error cannot come back.
      for (const weeklyMi of [20, 30, 45, 60, 80]) {
        for (const family of ['threshold', 'interval'] as const) {
          const atPaceMi = atPaceSessionCapMi(weeklyMi, family);
          const day = composeQualityDay({ family, atPaceMi });
          const legs = Number((day.dayMi - day.atPaceMi).toFixed(2));
          const full = QUALITY_WARMUP_MI[family] + QUALITY_COOLDOWN_MI[family];
          const reference = AT_PACE_SESSION_MI[family].min;
          // Doctrine's legs, scaled — or `spec-builder`'s own 30%/25% floors
          // where those are larger, SIDE BY SIDE, because the day may never
          // promise less warm-up than the spec built from it will take (it
          // would take the difference out of the reps instead).
          const scale = Math.min(1, atPaceMi / reference);
          const expected =
            Math.max(QUALITY_WARMUP_MI[family] * scale, Math.max(0.5, Math.min(1.5, day.dayMi * 0.3)))
            + Math.max(QUALITY_COOLDOWN_MI[family] * scale, Math.max(0.5, Math.min(1.0, day.dayMi * 0.25)));
          if (Math.abs(legs - expected) > 0.06) {
            throw new Error(
              `${weeklyMi} mi/wk ${family}: a ${day.dayMi} mi day around ${atPaceMi} mi of work ` +
              `carries ${legs} mi of easy legs, doctrine scaled gives ${expected.toFixed(2)}`,
            );
          }
          // Above doctrine's reference session, the legs ARE doctrine's — the
          // floors are a floor, never a licence to keep growing the warm-up.
          if (atPaceMi >= reference && Math.abs(legs - full) > 0.06 && legs > full) {
            throw new Error(
              `${weeklyMi} mi/wk ${family}: legs grew to ${legs} mi past doctrine's ${full} mi`,
            );
          }
          if (!(legs > 0)) {
            throw new Error(`${weeklyMi} mi/wk ${family}: the session lost its warm-up entirely`);
          }
          // And the work itself is never cut to make room for them.
          if (day.atPaceMi < atPaceMi - 0.001) {
            throw new Error(`${weeklyMi} mi/wk ${family}: the warm-up ate the workout`);
          }
          // The day is longer than the work. That is the whole claim.
          if (!(day.dayMi > day.atPaceMi)) {
            throw new Error(`${weeklyMi} mi/wk ${family}: the day is no longer than its own reps`);
          }
        }
      }
      // And the quality day never swallows a small runner's week.
      const tiny = composeQualityDay({ family: 'threshold', atPaceMi: atPaceSessionCapMi(20, 'threshold') });
      if (tiny.dayMi > 20 * 0.3) {
        throw new Error(`a 20 mi/wk runner's quality day is ${tiny.dayMi} mi — it is swallowing the week`);
      }
    },
  },
  {
    id: 'PROGRESSION.continuous-tempo-ceiling-binds-both-levers',
    binds: ['lib/prescription/levers.ts#advanceShape.quality_duration'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.2 Continuous tempo (4–8 mi at threshold)',
    claim:
      'Once the density lever has collapsed a rep set to one continuous block, the duration ' +
      'lever is prescribing a tempo and stops where a tempo stops. The density lever already ' +
      'refused to produce a 1x50; without the same ceiling on the duration lever the ladder ' +
      'reached the same place one step later, bounded only by the weekly volume cap.',
    check({ cite }) {
      const max = Number(
        matchLiteral(cite.text(), /\|\s*Duration\s*\|[^|]*?(\d+)[–-](\d+) min sweet spot\s*\|/, 'tempo sweet spot')[2],
      );
      within(CONTINUOUS_TEMPO_MINUTES.max, [max, max], 'continuous tempo ceiling');
      // Behaviour: a single block AT the ceiling may not be lengthened, on a
      // weekly mileage whose volume cap is nowhere near binding.
      const atCeiling = advanceShape({
        shape: { reps: 1, repMinutes: max, recoveryMinutes: 0, paceSPerMi: 420, zone: 'ESTABLISHED' },
        lever: 'quality_duration', stepMultiplier: 1, weeklyMi: 120, family: 'threshold',
      });
      if (!atCeiling.capped) {
        throw new Error(`the duration lever walked a ${max}-minute continuous tempo past its ceiling`);
      }
    },
  },
  {
    id: 'PROGRESSION.interval-rep-ceiling-binds-both-levers',
    binds: ['lib/prescription/levers.ts#advanceShape.work_density'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 6. VO2max workouts',
    claim:
      'The 3-5 minute VO2 repetition bounds the DENSITY lever as well as the duration lever. ' +
      'SLOT-ROTATE-3 stopped density merging a rep set below §6.1\'s three-rep floor and left ' +
      'the rep length unbounded, so with the count pinned at three every further step poured ' +
      'the set into longer repetitions instead: a marathon\'s race-specific weeks shipped 3x7 ' +
      'and then 3x10 minutes labelled as intervals. Past the window the session is threshold ' +
      'work wearing VO2\'s name, which is the same failure the count floor exists to prevent.',
    check({ cite }) {
      const rep = matchLiteral(
        cite.text(), /each interval should be (\d+)[–-](\d+) min long/, 'VO2 rep window',
      );
      const max = Number(rep[2]);
      within(INTERVAL_REP_MINUTES.max, [max, max], 'VO2 rep maximum minutes');
      // Behaviour: a set whose merge would exceed the window is refused, on a
      // weekly mileage whose volume cap is nowhere near binding.
      const merged = advanceShape({
        shape: { reps: 6, repMinutes: max, recoveryMinutes: 3, paceSPerMi: 360, zone: 'ESTABLISHED' },
        lever: 'work_density', stepMultiplier: 1, weeklyMi: 120, family: 'interval',
      });
      if (!merged.capped) {
        throw new Error(
          `the density lever merged 6x${max} into ${merged.shape.reps}x${merged.shape.repMinutes}, past the ${max}-minute window`,
        );
      }
      // And the same fence on R, whose window Research/01 states at two minutes.
      // Four reps rather than eight because the merge divides the same total by
      // one fewer rep: 8x2 lands back on 2 once rounded and is no breach, while
      // 4x2 lands on 2.67 and is one.
      const r = advanceShape({
        shape: { reps: 4, repMinutes: REPETITION_REP_MINUTES_MAX, recoveryMinutes: 3, paceSPerMi: 300, zone: 'ESTABLISHED' },
        lever: 'work_density', stepMultiplier: 1, weeklyMi: 120, family: 'repetition',
      });
      if (!r.capped) {
        throw new Error('the density lever walked an R set past its two-minute repetition ceiling');
      }
    },
  },
  {
    id: 'PROGRESSION.week-affordability-respects-the-share-cap',
    binds: [
      'lib/prescription/trajectory.ts#clampToWeek',
      'lib/prescription/trajectory.ts#MIN_QUALITY_REP_MINUTES',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.3 Cruise intervals (Daniels)',
    claim:
      'Daniels\' at-pace cap is a SHARE of the week, so the same session is inside doctrine in ' +
      'one week and outside it in the next — a cutback week cuts the mileage the cap is a share ' +
      'of. The overload trajectory holds the shape the block has earned; each week clamps that ' +
      'shape to what its own mileage can pay for, cutting reps before it shortens the rep, and ' +
      'never shortening it below doctrine\'s shortest prescribed quality repetition.',
    check({ cite }) {
      const pct = Number(
        matchLiteral(cite.text(), /cap T-pace at (\d+)% of weekly mileage/, 'Daniels T-pace cap')[1],
      ) / 100;
      // The floor is doctrine's own shortest quality rep, not a chosen number.
      within(MIN_QUALITY_REP_MINUTES, [INTERVAL_REP_MINUTES.min, INTERVAL_REP_MINUTES.min],
        'minimum quality rep minutes');
      // Behaviour, at the numbers the doc states: 30 mi/wk at 7:00 buys 3 mi of
      // threshold, so a five-by-seven-minute session must come back inside it.
      const pace = 420;
      for (const weeklyMi of [20, 30, 45, 60]) {
        const cut = clampToWeek(
          { reps: 5, repMinutes: 7, recoveryMinutes: 1, paceSPerMi: pace, zone: 'ESTABLISHED' },
          weeklyMi, 'threshold',
        );
        const workMi = (cut.reps * cut.repMinutes * 60) / pace;
        if (workMi > weeklyMi * pct + 0.05) {
          throw new Error(
            `${weeklyMi} mi/wk was prescribed ${workMi.toFixed(2)} mi of threshold, over the ${pct * 100}% cap`,
          );
        }
        if (cut.repMinutes < INTERVAL_REP_MINUTES.min) {
          throw new Error(`the affordability clamp cut a rep to ${cut.repMinutes} min`);
        }
      }
    },
  },
  {
    id: 'PROGRESSION.deload-carries-no-step',
    binds: ['lib/prescription/trajectory.ts#OverloadTrajectory.step'],
    doc: 'Design/adaptive-progression-engine.md',
    anchor: 'W4  recovery',
    claim:
      'The doctrine\'s own canonical progression puts a recovery week between the third and ' +
      'fifth overload steps, and §13 states what a recovery block does: retain, then resume. A ' +
      'recovery week that carried a progression step would be a deload in volume only, and the ' +
      'block would ratchet through the week it exists to absorb.',
    check() {
      const t = new OverloadTrajectory();
      const seed = '4×1mi @ T pace · 90s jog';
      const args = { seedPrescription: seed, paceSPerMi: 420, weeklyMi: 60, dayBudgetMi: 9 };
      t.step({ family: 'threshold', weekIdx: 0, isDeload: false, ...args });
      const before = t.step({ family: 'threshold', weekIdx: 1, isDeload: false, ...args })!;
      const deload = t.step({ family: 'threshold', weekIdx: 2, isDeload: true, ...args })!;
      const after = t.step({ family: 'threshold', weekIdx: 3, isDeload: false, ...args })!;
      if (deload.lever != null) {
        throw new Error(`a deload week pulled the ${deload.lever} lever`);
      }
      if (deload.shape.reps !== before.shape.reps || deload.shape.repMinutes !== before.shape.repMinutes) {
        throw new Error('a deload week changed the prescribed shape');
      }
      if (after.lever == null) {
        throw new Error('the trajectory did not resume after the recovery week');
      }
    },
  },
  {
    id: 'PROGRESSION.authored-block-progresses-without-pace',
    binds: ['lib/prescription/trajectory.ts#OverloadTrajectory'],
    doc: 'Design/adaptive-progression-engine.md',
    anchor: 'Meaningful progression, entirely before the fitness model moves.',
    claim:
      'A freshly authored block must be able to progress an athlete, and must do it without ' +
      'moving the pace. Nobody has run a session yet, so the adaptation model returns `normal` ' +
      'and the pace lever — ninth on the ladder and gated on `strong` on top of that — is out of ' +
      'reach for the whole block. Every step is duration, density or rep count at demonstrated ' +
      'effort, which is rule 7: fitness may stay flat while training progresses.',
    check() {
      const t = new OverloadTrajectory();
      const pace = 420;
      const seen: number[] = [];
      const levers: Array<string | null> = [];
      let totalFirst = 0;
      let totalLast = 0;
      for (let w = 0; w < 14; w++) {
        const step = t.step({
          family: 'threshold', weekIdx: w,
          seedPrescription: '4×1mi @ T pace · 90s jog',
          paceSPerMi: pace, weeklyMi: 60, dayBudgetMi: 9,
          isDeload: w > 0 && (w + 1) % 4 === 0,
        })!;
        seen.push(step.shape.paceSPerMi);
        levers.push(step.lever);
        const total = step.shape.reps * step.shape.repMinutes;
        if (w === 0) totalFirst = total;
        totalLast = total;
      }
      if (new Set(seen).size !== 1 || seen[0] !== pace) {
        throw new Error(`the authored block moved the work pace: ${[...new Set(seen)].join(' · ')}`);
      }
      if (levers.includes('pace')) {
        throw new Error('the pace lever fired on a block with no evidence behind it');
      }
      if (!(totalLast > totalFirst)) {
        throw new Error('the authored block did not progress at all — the stimulus never grew');
      }
    },
  },
  // ══ EVIDENCE · Rule 1 · fitness changes require evidence ══════════════════
  {
    id: 'EVIDENCE.no-calendar-pace-advance',
    binds: [
      'lib/plan/recompute-paces.ts#gatedBlendFraction',
      'lib/plan/recompute-paces.ts#blendedTPaceForWeek',
    ],
    doc: 'Design/engine-doctrine-evidence-and-levers.md',
    anchor: '> Time passing, plan completion, or scheduled progression alone cannot increase or decrease',
    claim:
      'A prescribed pace may not advance because a week went by. The weekly T-pace blend ' +
      'interpolated from measured fitness toward the goal-derived ceiling on weekIdx / ' +
      'round(buildWeeks x 0.6), and the taper returned goal pace outright — both assert a ' +
      'fitness change nobody measured, and the owner\'s locked Rule 1 names this file as ' +
      'the violation. The blend is now the DEMONSTRATED fraction of the gap plus a fixed ' +
      'grace, and nothing else: no evidence means the block trains at demonstrated ' +
      'fitness until a race, a time trial or a re-anchor moves it.',
    check() {
      const src = sourceOf('web-v2/lib/plan/recompute-paces.ts');
      // No calendar term may re-enter the blend.
      if (/weekIdx\s*\/\s*denom|args\.weekIdx\s*\//.test(src)) {
        throw new Error('blendedTPaceForWeek divides by a calendar denominator again · Rule 1 forbids it');
      }
      if (/buildWeeks\s*\*\s*0\.6/.test(src)) {
        throw new Error('the 60%-of-build calendar ramp is back in recompute-paces.ts');
      }
      // Behaviour, not just text: identical inputs at every week index and phase.
      const args = { currentT: 453, goalT: 413, buildWeeks: 11 };
      for (const measured of [null, 0, 0.5, 1] as (number | null)[]) {
        const seen = new Set<number | null>();
        for (const weekIdx of [0, 1, 4, 8, 13]) {
          for (const phase of ['BASE', 'BUILD', 'RACE-SPECIFIC', 'TAPER']) {
            seen.add(blendedTPaceForWeek({ ...args, weekIdx, phase, measuredProgressFraction: measured }));
          }
        }
        if (seen.size !== 1) {
          throw new Error(
            `the T-pace blend still varies with the schedule at measured=${measured}: ${[...seen].join(' · ')}`,
          );
        }
      }
      // No evidence → the runner's own demonstrated fitness (plus the grace),
      // never the goal-derived pace.
      const held = blendedTPaceForWeek({ ...args, weekIdx: 13, phase: 'TAPER' });
      if (held !== args.currentT) {
        throw new Error(`with no evidence the taper prescribes ${held} s/mi against a demonstrated ${args.currentT}`);
      }
      if (gatedBlendFraction(1, null) !== 0) {
        throw new Error('an unmeasured runner is still credited with part of the goal gap');
      }
      // The grace is bounded by what ONE honest retest could confirm (Research/01
      // :314-316 · a single signal moves VDOT ~1-3 points).
      if (BLEND_GRACE_FRACTION < 0 || BLEND_GRACE_FRACTION > 0.2) {
        throw new Error(`BLEND_GRACE_FRACTION is ${BLEND_GRACE_FRACTION} · the standing allowance must stay inside one retest`);
      }
      // The recovery composer must record an anchor for the NEXT block to
      // measure progress against — the second violation in the doctrine table.
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/mode: 'recovery',[\s\S]{0,900}?season_anchor_vdot/.test(gen)) {
        throw new Error(
          'composeRecoveryPlan writes no pace_blend.season_anchor_vdot · the build that follows ' +
            'a recovery block has no evidence baseline and the gate goes inert',
        );
      }
    },
  },

  /**
   * SELFREPORT-1 (2026-08-21) · a PR the runner typed is not a race the app saw.
   *
   * `generate.ts` seeds `bestRecentVdot` from `profile.race_history` when a
   * runner has NO measured signal at all — the PARITY-1 cold-start path, zero
   * runs and zero races on file. The anchor derived from it was then persisted
   * as `season_anchor_source: 'measured_vdot'`,
   * `season_anchor_provisional: false`, which is the COLD-3 defect on a second
   * data source: a number nobody verified, indistinguishable downstream from a
   * chip time.
   *
   * The doctrine is Rule 3 rather than Rule 1, and the distinction matters. A
   * typed race time IS a performance — Rule 1's "what counts as evidence" list
   * opens with "a race" — so this is not the fabrication `provisional_mileage`
   * records, and the engine goes on pacing off it. What Rule 3 adds is that a
   * race enters at an authority the model must first ESTIMATE, from the
   * conditions it was run in. This claim reads that factor list out of the doc
   * and holds it against the fields a `race_history` row actually carries. None
   * of them answers any factor, so the authority Rule 3 asks for cannot be
   * computed, and full authority — which is what `measured_vdot` grants — is
   * the one answer the rule forbids by construction.
   *
   * Hence the split in `anchor-provenance.ts`: `self_reported_race` fails
   * `isUnverifiedAnchor` (may not be inherited, may not be graded against) and
   * passes `isProvisionalAnchor` (may still price paces and assess a goal).
   */
  {
    id: 'EVIDENCE.self-reported-race-is-not-measured',
    binds: [
      'lib/plan/anchor-provenance.ts#AnchorSource',
      'lib/plan/anchor-provenance.ts#isUnverifiedAnchor',
      'lib/plan/generate.ts#seasonAnchorSource',
    ],
    doc: 'Design/engine-doctrine-evidence-and-levers.md',
    anchor: "## Rule 3 · A race result's authority scales with how representative it was",
    claim:
      'A race result enters the fitness model at an authority the engine must first estimate ' +
      'from the conditions it was run in. A self-reported onboarding PR carries a distance ' +
      'bucket, a time and a when-raced bucket, and answers none of those factors, so it may ' +
      'not be stamped as measured, inherited into a later block as the season baseline, or ' +
      'graded against as if the app had watched the runner run it.',
    check({ cite }) {
      // ── the doctrine, read at run time ────────────────────────────────────
      // Rule 3's own bullet list of what modulates a result's authority.
      const factors = cite.section
        .filter((l) => /^\s*-\s+\S/.test(l))
        .map((l) => l.replace(/^\s*-\s+/, '').trim());
      if (factors.length < 4) {
        throw new Error(
          `Rule 3 now lists ${factors.length} authority factors · re-read the section before trusting this claim`,
        );
      }

      // ── what a self-reported row actually carries ─────────────────────────
      const rh = sourceOf('web-v2/lib/training/race-history.ts');
      const iface = matchLiteral(
        rh, /export interface RaceHistoryEntry \{([\s\S]*?)\n\}/, 'RaceHistoryEntry',
      )[1];
      const fields = [...iface.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
      if (fields.length === 0) throw new Error('RaceHistoryEntry has no fields · the shape was refactored away');

      // What each field the row carries actually tells us. Three questions —
      // WHICH event, HOW FAST, HOW LONG AGO — and Rule 3 asks none of them.
      // Note `whenRaced` is recency, not "did they race all-out": it is a
      // bucket ('<6mo', '6-12mo'), so it does not even carry a date.
      const ANSWERS: Record<string, string> = {
        distance: 'which event',
        otherDistanceMi: 'which event',
        timeSec: 'how fast',
        whenRaced: 'how long ago, to the nearest half-year bucket',
      };
      const unaccounted = fields.filter((f) => !(f in ANSWERS));
      if (unaccounted.length > 0) {
        throw new Error(
          `RaceHistoryEntry gained ${unaccounted.join(', ')} · onboarding is collecting something new about a ` +
            'self-reported race, and whether it answers one of Rule 3\'s authority factors is a judgement ' +
            'a person has to make. Re-read the factor list against the new field, then update this map.',
        );
      }
      // Rule 3's factors are about the CONDITIONS of the performance. Nothing
      // the row carries is a condition, so the authority the rule requires
      // cannot be estimated at any value — including the full authority
      // `measured_vdot` grants.
      const conditionWords = /course|elevation|terrain|heat|humid|wind|pacing|split|taper|fatigue|illness|all-out/i;
      const unconditioned = factors.filter((f) => conditionWords.test(f));
      if (unconditioned.length < 4) {
        throw new Error(
          `only ${unconditioned.length} of Rule 3's ${factors.length} factors still read as conditions of the ` +
            'performance · the rule was rewritten, so re-derive this claim instead of trusting it',
        );
      }

      // ── the engine's answer to that ───────────────────────────────────────
      if (!isUnverifiedAnchor('self_reported_race')) {
        throw new Error('a self-reported anchor is readable as fitness again · isUnverifiedAnchor lets it through');
      }
      if (isProvisionalAnchor('self_reported_race')) {
        throw new Error(
          'self_reported_race was folded into isProvisionalAnchor · that withholds the pace and the goal ' +
            'verdict from a runner who gave us a real race, which is not what Rule 3 asks for',
        );
      }
      if (!paceBlendAnchorIsProvisional({ season_anchor_source: 'self_reported_race' })) {
        throw new Error('the persisted-anchor guard no longer refuses a self-reported anchor');
      }
      if (paceBlendAnchorIsProvisional({ season_anchor_source: 'measured_vdot' })) {
        throw new Error('the guard now refuses a measured anchor too · it has stopped discriminating');
      }

      // ── the stamp, at the places it is written ────────────────────────────
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      // The seeder must RECORD which it handed over, at the site it reads
      // profile.race_history. Without this the composer cannot tell them apart.
      if (!/bestVdotFromRaceHistory\([\s\S]{0,400}?bestRecentVdotSelfReported\s*=/.test(gen)) {
        throw new Error(
          'the race_history seeding site no longer records that what it produced was self-reported',
        );
      }
      // And every writer of season_anchor_source must consult it. A literal
      // 'measured_vdot' sitting next to bestRecentVdot is the original bug.
      for (const m of gen.matchAll(/season_anchor_source:\s*'measured_vdot'/g)) {
        const at = m.index ?? 0;
        const around = gen.slice(Math.max(0, at - 300), at + 200);
        if (/input\.bestRecentVdot|inputs\.compose\.bestRecentVdot/.test(around)) {
          throw new Error(
            "a pace_blend still hardcodes season_anchor_source: 'measured_vdot' beside bestRecentVdot · " +
              'that number may have come from profile.race_history',
          );
        }
      }
    },
  },
  // ══ RACE REPRESENTATIVENESS · rule 8 ══════════════════════════════════════
  // Design/adaptive-progression-engine.md rule 8: "Do not re-anchor downward
  // from every poor race. Diagnose first." These claims hold the diagnosis to
  // the research it says it is reading.
  {
    id: 'REPRESENTATIVENESS.effort-class-authority',
    binds: [
      'lib/race/representativeness.ts#REPRESENTATIVE_FLOOR',
      'lib/race/representativeness.ts#UNREPRESENTATIVE_FLOOR',
      'lib/race/representativeness.ts#effectiveEffortClass',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Recovery by Effort (A vs. B vs. C Race)',
    claim:
      'How much authority a race carries over the fitness model is graded by the same table ' +
      'that grades its recovery: an A race is "Maximum, full taper, peak day", a C race is a ' +
      '"hard workout substitute" run with "no taper". The two tier floors are therefore the ' +
      'doctrine B and C scales rather than invented confidence numbers, they keep the order ' +
      'doctrine states, and a race the athlete raced on overreached legs cannot come out ' +
      'graded above one they declared a tune-up.',
    check({ cite }) {
      const t = cite.table();
      // The semantic basis · doctrine still says a C race is a hard workout.
      const cEffort = t.cell('C race / hard workout substitute', 'Effort given');
      if (!/no taper/i.test(cEffort)) {
        throw new Error(
          `Research/00b no longer describes a C race as run with no taper ("${cEffort}") · ` +
            'the authority grading rests on that reading, so re-read the claim',
        );
      }
      const aEffort = t.cell('A race', 'Effort given');
      if (!/maximum/i.test(aEffort) || !/taper/i.test(aEffort)) {
        throw new Error(`Research/00b no longer describes an A race as a maximal, tapered effort ("${aEffort}")`);
      }
      // The floors ARE the doctrine scales, and sit inside the doc's own bands.
      if (REPRESENTATIVE_FLOOR !== RECOVERY_EFFORT_SCALE.B) {
        throw new Error('REPRESENTATIVE_FLOOR has drifted off the doctrine B-race scale');
      }
      if (UNREPRESENTATIVE_FLOOR !== RECOVERY_EFFORT_SCALE.C) {
        throw new Error('UNREPRESENTATIVE_FLOOR has drifted off the doctrine C-race scale');
      }
      within(REPRESENTATIVE_FLOOR, parsePctBand(t.cell('B race', 'Recovery scale')), 'REPRESENTATIVE_FLOOR');
      within(
        UNREPRESENTATIVE_FLOOR,
        parsePctBand(t.cell('C race / hard workout substitute', 'Recovery scale')),
        'UNREPRESENTATIVE_FLOOR',
      );
      if (UNREPRESENTATIVE_FLOOR >= REPRESENTATIVE_FLOOR) {
        throw new Error('the representativeness floors are inverted');
      }
      // The class grading is monotone and never steps below C.
      if (effectiveEffortClass({ priority: 'A' }).cls !== 'A') {
        throw new Error('a declared A race off a normal taper is not being graded an A effort');
      }
      if (effectiveEffortClass({ priority: 'A', formBand: 'OVERREACH' }).cls !== 'C') {
        throw new Error('a race off overreached legs must be graded a C effort · doctrine ties effort to taper');
      }
      for (const p of ['A', 'B', 'C'] as const) {
        const cls = effectiveEffortClass({ priority: p, formBand: 'OVERREACH' }).cls;
        if (RECOVERY_EFFORT_SCALE[cls] > RECOVERY_EFFORT_SCALE[p]) {
          throw new Error(`a fatigue downgrade RAISED the effort class for a ${p} race`);
        }
      }
    },
  },
  {
    id: 'REPRESENTATIVENESS.materiality-gates',
    binds: [
      'lib/race/representativeness.ts#HEAT_GATE_SUM_F',
      'lib/race/representativeness.ts#HEAT_GATE_DEWPOINT_F',
      'lib/race/representativeness.ts#ALTITUDE_GATE_FT',
      'lib/race/representativeness.ts#WIND_GATE_MPH',
    ],
    doc: 'Research/06-weather-adjustments.md',
    anchor: 'Apply Td/Tair table whenever (Tair + Td) > 110°F or Td > 60°F',
    claim:
      'Doctrine does not only supply weather curves, it states WHEN each one applies. Below ' +
      'those thresholds the correct adjustment is zero rather than a small number — otherwise ' +
      'a cool, still, flat race accumulates a fraction of a percent from every model and ' +
      'quietly costs a clean result part of its authority, which is this module\'s own failure ' +
      'mode arriving from the opposite direction. All four gates are read out of the passage.',
    check({ cite }) {
      const text = cite.text();
      const one = (re: RegExp, what: string): number => {
        const m = text.match(re);
        if (!m) {
          throw new Error(
            `DOCTRINE · ${what} is no longer stated in ${cite.doc} §"When to slow paces" · re-read the claim`,
          );
        }
        // Doctrine writes thousands with a separator ("3,000 ft").
        return Number(m[1].replace(/,/g, ''));
      };
      const sum = one(/\(Tair \+ Td\)\s*>\s*([\d,]+)/, 'the Tair+Td gate');
      const dew = one(/Td\s*>\s*([\d,]+)°F/, 'the dewpoint gate');
      const alt = one(/elevation\s*>\s*([\d,]+)\s*ft/, 'the altitude gate');
      const wind = one(/sustained wind\s*>\s*([\d,]+)\s*mph/, 'the wind gate');

      const pairs: Array<[string, number, number]> = [
        ['HEAT_GATE_SUM_F', HEAT_GATE_SUM_F, sum],
        ['HEAT_GATE_DEWPOINT_F', HEAT_GATE_DEWPOINT_F, dew],
        ['ALTITUDE_GATE_FT', ALTITUDE_GATE_FT, alt],
        ['WIND_GATE_MPH', WIND_GATE_MPH, wind],
      ];
      for (const [name, engine, doctrine] of pairs) {
        if (engine !== doctrine) {
          throw new Error(`${name} is ${engine}, doctrine states ${doctrine}`);
        }
      }
      // And the gates are actually SPENT · a gate nobody consults is the defect.
      const src = sourceOf('web-v2/lib/race/representativeness.ts');
      for (const name of ['HEAT_GATE_SUM_F', 'ALTITUDE_GATE_FT', 'WIND_GATE_MPH']) {
        if ((src.match(new RegExp(name, 'g')) ?? []).length < 2) {
          throw new Error(`${name} is declared but never applied · implement the gate or delete it`);
        }
      }
    },
  },
  {
    id: 'REPRESENTATIVENESS.compose-not-stack',
    binds: [
      'lib/race/representativeness.ts#composeSlowdown',
      'lib/race/representativeness.ts#HEAT_ALTITUDE_COMPOUND_THRESHOLD_PCT',
      'lib/race/representativeness.ts#HEAT_ALTITUDE_COMPOUND_HAIRCUT',
    ],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '### Combined adjustment formula (additive approximation)',
    claim:
      'Conditions COMPOSE, they never stack twice. The general rule is Research/01 ' +
      '§"Combined conditions" ("Add adjustments multiplicatively, not additively"), which is ' +
      'also what lib/terrain/grade-adjust.ts enforces for the heat×grade pair. Research/06 ' +
      'states one exception with a worked number — heat and altitude compound less than the ' +
      'product suggests — and the engine must reproduce that worked example exactly, reading ' +
      'both the threshold and the answer out of the doc rather than agreeing with itself.',
    check({ cite }) {
      const text = cite.text();
      const grab = (re: RegExp, what: string) => {
        const m = text.match(re);
        if (!m) throw new Error(`DOCTRINE · ${what} is no longer stated in ${cite.doc} · re-read the claim`);
        return m;
      };
      const threshold = Number(grab(/when both\s*>\s*(\d+)%/, 'the compounding threshold')[1]);
      const haircut = Number(grab(/reduce expected gains by\s*~?(\d+)%/, 'the compounding haircut')[1]) / 100;
      if (HEAT_ALTITUDE_COMPOUND_THRESHOLD_PCT !== threshold) {
        throw new Error(
          `HEAT_ALTITUDE_COMPOUND_THRESHOLD_PCT is ${HEAT_ALTITUDE_COMPOUND_THRESHOLD_PCT}, doctrine says ${threshold}`,
        );
      }
      if (Math.abs(HEAT_ALTITUDE_COMPOUND_HAIRCUT - haircut) > 1e-9) {
        throw new Error(`HEAT_ALTITUDE_COMPOUND_HAIRCUT is ${HEAT_ALTITUDE_COMPOUND_HAIRCUT}, doctrine says ${haircut}`);
      }

      // The worked example, read out of the doc and reproduced by the engine.
      const ex = grab(
        /a (\d+)% heat \+ (\d+)% altitude condition\s*≈\s*(\d+)%/,
        "doctrine's heat-plus-altitude worked example",
      );
      const [heat, alt, expected] = [Number(ex[1]), Number(ex[2]), Number(ex[3])];
      const got = composeSlowdown({ heat, altitude: alt });
      if (Math.round(got) !== expected) {
        throw new Error(
          `composeSlowdown(${heat}% heat, ${alt}% altitude) = ${got.toFixed(2)}% · doctrine's own ` +
            `worked example says ≈${expected}%`,
        );
      }

      // The general rule is multiplicative, not additive · Research/01.
      const general = resolveCitation('Research/01-pace-zones-vdot.md', '### Combined conditions');
      if (!/multiplicatively, not additively/i.test(general.text())) {
        throw new Error(
          'Research/01 §"Combined conditions" no longer states the multiplicative rule · ' +
            'composeSlowdown is built on it, so re-read both claims',
        );
      }
      // Two factors under the compounding threshold must multiply, not add.
      const additive = 5 + 4;
      const multiplied = composeSlowdown({ heat: 5, course: 4 });
      if (multiplied <= additive) {
        throw new Error(
          `composeSlowdown is adding rather than multiplying: 5% + 4% gave ${multiplied.toFixed(3)}%`,
        );
      }
    },
  },
  {
    id: 'REPRESENTATIVENESS.pacing-cv-bands',
    binds: ['lib/race/representativeness.ts#PACING_CV_CEILING_PCT'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Performance tier | 5-km CV (men) | 5-km CV (women) | Late-race pattern |',
    claim:
      'Split dispersion is only a pacing failure when it exceeds what a runner of that ' +
      'standard normally shows. The Diaz / Hettinga table states those bands per tier, so ' +
      "each of the engine's ceilings is the top of a real row rather than a chosen number, " +
      'and they rise as the standard falls — a four-hour marathoner is allowed more variation ' +
      'than a national-class one.',
    check({ cite }) {
      const t = cite.table();
      const tiers: AbilityTier[] = ['elite', 'mid_pack', 'slow'];
      let previous = 0;
      for (const tier of tiers) {
        const row = PACING_CV_DOC_ROW[tier];
        const [, hi] = parseBand(t.cell(row, '5-km CV (men)'));
        const engine = PACING_CV_CEILING_PCT[tier];
        if (engine !== hi) {
          throw new Error(
            `PACING_CV_CEILING_PCT.${tier} is ${engine}% · Research/08's "${row}" row tops out at ${hi}%`,
          );
        }
        if (engine <= previous) {
          throw new Error(
            `PACING_CV_CEILING_PCT does not rise as the standard falls: ${tier} is ${engine}% ` +
              `against ${previous}% for the tier above it`,
          );
        }
        previous = engine;
      }
      // A women's band exists for every row the engine reads · if doctrine ever
      // drops it, the single-column read below needs revisiting.
      for (const tier of tiers) {
        if (!/\d/.test(t.cell(PACING_CV_DOC_ROW[tier], '5-km CV (women)'))) {
          throw new Error(`Research/08's "${PACING_CV_DOC_ROW[tier]}" row no longer states a women's CV band`);
        }
      }
    },
  },
  {
    id: 'REPRESENTATIVENESS.flat-course-is-not-a-hill',
    binds: ['lib/race/representativeness.ts#FLAT_COURSE_GAIN_FT'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '| Net elevation gain | Slowdown (typical) |',
    claim:
      "Doctrine's course-profile table has a flat row that costs zero, and it states where " +
      'flat ends. A course under that figure must not be charged for its elevation at all.',
    check({ cite }) {
      const t = cite.table();
      const label = t.headers[0];
      const flat = t.rows.find((r) => /^flat/i.test(r[label] ?? ''));
      if (!flat) {
        throw new Error(`DOCTRINE · no "Flat" row in the course-profile table in ${cite.doc}`);
      }
      const m = /<\s*([\d,]+)\s*ft/.exec(flat[label]);
      if (!m) {
        throw new Error(`DOCTRINE · the "Flat" row no longer states a foot threshold ("${flat[label]}")`);
      }
      const doctrineFt = Number(m[1].replace(/,/g, ''));
      if (FLAT_COURSE_GAIN_FT !== doctrineFt) {
        throw new Error(`FLAT_COURSE_GAIN_FT is ${FLAT_COURSE_GAIN_FT}, doctrine says flat is under ${doctrineFt} ft`);
      }
      // And the flat row really does cost nothing.
      const cost = parseBand(flat['Slowdown (typical)']);
      if (cost[0] !== 0 || cost[1] !== 0) {
        throw new Error(`Research/02's flat row now costs ${flat['Slowdown (typical)']} · re-read the claim`);
      }
    },
  },

  /* ── A doctrine claim on a RULE, not a constant ──────────────────────────
   *
   * Every other claim in this file binds a NUMBER to research. This one binds
   * a SELECTION RULE, because the bug it locks had its doctrine stated
   * correctly in a document the engine then contradicted.
   *
   * 2026-08-30 · THIS CLAIM WAS INVERTED. It shipped 2026-08-17 asserting the
   * OPPOSITE of what it asserts now, and it is the reason the inversion
   * survived: the gate was written by the same reasoning as the engine, so it
   * locked the inference in place instead of catching it (CLAUDE.md Rule 22).
   *
   * What it used to assert: `supersededLead` — a training estimate dated on or
   * before a representative race can never outrank that race, whatever its
   * magnitude. Its own stated basis was "the rule doctrine IMPLIES", an
   * inference, and it overrode a sentence Research/01 states outright in
   * §"Implementation notes for the engine": "Selection — pick the highest
   * derived VDOT, not the most recent. A 6-week-old PR is a better fitness
   * signal than a heat-affected race last weekend."
   *
   * Measured on the owner's data the day this was corrected: five training
   * candidates reading at or above the ceiling, every one vetoed for predating
   * an A-race half by days, prescribed easy 9:02-9:42/mi against 27 logged runs
   * at avg HR 144 averaging 8:14/mi.
   */
  {
    id: 'EVIDENCE.selection-takes-the-highest-derived-vdot',
    binds: ['lib/training/vdot.ts#bestRecentVdot.sameDayAsRace'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Implementation notes for the engine',
    claim:
      'Selection takes the HIGHEST DERIVED VDOT, not the most recent evidence. Doctrine states ' +
      'this outright and names this exact case — a older PR beating "a heat-affected race last ' +
      'weekend" — so no date-ordering rule may demote a training candidate below a race merely ' +
      'for predating it. Training influence is bounded by the AUDIT #8 soft cap (bestRaceRaw + ' +
      'the doctrinal +1 lead quantum) and by the freshness window; it does not need, and ' +
      'doctrine does not license, a second veto on top. The ONE demotion kept is a data-identity ' +
      'guard, not a doctrinal one: a run dated the same day as a race is that race re-ingested ' +
      'or its warm-up, and must not let the race lead itself by +1.',
    check() {
      const src = sourceOf('web-v2/lib/training/vdot.ts');
      // 1 · The doctrine sentence this rule rests on must still be there, and
      //     must still say HIGHEST rather than most-recent. Read out of the
      //     doc at run time — a check that hardcodes both sides only proves the
      //     test agrees with itself (Rule 18).
      const notes = resolveCitation(
        'Research/01-pace-zones-vdot.md', '### Implementation notes for the engine').text();
      if (!/pick the highest derived VDOT, not the most recent/i.test(notes)) {
        throw new Error(
          'Research/01 §"Implementation notes for the engine" no longer says to pick the highest ' +
            'derived VDOT rather than the most recent · that sentence is the entire basis for ' +
            'retiring the superseded-lead veto. Re-read the passage before changing the engine.',
        );
      }
      // 2 · The retired rule must STAY retired. This is the ratchet: if a
      //     future edit reintroduces a date veto under any name, the shape is
      //     back and this claim fails.
      if (/const supersededLead\b/.test(src)) {
        throw new Error(
          '`supersededLead` is back in bestRecentVdot · the date veto contradicts Research/01 ' +
            '§"Implementation notes" ("pick the highest derived VDOT, not the most recent"). ' +
            'If it is genuinely needed again, change the CLAIM first, with a citation.',
        );
      }
      if (/c\.date <= freshestRaceDate|c\.date < freshestRaceDate/.test(src)) {
        throw new Error(
          'a training candidate is being demoted by DATE against a race again · that is the ' +
            'superseded-lead shape under a new name',
        );
      }
      // 3 · The identity guard that replaced it must be defined AND applied.
      //     A rule that is defined but inert is how the last one looked after
      //     it was half-removed.
      matchLiteral(
        src,
        /const sameDayAsRace = \(c: VdotCandidate\): boolean =>\s*\n?\s*c\.source === 'run' && representativeRaceDates\.has\(c\.date\);/,
        'bestRecentVdot same-day race-echo guard',
      );
      if (!/\(\(sameDayAsRace\(b\) \? 0 : 1\) - \(sameDayAsRace\(a\) \? 0 : 1\)\)/.test(src)) {
        throw new Error(
          'the same-day race-echo tier is no longer applied in the candidate sort · the rule is ' +
            'defined but inert',
        );
      }
      // 4 · A BOUND on an individual training read must still exist. If it were
      //     ever removed, a single training read WOULD run away and this
      //     claim's reasoning would no longer hold.
      //
      //     2026-08-30 · what the bound is MADE OF changed (the corpus, not a
      //     race — see `CONVENTION.corpus-corroboration-count`), so this clause
      //     no longer pins the race-anchored expression literally. It pins the
      //     two things this claim actually depends on: that the +1 lead quantum
      //     is still what a single session may lead by, and that the race arm
      //     survives as the fallback for a runner whose corpus cannot yet
      //     corroborate. Whether the bound is corpus- or race-anchored is that
      //     other claim's business; that there IS one is this claim's.
      if (!/trainingCeiling = corpusRead\.ok\s*\n?\s*\? corpusRead\.vdot \+ TRAINING_ESTIMATE_SOFT_CAP_VDOT/.test(src)) {
        throw new Error(
          'the corpus-anchored training ceiling is gone from bestRecentVdot · some bound on a ' +
            'single training read is what stops one session running away from the evidence, and ' +
            'retiring the date veto depends on there being one',
        );
      }
      if (!/bestRaceRaw != null \? bestRaceRaw \+ TRAINING_ESTIMATE_SOFT_CAP_VDOT : null/.test(src)) {
        throw new Error(
          'the race-anchored fallback ceiling is gone · it is what bounds a runner whose training ' +
            'corpus cannot yet corroborate itself (fewer than the corroboration minimum), which ' +
            'is every runner in their first weeks',
        );
      }
    },
  },

  /* ── The ceiling anchors to evidence the headline trusts ─────────────────
   *
   * Sibling of the claim above, and the other half of the same 2026-08-30
   * correction. `bestRecentVdot` says twice, in its own comments, that the
   * training soft cap "anchors to the same evidence the headline trusts" — but
   * the exclusion implementing that sentence (`authorityDemoted`) is inert
   * unless a BETTER-graded race exists. So a runner whose ONLY race was graded
   * below the representative floor — including one they had explicitly
   * reported as compromised through `POST /api/v5/race-authority` — still had
   * every training read bounded to that race + 1.
   */
  {
    id: 'EVIDENCE.ceiling-anchors-to-a-well-paced-race',
    binds: ['lib/training/vdot.ts#bestRecentVdot.subRepresentative'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Triggers to retest',
    claim:
      'The training soft-cap ceiling asks "what is the last HARD PROOF of fitness", and doctrine ' +
      'licenses "Update VDOT from race" only for a result that was all-out and well-paced. A ' +
      'race graded below the representative floor is not that proof, so it does not set the ' +
      'ceiling — even when it is the only race in scope. It is still proof of a FLOOR: it stays ' +
      'in the pool, competes at face value, and anchors the headline when it is all the runner ' +
      'has ("a floor you have beats a guess you don\'t"). Only its power to bound OTHER evidence ' +
      'is withdrawn.',
    check() {
      const src = sourceOf('web-v2/lib/training/vdot.ts');
      // Doctrine's qualifier on which race result updates VDOT, read at run time.
      const triggers = resolveCitation(
        'Research/01-pace-zones-vdot.md', '### Triggers to retest').text();
      if (!/all-out.*well-paced/i.test(triggers)) {
        throw new Error(
          'Research/01 §"Triggers to retest" no longer qualifies which race result updates VDOT ' +
            '("all-out, well-paced") · that clause is what excludes a sub-representative race ' +
            'from setting the training ceiling',
        );
      }
      matchLiteral(
        src,
        /const subRepresentative = \(c: RaceVdotCandidate\): boolean =>\s*\n?\s*c\.authority < REPRESENTATIVE_FLOOR;/,
        'bestRecentVdot sub-representative ceiling exclusion',
      );
      // WIRED · defined is not enough, it has to be in the exclusion.
      if (!/demotedForCeiling\(c\) \|\| authorityDemoted\(c\) \|\| subRepresentative\(c\)/.test(src)) {
        throw new Error(
          'the sub-representative exclusion is no longer applied to the ceiling · the rule is ' +
            'defined but inert',
        );
      }
      // And the race must NOT have been removed from the pool as well — the
      // whole point is ranked-not-removed. If a future edit starts filtering
      // sub-representative races out of raceCandidates, this claim's "still
      // anchors as a floor" half is silently false.
      // Anchored at line start so the historical note in `bestRecentVdot`'s own
      // comment — which quotes this exact statement to record that it was
      // REMOVED — is not read as the statement coming back. Real code here is
      // indented inside the race loop; the note is prefixed by `//` or ` * `.
      if (/^\s*if \(r\.priority === 'C'\) continue;/m.test(src)) {
        throw new Error(
          'sub-representative races are being REMOVED from the candidate pool again · doctrine ' +
            'ranks them, it does not delete them, or a C-race-only runner has no anchor at all',
        );
      }
    },
  },

  /* ── A CONVENTION claim · THE CORPUS IS THE ANCHOR ───────────────────────
   *
   * The owner's ruling, 2026-08-30: "Stop anchoring everything into one
   * fucking race when I have so much data there to pull from... We anchor it
   * into the evidence. What's the evidence?? THE FUCKING RUNNING."
   *
   * Two sibling claims above already fixed WHICH evidence wins a comparison.
   * Neither touched the fact that the COMPARISON'S CEILING was a race's
   * number: `trainingCeiling = bestRaceRaw + 1`. So the owner's corrected
   * anchor, 45.1, was still literally "his race, plus one" — and a runner with
   * no race at all had no ceiling whatsoever, which is two different laws for
   * one question decided by whether a `races` row happens to exist.
   *
   * The ceiling is now what at least `CORROBORATION_MIN_OBSERVATIONS`
   * independent training sessions support. Like the two CONVENTION claims
   * elsewhere in this file, this one asserts that a number is OURS and exists
   * so nobody can quietly re-label it as science: `Research/` does not model a
   * training corpus and names no session count.
   *
   * What research DOES ground is the shape, and this check reads it out of the
   * doc at run time: §"Triggers to retest" prices ONE good tempo at "+1 VDOT
   * estimated", i.e. a single session is a lead and not a fitness number,
   * which is precisely why a corroborated level is needed for it to lead from.
   */
  {
    id: 'CONVENTION.corpus-corroboration-count',
    binds: [
      'lib/training/vdot-corpus.ts#CORROBORATION_MIN_OBSERVATIONS',
      'lib/training/vdot-corpus.ts#corroboratedCorpusVdot',
      'lib/training/vdot.ts#bestRecentVdot.trainingCeiling',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Triggers to retest',
    claim:
      'The fitness ceiling a single training session may lead from is the CORROBORATED CORPUS ' +
      'level, not a race. The session COUNT that constitutes corroboration is a CONVENTION, not ' +
      'a research finding — Research/ does not model a training corpus. What research grounds is ' +
      'the shape: §"Triggers to retest" prices one good tempo at "+1 VDOT estimated; field-test ' +
      'within 2 weeks", so a single session is a LEAD and never a fitness number, which is what ' +
      'requires a corroborated level for it to lead FROM. What this claim enforces is that the ' +
      'count stays above one (a corpus of one is the cherry-pick the rule exists to prevent), ' +
      'that the read is an ORDER statistic no single observation can set, that the lead quantum ' +
      'above it is still the doctrinal +1, and that the module never advertises the count as ' +
      'measured.',
    check() {
      const src = sourceOf('web-v2/lib/training/vdot-corpus.ts');

      // The doctrine sentence the SHAPE rests on, read out of the doc at run
      // time · a check that hardcodes both sides only proves it agrees with
      // itself (Rule 18).
      const triggers = resolveCitation(
        'Research/01-pace-zones-vdot.md', '### Triggers to retest').text();
      if (!/\+\s*1\s*VDOT/i.test(triggers) || !/tempo/i.test(triggers)) {
        throw new Error(
          'Research/01 §"Triggers to retest" no longer prices a good tempo at +1 VDOT · that ' +
            'clause is why one session is a lead rather than a fitness number, and it is the ' +
            'entire shape this convention rests on',
        );
      }

      // The honest label must stay. Same discipline as
      // CONVENTION.cold-start-mileage-anchor.
      if (!/THIS NUMBER IS A CONVENTION, NOT A RESEARCH FINDING/.test(src)) {
        throw new Error(
          'vdot-corpus.ts no longer states that the corroboration count is a convention · that ' +
            'sentence is the whole point of this claim',
        );
      }

      // A corpus of one is the cherry-pick this exists to prevent.
      const m = src.match(/export const CORROBORATION_MIN_OBSERVATIONS = (\d+);/);
      if (!m) throw new Error('CORROBORATION_MIN_OBSERVATIONS is gone or no longer a literal');
      const k = Number(m[1]);
      if (!(k >= 2)) {
        throw new Error(
          `CORROBORATION_MIN_OBSERVATIONS is ${k} · at 1 the "corroborated" level IS the single ` +
            'best session, which is exactly the cherry-pick the rule exists to prevent',
        );
      }

      // WIRED, and an ORDER statistic. A mean or a max would let one
      // observation move the level, which is the property being bought.
      if (!/sorted\[minObservations - 1\]\.vdot/.test(src)) {
        throw new Error(
          'the corpus read is no longer the Kth-highest observation · a mean, a max or a blend ' +
            'lets a single session move the level, which is what corroboration is for',
        );
      }
      // The refusal must stay a TYPE, not a number (Rule 11). If the refusal
      // branch ever grows a `vdot`, a caller can spend a "don't know" as zero.
      //
      // 2026-08-30 · FALSIFIED, and the first version of this check did not
      // fire. It searched for `vdot` AFTER the `reason:` line, so inserting the
      // field one line ABOVE it walked straight through — a check that catches
      // one ordering of the same defect is not a check. It now reads the whole
      // refusal branch out of the union and asserts over all of it.
      const refusalStart = src.indexOf('ok: false;');
      if (refusalStart < 0) {
        throw new Error("the CorpusRead refusal branch is gone · `ok: false` no longer appears");
      }
      const refusalEnd = src.indexOf('};', refusalStart);
      const refusal = src.slice(refusalStart, refusalEnd < 0 ? src.length : refusalEnd);
      if (/\bvdot\b/.test(refusal)) {
        throw new Error(
          'the CorpusRead refusal branch carries a `vdot` field · the refusal is a TYPE so that ' +
            '`read.vdot` does not compile until the caller has branched (Rule 11). A refusal that ' +
            'can be read as a number is how "measured zero" and "don\'t know" get collapsed.',
        );
      }

      // And the engine must actually SPEND it as the ceiling — defined but
      // inert is how every rule in this file has failed before.
      const vdotSrc = sourceOf('web-v2/lib/training/vdot.ts');
      if (!/corpusRead = corroboratedCorpusVdot\(corpusObs\);/.test(vdotSrc)) {
        throw new Error('bestRecentVdot no longer computes the corpus read · the rule is inert');
      }
      if (!/trainingCeiling = corpusRead\.ok\s*\n?\s*\? corpusRead\.vdot \+ TRAINING_ESTIMATE_SOFT_CAP_VDOT/.test(vdotSrc)) {
        throw new Error(
          'the training ceiling is no longer anchored on the corpus · it is back to being a ' +
            "race's number plus a constant, which is the defect this claim was written for",
        );
      }

      // BEHAVIOURAL, because a source regex can always be walked around and
      // this one was: the first version of the sibling check above matched
      // even after the branch had been made inert with `false &&`. Reading the
      // source proves the code is WRITTEN; running it proves the code ACTS.
      //
      // Four corroborating threshold sessions at 7:05/mi under a 1:41:53 half.
      // The race reads 44.1, so the retired ceiling would clamp every one of
      // them to 45.1. The corpus corroborates ~48.4, and that is what must
      // come out.
      const race = [{
        slug: 'x', name: 'x', date: '2026-09-20', priority: 'A',
        distance_mi: 13.1, finish_seconds: 6113,
      }];
      const runs = [0, 1, 2, 3].map((i) => ({
        id: `d${i}`,
        date: new Date(Date.parse('2026-10-12T12:00:00Z') - (i * 5 + 2) * 86400000)
          .toISOString().slice(0, 10),
        workout_type: 'threshold', distance_mi: 5, finish_seconds: 5 * 425,
        avg_hr: 168, max_hr: 188, zone: 'threshold' as const,
      }));
      const live = bestRecentVdot(race, '2026-10-12', 180, runs, 4);
      if (!live.corpus.ok) {
        throw new Error(
          'four corroborating sessions did not produce a corpus read · either the corroboration ' +
            'minimum has grown past what a normal training block supplies, or the corpus is not ' +
            'being computed at all',
        );
      }
      if (!(live.best && live.best.vdot > 44.1 + TRAINING_ESTIMATE_SOFT_CAP_VDOT + 0.05)) {
        throw new Error(
          `the anchor came out at ${live.best?.vdot} · four corroborating threshold sessions well ` +
            'above the race still resolved at or below race + 1, so the ceiling is behaving as a ' +
            "race's number plus a constant however it is written",
        );
      }
      if (live.best.vdot > live.corpus.vdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT + 1e-9) {
        throw new Error(
          `the anchor (${live.best.vdot}) leads the corroborated corpus (${live.corpus.vdot}) by ` +
            'more than the doctrinal +1 · the bound is not being applied',
        );
      }
    },
  },

  /* ── SELECTION-TIME EFFORT CLASS ─────────────────────────────────────────
   *
   * The claim that let the A/B filter in `vdot-inputs.ts` be opened. That
   * filter read as data hygiene and was load-bearing safety, because
   * `assessRaceRepresentativeness` was never consulted on the selection path:
   * selection is max-wins, so it kept the aided read and discarded the hilly
   * one. Authority now scales a candidate's WEIGHT instead of gating its
   * membership, and this claim is what stops the grading being quietly deleted
   * on the way — "every race has meaning" read as "every race weighs the same"
   * is the failure mode most worth preventing.
   */
  {
    id: 'EVIDENCE.race-authority-is-the-effort-class',
    binds: [
      'lib/race/effort-authority.ts#selectionAuthority',
      'lib/race/effort-authority.ts#authorityTier',
      'lib/training/vdot.ts#bestRecentVdot.authorityDemoted',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Recovery by Effort (A vs. B vs. C Race)',
    claim:
      'How much a race result is allowed to weigh at SELECTION is graded by the same table that ' +
      'grades its recovery: an A race is "Maximum, full taper, peak day"; a C race is "Strong ' +
      'effort, no taper … treat like a hard workout". The three scales are read out of the doc ' +
      'rather than restated here, they stay strictly ordered, and the grading is actually SPENT ' +
      'in the candidate sort. A grading that is computed and never ranked on is the shape the ' +
      'whole representativeness module already had: 900 lines of diagnosis that the path setting ' +
      'every prescribed pace never called.',
    check({ cite }) {
      const t = cite.table();
      const scale = (row: string) => parsePctBand(t.cell(row, 'Recovery scale'));
      if (selectionAuthority('A') !== 1.0) {
        throw new Error('an A race is the full table · selection authority must be 1.0');
      }
      within(selectionAuthority('B'), scale('B race'), "selectionAuthority('B')");
      within(
        selectionAuthority('C'),
        scale('C race / hard workout substitute'),
        "selectionAuthority('C')",
      );
      // Strictly ordered · collapsing the distinction is the mistake this
      // claim exists to prevent.
      if (!(selectionAuthority('A') > selectionAuthority('B')
            && selectionAuthority('B') > selectionAuthority('C'))) {
        throw new Error(
          'selection authority no longer distinguishes A, B and C races · Research/00b grades ' +
            'them differently and the engine must too',
        );
      }
      // Case-insensitive, because `races.meta->>'priority'` is free text.
      for (const p of GRADED_RACE_PRIORITIES) {
        if (selectionAuthority(p.toLowerCase()) !== selectionAuthority(p)) {
          throw new Error(`selectionAuthority is case-sensitive on '${p}' · the column is free text`);
        }
      }
      // The tiers must land on the doctrine floors.
      if (authorityTier(selectionAuthority('A')) !== 'representative'
          || authorityTier(selectionAuthority('B')) !== 'representative'
          || authorityTier(selectionAuthority('C')) !== 'compromised') {
        throw new Error(
          'the authority tiers no longer place A and B above the representative floor with C ' +
            'below it · that placement is what the two doctrine floors mean',
        );
      }
      // WIRED · the grade must reach the ranking, and must not reach the value.
      const src = sourceOf('web-v2/lib/training/vdot.ts');
      if (!/authority: selectionAuthority\(r\.priority\)|const (declared)?[Aa]uthority = selectionAuthority\(r\.priority\);/.test(src)) {
        throw new Error('bestRecentVdot no longer grades its race candidates');
      }
      // 2026-08-21 · race-data re-audit · a RUNNER-REPORTED tier
      // (`actual_result.authority_tier`, written by POST /api/v5/race-authority)
      // may now cap that grading. Doctrine's table still sets the base, so the
      // override has to be DOWNWARD ONLY: the runner knows things the engine
      // cannot (heat, illness, paced a friend) and so may say a result proves
      // LESS than its priority implies, but "this parkrun was actually an A
      // race" is a claim about effort that doctrine's own table already
      // answers. A Math.max here — or a bare assignment — would turn the
      // question into the "make me faster" button its own route header
      // forbids, and would let a runner promote a C race above the
      // representative floor by tapping a button.
      if (/const declaredAuthority = selectionAuthority\(r\.priority\);/.test(src)
          && !/Math\.min\(declaredAuthority,/.test(src)) {
        throw new Error(
          'the runner-reported authority tier is no longer clamped downward against the ' +
            "doctrine grading · a runner's answer may lower what a race proves, never raise it",
        );
      }
      if (!/\(\(authorityDemoted\(b\) \? 0 : 1\) - \(authorityDemoted\(a\) \? 0 : 1\)\)/.test(src)) {
        throw new Error(
          'the authority tier is no longer applied in the candidate sort · the grade is computed ' +
            'and never spent, which is exactly how representativeness looked before this work',
        );
      }
      if (/vdot(_raw)?: [^,\n]*authority/.test(src)) {
        throw new Error(
          "a candidate's VDOT is being scaled by its authority · that fabricates a finish time " +
            'nobody ran. Rule 8 scales the ADJUSTMENT, not the performance',
        );
      }
      // And the SQL filter it replaced must stay gone · if it comes back, the
      // grading above is decoration again. Comment lines are stripped first:
      // the fix's own note names the clause it deleted, and a check that cannot
      // tell a description from an execution is the shape of a false alarm
      // nobody trusts twice.
      const loader = sourceOf('web-v2/lib/training/vdot-inputs.ts')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      if (/priority'\s+IN\s+\('A',\s*'B'\)/.test(loader)) {
        throw new Error(
          "the A/B priority filter is back in vdot-inputs.ts · it and the authority grading are " +
            'two answers to one question, and only one of them lets a C race count at all',
        );
      }
    },
  },

  /* ── The ungraded row ────────────────────────────────────────────────────
   *
   * `Research/00b`'s effort table has exactly three rows. `lib/faff/types.ts`
   * allows `training_run` and `hilly_excluded`, and `races.meta->>'priority'`
   * is free text besides. Which doctrine row an ungraded label falls to is
   * OURS to decide, so it is labelled a convention rather than dressed as a
   * finding — the failure `CONVENTION.cold-start-mileage-anchor` was written
   * for. What is not ours to decide is the direction of the error.
   */
  {
    id: 'CONVENTION.ungraded-race-priority',
    binds: [
      'lib/race/effort-authority.ts#selectionAuthority',
      'lib/race/effort-authority.ts#isGradedRacePriority',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Recovery by Effort (A vs. B vs. C Race)',
    claim:
      'A priority the effort table has no row for is graded at the LOWEST graded row, not the ' +
      'highest. This is a convention: doctrine names A, B and C and says nothing about ' +
      '`hilly_excluded` or `training_run`. What research supplies is the direction. Grading an ' +
      'ungraded row as an A race asserts what the A row says — "Maximum, full taper, peak day" — ' +
      'about a row whose own label says the course did the talking or that it was not a race at ' +
      'all. `recoveryEffortScale` deliberately defaults the other way because for recovery ' +
      'DURATION over-resting is the safe error; for AUTHORITY the safe error is the opposite, and ' +
      'reusing that default is how a course-excluded marathon would have come to set every ' +
      'prescribed pace. The two mappings must therefore agree on every graded priority and ' +
      'disagree on ungraded ones.',
    check({ cite }) {
      const t = cite.table();
      // The doc still has exactly the three rows this convention fills the gaps around.
      for (const row of ['A race', 'B race', 'C race / hard workout substitute']) {
        if (!t.cell(row, 'Effort given')) {
          throw new Error(`Research/00b's effort table no longer has a "${row}" row`);
        }
      }
      const cRow = t.cell('C race / hard workout substitute', 'Recovery scale');
      const lowest = parsePctBand(cRow);

      for (const p of GRADED_RACE_PRIORITIES) {
        if (!isGradedRacePriority(p)) throw new Error(`'${p}' should be a graded priority`);
        if (selectionAuthority(p) !== recoveryEffortScale(p)) {
          throw new Error(
            `selectionAuthority('${p}') and recoveryEffortScale('${p}') have drifted apart · ` +
              'both spend the same doctrine row and must agree wherever doctrine has one',
          );
        }
      }
      for (const p of ['hilly_excluded', 'training_run', 'DNF', '', null]) {
        if (isGradedRacePriority(p)) throw new Error(`'${p}' should not be a graded priority`);
        within(selectionAuthority(p), lowest, `selectionAuthority(${JSON.stringify(p)})`);
        if (selectionAuthority(p) >= selectionAuthority('B')) {
          throw new Error(
            `an ungraded priority (${JSON.stringify(p)}) is being trusted at or above a B race · ` +
              'the whole point of this convention is that it is not',
          );
        }
        // And it must be the honest opposite of the recovery default, not a
        // silent copy of it.
        if (selectionAuthority(p) === recoveryEffortScale(p)) {
          throw new Error(
            `selectionAuthority(${JSON.stringify(p)}) has picked up recoveryEffortScale's ` +
              'unknown→A default · that default is correct for recovery duration and wrong here',
          );
        }
      }
    },
  },

  {
    id: 'EVIDENCE.fast-quality-is-not-automatically-fitness',
    binds: [
      'lib/training/threshold-band.ts#THRESHOLD_HR_CEILING_OF_TARGET',
      'lib/training/threshold-band.ts#fastQualityLeftTheBand',
      'lib/coach/run-recap.ts#tempoExecution',
    ],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| 5a Threshold | 100–102% | At LT — cruise intervals |',
    claim:
      'Running quality work FASTER than prescribed has two explanations that call for opposite ' +
      'responses — soft targets, or an overcooked session — and heart rate tells them apart. ' +
      'Friel zone 5a, "At LT", tops out at 102% of LTHR; above that the session left the band ' +
      'it was prescribed for. The engine used to assume soft targets unconditionally and told ' +
      'the runner to "refit VDOT and tighten the paces", which validates overcooking and hands ' +
      'back faster targets that make the next session hotter still. Threshold adaptation comes ' +
      'from TIME at the intensity where lactate clearance matches production, so exceeding the ' +
      'pace shortens the dose rather than increasing it.',
    check({ cite }) {
      const pct = matchLiteral(
        cite.text(),
        /\|\s*5a Threshold\s*\|\s*(\d+)[–-](\d+)%\s*\|/,
        'Friel zone 5a band',
      );
      const ceilingPct = Number(pct[2]) / 100;
      within(
        THRESHOLD_HR_CEILING_OF_TARGET,
        [ceilingPct, ceilingPct],
        'threshold HR ceiling as a multiple of the session target',
      );
      // An unreadable heart rate must never READ as overcooked — that would
      // suppress every legitimate refit for runners training without a strap.
      if (fastQualityLeftTheBand(0, 0)) {
        throw new Error('no HR data now reads as overcooked · absence of evidence became a finding');
      }
      if (!fastQualityLeftTheBand(4, 3) || fastQualityLeftTheBand(4, 2)) {
        throw new Error('the overcooked finding no longer requires a majority of readable sessions');
      }

      // THE MIRROR. Every context filter in this engine was historically added
      // to the branch where a bug was seen and not to its opposite; this claim
      // exists to make that asymmetry fail loudly rather than sit unnoticed.
      // Slower-than-prescribed is equally ambiguous AND it loops: a lower VDOT
      // gives softer targets, softer targets are easier, and the next round of
      // evidence is worse.
      const [floorPct] = matchLiteral(
        cite.text(),
        /\|\s*5a Threshold\s*\|\s*(\d+)[–-]\d+%\s*\|/,
        'Friel zone 5a floor',
      ).slice(1);
      within(
        THRESHOLD_HR_FLOOR_OF_TARGET,
        [Number(floorPct) / 100, Number(floorPct) / 100],
        'threshold HR floor as a multiple of the session target',
      );
      if (slowQualityNeverReachedTheBand(0, 0)) {
        throw new Error('no HR data now reads as "never reached the band" · absence became a finding');
      }
      if (!slowQualityNeverReachedTheBand(4, 3) || slowQualityNeverReachedTheBand(4, 2)) {
        throw new Error('the under-reached finding no longer requires a majority of readable sessions');
      }
    },
  },

  /* ── A CONVENTION claim ──────────────────────────────────────────────────
   *
   * Every other entry in this file asserts that an engine constant AGREES with
   * research. This one asserts the opposite and does it on purpose: the
   * numbers it watches are a product convention, they are not in `Research/`,
   * and the claim exists so nobody can quietly re-label them as science.
   *
   * The defect that motivated it: `conservativeVdotFromMileage` carried
   * `Daniels Running Formula §"VDOT and Training" — mileage-band heuristic`
   * for two months. There is no such table. Daniels derives VDOT from race
   * performance and publishes no mileage mapping, and the cited section
   * resolves to nothing in `Research/`. It was the single most consequential
   * number for every new user, and the gate could not see it — because a
   * citation that names a BOOK rather than a `Research/` file is invisible to
   * a registry that only checks file anchors.
   *
   * So the claim binds what the function actually owes: monotonic, bounded,
   * conservative. Not measured.
   */
  {
    id: 'CONVENTION.cold-start-mileage-anchor',
    binds: ['lib/plan/spec-builder.ts#conservativeVdotFromMileage'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume table — miles per week (km in parentheses)',
    claim:
      'The cold-start pace anchor is a CONVENTION, not a research finding. Research grounds its ' +
      'SHAPE only: the volume table maps weekly mileage to a competitive tier per distance, and ' +
      'its closing note that "the first 30 mi/wk produces the largest improvements" is why the ' +
      'bands are dense at the bottom and flatten above. The specific VDOTs are ours, chosen to ' +
      'sit low because the two errors do not cost the same — over-estimating prescribes a ' +
      'beginner work they cannot absorb, under-estimating prescribes work that is merely too ' +
      'easy until real evidence arrives. What this claim enforces is that the function stays ' +
      'monotonic, stays inside the Daniels table it floors on, and never advertises itself as ' +
      'measured.',
    check() {
      const src = sourceOf('web-v2/lib/plan/spec-builder.ts');

      // The false citation must not come back.
      if (/Daniels Running Formula §"VDOT and Training"/.test(src)) {
        throw new Error(
          'the fabricated `Daniels §"VDOT and Training"` citation is back on ' +
            'conservativeVdotFromMileage · that table does not exist',
        );
      }
      // And the honest label must stay.
      if (!/THESE NUMBERS ARE A CONVENTION, NOT A RESEARCH FINDING/.test(src)) {
        throw new Error(
          'conservativeVdotFromMileage no longer states that its values are a convention · ' +
            'that sentence is the whole point of this claim',
        );
      }

      // Monotonic and bounded. Read the rungs out of the source rather than
      // restating them here, so the check cannot agree with a stale copy.
      const body = src.slice(src.indexOf('export function conservativeVdotFromMileage'));
      const rungs = [...body.slice(0, body.indexOf('\n}')).matchAll(
        /if \(weeklyMi >= (\d+)\) return (\d+);/g,
      )].map((m) => ({ mi: Number(m[1]), vdot: Number(m[2]) }));
      if (rungs.length < 5) {
        throw new Error(`could not read the mileage bands out of the source · found ${rungs.length}`);
      }
      for (let i = 1; i < rungs.length; i++) {
        if (rungs[i].mi >= rungs[i - 1].mi || rungs[i].vdot >= rungs[i - 1].vdot) {
          throw new Error(
            `the mileage bands are no longer monotonic at ${rungs[i].mi} mi → ${rungs[i].vdot}`,
          );
        }
      }
      // Daniels' published table spans 30-85. A mileage guess must never
      // reach a value the tables treat as a competitive performance.
      atMost(rungs[0].vdot, 50, 'top cold-start mileage band');
      if (conservativeVdotFromMileage(1) !== 30) {
        throw new Error('the cold-start floor left the bottom of the Daniels table');
      }
      // The volume table it grounds on must still exist and still be a table.
      const t = resolveCitation(
        'Research/00a-distance-running-training.md',
        '### Volume table — miles per week (km in parentheses)',
      ).text();
      if (!/Beginner/.test(t) || !/Elite/.test(t)) {
        throw new Error('Research/00a volume table no longer spans beginner to elite');
      }
      // HIGHVOL-1 (2026-08-19) · and it must not FLATTEN before the table does.
      // The ladder ended at 45 mi/wk while doctrine's own table goes on to name
      // three further competitive tiers, so every runner from 45 to 200 mi/wk
      // was handed one number. The top rung must at least reach the lowest
      // sub-elite floor the table states — read out of the table, not restated.
      const subEliteFloors = t
        .split('\n')
        .filter((l) => l.startsWith('|') && !/^\|\s*(Distance|-)/.test(l))
        .map((l) => l.split('|').map((c) => c.trim()))
        // `| Distance | Beginner | Recreational competitive | Sub-elite | Elite |`
        // → index 4 is the sub-elite cell (index 0 is the empty pre-pipe field).
        .filter((c) => c.length > 5)
        .map((c) => parseBand(c[4])[0])
        .filter((n) => Number.isFinite(n) && n > 0);
      if (subEliteFloors.length < 4) {
        throw new Error(
          `could not read the sub-elite column out of Research/00a's volume table · ` +
            `found ${subEliteFloors.length} rows`,
        );
      }
      const lowestSubElite = Math.min(...subEliteFloors);
      if (rungs[0].mi < lowestSubElite) {
        throw new Error(
          `the cold-start ladder flattens at ${rungs[0].mi} mi/wk, below doctrine's lowest ` +
            `sub-elite floor of ${lowestSubElite} mi/wk · every runner above it gets one guess`,
        );
      }
    },
  },

  /* ── A SECOND CONVENTION CLAIM ───────────────────────────────────────────
   *
   * `CALIBRATION_INTRO_WEEKS` is the sibling of the constant above and shares
   * its hazard: it sits on the cold-start path, it decides what a brand-new
   * runner is prescribed, and no passage in `Research/` states it. The whole
   * reason it exists is that `conservativeVdotFromMileage` invents a VDOT — so
   * a fabricated citation attached to the FIX would be the same defect wearing
   * the bandage.
   *
   * What research does state, and what this claim reads out of the doc:
   *
   *   · §"Field-test protocols (when no recent race exists)" — doctrine's own
   *     answer to an absent race is RUN A TEST, not estimate. The intro's
   *     threshold session is that test in all but name.
   *   · §"When to lock to a specific pace vs. give a range" — "the harder the
   *     workout, the tighter the lock", and its own escape hatch: where a pace
   *     target is not meaningful, "Use HR/effort, not pace".
   *
   * The second of those is a genuine tension and is recorded as one rather than
   * argued away: doctrine wants threshold work pace-locked, and for the intro
   * window we do not lock it. The claim therefore constrains the window from
   * both sides — it must be short, it must be endable by evidence, and it must
   * never be able to cover a whole plan.
   */
  {
    id: 'CONVENTION.calibration-intro-window',
    binds: [
      'lib/plan/anchor-provenance.ts#CALIBRATION_INTRO_WEEKS',
      'lib/plan/anchor-provenance.ts#EFFORT_CUED_TYPES',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Field-test protocols (when no recent race exists)',
    claim:
      'The length of the cold-start calibration intro is a DATA-SUFFICIENCY CONVENTION, not a ' +
      'physiological finding, and must say so in its own source. Research grounds only the shape: ' +
      'when no recent race exists doctrine prescribes a FIELD TEST rather than an estimate, and ' +
      'the threshold session the intro prescribes is that test. Doctrine separately wants hard ' +
      'work pace-locked ("the harder the workout, the tighter the lock"), so withholding a pace ' +
      'is a deviation that has to be bounded: the window stays short, it applies only to the ' +
      'generic quality families, it never touches work priced off the runner\'s stated goal ' +
      '(race day, the race-week tune-up), and a measured read must be able to end it early. ' +
      'What is enforced is those bounds and the honest labelling — never the number itself.',
    check({ cite }) {
      const src = sourceOf('web-v2/lib/plan/anchor-provenance.ts');

      // 1 · The honest label must be present, in the same form the sibling
      // claim enforces. This sentence is the whole point.
      if (!/THIS IS A DATA-SUFFICIENCY CONVENTION, NOT A PHYSIOLOGICAL CLAIM/.test(src)) {
        throw new Error(
          'CALIBRATION_INTRO_WEEKS no longer states that it is a convention · that sentence is ' +
            'what stops the next reader treating it as physiology',
        );
      }
      // 2 · And no `Research/` citation may be attached to it. A cold-start
      // constant wearing a citation is exactly the defect this file was
      // extended to catch; if one ever belongs here it goes on a claim, not in
      // a comment above the number.
      const decl = src.slice(
        Math.max(0, src.indexOf('THIS IS A DATA-SUFFICIENCY CONVENTION')),
        src.indexOf('export const CALIBRATION_INTRO_WEEKS'),
      );
      if (/Research\/\d/.test(decl) || /Daniels Running Formula §/.test(decl)) {
        throw new Error(
          'a research citation has been attached to CALIBRATION_INTRO_WEEKS · its value is a ' +
            'convention and citing a doc for it launders one into the other',
        );
      }

      // 3 · The window is bounded. Read the value out of the source rather than
      // restating it, so this cannot agree with a stale copy.
      const weeks = Number(
        matchLiteral(src, /export const CALIBRATION_INTRO_WEEKS = (\d+);/, 'CALIBRATION_INTRO_WEEKS')[1],
      );
      if (weeks !== CALIBRATION_INTRO_WEEKS) {
        throw new Error(`the exported constant (${CALIBRATION_INTRO_WEEKS}) and its source (${weeks}) disagree`);
      }
      within(CALIBRATION_INTRO_WEEKS, [1, 4], 'calibration intro window, in weeks');

      // 4 · It can never cover a whole plan. `composePlan` excludes race week
      // from the intro, and the engine refuses a race-prep block under two
      // weeks — so the shortest plan it will ever build still contains one
      // paced week. Assert the exclusion is actually in the composer rather
      // than trusting the comment.
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/anchorIsProvisional && wi < CALIBRATION_INTRO_WEEKS && !isRaceWeek/.test(gen)) {
        throw new Error(
          'the calibration intro no longer excludes race week · a two-week plan could then be ' +
            'prescribed entirely by effort, including its tune-up',
        );
      }

      // 5 · Scope. Only the generic quality families lose their pace. Race day
      // and the race-week tune-up are priced off the runner's STATED GOAL, not
      // off the provisional fitness anchor, so neither carries the fabrication
      // — and both are already exempt from the evidence-time pace recompute for
      // the same reason.
      for (const t of ['threshold', 'intervals', 'tempo']) {
        if (!EFFORT_CUED_TYPES.has(t)) {
          throw new Error(`${t} left EFFORT_CUED_TYPES · the intro no longer covers the session that caused it`);
        }
      }
      for (const t of ['race', 'race_week_tuneup', 'easy', 'long', 'recovery']) {
        if (EFFORT_CUED_TYPES.has(t)) {
          throw new Error(
            `${t} entered EFFORT_CUED_TYPES · the intro withholds a pace we fabricated, and this ` +
              'session\'s pace is not one of them',
          );
        }
      }

      // 6 · The window must be ENDABLE. An intro nothing can close is not a
      // calibration, it is a permanent downgrade — which is precisely the
      // Justin bug the no-race self-heal was written for, re-created on the
      // race-prep path. The cron's re-anchor is that escape.
      const reanchor = sourceOf('web-v2/lib/plan/reanchor-plan.ts');
      if (!/export async function reanchorActivePlan/.test(reanchor)) {
        throw new Error('reanchorActivePlan is gone · nothing can end the calibration intro');
      }
      if (!/reanchorActivePlan/.test(sourceOf('web-v2/app/api/cron/snapshot-projections/route.ts'))) {
        throw new Error('the projection cron no longer calls the re-anchor · the intro cannot end');
      }

      // 7 · Both doctrine passages this claim leans on must still say what it
      // says they say. The field-test protocols are the grounding for the
      // shape; the lock-in rule is the tension being bounded, and if the doc
      // ever stops wanting hard work pace-locked, this claim's whole framing
      // needs re-reading by a human.
      const protocols = cite.text();
      if (!/time trial/i.test(protocols) || !/VDOT|T pace/.test(protocols)) {
        throw new Error(
          'Research/01 field-test protocols no longer describe deriving a pace anchor from a test',
        );
      }
      const lock = resolveCitation(
        'Research/01-pace-zones-vdot.md',
        '### When to lock to a specific pace vs. give a range',
      ).text();
      if (!/the harder the workout, the tighter the lock/i.test(lock)) {
        throw new Error(
          'Research/01 no longer states the lock-in rule · the calibration intro is a deviation ' +
            'from it and the deviation was scoped against that sentence',
        );
      }
      if (!/HR\/effort/i.test(lock)) {
        throw new Error(
          'Research/01 lock-in table no longer carries an effort-based prescription style · the ' +
            'intro\'s representation was chosen because doctrine already has one',
        );
      }
    },
  },

  // ══ LIMITER · what is actually preventing the goal ════════════════════════
  {
    id: 'LIMITER.curve-shape-neutral-band',
    binds: ['lib/coach/limiter.ts#CURVE_NEUTRAL_EXPONENT_BAND', 'lib/coach/limiter.ts#fitRiegelExponent'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '| Type | Diagnostic ratio | Riegel-equivalent exponent |',
    claim:
      'McMillan classifies runners from the SHAPE of their race-time curve, and that ' +
      'classification is a limiter diagnosis: a Speedster is short-biased and therefore ' +
      'endurance-limited, an Endurance monster is long-biased and therefore speed-limited, and ' +
      'the Combo band in between is the neutral zone where no shape limiter exists. The ' +
      "engine's neutral band must BE the Combo row's exponent band, read out of the doc, and " +
      'the two flanking rows must still sit on the sides the diagnosis assumes — a doc edit ' +
      'that swapped them would invert every diagnosis this module makes.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Riegel-equivalent exponent';
      const combo = parseBand(t.cell('Combo runner', col));
      const speedster = parseBand(t.cell('Speedster', col));
      const monster = parseBand(t.cell('Endurance monster', col));
      if (
        CURVE_NEUTRAL_EXPONENT_BAND[0] !== combo[0] ||
        CURVE_NEUTRAL_EXPONENT_BAND[1] !== combo[1]
      ) {
        throw new Error(
          `CURVE_NEUTRAL_EXPONENT_BAND is [${CURVE_NEUTRAL_EXPONENT_BAND}] · the Combo runner row ` +
            `in ${cite.doc} states ${combo[0]}-${combo[1]}`,
        );
      }
      // The Speedster sits ABOVE the neutral band and the Endurance monster
      // BELOW it. The whole diagnosis hangs on that orientation.
      if (speedster[0] < combo[1]) {
        throw new Error(
          `the Speedster row (${speedster}) no longer sits above the Combo band (${combo}) · ` +
            'a higher exponent must still mean short-biased, or the endurance diagnosis inverts',
        );
      }
      if (monster[1] > combo[0]) {
        throw new Error(
          `the Endurance monster row (${monster}) no longer sits below the Combo band (${combo}) · ` +
            'a lower exponent must still mean long-biased, or the speed diagnosis inverts',
        );
      }
      // And the fit itself is doctrine's, not an invention: a runner whose long
      // race is disproportionately slow must land above the band.
      const speedy = fitRiegelExponent(
        { distanceMi: 3.1, finishSeconds: 1200, ageDays: 0 },
        { distanceMi: 26.2, finishSeconds: 12600, ageDays: 0 },
      );
      if (speedy == null || speedy <= combo[1]) {
        throw new Error(`fitRiegelExponent does not put a 20:00 5K against a 3:30 marathon above the Combo band (got ${speedy})`);
      }
    },
  },
  {
    id: 'REPRESENTATIVENESS.altitude-table',
    binds: ['lib/race/representativeness.ts#ALTITUDE_SLOWDOWN_PCT'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '### Race performance loss by elevation (sea-level acclimatized)',
    claim:
      'Every altitude figure the engine prices a race with must sit inside the band doctrine ' +
      'states for that elevation, both for the athlete who travelled in and for the one who ' +
      'has been resident three weeks — and the acclimated cost must never exceed the acute one.',
    check({ cite }) {
      const t = cite.table();
      const bandFor = (cell: string): [number, number] | null => {
        if (!/\d/.test(cell)) return null;            // "Negligible"
        return parseBand(cell);
      };
      for (const row of ALTITUDE_SLOWDOWN_PCT) {
        const docRow = t.rows.find(
          (r) => Number((r[t.headers[0]] ?? '').replace(/,/g, '')) === row.ft,
        );
        if (!docRow) {
          throw new Error(`DOCTRINE · no ${row.ft} ft row in the altitude table in ${cite.doc}`);
        }
        const acute = bandFor(docRow['Endurance event slowdown']);
        const accl = bandFor(docRow['After 3 weeks acclimatization']);
        if (acute) within(row.acute, acute, `ALTITUDE_SLOWDOWN_PCT ${row.ft} ft acute`);
        else if (row.acute !== 0) {
          throw new Error(`doctrine calls ${row.ft} ft negligible · the engine charges ${row.acute}%`);
        }
        if (accl) {
          // A "<0.5%" cell states a ceiling, not a band.
          if (/^\s*<|^\s*&lt;/.test(docRow['After 3 weeks acclimatization'])) {
            atMost(row.acclimated, accl[1], `ALTITUDE_SLOWDOWN_PCT ${row.ft} ft acclimated`);
          } else {
            within(row.acclimated, accl, `ALTITUDE_SLOWDOWN_PCT ${row.ft} ft acclimated`);
          }
        }
        if (row.acclimated > row.acute) {
          throw new Error(
            `ALTITUDE_SLOWDOWN_PCT at ${row.ft} ft costs an acclimated athlete more than an ` +
              'unacclimatized one · doctrine says acclimatization helps',
          );
        }
      }
    },
  },
  {
    id: 'LIMITER.decoupling-names-the-endurance-gap',
    binds: ['lib/coach/limiter.ts#DECOUPLING_ENDURANCE_GAP_PCT'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| Decoupling % | Meaning |',
    claim:
      'Doctrine does not merely band Pa:HR decoupling, it says what each band MEANS, and one ' +
      'row names an endurance gap outright: "Endurance gap; build base before progressing". ' +
      'The threshold at which the engine routes a decoupling reading to the endurance limiter ' +
      'is the floor of that row — found by reading the Meaning column rather than by counting ' +
      'rows, so a reordered table cannot silently move the threshold.',
    check({ cite }) {
      const t = cite.table();
      const [pctCol, meaningCol] = t.headers;
      const row = t.rows.find((r) => /endurance gap/i.test(r[meaningCol] ?? ''));
      if (!row) {
        throw new Error('no decoupling band in this table names an endurance gap any more · re-read the claim');
      }
      const [lo] = parseBand(row[pctCol]);
      if (DECOUPLING_ENDURANCE_GAP_PCT !== lo) {
        throw new Error(
          `DECOUPLING_ENDURANCE_GAP_PCT is ${DECOUPLING_ENDURANCE_GAP_PCT} · the row doctrine calls ` +
            `an endurance gap starts at ${lo}%`,
        );
      }
      // The band below it must still read as acceptable · if doctrine ever
      // calls 5-8% a gap too, the engine is under-diagnosing.
      const below = t.rows.find((r) => /acceptable/i.test(r[meaningCol] ?? ''));
      if (!below) throw new Error('doctrine no longer marks a decoupling band as acceptable · the threshold needs re-deriving');
    },
  },
  {
    id: 'LIMITER.heat-artifact-filters-decoupling',
    binds: ['lib/coach/limiter.ts#DECOUPLING_HEAT_ARTIFACT_PCT'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '- Heat adds 2–5% artifactually — control conditions.',
    claim:
      'Doctrine states how much decoupling heat manufactures on its own. A hot-day reading ' +
      'that clears the endurance-gap threshold by less than that is a finding about the ' +
      'weather, not about the runner\'s aerobic base, so the engine adds the artifact to the ' +
      'threshold before letting a heat-confounded observation accuse anyone. The constant is ' +
      'the TOP of the stated artifact band, because a filter set at the bottom would still ' +
      'let the worst case through. This is the per-observation context filter CLAUDE.md ' +
      'requires: a diagnosis-level heat guard would not protect this sub-finding.',
    check({ cite }) {
      const [lo, hi] = parseBand(cite.section[0]);
      if (DECOUPLING_HEAT_ARTIFACT_PCT !== hi) {
        throw new Error(
          `DECOUPLING_HEAT_ARTIFACT_PCT is ${DECOUPLING_HEAT_ARTIFACT_PCT} · doctrine states heat adds ` +
            `${lo}-${hi}% and the filter must cover the worst case`,
        );
      }
      // A filter that does not actually widen the threshold is decoration.
      if (DECOUPLING_HEAT_ARTIFACT_PCT <= 0) {
        throw new Error('the heat artifact filter is zero · heat-confounded readings are being taken at face value');
      }
      if (!sourceOf('web-v2/lib/coach/limiter.ts').includes('DECOUPLING_ENDURANCE_GAP_PCT + DECOUPLING_HEAT_ARTIFACT_PCT')) {
        throw new Error('the heat artifact is declared but never added to the endurance threshold · the filter is inert');
      }
    },
  },
  {
    id: 'LIMITER.hard-day-gap-is-doctrine',
    binds: ['lib/coach/limiter.ts#HARD_DAY_GAP_DAYS'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Stimulus on day N | Minimum gap before next hard day |',
    claim:
      'Recovery capacity is diagnosed against the gap doctrine actually prescribes between a ' +
      'given stimulus and the next hard day, not against a number this module invented. Each ' +
      'stimulus the engine tracks reads its gap out of the matching doctrine row, and VO2max ' +
      'must still cost more recovery than a threshold session — that ordering is what makes ' +
      'the diagnosis mean anything.',
    check({ cite }) {
      const t = cite.table();
      const [stimCol, gapCol] = t.headers;
      const gapFor = (re: RegExp) => {
        const row = t.rows.find((r) => re.test(r[stimCol] ?? ''));
        if (!row) throw new Error(`no row matching ${re} in the hard/easy table · re-anchor the claim`);
        return parseBand(row[gapCol])[0];
      };
      const doc = {
        threshold: gapFor(/^threshold\/tempo/i),
        vo2max: gapFor(/^vo2max intervals/i),
        long_race_pace: gapFor(/^long run with marathon-pace/i),
      };
      for (const k of Object.keys(doc) as Array<keyof typeof doc>) {
        if (HARD_DAY_GAP_DAYS[k] !== doc[k]) {
          throw new Error(`HARD_DAY_GAP_DAYS.${k} is ${HARD_DAY_GAP_DAYS[k]} · doctrine prescribes ${doc[k]} day(s)`);
        }
      }
      if (doc.vo2max <= doc.threshold) {
        throw new Error('doctrine no longer costs VO2max more recovery than threshold · the recovery diagnosis needs re-deriving');
      }
    },
  },
  {
    id: 'LIMITER.incomplete-recovery-workout-count',
    binds: ['lib/coach/limiter.ts#INCOMPLETE_RECOVERY_WORKOUTS'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Signal | Threshold suggesting incomplete recovery | Notes |',
    claim:
      'Doctrine names one performance signal as the strongest single indicator of incomplete ' +
      'recovery — being unable to hit prescribed paces at the usual HR/RPE — and states how ' +
      'many workouts it takes to count. The engine requires exactly that many before naming ' +
      'recovery capacity as the limiter, so one bad Tuesday cannot reroute a training block.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Threshold suggesting incomplete recovery';
      const cell = t.cell('Performance', col);
      if (!/prescribed paces/i.test(cell)) {
        throw new Error(`the Performance row no longer describes missed prescribed paces: "${cell}"`);
      }
      const [lo] = parseBand(cell);
      if (INCOMPLETE_RECOVERY_WORKOUTS !== lo) {
        throw new Error(`INCOMPLETE_RECOVERY_WORKOUTS is ${INCOMPLETE_RECOVERY_WORKOUTS} · doctrine states ${lo}+ workouts`);
      }
      if (!/strongest single performance indicator/i.test(t.cell('Performance', 'Notes'))) {
        throw new Error(
          'doctrine no longer calls this the strongest single performance indicator · the weight ' +
            'the limiter gives it needs re-deriving',
        );
      }
    },
  },
  {
    id: 'LIMITER.goal-distance-default',
    binds: ['lib/coach/limiter.ts#DEFAULT_LIMITER'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '| Race distance | Phase | Best-fit TID | Rationale |',
    claim:
      'When the performance curve is flat and nothing else fires, the fallback limiter is the ' +
      'quality doctrine says dominates that event. The rationale column states it in words: ' +
      'the 5K/10K row names aerobic capacity, the half and the marathon both name LT2 ' +
      '(threshold), and the ultra is prescribed HVLIT, which is pure aerobic base. The ' +
      "engine's default map is checked against what those cells actually say, so a doctrine " +
      'edit moves the default rather than leaving it stranded. The two same-value pairs are ' +
      'doctrine\'s own groupings, not a paste: 5K and 10K share ONE row in this table, and ' +
      'the half and marathon rows give the same LT2 rationale.',
    check({ cite }) {
      const t = cite.table();
      const [distCol, , tidCol, whyCol] = t.headers;
      /** Every rationale + TID cell doctrine gives a distance, lower-cased. */
      const saysFor = (re: RegExp): string => {
        const rows = t.rows.filter((r) => re.test(r[distCol] ?? ''));
        if (rows.length === 0) throw new Error(`no ${re} row in the TID table · re-anchor the claim`);
        return rows.map((r) => `${r[tidCol]} ${r[whyCol]}`).join(' ').toLowerCase();
      };
      const short = saysFor(/5k\/10k/i);
      const half = saysFor(/^half-marathon/i);
      const full = saysFor(/^marathon/i);
      const ultra = saysFor(/^ultra/i);

      if (!/aerobic capacity/.test(short)) {
        throw new Error(`the 5K/10K rows no longer name aerobic capacity: "${short}"`);
      }
      if (!/lt2/.test(half) || !/lt2/.test(full)) {
        throw new Error('the half and marathon rows no longer name LT2 · the threshold default needs re-deriving');
      }
      if (!/hvlit/.test(ultra)) {
        throw new Error(`the ultra row no longer prescribes HVLIT: "${ultra}"`);
      }
      const expect: Record<DistCategory, Limiter> = {
        '5k': 'aerobic_capacity',
        '10k': 'aerobic_capacity',
        hm: 'threshold',
        m: 'threshold',
        ultra: 'endurance',
      };
      for (const cat of CATS) {
        if (DEFAULT_LIMITER[cat] !== expect[cat]) {
          throw new Error(`DEFAULT_LIMITER.${cat} is ${DEFAULT_LIMITER[cat]} · doctrine's rationale for this distance says ${expect[cat]}`);
        }
      }
      // The distinction that matters: the events doctrine says are LT2-dominated
      // must NOT default to the VO2max lever, and vice versa. That confusion is
      // the one this default exists to prevent.
      for (const cat of ['hm', 'm'] as const) {
        if (DEFAULT_LIMITER[cat] === 'aerobic_capacity') {
          throw new Error(`DEFAULT_LIMITER.${cat} reaches for VO2max where doctrine says LT2 dominates`);
        }
      }
    },
  },
  {
    id: 'LIMITER.levers-progress-before-pace',
    binds: ['lib/coach/limiter.ts#LEVERS'],
    doc: 'Design/adaptive-progression-engine.md',
    anchor: '| limiter | progress |',
    claim:
      'The whole point of a limiter is that it selects a lever OTHER than pace — §11 ends ' +
      '"Do not simply make every workout faster", and §2 says progression is not pace ' +
      'progression. Every limiter the engine can name must therefore carry a lever list whose ' +
      'FIRST entry is not a pace change, and the four limiters §11 tabulates must progress in ' +
      'the order §11 gives them. The three §11 leaves unfilled (aerobic capacity, durability, ' +
      'recovery capacity) are held to the same shape.',
    check({ cite }) {
      const t = cite.table();
      const [limiterCol, progressCol] = t.headers;
      const docRow = (name: string): string => {
        const row = t.rows.find((r) => (r[limiterCol] ?? '').toLowerCase() === name);
        if (!row) throw new Error(`§11 no longer tabulates "${name}" · re-anchor the claim`);
        return (row[progressCol] ?? '').toLowerCase();
      };
      // Doctrine's own four rows · the engine's lever order must follow them.
      const tabulated: Array<[Limiter, string, string[]]> = [
        ['endurance', 'endurance', ['long-run', 'aerobic volume', 'threshold blocks', 'durability']],
        ['speed_reserve', 'speed reserve', ['strides', 'intervals', 'vo2']],
        ['training_volume', 'training capacity', ['frequency', 'easy volume', 'long-run consistency']],
      ];
      for (const [limiter, docName, ordered] of tabulated) {
        const says = docRow(docName);
        for (const term of ordered) {
          if (!says.includes(term)) {
            throw new Error(`§11's "${docName}" row no longer names "${term}": "${says}"`);
          }
        }
        // The engine's list must mention each, in the order doctrine lists them.
        const engine = LEVERS[limiter].join(' | ').toLowerCase();
        let at = -1;
        for (const term of ordered) {
          const next = engine.indexOf(term.split(' ')[0]);
          if (next < 0) throw new Error(`LEVERS.${limiter} never mentions "${term}" · §11 lists it`);
          if (next < at) throw new Error(`LEVERS.${limiter} reorders §11's progression · "${term}" comes too early`);
          at = next;
        }
      }
      // The threshold row is the shape claim in miniature: duration, then
      // density, then pace — and pace LAST is the part that must not rot.
      const thr = docRow('threshold');
      const order = ['duration', 'density', 'pace'].map((w) => thr.indexOf(w));
      if (order.some((i) => i < 0) || order[0] > order[1] || order[1] > order[2]) {
        throw new Error(`§11's threshold row no longer progresses duration then density then pace: "${thr}"`);
      }
      const engineThr = LEVERS.threshold.map((l) => l.toLowerCase());
      if (!/duration/.test(engineThr[0]) || !/pace/.test(engineThr[engineThr.length - 1])) {
        throw new Error('LEVERS.threshold must start at duration and end at pace · that is the §11 progression');
      }
      // No limiter may open with a pace change. This is the defect the module
      // exists to fix: every prescription reaching for pace because it had no
      // basis for choosing another lever.
      for (const [limiter, levers] of Object.entries(LEVERS) as Array<[Limiter, string[]]>) {
        if (levers.length === 0) throw new Error(`LEVERS.${limiter} is empty · a limiter with no lever prescribes nothing`);
        if (/^[^·]*\bpace\b/.test(levers[0].toLowerCase())) {
          throw new Error(`LEVERS.${limiter} opens with a pace change · §11 says do not simply make every workout faster`);
        }
      }
    },
  },
  {
    id: 'REPRESENTATIVENESS.wind-table',
    binds: ['lib/race/representativeness.ts#HEADWIND_COST_S_PER_MI'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '### Headwind / tailwind seconds-per-mile (flat, dry, head-on/dead-aft)',
    claim:
      "The headwind cost the engine charges a race is doctrine's own table, at both pace " +
      'anchors it publishes, cell for cell. It is a straight transcription, so the gate ' +
      'checks it as one rather than as a band.',
    check({ cite }) {
      const t = cite.table();
      for (const row of HEADWIND_COST_S_PER_MI) {
        const docRow = t.rows.find((r) => parseBand(r[t.headers[0]])[0] === row.mph);
        if (!docRow) {
          throw new Error(`DOCTRINE · no ${row.mph} mph row in the wind table in ${cite.doc}`);
        }
        const at6 = parseBand(docRow['Headwind cost (6:00 pace)'])[0];
        const at8 = parseBand(docRow['Headwind cost (8:00 pace)'])[0];
        if (row.at6 !== at6 || row.at8 !== at8) {
          throw new Error(
            `HEADWIND_COST_S_PER_MI at ${row.mph} mph is (${row.at6}, ${row.at8}) s/mi · ` +
              `doctrine says (${at6}, ${at8})`,
          );
        }
        // A headwind always costs a slower runner more · they are in it longer.
        if (row.at8 < row.at6) {
          throw new Error(`HEADWIND_COST_S_PER_MI at ${row.mph} mph costs a 6:00 runner more than an 8:00 one`);
        }
      }
    },
  },
  {
    id: 'REPRESENTATIVENESS.tailwind-table',
    binds: ['lib/race/representativeness.ts#TAILWIND_BENEFIT_S_PER_MI'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '### Headwind / tailwind seconds-per-mile (flat, dry, head-on/dead-aft)',
    claim:
      'The help a tailwind gives a race is read out of the SAME doctrine table as the headwind ' +
      'cost, from its own two published columns, cell for cell. It is never derived by ' +
      'inverting or halving the headwind figure: the doc states the asymmetry in words ("a ' +
      'headwind costs roughly 2x what an equal tailwind gives back") and then prints the ' +
      'numbers, so a derived figure would be the engine agreeing with itself instead of with ' +
      'the research.',
    check({ cite }) {
      const t = cite.table();
      for (const row of TAILWIND_BENEFIT_S_PER_MI) {
        const docRow = t.rows.find((r) => parseBand(r[t.headers[0]])[0] === row.mph);
        if (!docRow) {
          throw new Error(`DOCTRINE · no ${row.mph} mph row in the wind table in ${cite.doc}`);
        }
        // Doctrine prints the benefit as a negative change to finish time; the
        // engine stores magnitudes.
        const at6 = Math.abs(parseBand(docRow['Tailwind benefit (6:00)'])[0]);
        const at8 = Math.abs(parseBand(docRow['Tailwind benefit (8:00)'])[0]);
        if (row.at6 !== at6 || row.at8 !== at8) {
          throw new Error(
            `TAILWIND_BENEFIT_S_PER_MI at ${row.mph} mph is (${row.at6}, ${row.at8}) s/mi · ` +
              `doctrine says (${at6}, ${at8})`,
          );
        }
        // A slower runner is in the wind longer, so the benefit rises with pace.
        if (row.at8 < row.at6) {
          throw new Error(`TAILWIND_BENEFIT_S_PER_MI at ${row.mph} mph helps a 6:00 runner more than an 8:00 one`);
        }
        // And the doctrine-stated asymmetry must survive · a tailwind never
        // gives back as much as the same headwind takes.
        const head = HEADWIND_COST_S_PER_MI.find((h) => h.mph === row.mph);
        if (!head) throw new Error(`no headwind row at ${row.mph} mph to check the asymmetry against`);
        if (row.at6 >= head.at6 || row.at8 >= head.at8) {
          throw new Error(
            `the wind asymmetry is gone at ${row.mph} mph · doctrine says a headwind costs ` +
              'roughly 2x what an equal tailwind returns',
          );
        }
      }
    },
  },

  /* ── The second RULE claim (see EVIDENCE.race-supersedes-earlier-leads) ──
   *
   * This one locks a SYMMETRY rather than a number, because the defect it
   * closes was an absence: every context filter in the engine had been added
   * to the exact branch where a bug was observed and never to its mirror.
   * `assessRaceRepresentativeness` is 900+ lines of gating with one caller —
   * the DOWNWARD re-anchor. The upward one, which auto-rewrites every future
   * pace target, had no gate at all.
   *
   * A claim that only checked constants could not have seen that. What is
   * wrong is the shape of the call graph, so that is what this checks.
   */
  {
    id: 'REPRESENTATIVENESS.both-directions-are-diagnosed',
    binds: [
      'lib/race/representativeness.ts#assessRepresentativeness',
      'lib/plan/adapt.ts#detectPrBank',
    ],
    doc: 'Research/02-race-time-prediction.md',
    anchor: 'downhills do not symmetrically refund the cost',
    claim:
      'A race that was AIDED is no more a fitness reading than a race that was sabotaged, so ' +
      'the upward re-anchor is gated by the same four steps as the downward one: assess, ' +
      'scale by earned authority, refuse below the unrepresentative floor, re-check the firing ' +
      'predicate against the SCALED value. Doctrine supplies the aid side directly — its ' +
      'course table is keyed on NET elevation and it states that a descent is a partial refund ' +
      'rather than no refund. The two limbs price different factors because most are not ' +
      'sign-symmetric, and the effort class is charged downward only: an athlete who ran a ' +
      'personal best off a training week demonstrated it, and believing a good result LESS the ' +
      'harder the circumstances were would invert the evidence.',
    check({ cite }) {
      // Doctrine still says a descent is a partial refund, not a full one.
      if (!/downhill/i.test(cite.text())) {
        throw new Error(`Research/02 §13.2 no longer discusses downhills · re-anchor the claim`);
      }
      if (!(DESCENT_RECOVERY_FRACTION > 0 && DESCENT_RECOVERY_FRACTION < 1)) {
        throw new Error(
          `DESCENT_RECOVERY_FRACTION is ${DESCENT_RECOVERY_FRACTION} · doctrine says a descent ` +
            'refunds SOME of the climb, neither none of it nor all of it',
        );
      }

      // A marathon well inside the anchor's prediction · the pr_bank shape.
      const base = { distanceMi: 26.22, finishS: 11400, anchorVdot: 44, raceVdot: 48 } as const;
      const flat = assessRepresentativeness({ ...base, direction: 'upward' });
      if (flat.authority !== 1 || flat.detractors.length > 0) {
        throw new Error('a clean upward read is being discounted · the aid limb is charging a flat course');
      }

      // The same race down a course that drops a thousand feet.
      const downhill = assessRepresentativeness({
        ...base,
        direction: 'upward',
        course: { elevationGainFt: 0, netElevationFt: -1000 },
      });
      if (!downhill.detractors.some((d) => d.factor === 'net_downhill')) {
        throw new Error(
          'a net-downhill course is not priced on the upward limb · the rule-8 gate is ' +
            'decorative on the branch that prescribes work the runner cannot absorb',
        );
      }
      if (!(downhill.authority < flat.authority)) {
        throw new Error('a net-downhill course cost no authority · the aid pricing is inert');
      }

      // Effort class · charged downward, never upward.
      const slowC = assessRepresentativeness({
        distanceMi: 26.22, finishS: 13000, anchorVdot: 48, raceVdot: 44,
        direction: 'downward', state: { priority: 'C' },
      });
      if (slowC.authority >= 1) {
        throw new Error('a C race is no longer discounted on the downward limb · Research/00b grades it a hard workout');
      }
      const fastC = assessRepresentativeness({ ...base, direction: 'upward', state: { priority: 'C' } });
      if (fastC.authority !== 1) {
        throw new Error(
          'the effort class is being charged on the upward limb · a personal best run without a ' +
            'taper is more evidence of fitness, not less',
        );
      }

      // And the gate must be WIRED, not merely available. Both halves: the
      // scaling call, and the re-check of the predicate against the scaled value.
      const src = sourceOf('web-v2/lib/plan/adapt.ts');
      const prBank = src.slice(src.indexOf('async function detectPrBank'));
      const body = prBank.slice(0, prBank.indexOf('\n * FIELD_TEST_DUE'));
      for (const [needle, what] of [
        ['assessRaceRepresentativeness', 'the representativeness assessment'],
        ['authorityScaledVdot', 'the authority scaling'],
        ["direction: 'upward'", 'the upward direction'],
      ] as const) {
        if (!body.includes(needle)) {
          throw new Error(`detectPrBank no longer calls ${what} · the upward re-anchor is ungated again`);
        }
      }
      // 2026-08-28 · the threshold literal became the shared named constant
      // (lib/training/pace-anchor.ts · RACE_EVIDENCE_REANCHOR_DELTA, one
      // pace-anchor authority for the adapter and the 07:30 self-heal). The
      // gate's property is unchanged: the predicate must re-test the SCALED
      // value, at the race-evidence threshold — whose VALUE is asserted by
      // REGRESSION_DELTA_THRESHOLD's own claims (it equals the same constant).
      if (!/const delta = scaledVdot - oldVdot;\s*\n\s*if \(delta <= RACE_EVIDENCE_REANCHOR_DELTA\) return null;/.test(body)) {
        throw new Error(
          'detectPrBank no longer re-checks its firing threshold against the SCALED VDOT · ' +
            'scaling a value and then testing the raw one is a gate that cannot bite',
        );
      }
    },
  },

  {
    id: 'EVIDENCE.chip-time-is-canonical',
    binds: [
      'lib/race/auto-result.ts#provisionalResultPatch',
      'lib/race/representativeness.ts#assessRepresentativeness',
    ],
    doc: 'Research/15-wearable-data.md',
    anchor: 'the official chip time over the certified course is canonical',
    claim:
      'An unconfirmed watch time may stand in for a race result, but it is not the canonical ' +
      'measurement doctrine names, so it cannot AUTO-APPLY an upward fitness re-anchor. Two ' +
      'consequences. The patch reads ELAPSED time first — a race is timed gun-to-mat, and ' +
      'moving time subtracts every auto-pause and aid-station stop, so it reads systematically ' +
      'faster than the chip time it stands in for. And an unconfirmed result is a premise ' +
      'failure on the upward limb, zeroed rather than discounted because no percentage ' +
      'expresses "this might be the wrong run". The same flag is inert on the DOWNWARD limb on ' +
      'purpose: both residual errors bias the reading faster, so a provisional row that still ' +
      'reads slow is understating the drop and acting on it is the conservative move.',
    check({ cite }) {
      if (!/chip time/i.test(cite.text())) {
        throw new Error('Research/15 no longer names the chip time as canonical · re-anchor the claim');
      }
      // ELAPSED beats moving · the direction of the fix, not just its presence.
      const run = (data: Record<string, unknown>) => ({ id: 'r1', data });
      const patch = provisionalResultPatch(run({ elapsedTimeS: 6200, movingTimeS: 6100, movingSec: 6050 }));
      if (patch?.finishS !== 6200) {
        throw new Error(
          `provisionalResultPatch took ${patch?.finishS}s from a run with 6200s elapsed and ` +
            '6100s moving · a race result is elapsed time, and moving time errs fast',
        );
      }
      // Moving time still stands in when there is no elapsed field at all.
      if (provisionalResultPatch(run({ movingTimeS: 6100 }))?.finishS !== 6100) {
        throw new Error('a run carrying only a moving time no longer produces a provisional result');
      }
      if (patch?.provisional !== true) {
        throw new Error('the provisional flag is no longer written · every downstream gate reads it');
      }

      // Upward · premise gate, and it must be REPORTED rather than a silent zero.
      const base = { distanceMi: 13.1, finishS: 5400, anchorVdot: 44, raceVdot: 48 } as const;
      const unconfirmed = assessRepresentativeness({
        ...base, direction: 'upward', state: { resultProvisional: true },
      });
      if (unconfirmed.authority !== 0) {
        throw new Error(
          `an unconfirmed watch time carries ${unconfirmed.authority} authority upward · ` +
            'doctrine says the chip time is the canonical one',
        );
      }
      if (!unconfirmed.detractors.some((d) => d.factor === 'unconfirmed_result')) {
        throw new Error('the unconfirmed-result gate zeroed the read without saying why');
      }
      if (assessRepresentativeness({ ...base, direction: 'upward' }).authority !== 1) {
        throw new Error('a CONFIRMED result is being gated as if it were provisional');
      }

      // Downward · deliberately inert, and this asymmetry is the claim, so it
      // is checked rather than assumed.
      const slow = { distanceMi: 13.1, finishS: 6600, anchorVdot: 48, raceVdot: 44 } as const;
      const slowConfirmed = assessRepresentativeness({ ...slow, direction: 'downward' });
      const slowProvisional = assessRepresentativeness({
        ...slow, direction: 'downward', state: { resultProvisional: true },
      });
      if (slowProvisional.authority !== slowConfirmed.authority) {
        throw new Error(
          'the provisional gate is firing on the downward limb · a watch time errs FAST, so a ' +
            'provisional row reading slow understates the drop and must still be actionable',
        );
      }
    },
  },

  {
    id: 'LIMITER.volume-floor-is-the-plan-target',
    binds: ['lib/coach/limiter.ts#diagnoseLimiter', 'lib/plan/goal-tiers.ts#TIER_TARGETS'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume table',
    claim:
      'Training volume is diagnosed as a limiter against the SAME band the plan is built to — ' +
      'TIER_TARGETS.peakWeeklyMileageBand — rather than a mileage number of the limiter ' +
      "module's own. Two disagreeing numbers for one doctrinal quantum is the shape that had " +
      'the validator rejecting plans the generator was correctly authoring, and it would here ' +
      'produce a limiter that fires against a bar no plan ever aims at.',
    check({ cite }) {
      // The doctrine table still spans a real volume range · the band the
      // limiter reads is checked against it by VOLUME.tier-peak-bands.
      const t = cite.table();
      if (t.rows.length === 0) throw new Error('the volume table is empty · re-anchor the claim');
      const src = sourceOf('web-v2/lib/coach/limiter.ts');
      if (!/TIER_TARGETS\[cat\]\[tier\]\.peakWeeklyMileageBand/.test(src)) {
        throw new Error('limiter.ts no longer reads the tier volume band · it is diagnosing against its own number');
      }
      // And it must not have grown a mileage constant of its own.
      if (/const\s+\w*(?:MILEAGE|MPW|WEEKLY_MI)\w*\s*(?::[^=]+)?=\s*\d/i.test(src)) {
        throw new Error('limiter.ts declares its own weekly-mileage constant · read TIER_TARGETS instead');
      }
    },
  },

  // ══ THE BOOK-CITATION SWEEP (2026-08-17) ══════════════════════════════════
  //
  // Eight claims seeded by working through the 25 citations that named a BOOK
  // rather than a `Research/` file. A book citation is invisible to this
  // registry — the gate only ever opens files — which is how a fabricated
  // Daniels table set every new runner's paces for two months
  // (CONVENTION.cold-start-mileage-anchor). The inventory in
  // `_doctrine_lint.test.ts` is now empty; these are what replaced it.

  {
    id: 'PLANMODE.build-window-fits-doctrine-plan',
    binds: ['lib/plan/goal-tiers.ts#BUILD_WINDOW_WEEKS'],
    doc: 'Research/22-plan-templates.md',
    anchor: '### Marathon — Intermediate',
    claim:
      'The build window is how many weeks before a race the engine switches out of ' +
      'maintenance and starts race-prep, so it is the space a plan has to be built in. ' +
      'Research/22 publishes a Duration for every distance × tier plan, and the window must ' +
      'be at least long enough to fit the SHORTEST published plan for that distance — ' +
      'otherwise race-prep opens too late to build the plan doctrine describes — and no ' +
      'longer than the LONGEST, or the engine is holding a runner in race-specific work past ' +
      'the point any published plan does. Both ends are read out of the doc.',
    check() {
      // The claim's own anchor is the marathon row because it is the exact hit:
      // BUILD_WINDOW_WEEKS.m is 18 and every marathon plan in Research/22 is 18
      // weeks. The other distances are resolved the same way, from their own
      // headings — the durations are never restated here.
      //
      // DOCTRINE-HMWIN-1 (2026-08-17) · the `ceiling-hm` exemption is gone. It
      // recorded the half's window sitting at 14 against three published
      // 12-week plans, reported rather than moved. Ruled on: the window is 12
      // and every distance now clears both ends of its own published band.
      const PLAN_HEADINGS: Record<DistCategory, string[]> = {
        '5k': ['### 5K — Beginner', '### 5K — Intermediate', '### 5K — Advanced'],
        '10k': ['### 10K — Beginner', '### 10K — Intermediate', '### 10K — Advanced'],
        hm: [
          '### Half Marathon — Beginner',
          '### Half Marathon — Intermediate',
          '### Half Marathon — Advanced',
        ],
        m: ['### Marathon — Beginner', '### Marathon — Intermediate', '### Marathon — Advanced'],
        ultra: ['### 50K Ultra', '### 50 Mile', '### 100K', '### 100 Mile'],
      };
      for (const cat of CATS) {
        const bands = PLAN_HEADINGS[cat].map((h) =>
          parseBand(
            resolveCitation('Research/22-plan-templates.md', h).table().cell('Duration', 'Value'),
          ),
        );
        const shortest = Math.min(...bands.map((b) => b[0]));
        const longest = Math.max(...bands.map((b) => b[1]));
        const wks = BUILD_WINDOW_WEEKS[cat];
        if (wks < shortest) {
          throw new Error(
            `BUILD_WINDOW_WEEKS.${cat} = ${wks} wk opens race-prep too late to build the ` +
              `shortest published ${cat} plan (${shortest} wk)`,
          );
        }
        atMost(wks, longest, `BUILD_WINDOW_WEEKS.${cat}`);
      }
    },
  },

  /* ── COLD-START-1 (2026-08-19) ────────────────────────────────────────────
   *
   * `composeMaintenancePlan` sizes a week off the runner's recent peak. For a
   * runner with no recorded running that anchor is zero, and the arithmetic
   * produced one four-mile run a week — which for somebody with no history is
   * also a first session four miles long. Doctrine has a section written for
   * exactly this runner and it is not the maintenance plan.
   */
  {
    id: 'COLDSTART.couch-to-5k-opening',
    binds: [
      'lib/plan/generate.ts#COLD_START_DAYS_PER_WEEK',
      'lib/plan/generate.ts#COLD_START_WEEK1_RUN_MIN',
      'lib/plan/generate.ts#COLD_START_PEAK_RUN_MIN',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 8. Couch-to-5K Progression',
    claim:
      'A runner with no recorded running is doctrine\'s sedentary starter, and §8 states their ' +
      'opening week outright: three days a week with a rest day between, a first session of ' +
      'eight one-minute runs, and a peak workout of a thirty-minute continuous run. The engine ' +
      'must open a no-history plan on those three numbers and on no other — in particular it may ' +
      'not assert a long run, because a long-run coherence floor is precisely what turned a ' +
      'zero anchor into a four-mile first session.',
    check({ cite }) {
      const text = cite.text();
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const cell = (label: string): string => {
        const line = text.split('\n').find((l) => l.includes(`| ${label} |`));
        if (!line) throw new Error(`DOCTRINE · no "${label}" row under Research/22 §8`);
        return line.split('|')[2].trim();
      };
      // "Days/week | 3 (with rest day between)"
      const docDays = parseBand(cell('Days/week'))[0];
      // "Peak workout | 30 min continuous run"
      const docPeakMin = parseBand(cell('Peak workout'))[0];
      // The week-1 row of the run/walk table: "8× (60 sec run / 90 sec walk)".
      const wk1 = text.split('\n').find((l) => /^\|\s*1\s*\|/.test(l));
      if (!wk1) throw new Error('DOCTRINE · Research/22 §8 has no week-1 run/walk row');
      const reps = wk1.match(/(\d+)\s*×\s*\(\s*(\d+)\s*sec run/);
      if (!reps) {
        throw new Error(`DOCTRINE · could not read week 1's run intervals out of "${wk1.trim()}"`);
      }
      const docWeek1Min = (Number(reps[1]) * Number(reps[2])) / 60;

      const lit = (name: string): number =>
        Number(matchLiteral(src, new RegExp(`const ${name} = (\\d+);`), name)[1]);
      const days = lit('COLD_START_DAYS_PER_WEEK');
      const week1 = lit('COLD_START_WEEK1_RUN_MIN');
      const peak = lit('COLD_START_PEAK_RUN_MIN');
      if (days !== docDays) {
        throw new Error(`COLD_START_DAYS_PER_WEEK is ${days} · Research/22 §8 says ${docDays}`);
      }
      if (week1 !== docWeek1Min) {
        throw new Error(
          `COLD_START_WEEK1_RUN_MIN is ${week1} min · Research/22 §8 week 1 is ` +
            `${reps[1]}×${reps[2]} sec = ${docWeek1Min} min of running`,
        );
      }
      if (peak !== docPeakMin) {
        throw new Error(`COLD_START_PEAK_RUN_MIN is ${peak} · Research/22 §8 says ${docPeakMin}`);
      }
      // And the no-history week must not reach for a long run. `coldStartWeek`
      // is the whole branch; if it ever authors `isLong: true` the four-mile
      // first session is back in a new costume.
      const fn = src.slice(src.indexOf('function coldStartWeek'));
      const body = fn.slice(0, fn.indexOf('\n  }\n'));
      if (/isLong:\s*true/.test(body)) {
        throw new Error('coldStartWeek authors a long run · a day-one runner has no long to floor');
      }
    },
  },

  {
    id: 'MAINTENANCE.minimum-effective-volume',
    binds: ['lib/plan/goal-tiers.ts#MAINTENANCE_BY_TIER'],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 7. Maintenance Plan',
    claim:
      'Maintenance holds fitness rather than building it, and doctrine states the floor ' +
      'outright: roughly two-thirds of training volume maintains VO2max for about 15 weeks ' +
      'provided intensity is preserved. Every tier\'s weeklyPctOfPeak must sit at or above ' +
      'that minimum effective dose (below it the block is quietly detraining the runner) and ' +
      'strictly below 1.0 (at or above it, this is not maintenance — it is another build). ' +
      'The fraction is parsed from the doc\'s own sentence and from its "Peak weekly volume" row.',
    check({ cite }) {
      const text = cite.text();
      // "~2/3 of training volume maintains VO2max for ~15 weeks…" — read the
      // fraction out of the prose rather than restating 0.66 here.
      const frac = text.match(/(\d+)\s*\/\s*(\d+)\s+of training volume maintains/);
      if (!frac) {
        throw new Error(
          'the minimum-effective-dose sentence is gone from Research/22 §"Maintenance Plan" · ' +
            're-read the section and re-anchor this claim',
        );
      }
      const minEffective = Number(frac[1]) / Number(frac[2]);
      // The table states the same quantity a second way ("~65% of last cycle's peak").
      const rowPct = parseBand(cite.table().cell('Peak weekly volume', 'Value'))[0] / 100;
      const floor = Math.min(minEffective, rowPct);
      for (const tier of TIERS) {
        const pct = MAINTENANCE_BY_TIER[tier].weeklyPctOfPeak;
        if (pct < floor) {
          throw new Error(
            `MAINTENANCE_BY_TIER.${tier}.weeklyPctOfPeak = ${pct} is under doctrine's ` +
              `minimum effective dose (${floor.toFixed(3)}) · this block detrains`,
          );
        }
        atMost(pct, 0.99, `MAINTENANCE_BY_TIER.${tier}.weeklyPctOfPeak`);
      }
      // DOCTRINE-MAINTFREQ-1 (2026-08-17) · the frequency half of this check,
      // and the `frequency-holds` exemption that carried it, have MOVED to
      // MAINTENANCE.frequency-is-base-building. §7 owns the VOLUME floor and
      // this claim keeps it; §6 owns frequency. See that claim for the ruling.
    },
  },

  {
    id: 'MAINTENANCE.frequency-is-base-building',
    binds: ['lib/plan/goal-tiers.ts#MAINTENANCE_BY_TIER'],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 6. Base Building / Off-Season Plan',
    claim:
      'This mode fires when a runner HAS a goal race and it is simply not near yet. That ' +
      'runner is base-building, not maintaining, so §6 Base Building / Off-Season governs ' +
      'their run frequency rather than §7 Maintenance — frequency is the first quality lost ' +
      'and the slowest to rebuild, and §7\'s 3-4 days would spend it to hold a volume number ' +
      '§7 itself only asks for when the runner is between goals entirely. Every tier must ' +
      'therefore sit at or above §6\'s frequency floor. The ceiling is §6\'s too, with one ' +
      'stated exception read out of the doc rather than waved through: the elite tier holds ' +
      'seven days, which §6 does not reach and §10 High-Volume publishes for exactly the ' +
      'runner that tier describes.',
    check({ cite }) {
      // §6 → "Days/week | 5-6".
      const baseDays = parseBand(cite.table().cell('Days/week', 'Value'));
      // §10 → "Days/week | 7 (doubles 3-5 days/wk at peak)", for "experienced
      // runners targeting peak performance". Read, never restated.
      const highVolumeDays = parseBand(
        resolveCitation(
          'Research/22-plan-templates.md',
          '## 10. High-Volume Plan (6-7 day, doubles)',
        ).table().cell('Days/week', 'Value'),
      );
      for (const tier of TIERS) {
        const days = MAINTENANCE_BY_TIER[tier].daysPerWeek;
        if (days < baseDays[0]) {
          throw new Error(
            `MAINTENANCE_BY_TIER.${tier}.daysPerWeek = ${days} is under Research/22 §6's ` +
              `base-building floor (${baseDays[0]}) · this block is spending the quality that ` +
              'takes longest to rebuild',
          );
        }
        // The elite tier is the only one §6 alone does not cover. It is bounded
        // by §10 instead, and by nothing wider — a tier drifting past the
        // highest frequency Research/22 publishes anywhere still fails here.
        const ceiling = tier === 'elite' ? Math.max(baseDays[1], highVolumeDays[1]) : baseDays[1];
        atMost(days, ceiling, `MAINTENANCE_BY_TIER.${tier}.daysPerWeek`);
      }
    },
  },

  /* ── MAINT-NOBLOCK-1 (2026-08-19) · the other half of DOCTRINE-MAINTFREQ-1 ─
   *
   * That ruling decided §6 Base Building governs this mode rather than §7
   * Maintenance, and re-pointed FREQUENCY to §6 while leaving VOLUME on §7.
   * The half that was left behind is what authored a day-one runner reporting
   * 20-25 mi/wk a 10 mi/wk block with four rest days: §7's fraction is a
   * fraction OF "last cycle's peak", and a runner on their first day in the app
   * has no last cycle. The number being cut by 30% was their current volume.
   */
  {
    id: 'MAINTENANCE.no-last-cycle-holds-durable-volume',
    binds: ['lib/plan/generate.ts#BASE_BUILD_SUSTAINABLE_PCT'],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 6. Base Building / Off-Season Plan',
    claim:
      'A runner with no completed block behind them has no "last cycle\'s peak" for §7\'s ' +
      'fraction to be a fraction of. §6 names the substitute in its own Peak weekly volume ' +
      'row — "or whatever level the runner can sustain durably" — so the anchor becomes the ' +
      'volume the runner actually sustains and the block holds it. The engine\'s ' +
      'BASE_BUILD_SUSTAINABLE_PCT must sit inside §6\'s published band, and must be strictly ' +
      'above every §7 maintenance fraction: cutting a runner who was never at a peak is the ' +
      'defect this binds against, and anything past the top of §6\'s band would be a ramp ' +
      'this mode is not allowed to author.',
    check({ cite }) {
      const cell = cite.table().cell('Peak weekly volume', 'Value');
      if (!/sustain durably/i.test(cell)) {
        throw new Error(
          'Research/22 §6 no longer offers "whatever level the runner can sustain durably" as ' +
            'the anchor for a runner with no last cycle · re-read §6 and re-derive this claim',
        );
      }
      // "80-100% of last cycle's peak (or whatever level the runner can sustain durably)"
      const band = parseBand(cell);
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const pct = Number(
        matchLiteral(
          src,
          /const BASE_BUILD_SUSTAINABLE_PCT = (\d*\.?\d+);/,
          'BASE_BUILD_SUSTAINABLE_PCT',
        )[1],
      );
      if (pct * 100 < band[0]) {
        throw new Error(
          `BASE_BUILD_SUSTAINABLE_PCT = ${pct} is under Research/22 §6's base-building floor ` +
            `(${band[0]}%)`,
        );
      }
      atMost(pct * 100, band[1], 'BASE_BUILD_SUSTAINABLE_PCT');
      const maintCeiling = Math.max(...TIERS.map((t) => MAINTENANCE_BY_TIER[t].weeklyPctOfPeak));
      if (!(pct > maintCeiling)) {
        throw new Error(
          `BASE_BUILD_SUSTAINABLE_PCT = ${pct} does not exceed the highest §7 maintenance ` +
            `fraction (${maintCeiling}) · a runner with no completed block is still being cut ` +
            'toward a peak they never had',
        );
      }
      // And the composer must still be able to TELL the two runners apart. The
      // discriminator is the measured peak, not the max that erases it.
      if (!/const hasCompletedBlockPeak = /.test(src)) {
        throw new Error(
          'composeMaintenancePlan no longer distinguishes a completed block from a day-one ' +
            'runner · every runner is back on one fraction',
        );
      }
    },
  },

  /* ── ZEROSAY-1 (2026-08-19) · the ladder that made §8 unreachable ──────────
   *
   * COLDSTART.couch-to-5k-opening below asserts the engine opens a no-history
   * plan on §8's three numbers, and it passed — while no runner could reach it.
   * The onboarding deck's lowest history answers resolved to 3 mi/wk and a 2 mi
   * longest run, so `noVolumeSignal` was false for a runner who had never run,
   * and they were handed the ordinary maintenance arithmetic instead: one
   * two-mile run a week. A green engine test over an unreachable branch is the
   * gap this claim closes.
   */
  {
    id: 'COLDSTART.reachable-from-onboarding',
    binds: [
      'lib/onboarding/state.ts#HIST_AVG_MIDPOINTS',
      'lib/onboarding/state.ts#HIST_LONG_MIDPOINTS',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 8. Couch-to-5K Progression',
    claim:
      '§8 is written for "sedentary individuals", and the engine reaches it only through ' +
      'noVolumeSignal, which requires BOTH reported history numbers to be zero. The front ' +
      'door therefore has to be able to say zero on both history ladders — a range whose ' +
      'lowest rung resolves to a non-zero midpoint cannot describe a runner who does not run, ' +
      'and asserting three miles a week on their behalf is the same fabrication as any other. ' +
      'Both midpoint tables must carry a genuine zero, both onboarding decks must offer it, ' +
      'and the trigger must keep reading both numbers.',
    check({ cite }) {
      if (!/sedentary/i.test(cite.text())) {
        throw new Error(
          'Research/22 §8 no longer describes the sedentary starter · re-read it before ' +
            'deciding what the deck\'s bottom rung means',
        );
      }
      const zero = (table: Record<string, number>, name: string) => {
        const min = Math.min(...Object.values(table));
        if (min !== 0) {
          throw new Error(
            `${name}'s lowest value is ${min}, not 0 · a runner who has never run cannot say ` +
              'so, and Research/22 §8 is unreachable from onboarding',
          );
        }
      };
      zero(HIST_AVG_MIDPOINTS, 'HIST_AVG_MIDPOINTS');
      zero(HIST_LONG_MIDPOINTS, 'HIST_LONG_MIDPOINTS');
      // The trigger reads BOTH numbers, so a zero on one ladder alone does not
      // reach §8 — which is why the decks set the pair together.
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/const noVolumeSignal = !\(peakAnchor > 0\) && !\(input\.recentLongMi > 0\);/.test(gen)) {
        throw new Error(
          'the cold-start trigger no longer reads both reported numbers · re-derive which ' +
            'answers on the deck have to be zero for it to fire',
        );
      }
      for (const deck of [
        'web-v2/components/onboarding/Step1bGoalDetails.tsx',
        'web-v2/components/redesign/onboarding/Step1bGoalDetailsRedesign.tsx',
      ]) {
        const src = sourceOf(deck);
        if ((src.match(/value: '0',/g) ?? []).length < 2) {
          throw new Error(
            `${deck} does not offer a zero rung on both history ladders · the engine's ` +
              'sedentary-starter branch is unreachable from this deck',
          );
        }
      }
    },
  },

  {
    id: 'TAPER.race-week-easy-duration',
    binds: ['lib/plan/generate.ts#composeRaceWeek.easyMinutes'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.3 Day-by-day race week templates',
    claim:
      'Race-week easy days are prescribed in MINUTES, not miles — every template in §9.3 is ' +
      'written that way, because three days out the point is time on legs at conversational ' +
      'effort and a distance target invites a runner to race it. The engine\'s T-4 and T-3 ' +
      'prescriptions must land inside the published durations for those days — and T-3 is ' +
      'read per distance, because the marathon template makes that day a near-rest and the ' +
      'half template makes it a real easy run. One number cannot satisfy both.',
    check({ cite }) {
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const t3s = matchLiteral(
        src,
        /const minEasyT3 = raceWeekCat === 'm' \|\| raceWeekCat === 'ultra' \? (\d+) : (\d+);/,
        'race-week T-3 easy minutes, split by distance',
      );
      const [t3Long, t3Short] = [Number(t3s[1]), Number(t3s[2])];
      const t4 = Number(
        matchLiteral(
          src,
          /const minEasy = daysBeforeRace === 4 \? (\d+) : minEasyT3;/,
          'race-week T-4 easy minutes',
        )[1],
      );
      if (!/EASY · \$\{minEasy\} MIN/.test(src)) {
        throw new Error(
          'the race-week easy day no longer labels itself in minutes · §9.3 prescribes time',
        );
      }
      // Templates assume a Sunday race, so T-4 is Wednesday and T-3 Thursday.
      const half = resolveCitation(
        'Research/08-pacing-and-race-week.md',
        '**Half marathon — race week template (Sunday race):**',
      ).table();
      within(t4, parseBand(half.cell('Wed', 'Duration')), 'race-week T-4 easy (half template)');
      within(t3Short, parseBand(half.cell('Thu', 'Duration')), 'race-week T-3 easy (half template)');
      // The marathon template is more conservative on the same two days.
      // TAPER-RWT3-1 (2026-08-17) · the `marathon-t3-shakeout` exemption is
      // gone. It recorded a flat 35 min sitting 5 min over the marathon's
      // "Rest or short easy shakeout · 0-30 min" ceiling, reported rather than
      // moved because that pass made no engine changes. Ruled on: the branch
      // splits, and both halves now land inside their own template's row.
      const mar = cite.table();
      within(t4, parseBand(mar.cell('Wed', 'Duration')), 'race-week T-4 easy (marathon template)');
      within(t3Long, parseBand(mar.cell('Thu', 'Duration')), 'race-week T-3 easy (marathon template)');
      // The split is only meaningful if the marathon actually gets less. A
      // regression that re-flattened the two to one value would still satisfy
      // both bands at 30 min and would quietly cost the half its easy day.
      if (t3Long >= t3Short) {
        throw new Error(
          `race-week T-3 is ${t3Long} min for the marathon and ${t3Short} for the half · §9.3 ` +
            'makes the marathon\'s the shorter day, so the split has collapsed',
        );
      }
      // 5K and 10K race on Saturday in §9.3, so their T-3 is the Wednesday row.
      // The short branch serves them too and must clear both.
      for (const [label, heading] of [
        ['10K', '**10K — race week template (Saturday race):**'],
        ['5K', '**5K — race week template (Saturday race):**'],
      ] as const) {
        const t = resolveCitation('Research/08-pacing-and-race-week.md', heading).table();
        within(t3Short, parseBand(t.cell('Wed', 'Duration')), `race-week T-3 easy (${label} template)`);
      }
    },
  },

  {
    id: 'LONGRUN.validator-cap-is-the-elite-band',
    binds: ['lib/plan/validate.ts#longRunCapMi'],
    doc: 'Research/22-plan-templates.md',
    anchor: '### Marathon — Advanced',
    claim:
      'The validator\'s long-run cap is a BACKSTOP behind the builder, not a second opinion ' +
      'about how long a long run should be. It therefore has to sit at the top of the highest ' +
      'tier band the builder can legitimately reach — TIER_TARGETS[cat].elite.peakLongMiBand ' +
      '— or it rejects plans the generator was entitled to author, which is exactly what it ' +
      'did before 2026-06-23. It must also clear the peak long run Research/22 publishes for ' +
      'that distance. And because this cap was documented in a header comment that went stale ' +
      'for two months while the citation under it named an unopenable book, every value the ' +
      'function returns must still appear in that comment.',
    check() {
      const src = sourceOf('web-v2/lib/plan/validate.ts');
      const body = src.slice(src.indexOf('function longRunCapMi'));
      const fn = body.slice(0, body.indexOf('\n}'));
      const caps: Partial<Record<DistCategory, number>> = {};
      for (const cat of ['5k', '10k', 'm', 'ultra'] as const) {
        caps[cat] = Number(
          matchLiteral(fn, new RegExp(`case '${cat}':\\s*return (\\d+);`), `longRunCapMi ${cat}`)[1],
        );
      }
      // The half is context-dependent: beginner / standalone / stepping-stone.
      caps.hm = Number(
        matchLiteral(fn, /return ctx\.level === 'beginner' \? \d+ : (\d+);/, 'longRunCapMi hm')[1],
      );
      // 2026-08-21 · the OTHER two halves of that branch. The regex above
      // discards the beginner value and never sees the stepping-stone value at
      // all, so two of `longRunCapMi`'s seven returns were unwatched — and the
      // header-comment loop below iterates only the caps this object holds, so
      // "≤ 14 mi (HM beginner)" and "≤ 22 mi" were not being checked for
      // staleness either, on the exact comment that already went stale once.
      const hmBeginnerCap = Number(
        matchLiteral(fn, /return ctx\.level === 'beginner' \? (\d+) : \d+;/, 'longRunCapMi hm beginner')[1],
      );
      const hmSteppingStoneCap = Number(
        matchLiteral(
          fn,
          /if \(ctx\.isSteppingStoneToMarathon\) return (\d+);/,
          'longRunCapMi hm stepping-stone',
        )[1],
      );
      for (const cat of CATS) {
        const band = TIER_TARGETS[cat].elite.peakLongMiBand[1];
        if (caps[cat] !== band) {
          throw new Error(
            `longRunCapMi('${cat}') = ${caps[cat]} but the elite peakLongMiBand top is ${band} · ` +
              'a backstop below the builder rejects legal plans; above it, it guards nothing',
          );
        }
      }
      // …and the marathon cap must clear what Research/22 publishes.
      const docPeakLong = parseBand(
        resolveCitation('Research/22-plan-templates.md', '### Marathon — Advanced')
          .table()
          .cell('Peak long run', 'Value'),
      );
      if ((caps.m ?? 0) < docPeakLong[1]) {
        throw new Error(
          `longRunCapMi('m') = ${caps.m} rejects the ${docPeakLong[1]} mi peak long run ` +
            'Research/22 §"Marathon — Advanced" prescribes',
        );
      }
      // ── the two half-marathon branches the ternary hides ──────────────────
      //
      // Both are BACKSTOPS, so the direction that matters is that neither
      // rejects a long run Research/22 prescribes for the runner it applies to.
      //
      // Beginner. Research/22 §"Half Marathon — Beginner" peaks the long run at
      // 10-12 mi. The cap sits above that band on purpose — the validator is
      // behind the builder, not a second opinion — but it must not creep up to
      // the standalone cap, or the branch stops meaning anything.
      const hmBeginnerDoc = parseBand(
        resolveCitation('Research/22-plan-templates.md', '### Half Marathon — Beginner')
          .table()
          .cell('Peak long run', 'Value'),
      );
      if (hmBeginnerCap < hmBeginnerDoc[1]) {
        throw new Error(
          `longRunCapMi('hm', beginner) = ${hmBeginnerCap} rejects the ${hmBeginnerDoc[1]} mi peak long run ` +
            'Research/22 §"Half Marathon — Beginner" prescribes',
        );
      }
      if (hmBeginnerCap >= (caps.hm ?? 0)) {
        throw new Error(
          `longRunCapMi('hm', beginner) = ${hmBeginnerCap} is not below the standalone cap ${caps.hm} · ` +
            'the beginner branch has stopped tightening anything',
        );
      }
      // Stepping stone. validate.ts's own comment is explicit that the NUMBER
      // is doctrine (Research/22's "Marathon — Intermediate" peak long run) and
      // the 168-day TRIGGER is a product decision. This binds the half that is
      // doctrine, and only that half.
      const steppingStoneDoc = parseBand(
        resolveCitation('Research/22-plan-templates.md', '### Marathon — Intermediate')
          .table()
          .cell('Peak long run', 'Value'),
      );
      if (hmSteppingStoneCap !== steppingStoneDoc[1]) {
        throw new Error(
          `the stepping-stone cap is ${hmSteppingStoneCap} mi but Research/22 §"Marathon — Intermediate" ` +
            `peaks the long run at ${steppingStoneDoc[1]} mi · a half inside a marathon block is capped as ` +
            'the marathon build it feeds, or the branch is citing a number that is not there',
        );
      }
      if (hmSteppingStoneCap > (caps.m ?? 0)) {
        throw new Error(
          `the stepping-stone cap ${hmSteppingStoneCap} exceeds the marathon cap ${caps.m} · a half is being ` +
            'allowed a longer long run than the marathon it is a stepping stone to',
        );
      }

      // The header comment must still describe the function.
      const header = src.slice(0, src.indexOf('interface PlanConstraints'));
      for (const [cat, mi] of Object.entries({ ...caps, 'hm beginner': hmBeginnerCap, 'hm stepping-stone': hmSteppingStoneCap })) {
        if (!new RegExp(`≤ ?${mi} mi`).test(header)) {
          throw new Error(
            `the long-run cap comment no longer lists ${mi} mi (${cat}) · it went stale once ` +
              'before, for two months, under a citation nobody could open',
          );
        }
      }
    },
  },

  /* ── CONVENTION claims from the book-citation sweep ──────────────────────
   *
   * Four numbers that were wearing a research finding's clothes. Each is kept
   * (the behaviour is fine and in three cases obviously right) and relabelled,
   * with a claim asserting the property it genuinely owes.
   */

  {
    id: 'CONVENTION.fitness-response-model',
    binds: ['lib/plan/simulator.ts#computeWeeklyGain', 'lib/plan/simulator.ts#COLD_START_CALIBRATION'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '## Aerobic Base Development',
    claim:
      'THE SIMULATOR\'S FITNESS-RESPONSE MODEL IS A CONVENTION. It cited `Daniels Running ' +
      'Formula §VDOT response curves`, which does not exist — Daniels publishes a VDOT table ' +
      'mapping performance to paces, not a curve of VDOT gain against training. No doc in ' +
      'Research/ carries a VDOT-gain-per-week figure at all, so there was nothing behind ' +
      '0.10 points per quality session or a plateau at 75. This is the cold-start anchor\'s ' +
      'defect a second time, and it had been projecting every runner\'s trajectory. Research ' +
      'grounds the model\'s SHAPE only — adaptation is non-linear and saturates as a runner ' +
      'approaches their ceiling. What this claim enforces is that the parameters stay bounded ' +
      'and inside the published VDOT table, that the output stays labelled as projected, and ' +
      'that the false citation never comes back.',
    check({ cite }) {
      const src = sourceOf('web-v2/lib/plan/simulator.ts');
      for (const ghost of [/Daniels Running Formula §VDOT response curves/, /Pfitzinger ADM §long-run progression/]) {
        if (ghost.test(src)) {
          throw new Error(`a fabricated citation is back on the simulator: ${ghost}`);
        }
      }
      if (!/THE FITNESS-RESPONSE MODEL IN THIS FILE IS A CONVENTION, NOT A RESEARCH\n \* FINDING/.test(src)) {
        throw new Error(
          'simulator.ts no longer states that its response model is a convention · that ' +
            'sentence is the whole point of this claim',
        );
      }
      // Bounded, and inside the table the rest of the engine reads. Daniels'
      // published VDOT table spans 30-85 (see the cap work in vdot.ts), so a
      // modelled plateau above that is a number with nothing underneath it.
      const c = COLD_START_CALIBRATION;
      if (!(c.vdotPerQuality > 0 && c.vdotPerQuality <= 0.5)) {
        throw new Error(`vdotPerQuality = ${c.vdotPerQuality} is outside a defensible range`);
      }
      if (!(c.longRunWeight >= 0 && c.longRunWeight <= 1)) {
        throw new Error(`longRunWeight = ${c.longRunWeight} is not a 0..1 weight`);
      }
      atMost(c.plateauVdot, 85, 'COLD_START_CALIBRATION.plateauVdot');
      const baseGain = Number(matchLiteral(src, /const baseGain = (\d*\.?\d+);/, 'baseGain')[1]);
      if (!(baseGain > 0 && baseGain <= 0.5)) {
        throw new Error(`baseGain = ${baseGain} is outside a defensible range`);
      }
      // Modelled, never presented as measured. (See CLAUDE.md — showing a
      // modelled gain as a measured one is the one sin here.)
      if (!/projectedVdot/.test(src)) {
        throw new Error('the simulator no longer names its output as projected');
      }
      // The doctrine this DOES rest on must still be there: a saturating curve.
      if (!/saturate/i.test(cite.text())) {
        throw new Error(
          'Research/00a §"Aerobic Base Development" no longer describes gains saturating · ' +
            'the only part of this model research grounds has moved',
        );
      }
    },
  },

  /**
   * 2026-08-18 · THE GAIN-RATE RECONCILIATION. This entry replaces two
   * CONVENTION claims (CONVENTION.trajectory-build-rate and
   * CONVENTION.goal-projection-build-rate) that recorded, honestly, that
   * BASE_BUILD_RATE and BUILD_RATE_VDOT_PER_WEEK (both 0.35) had no research
   * behind them. Honest, but incomplete: the engine was carrying THREE
   * different answers to the same physiological question —
   *
   *   goal-ready.ts        1/28 and 1/42 per day   read out of Research/01
   *   fitness-trajectory   0.35 per week           convention
   *   goal-projection      0.35 per week           convention (duplicate)
   *   goal-gap.ts          0.50 per week           FABRICATED
   *
   * — and the fabricated one was the one deciding whether a runner was told
   * their goal was still reachable. Its comment read `Per Daniels: realistic
   * VDOT change in 1 week is ~0.5 pts`; no such figure exists anywhere in
   * Research/. It survived the 2026-08-17 book-citation sweep because that
   * sweep greps for `Cite:` and this wrote `Per Daniels:`. The lint now
   * counts bare attribution phrases too, so the next one fails on sight.
   *
   * Research/01 §"Testing cadence" is the only passage in the corpus that
   * puts VDOT change on a clock, and it states a BAND: reassess every 4-6
   * weeks, +1 VDOT per reassessment. Every rate in the engine is now that
   * band, defined once in lib/training/vdot-gain-rate.ts.
   */
  {
    id: 'ADAPTATION.vdot-gain-rate',
    binds: [
      'lib/training/vdot-gain-rate.ts#VDOT_GAIN_PER_WEEK_MAX',
      'lib/training/vdot-gain-rate.ts#VDOT_GAIN_PER_WEEK_CONSERVATIVE',
      'lib/training/fitness-trajectory.ts#BASE_BUILD_RATE',
      'lib/training/goal-projection.ts#BUILD_RATE_VDOT_PER_WEEK',
      'lib/training/goal-ready.ts#MAX_RATE_PER_DAY',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Testing cadence — how often to deliberately test',
    claim:
      'The ONLY per-time VDOT quantum in Research/ is here: reassess every 4-6 weeks, +1 VDOT ' +
      'per reassessment. That is a band of 1/6 to 1/4 VDOT per week, and every modelled gain ' +
      'rate in the engine must be one edge of it — read out of the doc, not chosen. There must ' +
      'be exactly ONE definition, because the defect this replaces was three incompatible ' +
      'answers, the most permissive of which was invented.',
    check({ cite }) {
      const text = cite.text();
      // Both numbers come out of the doc. A check that hardcoded them would
      // only prove the test agrees with itself.
      const cadence = /reassessing fitness every\s*(\d+)\s*[-‐-―]\s*(\d+)\s*weeks/i.exec(text);
      if (!cadence) {
        throw new Error('Research/01 §Testing cadence no longer states a reassessment cadence in weeks');
      }
      const [fast, slow] = [Number(cadence[1]), Number(cadence[2])];
      const quantum = /\+\s*(\d+)\s*VDOT/i.exec(text);
      if (!quantum) {
        throw new Error('Research/01 §Testing cadence no longer states a per-reassessment VDOT step');
      }
      const step = Number(quantum[1]);

      if (ASSESSMENT_BLOCK_WEEKS_FAST !== fast || ASSESSMENT_BLOCK_WEEKS_SLOW !== slow) {
        throw new Error(
          `reassessment cadence: engine has ${ASSESSMENT_BLOCK_WEEKS_FAST}-${ASSESSMENT_BLOCK_WEEKS_SLOW} weeks, doctrine says ${fast}-${slow}`,
        );
      }
      if (VDOT_PER_ASSESSMENT_BLOCK !== step) {
        throw new Error(`VDOT per reassessment: engine has ${VDOT_PER_ASSESSMENT_BLOCK}, doctrine says ${step}`);
      }
      const expectMax = step / fast;
      const expectCons = step / slow;
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
      if (!near(VDOT_GAIN_PER_WEEK_MAX, expectMax)) {
        throw new Error(`VDOT_GAIN_PER_WEEK_MAX = ${VDOT_GAIN_PER_WEEK_MAX}, doctrine's fast edge is ${expectMax}`);
      }
      if (!near(VDOT_GAIN_PER_WEEK_CONSERVATIVE, expectCons)) {
        throw new Error(
          `VDOT_GAIN_PER_WEEK_CONSERVATIVE = ${VDOT_GAIN_PER_WEEK_CONSERVATIVE}, doctrine's slow edge is ${expectCons}`,
        );
      }
      if (!near(VDOT_GAIN_PER_DAY_MAX, expectMax / 7) || !near(VDOT_GAIN_PER_DAY_CONSERVATIVE, expectCons / 7)) {
        throw new Error('the per-day forms have drifted from the per-week band they are derived from');
      }

      // ONE model · the two build-rate constants must BE the doctrine edge,
      // not a number that happens to look like it.
      if (!near(BASE_BUILD_RATE, VDOT_GAIN_PER_WEEK_MAX)) {
        throw new Error(`BASE_BUILD_RATE = ${BASE_BUILD_RATE} is no longer the doctrine fast edge (${VDOT_GAIN_PER_WEEK_MAX})`);
      }
      if (!near(BUILD_RATE_VDOT_PER_WEEK, VDOT_GAIN_PER_WEEK_MAX)) {
        throw new Error(
          `BUILD_RATE_VDOT_PER_WEEK = ${BUILD_RATE_VDOT_PER_WEEK} is no longer the doctrine fast edge · ` +
            'a second, divergent rate is exactly the defect this claim exists to stop',
        );
      }
      for (const f of ['fitness-trajectory', 'goal-projection', 'goal-ready'] as const) {
        const src = sourceOf(`web-v2/lib/training/${f}.ts`);
        if (/=\s*0\.35\s*;/.test(src)) {
          throw new Error(`${f}.ts has re-introduced a literal 0.35 build rate instead of the shared model`);
        }
      }

      // The output must stay labelled projected, never measured — the one sin
      // this app has already shipped once (a native "Fitness" tile that read a
      // modelled buildRatio as a measured Stalled/Lagging/Responding verdict).
      const traj = sourceOf('web-v2/lib/training/fitness-trajectory.ts');
      if (!/projectedVdot/.test(traj)) {
        throw new Error('fitness-trajectory.ts no longer names its output as projected');
      }
      const rate = sourceOf('web-v2/lib/training/vdot-gain-rate.ts');
      if (!/MODELLED, never measured/.test(rate)) {
        throw new Error('vdot-gain-rate.ts no longer states that everything it derives is modelled, not measured');
      }
    },
  },

  /**
   * 2026-08-18 · the two single-shot VDOT magnitudes the engine leans on. Both
   * are read out of §"Triggers to retest", which is the only place Research/
   * puts a number on how far a fitness ESTIMATE may move at once.
   */
  {
    id: 'ADAPTATION.single-shot-vdot-magnitudes',
    binds: [
      'lib/training/vdot-gain-rate.ts#MAX_BLOCK_GAIN_VDOT',
      'lib/training/vdot-gain-rate.ts#LATENT_VDOT_UPGRADE_MAX',
      'lib/training/fitness-trajectory.ts#MAX_BLOCK_GAIN',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Triggers to retest',
    claim:
      'Doctrine states no build-block gain ceiling, but it does quantify how far a VDOT ' +
      'estimate may move at once: a >=2-week layoff drops it 3-5 points, and a race that beats ' +
      'prediction by >30 sec/mi adds 2-3. The engine caps one block\'s modelled gain at the top ' +
      'of the layoff band, and sizes the latent headroom it allows an aggressive goal at the top ' +
      'of the upgrade band. Neither may exceed what doctrine actually states.',
    check({ cite }) {
      const t = cite.table();
      const layoff = t.cell('Returning from layoff ≥2 weeks', 'Action');
      const drop = [...layoff.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
      if (drop.length < 2) throw new Error(`could not read the layoff drop band from "${layoff}"`);
      const maxSwing = Math.max(...drop);
      if (MAX_BLOCK_GAIN_VDOT !== maxSwing) {
        throw new Error(
          `MAX_BLOCK_GAIN_VDOT = ${MAX_BLOCK_GAIN_VDOT}, doctrine's largest short-interruption swing is ${maxSwing}`,
        );
      }
      if (MAX_BLOCK_GAIN !== MAX_BLOCK_GAIN_VDOT) {
        throw new Error('fitness-trajectory MAX_BLOCK_GAIN has diverged from the shared ceiling');
      }

      const upgrade = t.cell('Last race beat predicted time by >30 sec/mi', 'Action');
      const add = [...upgrade.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
      if (add.length < 2) throw new Error(`could not read the upgrade band from "${upgrade}"`);
      const maxUpgrade = Math.max(...add);
      if (LATENT_VDOT_UPGRADE_MAX !== maxUpgrade) {
        throw new Error(
          `LATENT_VDOT_UPGRADE_MAX = ${LATENT_VDOT_UPGRADE_MAX}, doctrine's largest single-observation upgrade is ${maxUpgrade}`,
        );
      }
      // The ceiling must not bind before the rate can express a real block.
      if (MAX_BLOCK_GAIN_VDOT < VDOT_GAIN_PER_WEEK_MAX * 4) {
        throw new Error('the block ceiling would bind before four weeks of the weekly rate ever mattered');
      }
      // And the latent headroom must never be spent as a gain rate.
      if (/LATENT_VDOT_UPGRADE_MAX/.test(sourceOf('web-v2/lib/training/fitness-trajectory.ts'))) {
        throw new Error(
          'fitness-trajectory.ts is reading the latent upgrade headroom · that number is a ' +
            'goal-feasibility bound, not fitness the projection may award',
        );
      }
    },
  },

  /**
   * 2026-08-18 · the display noise grace. Two constants used to express it —
   * 0.2 VDOT and a flat 30 seconds — and the seconds one was calibrated at
   * half-marathon scale and applied at every distance, so it could never fire
   * correctly for a 5K runner (30 seconds is a rout over 5K and inside the
   * noise over a marathon). There is ONE grace now, stated in VDOT, with the
   * seconds form derived per distance off the Daniels table.
   */
  {
    id: 'ADAPTATION.projection-noise-grace',
    binds: [
      'lib/training/vdot-gain-rate.ts#PROJECTION_NOISE_GRACE_VDOT',
      'lib/training/vdot-gain-rate.ts#noiseGraceSec',
      'lib/training/fitness-trajectory.ts#projectFitnessTrajectory',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Update logic',
    claim:
      'Doctrine re-derives every pace when VDOT moves by a whole point. A display grace that ' +
      'decides "reachable" or "ahead of goal" must therefore sit strictly INSIDE one point, so ' +
      'it can never swallow a difference doctrine would act on. It must be stated once, in ' +
      'VDOT, with any seconds form derived per distance rather than fixed at one distance.',
    check({ cite }) {
      const m = /abs\(new_VDOT\s*-\s*current_VDOT\)\s*>=\s*([\d.]+)/.exec(cite.text());
      if (!m) throw new Error('Research/01 §Update logic no longer states the actionable VDOT quantum');
      const actionable = Number(m[1]);
      if (!(PROJECTION_NOISE_GRACE_VDOT > 0 && PROJECTION_NOISE_GRACE_VDOT < actionable)) {
        throw new Error(
          `PROJECTION_NOISE_GRACE_VDOT = ${PROJECTION_NOISE_GRACE_VDOT} is not strictly inside doctrine's actionable ${actionable}`,
        );
      }
      const src = sourceOf('web-v2/lib/training/fitness-trajectory.ts');
      if (/gapSec\s*!=\s*null\s*&&\s*gapSec\s*<\s*-30\b/.test(src)) {
        throw new Error('the flat 30-second, HM-calibrated ahead-of-goal threshold is back');
      }
      if (/gapVdotRaw\s*<=?\s*-?0\.2\b/.test(src)) {
        throw new Error('fitness-trajectory.ts has re-introduced a literal 0.2 grace instead of the shared constant');
      }
      // Behavioural: the seconds grace must actually differ by distance.
      const at5k = noiseGraceSecFor(47, 3.10686);
      const atM = noiseGraceSecFor(47, 26.2188);
      if (at5k == null || atM == null) throw new Error('the derived seconds grace no longer resolves');
      if (!(atM > at5k * 3)) {
        throw new Error(
          `the seconds grace is not distance-aware: 5K ${at5k.toFixed(1)}s vs marathon ${atM.toFixed(1)}s`,
        );
      }
    },
  },

  /**
   * 2026-08-18 · the closable-gap test, which is what actually tells a runner
   * whether their goal is still on. It used to be a hardcoded 8/18/40/90
   * sec-per-week ladder justified by the fabricated 0.5 VDOT/wk figure. Two
   * things were wrong beyond the provenance: the ladder was blind to the
   * runner's own fitness (a VDOT point is worth far more seconds to a 4:10
   * marathoner than a 2:30 one), and it was an unwatched per-distance table.
   */
  {
    id: 'ADAPTATION.closable-gap-is-derived',
    binds: [
      'lib/training/vdot-gain-rate.ts#closableSecPerWeek',
      'lib/plan/goal-gap.ts#classifyTrend',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Testing cadence — how often to deliberately test',
    claim:
      'How many seconds of finish time a week of training can close is NOT a constant. It is ' +
      'the doctrine gain rate taken through the Daniels table at this runner\'s fitness and ' +
      'this distance, so it scales with both. The fabricated "~0.5 pts per week" that justified ' +
      'the old fixed ladder may never return, and no hardcoded seconds-per-week ladder may ' +
      'replace it.',
    check() {
      const src = sourceOf('web-v2/lib/plan/goal-gap.ts');
      // Same backtick rule the lint uses: a phrase inside backticks is being
      // QUOTED — that is how the comment names the citation it deleted — and
      // only a LIVE attribution counts. Writing down what went wrong has to
      // stay allowed, or the record of the defect gets deleted to pass a gate.
      const live = src.replace(/`[^`]*`/g, ' ');
      if (/Per Daniels/i.test(live)) {
        throw new Error('the fabricated "Per Daniels" attribution is back in goal-gap.ts');
      }
      if (/realistic VDOT change in 1 week/i.test(live)) {
        throw new Error('the fabricated ~0.5 VDOT/week figure is back in goal-gap.ts');
      }
      if (/raceDistanceMi\s*<=\s*3\.5\s*\?\s*8\b/.test(src)) {
        throw new Error('the hardcoded 8/18/40/90 closable ladder is back in goal-gap.ts');
      }
      if (!/closableSecPerWeek\(/.test(src)) {
        throw new Error('goal-gap.ts no longer derives its closable rate from the shared model');
      }
      // Behavioural · it must scale with BOTH distance and fitness.
      const slow5k = closableSecPerWeek(40, 3.10686);
      const fast5k = closableSecPerWeek(60, 3.10686);
      const slowM = closableSecPerWeek(40, 26.2188);
      if (slow5k == null || fast5k == null || slowM == null) {
        throw new Error('closableSecPerWeek no longer resolves for in-table runners');
      }
      if (!(slowM > slow5k)) {
        throw new Error('closableSecPerWeek is not distance-aware · a marathon week must be worth more seconds than a 5K week');
      }
      if (!(slow5k > fast5k)) {
        throw new Error('closableSecPerWeek is not fitness-aware · a VDOT point must be worth more seconds to a slower runner');
      }
      // And it must be the doctrine rate, not some other one.
      if (Math.abs(slow5k - secondsForDelta(40, 3.10686, VDOT_GAIN_PER_WEEK_MAX)) > 1e-6) {
        throw new Error('closableSecPerWeek is no longer sized at the doctrine gain rate');
      }
    },
  },

  /**
   * 2026-08-18 · the projection's taper. `TAPER_WEEKS = 2` was flat for every
   * distance while the doctrine-bound BLOCK_SHAPE.taperWeeks is 1/2/2/3/3, so
   * buildWeeks was wrong at BOTH ends: a week too generous for a marathon or
   * ultra goal, a week too mean for a 5K.
   *
   * The projection module cannot import the generator (a client component
   * pulls it into the browser bundle and generate.ts imports `pg`), so it
   * holds a copy — and this claim is what stops a copy from becoming a second
   * opinion: the two tables must agree value-for-value, and both must sit
   * inside Research/08 §9.1's own taper-length band.
   */
  {
    id: 'TAPER.trajectory-build-weeks',
    binds: [
      'lib/training/fitness-trajectory.ts#TAPER_WEEKS_BY_DISTANCE',
      'lib/training/fitness-trajectory.ts#taperWeeksForDistance',
    ],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | Taper length | Volume reduction (peak week) |',
    claim:
      'The weeks the fitness projection excludes from the build must be the SAME taper the plan ' +
      'generator actually writes, per distance, and both must be a whole-week rounding of ' +
      'doctrine\'s taper-length band for that distance. A flat two weeks for every distance ' +
      'over-credits a marathon build by a week and under-credits a 5K build by a week.',
    check({ cite }) {
      const t = cite.table();
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      const docRow: Record<DistCategory, string> = { ...DOC_ROW, ultra: 'Ultra (50K-100M)' };
      for (const cat of CATS) {
        const mine = TAPER_WEEKS_BY_DISTANCE[cat];
        const m = matchLiteral(
          gen,
          new RegExp(`'${cat}':\\s*\\{\\s*taperWeeks:\\s*(\\d+)`),
          `BLOCK_SHAPE['${cat}'].taperWeeks`,
        );
        const generator = Number(m[1]);
        if (mine !== generator) {
          throw new Error(
            `TAPER_WEEKS_BY_DISTANCE.${cat} = ${mine} but the generator tapers ${generator} weeks · ` +
              'the projection would size the build off a taper the plan does not run',
          );
        }
        const [lo, hi] = parseBand(t.cell(docRow[cat], 'Taper length'));
        within(mine, [Math.ceil(lo / 7), Math.ceil(hi / 7)], `TAPER_WEEKS_BY_DISTANCE.${cat}`);
      }
      // An unknown distance must not silently borrow a distance's taper.
      const unknown = taperWeeksForDistance(null);
      const shortest = Math.min(...CATS.map((c) => TAPER_WEEKS_BY_DISTANCE[c]));
      if (unknown !== shortest) {
        throw new Error(
          `taperWeeksForDistance(null) = ${unknown} · an unreadable distance must fall back to the ` +
            `shortest taper (${shortest}), which cannot inflate a projected gain`,
        );
      }
    },
  },

  /**
   * 2026-08-18 · the goal assessment's volume caution. It tells a runner that
   * volume, not speed, is what stands between them and the distance — so the
   * line it fires under has to be doctrine's, not a feel. Research/00a's
   * volume table publishes a beginner band per distance and the low edge of
   * that band is the gentlest honest floor in the corpus.
   */
  {
    id: 'VOLUME.goal-assessment-floor',
    binds: ['lib/training/goal-assessment.ts#MIN_WEEKLY_MI_FOR_DISTANCE'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume table — miles per week (km in parentheses)',
    claim:
      'The weekly mileage below which the goal assessment names volume as the limiter is the LOW ' +
      'edge of doctrine\'s own beginner ("just finishing") band for that distance. Deliberately ' +
      'the gentlest number the doc states: this gates a coaching caution, and a caution that ' +
      'fires on a competent recreational runner is one people learn to ignore.',
    check({ cite }) {
      const t = cite.table();
      const docRow: Record<DistCategory, string> = {
        '5k': '5K', '10k': '10K', hm: 'Half-marathon', m: 'Marathon', ultra: '50K',
      };
      for (const cat of CATS) {
        const [lo] = parseBand(t.cell(docRow[cat], 'Beginner (just finishing)'));
        if (MIN_WEEKLY_MI_FOR_DISTANCE[cat] !== lo) {
          throw new Error(
            `MIN_WEEKLY_MI_FOR_DISTANCE.${cat} = ${MIN_WEEKLY_MI_FOR_DISTANCE[cat]}, doctrine's beginner floor is ${lo} mi/wk`,
          );
        }
      }
      // Monotonic: a longer race can never want less weekly volume.
      for (let i = 1; i < CATS.length; i++) {
        if (MIN_WEEKLY_MI_FOR_DISTANCE[CATS[i]] <= MIN_WEEKLY_MI_FOR_DISTANCE[CATS[i - 1]]) {
          throw new Error(`the volume floor does not rise from ${CATS[i - 1]} to ${CATS[i]}`);
        }
      }
    },
  },

  /* ── Cold-start observability · the 2026-08-17 audit ──────────────────────
   *
   * Four signals asserted things they could not know, and all four were
   * loudest in a runner's first month. These claims bind the windows, and each
   * one carries a behavioural falsifier that replays the original defect · a
   * band check alone would not have caught any of them, because every constant
   * involved was already correct. What was wrong was what the engine did when
   * it could not see far enough back to use them.
   */
  {
    id: 'SAMPLING.acwr-needs-a-full-chronic-window',
    binds: [
      'lib/coach/acwr.ts#ACWR_MIN_COVERAGE_DAYS',
      'lib/coach/acwr.ts#acwrFromDailyMileage',
    ],
    doc: 'Research/15-wearable-data.md',
    anchor: 'ACWR = acute_load_7d / chronic_load_28d',
    claim:
      'The ratio is defined over a 7-day numerator and a 28-day denominator, and the engine ' +
      'reads both window lengths out of that definition. The denominator divides by a FIXED 28 ' +
      'days, so for an account younger than the window the uncovered days enter it as real ' +
      'zeroes and deflate the baseline. At the limit the two legs sum the SAME runs and the ' +
      'ratio is the constant 28/7 = 4.00 for any mileage whatsoever — an algebraic identity ' +
      'that fired an urgent injury card. So the ratio requires a fully observable chronic ' +
      'window, and below it the honest output is null.',
    check({ cite }) {
      // Read both window lengths out of the doc's own formula rather than
      // restating them, so a doc edit to either window moves the engine.
      const line = cite.section[0];
      const acute = Number(line.match(/acute_load_(\d+)d/)?.[1]);
      const chronic = Number(line.match(/chronic_load_(\d+)d/)?.[1]);
      if (!Number.isFinite(acute) || !Number.isFinite(chronic)) {
        throw new Error(`could not read the ACWR windows out of ${cite.doc} · line: ${line}`);
      }
      if (ACWR_ACUTE_DAYS !== acute) {
        throw new Error(`ACWR_ACUTE_DAYS is ${ACWR_ACUTE_DAYS}, doctrine says ${acute}`);
      }
      if (ACWR_CHRONIC_DAYS !== chronic) {
        throw new Error(`ACWR_CHRONIC_DAYS is ${ACWR_CHRONIC_DAYS}, doctrine says ${chronic}`);
      }
      // The coverage requirement IS the chronic window · anything less and the
      // fixed denominator is counting days the account did not exist.
      if (ACWR_MIN_COVERAGE_DAYS !== chronic) {
        throw new Error(
          `ACWR_MIN_COVERAGE_DAYS is ${ACWR_MIN_COVERAGE_DAYS} · a fixed ${chronic}-day ` +
            'denominator needs that many days of observable history to mean anything',
        );
      }

      // Falsifier · replay the defect. A runner whose entire history is one
      // week, running every day. The pre-fix engine returned exactly 4.00 here
      // and could return nothing else.
      const today = '2026-03-08';
      const week = new Map<string, number>();
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.parse(today + 'T12:00:00Z') - i * 86400000).toISOString().slice(0, 10);
        week.set(d, 6);
      }
      const cold = acwrFromDailyMileage(week, today, 7);
      if (cold.acwr !== null) {
        throw new Error(
          `a 7-day-old account reports ACWR ${cold.acwr} · with both legs summing the same ` +
            `runs the only value it can produce is ${chronic}/${acute} = ` +
            `${(chronic / acute).toFixed(2)}, which is arithmetic, not a measurement`,
        );
      }
      if (cold.reason !== 'insufficient_coverage') {
        throw new Error(`cold-start ACWR is absent for the wrong reason: ${cold.reason}`);
      }
      // And it must still compute once the window is covered · a guard that
      // never opens is as useless as one that never closes.
      const full = new Map<string, number>();
      for (let i = 0; i < ACWR_CHRONIC_DAYS; i++) {
        const d = new Date(Date.parse(today + 'T12:00:00Z') - i * 86400000).toISOString().slice(0, 10);
        full.set(d, 6);
      }
      const warm = acwrFromDailyMileage(full, today, ACWR_CHRONIC_DAYS);
      if (warm.acwr == null) {
        throw new Error('a fully covered 28-day window still reports no ACWR · the guard never opens');
      }
      within(warm.acwr, [0.9, 1.1], 'ACWR for a runner holding steady mileage');
    },
  },

  {
    id: 'SAMPLING.acwr-is-not-a-stop-light',
    binds: ['lib/coach/health-actions.ts#buildHealthActions', 'lib/coach/acwr.ts#acwrAbsentCopy'],
    doc: 'Research/15-wearable-data.md',
    anchor: 'treat ACWR as a directional sanity check, not a stop-light',
    claim:
      'Doctrine is explicit that a ratio in itself is not a verdict, and the same section ' +
      'carries the Impellizzeri critique that no causal injury link has been established. The ' +
      'engine still promotes the ratio to an urgent injury card, which is defensible only ' +
      'while the number is a real measurement. This claim binds the thing that makes that ' +
      'true: every card that acts on the ratio must be gated on it being non-null, so an ' +
      'absent ratio can never be read as a calm one or as an alarming one.',
    check({ cite }) {
      // The doc must still say this · a claim that outlives its passage is decoration.
      const stance = cite.section.join(' ');
      if (!/not a verdict/.test(stance)) {
        throw new Error(`${cite.doc} no longer says a ratio in itself is not a verdict`);
      }

      const src = sourceOf('web-v2/lib/coach/health-actions.ts');
      // Every branch that reads the ratio carries its own null guard. An
      // ungated read is how an absent signal becomes a confident one.
      const reads = [...src.matchAll(/state\.loadAcwr/g)].length;
      const guarded = [...src.matchAll(/state\.loadAcwr\s*!=\s*null/g)].length;
      if (reads === 0) {
        throw new Error('health-actions.ts no longer reads loadAcwr · re-point or delete this claim');
      }
      if (guarded === 0) {
        throw new Error('no null guard remains on loadAcwr in health-actions.ts');
      }
      // The urgent hard-cap card specifically · the most consequential consumer.
      matchLiteral(
        src,
        /if \(state\.loadAcwr != null && state\.loadAcwr >= HARD_RULES\.acwrInjuryHardCap\)/,
        'lib/coach/health-actions.ts · ACWR injury hard cap must stay null-gated',
      );
    },
  },

  {
    id: 'SAMPLING.ctl-atl-time-constants',
    binds: [
      'lib/coach/training-form.ts#CTL_WINDOW_DAYS',
      'lib/coach/training-form.ts#ATL_WINDOW_DAYS',
      'lib/coach/training-form.ts#labelForTsb',
    ],
    doc: 'Research/15-wearable-data.md',
    anchor: '| Quantity | Time constant | Reads as |',
    claim:
      'CTL is a 42-day time constant and ATL a 7-day one, read out of the doc rather than ' +
      'restated. The consequence the engine kept missing: a 42-day EWMA seeded at zero has not ' +
      'converged until 42 days of the RUNNER’S OWN history have passed through it, and every ' +
      'day before their first run enters the series as a rest day. A runner ten days in at 50 ' +
      'mi/wk therefore lands at TSB around −32 with CTL just past the CTL<10 guard, and was ' +
      'labelled OVERREACH. Below a covered CTL window the label must stay BUILDING.',
    check({ cite }) {
      const t = cite.table();
      const days = (label: string) => {
        const cell = t.row(label)[t.headers[1]];
        const n = Number(String(cell).match(/(\d+)/)?.[1]);
        if (!Number.isFinite(n)) throw new Error(`could not read a time constant for ${label}: ${cell}`);
        return n;
      };
      const ctlDays = days('CTL');
      const atlDays = days('ATL');
      if (CTL_WINDOW_DAYS !== ctlDays) {
        throw new Error(`CTL_WINDOW_DAYS is ${CTL_WINDOW_DAYS}, doctrine says ${ctlDays}`);
      }
      if (ATL_WINDOW_DAYS !== atlDays) {
        throw new Error(`ATL_WINDOW_DAYS is ${ATL_WINDOW_DAYS}, doctrine says ${atlDays}`);
      }

      // Falsifier · the exact day-10 envelope from the incident. Deeply
      // negative TSB, CTL above the magnitude guard, and only ten days of
      // observable history behind it.
      const day10 = labelForTsb(-32, 13, 10);
      if (day10 !== 'BUILDING') {
        throw new Error(
          `a runner with 10 days of history and TSB −32 is labelled ${day10} · the ` +
            `${ctlDays}-day EWMA has not converged, so the number is measuring the age of the ` +
            'account, not the athlete',
        );
      }
      // One day short of the window is still provisional; the window itself is not.
      if (labelForTsb(-32, 40, ctlDays - 1) !== 'BUILDING') {
        throw new Error('the coverage guard opens before the CTL window is covered');
      }
      if (labelForTsb(-32, 40, ctlDays) !== 'OVERREACH') {
        throw new Error(
          'a fully covered CTL window still withholds the verdict · the guard never opens, ' +
            'which suppresses real overreach',
        );
      }
    },
  },

  {
    id: 'CONVENTION.adaptive-bump-ceiling',
    binds: ['lib/plan/adaptive-ramp.ts#MAX_WEEKLY_BUMP_MI', 'lib/plan/adaptive-ramp.ts#MAX_LONG_BUMP_MI'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'THE ADAPTIVE BUMP IS A CONVENTION. It cited `Pfitzinger Faster Road Racing · adaptive ' +
      'load progression`; Faster Road Racing publishes fixed schedules, so there is no ' +
      'adaptive-progression protocol in it. +5 mi in a week is not inside any per-week ramp ' +
      'band at low volume — at 20 mi/wk it is +25% — so a percentage is not what bounds this. ' +
      'What bounds it is the runner\'s own tier band, which Research/22 sets and which the ' +
      'bump code caps against on both the long run and the week. That is the property this ' +
      'claim enforces, along with the bump staying small in absolute terms.',
    check({ cite }) {
      const src = sourceOf('web-v2/lib/plan/adaptive-ramp.ts');
      if (/Cite: Pfitzinger Faster Road Racing/.test(src)) {
        throw new Error('the unopenable Pfitzinger citation is back on the adaptive ramp');
      }
      if (!/THE BUMP POLICY IS A PRODUCT CONVENTION/.test(src)) {
        throw new Error(
          'adaptive-ramp.ts no longer states that its bump policy is a convention',
        );
      }
      // Every bump must be clamped to the tier band. Without these the bump is
      // unbounded and the "convention" has no ceiling at all.
      for (const clamp of [/Math\.min\(proposed, opp\.tierLongUpper\)/, /tierWeeklyUpper/]) {
        if (!clamp.test(src)) {
          throw new Error(`the bump no longer clamps to the tier band (${clamp})`);
        }
      }
      if (!(MAX_LONG_BUMP_MI > 0 && MAX_LONG_BUMP_MI <= 2)) {
        throw new Error(`MAX_LONG_BUMP_MI = ${MAX_LONG_BUMP_MI} is no longer a nudge`);
      }
      if (!(MAX_WEEKLY_BUMP_MI > 0 && MAX_WEEKLY_BUMP_MI <= 10)) {
        throw new Error(`MAX_WEEKLY_BUMP_MI = ${MAX_WEEKLY_BUMP_MI} is no longer a nudge`);
      }
      if (MAX_PER_EASY_BUMP_MI > MAX_WEEKLY_BUMP_MI) {
        throw new Error('a single easy day may be bumped more than the whole week');
      }
      // And the doctrine it defers to must still be a table of progression rules.
      if (cite.table().rows.length === 0) {
        throw new Error('Research/00a §"Volume progression rules" is no longer a table');
      }
    },
  },

  {
    id: 'RAMP.validator-shares-the-generator-ceiling',
    binds: ['lib/plan/validate.ts#peakVsTrailingRamp'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'The peak-vs-trailing ramp check and the generator\'s own climb must read the SAME ramp ' +
      'ceiling. "One doctrinal quantum, N disagreeing constants" is a named drift pattern here: ' +
      'this validator kept a flat 1.65 (and before that 1.10^weeks) after the generator was ' +
      're-sourced to GENERAL_RAMP_CEILING, and rejected 48 beginner archetypes the generator was ' +
      'correctly authoring. It must key off GENERAL_RAMP_CEILING, at the caller\'s experience ' +
      'level, and hold no ramp percentage of its own. Seeded by the book-citation sweep, which ' +
      'found the field\'s doc-comment still describing the deleted 1.65 under an unopenable ' +
      'Pfitzinger citation — the second stale comment in this file hiding behind a book.',
    check({ cite }) {
      const src = sourceOf('web-v2/lib/plan/validate.ts');
      if (/Cite: Pfitzinger "Advanced Marathoning" §weekly volume escalation/.test(src)) {
        throw new Error('the unopenable Pfitzinger citation is back on the peak-vs-trailing check');
      }
      // One constant, read from the shared table.
      matchLiteral(
        src,
        /const rampPerWeek = GENERAL_RAMP_CEILING\[ctx\.level \?\? 'intermediate'\];/,
        'peak-vs-trailing ramp ceiling',
      );
      matchLiteral(
        src,
        /const ceiling = rampBase \* Math\.min\(flatCap, Math\.pow\(rampPerWeek,/,
        'peak-vs-trailing ceiling expression',
      );
      // And no resurrected flat ratio in the executing code. The 1.65 that used
      // to live here may still be NAMED in the comments that explain why it went.
      const code = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      if (/rampBase\s*\*\s*\d+\.\d+\s*[;)]/.test(code)) {
        throw new Error(
          'the peak-vs-trailing check has grown a flat ramp multiplier again · it must read ' +
            'GENERAL_RAMP_CEILING so the validator and the generator cannot diverge',
        );
      }
      // The generator's ceiling is only doctrine because this table says so.
      const spec = cite.table().cell('Year-on-year base growth', 'Specification');
      const grown = parseBand(spec);
      const engine = Object.values(GENERAL_RAMP_CEILING).map((v) => (v - 1) * 100);
      if (Math.min(...engine) < grown[0]) {
        throw new Error(
          `a ramp ceiling of ${Math.min(...engine)}%/wk is under doctrine's ${grown[0]}% floor`,
        );
      }
    },
  },

  {
    id: 'CONVENTION.post-deload-reentry-cap',
    binds: ['lib/plan/generate.ts#volumeCurve.postDeloadCap'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### What Cutback Weeks Are Not',
    claim:
      'THE 1.45 POST-DELOAD RE-ENTRY CAP IS A CONVENTION. It cited `Pfitzinger ADM §"Cutback ' +
      'Weeks" + §"Week-over-Week 10% Rule"`; the cutback half is real and lives on the deload ' +
      'line (bound by CUTBACK.depth), but no source prescribes how fast a runner returns FROM ' +
      'a planned cutback. The factor exists so this curve cannot author a week that the ' +
      'validator would then reject — a plumbing constant, not physiology. What it owes is ' +
      'exactly that, and WKRAMP-1 (2026-08-19) made the obligation a sharper one. It used to ' +
      'be measured against validate.ts\'s flat weeklyVolWoWMaxPct, which was itself fitted to ' +
      'the generator, so the pair proved nothing. That constant is gone; the re-entry is now ' +
      'measured against the doctrine it actually rides on — deload depth times re-entry factor ' +
      'must land at or under the general ramp ceiling, i.e. the week you come back to may not ' +
      'be a bigger step from the week BEFORE the deload than an ordinary climbing week is.',
    check({ cite }) {
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      if (/§"Week-over-Week 10% Rule"/.test(gen)) {
        throw new Error('the fabricated `§"Week-over-Week 10% Rule"` citation is back');
      }
      if (!/1\.45 IS A PRODUCT CONVENTION, NOT A RESEARCH FINDING/.test(gen)) {
        throw new Error('generate.ts no longer states that the 1.45 re-entry cap is a convention');
      }
      const factor = Number(
        matchLiteral(gen, /lastDeloadVol \* (\d*\.?\d+)/, 'post-deload re-entry cap')[1],
      );
      // The deload the re-entry returns FROM · same file, same curve.
      const deload = Number(
        matchLiteral(gen, /const deload = Math\.round\(lastClimb \* (\d*\.?\d+)\);/, 'deload depth')[1],
      );
      // Coming back from a `deload`-deep cutback at `factor` puts the week at
      // `deload * factor` of the pre-cutback week. That is a two-week move, and
      // it may not out-climb what a single ordinary week is allowed to do.
      const effective = deload * factor;
      const rampCeiling = Math.max(...Object.values(GENERAL_RAMP_CEILING));
      if (effective > rampCeiling) {
        throw new Error(
          `a ${deload} deload followed by a ${factor} re-entry lands at ${effective.toFixed(3)}× ` +
            `the pre-cutback week · above the ${rampCeiling} general ramp ceiling, so the curve ` +
            'would use the cutback as a launchpad rather than a recovery',
        );
      }
      // Deload → return is a real pattern; the doc must still say a cutback is
      // a reduction rather than a rest week, or the whole manoeuvre changes.
      if (!/not rest weeks/i.test(cite.text())) {
        throw new Error(
          'Research/00b §"What Cutback Weeks Are Not" no longer distinguishes a cutback from a ' +
            'rest week · re-read it before this cap is justified again',
        );
      }
    },
  },

  /**
   * CONVENTION · like `CONVENTION.cold-start-mileage-anchor`, the RULE here is
   * ours and only its SHAPE is grounded in research. Research/15 says what a
   * recovery score IS — a weighted blend of HRV, RHR and sleep, and a blend of
   * correlates rather than a direct measurement. It says nothing about what to
   * do when one of those inputs is missing, because no passage in the corpus
   * does. So this claim does not pretend to cite a threshold. It fixes the one
   * thing the doc's own definition implies: a blend can only blend what it has.
   *
   * The defect: every term in the recovery score was unconditional, and each
   * one's absent value happened to be a good one — absent HRV scored 100 at
   * weight 0.45, absent RHR 100 at 0.25, an absent Banister envelope 70 at
   * 0.20, absent sleep a hardcoded 50 at 0.10. Net 89/100, rendered as
   * "Recovered cleanly · banking the work" to a runner we could barely see.
   */
  {
    id: 'CONVENTION.absent-pillars-do-not-score',
    binds: ['lib/coach/recovery-brief.ts#computeScore'],
    doc: 'Research/15-wearable-data.md',
    anchor: 'These are weighted blends of the same underlying physiology (HRV, RHR, sleep), packaged differently.',
    claim:
      'A recovery score is a weighted blend of HRV, RHR and sleep, and doctrine is explicit ' +
      'that it measures correlates rather than recovery itself. What follows is ours, not the ' +
      'doc’s: a blend may only blend the inputs it actually has. An absent pillar is dropped ' +
      'and the remaining weights renormalise, so the score is a real reading of a thin picture ' +
      'instead of a confident reading of a fabricated one. What this claim enforces is that no ' +
      'pillar can ever again contribute a default value, and that a fully absent input set ' +
      'cannot produce a passing score.',
    check({ cite }) {
      // The doc must still define the score as a blend of these three.
      const t = cite.section.join(' ');
      for (const signal of ['HRV', 'RHR', 'sleep']) {
        if (!t.includes(signal)) {
          throw new Error(`${cite.doc} no longer names ${signal} as a recovery-score input`);
        }
      }

      // Comment lines are stripped before scanning · each of these fabrications
      // is quoted verbatim in the "was:" comment that records its removal, and
      // a tripwire that fires on its own incident report is a tripwire nobody
      // can keep green.
      const src = sourceOf('web-v2/lib/coach/recovery-brief.ts')
        .split('\n')
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
      // The fabrications by name. None may return.
      if (/sleepAdequacyPct[\s\S]{0,200}?return 50;/.test(src)) {
        throw new Error('sleepAdequacyPct returns a hardcoded 50 again for a runner with no sleep data');
      }
      if (/tsb: form\?\.tsb \?\? 0/.test(src)) {
        throw new Error('`form?.tsb ?? 0` is back · an absent Banister envelope scores 70/100 through it');
      }
      if (/state\.rhrBaseline \?\? state\.rhrCurrent \?\? 60/.test(src)) {
        throw new Error('the fabricated 60 bpm RHR baseline is back in the recovery brief payload');
      }
      // And the renormalisation itself · the weights must be summed from the
      // terms that survived, never from a fixed total.
      matchLiteral(
        src,
        /totalWeight \+= weight;/,
        'lib/coach/recovery-brief.ts#computeScore · weights renormalise over present pillars',
      );
      matchLiteral(
        src,
        /if \(value == null\) continue;/,
        'lib/coach/recovery-brief.ts#computeScore · absent pillars are skipped, not defaulted',
      );
    },
  },

  /* ── 2026-08-18 · doctrine sweep round 2 · five "not yet seeded" claim
   * areas from CLAUDE.md's list: fitness-trajectory gain rates were already
   * closed by CONVENTION.trajectory-build-rate / CONVENTION.goal-projection-
   * build-rate / CONVENTION.fitness-response-model above (confirmed, not
   * re-added). This block closes the five genuinely-open areas that HAD an
   * engine constant to bind: the long-run week-over-week red line, the RHR
   * pre-illness threshold, the injury walk-run ladder, the strength
   * phase-frequency matrix, and the race-day carb rate by distance.
   *
   * Two areas remain deliberately unclaimed, same shape as Daniels' weekly
   * dosing caps: age/sex VDOT grading (Research/24) has NO engine
   * implementation at all (grepped clean across lib/), and hydration
   * bands (Research/19) likewise have no g/hr-or-sodium prescription
   * anywhere in the engine — fueling.ts and fuel-resolve.ts are carb-only.
   * A claim needs a constant to bind; inventing one to satisfy the gate
   * would be the fabrication this gate exists to catch, not fix.
   *
   * ── 2026-08-19 · BOTH RE-SURVEYED. Still zero consumers, and the two gaps
   * are NOT the same size. Written down here rather than in a status doc,
   * because this is the file anyone asking "why is there no claim for X"
   * will open.
   *
   * RESEARCH/19 · HYDRATION · a genuine capability gap, blocked on inputs.
   *   Encodable content is dense: fluid ml/hr as a 5-distance x 4-temperature
   *   table, an 8-row sodium mg/hr scenario table, sweat-rate and sweat-sodium
   *   classifications, the EAH ceilings (~800 ml/hr general, ~500 for a >5 h
   *   marathon), the mass-loss performance bands, pre-race preload figures.
   *   What blocks it is DATA, not doctrine: nothing in the schema stores a
   *   measured sweat rate, a sweat-sodium class, logged fluid or sodium, or a
   *   pre/post-run mass pair, and HealthKit import takes bodyMass but not
   *   dietaryWater. Body mass (profile.weight_kg), temperature, duration and
   *   distance already exist, so the ml/hr table is the reachable half and the
   *   sodium half is not.
   *   What the runner gets instead: one hardcoded string, identical for every
   *   runner at every distance in every temperature — components/faff-app/
   *   raceDetail.ts, "Drink mix every 3-4 mi · extra electrolyte if warm" —
   *   plus a few hand-written heat tips. Both render sites already carry a
   *   comment admitting it is a standing default, in contrast to the adjacent
   *   on-course carb line which was moved onto the real per-distance rate.
   *
   * RESEARCH/24 · AGE AND SEX GRADING · not blocked on anything.
   *   Every input it asks for is already stored: profile.birthday (with
   *   ageFromBirthday() in profile-state.ts already deriving the age and
   *   exposing it as identity.age), profile.age, and sex in both
   *   profile.sex and users.sex with loadBiologicalSex() normalising them.
   *   The doc's own "Implementation notes" describe localStorage and call
   *   server-side persistence future work, which is stale — the columns
   *   landed in migration 106.
   *   Encodable content is thin but real: a 6-row male age-decline table
   *   (~0.3/yr in the 30s rising to ~1.5/yr past 70), a 4-row cohort-ceiling
   *   table, and a +7 VDOT female cohort offset. The female decline curve is
   *   described in prose only and has no numbers to encode.
   *   What the runner gets instead: a 50-year-old's VDOT is treated
   *   byte-identically to a 25-year-old's. Every function in the VDOT
   *   pipeline — vdotFromRace, predictRaceTime, bestRecentVdot,
   *   resolveCurrentTPace, resolveFitness — takes no age and no sex ("anchor
   *   age" in that file means days since the race, not the runner's age). The
   *   only consumer of identity.age anywhere is fact-reciter.ts, which
   *   concatenates it into a display string.
   *   NOTE THE RULE THAT MAKES THIS CHEAP AND SAFE: Research/24 states twice
   *   that raw VDOT drives pace prescription ALWAYS and the graded number is
   *   framing only. So consuming it changes no prescribed pace, no plan and
   *   no watch payload — it adds a secondary line to the VDOT tile, in the
   *   slot HealthView.tsx currently gives to anchor staleness. Two onboarding
   *   screens already promise it ("UNLOCKS AGE-GRADED ZONES",
   *   Step3Confirm.tsx and Step3ConfirmRedesign.tsx) and nothing delivers it.
   *
   * Neither is built here, per instruction. The asymmetry is the finding: /19
   * needs new capture surfaces and a DDL migration before a claim can exist,
   * while /24 needs only a function and has a promise outstanding to the
   * runner.
   */
  {
    id: 'LONGRUN.wow-single-step-cap-is-the-injury-red-line',
    binds: ['lib/plan/validate.ts#CONSTRAINTS.longRunWoWMaxPct'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'Doctrine names two thresholds for a single long run against the longest run in the ' +
      'prior 30 days: over 110% starts raising overuse-injury risk (~64%), and over 130% ' +
      '"raises it further" — a harder red line. RAMP.single-session-spike already holds the ' +
      'GENERATOR to the softer 110% guideline (rampCeiling). The validator is the backstop that ' +
      'REJECTS a plan outright, so it is allowed to sit at the harder ceiling doctrine names ' +
      'rather than the guideline the generator itself honours — a 130%-of-longest run is exactly ' +
      'a 30% week-over-week jump, which is what longRunWoWMaxPct enforces.',
    check({ cite }) {
      const cellText = cite.table().cell('Single-session spike threshold', 'Specification');
      // `>NNN%` only — the cell also carries a bare "~64%" injury-risk-increase
      // figure between the two thresholds, which is not itself a threshold.
      const pcts = [...cellText.matchAll(/>(\d+)%/g)].map((m) => Number(m[1]));
      if (pcts.length < 2) {
        throw new Error(
          'doctrine no longer states two spike thresholds (>110% / >130%) for a single long run ' +
            'vs. the prior-30-day longest',
        );
      }
      const hardCeilingIncreasePct = pcts[1] - 100; // "130% of longest" → a 30% increase
      const src = sourceOf('web-v2/lib/plan/validate.ts');
      const values = [...src.matchAll(/longRunWoWMaxPct: (\d+)/g)].map((m) => Number(m[1]));
      if (values.length === 0) throw new Error('CONSTRAINTS no longer declares longRunWoWMaxPct');
      for (const v of values) {
        if (v !== hardCeilingIncreasePct) {
          throw new Error(
            `longRunWoWMaxPct is ${v}%, doctrine's harder single-session ceiling is a ` +
              `${hardCeilingIncreasePct}% week-over-week increase (>${pcts[1]}% of longest)`,
          );
        }
      }
    },
  },

  {
    id: 'READINESS.rhr-elevation-pre-illness-band',
    binds: ['lib/coach/health-state.ts#rhrElevated', 'lib/coach/health-state.ts#rhrSustainedRed'],
    doc: 'Research/15-wearable-data.md',
    anchor: '## Spotting Illness Early',
    claim:
      'The classic pre-illness signature is a nocturnal RHR +5 to +15 bpm above baseline, ' +
      'typically 1-3 days before symptoms. The engine\'s two watch-list tiers — amber at +5 ' +
      '(the earliest, most sensitive read) and red at +8 (partway up the band, once it is not ' +
      'settling) — must both sit inside that band, and the sustained/red tier must trigger no ' +
      'sooner than the elevated/amber one.',
    check({ cite }) {
      // "+5 to +15 bpm" — prose-"to" band, not the hyphenated form parseBand
      // handles, so pull the two numbers directly.
      const magCell = cite.table().cell('RHR (nocturnal)', 'Magnitude');
      const nums = [...magCell.matchAll(/\d+/g)].map((m) => Number(m[0]));
      if (nums.length < 2) {
        throw new Error(`doctrine's RHR pre-illness magnitude cell no longer states a two-number band: "${magCell}"`);
      }
      const [lo, hi] = nums;
      const src = sourceOf('web-v2/lib/coach/health-state.ts');
      const elevated = Number(
        matchLiteral(src, /const rhrElevated\s*=\s*rhrDelta != null && rhrDelta >= (\d+);/, 'rhrElevated')[1],
      );
      const sustained = Number(
        matchLiteral(src, /const rhrSustainedRed = rhrDelta != null && rhrDelta >= (\d+);/, 'rhrSustainedRed')[1],
      );
      within(elevated, [lo, hi], 'rhrElevated threshold');
      within(sustained, [lo, hi], 'rhrSustainedRed threshold');
      if (sustained < elevated) {
        throw new Error(`rhrSustainedRed (${sustained}) fires before rhrElevated (${elevated}) · escalation order is backwards`);
      }
    },
  },

  {
    id: 'INJURY.walk-run-ladder-is-encoded-verbatim',
    binds: ['lib/plan/injury-protocols.ts#WALK_RUN_LADDER'],
    doc: 'Research/05-injury-return-protocols.md',
    anchor: '**Generic walk-run progression template (8 stages)**',
    claim:
      'The 8-stage walk-run re-entry ladder is one specific table, not a formula, and the ' +
      'engine carries it stage-for-stage: run minutes, walk minutes, repeats and total run time ' +
      'per stage, read straight off doctrine\'s own numbers. Where a stage\'s sessions/wk is a ' +
      'band ("3-4"), the engine holds the low end — the conservative reading doctrine\'s own ' +
      '"spend at least 2 sessions before progressing" caution calls for.',
    check({ cite }) {
      const t = cite.table();
      if (t.rows.length !== WALK_RUN_LADDER.length) {
        throw new Error(`doctrine's walk-run table has ${t.rows.length} stages, engine has ${WALK_RUN_LADDER.length}`);
      }
      for (const stage of WALK_RUN_LADDER) {
        const row = t.rows[stage.stage - 1];
        if (Number(row['Stage']) !== stage.stage) {
          throw new Error(`walk-run stage ${stage.stage} is out of order in the doctrine table`);
        }
        // Stage 8 is written as a continuous block ("25-30 (continuous)",
        // "—" for walk/repeats) rather than discrete run-walk intervals.
        if (!/\d/.test(row['Repeats'])) {
          within(stage.runMin, parseBand(row['Run (min)']), `WALK_RUN_LADDER stage ${stage.stage} run minutes`);
          if (!stage.continuous) {
            throw new Error(`stage ${stage.stage} is doctrine's continuous stage but the engine does not mark it continuous`);
          }
          continue;
        }
        within(stage.runMin, parseBand(row['Run (min)']), `WALK_RUN_LADDER stage ${stage.stage} run minutes`);
        within(stage.walkMin, parseBand(row['Walk (min)']), `WALK_RUN_LADDER stage ${stage.stage} walk minutes`);
        within(stage.repeats, parseBand(row['Repeats']), `WALK_RUN_LADDER stage ${stage.stage} repeats`);
        within(stage.totalRunMin, parseBand(row['Total run time']), `WALK_RUN_LADDER stage ${stage.stage} total run minutes`);
        const sessBand = parseBand(row['Sessions/wk']);
        within(stage.sessionsPerWk, sessBand, `WALK_RUN_LADDER stage ${stage.stage} sessions/wk`);
        if (sessBand[0] !== sessBand[1] && stage.sessionsPerWk !== sessBand[0]) {
          throw new Error(
            `stage ${stage.stage} sessions/wk should hold the doctrine band's low end ` +
              `(${sessBand[0]}), engine has ${stage.sessionsPerWk}`,
          );
        }
      }
    },
  },

  {
    id: 'INJURY.walk-run-is-priced-at-the-runners-own-easy-pace',
    binds: [
      'lib/plan/injury-builder.ts#WALK_RUN_MIN_PER_MI',
      'lib/plan/injury-builder.ts#injuryWeekShape',
      'lib/plan/injury-builder.ts#MAX_ACTIVE_DAYS_PER_WEEK',
    ],
    doc: 'Research/05-injury-return-protocols.md',
    anchor: '**Generic walk-run progression template (8 stages)**',
    claim:
      'The walk-run ladder is written in MINUTES and the plan schema carries MILES, so a pace ' +
      'has to convert between them — and doctrine states that pace by CATEGORY only: §1.1 ' +
      '"Pace: easy/conversational only". A single hard-coded minutes-per-mile is therefore one ' +
      'runner\'s easy pace applied to everybody, and it decides how much running load every ' +
      'injured runner is booked for: at a fixed 11:00/mi a 15:00/mi runner\'s stage-1 session ' +
      'was over-booked by 36%, into every volume and ACWR reader downstream, for the population ' +
      'most at risk. `injuryWeekShape` must therefore accept the runner\'s own easy pace, and ' +
      'the constant may only be the fallback. The same file\'s frequency cap must also honour a ' +
      'stated weekly_frequency BELOW its default, which is what its own doc says it does.',
    check({ cite }) {
      const text = cite.text();
      if (!/easy\s*\/\s*conversational only/i.test(text)) {
        throw new Error(
          'Research/05 §1.1 no longer states the walk-run pace as "easy/conversational only" · ' +
            're-read the section and re-anchor this claim',
        );
      }
      const src = sourceOf('web-v2/lib/plan/injury-builder.ts');
      // The runner's own pace reaches the sizing.
      matchLiteral(
        src,
        /easyPaceSecPerMi\?: number \| null,/,
        'injuryWeekShape takes the runner\'s own easy pace',
      );
      matchLiteral(
        src,
        /easyPaceSecPerMi != null && easyPaceSecPerMi > 0/,
        'the walk-run distance is priced at the runner\'s pace when there is one',
      );
      // And the stated frequency is believed all the way down.
      const gate = Number(
        matchLiteral(
          src,
          /Number\(freqRow\.f\) >= (\d+) && Number\(freqRow\.f\) <= 7/,
          'injury-plan weekly_frequency gate',
        )[1],
      );
      if (gate > 1) {
        throw new Error(
          `an injured runner's stated weekly_frequency is discarded below ${gate} days/wk · ` +
            'the file\'s own MAX_ACTIVE_DAYS_PER_WEEK doc says "a stated weekly_frequency below ' +
            'this still wins", and falling back to the default schedules them MORE active days, ' +
            'not fewer',
        );
      }
    },
  },

  {
    id: 'STRENGTH.phase-frequency-cap-matches-the-matrix',
    binds: [
      'lib/coach/strength-recommender.ts#phaseFrequencyCap',
      'lib/coach/strength-recommender.ts#LAST_HEAVY_DAYS_BEFORE_RACE',
    ],
    doc: 'Research/07-strength-programming.md',
    anchor: '### 2.1 Phase × variable matrix',
    claim:
      'The strength macrocycle runs inverse to the run macrocycle, and doctrine states its own ' +
      'per-phase session cap and heavy-lift cutoff as one matrix, not scattered numbers: base ' +
      'and build hold 2-3 and 2 sessions/wk, peak drops to 1-2 (maintenance only), taper drops ' +
      'to a single session and stops heavy loading 7-10 days out, race week stops entirely. The ' +
      'engine reads each phase\'s cap off this table — still gated behind #27\'s dormant ' +
      'strength_days_per_week column for off-season, flagged in the code, not here.',
    check({ cite }) {
      const t = cite.table();
      const band = (row: string, col: string) => parseBand(t.cell(row, col));
      const src = sourceOf('web-v2/lib/coach/strength-recommender.ts');

      const buildCap = Number(
        matchLiteral(
          src,
          /phase === 'QUALITY' \|\| phase === 'BUILD' \|\| phase === 'BASE'\) return (\d);/,
          'phaseFrequencyCap BUILD/BASE',
        )[1],
      );
      within(buildCap, band('Sessions/wk', 'Build'), 'phaseFrequencyCap BUILD/BASE');

      const taperCap = Number(
        matchLiteral(src, /if \(phase === 'TAPER'\) return (\d);/, 'phaseFrequencyCap TAPER')[1],
      );
      within(taperCap, band('Sessions/wk', 'Taper'), 'phaseFrequencyCap TAPER');

      const peakCap = Number(
        matchLiteral(src, /phase === 'RACE-SPECIFIC'\) return (\d);/, 'phaseFrequencyCap PEAK')[1],
      );
      within(peakCap, band('Sessions/wk', 'Peak'), 'phaseFrequencyCap PEAK (RACE-SPECIFIC)');

      const maintCap = Number(
        matchLiteral(src, /mode === 'maintenance'\) return (\d);/, 'phaseFrequencyCap off-season/maintenance')[1],
      );
      within(maintCap, band('Sessions/wk', 'Off-season'), 'phaseFrequencyCap off-season/maintenance');

      const [rwLo, rwHi] = band('Sessions/wk', 'Race week');
      if (rwLo !== 0 || rwHi !== 0) {
        throw new Error('doctrine no longer prescribes 0 strength sessions in race week');
      }
      matchLiteral(src, /raceCtx\.kind === 'race_week'\) return 0;/, 'phaseFrequencyCap race week');

      const heavyBand = parseBand(t.cell('Last heavy session', 'Taper'));
      const heavyVal = Number(
        matchLiteral(src, /const LAST_HEAVY_DAYS_BEFORE_RACE = (\d+);/, 'LAST_HEAVY_DAYS_BEFORE_RACE')[1],
      );
      within(heavyVal, heavyBand, 'LAST_HEAVY_DAYS_BEFORE_RACE');
    },
  },

  {
    id: 'FUELING.race-carb-rate-by-distance',
    binds: ['lib/race/distance-doctrine.ts#RACE_CARB_G_PER_HR'],
    doc: 'Research/18-fueling-products.md',
    anchor: '## 11. During-Race Fueling Protocols by Distance',
    claim:
      'On-course carbohydrate intake is prescribed BY DISTANCE, not one flat number for every ' +
      'race: 5K takes none, 10K takes 0-30 g/hr in the last third only, the half sits at 30-60, ' +
      'and the marathon (and 50K) sit at 60-90. This is the fix for the defect fueling.ts\'s own ' +
      'header names — a flat DEFAULT_RACE_TARGET_G_PER_HR = 75 used to be applied to every ' +
      'distance, roughly doubling the half\'s prescription past the point doctrine calls a ' +
      'GI-distress threshold.',
    check({ cite }) {
      const t = cite.table();
      for (const cat of CATS) {
        const row = DOC_ROW[cat];
        const docBand = parseBand(t.cell(row, 'CHO/hr target'));
        const eng = RACE_CARB_G_PER_HR[cat];
        within(eng.targetGPerHr, docBand, `RACE_CARB_G_PER_HR.${cat}.targetGPerHr`);
        within(eng.bandGPerHr[0], docBand, `RACE_CARB_G_PER_HR.${cat}.bandGPerHr low`);
        within(eng.bandGPerHr[1], docBand, `RACE_CARB_G_PER_HR.${cat}.bandGPerHr high`);
      }
    },
  },

  /* ══════════════════════════════════════════════════════════════════════════
   * DOSING · Daniels' weekly quality caps.
   *
   * `Research/01-pace-zones-vdot.md` §"Dosing rules — Daniels' caps" is a
   * five-column table, and the engine had only ever read one of the columns.
   * `AT_PACE_WEEKLY_SHARE_CAP` encodes the SINGLE-WORKOUT percentages, cited to
   * Research/04's per-workout field tables and bound by the three
   * PROGRESSION.*-volume-cap claims above. Nothing read the "Weekly cap"
   * column, nothing read the marathon row at all, and nothing read the absolute
   * cumulative ceilings in the I and R cells.
   *
   * The three claims below bind what `lib/plan/dosing.ts` reads — the NUMBERS.
   * They landed when the module was a detector; since DOCTRINE-DOSING-2
   * (2026-08-18) the engine also OBEYS them: `applyDosingCaps` clamps at
   * authoring inside `finalizeComposedPlan`, `validateComposedPlan` §10 makes
   * any surviving enforced breach fatal, and the full-matrix measurement
   * (2026-08-28, `_dosing_sweep_gate.test.ts`) holds the corpus at zero.
   * DOSING.enforced-findings-bind-the-composer below is the claim on that
   * behaviour; these three stay about the numbers.
   * ═════════════════════════════════════════════════════════════════════════ */
  {
    id: 'DOSING.weekly-cap-column',
    binds: [
      'lib/plan/dosing.ts#weeklyShareCap',
      'lib/prescription/levers.ts#AT_PACE_WEEKLY_SHARE_CAP',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: "### Dosing rules — Daniels' caps",
    claim:
      'T, I and R each carry a WEEKLY cap as well as a per-workout one, and Research/01 states ' +
      'both at the same percentage of weekly mileage. The engine keeps one constant for both ' +
      'readings, so this claim checks that constant against the weekly column — if a future doc ' +
      'edit ever separates the two numbers, one constant will stop being able to serve both.',
    check({ cite }) {
      const t = cite.table();
      // Read the WEEKLY column, not the single-workout column the PROGRESSION
      // claims already read. Same numbers today; different assertions.
      for (const [pace, family] of [
        ['T', 'threshold'],
        ['I', 'interval'],
        ['R', 'repetition'],
      ] as const) {
        const band = parsePctBand(t.cell(pace, 'Weekly cap'));
        const engine = weeklyShareCap(pace);
        if (engine == null) {
          throw new Error(`weeklyShareCap('${pace}') is null, but doctrine states a weekly cap`);
        }
        within(engine, band, `${pace} weekly dosing cap`);
        // And the single-workout column must still agree, since one constant
        // serves both readings.
        within(AT_PACE_WEEKLY_SHARE_CAP[family], parsePctBand(t.cell(pace, 'Single-workout cap')),
          `${pace} single-workout dosing cap`);
      }
    },
  },
  {
    id: 'DOSING.marathon-pace-workout-ceiling',
    binds: ['lib/plan/dosing.ts#MARATHON_PACE_WORKOUT_CAP', 'lib/plan/dosing.ts#weeklyShareCap'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: "### Dosing rules — Daniels' caps",
    claim:
      'One marathon-pace workout is capped at the LESSER of 18 miles and 20% of weekly mileage, ' +
      'so a 100 mi/wk runner is held to 18 rather than 20. Doctrine states no WEEKLY cap for M ' +
      'at all, and the engine records that silence as null rather than inventing a number.',
    check({ cite }) {
      const t = cite.table();
      const cell = t.cell('M', 'Single-workout cap');
      const m = matchLiteral(cell, /lesser of (\d+) mi or (\d+)% of weekly mi/i, 'M single-workout cap');
      within(MARATHON_PACE_WORKOUT_CAP.absMi, [Number(m[1]), Number(m[1])], 'M absolute workout ceiling');
      within(
        MARATHON_PACE_WORKOUT_CAP.pctOfWeekly * 100,
        [Number(m[2]), Number(m[2])],
        'M workout share of weekly mi',
      );
      // The weekly cell reads "n/a". If a doc edit ever gives M a weekly cap,
      // this fails and the engine has to grow one rather than silently ignore it.
      const weekly = t.cell('M', 'Weekly cap').trim().toLowerCase();
      if (weekly !== 'n/a') {
        throw new Error(
          `Research/01 now states a weekly cap for M ("${weekly}"), but weeklyShareCap('M') is null`,
        );
      }
      if (weeklyShareCap('M') !== null) {
        throw new Error("weeklyShareCap('M') invents a weekly cap doctrine does not state");
      }
    },
  },
  {
    id: 'DOSING.cumulative-ceilings',
    binds: ['lib/plan/dosing.ts#CUMULATIVE_CEILING_KM'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: "### Dosing rules — Daniels' caps",
    claim:
      'I and R carry absolute cumulative ceilings — 10K and 8K of at-pace work — on top of their ' +
      'percentages. These bind where a share cap stops protecting anyone: 8% of a 100 mi week ' +
      'would allow eight miles of VO2 work, which the 10K ceiling forbids.',
    check({ cite }) {
      const t = cite.table();
      for (const pace of ['I', 'R'] as const) {
        const km = Number(
          matchLiteral(
            t.cell(pace, 'Single-workout cap'),
            /max (\d+)K cumulative/i,
            `${pace} cumulative ceiling`,
          )[1],
        );
        const engine = CUMULATIVE_CEILING_KM[pace];
        if (engine == null) {
          throw new Error(`CUMULATIVE_CEILING_KM.${pace} is absent, but doctrine states ${km}K`);
        }
        within(engine, [km, km], `${pace} cumulative at-pace ceiling (km)`);
      }
      // T and M state no cumulative ceiling · the engine must not invent one.
      for (const pace of ['T', 'M'] as const) {
        if (CUMULATIVE_CEILING_KM[pace] != null) {
          throw new Error(`CUMULATIVE_CEILING_KM.${pace} invents a ceiling doctrine does not state`);
        }
      }
    },
  },

  /**
   * 2026-08-21 · THE THIRD BUCKET. `INTENSITY.non-easy-remainder` binds
   * Research/00a's TID table, which is a TWO-way split above Z1: threshold and
   * hard. `DOSING.weekly-cap-column` binds each pace's individual ceiling.
   * Between them sits the sentence Research/01 puts directly under the caps
   * table, and it is the only place in the corpus that GROUPS them:
   *
   *   "Polarized distribution Daniels recommends: 70–80% E, 10–15% M+T,
   *    10–15% I+R."
   *
   * The engine measures two buckets — easy and quality — so it can satisfy
   * every per-pace cap and every TID row and still author a week whose M+T
   * group is nowhere near where Daniels puts it. This claim closes that by
   * requiring the ceilings the engine DOES carry to fit inside the groups, and
   * by requiring the easy floor to be a distribution Daniels recognises rather
   * than a number beside one.
   *
   * It also records, rather than hides, that doctrine says two things here.
   * The caps table's Weekly-cap column reads "n/a" for M, and
   * `DOSING.marathon-pace-workout-ceiling` REQUIRES the engine to record that
   * silence as null. This sentence bounds M anyway, in a group. The engine
   * implements the table and not the sentence; the exemption below says so.
   */
  {
    id: 'DOSING.daniels-three-bucket-distribution',
    binds: [
      'lib/prescription/levers.ts#AT_PACE_WEEKLY_SHARE_CAP',
      'lib/plan/intensity-distribution.ts#EASY_SHARE_FLOOR',
      'lib/plan/dosing.ts#weeklyShareCap',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: 'Polarized distribution Daniels recommends:',
    claim:
      'Daniels splits a week three ways, not two: easy, the marathon-and-threshold group, and ' +
      'the interval-and-repetition group, each with its own band. The engine only ever measures ' +
      'easy against everything-else, so the per-pace caps have to be grouped Daniels\' way and ' +
      'checked against his bands — a week can honour every individual cap, clear the easy floor, ' +
      'and still put its quality in the wrong two-thirds of the distribution.',
    check({ cite, exempt }) {
      // All three bands read out of the sentence itself, in the order it states
      // them: E, then M+T, then I+R.
      const bands = parseBands(cite.section[0]).map(([lo, hi]) => [lo / 100, hi / 100] as const);
      if (bands.length !== 3) {
        throw new Error(
          `the polarized-distribution sentence now states ${bands.length} bands, not the three ` +
            'this claim groups the engine into · re-read it before touching anything',
        );
      }
      const [easyBand, mtBand, irBand] = bands;

      // 1 · The easy floor has to BE a distribution Daniels recognises.
      if (EASY_SHARE_FLOOR < easyBand[0] - 1e-9 || EASY_SHARE_FLOOR > easyBand[1] + 1e-9) {
        throw new Error(
          `EASY_SHARE_FLOOR is ${EASY_SHARE_FLOOR}, outside Daniels' easy band ` +
            `${easyBand[0]}-${easyBand[1]} · the engine's floor is not a polarized week`,
        );
      }

      // 2 · I+R. Both members carry a weekly cap, so the group's ceiling is
      // the sum of them and it must fit inside the group's band.
      const irCeiling = AT_PACE_WEEKLY_SHARE_CAP.interval + AT_PACE_WEEKLY_SHARE_CAP.repetition;
      if (irCeiling > irBand[1] + 1e-9) {
        throw new Error(
          `the I and R weekly caps sum to ${(irCeiling * 100).toFixed(1)}% of a week, past ` +
            `Daniels' I+R ceiling of ${(irBand[1] * 100).toFixed(0)}%`,
        );
      }

      // 3 · M+T. T carries a weekly cap; M's is null by doctrine's own silence.
      const tCeiling = AT_PACE_WEEKLY_SHARE_CAP.threshold;
      if (tCeiling > mtBand[1] + 1e-9) {
        throw new Error(
          `the T weekly cap alone is ${(tCeiling * 100).toFixed(1)}% of a week, past Daniels' ` +
            `M+T ceiling of ${(mtBand[1] * 100).toFixed(0)}% before a single marathon-pace mile is added`,
        );
      }
      if (weeklyShareCap('M') === null && !exempt('m-weekly-share-is-unbounded')) {
        throw new Error(
          'nothing caps weekly marathon-pace volume, so the M+T group cannot be held to ' +
            `${(mtBand[0] * 100).toFixed(0)}-${(mtBand[1] * 100).toFixed(0)}% of a week`,
        );
      }

      // 4 · The two doctrine statements have to be able to hold at once. What
      // the easy floor leaves must cover what the engine's own ceilings spend.
      const spend = tCeiling + irCeiling;
      const remainder = 1 - EASY_SHARE_FLOOR;
      if (spend > remainder + 1e-9) {
        throw new Error(
          `the engine's weekly caps allow ${(spend * 100).toFixed(1)}% of a week above easy, ` +
            `but its own easy floor leaves ${(remainder * 100).toFixed(1)}% · a week can satisfy ` +
            'the caps and break the floor with both gates green',
        );
      }
    },
    exempt: {
      'm-weekly-share-is-unbounded':
        'Research/01 says two things about marathon pace and the engine implements one of them. ' +
        'The caps table\'s Weekly-cap column reads "n/a" for M, and DOSING.marathon-pace-workout-' +
        'ceiling requires weeklyShareCap(\'M\') to stay null so the engine cannot invent a ceiling ' +
        'doctrine does not state. This sentence bounds M anyway, inside the M+T group. Both cannot ' +
        'be satisfied by a constant, because the fix is not a constant: the engine measures easy ' +
        'against everything-else and has no notion of the M bucket at all, so there is nothing to ' +
        'cap. Closing this means intensity-distribution.ts growing a three-bucket split, which is ' +
        'engine work and not a number. Delete this entry when it does.',
    },
  },

  // ══ DISTANCE · which doctrine row a race is ═══════════════════════════════
  //
  // 2026-08-18. Every per-distance claim above reads a ROW. Nothing checked
  // which row a given race gets — and the app carried three incompatible
  // answers, so a 15-mile race trained as a half and raced as a marathon, and
  // a distance-unknown race silently received the half's whole race morning.
  {
    id: 'DISTANCE.category-boundaries',
    binds: ['lib/race/distance-category.ts#DISTANCE_CATEGORY_MAX_MI'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '### 5.1 Daniels VDOT Equivalence (selected fitness levels)',
    claim:
      'Doctrine publishes race ROWS, not boundaries: the equivalence table names 5K, 10K, 15K, ' +
      '10mi, Half and Marathon and says nothing about where one row stops applying. So every ' +
      'named distance must land in a category, the categories must not go backwards along the ' +
      'ladder, and where two adjacent named distances fall in different categories the boundary ' +
      'between them must sit exactly halfway between the two — the stated convention, checkable ' +
      'against the doc rather than against itself.',
    check({ cite }) {
      const ladder = cite
        .table()
        .headers.map((h) => ({ label: h, mi: distanceMiFromLabel(h) }))
        .filter((x): x is { label: string; mi: number } => x.mi != null)
        .sort((a, b) => a.mi - b.mi);
      if (ladder.length < 5) {
        throw new Error(
          `DOCTRINE · only ${ladder.length} named distances parsed out of the §5.1 header ` +
            `(${cite.table().headers.join(' | ')}) · the equivalence table has been reshaped`,
        );
      }
      const catOf = (mi: number) => {
        const c = distanceCategoryOrNull(mi);
        if (c == null) throw new Error(`no category for the doctrine distance ${mi} mi`);
        return c;
      };
      for (let i = 1; i < ladder.length; i++) {
        const [a, b] = [ladder[i - 1], ladder[i]];
        const [ca, cb] = [catOf(a.mi), catOf(b.mi)];
        const [ia, ib] = [DISTANCE_CATEGORIES.indexOf(ca), DISTANCE_CATEGORIES.indexOf(cb)];
        if (ib < ia) {
          throw new Error(
            `the categorizer goes BACKWARDS: ${a.label} (${a.mi} mi) is '${ca}' but the longer ` +
              `${b.label} (${b.mi} mi) is '${cb}'`,
          );
        }
        if (ib === ia) continue;
        if (ib !== ia + 1) {
          throw new Error(
            `${a.label} is '${ca}' and the next named distance ${b.label} is '${cb}' · the ` +
              `categorizer skips a whole doctrine row between two adjacent published distances`,
          );
        }
        const midpoint = (a.mi + b.mi) / 2;
        const boundary = DISTANCE_CATEGORY_MAX_MI[ca];
        if (Math.abs(boundary - midpoint) > 0.005) {
          throw new Error(
            `the '${ca}'|'${cb}' boundary is ${boundary} mi · doctrine's own adjacent distances ` +
              `are ${a.label} (${a.mi}) and ${b.label} (${b.mi}), whose midpoint is ` +
              `${midpoint.toFixed(3)}. Either move the boundary or state a new convention.`,
          );
        }
      }
    },
  },
  {
    id: 'DISTANCE.threshold-class-floor',
    binds: ['lib/race/distance-category.ts#DISTANCE_CATEGORY_MAX_MI'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Pace conversion from a race time',
    claim:
      'Threshold pace is anchored to "half-marathon pace to 15K pace", so doctrine treats the ' +
      '15K and the half as ONE lactate-threshold class — a 15K and a 10-miler are ' +
      'half-marathon-class races. Interval pace is anchored to 3K-5K, a different class. The ' +
      'categorizer must put the 15K with the half, and must not put the 5K there.',
    check({ cite }) {
      const t = cite.table();
      const milesIn = (cell: string): number[] =>
        [...cell.matchAll(/(\d+(?:\.\d+)?\s*K|half[- ]marathon|marathon|mile)/gi)]
          .map((m) => distanceMiFromLabel(m[1].replace(/\s+/g, '')))
          .filter((x): x is number => x != null);

      const tRace = milesIn(t.cell('T', 'Relationship'));
      if (tRace.length < 2) {
        throw new Error(
          `DOCTRINE · the T row no longer names two race distances: "${t.cell('T', 'Relationship')}"`,
        );
      }
      const tCats = new Set(tRace.map((mi) => distanceCategoryOrNull(mi)));
      if (tCats.size !== 1 || tCats.has(null)) {
        throw new Error(
          `doctrine anchors T to ${tRace.join(' mi and ')} mi as one class, but the categorizer ` +
            `splits them across ${[...tCats].join(', ')}`,
        );
      }
      const iRace = Math.max(...milesIn(t.cell('I', 'Relationship')));
      const iCat = distanceCategoryOrNull(iRace);
      if (iCat != null && tCats.has(iCat)) {
        throw new Error(
          `doctrine anchors I to ${iRace} mi and T to a longer class, but the categorizer puts ` +
            `both in '${iCat}' · the VO2max race and the threshold race are the same row`,
        );
      }
    },
  },
  {
    id: 'DISTANCE.ultra-floor',
    binds: ['lib/race/distance-category.ts#DISTANCE_CATEGORY_MAX_MI'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 10.1 Carb loading — by distance',
    claim:
      'The ultra row names its own floor: doctrine writes it "Ultra (50K+)". So the marathon ' +
      'row runs up to 50 km and 50 km itself is an ultra. Both old categorizers cut at a flat ' +
      '30 miles, a number that appears nowhere in Research/.',
    check({ cite }) {
      const label = cite.table().rows.map((r) => r[cite.table().headers[0]]).find((l) => /ultra/i.test(l));
      if (!label) throw new Error('DOCTRINE · §10.1 no longer has an ultra row');
      const token = matchLiteral(label, /(\d+\s*K)\b/i, 'the ultra row\'s own distance floor')[1];
      const floorMi = distanceMiFromLabel(token.replace(/\s+/g, ''));
      if (floorMi == null) throw new Error(`DOCTRINE · cannot resolve the ultra floor "${token}" to miles`);
      // The doc says "50K". The codebase holds that distance at two legitimate
      // precisions — the label parser rounds km->mi to 2 dp (31.07) and
      // sim-constants keeps full precision to match native (31.0686) — so the
      // ceiling is asserted within one parser-rounding step, and then EVERY
      // representation of 50 km is required to classify as an ultra. That is
      // stronger than byte-equality against one of them, and it is what caught
      // a 50K from the simulator grading as a marathon.
      within(DISTANCE_CATEGORY_MAX_MI.m, [floorMi - 0.01, floorMi], `the marathon row's ceiling (doctrine: ${label})`);
      for (const repr of [floorMi, 50 / 1.609344]) {
        if (distanceCategoryOrNull(repr) !== 'ultra') {
          throw new Error(`a ${repr} mi race (50 km) is not categorized as an ultra, but doctrine calls it one`);
        }
      }
      if (distanceCategoryOrNull(floorMi - 0.01) !== 'm') {
        throw new Error(`a race just under ${floorMi} mi is not marathon-class · the floor is in the wrong place`);
      }
    },
  },

  // ══ RACE DAY · the per-distance execution tables ══════════════════════════
  //
  // 2026-08-18 · these eight tables were invisible to the doctrine lint for
  // two months. They are declared `Readonly<Record<RaceDistanceCategory, …>>`,
  // and the lint's scanner required the literal `Record<DistCategory,` right
  // after the colon — wrong wrapper AND wrong type name, so all three of its
  // checks missed every one. The scanner was widened; these are the claims the
  // widening then demanded.
  {
    id: 'RACEDAY.opening-allowance',
    binds: ['lib/race/distance-doctrine.ts#RACE_OPENING_ALLOWANCE'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | First-mile target vs. goal pace | Rationale |',
    claim:
      'How much slower than goal pace the first mile runs is set per distance: a 5K opens ' +
      'essentially at goal pace, a marathon 10-20 s/mi slower. Each row\'s stored band must be ' +
      'the doctrine band, and what the engine actually prescribes must sit inside it.',
    check({ cite }) {
      const t = cite.table();
      const col = 'First-mile target vs. goal pace';
      const docRow: Partial<Record<DistCategory, string>> = {
        '5k': '5K', '10k': '10K', hm: 'Half marathon', m: 'Marathon',
      };
      for (const cat of CATS) {
        const row = RACE_OPENING_ALLOWANCE[cat];
        if (cat === 'ultra') {
          // §3.1 has no ultra row. The engine takes the marathon band's
          // conservative end, which is the slowest opener doctrine publishes;
          // assert exactly that rather than letting an invented number pass.
          const m = RACE_OPENING_ALLOWANCE.m;
          if (row.firstMileBandSPerMi[0] !== m.firstMileBandSPerMi[0]
            || row.firstMileBandSPerMi[1] !== m.firstMileBandSPerMi[1]) {
            throw new Error('the ultra opening band is not the marathon band · §3.1 publishes no ultra row to justify a different one');
          }
          if (row.firstMileSPerMi !== m.firstMileBandSPerMi[1]) {
            throw new Error('the ultra opens somewhere other than the conservative end of the marathon band');
          }
          continue;
        }
        const band = signedBand(t.cell(docRow[cat]!, col));
        within(row.firstMileBandSPerMi[0], band, `RACE_OPENING_ALLOWANCE.${cat} band floor`);
        within(row.firstMileBandSPerMi[1], band, `RACE_OPENING_ALLOWANCE.${cat} band ceiling`);
        within(row.firstMileSPerMi, band, `RACE_OPENING_ALLOWANCE.${cat} prescribed first mile`);
      }
    },
  },
  {
    id: 'RACEDAY.hr-ceilings',
    binds: [
      'lib/race/distance-doctrine.ts#RACE_HR_PCT_LTHR',
      'lib/race/distance-doctrine.ts#RACE_HR_PCT_MAX',
    ],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | %HRmax | %LTHR |',
    claim:
      'The heart rate a race can be held at falls as the race lengthens: a 5K sits above ' +
      'threshold, a marathon well under it. Both the %LTHR and the %HRmax column must match ' +
      'the row for the distance — the shipped defect was the half\'s LTHR+3 handed to ' +
      'marathoners, who blew up with the trigger reading fine.',
    check({ cite }) {
      const t = cite.table();
      const docRow: Partial<Record<DistCategory, string>> = {
        '5k': '5K', '10k': '10K', hm: 'Half', m: 'Marathon',
      };
      for (const cat of CATS) {
        if (cat === 'ultra') {
          // §6.1 publishes no ultra row · the engine holds the marathon's,
          // the lowest ceiling doctrine states. Assert it is exactly that.
          for (const [name, table] of [['LTHR', RACE_HR_PCT_LTHR], ['HRmax', RACE_HR_PCT_MAX]] as const) {
            if (table.ultra[0] !== table.m[0] || table.ultra[1] !== table.m[1]) {
              throw new Error(`the ultra %${name} ceiling is not the marathon's · §6.1 has no ultra row to source a different one`);
            }
          }
          continue;
        }
        const lthr = parsePctBand(t.cell(docRow[cat]!, '%LTHR'));
        const hrmax = parsePctBand(t.cell(docRow[cat]!, '%HRmax'));
        within(RACE_HR_PCT_LTHR[cat][0], lthr, `RACE_HR_PCT_LTHR.${cat} floor`);
        within(RACE_HR_PCT_LTHR[cat][1], lthr, `RACE_HR_PCT_LTHR.${cat} ceiling`);
        within(RACE_HR_PCT_MAX[cat][0], hrmax, `RACE_HR_PCT_MAX.${cat} floor`);
        within(RACE_HR_PCT_MAX[cat][1], hrmax, `RACE_HR_PCT_MAX.${cat} ceiling`);
      }
    },
  },
  {
    id: 'RACEDAY.warmup-by-distance',
    binds: ['lib/race/distance-doctrine.ts#RACE_WARMUP'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Race | Total time | Protocol |',
    claim:
      'The shorter the race, the longer the warm-up. Each distance\'s prescribed block must ' +
      'total inside its own doctrine band, and the bands must never rise with distance. The ' +
      'app used to ship the half\'s 45-minute protocol to marathoners.',
    check({ cite }) {
      const t = cite.table();
      const docRow: Partial<Record<DistCategory, string>> = {
        '5k': '5K', '10k': '10K', hm: 'Half', m: 'Marathon',
      };
      let previousCeiling = Infinity;
      for (const cat of CATS) {
        const row = RACE_WARMUP[cat];
        if (cat === 'ultra') {
          // §12.1 has no ultra row; Research/10's volume ladder puts the ultra
          // below the marathon ("walk to start"), so it may share the
          // marathon's band but never exceed it.
          if (row.totalMinBand[1] > RACE_WARMUP.m.totalMinBand[1]) {
            throw new Error('the ultra warm-up runs longer than the marathon\'s · doctrine has it shorter, not longer');
          }
          continue;
        }
        const band = parseBand(t.cell(docRow[cat]!, 'Total time'));
        within(row.totalMinBand[0], band, `RACE_WARMUP.${cat} band floor`);
        within(row.totalMinBand[1], band, `RACE_WARMUP.${cat} band ceiling`);
        within(warmupTotalMin(row), band, `RACE_WARMUP.${cat} prescribed total minutes`);
        if (band[1] > previousCeiling) {
          throw new Error(
            `the ${cat} warm-up band tops out at ${band[1]} min, above the shorter race's ` +
              `${previousCeiling} · "the shorter the race, the longer the warmup" is inverted`,
          );
        }
        previousCeiling = band[1];
      }
    },
  },
  {
    id: 'RACEDAY.carb-load',
    binds: ['lib/race/distance-doctrine.ts#RACE_CARB_LOAD'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 10.1 Carb loading — by distance',
    claim:
      'Race-week carb loading is per distance — no load under 90 minutes, 7-8 g/kg for a half, ' +
      '8-12 for a marathon, the same across a longer window for an ultra. The shipped defect ' +
      'was the HALF row handed to marathoners, under-loaded by about a third. And because the ' +
      'table IS doctrine\'s own partition of races into protocols, no two of its rows may ' +
      'collapse into a single engine category: the engine may be finer than doctrine, never ' +
      'coarser.',
    check({ cite }) {
      const t = cite.table();
      const labelCol = t.headers[0];
      const docRow: Record<DistCategory, string> = {
        '5k': '5K, 10K', '10k': '5K, 10K', hm: 'Half marathon', m: 'Marathon', ultra: 'Ultra (50K+)',
      };
      for (const cat of CATS) {
        const cell = t.cell(docRow[cat], 'Protocol');
        const g = matchLiteral(cell.replace(/[–—]/g, '-'), /(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s*g\/kg/, `${docRow[cat]} g/kg band`);
        const gBand: [number, number] = [Number(g[1]), Number(g[2])];
        const row = RACE_CARB_LOAD[cat];
        within(row.gPerKgBand[0], gBand, `RACE_CARB_LOAD.${cat} g/kg floor`);
        within(row.gPerKgBand[1], gBand, `RACE_CARB_LOAD.${cat} g/kg ceiling`);
        const h = cell.replace(/[–—]/g, '-').match(/(\d+)-(\d+)\s*h/);
        if (h == null) {
          if (row.needsLoad || row.hoursBand != null) {
            throw new Error(`RACE_CARB_LOAD.${cat} prescribes a loading window, but doctrine states none ("${cell}")`);
          }
        } else {
          if (!row.needsLoad || row.hoursBand == null) {
            throw new Error(`doctrine gives ${docRow[cat]} a ${h[1]}-${h[2]}h load, but the engine skips it`);
          }
          within(row.hoursBand[0], [Number(h[1]), Number(h[2])], `RACE_CARB_LOAD.${cat} hours floor`);
          within(row.hoursBand[1], [Number(h[1]), Number(h[2])], `RACE_CARB_LOAD.${cat} hours ceiling`);
        }
      }
      // No two doctrine rows may share an engine category.
      const seen = new Map<string, string>();
      for (const r of t.rows) {
        const label = r[labelCol];
        for (const token of label.split(/[,/]/)) {
          const mi = distanceMiFromLabel(token.replace(/\(.*/, '').trim());
          if (mi == null) continue;
          const cat = distanceCategoryOrNull(mi);
          if (cat == null) throw new Error(`doctrine row "${label}" names ${mi} mi, which the categorizer cannot place`);
          const owner = seen.get(cat);
          if (owner != null && owner !== label) {
            throw new Error(
              `doctrine rows "${owner}" and "${label}" both collapse into the engine's '${cat}' · ` +
                'two different carb-load protocols, one row to serve them',
            );
          }
          seen.set(cat, label);
        }
      }
    },
  },
  {
    id: 'RACEDAY.prerace-meal',
    binds: ['lib/race/distance-doctrine.ts#RACE_PRERACE_MEAL_G_PER_KG'],
    doc: 'Research/18-fueling-products.md',
    anchor: '| Distance | 3-hr meal | 60-min top-up | 15-min top-up |',
    claim:
      'The pre-race breakfast scales with the race: 1 g/kg before a 5K, 3-4 before a marathon. ' +
      'Each row must carry its own doctrine band.',
    check({ cite }) {
      const t = cite.table();
      const docRow: Record<DistCategory, string> = {
        '5k': '5K', '10k': '10K', hm: 'Half marathon', m: 'Marathon', ultra: 'Ultra',
      };
      for (const cat of CATS) {
        const cell = t.cell(docRow[cat], '3-hr meal').replace(/[–—]/g, '-');
        const m = matchLiteral(cell, /\((\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?\s*g\/kg\)/, `${docRow[cat]} pre-race meal`);
        const band: [number, number] = [Number(m[1]), Number(m[2] ?? m[1])];
        within(RACE_PRERACE_MEAL_G_PER_KG[cat][0], band, `RACE_PRERACE_MEAL_G_PER_KG.${cat} floor`);
        within(RACE_PRERACE_MEAL_G_PER_KG[cat][1], band, `RACE_PRERACE_MEAL_G_PER_KG.${cat} ceiling`);
      }
    },
  },
  {
    id: 'RACEDAY.caffeine-schedule',
    binds: [
      'lib/race/distance-doctrine.ts#RACE_CAFFEINE_FRACTIONS',
      'lib/race/distance-doctrine.ts#ULTRA_CAFFEINE_INTERVAL_MIN',
    ],
    doc: 'Research/18-fueling-products.md',
    anchor: '## 11. During-Race Fueling Protocols by Distance',
    claim:
      'Where caffeine goes is per distance and stated as a plan, not a number: pre-race only ' +
      'for a 5K and 10K, one gel mid-race for a half, two named mile marks for a marathon, and ' +
      'hourly — not positional — for an ultra. The engine stores positions as fractions of race ' +
      'distance, so an empty list must mean the doctrine plan has no on-course POSITIONS, and ' +
      'the ultra\'s emptiness must be paired with a real hourly interval.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Caffeine plan';
      const docRow: Record<DistCategory, string> = {
        '5k': '5K', '10k': '10K', hm: 'Half marathon', m: 'Marathon', ultra: '50K',
      };
      for (const cat of CATS) {
        const plan = t.cell(docRow[cat], col);
        const fractions = RACE_CAFFEINE_FRACTIONS[cat];
        if (/^\s*pre-race only\s*$/i.test(plan)) {
          if (fractions.length > 0) {
            throw new Error(`doctrine gives ${docRow[cat]} caffeine pre-race only, but the engine schedules ${fractions.length} on course`);
          }
          continue;
        }
        if (/\/\s*hr\b/i.test(plan)) {
          // Hourly, not positional · the emptiness is the point, and the
          // interval has to exist somewhere or nothing is prescribed at all.
          if (fractions.length > 0) {
            throw new Error(`doctrine gives ${docRow[cat]} an HOURLY caffeine plan, but the engine schedules it by position`);
          }
          if (!(ULTRA_CAFFEINE_INTERVAL_MIN === 60)) {
            throw new Error(`doctrine states ${docRow[cat]} caffeine per HOUR; the engine's interval is ${ULTRA_CAFFEINE_INTERVAL_MIN} min`);
          }
          continue;
        }
        const miles = [...plan.matchAll(/mi\s*(\d+(?:\.\d+)?)/gi)].map((m) => Number(m[1]));
        if (miles.length > 0) {
          const raceMi = distanceMiFromLabel(docRow[cat]);
          if (raceMi == null) throw new Error(`cannot resolve ${docRow[cat]} to miles`);
          if (fractions.length !== miles.length) {
            throw new Error(
              `doctrine names ${miles.length} on-course caffeine positions for ${docRow[cat]} ` +
                `(${plan}); the engine schedules ${fractions.length}`,
            );
          }
          miles.forEach((mi, i) => {
            within(fractions[i] * raceMi, [mi - 0.5, mi + 0.5], `caffeine stop ${i + 1} for the ${cat}`);
          });
          continue;
        }
        // "Pre + 1 caf gel mid-race" · a count and a position word, no mile mark.
        const count = Number(matchLiteral(plan, /(\d+)\s*caf/i, `${docRow[cat]} caffeine gel count`)[1]);
        if (fractions.length !== count) {
          throw new Error(`doctrine gives ${docRow[cat]} ${count} on-course caffeinated gel(s); the engine schedules ${fractions.length}`);
        }
        if (/mid-race/i.test(plan)) {
          within(fractions[0], [0.4, 0.6], `the ${cat}'s mid-race caffeine position`);
        }
      }
    },
  },
  // ══ WORKOUT VOCABULARY · the catalogue agrees with the doc ════════════════
  /**
   * `Research/04-workout-vocabulary.md` names 59 workouts and the engine could
   * produce about a dozen shapes, because session geometry was hardcoded
   * strings at a handful of sites in `lib/plan/generate.ts` rather than
   * selected from a catalogue. `lib/workout-catalogue/` is that catalogue.
   *
   * Every claim below READS THE NUMBERS OUT OF THE DOC and compares the
   * catalogue against them, per Rule 7 — a claim that hardcoded both sides
   * would only prove the catalogue agrees with itself, which is precisely the
   * failure mode a transcribed doc invites.
   *
   * The entry-level citation strings are checked separately, and differently,
   * by `lib/workout-catalogue/_catalogue.test.ts`: it asserts every quoted row
   * is still verbatim text in the file. These claims check the NUMBERS; that
   * test checks the QUOTES.
   */
  {
    id: 'VOCAB.long-run-family',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 4.1 Long-run family overview',
    claim:
      'Each of the five long-run variants carries the distance band §4.1 gives it, and the ' +
      'marathon-pace and fast-finish variants carry the at-pace segment their row states.',
    check({ cite }) {
      const t = cite.table();
      const expectBand = (row: string, slug: string) => {
        const entry = workoutBySlug(slug);
        if (!entry) throw new Error(`catalogue has no ${slug}`);
        const [lo, hi] = parseBand(t.cell(row, 'Distance/duration'));
        if (!entry.session) throw new Error(`${slug} states no session band`);
        // The doc gives the base long run a DURATION band ("90 min – 2:30")
        // and the rest a distance band, so only the distance rows compare.
        if (!/mi/.test(t.cell(row, 'Distance/duration'))) return;
        within(entry.session.min, [Math.min(lo, hi), Math.max(lo, hi)], `${slug} session minimum`);
        within(entry.session.max, [Math.min(lo, hi), Math.max(lo, hi)], `${slug} session maximum`);
      };
      expectBand('Progression long run', 'progression-long-run');
      expectBand('Marathon-pace long run', 'marathon-pace-long-run');
      expectBand('Fast finish long run', 'fast-finish-long-run');

      // The dress rehearsal is checked differently, and the difference is the
      // point. §4.1's overview row gives it "18–22 mi", which is the MARATHON
      // rehearsal; §4.6's own Distance row reads "18–22 mi (marathon); 12–14 mi
      // (HM)", and the catalogue serves both distances. So the catalogue band
      // must CONTAIN the overview band rather than equal it — and it must not
      // reach past it at the top, which is what would signal a real drift.
      const dress = workoutBySlug('dress-rehearsal-long-run')!;
      const [dLo, dHi] = parseBand(t.cell('Dress rehearsal long run', 'Distance/duration'));
      if (dress.session!.min > dLo) {
        throw new Error(
          `dress rehearsal floor is ${dress.session!.min} mi · §4.6 states 12–14 mi for the half, ` +
            'so the catalogue band must reach at least that low',
        );
      }
      within(dress.session!.max, [dHi, dHi], 'dress rehearsal session maximum');

      // The fast-finish row's own at-pace segment, read out of its pace column.
      const ff = matchLiteral(
        t.cell('Fast finish long run', 'Pace structure'),
        /last (\d+)[–-](\d+) mi/,
        'fast-finish at-pace segment',
      );
      const ffEntry = workoutBySlug('fast-finish-long-run')!;
      within(ffEntry.atPace!.min, [Number(ff[1]), Number(ff[1])], 'fast-finish at-pace minimum');
      within(ffEntry.atPace!.max, [Number(ff[2]), Number(ff[2])], 'fast-finish at-pace maximum');
    },
  },
  {
    id: 'VOCAB.long-run-weekly-share',
    binds: ['lib/workout-catalogue/select.ts#LONG_RUN_WEEKLY_SHARE_CAP'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 4.2 Base long run',
    claim:
      'A long run caps at 25-30% of weekly mileage. The selector spends the TOP of that band, ' +
      'and uses it as the bound for every session whose zones carry no Daniels share cap — ' +
      'those are the E/M/MP zones, which is what a long run is run at.',
    check({ cite }) {
      const [lo, hi] = parseBand(
        matchLiteral(cite.text(), /cap at ~?(\d+[–-]\d+)% of weekly mileage/, 'long-run weekly cap')[1],
      );
      within(LONG_RUN_WEEKLY_SHARE_CAP * 100, [lo, hi], 'long-run weekly share cap');
    },
  },
  {
    id: 'VOCAB.threshold-family',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.1 Threshold family overview',
    claim:
      'The four threshold sessions carry the rep counts, rep distances and at-pace volumes ' +
      '§5.1 states for them, and cruise-interval recovery runs one minute per mile of work.',
    check({ cite }) {
      const t = cite.table();

      // Cruise intervals · "3–6 × 1 mi or 2–4 × 2 mi", "4–8 mi" at pace.
      const cruise = workoutBySlug('cruise-intervals')!;
      const volumeCell = t.cell('Cruise intervals (Daniels)', 'Volume');
      const shapes = [...volumeCell.matchAll(/(\d+)[–-](\d+)\s*×\s*(\d+)\s*mi/g)];
      if (shapes.length !== 2) {
        throw new Error(`§5.1 no longer states two cruise shapes: "${volumeCell}"`);
      }
      shapes.forEach((m, i) => {
        const s = cruise.structures[i];
        if (!s || s.kind !== 'reps') throw new Error(`cruise-intervals structure ${i} is not a rep set`);
        within(s.reps.min, [Number(m[1]), Number(m[1])], `cruise shape ${i} minimum reps`);
        within(s.reps.max, [Number(m[2]), Number(m[2])], `cruise shape ${i} maximum reps`);
        within(s.rep.min, [Number(m[3]), Number(m[3])], `cruise shape ${i} rep miles`);
        // "1 min per mi of work" · the recovery scales with the rep length.
        within(
          s.recoverySec!.min,
          [Number(m[3]) * 60, Number(m[3]) * 60],
          `cruise shape ${i} recovery (1 min per mile of work)`,
        );
      });
      const [cvLo, cvHi] = parseBand(t.cell('Cruise intervals (Daniels)', 'Total at-pace'));
      within(cruise.atPace!.min, [cvLo, cvLo], 'cruise at-pace minimum');
      within(cruise.atPace!.max, [cvHi, cvHi], 'cruise at-pace maximum');

      // Continuous tempo · the 3-8 mi distance band beside the minute band.
      const tempo = workoutBySlug('continuous-tempo')!;
      const [tLo, tHi] = parseBand(t.cell('Continuous tempo', 'Volume'));
      within(tempo.atPace!.min, [tLo, tLo], 'continuous tempo distance minimum');
      within(tempo.atPace!.max, [tHi, tHi], 'continuous tempo distance maximum');

      // Sub-threshold · "5–10 × 1K or 4–6 × 2K", 60-90 s recovery.
      const st = workoutBySlug('sub-threshold-intervals')!;
      const stCell = t.cell('Sub-threshold intervals (Norwegian)', 'Volume');
      const stShapes = [...stCell.matchAll(/(\d+)[–-](\d+)\s*×\s*(\d+)K/g)];
      if (stShapes.length === 0) throw new Error(`§5.1 no longer states sub-threshold shapes: "${stCell}"`);
      stShapes.forEach((m, i) => {
        const s = st.structures[i];
        if (!s || s.kind !== 'reps') throw new Error(`sub-threshold structure ${i} is not a rep set`);
        within(s.reps.min, [Number(m[1]), Number(m[1])], `sub-threshold shape ${i} minimum reps`);
        within(s.reps.max, [Number(m[2]), Number(m[2])], `sub-threshold shape ${i} maximum reps`);
        within(s.rep.min, [Number(m[3]), Number(m[3])], `sub-threshold shape ${i} rep km`);
      });
      const [stRLo, stRHi] = parseBand(t.cell('Sub-threshold intervals (Norwegian)', 'Recovery'));
      within(st.structures[0].kind === 'reps' ? st.structures[0].recoverySec!.min : -1, [stRLo, stRLo], 'sub-threshold recovery minimum (s)');
      within(st.structures[0].kind === 'reps' ? st.structures[0].recoverySec!.max : -1, [stRHi, stRHi], 'sub-threshold recovery maximum (s)');

      // Long tempo · 8-12 mi continuous.
      const lt = workoutBySlug('long-tempo')!;
      const [ltLo, ltHi] = parseBand(t.cell('Long tempo', 'Total at-pace'));
      within(lt.atPace!.min, [ltLo, ltLo], 'long tempo at-pace minimum');
      within(lt.atPace!.max, [ltHi, ltHi], 'long tempo at-pace maximum');
    },
  },
  {
    id: 'VOCAB.vo2max-family',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 6.1 VO2max family overview',
    claim:
      'Every VO2max session carries the rep count band and rep distance §6.1 states in its ' +
      'row, for all seven rows of the table.',
    check({ cite }) {
      const t = cite.table();
      const rows: Array<[string, string, number]> = [
        ['Mile repeats (3K/5K)', 'mile-repeats', 1],
        ['1200m repeats', '1200m-repeats', 1200],
        ['1000m repeats', '1000m-repeats', 1],
        ['800m repeats', '800m-repeats', 800],
        ['600m repeats', '600m-repeats', 600],
        ['400m repeats', '400m-repeats', 400],
        ['Yasso 800s', 'yasso-800s', 800],
      ];
      for (const [row, slug, repValue] of rows) {
        const entry = workoutBySlug(slug);
        if (!entry) throw new Error(`catalogue has no ${slug}`);
        const s = entry.structures[0];
        if (s.kind !== 'reps') throw new Error(`${slug} is not a rep set`);
        const cell = t.cell(row, 'Reps × distance');
        const [lo, hi] = parseBand(cell.replace(/×.*$/, ''));
        within(s.reps.min, [lo, lo], `${slug} minimum reps`);
        within(s.reps.max, [hi, hi], `${slug} maximum reps`);
        within(s.rep.min, [repValue, repValue], `${slug} rep length`);
      }
    },
  },
  {
    id: 'VOCAB.speed-family',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 7.1 Speed family overview',
    claim:
      'The four speed sessions carry the rep counts §7.1 states, and the two hill-based ones ' +
      'are prescribed by effort rather than by a clock pace.',
    check({ cite }) {
      const t = cite.table();
      const rows: Array<[string, string]> = [
        ['Strides', 'strides'],
        ['Hill sprints', 'hill-sprints'],
        ['200m repeats', '200m-repeats'],
        ['100m repeats', '100m-repeats'],
      ];
      for (const [row, slug] of rows) {
        const entry = workoutBySlug(slug);
        if (!entry) throw new Error(`catalogue has no ${slug}`);
        const s = entry.structures[0];
        if (s.kind !== 'reps') throw new Error(`${slug} is not a rep set`);
        const [lo, hi] = parseBand(t.cell(row, 'Total'));
        // The CEILING is the overview's and must match exactly.
        within(s.reps.max, [hi, hi], `${slug} maximum reps`);
        // The FLOOR may sit lower, and for the hill sprints it does: §7.1's
        // Total column reads "6–12 reps" while §7.3's own Reps row reads
        // "Start 4–6, build to 8–12". The overview states the built dose; the
        // detail row states where a runner starts, and the catalogue carries
        // the entry point so a first-time runner is not handed the built one.
        // It may never sit ABOVE the overview floor, which is the drift that
        // would matter.
        if (s.reps.min > lo) {
          throw new Error(`${slug} starts at ${s.reps.min} reps, above §7.1's floor of ${lo}`);
        }
      }
      // §7.3's pace column is "Max effort uphill" — a number would be wrong.
      if (!workoutBySlug('hill-sprints')!.effortOnly) {
        throw new Error('hill sprints must be effort-cued · §7.1 gives them "Max effort uphill"');
      }
    },
  },
  {
    id: 'VOCAB.hill-family',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 8.1 Hill family overview',
    claim:
      'The three hill-repeat sessions carry the rep durations and rep counts §8.1 states, and ' +
      'EVERY hill session is prescribed by effort — the table\'s pace column never holds a ' +
      'number, because a flat-ground pace is unreachable on a 4-6% grade.',
    check({ cite }) {
      const t = cite.table();
      const rows: Array<[string, string, 's' | 'min']> = [
        ['Short hill repeats', 'short-hill-repeats', 's'],
        ['Medium hill repeats', 'medium-hill-repeats', 's'],
        ['Long hill repeats', 'long-hill-repeats', 'min'],
      ];
      for (const [row, slug, unit] of rows) {
        const entry = workoutBySlug(slug);
        if (!entry) throw new Error(`catalogue has no ${slug}`);
        const s = entry.structures[0];
        if (s.kind !== 'reps') throw new Error(`${slug} is not a rep set`);
        const [dLo, dHi] = parseBand(t.cell(row, 'Duration'));
        within(s.rep.min, [dLo, dLo], `${slug} rep duration minimum`);
        within(s.rep.max, [dHi, dHi], `${slug} rep duration maximum`);
        if (s.rep.unit !== unit) {
          throw new Error(`${slug} rep unit is ${s.rep.unit}, doctrine states ${unit}`);
        }
        const [rLo, rHi] = parseBand(t.cell(row, 'Reps'));
        within(s.reps.min, [rLo, rLo], `${slug} minimum reps`);
        within(s.reps.max, [rHi, rHi], `${slug} maximum reps`);
      }
      for (const entry of WORKOUT_CATALOGUE.filter((e) => e.family === 'hills')) {
        if (!entry.effortOnly) {
          throw new Error(
            `${entry.slug} carries a clock pace · §8.1's pace column is effort for every row`,
          );
        }
      }
    },
  },
  {
    id: 'VOCAB.variation-rows-are-all-dispositioned',
    binds: ['lib/workout-catalogue/catalogue.ts#VARIATION_LEDGER'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 18. Workout-name lookup index',
    claim:
      'Every "Variations" row in Research/04 has a recorded decision — carried, partial, or out ' +
      'of scope with a reason. The §18 coverage check cannot see these rows at all (§18 lists 42 ' +
      'names; the Variations rows name ~60 more session shapes) and it matches on section rather ' +
      'than on name, so a variant inside a carried section passes trivially. That is how §11.1\'s ' +
      '"modified block for mortals" — the only form of the Canova block this engine can schedule ' +
      '— stayed uncarried while §11.1 read as covered. An absent decision and a considered "no" ' +
      'are indistinguishable until one is written down; this makes writing it down mandatory.',
    check() {
      const lines = sourceOf('Research/04-workout-vocabulary.md').split('\n');
      // Walk the doc for Variations rows, tagging each with the section
      // heading above it, so the ledger is checked against the doc's own
      // current text rather than against a transcription of it.
      const found: Array<{ section: string; row: string }> = [];
      let section = '';
      for (const line of lines) {
        const h = /^#{2,3}\s+(\d+(?:\.\d+)?)\b/.exec(line);
        if (h) section = `§${h[1]}`;
        if (/^\|\s*Variations\s*\|/.test(line)) found.push({ section, row: line.trim() });
      }
      if (found.length < 20) {
        throw new Error(
          `only ${found.length} Variations rows parsed out of Research/04 · the row format has ` +
            'changed and this claim is passing vacuously, which is worse than failing',
        );
      }

      const ledger = new Map(VARIATION_LEDGER.map((v) => [v.row, v]));
      const missing: string[] = [];
      for (const f of found) {
        const hit = ledger.get(f.row);
        if (!hit) {
          missing.push(`${f.section} · ${f.row}`);
          continue;
        }
        if (hit.section !== f.section) {
          throw new Error(
            `VARIATION_LEDGER files this row under ${hit.section} · the doc has it under ${f.section}`,
          );
        }
      }
      if (missing.length > 0) {
        throw new Error(
          `${missing.length} Variations row(s) in Research/04 have no recorded decision:\n  ` +
            missing.join('\n  ') +
            '\n\nAdd each to VARIATION_LEDGER in lib/workout-catalogue/catalogue.ts with a ' +
            'disposition and a reason. "out-of-scope" is a legitimate answer — an unrecorded ' +
            'one is not. If a row changed rather than appeared, re-read the new text before ' +
            're-recording the same verdict against it.',
        );
      }

      // Stale entries: a ledger row the doc no longer carries is a decision
      // about a session that no longer exists, and it hides that the doc moved.
      const docRows = new Set(found.map((f) => f.row));
      const stale = VARIATION_LEDGER.filter((v) => !docRows.has(v.row));
      if (stale.length > 0) {
        throw new Error(
          `VARIATION_LEDGER carries ${stale.length} row(s) Research/04 no longer states:\n  ` +
            stale.map((v) => `${v.section} · ${v.row}`).join('\n  ') +
            '\n\nThe doctrine was edited. Re-read the section and re-record.',
        );
      }

      // Every claim of coverage must name a slug that exists, and every row
      // must carry a reason someone can act on.
      for (const v of VARIATION_LEDGER) {
        if (v.disposition !== 'out-of-scope' && (v.carriedBy ?? []).length === 0) {
          throw new Error(`${v.section} is "${v.disposition}" but names no entry that carries it`);
        }
        for (const slug of v.carriedBy ?? []) {
          if (!WORKOUT_CATALOGUE.some((e) => e.slug === slug)) {
            throw new Error(`${v.section} claims to be carried by "${slug}", which is not in the catalogue`);
          }
        }
        if (v.note.trim().length < 40) {
          throw new Error(`${v.section}'s note is too short to be a reason anyone could act on`);
        }
      }
    },
  },

  {
    id: 'DOWNHILL.eccentric-protocol-is-carried',
    binds: [
      'lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE.downhill-repeats',
      'lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE.downhill-simulation-long-run',
    ],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Eccentric Loading Protocol for Downhill-Heavy Races',
    claim:
      'Downhill running is a session family, not a note. Research/11 prescribes an 8-10 week ' +
      'eccentric-loading protocol with named workouts, grades and rep counts, and the engine ' +
      'carried none of it until 2026-08-29 — all five hill entries climb. The protocol\'s two ' +
      'session-shaped elements (the repeats and the long simulation) are catalogue entries, ' +
      'their rep counts and distances are read out of the doc\'s own block, and the simulation ' +
      'is kept out of the taper because the doc names a late-taper downhill session as a hazard.',
    check({ cite }) {
      const text = cite.section.join('\n');
      const bySlug = (slug: string) => {
        const e = WORKOUT_CATALOGUE.find((w) => w.slug === slug);
        if (!e) {
          throw new Error(
            `the catalogue no longer carries "${slug}" · Research/11's eccentric protocol is a ` +
              'prescription with named sessions, and dropping them returns the engine to ' +
              'appending a sentence to the long run where doctrine states a workout',
          );
        }
        return e;
      };

      // Both entries must cite THIS doc, or the coverage they represent is
      // only nominal — an entry pointing at Research/04 would be validated
      // against headings that do not describe it.
      for (const slug of ['downhill-repeats', 'downhill-simulation-long-run']) {
        const e = bySlug(slug);
        if (e.doc !== 'Research/11-course-specific-training.md') {
          throw new Error(`${slug} must cite Research/11 · it reads "${e.doc ?? 'Research/04 (default)'}"`);
        }
      }

      // The repeats' rep count and distance come out of the doc's own line,
      // parsed rather than restated, so an edit to the protocol fails here.
      const repRow = text.split('\n').find((l) => /×\s*400/.test(l) && /goal race pace/i.test(l));
      if (!repRow) {
        throw new Error(
          'Research/11 no longer states the downhill repeat row ("6-10 × 400-800 m @ ... at goal ' +
            'race pace") · re-read the protocol before trusting the entry built from it',
        );
      }
      const nums = repRow.match(/(\d+)\s*[–-]\s*(\d+)\s*×\s*(\d+)\s*[–-]\s*(\d+)\s*m/);
      if (!nums) throw new Error(`could not parse reps × distance out of "${repRow.trim()}"`);
      const [repsMin, repsMax, distMin, distMax] = nums.slice(1, 5).map(Number);

      const reps = bySlug('downhill-repeats');
      const s = reps.structures[0];
      if (s.kind !== 'reps') throw new Error('downhill-repeats is no longer a rep structure');
      if (s.reps.min !== repsMin || s.reps.max !== repsMax) {
        throw new Error(
          `downhill-repeats runs ${s.reps.min}-${s.reps.max} reps · the doc says ${repsMin}-${repsMax}`,
        );
      }
      if (s.rep.unit !== 'm' || s.rep.min !== distMin || s.rep.max !== distMax) {
        throw new Error(
          `downhill-repeats' rep is ${s.rep.min}-${s.rep.max}${s.rep.unit} · the doc says ${distMin}-${distMax}m`,
        );
      }

      // §Avoid the Late-Taper Trap · a session whose purpose is muscle damage
      // must not be placeable in the window where the damage would still be
      // there on race day. The doc states this as a hazard, not a band, so the
      // phases list is the only place the engine can honour it.
      const sim = bySlug('downhill-simulation-long-run');
      if (sim.phases.includes('taper')) {
        throw new Error(
          'the long downhill simulation is placeable in the taper · Research/11 §"Avoid the ' +
            'Late-Taper Trap" says a heavy downhill session inside ~10 days of the race "risks ' +
            'racing on quads still impaired by EIMD"',
        );
      }

      // Both are marathon/half only. The protocol's rationale is quad failure
      // in the late miles of a long race; a 5K does not run long enough for
      // eccentric damage to decide anything.
      for (const slug of ['downhill-repeats', 'downhill-simulation-long-run']) {
        const e = bySlug(slug);
        for (const d of e.distances) {
          if (d !== 'm' && d !== 'hm') {
            throw new Error(`${slug} is offered for "${d}" · the protocol is written for downhill-heavy marathons and halves`);
          }
        }
      }
    },
  },

  /* ── EFFORT-RAMP-1 · the two rep rows doctrine states as a BUILD ───────────
   *
   * `fits`'s effort-cued branch returned `structure.reps.max` unconditionally,
   * so every hill session in every week of every phase went out at the top of
   * its band: a runner's first hill session of a block was their hardest, and
   * it never got harder because it had opened at the ceiling. §7.3 and §8.2
   * both write the rep count as a progression in as many words, and these two
   * claims hold the engine to the two ends the doc names — the START it opens
   * at and the BUILT dose it arrives at — by reading both out of the doc rather
   * than restating them here.
   *
   * `VOCAB.hill-band-no-build` is the other half, and the more important one:
   * it asserts that the rows which state a plain band carry NO ramp. Doctrine
   * gives §8.3 "6–10" and §8.4 "4–8" with no progression language, and a curve
   * between those ends would be this module's invention, not research.
   */
  {
    id: 'VOCAB.hill-sprint-build',
    binds: [
      'lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE',
      'lib/workout-catalogue/select.ts#rampedReps',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 7.3 Hill sprints',
    claim:
      '§7.3 states the hill-sprint rep count as a progression — "Start 4–6, build to 8–12" — ' +
      'so the session opens the block at the start the doc names and arrives at the built ' +
      'dose it names, rather than being prescribed at the ceiling every week.',
    check({ cite }) {
      assertStatedBuild(cite.table().cell('Reps', 'Prescription'), 'hill-sprints');
    },
  },
  {
    id: 'VOCAB.short-hill-build',
    binds: [
      'lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE',
      'lib/workout-catalogue/select.ts#rampedReps',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 8.2 Short hill repeats (10–30 s)',
    claim:
      '§8.2 states the short-hill rep count as a progression — "8–16 (start 8, build to 16)" — ' +
      'so the session opens at eight reps and climbs to sixteen across the block instead of ' +
      'opening at sixteen.',
    check({ cite }) {
      assertStatedBuild(cite.table().cell('Reps', 'Prescription'), 'short-hill-repeats');
    },
  },
  {
    id: 'VOCAB.hill-band-no-build',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 8.1 Hill family overview',
    claim:
      'A rep count doctrine states as a plain band carries no ramp. §8.3\'s "6–10" and §8.4\'s ' +
      '"4–8" say nothing about building across a block, so those sessions are not ramped — a ' +
      'curve between the ends of a band the doc does not describe as a progression would be ' +
      'the engine\'s invention.',
    check({ cite }) {
      // Every rep-shaped entry in the catalogue, checked against its OWN cited
      // rows. The doc's words decide which side of the line an entry is on, so
      // adding a ramp to an entry whose doctrine states none fails here without
      // anyone having to add it to a list.
      const HAS_BUILD = /\bbuild(?:s|ing)?\s+to\b|\bstart\s+\d/i;
      for (const entry of WORKOUT_CATALOGUE) {
        for (const s of entry.structures) {
          if (s.kind !== 'reps') continue;
          const repsRow = entry.cites.find((c) => /\bReps\b/.test(c) && HAS_BUILD.test(c)) ?? null;
          if (s.repBuild == null && repsRow != null) {
            throw new Error(
              `${entry.slug} cites a rep row stating a build ("${repsRow}") but carries no ` +
                '`repBuild`, so it is prescribed at the top of its band every week',
            );
          }
          if (s.repBuild != null && !HAS_BUILD.test(s.repBuild)) {
            throw new Error(
              `${entry.slug} declares a rep build that states no build: "${s.repBuild}"`,
            );
          }
        }
      }
      // And the two §8.1 rows that are bands: the doc's own cell has no build
      // language, and the engine holds them at the band the doc gives.
      const t = cite.table();
      for (const [row, slug] of [
        ['Medium hill repeats', 'medium-hill-repeats'],
        ['Long hill repeats', 'long-hill-repeats'],
      ] as const) {
        const cell = t.cell(row, 'Reps');
        if (HAS_BUILD.test(cell)) {
          throw new Error(
            `§8.1's "${row}" row now states a build ("${cell}"). Doctrine changed: give ` +
              `${slug} a \`repBuild\` and re-check the ramp, do not relax this claim.`,
          );
        }
        const s = workoutBySlug(slug)!.structures[0];
        if (s.kind !== 'reps') throw new Error(`${slug} is not a rep set`);
        if (s.repBuild != null) {
          throw new Error(`${slug} ramps its reps, and §8.1 states a flat band: "${cell}"`);
        }
        const [lo, hi] = parseBand(cell);
        within(s.reps.min, [lo, lo], `${slug} band floor`);
        within(s.reps.max, [hi, hi], `${slug} band ceiling`);
      }
    },
  },
  {
    id: 'VOCAB.fartlek-family',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 9.1 Fartlek family overview',
    claim:
      'The Mona fartlek is 14 reps over 20 minutes in the 2/4/4/4 pattern §9.1 states, and ' +
      'the catalogue holds every rep of it rather than a summary.',
    check({ cite }) {
      const t = cite.table();
      const structure = t.cell('Mona fartlek', 'Structure');
      const groups = [...structure.matchAll(/(\d+)\s*×\s*(\d+)\s*s/g)];
      if (groups.length !== 4) throw new Error(`§9.1 no longer states four Mona groups: "${structure}"`);
      const mona = workoutBySlug('mona-fartlek')!;
      const s = mona.structures[0];
      if (s.kind !== 'sequence') throw new Error('mona-fartlek is not a sequence');
      const expected = groups.flatMap(([, n, dur]) =>
        Array.from({ length: Number(n) }, () => Number(dur)),
      );
      const actual = s.steps.map((step) => step.value);
      if (expected.join(',') !== actual.join(',')) {
        throw new Error(`Mona steps are ${actual.join('/')}, doctrine states ${expected.join('/')}`);
      }
      const [total] = parseBand(t.cell('Mona fartlek', 'Total duration'));
      within(mona.session!.min, [total, total], 'Mona total duration');
      // Equal float · every step recovers for its own length.
      for (const step of s.steps) {
        within(step.recoverySec ?? -1, [step.value, step.value], 'Mona equal float');
      }
    },
  },
  {
    id: 'VOCAB.cutdown-family',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 12.1 Cutdown family',
    claim:
      'The cutdown sessions carry the rep counts and recovery §12.1 states, including the ' +
      '60-90 s cruise-style rest that distinguishes a cutdown from a rep set.',
    check({ cite }) {
      const t = cite.table();
      const rows: Array<[string, string]> = [
        ['Mile cutdowns', 'mile-cutdowns'],
        ['1K cutdowns', '1k-cutdowns'],
      ];
      for (const [row, slug] of rows) {
        const entry = workoutBySlug(slug);
        if (!entry) throw new Error(`catalogue has no ${slug}`);
        const s = entry.structures[0];
        if (s.kind !== 'reps') throw new Error(`${slug} is not a rep set`);
        const [lo, hi] = parseBand(t.cell(row, 'Reps × distance').replace(/×.*$/, ''));
        within(s.reps.min, [lo, lo], `${slug} minimum reps`);
        within(s.reps.max, [hi, hi], `${slug} maximum reps`);
        const [rLo, rHi] = parseBand(t.cell(row, 'Recovery'));
        within(s.recoverySec!.min, [rLo, rLo], `${slug} recovery minimum`);
        within(s.recoverySec!.max, [rHi, rHi], `${slug} recovery maximum`);
      }
      // The continuous ones state a distance band and no recovery at all.
      const cont = workoutBySlug('continuous-mile-cutdowns')!;
      const [cLo, cHi] = parseBand(t.cell('Continuous mile cutdown', 'Reps × distance'));
      within(cont.atPace!.min, [cLo, cLo], 'continuous mile cutdown minimum');
      within(cont.atPace!.max, [cHi, cHi], 'continuous mile cutdown maximum');
    },
  },
  {
    id: 'VOCAB.ladder-sequences',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 13.1 Ladder structures',
    claim:
      'Each of the four ladders runs the exact rung sequence §13.1 states, in order. A ladder ' +
      'whose rungs drift is a different workout.',
    check({ cite }) {
      const t = cite.table();
      const rows: Array<[string, string]> = [
        ['Ascending ladder', 'ascending-ladder'],
        ['Descending ladder', 'descending-ladder'],
        ['Pyramid (up-and-down)', 'up-and-down-pyramid'],
        ['Compressed pyramid', 'compressed-pyramid'],
      ];
      for (const [row, slug] of rows) {
        const entry = workoutBySlug(slug);
        if (!entry) throw new Error(`catalogue has no ${slug}`);
        const s = entry.structures[0];
        if (s.kind !== 'sequence') throw new Error(`${slug} is not a sequence`);
        const doctrine = t.cell(row, 'Sequence').split('-').map((n) => Number(n.trim()));
        // §13.2's ladder is written in metres; a 1600 rung is a mile either way.
        const engine = s.steps.map((step) => (step.unit === 'mi' ? step.value * 1600 : step.value));
        if (doctrine.join('-') !== engine.join('-')) {
          throw new Error(`${slug} runs ${engine.join('-')}, doctrine states ${doctrine.join('-')}`);
        }
      }
    },
  },
  {
    id: 'VOCAB.race-specific-half',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 14.3 Half-specific',
    claim:
      'The half-specific sessions carry the rep counts, rep distances and recoveries §14.3 ' +
      'states — including the 4 × 2 mi predictor, the session the doc says indicates readiness ' +
      'two weeks out.',
    check({ cite }) {
      const t = cite.table();
      const rows: Array<[string, string, number, number]> = [
        ['4 × 2 mi', '4x2mi-at-hm', 4, 2],
        ['6 × 1 mi at HM', '6x1mi-at-hm', 6, 1],
        ['3 × 3 mi at HM', '3x3mi-at-hm', 3, 3],
        ['8 × 1K at HM', '8x1k-at-hm', 8, 1],
      ];
      for (const [row, slug, reps, repLen] of rows) {
        const entry = workoutBySlug(slug);
        if (!entry) throw new Error(`catalogue has no ${slug}`);
        const s = entry.structures[0];
        if (s.kind !== 'reps') throw new Error(`${slug} is not a rep set`);
        const structure = t.cell(row, 'Structure');
        const m = matchLiteral(`${row} ${structure}`, /(\d+)\s*×\s*(\d+)/, `${slug} structure`);
        within(s.reps.min, [Number(m[1]), Number(m[1])], `${slug} reps`);
        within(s.reps.max, [Number(m[1]), Number(m[1])], `${slug} reps`);
        within(s.reps.min, [reps, reps], `${slug} reps (catalogue)`);
        within(s.rep.min, [repLen, repLen], `${slug} rep length`);
        const [rLo] = parseBand(t.cell(row, 'Recovery'));
        const restSec = /min/.test(t.cell(row, 'Recovery')) ? rLo * 60 : rLo;
        within(s.recoverySec!.min, [restSec, restSec], `${slug} recovery`);
      }
    },
  },
  {
    id: 'PLACEMENT.cycle-phases',
    binds: ['lib/workout-catalogue/types.ts#DOCTRINE_PHASES', 'lib/workout-catalogue/select.ts#PHASE_FROM_ENGINE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 15. Training-cycle placement summary',
    claim:
      'The selector\'s phases are the five §15 names, and every one of them has at least one ' +
      'workout the catalogue can place in it. A phase with nothing in it is a phase the ' +
      'composer would fill from somewhere else.',
    check({ cite }) {
      const t = cite.table();
      if (t.rows.length !== DOCTRINE_PHASES.length) {
        throw new Error(
          `§15 has ${t.rows.length} phase rows and the engine models ${DOCTRINE_PHASES.length}`,
        );
      }
      for (const phase of DOCTRINE_PHASES) {
        const n = WORKOUT_CATALOGUE.filter((e) => e.phases.includes(phase)).length;
        if (n === 0) throw new Error(`no workout is placed in the ${phase} phase`);
      }
      // Every engine phase resolves onto §15 phases, and between them they
      // cover all five — otherwise a doctrine row is unreachable from the app.
      const covered = new Set(Object.values(PHASE_FROM_ENGINE).flat());
      for (const phase of DOCTRINE_PHASES) {
        if (!covered.has(phase)) {
          throw new Error(`§15's ${phase} row is unreachable from any engine phase`);
        }
      }
    },
  },
  {
    id: 'PLACEMENT.combinations-to-avoid',
    binds: ['lib/workout-catalogue/select.ts#combinationViolation'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 16. Combinations to avoid',
    claim:
      'Every pairing §16 forbids has a rule that fires on it. A row in that table with no rule ' +
      'behind it is a combination the composer would happily schedule.',
    check({ cite }) {
      const t = cite.table();
      // Each doctrine row, and a (candidate, already-placed, gap) that must trip it.
      const probes: Array<[string, () => string | null]> = [
        ['VO2max + long run within 48 hrs', () =>
          combinationViolation(workoutBySlug('mile-repeats')!, {
            dayOffset: 5, placedThisWeek: [{ slug: 'base-long-run', dayOffset: 6 }], inTaperWindow: false,
          })],
        ['MP long run + hard tempo within 5 days', () =>
          combinationViolation(workoutBySlug('continuous-tempo')!, {
            dayOffset: 3, placedThisWeek: [{ slug: 'marathon-pace-long-run', dayOffset: 6 }], inTaperWindow: false,
          })],
        ['Two threshold sessions back-to-back', () =>
          combinationViolation(workoutBySlug('continuous-tempo')!, {
            dayOffset: 3, placedThisWeek: [{ slug: 'cruise-intervals', dayOffset: 2 }], inTaperWindow: false,
          })],
        ['Fast finish long run before goal race', () =>
          combinationViolation(workoutBySlug('fast-finish-long-run')!, {
            dayOffset: 6, placedThisWeek: [], inTaperWindow: true,
          })],
        ['400m R-pace day before threshold', () =>
          combinationViolation(workoutBySlug('continuous-tempo')!, {
            dayOffset: 3, placedThisWeek: [{ slug: '200m-repeats', dayOffset: 2 }], inTaperWindow: false,
          })],
      ];
      if (t.rows.length !== probes.length) {
        throw new Error(
          `§16 states ${t.rows.length} forbidden combinations and the selector implements ${probes.length}`,
        );
      }
      for (const [row, probe] of probes) {
        // The doc still has the row this probe was written for.
        t.row(row);
        if (probe() == null) {
          throw new Error(`§16 forbids "${row}" and combinationViolation does not fire on it`);
        }
      }
    },
  },
  {
    id: 'VOCAB.catalogue-covers-the-index',
    binds: ['lib/workout-catalogue/catalogue.ts#WORKOUT_CATALOGUE'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 18. Workout-name lookup index',
    claim:
      'Every workout §18 indexes has an entry in the catalogue, either directly or through a ' +
      'recorded cross-reference. §18 is the doc\'s own list of what it names, so a workout ' +
      'added to the doc fails this until it is in the catalogue.',
    check({ cite }) {
      const t = cite.table();
      if (t.rows.length === 0) throw new Error('§18 parsed to zero rows · the index moved');
      const sections = new Set(WORKOUT_CATALOGUE.map((e) => e.section));
      const xref = new Set(CROSS_REFERENCES.map((x) => x.at));
      const missing: string[] = [];
      for (const row of t.rows) {
        const refs = String(row.Section ?? '').split(',').map((s) => s.trim());
        if (refs.length === 0 || refs[0] === '') continue;
        if (!refs.some((r) => sections.has(r) || xref.has(r))) {
          missing.push(`${row.Name} → ${row.Section}`);
        }
      }
      if (missing.length > 0) {
        throw new Error(`§18 names workouts the catalogue does not carry: ${missing.join(' · ')}`);
      }
      // And every cross-reference still resolves to a real entry.
      for (const x of CROSS_REFERENCES) {
        if (!workoutBySlug(x.resolvesTo)) {
          throw new Error(`cross-reference ${x.name} points at missing entry ${x.resolvesTo}`);
        }
      }
    },
  },
  /* ═════════════════════════════════════════════════════════════════════════
   * DOCTRINE-DOSING-2 (2026-08-18) · the caps are ENFORCED now, so these claims
   * are about the engine OBEYING them, not only about the numbers being right.
   * The three claims above bind the constants; these bind the behaviour that
   * spends them.
   * ═════════════════════════════════════════════════════════════════════════ */
  {
    id: 'DOSING.one-session-per-pace-family',
    binds: ['lib/plan/dosing.ts#duplicatePaceFamily', 'lib/plan/generate.ts#qualityTypesFor'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 5.2 Continuous tempo (4–8 mi at threshold)',
    claim:
      'A training week runs at most ONE session of any pace family. §5.2 gives the continuous ' +
      'tempo "1×/week or alternating with cruise intervals" — the two forms of T work alternate ' +
      'across weeks rather than sharing one. This is what makes Research/01 weekly caps ' +
      'satisfiable at full doctrinal session size: one session already spends the whole allowance, ' +
      'so a week carrying two must either breach the cap or halve both.',
    check({ cite }) {
      const freq = cite.table().cell('Frequency', 'Prescription');
      // The doc must still say ONE. If a future edit raises it, the engine's
      // alternation is no longer what doctrine asks for and this fails loudly.
      matchLiteral(freq, /1\s*[×x]\s*\/\s*week|1\s*[×x]\/week/i, 'continuous tempo frequency');
      matchLiteral(freq, /alternating with cruise intervals/i, 'continuous tempo alternation');
      // And the engine's own predicate must agree about what "same family" means.
      if (duplicatePaceFamily(['threshold', 'tempo']) !== 'T') {
        throw new Error('duplicatePaceFamily does not treat cruise intervals and a continuous tempo as the same pace');
      }
      if (duplicatePaceFamily(['intervals', 'vo2max']) !== 'I') {
        throw new Error('duplicatePaceFamily does not treat two rep sessions as the same pace');
      }
      if (duplicatePaceFamily(['threshold', 'intervals']) !== null) {
        throw new Error('duplicatePaceFamily rejects a legal T + I week');
      }
    },
  },
  {
    id: 'DOSING.cap-family-is-the-session-not-the-slot',
    binds: [
      'lib/workout-catalogue/select.ts#selectWorkout',
      'lib/plan/generate.ts#capLedger',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 12.3 1K cutdowns',
    claim:
      'Which of Daniels\' three capped families a session spends is a property of the SESSION\'S ' +
      'OWN PACES, not of the slot it lands on. §12.3\'s 1K cutdowns run "Start at MP, finish at ' +
      '5K", so they are charged to the interval budget however the composer files them — and a ' +
      'week that has already committed its interval budget to a rep session cannot afford them. ' +
      'DOSING.one-session-per-pace-family holds the same rule over the SLOT TYPES; without this ' +
      'one a week ran the cutdown on its threshold slot beside a full 1200m set, spent 16% of ' +
      'the week at I against doctrine\'s 8%, and both sessions were then trimmed below the rep ' +
      'floors their own doc rows state.',
    check({ cite }) {
      // The doc must still put this session's finish above threshold. If a
      // future edit stops it there, the charge changes and this fails loudly.
      matchLiteral(cite.table().cell('Pace', 'Prescription'), /Start at MP, finish at 5K/i, '1K cutdown pace ramp');
      const cutdown = workoutBySlug('1k-cutdowns');
      if (!cutdown) throw new Error('§12.3 1K cutdowns is not in the catalogue');
      if (capFamilyOf(cutdown) !== 'interval') {
        throw new Error(`§12.3 finishes at 5K but is charged to ${capFamilyOf(cutdown)}`);
      }
      // Behaviour: offered a week with NOTHING left in the interval budget, the
      // selector must not place it — whatever slot is asking.
      const ask = (intervalLeftMi: number) =>
        selectWorkout({
          phase: 'specific_support', distance: 'm', tier: 'advanced', weekIndex: 4,
          weeklyMi: 56, slot: 'threshold',
          anchors: { MP: 420, '5K': 340, T: 390, I: 355, R: 320 },
          exclude: new Set(
            WORKOUT_CATALOGUE.filter((e) => e.slug !== '1k-cutdowns').map((e) => e.slug),
          ),
          capFamilyRemainingMi: { threshold: 5.6, interval: intervalLeftMi, repetition: 2.8 },
        });
      if (ask(4.5).ok !== true) {
        throw new Error('§12.3 was refused on a week whose interval budget is untouched');
      }
      if (ask(0).ok !== false) {
        throw new Error('§12.3 was placed on a week whose whole interval budget is already spent');
      }
    },
  },
  {
    id: 'DOSING.taper-percentage-exemption',
    binds: ['lib/plan/dosing.ts#capEnforced', 'lib/plan/dosing.ts#weeklyDoseBudgetMi'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.2 Marathon taper structure (3 weeks)',
    claim:
      'The percentage caps do not govern a taper or a race week, and doctrine says so by ' +
      'prescribing sessions outside them: §9.2 puts 10-12 mi at MP on a week at 80-90% of peak ' +
      'and 6-8 mi at MP on a week at 60-70%, both past Research/01 20% of weekly mileage. §9.1 ' +
      'states the mechanism — "The largest cut is to easy mileage; intensity is preserved through ' +
      'the taper" — so the share rises BECAUSE the taper is working. The ABSOLUTE ceilings keep ' +
      'binding through the taper, so preserved never becomes unbounded.',
    check({ cite }) {
      const t = cite.table();
      // Read §9.2's own -3 row and prove its named dose sits outside
      // Research/01's percentage. Both sides are taken at their KINDEST
      // reading — the TOP of the volume band (the biggest taper week the row
      // allows) against the BOTTOM of the MP dose (the smallest session it
      // asks for) — so this is not the band's extremes being picked to make a
      // point. If the gentlest reading still breaches, every other does.
      const mpMi = parseBand(matchLiteral(
        t.cell('-3', 'Quality session'), /([\d\s–—-]+) mi at MP/i, 'taper -3 MP dose',
      )[1]);
      const volPct = parsePctBand(t.cell('-3', 'Volume'));
      // The smallest peak at which the row's own session could fit inside
      // Research/01's 20%. Any marathoner peaking below this cannot run the
      // taper doctrine prescribes AND stay inside the percentage.
      const minPeakMi = mpMi[0] / MARATHON_PACE_WORKOUT_CAP.pctOfWeekly / volPct[1];
      // 55 mi/wk is a recreational-competitive marathon peak — the middle of
      // Research/00a's "Marathon | Recreational competitive | 40-60" row, and
      // the owner's own class. Stated here rather than read across documents.
      const RECREATIONAL_PEAK_MI = 55;
      if (minPeakMi <= RECREATIONAL_PEAK_MI) {
        throw new Error(
          `9.2's -3 taper session (${mpMi[0]} mi at MP on a week at ${volPct[1] * 100}% of peak) now ` +
          `fits inside Research/01's ${MARATHON_PACE_WORKOUT_CAP.pctOfWeekly * 100}% for any peak above ` +
          `${minPeakMi.toFixed(1)} mi/wk — the exemption this claim justifies no longer covers the ` +
          'recreational-competitive marathoner and should be re-derived',
        );
      }
      // The engine must exempt the percentage there, and ONLY the percentage.
      if (capEnforced('taper', 'percentage') || capEnforced('race-week', 'percentage')) {
        throw new Error('the percentage caps are being enforced on a taper or race week');
      }
      if (!capEnforced('taper', 'absolute') || !capEnforced('training', 'percentage')) {
        throw new Error('capEnforced is exempting more than the taper percentage');
      }
      // And the budget must follow the same rule: no percentage bound in a
      // taper, the absolute ceiling still there.
      if (Number.isFinite(weeklyDoseBudgetMi(40, 'T', 'taper'))) {
        throw new Error('weeklyDoseBudgetMi still applies the T percentage inside a taper');
      }
      const taperI = weeklyDoseBudgetMi(40, 'I', 'taper');
      if (!Number.isFinite(taperI) || taperI > 6.3) {
        throw new Error('weeklyDoseBudgetMi drops the I cumulative ceiling inside a taper');
      }
    },
  },
  {
    id: 'DOSING.enforced-findings-bind-the-composer',
    binds: [
      'lib/plan/dosing.ts#weekDosingFindings',
      'lib/plan/generate.ts#applyDosingCaps',
      'lib/plan/validate.ts#validateComposedPlan',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: "### Dosing rules — Daniels' caps",
    claim:
      'The caps are ENFORCED, not advisory. A training week spending more than the caps table\'s ' +
      'weekly percentage at a pace yields a finding marked enforced, whose cap in miles is the ' +
      'doc\'s own percentage of that week\'s mileage — `applyDosingCaps` trims to that number at ' +
      'authoring and `validateComposedPlan` §10 fails any plan still carrying a breach. Measured ' +
      '2026-08-28 across the full archetype matrix (11,598 arcs, 8,692 composed): zero enforced ' +
      'breaches; `_dosing_sweep_gate.test.ts` is the gate that keeps the number zero.',
    check({ cite }) {
      const t = cite.table();
      const tPct = parsePctBand(t.cell('T', 'Weekly cap'));
      // The budget the composer sizes to IS the doc's percentage on a training week.
      within(weeklyDoseBudgetMi(40, 'T', 'training'), [40 * tPct[0], 40 * tPct[1]], 'T training-week budget');
      // And the module-header scenario — two sessions each individually legal
      // at the single-workout cap, together double the weekly column — yields
      // an ENFORCED weekly finding capped at the doc's own number. This is the
      // exact gap the weekly column exists to close.
      const findings = weekDosingFindings({
        phase: 'QUALITY', isRaceWeek: false,
        days: [
          { type: 'easy', distanceMi: 6, subLabel: 'EASY' },
          { type: 'tempo', distanceMi: 8, subLabel: '2 mi WU · 4 mi @ T · 2 mi CD' },
          { type: 'easy', distanceMi: 5, subLabel: 'EASY' },
          { type: 'threshold', distanceMi: 9, subLabel: '4×1mi @ T pace · 60s jog' },
          { type: 'long', distanceMi: 12, subLabel: 'LONG', isLong: true },
        ],
      } as never);
      const f = findings.find((x) => x.pace === 'T' && x.scope === 'weekly');
      if (!f) throw new Error('a week at double the weekly T cap yields no weekly T finding');
      if (!f.enforced) {
        throw new Error('a training-week percentage breach is not marked enforced — the caps have gone advisory again');
      }
      within(f.capMi, [40 * tPct[0], 40 * tPct[1]], 'enforced weekly T cap in miles');
    },
  },
  {
    id: 'DOSING.effort-cued-spends-no-cap',
    binds: ['lib/plan/dosing.ts#dosePaceOf', 'lib/workout-catalogue/select.ts#fits'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 8.1 Hill family overview',
    claim:
      'Every row of §8.1\'s Pace column is an EFFORT, never a number — "Strong, controlled (~95% ' +
      'effort)", "5K–10K effort", "T to 10K effort", "Sequence of efforts" — and Research/01\'s ' +
      'dosing table prices four PACES (T/I/R/M), so an effort-cued session draws none of their ' +
      'weekly share: there is no pace target to be over or under against. `fits()` already gave ' +
      'this zero at-pace miles at authoring time; DOSE-EFFORT-1 (2026-08-30) closed the matching ' +
      'gap on the MEASURING side, where `dosePaceOf` re-derives a dose from a day\'s stored ' +
      '`type`/`subLabel` with no way to see the entry\'s `effortOnly` flag. Before the fix, EVERY ' +
      'reachable effort-cued rep entry (hill sprints, short/medium/long hill repeats, downhill ' +
      'repeats, and §9.4\'s Lydiard fartlek once it renders) was billed non-zero miles against I or ' +
      'M regardless of the composer\'s own zero — the exact hole that produced 2208 enforced ' +
      'breaches the one time an effort-cued entry large enough to matter (§8.5\'s ~1.9 mi Lydiard ' +
      'circuit) tried to render, and the reason that entry stayed `KNOWN_BLOCKED` in ' +
      '`_reachability.test.ts` until this fix.',
    check() {
      // §8.1's own table has no pace number in any Pace cell — verified by
      // VOCAB.hill-family. This claim is downstream of that one: given an
      // entry the catalogue already marks `effortOnly`, does the DOSING
      // accounting actually spend nothing on it, in both directions.
      for (const slug of [
        'hill-sprints', 'short-hill-repeats', 'medium-hill-repeats',
        'long-hill-repeats', 'downhill-repeats', 'lydiard-hill-circuit',
      ]) {
        const entry = workoutBySlug(slug);
        if (!entry) throw new Error(`catalogue has no ${slug}`);
        if (!entry.effortOnly) throw new Error(`${slug} is not effortOnly — wrong fixture for this claim`);
        const structure = entry.structures[0];
        const dose = structure.kind === 'sequence'
          ? { reps: structure.steps.length, atPaceMi: 0, atPaceMinutes: 20, recoverySec: 0 }
          : { reps: 6, atPaceMi: 0, atPaceMinutes: 20, recoverySec: 90 };
        const rendered = renderPrescription(entry, { ...dose, structure } as never);
        if (!rendered) throw new Error(`${slug} did not render — cannot check its dosing`);
        const day = { type: 'intervals', distanceMi: 6, subLabel: rendered };
        if (dosePaceOf(day as never) != null) {
          throw new Error(`${slug} rendered "${rendered}" and dosePaceOf still billed it a pace`);
        }
        if (dayDoses(day as never).length !== 0) {
          throw new Error(`${slug} rendered "${rendered}" and dayDoses still spent a cap on it`);
        }
      }
      // A genuinely PACED prescription that merely contains the word "effort"
      // as narrative framing (generate.ts's beginner base-phase surge days:
      // "…w/ 4×1 min surges @ T effort") must NOT be caught by the same
      // marker — the false positive DOSE-EFFORT-1's own fix had to avoid.
      const surgeDay = { type: 'tempo', distanceMi: 4, subLabel: '3mi E w/ 4×1 min surges @ T effort · 1 min jog' };
      if (dosePaceOf(surgeDay as never) !== 'T') {
        throw new Error('a genuinely paced "@ T effort" surge day is no longer dosed at T — the marker match is too broad');
      }
    },
  },
  {
    id: 'MPLONG.fast-finish-floor',
    binds: ['lib/plan/generate.ts#FAST_FINISH_MIN_MI', 'lib/plan/generate.ts#setLongFinish'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 4.5 Fast finish long run',
    claim:
      'The smallest race-pace finish the engine will schedule is the bottom of the only band ' +
      'doctrine states for one. §4.5 prescribes the segment as a "final 2-6 mi" block, so a week ' +
      'whose dosing budget cannot size it to two miles runs the long easy instead of shipping a ' +
      'mile of race pace under a label that promises a session.',
    check({ cite }) {
      // The band is stated in the section prose and in its own field table; read
      // whichever this section carries, and take its FLOOR.
      const band = parseBand(matchLiteral(
        cite.text(), /final ([\d\s–—-]+) mi at MP/i, 'fast-finish segment band',
      )[1]);
      within(FAST_FINISH_MIN_MI, [band[0], band[0]], 'fast-finish minimum segment');
    },
  },
  {
    id: 'DOCTRINE.base-rebuilt-share',
    binds: ['lib/plan/generate.ts#BASE_REBUILT_SHARE'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'BASE may only be skipped for a runner whose VOLUME is already rebuilt, and the threshold ' +
      'is the complement of doctrine own deepest planned down week. §"Volume progression rules" ' +
      'gives "Down weeks | Every 3-4 wk, reduce by 20-30%", so a runner genuinely mid-block on ' +
      'their deepest deload sits at 70% of their sustained level. Below that the shortfall is a ' +
      'volume deficit, not a down week — and Research/00b §"Reverse Periodization for Marathon ' +
      'Recovery" says what to do about it: "progressively rebuild volume first, then add intensity".',
    check({ cite }) {
      // The cell reads "Every 3-4 wk, reduce by 20-30%" and carries TWO bands.
      // `parsePctBand` would take the first (the cadence, 3-4) and read a 96%
      // floor, so the percentage is matched explicitly before it is parsed.
      const cell = cite.table().cell('Down weeks', 'Specification');
      const cut = parseBand(matchLiteral(
        cell, /reduce by ([\d\s–—-]+)%/i, 'down-week depth',
      )[1]);
      // The complement of the DEEPEST cut doctrine sanctions.
      const floor = 1 - cut[1] / 100;
      within(BASE_REBUILT_SHARE, [floor, floor], 'base-rebuilt share of sustained volume');
    },
  },
  {
    id: 'DOCTRINE.base-gate-reads-explained-dips',
    binds: [
      'lib/plan/generate.ts#BASE_REBUILT_SHARE',
      'lib/plan/generate.ts#SHORT_LAYOFF_WEEKS',
      'lib/plan/generate.ts#resolveRampBase',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '### Return from Short Layoff (1-2 weeks off)',
    claim:
      'The base-rebuilt gate asks two questions, not one: is the runner holding their own ' +
      'volume, and \u2014 if not \u2014 is the shortfall EXPLAINED. It read only the raw 28-day mean, ' +
      'so the taper and post-race recovery window the engine itself prescribed were discounted ' +
      'as engine-authored by the ramp (`resolveRampBase`) and counted as detraining by the ' +
      'phase planner in the same authoring. `lifted` is the flag that already answers the second ' +
      'question: true only while the interruption is no longer than the one doctrine mandates \u2014 ' +
      'a finished race\u2019s taper plus Research/00b\u2019s recovery window for its distance and priority, ' +
      'and otherwise this section\u2019s one-to-two-week short layoff. A longer, unexplained absence ' +
      'is not lifted, the mean governs, and BASE goes in exactly as before.',
    check({ cite }) {
      // The section's own title states the short-layoff length; the engine's
      // default allowance is read from it rather than hand-copied.
      const weeks = parseBand(matchLiteral(
        cite.text(), /Return from Short Layoff \(([\d\s\u2013\u2014-]+) weeks? off\)/i, 'short-layoff window',
      )[1])[1];
      if (SHORT_LAYOFF_WEEKS !== weeks) {
        throw new Error(
          `SHORT_LAYOFF_WEEKS is ${SHORT_LAYOFF_WEEKS}, doctrine calls ${weeks} weeks a short layoff`,
        );
      }
      // The gate, exercised through the same evidence the composer is handed.
      const gate = (e: { meanMi: number; sustainedMi: number; lifted: boolean }) =>
        !(e.sustainedMi > 0)
        || e.meanMi >= BASE_REBUILT_SHARE * e.sustainedMi
        || e.lifted;

      // A mandated post-race window: three low weeks inside a four-week
      // allowance, off a sustained 43.5. The mean alone fails the share test;
      // the explanation is what carries it.
      const mandated = resolveRampBase({
        meanWeeklyMi: 16.8,
        weeklySeries: [0, 4, 19.2, 38.1, 11.3, 37.8, 40.3, 46.4, 6, 27.9, 41.4, 40, 45.9, 38.7, 40.8, 43.5],
        allowedInterruptionWeeks: 4,
      });
      if (mandated.meanMi >= BASE_REBUILT_SHARE * mandated.sustainedMi) {
        throw new Error('the mandated-window fixture no longer fails the raw-mean test \u00b7 it proves nothing');
      }
      if (!gate(mandated)) {
        throw new Error(
          'a runner inside the recovery window the engine itself prescribed is still read as ' +
          'short of base \u00b7 the same weeks are discounted by resolveRampBase and counted here',
        );
      }
      // The same shortfall with no explanation \u2014 seven weeks down, only the
      // short-layoff allowance \u2014 must still insert BASE.
      const unexplained = resolveRampBase({
        meanWeeklyMi: 4,
        weeklySeries: [0, 0, 2, 3, 5, 6, 8, 40, 44, 47, 40, 43, 45, 41, 39, 42],
        allowedInterruptionWeeks: SHORT_LAYOFF_WEEKS,
      });
      if (gate(unexplained)) {
        throw new Error(
          'a seven-week unexplained absence reads as base-rebuilt \u00b7 Research/22 \u00a7"Return from ' +
          'Moderate Layoff (3-8 weeks)" prescribes a rebuild, and Research/00a places a returning ' +
          'runner on "Linear (rebuild base before any sharpening)"',
        );
      }
      // The gate in the composer must be the one this claim just exercised.
      if (!/\|\| rampEvidence\.lifted;/.test(sourceOf('web-v2/lib/plan/generate.ts'))) {
        throw new Error('composePlan\u2019s base-rebuilt gate no longer reads the explained-interruption flag');
      }
    },
  },
  /* ───────────────────── THE CONVERGENCE RULE (2026-08-19) ─────────────────
   *
   * The owner ruled that readiness may change a session, "but only on a
   * convergence of independent signals, never on one metric, and the change is
   * settled the night before". These claims bind every number that rule turns
   * on, and the two that are NOT in the research are labelled convention.
   */
  {
    id: 'CONVERGENCE.rhr-threshold',
    binds: ['lib/coach/convergence.ts#CONVERGENCE'],
    doc: 'Research/15-wearable-data.md',
    anchor: '### Decision rules',
    claim:
      'The cardiac domain fires at the first row of the RHR decision table whose action ' +
      'signal is to ACT rather than to watch: a rise at or above the stated bpm, held for ' +
      'the stated number of consecutive days. Both numbers are read out of that row. The ' +
      'row above it says "Watch, do not act" on a one-day rise, which is why no domain in ' +
      'this rule can be satisfied by a single reading.',
    check({ cite }) {
      const t = cite.table();
      const row = t.rows.find((r) => /consecutive days/i.test(Object.values(r)[0] ?? ''));
      if (!row) throw new Error('Research/15 RHR decision table no longer has a consecutive-days row');
      const label = Object.values(row)[0];
      const action = Object.values(row)[2] ?? '';
      if (!/reduce intensity/i.test(action)) {
        throw new Error(`the consecutive-days RHR row no longer says to reduce intensity · reads "${action}"`);
      }
      const bpm = Number(matchLiteral(label, /\+(\d+(?:\.\d+)?)\s*bpm/, 'RHR rise bpm')[1]);
      const days = Number(matchLiteral(label, /for\s*(\d+)\+?\s*consecutive days/i, 'RHR days')[1]);
      if (CONVERGENCE.rhrRiseBpm !== bpm) {
        throw new Error(`CONVERGENCE.rhrRiseBpm is ${CONVERGENCE.rhrRiseBpm}, doctrine says ${bpm}`);
      }
      if (CONVERGENCE.rhrMinDays !== days) {
        throw new Error(`CONVERGENCE.rhrMinDays is ${CONVERGENCE.rhrMinDays}, doctrine says ${days}`);
      }
    },
  },
  {
    id: 'CONVERGENCE.hrv-persistence',
    binds: ['lib/coach/convergence.ts#CONVERGENCE'],
    doc: 'Research/15-wearable-data.md',
    anchor: '### Interpretation matrix',
    claim:
      'The autonomic domain needs the 7-day rolling LnRMSSD to fall further than the ' +
      'smallest worthwhile change for the number of consecutive days the interpretation ' +
      'matrix names against "Reduce intensity". One day, or two, is not that row.',
    check({ cite }) {
      const t = cite.table();
      const row = t.rows.find((r) => /reduce intensity/i.test(Object.values(r)[2] ?? ''));
      if (!row) throw new Error('Research/15 HRV interpretation matrix no longer has a reduce-intensity row');
      const label = Object.values(row)[0];
      const days = Number(matchLiteral(label, /(\d+)\s*days/i, 'HRV persistence days')[1]);
      if (CONVERGENCE.hrvMinDays !== days) {
        throw new Error(`CONVERGENCE.hrvMinDays is ${CONVERGENCE.hrvMinDays}, doctrine says ${days}`);
      }
      if (!/SWC/i.test(label)) {
        throw new Error('the reduce-intensity HRV row no longer measures against the SWC');
      }
    },
  },
  {
    id: 'CONVERGENCE.hrv-smallest-worthwhile-change',
    binds: ['lib/coach/convergence.ts#CONVERGENCE', 'lib/coach/convergence.ts#hrvFallbackLnDrop'],
    doc: 'Research/15-wearable-data.md',
    anchor: '### Plews approach (peer-reviewed)',
    claim:
      'The SWC is the stated multiple of the standard deviation of the 7-day rolling ' +
      'average, and the fallback used before that SD exists is the same section’s ' +
      'alternative form, a raw RMSSD percentage drop. Both numbers are read out of the ' +
      'section, and the fallback is converted into log space from the percentage rather ' +
      'than written down twice.',
    check({ cite }) {
      const text = cite.text();
      const mult = Number(matchLiteral(
        text, /smallest worthwhile change \(SWC\)\*\*\s*as\s*`([\d.]+)\s*×\s*SD`/i, 'SWC multiple',
      )[1]);
      if (CONVERGENCE.hrvSwcSdMultiple !== mult) {
        throw new Error(`CONVERGENCE.hrvSwcSdMultiple is ${CONVERGENCE.hrvSwcSdMultiple}, doctrine says ${mult}`);
      }
      const pct = Number(matchLiteral(text, /≈\s*([\d.]+)%\s*raw RMSSD drop/i, 'raw RMSSD fallback')[1]);
      if (CONVERGENCE.hrvFallbackDropPct !== pct) {
        throw new Error(`CONVERGENCE.hrvFallbackDropPct is ${CONVERGENCE.hrvFallbackDropPct}, doctrine says ${pct}`);
      }
      // And the log-space form has to BE that percentage, not a second number.
      const expected = -Math.log(1 - pct / 100);
      if (Math.abs(hrvFallbackLnDrop() - expected) > 1e-9) {
        throw new Error('hrvFallbackLnDrop no longer derives from the cited percentage');
      }
    },
  },
  {
    id: 'CONVERGENCE.baseline-minimum-days',
    binds: ['lib/coach/convergence.ts#CONVERGENCE', 'lib/coach/convergence.ts#gradeConvergence'],
    doc: 'Research/15-wearable-data.md',
    anchor: '### Establishing a baseline',
    claim:
      'Nothing may fire before the runner has the minimum days of data doctrine requires ' +
      'before drawing conclusions at all. A day-one runner has no personal normal, so every ' +
      'deviation would be measured against nothing. The gate is enforced, not just declared: ' +
      'a runner one day short of it grades green with every domain at maximum severity.',
    check({ cite }) {
      const days = Number(matchLiteral(
        cite.text(), /Minimum\s*(\d+)\s*days of data/i, 'baseline minimum days',
      )[1]);
      if (CONVERGENCE.minBaselineDays !== days) {
        throw new Error(`CONVERGENCE.minBaselineDays is ${CONVERGENCE.minBaselineDays}, doctrine says ${days}`);
      }
      const everythingWrong = {
        hrvLnRolling: Array.from({ length: 30 }, () => Math.log(15)),
        hrvLnBaseline: Math.log(60),
        hrvLnSd60d: 0.1,
        rhrDaily: Array.from({ length: 30 }, () => 75),
        rhrBaseline: 48,
        sleepNightly: Array.from({ length: 30 }, () => 3),
        acwrDaily: Array.from({ length: 30 }, () => 4),
        subjectiveWreckedOnEasy: true,
        weeklyMpw: 45,
      };
      const ctx = {
        daysToNextRace: null, daysSinceLastRace: null, postRaceWindowDays: 14,
        inPlannedCutback: false, illnessActive: false, daysSinceTravel: null,
        heatFlaggedDaysRecent: 0, alcoholLastNight: false,
      };
      const cold = gradeConvergence({ ...everythingWrong, baselineDays: days - 1 }, ctx);
      if (cold.grade !== 'green') {
        throw new Error(`a runner with ${days - 1} baseline days graded ${cold.grade} · the cold-start gate is not enforced`);
      }
    },
  },
  {
    id: 'CONVERGENCE.acwr-danger-zone',
    binds: ['lib/coach/convergence.ts#CONVERGENCE'],
    doc: 'Research/15-wearable-data.md',
    anchor: '| ACWR | Zone |',
    claim:
      'The load domain votes only in Gabbett’s danger zone, at the same threshold ' +
      'ACWR_BANDS already carries, and it can never act alone. Doctrine’s own critique ' +
      'in this section is the reason: ACWR is "a directional sanity check, not a stop-light", ' +
      '"a ratio of 1.4 in itself is not a verdict", and the instruction is to "Couple with ' +
      'HRV trend, RHR, sleep, and subjective state" — which is the convergence rule in ' +
      'doctrine’s own words.',
    check({ cite }) {
      const t = cite.table();
      const danger = t.rows.find((r) => /danger/i.test(r.Zone ?? ''));
      if (!danger) throw new Error('Research/15 ACWR table no longer has a danger row');
      const threshold = parseBand(danger.ACWR)[0];
      if (CONVERGENCE.acwrDanger !== threshold) {
        throw new Error(`CONVERGENCE.acwrDanger is ${CONVERGENCE.acwrDanger}, doctrine says ${threshold}`);
      }
      if (CONVERGENCE.acwrDanger !== ACWR_BANDS.danger) {
        throw new Error('the convergence rule and ACWR_BANDS disagree about the danger threshold');
      }
      const text = cite.text();
      if (!/Couple with HRV trend, RHR, sleep, and subjective state/i.test(text)) {
        throw new Error('Research/15 no longer instructs coupling ACWR with the other signals · re-read the rule');
      }
    },
  },
  {
    id: 'CONVERGENCE.travel-confound-window',
    binds: ['lib/coach/convergence.ts#CONVERGENCE'],
    doc: 'Research/15-wearable-data.md',
    anchor: '### Confounders that elevate RHR independent of training stress',
    claim:
      'The per-domain context filters are the operational form of this section. The travel ' +
      'window is read out of its own sentence — travel and altitude elevate nocturnal ' +
      'HR for a stated number of days — and the engine takes the WIDE end, so the filter ' +
      'is generous to the runner rather than to the detector.',
    check({ cite }) {
      const band = parseBand(matchLiteral(
        cite.text(), /elevates nocturnal HR ([\d\s–—-]+) days/i, 'travel confound days',
      )[1]);
      if (CONVERGENCE.travelConfoundDays !== band[1]) {
        throw new Error(
          `CONVERGENCE.travelConfoundDays is ${CONVERGENCE.travelConfoundDays}, doctrine’s wide end is ${band[1]}`,
        );
      }
    },
  },
  {
    id: 'CONVERGENCE.three-corroborating-signals',
    binds: ['lib/coach/convergence.ts#CONVERGENCE', 'lib/coach/convergence.ts#gradeConvergence'],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: 'three corroborating signals start to look like evidence',
    claim:
      'THREE independent domains, not two, before the plan may be touched — and one, ' +
      'however extreme, may never touch it. This is the owner’s ruling of 2026-08-19 ' +
      'enforced rather than described: the check drives every domain to maximum severity ON ' +
      'ITS OWN and requires green every time. The number itself is D1 §3’s, whose ' +
      'honest status is stated in convergence.ts: a finding about what READS as evidence, ' +
      'not a physiological threshold. The physiology is per-domain and is Research/15’s.',
    check() {
      if (CONVERGENCE.redMinDomains !== 3) {
        throw new Error(`CONVERGENCE.redMinDomains is ${CONVERGENCE.redMinDomains} · the ruling requires a convergence, and three is the corroboration bar`);
      }
      if (CONVERGENCE.amberMinDomains >= CONVERGENCE.redMinDomains) {
        throw new Error('the amber bar must sit below the red bar · saying something should need less evidence than doing something');
      }
      const ctx = {
        daysToNextRace: null, daysSinceLastRace: null, postRaceWindowDays: 14,
        inPlannedCutback: false, illnessActive: false, daysSinceTravel: null,
        heatFlaggedDaysRecent: 0, alcoholLastNight: false,
      };
      const base = {
        hrvLnRolling: Array.from({ length: 30 }, () => Math.log(60)),
        hrvLnBaseline: Math.log(60),
        hrvLnSd60d: 0.1,
        rhrDaily: Array.from({ length: 30 }, () => 48),
        rhrBaseline: 48,
        sleepNightly: Array.from({ length: 30 }, () => 8.2),
        acwrDaily: Array.from({ length: 30 }, () => 1.0),
        subjectiveWreckedOnEasy: false,
        baselineDays: 60,
        weeklyMpw: 45,
      };
      // Each domain, alone, as loud as it can possibly be.
      const singles: Array<[string, Record<string, unknown>]> = [
        ['cardiac', { rhrDaily: Array.from({ length: 30 }, () => 95) }],
        ['autonomic', { hrvLnRolling: Array.from({ length: 30 }, () => Math.log(2)) }],
        ['sleep', { sleepNightly: Array.from({ length: 30 }, () => 0.5) }],
        ['load', { acwrDaily: Array.from({ length: 30 }, () => 9) }],
        ['subjective', { subjectiveWreckedOnEasy: true }],
      ];
      for (const [name, over] of singles) {
        const v = gradeConvergence({ ...base, ...over } as Parameters<typeof gradeConvergence>[0], ctx);
        if (v.converging.length !== 1) {
          throw new Error(`the ${name} fixture no longer isolates one domain (${v.converging.join(', ')})`);
        }
        if (v.grade !== 'green') {
          throw new Error(`ONE METRIC MOVED A SESSION · ${name} alone graded ${v.grade}`);
        }
      }
    },
  },
  {
    id: 'CONVERGENCE.hr-recovery-is-not-a-domain',
    binds: ['lib/coach/convergence.ts#ConvergenceDomain'],
    doc: 'Research/15-wearable-data.md',
    anchor: '### What each one actually measures',
    claim:
      'The domains have to be INDEPENDENT or the rule is theatre. HR recovery is the same ' +
      'cardiac system RHR measures, from the same sensor, and Research/15 gives it no row of ' +
      'its own anywhere — the composite-score section lists HRV, RHR and sleep as the ' +
      'underlying physiology these scores blend. Admitting HR recovery as a sixth domain ' +
      'would let one elevated heart rate vote twice and reach the bar by itself, so it is ' +
      'excluded from the domain union entirely.',
    check({ cite }) {
      const src = sourceOf('web-v2/lib/coach/convergence.ts');
      const union = matchLiteral(
        src, /export type ConvergenceDomain =([\s\S]*?);/, 'ConvergenceDomain union',
      )[1];
      if (/hr_recovery|hrRecovery/.test(union)) {
        throw new Error('HR recovery has been admitted as a convergence domain · it is not independent of RHR');
      }
      if (!/HR RECOVERY IS DELIBERATELY NOT A SIXTH DOMAIN/.test(src)) {
        throw new Error('convergence.ts no longer records why HR recovery is excluded');
      }
      // Doctrine's own account of what these composites are made of.
      if (!/HRV, RHR, sleep/i.test(cite.text())) {
        throw new Error('Research/15 §Recovery Scores no longer names HRV/RHR/sleep as the underlying physiology');
      }
    },
  },
  {
    id: 'CONVENTION.convergence-load-persistence',
    binds: ['lib/coach/convergence.ts#CONVERGENCE'],
    doc: 'Research/15-wearable-data.md',
    anchor: '| ACWR | Zone |',
    claim:
      'THE TWO-DAY PERSISTENCE ON THE LOAD DOMAIN IS A CONVENTION. Research/15 gives ACWR no ' +
      'persistence requirement, because it declines to make the ratio a verdict at all. Two ' +
      'days matches the shortest persistence doctrine asks of any domain it DOES quantify ' +
      '(RHR), so load is held to no weaker a standard than the signals with real thresholds. ' +
      'It is bounded by that: never below the RHR bar, and never a single day.',
    check() {
      if (CONVERGENCE.acwrMinDays < 2) {
        throw new Error(`CONVERGENCE.acwrMinDays is ${CONVERGENCE.acwrMinDays} · a single day is never actionable`);
      }
      if (CONVERGENCE.acwrMinDays < CONVERGENCE.rhrMinDays) {
        throw new Error('the load domain is held to a weaker persistence bar than RHR, which doctrine actually quantifies');
      }
      const src = sourceOf('web-v2/lib/coach/convergence.ts');
      if (!/CONVENTION · not read out of the research[\s\S]{0,600}acwrMinDays/.test(src)) {
        throw new Error('convergence.ts no longer labels acwrMinDays a convention');
      }
    },
  },
  {
    id: 'CONVENTION.convergence-heat-window',
    binds: ['lib/coach/convergence.ts#CONVERGENCE'],
    doc: 'Research/15-wearable-data.md',
    anchor: '### Confounders that elevate RHR independent of training stress',
    claim:
      'THE THREE-DAY HEAT WINDOW IS A CONVENTION. Doctrine names "hot bedroom" as an RHR ' +
      'confounder of the same magnitude as the threshold the cardiac domain fires on, but ' +
      'gives it no duration — unlike travel, which carries an explicit 3-5 day figure on ' +
      'the same line. Three days errs toward not counting a cardiac reading heat could ' +
      'explain, and is bounded below by the travel window doctrine does state.',
    check({ cite }) {
      const text = cite.text();
      if (!/hot bedroom/i.test(text)) {
        throw new Error('Research/15 no longer names a hot bedroom as an RHR confounder');
      }
      if (/hot bedroom[^)]*\)\s*(?:for|over)?\s*\d+\s*(?:-|–)?\s*\d*\s*days/i.test(text)) {
        throw new Error('doctrine now states a heat duration · replace this convention with the cited number');
      }
      if (CONVERGENCE.heatConfoundDays < 1 || CONVERGENCE.heatConfoundDays > CONVERGENCE.travelConfoundDays) {
        throw new Error(
          `CONVERGENCE.heatConfoundDays is ${CONVERGENCE.heatConfoundDays} · outside the range bounded by the cited travel window`,
        );
      }
      const src = sourceOf('web-v2/lib/coach/convergence.ts');
      if (!/CONVENTION · not read out of the research[\s\S]{0,700}heatConfoundDays/.test(src)) {
        throw new Error('convergence.ts no longer labels heatConfoundDays a convention');
      }
    },
  },

  /* ───────────────────── SLEEP TARGET · ONE NUMBER (2026-08-19) ────────────
   *
   * There were five sleep targets and one of them was bound. These claims hold
   * the reconciliation in place.
   */
  {
    id: 'SLEEP.one-target-across-every-surface',
    binds: [
      'lib/coach/readiness.ts#computeDynamicSleepTarget',
      'lib/coach/recovery-brief.ts#computeSleepTarget',
      'lib/coach/recovery-phase.ts#computeStatusLine',
      'lib/coach/sleep-coaching.ts#computeSleepCoaching',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: 'Recovery requirements scale with absolute training load',
    claim:
      'Every surface that tells the runner about sleep reads ONE target, and it is the ' +
      'mileage-scaled one doctrine actually states. Four of the five former values were ' +
      'unbound: an ACWR-keyed ladder in readiness.ts (doctrine’s numbers on the wrong ' +
      'axis — this section says ABSOLUTE training load, which is mileage, not a ratio), ' +
      'a flat 8.5/9.25 in recovery-brief.ts read off the sleep-EXTENSION delta table, a ' +
      'hardcoded 7.5 in recovery-phase.ts, and a 7.0/6.5 pair in sleep-coaching.ts that sat ' +
      'BELOW doctrine’s lowest target. All four now route through sleepTargetForMileage.',
    check({ cite }) {
      if (!/absolute training load/i.test(cite.text())) {
        throw new Error('Research/00b no longer scales recovery to absolute training load · re-read the axis');
      }
      // The target moves with mileage on every surface that has one.
      const light = computeDynamicSleepTarget(30);
      const heavy = computeDynamicSleepTarget(95);
      if (!(heavy > light)) {
        throw new Error(`the readiness sleep target does not rise with mileage (${light}h at 30 mpw, ${heavy}h at 95)`);
      }
      if (computeDynamicSleepTarget(30) !== sleepTargetForMileage(30)) {
        throw new Error('readiness.ts carries a sleep target of its own again');
      }
      // And the retired constants are gone, not merely unused.
      const forbidden: Array<[string, RegExp, string]> = [
        ['web-v2/lib/coach/recovery-brief.ts', /SLEEP_TARGET_STANDARD_H|SLEEP_TARGET_LONG_RUN_H/, 'the flat 8.5/9.25 targets'],
        ['web-v2/lib/coach/sleep-coaching.ts', /const TARGET_H\s*=|const TREND_AVG_H\s*=/, 'the 7.0/6.5 pair'],
        ['web-v2/lib/coach/recovery-phase.ts', /const TARGET_H = 7\.5/, 'the hardcoded 7.5'],
      ];
      for (const [file, re, what] of forbidden) {
        if (re.test(sourceOf(file))) {
          throw new Error(`${what} is back in ${file} · the sleep target has forked again`);
        }
      }
    },
  },
  {
    id: 'SLEEP.extension-is-a-delta-not-a-target',
    binds: ['lib/coach/recovery-brief.ts#computeSleepTarget'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Sleep Extension and Sleep Banking',
    claim:
      'The sleep-extension table states an AMOUNT TO ADD, not a target to sit at. Reading it ' +
      'as an absolute is what produced the flat 8.5h bar. The long-run target is now the ' +
      'runner’s mileage-scaled target PLUS this table’s own low-end increment, and ' +
      'the increment is checked against the doc rather than written down as 0.75.',
    check({ cite }) {
      const row = cite.table().rows.find((r) => /extension/i.test(Object.values(r)[0] ?? ''));
      if (!row) throw new Error('Research/00b no longer has a sleep-extension row');
      const protocol = Object.values(row)[1] ?? '';
      const mins = parseBand(matchLiteral(protocol, /Add ([\d\s–—-]+) min/i, 'sleep extension minutes')[1]);
      const lowEndHours = mins[0] / 60;
      const src = sourceOf('web-v2/lib/coach/recovery-brief.ts');
      const engine = Number(matchLiteral(
        src, /const SLEEP_EXTENSION_LONG_RUN_H = ([\d.]+);/, 'long-run sleep extension',
      )[1]);
      if (Math.abs(engine - lowEndHours) > 0.01) {
        throw new Error(`SLEEP_EXTENSION_LONG_RUN_H is ${engine}h, doctrine’s low end is ${lowEndHours}h`);
      }
    },
  },
  {
    id: 'READINESS.one-weight-table',
    binds: ['lib/coach/readiness.ts#READINESS_WEIGHTS', 'lib/coach/recovery-brief.ts#computeScore'],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: "create* a score; it can only modulate one",
    claim:
      'There is ONE readiness weight table. recovery-brief.ts carried a second, unbound one ' +
      '(HRV .45 / RHR .25 / TSB .20 / SLEEP .10) under the comment "per execution brief", ' +
      'naming a source that does not exist in this repo, and it repeated both errors the ' +
      '2026-08-17 audit had already fixed in readiness.ts: sleep at half its doctrine weight, ' +
      'and load as a PILLAR rather than a multiplier. It now imports READINESS_WEIGHTS and ' +
      'applies training form as a multiplier, so the two composites cannot drift again.',
    check() {
      const src = sourceOf('web-v2/lib/coach/recovery-brief.ts');
      if (/const W_HRV = 0\.|const W_RHR = 0\.|const W_SLEEP = 0\.|const W_TSB\b/.test(src)) {
        throw new Error('recovery-brief.ts carries its own readiness weights again');
      }
      if (!/READINESS_WEIGHTS/.test(src)) {
        throw new Error('recovery-brief.ts no longer imports the one weight table');
      }
      // Load is a multiplier there, as it is in readiness.ts.
      if (!/recoveryFormMultiplier/.test(src)) {
        throw new Error('recovery-brief.ts no longer applies training form as a multiplier');
      }
      const mult = matchLiteral(
        src, /export const RECOVERY_FORM_MULTIPLIER = \{([\s\S]*?)\} as const;/, 'RECOVERY_FORM_MULTIPLIER',
      )[1];
      const values = [...mult.matchAll(/([\d.]+),/g)].map((m) => Number(m[1]));
      // D1 §2.4's stated range for a load-context multiplier.
      for (const v of values) {
        if (v < 0.85 || v > 1.10) {
          throw new Error(`RECOVERY_FORM_MULTIPLIER carries ${v}, outside D1 §2.4's [0.85, 1.10]`);
        }
      }
    },
  },

  // ── CEIL-ZONE-1 / DRIFT-T-1 / CI-CROSS-1 / LEVER-CITE-1 (2026-08-19) ──────
  // The plan's stimulus ceiling, and the constants around it that were
  // asserting physiology with nothing to open.
  {
    id: 'PACE.zone-stimulus-inversion',
    binds: [
      'lib/training/zone-stimulus.ts#vdotFromZonePace',
      'lib/training/zone-stimulus.ts#stimulusVdotForRow',
      'lib/training/plan-target.ts#loadPlannedTargetVdot',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Pace conversion from a race time',
    claim:
      'Doctrine defines every training zone as a column of the published race-pace table — T ' +
      'as half-marathon-to-15K pace, I as 3K-to-5K pace, R as mile pace. So the VDOT a ' +
      'prescribed pace implies is read by inverting THAT zone, and a rep set is never ' +
      're-scored as a race at the goal distance.',
    check({ cite }) {
      const text = cite.text();
      const rows: Array<[string, RegExp]> = [
        ['T', /half-marathon pace to 15K pace/i],
        ['I', /3K to 5K race pace/i],
        ['R', /mile race pace/i],
      ];
      for (const [zone, phrase] of rows) {
        if (!phrase.test(text)) {
          throw new Error(`the ${zone} row no longer states its race-pace anchor · re-read the claim`);
        }
      }
      // 1 · the inverse really is the forward table run backwards. Any drift
      // between zone-anchors.ts and this inversion shows up here.
      const zones: PaceZone[] = ['T', 'HM', 'ST', 'I', '5K', '3K', '10K', 'R', 'mile', 'M', 'MP'];
      for (const v of [32, 40, 48, 55, 65, 75]) {
        for (const z of zones) {
          const pace = zonePaceAtVdot(v, z);
          if (pace == null) continue; // a zone this runner cannot honestly be priced at
          const back = vdotFromZonePace(z, pace);
          if (back == null) throw new Error(`zone ${z} priced at VDOT ${v} does not invert`);
          // The forward direction rounds pace to whole seconds, and a second of
          // pace is worth well under half a VDOT point at every zone here.
          if (Math.abs(back - v) > 0.5) {
            throw new Error(`zone ${z} round trip: VDOT ${v} -> ${pace}s/mi -> ${back}`);
          }
        }
      }
      // 2 · the taper primer is not the ceiling, at any distance. A marathon
      // plan's tune-up is "5x400m @ 5K pace" carrying an I-pace, and the branch
      // this claim replaced read that pace as a MARATHON RACE. Assert both
      // halves — the row contributes nothing now, AND the mis-read it replaced
      // was worth several points — so this is a live guard, not a tautology.
      const iPace = iPaceFromVdot(48);
      if (iPace == null) throw new Error('I-pace is unreadable at VDOT 48 · the table moved');
      if (stimulusVdotForRow('race_week_tuneup', '5x400m @ 5K pace', iPace) != null) {
        throw new Error('a race-week tune-up is being read as the plan stimulus ceiling again');
      }
      const asRace = vdotFromRace(
        Math.round(iPace * TABLE_RACE_DISTANCE_MI.marathon),
        TABLE_RACE_DISTANCE_MI.marathon,
      );
      if (asRace == null || asRace - 48 < 3) {
        throw new Error('the rep-set-as-race mis-read no longer overstates fitness · re-derive this guard');
      }
      // 3 · an I-zone session reads at its own zone, landing on the runner the
      // plan was written for rather than several points above them.
      const asZone = stimulusVdotForRow('intervals', '5x400m @ 5K pace', iPace);
      if (asZone == null || Math.abs(asZone.vdot - 48) > 0.5) {
        throw new Error(`an I-pace rep set reads as ${asZone?.vdot ?? 'null'}, not the VDOT 48 it was written at`);
      }
      // 4 · the ceiling must not reach for a race inversion at all. That call
      // site IS the bug. Comments are stripped first — both files describe the
      // branch they replaced, and writing down what went wrong is allowed.
      const src = stripComments(
        sourceOf('web-v2/lib/training/zone-stimulus.ts')
        + sourceOf('web-v2/lib/training/plan-target.ts'),
      );
      if (/vdotFromRace\s*\(/.test(src)) {
        throw new Error('the plan stimulus ceiling is scoring a prescribed pace as a race again');
      }
    },
  },
  {
    id: 'ADAPTATION.vdot-drift-threshold',
    binds: [
      'lib/plan/drift-monitor.ts#VDOT_DRIFT_THRESHOLD',
      'lib/plan/drift-monitor.ts#inferPlanAnchorVdot',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Update logic',
    claim:
      'Doctrine re-derives paces when VDOT moves by one point. The drift monitor proposes a ' +
      'plan REFIT, which is heavier and rests on two estimates rather than one, so it fires ' +
      'between one and two times that quantum — and both sides of its comparison read the ' +
      'same canonical T-pace inversion rather than a private lookup table.',
    check({ cite }) {
      const q = Number(
        matchLiteral(
          cite.text(),
          /abs\(new_VDOT - current_VDOT\)\s*>=\s*(\d+)/,
          "Research/01 §Update logic's re-derivation quantum",
        )[1],
      );
      const raw = sourceOf('web-v2/lib/plan/drift-monitor.ts');
      const src = stripComments(raw);
      const engine = Number(
        matchLiteral(src, /export const VDOT_DRIFT_THRESHOLD = (\d*\.?\d+);/, 'VDOT_DRIFT_THRESHOLD')[1],
      );
      if (engine < q) {
        throw new Error(`drift fires at ${engine} VDOT, INSIDE doctrine's ${q}-point re-derivation quantum`);
      }
      if (engine > q * 2) {
        throw new Error(`drift fires at ${engine} VDOT, more than twice doctrine's ${q}-point quantum`);
      }
      // The duplicate T-pace column that made this threshold meaningless. At
      // VDOT 65 it disagreed with the canonical inversion by 2.6 points — more
      // than the threshold itself, and signed the same way every time.
      if (/T_PACE_TABLE|inverseTPaceToVdot/.test(src)) {
        throw new Error('drift-monitor.ts carries its own T-pace lookup table again');
      }
      if (!/vdotFromTpace/.test(src)) {
        throw new Error('drift-monitor.ts no longer inverts T-pace through the canonical function');
      }
    },
  },
  {
    id: 'PREDICTION.cross-distance-span-bands',
    binds: [
      'lib/training/goal-projection.ts#CROSS_SPAN_CI_PCT',
      'lib/training/goal-projection.ts#computeConfidenceInterval',
    ],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '### 13.7 Confidence Intervals to Report with Predictions',
    claim:
      "A prediction's confidence interval is keyed on the SPAN — which distance the anchor " +
      "sits at and which the target is — not on the target alone. The engine carries §13.7's " +
      'rows value-for-value, including the one the doc marks one-sided pessimistic.',
    check({ cite }) {
      const t = cite.table();
      const docPct = (row: string) => {
        // parseBand, not parsePctBand: these cells are already percentages and
        // the engine stores them as percentages, so dividing by 100 here would
        // compare 1.5 against 0.015.
        const [lo, hi] = parseBand(t.cell(row, 'Suggested 80% CI'));
        if (lo !== hi) throw new Error(`§13.7 row "${row}" now states a band, not a single figure`);
        return lo;
      };
      const src = sourceOf('web-v2/lib/training/goal-projection.ts');
      const enginePct = (key: string) =>
        Number(matchLiteral(src, new RegExp(`${key}:\\s*(\\d*\\.?\\d+),`), `CROSS_SPAN_CI_PCT.${key}`)[1]);
      const bindings: Array<[string, string]> = [
        ['fiveKToTenK', '5K → 10K, recent input'],
        ['tenKToHalf', '10K → half, recent input'],
        ['halfToMarathon', 'Half → marathon, marathon-trained'],
        ['shortToMarathonTrained', '5K → marathon, marathon-trained'],
        ['shortToMarathonNoBlock', '5K → marathon, no marathon block'],
        ['marathonToFiveK', 'Marathon → 5K, recent base'],
        ['staleInput', 'Cross-prediction with > 6-month-old input'],
      ];
      for (const [key, row] of bindings) {
        const doc = docPct(row);
        const eng = enginePct(key);
        if (eng !== doc) throw new Error(`CROSS_SPAN_CI_PCT.${key} = ${eng}, doctrine says ${doc}`);
      }
      // The one-sided row is one-sided in the ENGINE too, or the band promises
      // an upside doctrine explicitly withholds.
      if (!/one-sided/i.test(t.cell('5K → marathon, no marathon block', 'Suggested 80% CI'))) {
        throw new Error('§13.7 no longer marks the no-marathon-block row one-sided · re-read the claim');
      }
      if (!/oneSided: true/.test(src)) {
        throw new Error('the no-marathon-block band is symmetric again · doctrine states the error runs one way');
      }
      // And the anchor distance is actually READ. This claim exists because it
      // sat in the signature for two months, destructured and unused.
      if (!/crossSpanCi\(\s*args\.vdotAnchorDistanceMi/.test(src.replace(/\s*\n\s*/g, ' ').replace(/crossSpanCi\( /g, 'crossSpanCi('))) {
        throw new Error('computeConfidenceInterval no longer reads vdotAnchorDistanceMi');
      }
    },
  },
  {
    id: 'PREDICTION.marathon-specificity-minima',
    binds: [
      'lib/training/plan-target.ts#MARATHON_SPECIFIC_PEAK_LONG_RUN_MI',
      'lib/training/plan-target.ts#MARATHON_SPECIFIC_PEAK_WEEKLY_MI',
      'lib/training/plan-target.ts#loadMarathonSpecificTraining',
    ],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '### 13.1 Training Specificity',
    claim:
      'Marathon-specific training means peak long runs at or above 18 miles, peak weekly ' +
      'mileage at or above 50, and marathon-pace work. Below those, a marathon predicted from ' +
      'a short race runs 5-15% slow, and the engine sizes its band off the wider §13.7 row.',
    check({ cite }) {
      const text = cite.text();
      const longMi = Number(
        matchLiteral(text, /insufficient long runs \(<\s*(\d+)\s*mi peak\)/i, "§13.1's peak long-run minimum")[1],
      );
      const weekMi = Number(
        matchLiteral(text, /insufficient mileage \(<\s*(\d+)\s*mpw\)/i, "§13.1's weekly-mileage minimum")[1],
      );
      const src = sourceOf('web-v2/lib/training/plan-target.ts');
      const engineLong = Number(
        matchLiteral(src, /MARATHON_SPECIFIC_PEAK_LONG_RUN_MI = (\d+);/, 'peak long-run minimum')[1],
      );
      const engineWeek = Number(
        matchLiteral(src, /MARATHON_SPECIFIC_PEAK_WEEKLY_MI = (\d+);/, 'peak weekly minimum')[1],
      );
      if (engineLong !== longMi) throw new Error(`engine peak long run ${engineLong} mi != doctrine's ${longMi}`);
      if (engineWeek !== weekMi) throw new Error(`engine peak week ${engineWeek} mi != doctrine's ${weekMi}`);
      if (!/no marathon-pace work/i.test(text)) {
        throw new Error('§13.1 no longer names marathon-pace work as a specificity condition');
      }
      // All three conditions, because doctrine lists all three.
      if (!/hasMarathonPaceWork/.test(src)) {
        throw new Error('loadMarathonSpecificTraining no longer checks for marathon-pace work');
      }
    },
  },
  {
    id: 'PROJECTION.lever-bumps-under-doctrine-quantum',
    binds: [
      'lib/coach/projection-levers.ts#VDOT_BUMP_TUNE_UP',
      'lib/coach/projection-levers.ts#VDOT_BUMP_THRESHOLD',
      'lib/coach/projection-levers.ts#VDOT_BUMP_VO2',
      'lib/coach/projection-levers.ts#VDOT_BUMP_SHARPEN',
      'lib/coach/projection-levers.ts#VDOT_BUMP_GOAL_PACE',
      'lib/coach/projection-levers.ts#bTargetSec',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Testing cadence — how often to deliberately test',
    claim:
      "Doctrine's only per-block VDOT quantum is one point per reassessment. A tune-up race is " +
      'worth exactly that (it IS the reassessment); the four training-block levers are ' +
      'CONVENTION and each is worth strictly less, with the whole set staying inside one ' +
      "block's modelled ceiling.",
    check() {
      const src = sourceOf('web-v2/lib/coach/projection-levers.ts');
      if (!/const VDOT_BUMP_TUNE_UP = VDOT_PER_ASSESSMENT_BLOCK;/.test(src)) {
        throw new Error('VDOT_BUMP_TUNE_UP no longer reads the one doctrine quantum');
      }
      const fractions = ['THRESHOLD', 'VO2', 'SHARPEN', 'GOAL_PACE'].map((k) =>
        Number(
          matchLiteral(
            src,
            new RegExp(`const VDOT_BUMP_${k}\\s+= VDOT_PER_ASSESSMENT_BLOCK \\* (\\d*\\.?\\d+);`),
            `VDOT_BUMP_${k}`,
          )[1],
        ),
      );
      for (const f of fractions) {
        if (!(f > 0)) throw new Error('a lever models zero or negative fitness · it would not be a lever');
        if (!(f < 1)) {
          throw new Error(
            `a training-block lever is modelled at ${f}x a full reassessment cycle · doctrine states no ` +
              'per-block figure at all, so ours may not exceed the one quantum it does state',
          );
        }
      }
      const total = VDOT_PER_ASSESSMENT_BLOCK * (1 + fractions.reduce((s, f) => s + f, 0));
      if (total > MAX_BLOCK_GAIN_VDOT) {
        throw new Error(
          `every lever stacked models ${total.toFixed(2)} VDOT, past the ${MAX_BLOCK_GAIN_VDOT}-point block ceiling`,
        );
      }
      // The B-target reads the same §13.7 table the band does, not a flat
      // percentage from nowhere.
      if (/goalSec \* 0\.033/.test(src)) {
        throw new Error('bTargetSec is back on a flat uncited percentage');
      }
      if (!/researchSpanBasePct/.test(src)) {
        throw new Error('the B-target no longer reads the confidence-band table');
      }
    },
  },

  // ══ RULE 7 · 2026-08-19 ═══════════════════════════════════════════════════
  //
  // Eleven constants that assert physiology and cited nothing, or cited a LINE
  // NUMBER — which Rule 7 forbids outright, because a line number rots on the
  // next edit to the doc while a quoted heading survives everything except a
  // change to what the doc says.
  //
  // Three files were re-anchored on verbatim text as part of this
  // (lib/coach/heat-acclimatization.ts, lib/coach/strength-load.ts,
  // lib/plan/injury-protocols.ts — 34 line references in the last one alone),
  // and the claims below read their numbers back out of Research/ at run time.
  //
  // Five of the eleven turned out to have NO doctrine behind them at all. That
  // is a finding, not a failure, and they are labelled CONVENTION rather than
  // given a citation that would not survive being opened. Two of those carry
  // recorded violations; both are runner-facing and both are flagged in the
  // exemptions below rather than swallowed by a widened claim.

  {
    id: 'HEAT.acclimation-timeline',
    binds: [
      'lib/coach/heat-acclimatization.ts#ACCLIMATION_TIMELINE',
      'lib/coach/heat-acclimatization.ts#MAX_PENALTY_BPM_AT_PEAK',
      'lib/coach/heat-acclimatization.ts#expectedHeatPenaltyBpm',
    ],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '### Adaptation timeline (Périard 2021, Tipton-related ACSM consensus)',
    claim:
      'Heat acclimation shows up as HEART RATE AT A GIVEN WORKLOAD falling — five beats by day ' +
      'three, fifteen by day fourteen — and as a share of the full gains realised on the same ' +
      'day bands. The engine carries that table row for row, and the residual HR cost it quotes ' +
      'an unacclimated runner is the same fifteen beats a fully acclimated one has banked. Every ' +
      'number here used to be cited as `Research/06:158-163`, a line range Rule 7 forbids; the ' +
      'claim now reads the day rows, the HR column and the performance column out of the doc ' +
      'itself, so a reworded table fails here instead of drifting.',
    check({ cite }) {
      const t = cite.table();
      // The doc's fifth row ("14+ · Refines") is a maintenance note, not an
      // adaptation stage · the engine's four stages are the doc's first four.
      if (t.rows.length < ACCLIMATION_TIMELINE.length) {
        throw new Error(
          `doctrine's acclimation timeline has ${t.rows.length} rows, the engine encodes ` +
            `${ACCLIMATION_TIMELINE.length} stages`,
        );
      }
      const magnitude = (cell: string): [number, number] => {
        const [lo, hi] = parseBand(cell);
        const [a, b] = [Math.abs(lo), Math.abs(hi)];
        return [Math.min(a, b), Math.max(a, b)];
      };
      for (let i = 0; i < ACCLIMATION_TIMELINE.length; i++) {
        const row = t.rows[i];
        const stage = ACCLIMATION_TIMELINE[i];
        // Day band · the engine's `throughDay` is the top of the doc's own row.
        const dayTop = parseBand(row['Day'])[1];
        if (stage.throughDay !== dayTop) {
          throw new Error(
            `ACCLIMATION_TIMELINE[${i}].throughDay is ${stage.throughDay}, doctrine's row ` +
              `"${row['Day']}" runs through day ${dayTop}`,
          );
        }
        // HR @ workload · doctrine writes the reduction signed ("−10–15 bpm"),
        // the engine stores the magnitude.
        const hr = magnitude(row['HR @ workload']);
        if (stage.hrReductionBpm[0] !== hr[0] || stage.hrReductionBpm[1] !== hr[1]) {
          throw new Error(
            `ACCLIMATION_TIMELINE[${i}].hrReductionBpm is ${stage.hrReductionBpm.join('-')}, ` +
              `doctrine's "HR @ workload" for that row is "${row['HR @ workload']}"`,
          );
        }
        // Performance · the first and last rows are worded, not numbered.
        const perf = row['Performance'];
        if (/\d/.test(perf)) {
          const band = parseBand(perf);
          if (stage.gainsPct[0] !== band[0] || stage.gainsPct[1] !== band[1]) {
            throw new Error(
              `ACCLIMATION_TIMELINE[${i}].gainsPct is ${stage.gainsPct.join('-')}, doctrine says "${perf}"`,
            );
          }
        } else if (/begins/i.test(perf)) {
          within(stage.gainsPct[1], [0, 0], `ACCLIMATION_TIMELINE[${i}].gainsPct at doctrine's "${perf}"`);
        } else if (/full/i.test(perf)) {
          within(stage.gainsPct[0], [100, 100], `ACCLIMATION_TIMELINE[${i}].gainsPct at doctrine's "${perf}"`);
        } else {
          throw new Error(
            `the Performance column now reads "${perf}" for row ${i} · it no longer states a ` +
              'percentage, "begins improving" or "full acclimation", so the engine\'s 0/100 ' +
              'endpoints are unsupported. Re-read the table.',
          );
        }
      }
      // The peak penalty IS the full-acclimation reduction · one number, not two.
      const fullRow = t.rows[ACCLIMATION_TIMELINE.length - 1];
      const fullReduction = magnitude(fullRow['HR @ workload'])[1];
      if (MAX_PENALTY_BPM_AT_PEAK !== fullReduction) {
        throw new Error(
          `MAX_PENALTY_BPM_AT_PEAK is ${MAX_PENALTY_BPM_AT_PEAK}, doctrine's full-acclimation ` +
            `reduction is ${fullReduction} bpm`,
        );
      }
      // Read forward: an acclimated runner has paid it all back, and the cost
      // never rises as the days accumulate.
      if (expectedHeatPenaltyBpm(FULL_ACCLIM_DAYS) !== 0) {
        throw new Error(
          `a fully acclimated runner is still charged ${expectedHeatPenaltyBpm(FULL_ACCLIM_DAYS)} bpm`,
        );
      }
      let prev = Infinity;
      for (let d = 1; d <= FULL_ACCLIM_DAYS; d++) {
        const p = expectedHeatPenaltyBpm(d);
        if (p > prev) throw new Error(`the heat penalty rises between day ${d - 1} and day ${d}`);
        prev = p;
      }
      // The invented curve and its invented attribution may not come back.
      const src = sourceOf('web-v2/lib/coach/heat-acclimatization.ts');
      if (/exp\(\s*-\s*\w+\s*\/\s*7\s*\)/.test(stripComments(src))) {
        throw new Error(
          'the exponential decay is back · doctrine states a table, and the `max * exp(-N/7)` ' +
            'that replaced it was in no research file',
        );
      }
      // Backticked / commented mentions are the file WRITING DOWN what it
      // removed · only an executing reference counts, same rule the lint's
      // bare-attribution check already applies.
      if (/Friel/.test(stripComments(src))) {
        throw new Error('the Friel attribution is back on a timeline Research/06 credits to Périard 2021');
      }
      // And nothing may read RESTING HR as the adaptation signature again.
      if (!/rhrTrend/.test(src) || !/workloadHrDeltaBpm/.test(src)) {
        throw new Error(
          'heat-acclimatization.ts no longer separates resting HR from HR-at-workload · that ' +
            'conflation is what made the card read heat strain as adaptation',
        );
      }
    },
  },

  {
    id: 'HEAT.full-acclimation-duration',
    binds: ['lib/coach/heat-acclimatization.ts#FULL_ACCLIM_DAYS'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: 'Duration:    10–14 days minimum, 14–21 days preferred',
    claim:
      'The acclimation protocol states a minimum of ten to fourteen days. The engine counts a ' +
      'runner toward full acclimation at the TOP of that minimum band, which is also where the ' +
      'adaptation timeline puts full acclimation, so the two tables agree. Was cited as ' +
      '`Research/06:169`; a line number is not a citation.',
    check({ cite }) {
      const [minLo, minHi] = parseBand(cite.section[0].replace(/.*Duration:/, '').split(',')[0]);
      if (FULL_ACCLIM_DAYS !== minHi) {
        throw new Error(
          `FULL_ACCLIM_DAYS is ${FULL_ACCLIM_DAYS} · doctrine's stated minimum band is ` +
            `${minLo}-${minHi} days and the engine takes the top of it`,
        );
      }
      // Cross-check against the other table that names the same day: the
      // timeline's full-acclimation row. Two doctrine passages, one constant.
      const timeline = resolveCitation(
        'Research/06-weather-adjustments.md',
        '### Adaptation timeline (Périard 2021, Tipton-related ACSM consensus)',
      );
      const fullRow = timeline.table().rows[ACCLIMATION_TIMELINE.length - 1];
      const fullDay = parseBand(fullRow['Day'])[1];
      if (FULL_ACCLIM_DAYS !== fullDay) {
        throw new Error(
          `FULL_ACCLIM_DAYS is ${FULL_ACCLIM_DAYS} but the adaptation timeline reaches full ` +
            `acclimation on day ${fullDay} · the two passages disagree, so one of them moved`,
        );
      }
    },
  },

  {
    id: 'HEAT.pacing-during-acclimation',
    binds: ['lib/coach/heat-acclimatization.ts#ACCLIMATION_TIMELINE'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '### Pacing during acclimation',
    claim:
      'Doctrine states how much slower to run while acclimating, on the SAME day bands as the ' +
      'adaptation timeline: ten to fifteen percent in the first days, nothing by day fourteen. ' +
      'The engine tells the runner that band verbatim, so it has to be the doc\'s. Both the ' +
      'numbers and the day rows are read out of this table, and the day rows are checked against ' +
      'the timeline\'s — reading one table at the other\'s rows is the exact misread Rule 7 exists ' +
      'to catch.',
    check({ cite }) {
      const t = cite.table();
      const dayCol = t.headers[0];
      const paceCol = t.headers[1];
      for (let i = 0; i < ACCLIMATION_TIMELINE.length; i++) {
        const row = t.rows[i];
        const stage = ACCLIMATION_TIMELINE[i];
        const dayTop = parseBand(row[dayCol])[1];
        if (stage.throughDay !== dayTop) {
          throw new Error(
            `the pacing table's row ${i} runs through day ${dayTop} but the engine's stage ` +
              `${i} runs through day ${stage.throughDay} · the two Research/06 tables are being ` +
              'read at different rows',
          );
        }
        // "−10 to −15%" defeats parseBand (the word "to" is not a dash), so
        // take the magnitudes in the order the doc writes them.
        const nums = (row[paceCol].match(/\d+/g) ?? []).map(Number);
        const want: [number, number] = nums.length >= 2 ? [Math.min(...nums), Math.max(...nums)] : [0, 0];
        if (nums.length === 0 && !/normal|race-ready/i.test(row[paceCol])) {
          throw new Error(
            `the pacing cell for row ${i} reads "${row[paceCol]}" · no number and no statement ` +
              'that paces are normal, so a zero adjustment is unsupported',
          );
        }
        if (stage.pacingAdjustPct[0] !== want[0] || stage.pacingAdjustPct[1] !== want[1]) {
          throw new Error(
            `ACCLIMATION_TIMELINE[${i}].pacingAdjustPct is ${stage.pacingAdjustPct.join('-')}, ` +
              `doctrine says "${row[paceCol]}"`,
          );
        }
      }
    },
  },

  {
    id: 'STRENGTH.session-load-is-srpe-not-miles',
    binds: [
      'lib/coach/strength-load.ts#sessionRpeAu',
      'lib/coach/strength-load.ts#strengthMinutesByDay',
    ],
    doc: 'Research/09-cross-training.md',
    anchor: '- Quantify session load via sRPE; do not equate to run minutes.',
    claim:
      'Doctrine forbids converting strength minutes into running-mile equivalents in one ' +
      'sentence, and the engine used to do exactly that at an invented 0.07 mi/min, folded into ' +
      'both ACWR sites, under a citation to a Research/07 section containing no such factor. The ' +
      'replacement is Foster session-RPE — rating times minutes, in arbitrary units — and it must ' +
      'refuse to produce a number when either input is missing, because a defaulted RPE is the ' +
      'same fabrication in a new unit. This is the file\'s only claim, and it was cited by line ' +
      'number (`Research/09:350`) until Rule 7.',
    check({ cite }) {
      if (!/do not equate to run minutes/i.test(cite.section[0])) {
        throw new Error('Research/09 no longer forbids equating strength load to run minutes');
      }
      // Foster's arithmetic, and nothing else.
      if (sessionRpeAu(7, 60) !== 420) {
        throw new Error(`sessionRpeAu(7, 60) is ${sessionRpeAu(7, 60)}, session-RPE is rating x minutes`);
      }
      for (const [rpe, min] of [[null, 60], [7, null], [0, 60], [11, 60], [7, 0]] as const) {
        if (sessionRpeAu(rpe, min) !== null) {
          throw new Error(`sessionRpeAu(${rpe}, ${min}) returned a number · a missing or out-of-range input has no load`);
        }
      }
      // The prohibited conversion may not return, here or at either fold site.
      const files = [
        'web-v2/lib/coach/strength-load.ts',
        'web-v2/lib/coach/glance-state.ts',
        'web-v2/lib/coach/state-loader.ts',
      ];
      for (const f of files) {
        const code = stripComments(sourceOf(f));
        if (/0\.07/.test(code)) {
          throw new Error(
            `${f} carries a 0.07 coefficient again · that is the minute-to-mile equivalence ` +
              'Research/09 forbids, and it moved the ratio gating the readiness pull-back',
          );
        }
      }
    },
  },

  {
    id: 'INJURY.walk-run-cadence-is-derived-from-the-ladder',
    binds: [
      'lib/plan/injury-protocols.ts#MAX_WALK_RUN_STAGE',
      'lib/plan/injury-protocols.ts#MAX_STAGE_ADVANCE_PER_WEEK',
      'lib/plan/injury-protocols.ts#ALTERNATE_DAY_THROUGH_STAGE',
    ],
    doc: 'Research/05-injury-return-protocols.md',
    anchor: '**Generic walk-run progression template (8 stages)**',
    claim:
      'How fast an injured runner climbs the walk-run ladder is not a separate rule — it falls ' +
      'out of the ladder table and the rule printed under it. Doctrine asks for at least two ' +
      'sessions at each stage and puts the early stages at three sessions a week, so at most one ' +
      'stage a week. The ladder has as many stages as the table has rows, and the alternate-day ' +
      'rule covers every stage the table still writes as run-walk intervals rather than as a ' +
      'continuous block. All three constants are DERIVED here from the doc rather than restated, ' +
      'and all three used to be cited by line number.',
    check({ cite }) {
      const t = cite.table();
      const text = cite.text();

      // Stage count · the table's own row count.
      if (MAX_WALK_RUN_STAGE !== t.rows.length) {
        throw new Error(
          `MAX_WALK_RUN_STAGE is ${MAX_WALK_RUN_STAGE}, doctrine's ladder has ${t.rows.length} stages`,
        );
      }

      // Advance rate · sessions per week divided by sessions per stage.
      const perStage = text.match(/at least (\d+) sessions? at each stage/i);
      if (!perStage) {
        throw new Error(
          'the "spend at least N sessions at each stage" rule is gone from §1.1 · the engine\'s ' +
            'one-stage-a-week cadence has nothing under it. Re-read the section.',
        );
      }
      const sessionsPerStage = Number(perStage[1]);
      const weeklySessions = Math.min(
        ...t.rows.map((r) => parseBand(r['Sessions/wk'])[0]),
      );
      const derivedAdvance = Math.floor(weeklySessions / sessionsPerStage);
      if (MAX_STAGE_ADVANCE_PER_WEEK !== derivedAdvance) {
        throw new Error(
          `MAX_STAGE_ADVANCE_PER_WEEK is ${MAX_STAGE_ADVANCE_PER_WEEK} · doctrine's ` +
            `${weeklySessions} sessions a week at ${sessionsPerStage} per stage is ` +
            `${derivedAdvance} stage(s) a week`,
        );
      }

      // Alternate-day rule · through the last stage doctrine still writes as
      // intervals. The continuous stage has no repeat count.
      const section11 = resolveCitation(
        'Research/05-injury-return-protocols.md',
        '### 1.1 The Walk-Run Protocol Structure',
      ).text();
      if (!/every other day during early stages/i.test(section11)) {
        throw new Error(
          '§1.1 no longer states the alternate-day frequency rule · ALTERNATE_DAY_THROUGH_STAGE ' +
            'has nothing under it',
        );
      }
      let lastInterval = 0;
      t.rows.forEach((r, i) => {
        if (/\d/.test(r['Repeats'])) lastInterval = i + 1;
      });
      if (ALTERNATE_DAY_THROUGH_STAGE !== lastInterval) {
        throw new Error(
          `ALTERNATE_DAY_THROUGH_STAGE is ${ALTERNATE_DAY_THROUGH_STAGE} · doctrine's last ` +
            `run-walk interval stage is ${lastInterval} (stage ${lastInterval + 1} is the ` +
            'continuous block)',
        );
      }
      // The engine's own ladder must agree about which stage is continuous.
      const engineLastInterval = WALK_RUN_LADDER.filter((s) => !s.continuous).length;
      if (engineLastInterval !== lastInterval) {
        throw new Error(
          `WALK_RUN_LADDER marks ${engineLastInterval} interval stages, doctrine's table has ${lastInterval}`,
        );
      }
      // Rule 7 · the line references this file used to carry are gone.
      const src = sourceOf('web-v2/lib/plan/injury-protocols.ts');
      const lineCites = [...src.matchAll(/Research\/05[A-Za-z-]*(?:\.md)?:\d+/g)].map((m) => m[0]);
      if (lineCites.length > 0) {
        throw new Error(
          `injury-protocols.ts has grown ${lineCites.length} line-number citation(s) again ` +
            `(${lineCites.slice(0, 3).join(', ')}) · Rule 7: anchor on quoted text, never a line ` +
            'number. Research/05 numbers every heading; cite the section.',
        );
      }
    },
  },

  {
    id: 'INJURY.bsi-return-is-the-doc-band-and-clinician-gated',
    binds: [
      'lib/plan/injury-protocols.ts#resolveInjuryProtocol',
      'lib/plan/injury-protocols.ts#INJURY_PLAN_MAX_WEEKS',
    ],
    doc: 'Research/05-injury-return-protocols.md',
    anchor: '**All confirmed BSIs: no running until clinical clearance.**',
    claim:
      'A bone stress injury is the one place this engine must refuse to prescribe. Doctrine\'s ' +
      'contraindication is absolute, so every BSI protocol emits no running rows at all and ' +
      'shows a clearance gate instead of a return date. The total-return bands are the doc\'s ' +
      'own — eight to sixteen weeks for a low-risk site, four to nine months for a high-risk ' +
      'one — and the claim reads both out of §9.5 and §9.6 rather than trusting the numbers ' +
      'somebody copied across. A suspected BSI is held to the low-risk band until imaging says ' +
      'otherwise, never to a shorter one.',
    check({ cite }) {
      if (!/no running until clinical clearance/i.test(cite.section[0])) {
        throw new Error('§9.4 no longer states the absolute no-running contraindication for confirmed BSIs');
      }
      const bsi = {
        high: resolveInjuryProtocol({ site: 'navicular', severity: 'moderate' }),
        low: resolveInjuryProtocol({ site: 'tibial shaft stress fracture', severity: 'moderate' }),
        suspected: resolveInjuryProtocol({ site: 'stress reaction', severity: 'moderate' }),
      };
      for (const [name, r] of Object.entries(bsi)) {
        if (r.runStartWeek !== null) {
          throw new Error(`the ${name}-risk BSI protocol starts running at week ${r.runStartWeek} · doctrine says clinical clearance first`);
        }
        if (!r.clearanceRequired) throw new Error(`the ${name}-risk BSI protocol is not clearance-gated`);
        if (!r.protocol.clearanceGate) throw new Error(`the ${name}-risk BSI protocol shows no clearance gate`);
      }

      // §9.5 · low-risk total return, in weeks, read from the doc.
      const lowBand = parseBand(
        resolveCitation('Research/05-injury-return-protocols.md', '**Total return: 8-16 weeks typical.**').section[0],
      );
      for (const key of ['low', 'suspected'] as const) {
        const [lo, hi] = bsi[key].protocol.totalWeeks;
        if (lo !== lowBand[0] || hi !== lowBand[1]) {
          throw new Error(
            `the ${key}-risk BSI band is ${lo}-${hi} weeks, §9.5 states ${lowBand[0]}-${lowBand[1]}`,
          );
        }
      }

      // §9.6 · high-risk total return is stated in MONTHS. Accept any
      // whole-week rendering of the band, from 4.0 to 4.35 weeks per month.
      const months = parseBand(
        resolveCitation('Research/05-injury-return-protocols.md', '**Total return commonly 4-9 months.**').section[0],
      );
      const [hiLo, hiHi] = bsi.high.protocol.totalWeeks;
      if (hiHi == null) throw new Error('the high-risk BSI band has no upper bound · §9.6 states one');
      within(hiLo, [Math.floor(months[0] * 4), Math.ceil(months[0] * 4.35)], 'high-risk BSI band floor, in weeks');
      within(hiHi, [Math.floor(months[1] * 4), Math.ceil(months[1] * 4.35)], 'high-risk BSI band ceiling, in weeks');
      if (hiLo < lowBand[1]) {
        throw new Error(
          `the high-risk BSI band opens at ${hiLo} weeks, inside the low-risk band that ends at ` +
            `${lowBand[1]} · §9.2 stratifies these precisely because the high-risk sites take longer`,
        );
      }

      // The plan scaffold is shorter than the doctrine band on purpose. What
      // it may not do is be shorter than a band it claims to cover, or long
      // enough to imply the whole return has been written out.
      if (INJURY_PLAN_MAX_WEEKS < lowBand[0]) {
        throw new Error(
          `INJURY_PLAN_MAX_WEEKS is ${INJURY_PLAN_MAX_WEEKS}, under the ${lowBand[0]}-week floor ` +
            'of the shortest BSI return doctrine states',
        );
      }
      if (INJURY_PLAN_MAX_WEEKS >= hiHi) {
        throw new Error(
          `INJURY_PLAN_MAX_WEEKS is ${INJURY_PLAN_MAX_WEEKS} · at or past the ${hiHi}-week ` +
            'high-risk band it stops being a rolling scaffold and starts implying the whole ' +
            'clinician-led return has been authored here',
        );
      }
    },
  },

  {
    id: 'RAMP.acute-chronic-ratio-red-line',
    binds: ['lib/plan/validate.ts#ACWR_HIGH_RISK', 'lib/plan/validate.ts#ACWR_CHRONIC_WEEKS'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### ACWR risk zones',
    claim:
      'The second half of the weekly-volume guard is the acute-to-chronic workload ratio, which ' +
      'is the instrument doctrine actually publishes for "is this week too big for what I have ' +
      'been doing". The backstop sits on the row doctrine calls substantially elevated risk, ' +
      'and both the ratio and the length of the chronic window are READ OUT OF THE DOC — the ' +
      'risk-zone table for the threshold, the load-metrics table for the 28 days. A week-over-' +
      'week ratio was the wrong instrument: doctrine builds 20-30% down weeks into every block, ' +
      'so a WoW ceiling loose enough to permit the rebound cannot catch a real spike, which is ' +
      'precisely how the old 50% constant survived.',
    check({ cite }) {
      const src = sourceOf('web-v2/lib/plan/validate.ts');
      // The fitted constant it replaced does not come back. 50%/week was never
      // in Research/; it tracked whatever generate.ts happened to author, and
      // a per-distance row for a figure with no distance dimension was the tell.
      if (/weeklyVolWoWMaxPct/.test(stripComments(src))) {
        throw new Error(
          'weeklyVolWoWMaxPct is back in validate.ts · the weekly-volume guard is the ' +
            'acute:chronic ratio (this claim) plus the §3 ramp-vs-base check, both of which ' +
            'read their numbers out of Research/00a. A flat week-over-week percentage is the ' +
            'shape that was fitted to the generator in the first place.',
        );
      }
      const engineRatio = Number(
        matchLiteral(src, /const ACWR_HIGH_RISK = (\d*\.?\d+);/, 'ACWR_HIGH_RISK')[1],
      );
      const engineWeeks = Number(
        matchLiteral(src, /const ACWR_CHRONIC_WEEKS = (\d+);/, 'ACWR_CHRONIC_WEEKS')[1],
      );
      matchLiteral(src, /curr \/ chronic > ACWR_HIGH_RISK/, 'ACWR comparison');

      // The threshold, out of the risk-zone table · the row doctrine grades as
      // the high-risk one, not a hand-copied 1.5.
      const zones = cite.table();
      const highRows = zones.rows.filter((r) => /^high$/i.test((r['Status'] ?? '').trim()));
      if (highRows.length !== 1) {
        throw new Error(
          `Research/00a §"ACWR risk zones" no longer grades exactly one band "High" ` +
            `(found ${highRows.length}) · re-read the table before this backstop is justified`,
        );
      }
      const stated = Number((highRows[0][zones.headers[0]] ?? '').replace(/[^\d.]/g, ''));
      if (!(stated > 0)) {
        throw new Error('could not read the high-risk ACWR threshold out of the doctrine table');
      }
      if (engineRatio !== stated) {
        throw new Error(
          `ACWR_HIGH_RISK is ${engineRatio} · doctrine puts the substantially-elevated line at ` +
            `${stated}. A backstop above it permits what doctrine calls high risk; below it, the ` +
            'validator would reject inside the caution band the generator is allowed to use.',
        );
      }

      // And the window, out of the load-metrics table one section up.
      const metrics = resolveCitation(
        'Research/00a-distance-running-training.md',
        '### Load metrics',
      ).table();
      const chronicDays = Number(
        (metrics.cell('Chronic load (28-day)', 'Calculation').match(/last (\d+) days/) ?? [])[1],
      );
      if (!(chronicDays > 0)) {
        throw new Error(
          'Research/00a §"Load metrics" no longer states the chronic window in days · re-read it',
        );
      }
      if (engineWeeks !== chronicDays / 7) {
        throw new Error(
          `ACWR_CHRONIC_WEEKS is ${engineWeeks} · doctrine's chronic load is a ${chronicDays}-day ` +
            `mean, which is ${chronicDays / 7} weeks`,
        );
      }
    },
  },

  {
    id: 'CONVENTION.taper-descent-shape',
    binds: ['lib/plan/goal-tiers.ts#TAPER_DESCENT_SHAPE', 'lib/plan/goal-tiers.ts#taperFactor'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.2 Marathon taper structure (3 weeks)',
    claim:
      'The descent shape is HALF doctrine. That it lands the marathon inside §9.2\'s three ' +
      'volume bands is doctrine, and this claim derives the admissible interval for each entry ' +
      'from those bands rather than trusting the three-decimal literals. Two things about it are ' +
      'CONVENTION and are labelled as such: the precision (§9.2\'s bands are ten points wide, so ' +
      '0.727 and 0.327 are one choice inside a range, reverse-engineered to reproduce three ' +
      'legacy constants byte-for-byte) and the extrapolation (§9.2 is titled "Marathon taper ' +
      'structure"; doctrine states no week-by-week descent for any other distance, so rescaling ' +
      'it to their §9.1 depths is ours).',
    check({ cite }) {
      const t = cite.table();
      const src = sourceOf('web-v2/lib/plan/goal-tiers.ts');
      const shape = matchLiteral(
        src,
        /const TAPER_DESCENT_SHAPE = \[([^\]]+)\]/,
        'TAPER_DESCENT_SHAPE',
      )[1]
        .split(',')
        .map((s) => Number(s.trim()));

      // The race week is by definition the whole descent.
      if (shape[0] !== 1) {
        throw new Error(`TAPER_DESCENT_SHAPE opens at ${shape[0]} · the race week spends the entire descent`);
      }
      // Monotone · a taper never climbs back toward peak.
      for (let i = 1; i < shape.length; i++) {
        if (!(shape[i] < shape[i - 1])) {
          throw new Error(`TAPER_DESCENT_SHAPE does not descend between index ${i - 1} and ${i}`);
        }
      }

      // DERIVED FROM THE DOC · each entry's admissible interval, given the
      // marathon's own race-week depth. shape_i = (1 - f_i) / (1 - raceWeek).
      const span = 1 - TAPER_RACE_WEEK_PCT_OF_PEAK.m;
      const docWeeks = ['-1', '-2', '-3'];
      for (let i = 0; i < shape.length; i++) {
        const [lo, hi] = parsePctBand(t.cell(docWeeks[i], 'Volume'));
        const admissible: [number, number] = [(1 - hi) / span, (1 - lo) / span];
        within(
          shape[i],
          [Math.min(...admissible), Math.max(...admissible)],
          `TAPER_DESCENT_SHAPE[${i}] against §9.2's "${t.cell(docWeeks[i], 'Volume')}" band`,
        );
      }

      // THE EXTRAPOLATION · doctrine covers only the marathon, so the other
      // four owe the properties §9.1 does state: never above peak, never
      // shallower than their own race-week depth, monotone all the way down.
      for (const cat of CATS) {
        for (let w = 1; w <= shape.length; w++) {
          const f = taperFactor(cat, w);
          if (f > 1) throw new Error(`taperFactor(${cat}, ${w}) is ${f} · above peak volume`);
          if (f < TAPER_RACE_WEEK_PCT_OF_PEAK[cat]) {
            throw new Error(
              `taperFactor(${cat}, ${w}) is ${f}, below that distance's own §9.1 race-week depth ` +
                `of ${TAPER_RACE_WEEK_PCT_OF_PEAK[cat]} · the extrapolated shape has cut deeper ` +
                'than doctrine states for the race week itself',
            );
          }
        }
      }

      // The file must keep saying which half is ours.
      if (!/CONVENTION · the three-decimal PRECISION/.test(src)) {
        throw new Error(
          'goal-tiers.ts no longer records that the descent shape\'s precision and its ' +
            'extrapolation past the marathon are conventions · that sentence is this claim\'s point',
        );
      }
    },
  },

  {
    id: 'CONVENTION.acwr-sampling-guards',
    binds: [
      'lib/coach/acwr.ts#ACWR_MIN_RUN_DAYS',
      'lib/coach/acwr.ts#ACWR_MIN_CHRONIC_MI_PER_DAY',
      'lib/coach/acwr.ts#RUN_DAY_MIN_MI',
    ],
    doc: 'Research/15-wearable-data.md',
    anchor: 'ACWR = acute_load_7d / chronic_load_28d',
    claim:
      'THE THREE ACWR SAMPLING GUARDS ARE CONVENTIONS. Research/15 defines the ratio and states ' +
      'its bands; it says nothing about how much data must be present before the ratio is ' +
      'honest, because that is a question about our pipeline rather than about physiology. The ' +
      'WINDOWS are doctrine and are bound elsewhere. What these three owe is that each only ever ' +
      'SUPPRESSES a reading — a guard that could inflate a ratio would be inventing load — that ' +
      'each stays inside the window it samples, and that none can be loosened far enough for the ' +
      'algebraic identity the coverage guard exists to stop to reappear. Note the trap not ' +
      'taken: Research/15 does carry a "3", but it is three HRV readings a week, not three run ' +
      'days, and binding to it would be the adjacent-column misread with a citation that resolved.',
    check({ cite }) {
      // The windows this claim's guards sample are still the doc's.
      const line = cite.section[0];
      const chronic = Number(line.match(/chronic_load_(\d+)d/)?.[1]);
      if (!Number.isFinite(chronic)) throw new Error(`could not read the chronic window out of ${cite.doc}`);

      if (!(ACWR_MIN_RUN_DAYS > 0 && ACWR_MIN_RUN_DAYS <= chronic)) {
        throw new Error(
          `ACWR_MIN_RUN_DAYS is ${ACWR_MIN_RUN_DAYS} · it must ask for at least one run day and ` +
            `cannot ask for more than the ${chronic}-day window contains`,
        );
      }
      if (!(ACWR_MIN_CHRONIC_MI_PER_DAY > 0)) {
        throw new Error('ACWR_MIN_CHRONIC_MI_PER_DAY is not positive · the near-zero-denominator guard is off');
      }
      if (!(RUN_DAY_MIN_MI > 0 && RUN_DAY_MIN_MI < 1)) {
        throw new Error(
          `RUN_DAY_MIN_MI is ${RUN_DAY_MIN_MI} · a run-day floor of a mile or more would discard real ` +
            'recovery shakeouts from the denominator and inflate the ratio',
        );
      }

      // SUPPRESSES ONLY · each guard's failure mode is a null, never a number.
      // Falsifier: a runner with a full chronic window but only two run days.
      const today = '2026-03-08';
      const sparse = new Map<string, number>();
      sparse.set(today, 8);
      sparse.set(new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10), 8);
      const out = acwrFromDailyMileage(sparse, today, chronic);
      if (out.acwr !== null) {
        throw new Error(
          `a runner with ${sparse.size} run days in the chronic window reports ACWR ${out.acwr} · ` +
            `ACWR_MIN_RUN_DAYS (${ACWR_MIN_RUN_DAYS}) is not suppressing it`,
        );
      }
      if (out.reason !== 'insufficient_runs' && out.reason !== 'no_chronic_load') {
        throw new Error(`a two-run chronic window is absent for the wrong reason: ${out.reason}`);
      }

      // The file must keep saying these are ours.
      if (!/THE THREE SAMPLING GUARDS ARE CONVENTIONS/.test(sourceOf('web-v2/lib/coach/acwr.ts'))) {
        throw new Error('acwr.ts no longer records that its sampling guards are conventions rather than doctrine');
      }
    },
  },

  {
    id: 'CONVENTION.simulator-response-parameters',
    binds: [
      'lib/plan/simulator.ts#DENSITY_PENALTY',
      'lib/plan/simulator.ts#PLATEAU_FLOOR_VDOT',
      'lib/plan/simulator.ts#QUALITY_DENSITY_CEILING',
      'lib/plan/simulator.ts#RAMP_FLAG_THRESHOLD',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Workout dose by race distance',
    claim:
      'CONVENTION.fitness-response-model bound the simulator\'s cold-start calibration and its ' +
      'baseGain and stopped there. The rest of the model\'s parameters were FUNCTION-LOCAL, and ' +
      'therefore invisible to a lint that scans for names — the same evasion, in a different ' +
      'shape, as the wrapper generics that hid eight per-distance tables. They are module-level ' +
      'and labelled now. Two are doctrine-derived: the density ceiling is the three-quality ' +
      'sessions this table caps every tier at, and it must equal what QUALITY.sessions-per-week ' +
      'reads. Two are ours: the 0.7 remainder past that ceiling and the VDOT-50 plateau floor ' +
      'appear in no Research/ doc, and the 0.7 carried a bare "(Daniels)" attribution with ' +
      'nothing to open — the same shape as the fabricated 0.5 VDOT/week.',
    check({ cite }) {
      const t = cite.table();
      const src = sourceOf('web-v2/lib/plan/simulator.ts');

      // DOCTRINE · the density ceiling is the tier ceiling, read from the same
      // table QUALITY.sessions-per-week reads, and from the engine's own tiers.
      const tierMax = Math.max(
        ...CATS.flatMap((cat) => TIERS.map((tier) => TIER_TARGETS[cat][tier].qualityPerWeek)),
      );
      if (QUALITY_DENSITY_CEILING !== tierMax) {
        throw new Error(
          `QUALITY_DENSITY_CEILING is ${QUALITY_DENSITY_CEILING} but the highest qualityPerWeek ` +
            `any tier runs is ${tierMax} · the simulator is penalising a density the planner ` +
            'either never reaches or routinely exceeds',
        );
      }
      if (t.rows.length === 0) {
        throw new Error('the workout-dose table is gone from Research/00a · the density ceiling has nothing under it');
      }

      // CONVENTION · bounded, and honest about being ours.
      if (!(DENSITY_PENALTY > 0 && DENSITY_PENALTY < 1)) {
        throw new Error(
          `DENSITY_PENALTY is ${DENSITY_PENALTY} · past the density ceiling returns must diminish, ` +
            'not vanish and not increase',
        );
      }
      if (!(PLATEAU_FLOOR_VDOT >= DANIELS_VDOT_MIN && PLATEAU_FLOOR_VDOT < DANIELS_VDOT_MAX)) {
        throw new Error(
          `PLATEAU_FLOOR_VDOT is ${PLATEAU_FLOOR_VDOT} · outside the published VDOT table ` +
            `(${DANIELS_VDOT_MIN}-${DANIELS_VDOT_MAX}) the saturation term is modelling nobody`,
        );
      }
      // The ramp flag must sit inside the two bands doctrine does publish, and
      // must state the threshold it actually tests.
      const spec = resolveCitation('Research/00a-distance-running-training.md', '### Volume progression rules')
        .table()
        .cell('Year-on-year base growth', 'Specification');
      const trained = parseBand(spec.split(';')[0]);
      const novice = parseBand(spec.replace(/^[^;]*;\s*/, ''));
      within(
        RAMP_FLAG_THRESHOLD * 100,
        [trained[0], novice[1]],
        'RAMP_FLAG_THRESHOLD against the ramp figures doctrine publishes',
      );
      if (/exceeds 10% rule/.test(stripComments(src))) {
        throw new Error(
          'the volume-ramp risk flag says "exceeds 10% rule" again · it tests a different number, ' +
            'and Research/00a §"The 10% rule — reconsidered" is the section that DEBUNKS that rule ' +
            'as a general-case ceiling (see DOCTRINE-7)',
        );
      }
      // A bare "(Daniels)" on the density penalty is a citation with nothing
      // to open · that is how the 0.5 VDOT/week fabrication survived.
      const code = stripComments(src);
      if (/Daniels/.test(code)) {
        throw new Error('an executing line in simulator.ts names Daniels · this model is ours, not his');
      }
      if (!/CONVENTION\. That returns diminish past a quality-density ceiling/.test(src)) {
        throw new Error('simulator.ts no longer records that its density penalty is a convention');
      }
    },
  },

  {
    id: 'CONVENTION.simulator-projection-band',
    binds: [
      'lib/plan/simulator.ts#SIGMA_SEC_PER_MILE',
      'lib/plan/simulator.ts#BAND_SIGMAS',
      'lib/plan/simulator.ts#simulate.confidence',
      'lib/plan/simulator.ts#simulate',
      'lib/plan/gap-report.ts#confidenceBand',
    ],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '### 13.7 Confidence Intervals to Report with Predictions',
    claim:
      'THE PROJECTION BAND IS A CONVENTION AND IT REACHES A RUNNER. gap-report.ts turns the ' +
      'simulator\'s p25 / median / p75 straight into the A-goal / B-goal / C-goal a runner is ' +
      'shown, so the four numbers behind it — a per-distance sigma and a 1.5-sigma half-width — ' +
      'are a precision claim made to a person. Nothing in Research/ states a projection interval; ' +
      '§13.7 is the only table in the corpus that says how wide a REPORTED prediction interval ' +
      'should be, and its tightest entry is the floor this band cannot honestly sit under. A ' +
      'projection of a runner\'s unmeasured future fitness — built on a response model that is ' +
      'itself entirely convention — cannot be more certain than a same-day cross-distance ' +
      'prediction from a race that actually happened.',
    check({ cite, exempt }) {
      const tightestPct = Math.min(
        ...cite.table().rows.map((r) => parseBand(r[cite.table().headers[1]])[0]),
      );
      if (!(tightestPct > 0)) throw new Error('§13.7 no longer states any confidence interval');

      // Shape first · a band that is not centred, or a sigma that shrinks with
      // distance, would be wrong whatever the magnitudes.
      if (!(BAND_SIGMAS > 0)) throw new Error(`BAND_SIGMAS is ${BAND_SIGMAS} · a zero-width band claims certainty`);
      for (let i = 1; i < SIGMA_SEC_PER_MILE.length; i++) {
        if (SIGMA_SEC_PER_MILE[i].sigma <= SIGMA_SEC_PER_MILE[i - 1].sigma) {
          throw new Error(
            'SIGMA_SEC_PER_MILE does not widen with distance · §8 of this doc is explicit that ' +
              'prediction error grows non-linearly with distance because failure modes multiply',
          );
        }
        if (SIGMA_SEC_PER_MILE[i].throughMi <= SIGMA_SEC_PER_MILE[i - 1].throughMi) {
          throw new Error('SIGMA_SEC_PER_MILE bands are not in ascending distance order');
        }
      }

      // Magnitude · the band as a percentage of a mid-table runner's predicted
      // time, against the tightest interval doctrine publishes for anything.
      const anchorVdot = 48;
      const failures: string[] = [];
      for (const label of ['5K', '10K', 'half', 'marathon'] as const) {
        const mi = TABLE_RACE_DISTANCE_MI[label];
        const median = predictRaceTime(anchorVdot, mi);
        if (median == null) continue;
        const sigma = (SIGMA_SEC_PER_MILE.find((b) => mi <= b.throughMi)
          ?? SIGMA_SEC_PER_MILE[SIGMA_SEC_PER_MILE.length - 1]).sigma * mi;
        const pct = (BAND_SIGMAS * sigma) / median * 100;
        if (pct < tightestPct && !exempt(`band-tighter-than-doctrine:${label}`)) {
          failures.push(`${label}: ±${pct.toFixed(2)}% vs §13.7's tightest ±${tightestPct}%`);
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `the projection band claims more precision than §13.7 reports for any prediction span:\n` +
            `    ${failures.join('\n    ')}\n` +
            '    These become the runner\'s A-goal and C-goal. Widen the band or record the ' +
            'violation — do not widen this claim.',
        );
      }

      // THE PER-WEEK CONFIDENCE DECAY · also a convention, and the only
      // properties it can honestly owe are shape ones: it starts at full
      // confidence for the week in hand, never rises as the horizon extends,
      // and never reaches zero (a projection nobody should look at should not
      // be published at all, rather than published at confidence 0).
      const horizon = Array.from({ length: 24 }, (_, i) => ({
        weekIdx: i,
        startISO: '2026-01-05',
        phase: 'BUILD',
        weeklyMi: 30,
        qualitySessions: 2,
        longRunMi: 9,
      }));
      const traj = simulate({
        weeks: horizon,
        startVdot: anchorVdot,
        raceDistanceMi: TABLE_RACE_DISTANCE_MI.marathon,
        calibration: COLD_START_CALIBRATION,
      }).weeklyTrajectory;
      if (traj[0].confidence !== 1) {
        throw new Error(`week 0 is projected at confidence ${traj[0].confidence} · this week is the week we know`);
      }
      for (let i = 1; i < traj.length; i++) {
        if (traj[i].confidence > traj[i - 1].confidence) {
          throw new Error(
            `projection confidence RISES between week ${i - 1} and week ${i} · a further-out ` +
              'week cannot be better known than a nearer one',
          );
        }
      }
      if (!(traj[traj.length - 1].confidence > 0)) {
        throw new Error('the confidence decay reaches zero · a projection worth nothing should not be published');
      }

      // The band must still be what gap-report reads · a claim bound to a
      // number nothing consumes guards nothing.
      if (!/finalProjection\.p25Sec/.test(sourceOf('web-v2/lib/plan/gap-report.ts'))) {
        throw new Error('gap-report.ts no longer reads the simulator band · re-point this claim at whatever sets the A/B/C goals');
      }
    },
    exempt: {
      'band-tighter-than-doctrine:5K':
        'REAL VIOLATION, RUNNER-FACING, NOT FIXED HERE. At a VDOT-48 anchor the 5K band is ' +
        '±0.38% against §13.7\'s tightest published interval of ±1.5% — roughly four times too ' +
        'confident. Concretely: a 19:46 projection produces an A-goal of 19:41 and a C-goal of ' +
        '19:51. Ten seconds apart is not three goals, it is one goal printed three times, and it ' +
        'is asserting a precision no table in Research/ supports for any prediction at any ' +
        'distance. Widening it changes what every 5K runner is shown, which is a product ' +
        'decision rather than a gate fix, so it is recorded here for David rather than taken ' +
        'unilaterally. Delete this entry when SIGMA_SEC_PER_MILE\'s short-distance rows are ' +
        'resized against §13.7.',
      'band-tighter-than-doctrine:10K':
        'REAL VIOLATION, RUNNER-FACING, NOT FIXED HERE. Same defect as the 5K row, half as ' +
        'severe: ±0.73% against §13.7\'s ±1.5% floor, so a 40:59 projection spans 38 seconds ' +
        'from A-goal to C-goal. §13.7\'s own 5K→10K row — a prediction from a race that ' +
        'actually happened, on the day — is ±1.5%, and a projection of fitness a runner does ' +
        'not have yet cannot be twice as certain as that. Recorded with the 5K row; they get ' +
        'resized together.',
      'band-tighter-than-doctrine:half':
        'REAL VIOLATION, MARGINAL. ±1.38% against §13.7\'s ±1.5% floor — under the line but ' +
        'only just, and in the same direction as the two short distances. Listed rather than ' +
        'rounded away because the marathon row clears the floor comfortably (±3.46% against a ' +
        '±3% half→marathon entry), which shows the shape of the defect: the per-mile sigma is ' +
        'calibrated for the marathon and everything shorter inherits a band that is too tight. ' +
        'Delete this entry with the other two.',
    },
  },

  // ══ AEROBIC DECOUPLING ════════════════════════════════════════════════════
  {
    id: 'DECOUPLING.protocol-duration',
    binds: [
      'lib/training/aerobic-decoupling.ts#DECOUPLING_PROTOCOL_MIN_MINUTES',
      'lib/training/aerobic-decoupling.ts#computeAerobicDecoupling',
      'lib/training/decoupling-trend.ts#computeDecouplingTrend',
      'lib/coach/limiter.ts#DECOUPLING_ENDURANCE_GAP_PCT',
      // 2026-08-31 · the durability anchor's decoupling sub-read is a THIRD
      // consumer of this same gated function and duration floor — it does
      // not re-derive either, it calls `computeAerobicDecoupling` unchanged
      // (see `qualifyingDecouplingObservation`), so it rides this claim's
      // existing `check()` rather than needing one of its own.
      'lib/training/durability-anchor.ts#qualifyingDecouplingObservation',
      'lib/training/durability-anchor.ts#loadDecouplingObservations',
    ],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: 'Compare first vs. second half of a steady aerobic run (60–90 min).',
    claim:
      'The Pa:HR decoupling protocol is stated in TIME, not distance · §12 gives it as a ' +
      'steady aerobic run of 60-90 minutes, repeats it under Use as a "fixed 60-min run", ' +
      'and §16 lists the instrument as the "60-min drift run". The engine gates on the ' +
      "floor of that window, measured on the segment it actually compares. It used to gate " +
      'on six miles, a quantity doctrine states nowhere: 36 minutes for a 6:00/mi runner and ' +
      '78 for a 12:00/mi runner, which both read drift off efforts too short to have any and ' +
      'left the whole surface dark for short-distance runners.',
    check({ cite }) {
      // The window, read out of the anchor line itself.
      const [lo, hi] = parseBand(
        matchLiteral(cite.text(), /steady aerobic run \(([^)]+)\)/, '§12 protocol duration')[1],
      );
      if (!(lo > 0 && hi > lo)) throw new Error(`§12 no longer states a duration window · got ${lo}-${hi}`);
      if (DECOUPLING_PROTOCOL_MIN_MINUTES !== lo) {
        throw new Error(
          `DECOUPLING_PROTOCOL_MIN_MINUTES = ${DECOUPLING_PROTOCOL_MIN_MINUTES} · §12's protocol ` +
            `runs ${lo}-${hi} min, so the floor is ${lo}`,
        );
      }
      // §12's Use clause states the same number a second way, and §16's Field
      // Alternatives table names the instrument by it a third. All three must
      // agree, or the doc is describing more than one instrument. Read off the
      // whole file: the anchor's own section stops at the next heading, and
      // both of these sit below it.
      const doc03 = sourceOf('Research/03-heart-rate-zones.md');
      const useMin = Number(
        matchLiteral(doc03, /fixed (\d+)-min run/, "§12 Use clause's fixed drift run")[1],
      );
      const fieldMin = Number(
        matchLiteral(doc03, /\|\s*(\d+)-min drift run\s*\|/, "§16's Field Alternatives drift-run row")[1],
      );
      if (fieldMin !== DECOUPLING_PROTOCOL_MIN_MINUTES) {
        throw new Error(`§16 lists a ${fieldMin}-min drift run · the engine gates at ${DECOUPLING_PROTOCOL_MIN_MINUTES}`);
      }
      if (useMin !== DECOUPLING_PROTOCOL_MIN_MINUTES) {
        throw new Error(`§12's Use clause says ${useMin} min · the engine gates at ${DECOUPLING_PROTOCOL_MIN_MINUTES}`);
      }
      // And the gate is actually a duration gate in the source, not a distance
      // one wearing the constant's name. This claim exists because a distance
      // gate that looked reasonable stood for months.
      const src = sourceOf('web-v2/lib/training/aerobic-decoupling.ts');
      if (/distanceMi\s*<\s*\d/.test(stripComments(src))) {
        throw new Error('computeAerobicDecoupling is gated on a distance threshold again');
      }
      if (!/durationMin\s*>=\s*DECOUPLING_PROTOCOL_MIN_MINUTES/.test(stripComments(src))) {
        throw new Error('computeAerobicDecoupling no longer gates on the protocol duration');
      }
      // The trend surface must not reintroduce the gate in SQL, which is how it
      // inherited the old one.
      const trend = stripComments(sourceOf('web-v2/lib/training/decoupling-trend.ts'));
      const sqlFloor = Number(matchLiteral(trend, /runDistanceMiSql\('r'\)\}\s*>=\s*(\d+)/, 'trend distance prefilter')[1]);
      // Four miles is the fewest mile-splits the computation can halve; anything
      // above that starts excluding runs the duration gate would have admitted.
      if (sqlFloor > 4) {
        throw new Error(
          `decoupling-trend prefilters at >= ${sqlFloor} mi · that is a distance gate again, and it ` +
            'hides exactly the slower runners whose 5-mile long run IS a 60-minute steady effort',
        );
      }
    },
  },
  {
    id: 'DECOUPLING.interpretation-bands',
    binds: [
      'lib/training/aerobic-decoupling.ts#DECOUPLING_BAND_STRONG_PCT',
      'lib/training/aerobic-decoupling.ts#DECOUPLING_BAND_ACCEPTABLE_PCT',
      'lib/training/aerobic-decoupling.ts#DECOUPLING_BAND_ABOVE_AET_PCT',
      'lib/coach/limiter.ts#DECOUPLING_ENDURANCE_GAP_PCT',
    ],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| Decoupling % | Meaning |',
    claim:
      "Every boundary the app uses to band a drift reading is a boundary §12's interpretation " +
      'table publishes: <5% strong, 5-8% acceptable, 8-10% endurance gap, >10% above aerobic ' +
      'threshold. The engine held a 7 for years, which is not in the table — it split the ' +
      '"5-8% Acceptable" row down the middle, so the run card called a 7.5% reading poor while ' +
      "limiter.ts (reading the same table's 8-10% row) said the aerobic base was fine.",
    check({ cite }) {
      // Read the four row labels out of the doc and take their boundaries.
      const rows = cite.section
        .filter((l) => /^\|/.test(l) && /%/.test(l) && !/Decoupling %/.test(l) && !/^\|\s*-+/.test(l))
        .map((l) => l.split('|')[1].trim());
      if (rows.length !== 4) {
        throw new Error(`§12's interpretation table now has ${rows.length} rows, not 4 · re-read the claim`);
      }
      // Boundaries are the distinct numbers the rows name, in order.
      const bounds = [...new Set(rows.flatMap((r) => parseBand(r)))].sort((a, b) => a - b);
      const expected = [
        DECOUPLING_BAND_STRONG_PCT,
        DECOUPLING_BAND_ACCEPTABLE_PCT,
        DECOUPLING_BAND_ABOVE_AET_PCT,
      ];
      for (const e of expected) {
        if (!bounds.includes(e)) {
          throw new Error(`engine band boundary ${e}% is not one §12 publishes · doc states ${bounds.join(', ')}`);
        }
      }
      // The limiter's endurance-gap threshold is the floor of the row that
      // names an endurance gap, not any of the others.
      const gapRow = rows.find((_, i) =>
        /endurance gap/i.test(cite.section.filter((l) => /^\|/.test(l) && /%/.test(l) && !/Decoupling %/.test(l) && !/^\|\s*-+/.test(l))[i]),
      );
      if (!gapRow) throw new Error('§12 no longer names an "Endurance gap" row');
      if (DECOUPLING_ENDURANCE_GAP_PCT !== parseBand(gapRow)[0]) {
        throw new Error(
          `DECOUPLING_ENDURANCE_GAP_PCT = ${DECOUPLING_ENDURANCE_GAP_PCT} · §12's endurance-gap row ` +
            `opens at ${parseBand(gapRow)[0]}%`,
        );
      }
      // The band boundaries must be shared, not re-typed per surface. Two
      // copies of a boundary is how the 7 survived in two files.
      const trend = stripComments(sourceOf('web-v2/lib/training/decoupling-trend.ts'));
      if (/currentDriftPct\s*<\s*\d/.test(trend)) {
        throw new Error('decoupling-trend banded on a literal again · read the shared constants');
      }
    },
  },

  // ══ DURABILITY ANCHOR ═══════════════════════════════════════════════════
  //
  // 2026-08-31 · the fitness-vector rebuild's durability anchor
  // (`lib/training/durability-anchor.ts`): a personal Riegel exponent fitted
  // from the runner's own race history, shrunk toward the population
  // default, plus a corroborated aerobic-decoupling read across long runs.
  {
    id: 'DURABILITY.population-endurance-prior',
    binds: ['lib/training/durability-anchor.ts#POPULATION_ENDURANCE_PRIOR'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: 'T2 = T1 × (D2 / D1)^1.06',
    claim:
      'The population endurance PRIOR the durability anchor shrinks a runner\'s own fitted ' +
      'Riegel exponent toward — named a prior, not a physiological law, because it is a ' +
      'cross-sport population mean the engine may later refine, not an unrevisable constant ' +
      '(see the code\'s own header) — currently equals 1.06, the exact exponent Research/02 ' +
      '§2.1\'s Riegel formula states, read out of the formula at run time rather than ' +
      'hardcoded on both sides.',
    check({ cite }) {
      const m = matchLiteral(cite.text(), /\^\s*([\d.]+)/, 'Riegel formula exponent');
      const docExponent = Number(m[1]);
      const src = sourceOf('web-v2/lib/training/durability-anchor.ts');
      const codeM = matchLiteral(src, /export const POPULATION_ENDURANCE_PRIOR = ([\d.]+);/, 'POPULATION_ENDURANCE_PRIOR');
      const codeExponent = Number(codeM[1]);
      if (Math.abs(docExponent - codeExponent) > 0.0001) {
        throw new Error(
          `POPULATION_ENDURANCE_PRIOR is ${codeExponent} · Research/02 §2.1's formula states ${docExponent}`,
        );
      }
      // §1 restates the same number a second way ("fatigue exponent (≈ 1.06
      // for most runners...")) — both mentions must agree, the same
      // discipline DECOUPLING.protocol-duration applies to its own doc's
      // repeated statement of one number.
      const doc02 = sourceOf('Research/02-race-time-prediction.md');
      const s1M = matchLiteral(doc02, /fatigue exponent \(≈\s*([\d.]+)/, '§1 fatigue exponent restatement');
      if (Math.abs(Number(s1M[1]) - codeExponent) > 0.0001) {
        throw new Error(
          `§1 restates the fatigue exponent as ${s1M[1]} · POPULATION_ENDURANCE_PRIOR is ${codeExponent}`,
        );
      }
      // The naming discipline itself: a future reader must not be able to
      // mistake this for unrevisable physiology.
      if (!/deliberately "prior", not "constant" or "law"/.test(src)) {
        throw new Error(
          'durability-anchor.ts no longer states that POPULATION_ENDURANCE_PRIOR is a refinable ' +
            'prior, not a physiological constant — that framing is the whole point of this claim',
        );
      }
    },
  },

  /* ── A CONVENTION claim · durability's shrinkage weighting ────────────────
   *
   * No `Research/` file models how confident a PERSONAL Riegel-exponent fit
   * should be, or how fast that confidence should decay with a widening gap
   * between races. What grounds the shrinkage's SHAPE is `Research/02` §2.1's
   * own stated range for Riegel ("1500m to marathon") — the spread target is
   * that range's own span, not a number invented independently of doctrine —
   * and the owner's own worked instruction that races far apart in time may
   * no longer measure the same underlying fitness. The weighting itself
   * (equal-weighted average of four components) is engineering judgement,
   * stated as such rather than dressed up as research.
   */
  {
    id: 'CONVENTION.durability-race-exponent-shrinkage',
    binds: [
      'lib/training/durability-anchor.ts#RACE_EXPONENT_SATURATION_RACES',
      'lib/training/durability-anchor.ts#RACE_EXPONENT_SPREAD_TARGET_LN',
      'lib/training/durability-anchor.ts#RACE_EXPONENT_TIME_COHERENCE_HALFLIFE_DAYS',
      'lib/training/durability-anchor.ts#RACE_EXPONENT_CONSISTENCY_LOOSE_LN',
      'lib/training/durability-anchor.ts#fitRaceExponent',
    ],
    doc: 'Research/02-race-time-prediction.md',
    anchor: 'Designed for events 3.5–230 minutes (≈ 1500m to marathon).',
    claim:
      'The confidence a personal Riegel-exponent fit deserves is a CONVENTION, not a research ' +
      'finding — Research/02 does not model fit confidence for an individual runner. What it ' +
      'grounds is the SPREAD TARGET: a fit spanning Riegel\'s own stated design range (1500m to ' +
      'marathon) sees the distances the formula was built for, so the spread component of ' +
      'confidence is keyed to that span rather than an unargued number. The engine must state ' +
      'plainly that the weighting itself is a convention.',
    check() {
      const src = sourceOf('web-v2/lib/training/durability-anchor.ts');
      if (!/THIS NUMBER IS A CONVENTION, NOT A RESEARCH FINDING/.test(src)) {
        throw new Error(
          'durability-anchor.ts no longer states that the half-life is a convention · that ' +
            'sentence is the whole point of this claim family',
        );
      }
      if (!/CONVENTION, not doctrine: `Research\/02` names no race/.test(src)) {
        throw new Error('RACE_EXPONENT_SATURATION_RACES no longer states its convention status');
      }
      // The spread target must actually be Riegel's own stated design range
      // (1500m ≈ 0.932 mi, to marathon 26.2 mi), read out of the doc, not
      // hand-copied.
      const doc02 = sourceOf('Research/02-race-time-prediction.md');
      if (!/1500m to marathon/.test(doc02)) {
        throw new Error('Research/02 no longer states the "1500m to marathon" design range this spread target reuses');
      }
      const m = matchLiteral(
        src, /RACE_EXPONENT_SPREAD_TARGET_LN = Math\.log\(([\d.]+) \/ ([\d.]+)\);/,
        'RACE_EXPONENT_SPREAD_TARGET_LN',
      );
      const [hiMi, loMi] = [Number(m[1]), Number(m[2])];
      // Marathon distance is unambiguous; the short end just has to be a
      // genuinely short distance (well under 10K) so the target reflects a
      // real multi-distance spread rather than two adjacent race lengths.
      if (Math.abs(hiMi - 26.2) > 0.5) {
        throw new Error(`RACE_EXPONENT_SPREAD_TARGET_LN's long end is ${hiMi} mi · expected ~26.2 (marathon)`);
      }
      if (!(loMi > 0 && loMi < 6.2)) {
        throw new Error(`RACE_EXPONENT_SPREAD_TARGET_LN's short end is ${loMi} mi · expected a short race, under 10K`);
      }
      // The consistency threshold must be Research/02 §2.3's own reported
      // "Half → marathon" error band's upper (loosest) edge, read out of the
      // table at run time rather than hand-copied.
      const table = resolveCitation('Research/02-race-time-prediction.md', '| Distance gap | Typical error band | Notes |').table();
      const cell = table.cell('Half → marathon', 'Typical error band').replace(/±/g, '');
      const [, hiPct] = parsePctBand(cell);
      const expectedLn = Math.log(1 + hiPct);
      const m2 = matchLiteral(
        src, /RACE_EXPONENT_CONSISTENCY_LOOSE_LN = Math\.log\(([\d.]+)\);/,
        'RACE_EXPONENT_CONSISTENCY_LOOSE_LN',
      );
      const codeLn = Math.log(Number(m2[1]));
      if (Math.abs(codeLn - expectedLn) > 0.001) {
        throw new Error(
          `RACE_EXPONENT_CONSISTENCY_LOOSE_LN is ln(${m2[1]}) · Research/02 §2.3's Half → ` +
            `marathon row's upper edge is ±${(hiPct * 100).toFixed(0)}%, which is ln(${(1 + hiPct).toFixed(4)})`,
        );
      }
    },
  },

  /* ── A CONVENTION claim · durability's own half-life and the decoupling
   * aggregate's confidence weighting. Same discipline as the shrinkage claim
   * above: state plainly that the numbers are engineering judgement, and gate
   * that the source keeps saying so.
   */
  {
    id: 'CONVENTION.durability-half-life-and-decoupling-confidence',
    binds: [
      'lib/training/durability-anchor.ts#DURABILITY_HALF_LIFE_DAYS',
      'lib/training/durability-anchor.ts#DECOUPLING_LOOKBACK_DAYS',
      'lib/training/durability-anchor.ts#DECOUPLING_SATURATION_OBSERVATIONS',
      'lib/training/durability-anchor.ts#aggregateDecoupling',
    ],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| Decoupling % | Meaning |',
    claim:
      'How slowly the durability anchor decays (84 days / 12 weeks), how many corroborating long ' +
      'runs its decoupling read needs, and how it weighs consistency across them are all ' +
      'CONVENTIONS — no `Research/` file models a decay half-life or a corpus size for this ' +
      'trait. The engine must say so explicitly rather than presenting an invented number as a ' +
      'research finding, and the decoupling aggregate must keep reading its per-run math from ' +
      'the SAME gated function (`computeAerobicDecoupling`) §12\'s interpretation table already ' +
      'governs, not a second one.',
    check({ cite }) {
      const src = sourceOf('web-v2/lib/training/durability-anchor.ts');
      if (!/THIS NUMBER IS A CONVENTION, NOT A RESEARCH FINDING/.test(src)) {
        throw new Error('durability-anchor.ts no longer states the half-life is a convention');
      }
      if (!/CONVENTION: a spread under `LOW_PP`/.test(src)) {
        throw new Error('the decoupling consistency band no longer states its convention status');
      }
      const m = matchLiteral(src, /export const DURABILITY_HALF_LIFE_DAYS = (\d+);/, 'DURABILITY_HALF_LIFE_DAYS');
      if (!(Number(m[1]) > 0)) throw new Error('DURABILITY_HALF_LIFE_DAYS must be positive');
      // The decoupling aggregate must not re-implement the per-run math §12
      // governs · it calls the shared, doctrine-gated function.
      if (!/computeAerobicDecoupling/.test(src)) {
        throw new Error('durability-anchor.ts no longer calls the shared computeAerobicDecoupling — a second implementation would be ungated');
      }
      // The table this file's decoupling read ultimately reports against
      // must still exist — same liveness check DECOUPLING.interpretation-bands
      // performs, cited here too since this claim also rests on it existing.
      const rows = cite.section.filter((l) => /^\|/.test(l) && /%/.test(l));
      if (rows.length === 0) throw new Error('§12\'s interpretation table is gone');
    },
  },

  /* ── A CONVENTION claim · the runner model's confidence scale. The four
   * capacity resolvers (lib/training/capacity-resolver.ts) grade how much to
   * trust every fitness belief this app holds, and every number in that scale
   * is engineering judgement rather than a research finding. Same discipline as
   * the two durability claims above: gate that the source SAYS SO, gate the one
   * structural property the whole scheme rests on, and read the one number that
   * IS doctrine-grounded out of the doc at run time.
   */
  {
    id: 'CONVENTION.capacity-confidence-bands',
    binds: [
      'lib/training/capacity-resolver.ts#CAPACITY_CONFIDENCE_BANDS',
      'lib/training/capacity-resolver.ts#CAPACITY_SATURATION_OBSERVATIONS',
      'lib/training/capacity-resolver.ts#CAPACITY_CONFIDENCE_HALF_LIFE_DAYS',
      'lib/training/capacity-resolver.ts#CAPACITY_CONSISTENCY_BAND',
      'lib/training/capacity-resolver.ts#directEvidenceConfidence',
    ],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '| Distance gap | Typical error band | Notes |',
    claim:
      'How much to trust a capacity estimate is a CONVENTION — no `Research/` file models ' +
      'confidence for a fitness belief. What doctrine DOES ground is the consistency band: ' +
      "Research/02 §2.3's own reported accuracy table gives the error band doctrine expects " +
      'between two honest readings of one stable trait, and the engine keys "these observations ' +
      'agree / disagree" to that band rather than to an unargued number. The engine must state ' +
      'plainly that the rest of the scale is a convention, and the three confidence bands must ' +
      'not overlap — that non-overlap is what makes BRIEF 01\'s "as direct evidence accumulates, ' +
      'fallback assumptions lose authority" structurally true instead of a tuning outcome.',
    check() {
      const src = sourceOf('web-v2/lib/training/capacity-resolver.ts');
      if (!/THESE NUMBERS ARE A CONVENTION, NOT A RESEARCH FINDING/.test(src)) {
        throw new Error(
          'capacity-resolver.ts no longer states that its confidence bands are a convention · ' +
            'that sentence is the whole point of this claim',
        );
      }
      if (!/CONVENTION, and deliberately the same value as/.test(src)) {
        throw new Error('CAPACITY_SATURATION_OBSERVATIONS no longer states its convention status');
      }
      if (!/CONVENTION, not a research finding\. What grounds the number/.test(src)) {
        throw new Error('CAPACITY_CONFIDENCE_HALF_LIFE_DAYS no longer states its convention status');
      }

      // ── THE STRUCTURAL PROPERTY · the bands may not overlap ──────────────
      // Read out of the source literal, so a future edit that "just nudges"
      // one edge past another fails the build rather than silently letting a
      // VDOT-derived guess out-confidence a corroborated direct read.
      const num = (key: string) =>
        Number(matchLiteral(src, new RegExp(`${key}:\\s*([\\d.]+),`), `CAPACITY_CONFIDENCE_BANDS.${key}`)[1]);
      const directFloor = num('directFloor');
      const directCeiling = num('directCeiling');
      const fallbackFloor = num('fallbackFloor');
      const fallbackCeiling = num('fallbackCeiling');
      const populationPrior = num('populationPrior');
      if (!(directCeiling > directFloor && fallbackCeiling > fallbackFloor)) {
        throw new Error('a capacity confidence band has a ceiling at or below its own floor');
      }
      if (!(directFloor >= fallbackCeiling)) {
        throw new Error(
          `the direct band's floor (${directFloor}) has fallen below the fallback band's ceiling ` +
            `(${fallbackCeiling}) · a derived guess can now out-confidence direct evidence, which is ` +
            'the exact inversion §17 exists to prevent',
        );
      }
      if (!(fallbackFloor >= populationPrior)) {
        throw new Error(
          `the fallback band's floor (${fallbackFloor}) has fallen below the population prior ` +
            `(${populationPrior})`,
        );
      }
      if (!(directCeiling < 1)) {
        throw new Error(
          'direct evidence may not reach confidence 1.0 · corroboration cannot see an instrument ' +
            'error repeated across every session (vdot-corpus.ts names the blind spot)',
        );
      }

      // ── THE ONE DOCTRINE-GROUNDED NUMBER, read out of the doc ────────────
      const table = resolveCitation(
        'Research/02-race-time-prediction.md',
        '| Distance gap | Typical error band | Notes |',
      ).table();
      const cell = table.cell('Half → marathon', 'Typical error band').replace(/±/g, '');
      const [loPct, hiPct] = parsePctBand(cell);
      const bandLo = Number(matchLiteral(src, /CAPACITY_CONSISTENCY_BAND = Object\.freeze\(\{ low: ([\d.]+),/, 'CAPACITY_CONSISTENCY_BAND.low')[1]);
      const bandHi = Number(matchLiteral(src, /CAPACITY_CONSISTENCY_BAND = Object\.freeze\(\{ low: [\d.]+, high: ([\d.]+) \}\)/, 'CAPACITY_CONSISTENCY_BAND.high')[1]);
      if (Math.abs(bandLo - loPct) > 0.0005) {
        throw new Error(
          `CAPACITY_CONSISTENCY_BAND.low is ${bandLo} · Research/02 §2.3's Half → marathon row's ` +
            `tight edge is ${loPct}`,
        );
      }
      if (Math.abs(bandHi - hiPct) > 0.0005) {
        throw new Error(
          `CAPACITY_CONSISTENCY_BAND.high is ${bandHi} · Research/02 §2.3's Half → marathon row's ` +
            `loose edge is ${hiPct}`,
        );
      }

      // ── THE SENTENCE THE HALF-LIFE REUSES MUST STILL EXIST ───────────────
      // CAPACITY_CONFIDENCE_HALF_LIFE_DAYS is argued from durability-anchor's
      // own statement of a speed anchor's rate. If that sentence is edited
      // away, the 28 becomes an unargued number and this claim says so rather
      // than continuing to vouch for it.
      const dur = sourceOf('web-v2/lib/training/durability-anchor.ts');
      if (!/3-4 week half-life/.test(dur)) {
        throw new Error(
          "durability-anchor.ts no longer states a speed anchor's 3-4 week half-life · " +
            'CAPACITY_CONFIDENCE_HALF_LIFE_DAYS is derived from that sentence and now has no argument',
        );
      }
      const halfLife = Number(
        matchLiteral(src, /CAPACITY_CONFIDENCE_HALF_LIFE_DAYS = (\d+);/, 'CAPACITY_CONFIDENCE_HALF_LIFE_DAYS')[1],
      );
      within(halfLife, [21, 28], 'capacity confidence half-life (durability-anchor: a speed anchor is 3-4 weeks)');
    },
  },

  // ══ FUELLING ══════════════════════════════════════════════════════════════
  {
    id: 'FUELLING.attribution-duration-floor',
    binds: ['lib/coach/run-recap.ts#FUELLING_RELEVANT_MIN_MINUTES'],
    doc: 'Research/18-fueling-products.md',
    anchor: '| Easy run <60 min | Water only | No fueling stimulus needed |',
    claim:
      'Below an hour of running there is no fuelling to get wrong, so the post-run coach may ' +
      'not name fuel as the cause of anything. §8 says water only under an hour, the CHO ' +
      'definition calls it the primary fuel for running over 60 minutes, and §"Hourly intake ' +
      'by exercise duration" carries a literal 0 g/hr in its shortest row. run-recap used to ' +
      "tell any long-run runner to eat earlier — including a 5K runner's 45-minute one.",
    check({ cite }) {
      const floor = Number(
        matchLiteral(cite.text(), /Easy run <(\d+) min \| Water only/, "§8's water-only row")[1],
      );
      if (FUELLING_RELEVANT_MIN_MINUTES !== floor) {
        throw new Error(
          `FUELLING_RELEVANT_MIN_MINUTES = ${FUELLING_RELEVANT_MIN_MINUTES} · §8 puts the water-only ` +
            `ceiling at ${floor} min`,
        );
      }
      // The same number, stated independently in the doc's own definition of
      // the macronutrient. Two routes to it, per the registry's own rule.
      const defn = Number(
        matchLiteral(
          sourceOf('Research/18-fueling-products.md'),
          /Primary fuel for endurance running >(\d+) min/,
          "the CHO definition's duration",
        )[1],
      );
      if (defn !== floor) {
        throw new Error(`Research/18 states two different fuelling floors: §8 says ${floor}, the definition says ${defn}`);
      }
      // And the shortest row of the intake table really does prescribe nothing,
      // which is what makes "fuel" an impossible cause down there.
      const shortest = matchLiteral(
        sourceOf('Research/18-fueling-products.md'),
        /\|\s*<45 min\s*\|\s*([^|]+)\|/,
        "the intake table's shortest row",
      )[1].trim();
      if (parseBand(shortest)[1] !== 0) {
        throw new Error(`Research/18's shortest intake row now prescribes "${shortest}", not 0 g/hr`);
      }
      // The gate is wired, not merely declared.
      const src = stripComments(sourceOf('web-v2/lib/coach/run-recap.ts'));
      if (!/FUELLING_RELEVANT_MIN_MINUTES\s*\*\s*60/.test(src)) {
        throw new Error('run-recap no longer applies the fuelling-relevance duration gate');
      }
      const fuelLines = src.split('\n').filter((l) => /fuel/i.test(l) && /facts\.push|`/.test(l));
      if (fuelLines.length > 0 && !/fuellingApplies/.test(src)) {
        throw new Error('run-recap attributes a cause to fuelling without consulting the duration gate');
      }
    },
  },

  // ══ PLAN SHAPE ════════════════════════════════════════════════════════════
  {
    id: 'PLAN.tier-days-per-week',
    binds: ['lib/plan/goal-tiers.ts#TIER_TARGETS.daysPerWeek'],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 1. 5K Plans',
    claim:
      'Research/22 never publishes a peak weekly volume on its own · every plan table prints ' +
      '"| Days/week |" directly above "| Peak weekly volume |", so the volume band only means ' +
      'anything alongside the day count it was written for. The engine\'s daysPerWeek must be ' +
      "the doc's number for that cohort, and it must never sit ABOVE it — a tier claiming more " +
      'training days than doctrine publishes would let the all-user sweep scale its volume ' +
      'expectation down for a plan that is already running doctrine\'s full week.',
    check({ exempt }) {
      const TIER_ROW: Partial<Record<GoalTier, string>> = {
        developing: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
      };
      const DOC_SECTION: Partial<Record<DistCategory, string>> = {
        '5k': '5K', '10k': '10K', hm: 'Half Marathon', m: 'Marathon',
      };
      const all = sourceOf('Research/22-plan-templates.md').split('\n');
      const docDays = (distance: string, cohort: string): { band: [number, number]; header: [number, number]; runDays: number } => {
        const at = all.findIndex((l) => l.startsWith(`### ${distance} —`) && l.includes(cohort));
        if (at < 0) throw new Error(`DOCTRINE · no "### ${distance} — ${cohort}" section`);
        const line = all.slice(at, at + 20).find((l) => l.includes('| Days/week |'));
        if (!line) throw new Error(`DOCTRINE · no "Days/week" row under ${distance} — ${cohort}`);
        const header = parseBand(line.split('|')[2].split(/\(|run \+|\+/)[0]);

        // 2026-08-19 · READ THE SAMPLE WEEK, NOT THE SUMMARY CELL.
        //
        // The Days/week header and the sample peak week beneath it can disagree,
        // and where they do the sample week is the prescription — it names the
        // actual sessions. §"Marathon — Beginner" says "4 (3 run + cross-train)"
        // and then lays out Tue 3mi / Wed 6mi / Thu 3mi / Sat 5mi / Sun 20mi:
        // FIVE running days, with Mon "XT or rest" and Fri "Rest".
        //
        // Binding to the header alone graded the engine's (correct) 5 as a
        // violation and would have cut a first-time marathoner to 3 running
        // days. That is the adjacent-cell misread Rule 7 exists to stop, so the
        // claim now reads the row that actually prescribes, and reports the
        // contradiction rather than silently trusting either side.
        const sampleAt = all.slice(at, at + 24).findIndex((l) => /\| Mon \| Tue \|/.test(l));
        if (sampleAt < 0) throw new Error(`DOCTRINE · no sample week under ${distance} — ${cohort}`);
        const row = all[at + sampleAt + 2];
        const cells = row.split('|').slice(1, -1).map((c) => c.trim()).filter(Boolean);
        if (cells.length !== 7) {
          throw new Error(`DOCTRINE · ${distance} — ${cohort} sample week has ${cells.length} days, not 7`);
        }
        // Every prescribed run states a distance or a rep count; "Rest" and
        // "XT or rest" carry no digit at all.
        const runDays = cells.filter((c) => /\d/.test(c)).length;
        if (runDays < 1 || runDays > 7) {
          throw new Error(`DOCTRINE · ${distance} — ${cohort} sample week parsed ${runDays} run days`);
        }
        return { band: [Math.min(header[0], runDays), Math.max(header[1], runDays)] as [number, number], header, runDays };
      };
      for (const cat of CATS) {
        const section = DOC_SECTION[cat];
        if (!section) continue; // ultra rows key on race distance, not cohort
        for (const tier of ['developing', 'intermediate', 'advanced'] as const) {
          const eng = TIER_TARGETS[cat][tier].daysPerWeek;
          const { band: [lo, hi], header, runDays } = docDays(section, TIER_ROW[tier]!);
          if (eng >= lo && eng <= hi) continue;
          if (exempt(`${cat}.${tier}`)) continue;
          const disagree = runDays < header[0] || runDays > header[1]
            ? ` (the doc disagrees with itself: header ${header[0]}-${header[1]}, sample week ${runDays} run days)`
            : '';
          throw new Error(
            `TIER_TARGETS.${cat}.${tier}.daysPerWeek = ${eng} · Research/22 §"${section} — ` +
              `${TIER_ROW[tier]}" prescribes ${lo}${hi !== lo ? `-${hi}` : ''} days/week${disagree}`,
          );
        }
        // `elite` has no Research/22 row · it may not train FEWER days than the
        // tier below it.
        if (TIER_TARGETS[cat].elite.daysPerWeek < TIER_TARGETS[cat].advanced.daysPerWeek) {
          throw new Error(`TIER_TARGETS.${cat}.elite trains fewer days than advanced`);
        }
      }
      // The sweep must read the tier's day count rather than assume one, or the
      // scaling it does is against a number from nowhere.
      const sweep = stripComments(sourceOf('web-v2/lib/plan/_sweep_allusers.test.ts'));
      if (!/band\.daysPerWeek/.test(sweep)) {
        throw new Error('the all-user sweep no longer scales its weekly-volume floor by the band\'s day count');
      }
    },
    // TIERDAYS-1 (2026-08-19) · the two exemptions that stood here are GONE.
    // 5k.advanced and 10k.advanced both said 5 against doctrine's 6-7; both are
    // now 6. The ruling they were reported for: change it, because the change
    // is provably inert on output — `daysPerWeek` has no reader in the
    // composer, only this gate and the sweep's volume scaling — so the only
    // thing the divergence was doing was misreporting what the engine believes
    // doctrine says. See the TIERDAYS-1 note above TIER_TARGETS in goal-tiers.ts.
  },

  // ══ DRIFT DETECTION ═══════════════════════════════════════════════════════
  {
    id: 'PREDICTION.drift-anchor-span-margin',
    binds: ['lib/training/goal-projection.ts#driftAnchorMarginPct'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '| Prediction span | Suggested 80% CI |',
    claim:
      'A race at a different distance from the goal is evidence, not noise · §13.7 answers a ' +
      'cross-distance prediction with a confidence interval rather than a refusal, and §14 ' +
      'rule 1 makes Riegel the default across 1500m-half. So the drift detector admits any ' +
      "span doctrine can normalise and charges it §13.7's own CI as extra slowdown before it " +
      'fires. Where §13.7 prints no row for a pair, the engine takes the WIDEST published row ' +
      'that brackets the span — a stated number used where it cannot be too narrow — never an ' +
      'interpolated one. Ultras are declined outright, because §14 rule 6 sends them to ' +
      'Cameron and time-on-feet instead of this machinery.',
    check({ cite }) {
      const t = cite.table();
      const pct = (row: string) => parseBand(t.cell(row, 'Suggested 80% CI'))[0];
      // The two fallbacks must really BE the widest published rows in their
      // direction, or "conservative bound" is just a number someone liked.
      const shortening = ['Marathon → 5K, recent base'];
      const lengthening = [
        '5K → 10K, recent input',
        '10K → half, recent input',
        'Half → marathon, marathon-trained',
        '5K → marathon, marathon-trained',
      ];
      const widestShortening = Math.max(...shortening.map(pct));
      const widestLengthening = Math.max(...lengthening.map(pct));
      if (CROSS_SPAN_CI_PCT.marathonToFiveK !== widestShortening) {
        throw new Error(
          `the shortening fallback uses ${CROSS_SPAN_CI_PCT.marathonToFiveK}% · §13.7's widest ` +
            `shortening row is ${widestShortening}%`,
        );
      }
      if (CROSS_SPAN_CI_PCT.shortToMarathonTrained !== widestLengthening) {
        throw new Error(
          `the lengthening fallback uses ${CROSS_SPAN_CI_PCT.shortToMarathonTrained}% · §13.7's ` +
            `widest two-sided lengthening row is ${widestLengthening}%`,
        );
      }
      // §14 rule 6 is what takes ultras out, so it has to still say so.
      if (!/switch to time-on-feet models beyond 100K/.test(sourceOf('Research/02-race-time-prediction.md'))) {
        throw new Error('§14 rule 6 no longer sends ultras to time-on-feet · re-read the ultra decline');
      }
      const src = stripComments(sourceOf('web-v2/lib/training/goal-projection.ts'));
      // The ±30% window is gone and must not come back: it is what silenced the
      // STRONG detector for every short-distance runner.
      if (/raceDistanceMi\s*\*\s*0\.7|raceDistanceMi\s*\*\s*1\.3/.test(src)) {
        throw new Error('detectRecentRaceDrift is back on a fixed ±30% distance window');
      }
      if (!/mediumAt\s*=\s*5\s*\+\s*marginPct/.test(src) || !/strongAt\s*=\s*10\s*\+\s*marginPct/.test(src)) {
        throw new Error('the drift triggers no longer charge a cross-distance anchor for its span');
      }
      // Cross-distance candidates must be ranked by VDOT. Ranking by raw pace
      // across distances picks the shortest race every time, whatever the
      // fitness behind it.
      if (/if \(!best \|\| pace < best\.pace\)/.test(src)) {
        throw new Error('cross-distance anchors are ranked by raw pace again · only VDOT compares across distances');
      }
    },
  },

  // ══ §11 · the two shapes that are a DAY, not a slot ══════════════════════
  {
    id: 'MP.pre-fatigue-is-the-fast-finish-long',
    binds: [
      'lib/plan/generate.ts#longFinishSegment',
      'lib/plan/catalogue-rx.ts#renderPrescription',
      'lib/workout-catalogue/catalogue.ts#pre-fatigue-mp-work',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 11.4 Pre-fatigue marathon-pace work',
    claim:
      "§11.4's continuous structure is \"8 mi easy + immediate 8 mi MP\": half the session easy, " +
      'half at marathon pace, run without a break. That is a long run with a marathon-pace ' +
      'finish, and the engine already authors exactly it on the long-run day of the ' +
      'race-specific phase, at the same half-the-distance share. So the prescription grammar ' +
      'must keep DECLINING the catalogue sequence rather than rendering it: two ways to say ' +
      'one session is worse than one, because the runner then gets both in a week that ' +
      'doctrine gives one, and the second is charged to a budget the first already spent.',
    check({ cite }) {
      // (b) out of the doc's own Structures row, as a marathon-pace SHARE.
      const structures = cite.table().cell('Structures', 'Prescription');
      const b = structures.match(/\(b\)\s*(\d+(?:\.\d+)?)\s*mi\s+easy\s*\+\s*immediate\s*(\d+(?:\.\d+)?)\s*mi\s+MP/i);
      if (!b) {
        throw new Error(
          `§11.4's Structures row no longer states structure (b) as "N mi easy + immediate N mi MP": "${structures}"`,
        );
      }
      const easyMi = Number(b[1]);
      const mpMi = Number(b[2]);
      const docShare = mpMi / (easyMi + mpMi);

      // The engine's own share, read out of the source rather than restated
      // here. `longFinishSegment` is not exported; the constant is the number
      // its RACE-SPECIFIC arm returns.
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const at = src.indexOf('function longFinishSegment(');
      if (at < 0) throw new Error('longFinishSegment is gone from generate.ts · the fast-finish long has moved');
      const arm = src.slice(at).split("phase === 'RACE-SPECIFIC'")[1];
      if (!arm) throw new Error("longFinishSegment no longer has a RACE-SPECIFIC arm · re-read what it writes on the long run");
      const pct = arm.match(/pct:\s*([0-9.]+)\s*,\s*tag:\s*racePaceTag/);
      if (!pct) throw new Error("longFinishSegment's RACE-SPECIFIC arm no longer returns a pct at the race-pace tag");
      const engineShare = Number(pct[1]);
      if (Math.abs(engineShare - docShare) > 1e-9) {
        throw new Error(
          `§11.4(b) is ${(docShare * 100).toFixed(0)}% of the session at MP and the race-specific ` +
            `long finish is ${(engineShare * 100).toFixed(0)}% · they are no longer the same session, ` +
            'so the decline below is no longer justified by "the engine already writes it"',
        );
      }

      // And the catalogue sequence must still be declined, for the stated
      // reason: it carries an EASY step, and every segment the grammar emits
      // becomes a paced work phase on the watch.
      const entry = WORKOUT_CATALOGUE.find((e) => e.slug === 'pre-fatigue-mp-work');
      if (!entry) throw new Error('§11.4 is gone from the catalogue');
      const seq = entry.structures.find((s) => s.kind === 'sequence');
      if (!seq || seq.kind !== 'sequence') throw new Error("§11.4's continuous structure is no longer a sequence");
      if (!seq.steps.some((s) => s.zone === 'E')) {
        throw new Error("§11.4's sequence no longer carries an easy step · doctrine states half of it easy");
      }
      const rendered = renderPrescription(entry, {
        structure: seq, reps: seq.steps.length, atPaceMinutes: 0, atPaceMi: 0, recoverySec: 0,
      });
      if (rendered !== null) {
        throw new Error(
          `§11.4's sequence now renders as "${rendered}" · the engine has two ways to write one ` +
            'session, and this one puts a pace target on miles doctrine states as easy',
        );
      }

      // §11.1's two-session day has no rendering either, and must not acquire
      // one by accident: a `double` reaching the runner as a single label would
      // describe a whole day as one session.
      const canova = WORKOUT_CATALOGUE.find((e) => e.slug === 'canova-special-block');
      if (!canova) throw new Error('§11.1 is gone from the catalogue');
      const dbl = canova.structures.find((s) => s.kind === 'double');
      if (!dbl) throw new Error("§11.1's structure is no longer a two-session day");
      const canovaRendered = renderPrescription(canova, {
        structure: dbl, reps: 1, atPaceMinutes: 0, atPaceMi: 0, recoverySec: 0,
      });
      if (canovaRendered !== null) {
        throw new Error(
          `§11.1's two-session day now renders as "${canovaRendered}" · one label cannot describe ` +
            'two sessions six to eight hours apart, and plan_workouts holds one row per day',
        );
      }
    },
  },

  // ══ ONBOARDING · what the form cannot say, the cold start cannot know ═════
  {
    id: 'VOLUME.onboarding-ladder-reaches-doctrine',
    binds: [
      'lib/onboarding/state.ts#VALID_WEEKLY_MI',
      'lib/onboarding/state.ts#HIST_AVG_MIDPOINTS',
      'lib/onboarding/state.ts#HIST_LONG_MIDPOINTS',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume table — miles per week (km in parentheses)',
    claim:
      'Doctrine names training volumes by distance and cohort, up to 200 mi/wk. A runner whose ' +
      'real volume the onboarding form cannot express is read as whatever its top rung means ' +
      'instead, and that one number anchors the ramp base, the cold-start pace floor and the ' +
      "whole first block. So the ladder's ceiling, and the midpoint the engine reads behind it, " +
      'must both reach at least the sub-elite volume doctrine names for the most demanding ' +
      'distance this app plans. The open-ended top band is read at the LOW end of the cohort it ' +
      'opens into, never above it, because an over-read invents fitness nobody claimed. And the ' +
      "longest-recent-run ladder must reach the long run doctrine's own long-run cap gives a " +
      'runner at that same sub-elite volume, because that answer is the long-run ramp anchor.',
    check({ cite }) {
      const t = cite.table();
      // Every distance this app plans. The 50K / 100K / 100-mile rows are in
      // the doc and are deliberately not read: the ladder is not asked to
      // reach them.
      const ROWS = ['5K', '10K', 'Half-marathon', 'Marathon'];
      const subEliteFloor = (row: string) => parseBand(t.row(row)['Sub-elite'])[0];
      const eliteFloor = (row: string) => parseBand(t.row(row)['Elite'])[0];
      // The bar is the HARDEST row, not the easiest: a ladder that reaches 5K
      // sub-elite and stops has still truncated every marathoner above it.
      const need = Math.max(...ROWS.map(subEliteFloor));
      // The band is a WEEKLY VOLUME, not a distance, so the cohort an 80+ mi/wk
      // answer opens into is the highest one the table names at any distance —
      // the marathon elite row. Reading it against the 5K elite floor instead
      // would bound a marathoner's volume by a 5K runner's.
      const openBandCeiling = Math.max(...ROWS.map(eliteFloor));

      const topRung = Math.max(...VALID_WEEKLY_MI);
      if (topRung < need) {
        throw new Error(
          `the weekly-mileage ladder stops at ${topRung} mi/wk · Research/00a §"Volume table" ` +
            `calls ${need} mi/wk sub-elite, so every runner from ${topRung} up is read as a ` +
            `${topRung} mi/wk runner and authored the same plan`,
        );
      }

      const topMid = Math.max(...Object.values(HIST_AVG_MIDPOINTS));
      if (topMid < need) {
        throw new Error(
          `HIST_AVG_MIDPOINTS tops out at ${topMid} mi/wk · the form can say ${topRung} but the ` +
            `engine never READS above ${topMid}, and doctrine's sub-elite floor is ${need}`,
        );
      }
      if (topMid > openBandCeiling) {
        throw new Error(
          `HIST_AVG_MIDPOINTS' open-ended top band is read as ${topMid} mi/wk, above the ` +
            `${openBandCeiling} mi/wk floor of doctrine's highest cohort · an open band read ` +
            'above the cohort it opens into fabricates volume the runner never claimed',
        );
      }

      // The long-run ladder, against the same doc's own long-run cap. Measured
      // at the sub-elite floor rather than at the ladder's ceiling, because the
      // top rung is open-ended and read at its own low end by design.
      const capLo = parseBand(
        resolveCitation(cite.doc, '### Volume progression rules')
          .table()
          .cell('Long-run cap', 'Specification'),
      )[0] / 100;
      const topLong = Math.max(...Object.values(HIST_LONG_MIDPOINTS));
      const longNeed = capLo * need;
      if (topLong < longNeed) {
        throw new Error(
          `HIST_LONG_MIDPOINTS tops out at ${topLong} mi · a ${need} mi/wk runner's long run is ` +
            `${longNeed} mi at Research/00a's own ${capLo * 100}% long-run cap, so the long-run ` +
            'ramp anchor cannot be stated by the runner it matters most for',
        );
      }
    },
  },
  /* -- Footwear -----------------------------------------------------------
   *
   * The iPhone design draws a shoe against "that model's retirement mileage".
   * Nothing in the schema said what kind of shoe it was, so five files each
   * answered with a hardcoded number and they did not agree: 350, 400, 400,
   * 400, and 450 across web and the phone. A runner's progress bar meant
   * whichever file happened to draw it.
   *
   * Two claims, because two different things are being asserted:
   *
   *   - CONVENTION.shoe-retirement-default: the retirement mileage. The BANDS
   *     are quoted from Research/17; the single DEFAULT inside each band is a
   *     convention, and is labelled one.
   *   - FOOTWEAR.super-shoe-session-cap: how OFTEN a plated shoe is run.
   *     Genuine doctrine, genuine citation, and a different risk entirely
   *     (skeletal load, not worn-out foam). Not folded into the bar.
   */
  {
    id: 'CONVENTION.shoe-retirement-default',
    binds: [
      'lib/shoe/lifespan.ts#SHOE_LIFESPAN',
      'lib/shoe/lifespan.ts#defaultCapMi',
      'lib/shoe/lifespan.ts#resolveShoeCapMi',
    ],
    doc: 'Research/17-footwear.md',
    anchor: '## Mileage Lifespan by Category',
    claim:
      'THE RETIREMENT MILEAGE IS A CONVENTION; ONLY THE BAND AROUND IT IS DOCTRINE. Research/17 ' +
      'bands each category separately - a super shoe is spent at 150-250 mi where a max-cushion ' +
      'trainer runs 400-600 - and both ends of every band in SHOE_LIFESPAN are read back out of ' +
      'that table here. What doctrine does NOT do is pick one number inside a band, so the ' +
      'defaults are a convention: 400 mi for the trainer family and 250 mi for race-day shoes, ' +
      'both owner-confirmed, and the midpoint of its own band for the two categories neither ' +
      'anchor names. The provenance is honest about being coarse - the familiar 300-500 mi rule ' +
      'traces to one 1985 midsole-compression study, and wear varies with surface, body mass and ' +
      'gait. Every default must sit INSIDE its doctrine band; that is what makes the convention ' +
      'bounded rather than free. A runner own mileage_cap overrides all of it.',
    check({ cite }) {
      const t = cite.table();

      for (const type of SHOE_TYPES) {
        const spec = SHOE_LIFESPAN[type];
        const [lo, hi] = parseBand(t.cell(spec.doctrineRow, 'Typical lifespan'));

        // The band is doctrine - both ends, read out of the doc.
        if (spec.lowMi !== lo || spec.highMi !== hi) {
          throw new Error(
            `SHOE_LIFESPAN.${type} carries ${spec.lowMi}-${spec.highMi} mi - Research/17 bands ` +
              `"${spec.doctrineRow}" at ${lo}-${hi} mi. Re-read the table before changing either.`,
          );
        }

        // The default is a convention, but a BOUNDED one: doctrine's own band
        // is the fence. A default outside it is not a convention any more, it
        // is a number contradicting the research it claims to sit inside.
        if (defaultCapMi(type) < lo || defaultCapMi(type) > hi) {
          throw new Error(
            `defaultCapMi('${type}') is ${defaultCapMi(type)} mi, outside Research/17's own ` +
              `${lo}-${hi} mi band for "${spec.doctrineRow}" - a convention may pick a point ` +
              'inside doctrine, never one outside it.',
          );
        }
      }

      // The two owner-confirmed anchors, named explicitly so a later edit that
      // drifts them has to argue with this claim rather than slip past it. An
      // earlier draft defaulted to the low end of every band and would have
      // retired a race shoe at 150 mi, with a third of its life left - that is
      // the specific mistake this half of the claim exists to stop.
      for (const t2 of ['daily_trainer', 'max_cushion', 'stability', 'trail'] as const) {
        if (defaultCapMi(t2) !== 400) {
          throw new Error(
            `trainer-family default for ${t2} is ${defaultCapMi(t2)} mi - owner-confirmed 400`,
          );
        }
      }
      for (const t2 of ['super_shoe', 'racing_flat'] as const) {
        if (defaultCapMi(t2) !== 250) {
          throw new Error(
            `race-day default for ${t2} is ${defaultCapMi(t2)} mi - owner-confirmed 250`,
          );
        }
      }

      // The doc must not have grown a category the engine silently ignores -
      // that is precisely how a super shoe would come to be retired like a
      // trainer, at nearly twice its life.
      const covered = new Set(SHOE_TYPES.map((t2) => SHOE_LIFESPAN[t2].doctrineRow.toLowerCase()));
      const missing = t.rows
        .map((r) => r[t.headers[0]])
        .filter((label) => label && !covered.has(label.toLowerCase()));
      if (missing.length > 0) {
        throw new Error(
          `Research/17 now bands ${missing.map((m) => `"${m}"`).join(', ')} and lib/shoe/` +
            'lifespan.ts has no ShoeType for it - a category the engine cannot name is a ' +
            'category it retires at the daily-trainer default.',
        );
      }

      // The resolver must actually USE the category, and an explicit cap must
      // still beat it - the two behaviours the five old hardcodes destroyed.
      if (resolveShoeCapMi('super_shoe', null) === resolveShoeCapMi('daily_trainer', null)) {
        throw new Error(
          'resolveShoeCapMi returns the same retirement mileage for a super shoe and a daily ' +
            'trainer - the category is being ignored, which is the original defect.',
        );
      }
      if (resolveShoeCapMi('super_shoe', 275) !== 275) {
        throw new Error("a runner's explicit mileage_cap must override the convention default");
      }
      // A zero/negative cap is unset, not honoured - otherwise a "0 mi" typo
      // makes percent-used infinite and the shoe reads spent on day one.
      if (resolveShoeCapMi('track_spike', 0) !== defaultCapMi('track_spike')) {
        throw new Error('a non-positive mileage_cap must fall back to the default, not be honoured');
      }

      // The honesty disclosure has to stay in the file it describes.
      const src = sourceOf('web-v2/lib/shoe/lifespan.ts');
      if (!/IS A CONVENTION/.test(src)) {
        throw new Error(
          'lib/shoe/lifespan.ts no longer says its defaults are a convention - the label is the ' +
            'whole point, since nothing in Research/ picks a point inside a band.',
        );
      }
    },
  },
  {
    id: 'FOOTWEAR.super-shoe-session-cap',
    binds: ['lib/shoe/lifespan.ts#SUPER_SHOE_MAX_SESSIONS_PER_WEEK'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Scenario | Recovery adjustment |',
    claim:
      'A plated shoe is capped by HOW OFTEN it is run, not only by how far it has been run. ' +
      'Research/00b limits high training volume in super shoes to 1-2 sessions per week and ' +
      'rotates non-plated shoes for daily mileage, because bone and connective tissue absorb the ' +
      'full load either way: the window saved on muscle damage may be paid back by skeletal load ' +
      'if mileage in super shoes is unbounded. This is a separate signal from the retirement bar ' +
      'and must not be folded into it - a shoe can be well inside its mileage and still be worn ' +
      'too often. The constant is registered but NOT YET WIRED; this claim exists so the number ' +
      'is gated before anything depends on it.',
    check({ cite }) {
      // Read the cap out of the doc's own row rather than restating it here.
      const row = cite
        .table()
        .cell('High volume in super shoes during training', 'Recovery adjustment');
      const [, hi] = parseBand(row);
      if (SUPER_SHOE_MAX_SESSIONS_PER_WEEK !== hi) {
        throw new Error(
          `SUPER_SHOE_MAX_SESSIONS_PER_WEEK is ${SUPER_SHOE_MAX_SESSIONS_PER_WEEK} - Research/00b ` +
            `caps super-shoe training at "${row.trim()}", i.e. ${hi} sessions/week.`,
        );
      }
      // The skeletal-load reasoning is why the cap is a frequency and not a
      // mileage. If that row goes, the constant has lost its justification.
      const effects = resolveCitation(cite.doc, '### Recovery Effects').table();
      if (!/same or longer/i.test(effects.cell('Recovery time at the level of bone/connective tissue', 'Direction'))) {
        throw new Error(
          'Research/00b no longer says bone/connective-tissue recovery is the same or longer in ' +
            'super shoes - that is the entire basis for a per-week session cap.',
        );
      }
    },
  },

  // ── V5 backend surfaces (2026-08-19) · per-zone pace re-anchor, race-
  // authority, return-to-run ladder ──────────────────────────────────────

  {
    id: 'RETURN.min-two-sessions-per-stage',
    binds: ['lib/plan/return-ladder.ts#MIN_SESSIONS_PER_STAGE'],
    doc: 'Research/05-injury-return-protocols.md',
    anchor: 'Spend at least 2 sessions at each stage before progressing.',
    claim:
      'The check-in-gated ladder (POST /api/v5/return/checkin) must not advance a stage on fewer ' +
      "than the doctrine's own minimum of 2 silent sessions at the current load. The number is " +
      'read out of the sentence itself, not hand-copied, so an edit to the doctrine band moves ' +
      'the gate with it.',
    check({ cite }) {
      const text = cite.text();
      const m = text.match(/at least\s+(\d+)\s+sessions/i);
      if (!m) {
        throw new Error(
          `Research/05 §1.1 no longer states "at least N sessions at each stage" · ` +
            're-read the section and re-anchor this claim',
        );
      }
      const doctrineMin = Number(m[1]);
      if (MIN_SESSIONS_PER_STAGE !== doctrineMin) {
        throw new Error(
          `MIN_SESSIONS_PER_STAGE is ${MIN_SESSIONS_PER_STAGE} · Research/05 §1.1 says "at least ` +
            `${doctrineMin} sessions at each stage before progressing"`,
        );
      }
    },
  },

  {
    id: 'PACE.zone-reanchor-uses-bound-curve-functions',
    binds: ['lib/plan/pace-zones.ts#resolveZonePaces'],
    doc: 'docs/faff-iphone-design-contract.md',
    anchor: '**Zones do not move by the same amount.**',
    claim:
      'GET /api/v5/paces reports THREE independent zone deltas (threshold, interval, rep) off the ' +
      'canonical Daniels curve this app already binds to doctrine — never a single headline delta, ' +
      'and never a reinvented offset table (the exact mistake docs/2026-05-19-sim-sweep.md ' +
      'documents for the deprecated `E = M + 75` / `R = mile-pace` formulas).',
    check({ cite }) {
      const text = cite.text();
      if (!text.includes('threshold `+24 s/mi`') || !text.includes('interval `+22`') || !text.includes('rep `+19`')) {
        throw new Error(
          'docs/faff-iphone-design-contract.md no longer states the worked three-point-drop ' +
            'example ("threshold +24 s/mi, interval +22, rep +19") · re-read the section and ' +
            're-anchor this claim',
        );
      }
      const src = sourceOf('web-v2/lib/plan/pace-zones.ts');
      // Built off the SAME bound curve functions PACE.threshold-anchor and
      // PACE.repetition-is-mile-race-pace already gate — never re-derived.
      matchLiteral(src, /tPaceFromVdot/, 'resolveZonePaces calls the bound threshold-pace curve');
      matchLiteral(src, /iPaceFromVdot/, 'resolveZonePaces calls the bound interval-pace curve');
      matchLiteral(src, /rPaceFromVdot/, 'resolveZonePaces calls the bound rep-pace curve');
      // And it must never collapse the three rows into one combined delta —
      // no function in the file computes an average/sum across zones.
      if (/averageDelta|combinedDelta|headlineDelta|deltas\.reduce/i.test(src)) {
        throw new Error(
          'lib/plan/pace-zones.ts appears to compute a combined/averaged delta across zones · ' +
            'the design contract requires per-zone rows only, with no single headline number',
        );
      }
    },
  },
  {
    id: 'ZONETARGET.workout-zone-mapping',
    binds: ['lib/coach/zone-target.ts#ZONE_TARGET'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### 5-Zone (ACSM / generic / commercial wearables)',
    claim:
      'The v5 Today screen highlights the heart-rate zone a session was prescribed to live ' +
      'in, which is a physiological assertion and not a label. The five-zone table names ' +
      'each zone by what it is FOR, and the mapping is read out of that Purpose column: an ' +
      'easy or long run is the zone whose purpose is aerobic base, a tempo the zone whose ' +
      'purpose is aerobic capacity, a threshold session the zone whose purpose names LT and ' +
      'race pace, and VO2max work the zone whose purpose is top-end aerobic and anaerobic. ' +
      'The last one is the reason this claim exists: intervals were originally mapped onto ' +
      'the threshold zone, which draws a VO2max session as something it is not.',
    check({ cite }) {
      const t = cite.table();
      // Column 0 is "Zone" ("2 Easy / Aerobic"), column 2 is "Purpose".
      const zoneFor = (purpose: RegExp, what: string): number => {
        const row = t.rows.find((r) => purpose.test(Object.values(r)[2] ?? ''));
        if (!row) throw new Error(`Research/03 five-zone table no longer states a purpose for ${what}`);
        const label = Object.values(row)[0] ?? '';
        const n = Number(matchLiteral(label, /^\s*(\d)/, `zone number for ${what}`)[1]);
        return n;
      };
      const pairs: Array<[keyof typeof ZONE_TARGET, RegExp, string]> = [
        ['aerobicBase', /aerobic base/i, 'aerobic base'],
        ['aerobicCapacity', /aerobic capacity/i, 'aerobic capacity'],
        ['threshold', /\bLT\b|race pace/i, 'threshold'],
        ['vo2max', /top-end aerobic|anaerobic/i, 'VO2max'],
      ];
      for (const [key, re, what] of pairs) {
        const doc = zoneFor(re, what);
        if (ZONE_TARGET[key] !== doc) {
          throw new Error(
            `ZONE_TARGET.${key} is ${ZONE_TARGET[key]}, the five-zone table puts ${what} in zone ${doc}`,
          );
        }
      }
    },
  },

  /**
   * 2026-08-21 · THE RACE ZONE. `ZONETARGET.workout-zone-mapping` above is a
   * correct claim that did not cover the defect beside it. It reads the
   * five-zone table's Purpose column and confirms zone 3's purpose is "aerobic
   * capacity" — true — while `zoneTargetForWorkout` quietly routed `race`
   * through that same zone-3 constant. Nothing ever asked whether a RACE is an
   * aerobic-capacity effort. It is not, at any distance the app can be handed.
   *
   * Round three of the iPhone handoff said a race prescribes Z4 and Z5. That
   * was refused on the right principle — a design ruling does not move a
   * physiological constant — and the refusal left the wrong constant standing.
   * Doctrine settles it without needing either opinion: §6.1 publishes the race
   * heart-rate band per distance and §4's zones are bands of the same quantity,
   * so the answer is an overlap, and it is DIFFERENT PER DISTANCE. The single
   * answer was the deeper defect; zone 3 was wrong for all four rows.
   *
   * This claim hardcodes nothing on either side. It parses §6.1's %HRmax column
   * and §4's zone bands out of their own docs, computes the overlap itself, and
   * requires the engine to return exactly that.
   */
  {
    id: 'ZONETARGET.race-zone-comes-from-the-race-hr-band',
    binds: [
      'lib/coach/zone-target.ts#raceZoneTargets',
      'lib/coach/zone-target.ts#zoneTargetsForWorkout',
      'lib/training/zones.ts#PCT_MAX_ZONE_BANDS',
    ],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | %HRmax | %LTHR |',
    claim:
      'A race is run at the heart rate its DISTANCE allows, and the five ACSM zones are bands ' +
      'of that same quantity, so the zone a race asks for is the overlap of the two published ' +
      'tables rather than a judgement. A 5K and a 10K sit entirely in the top zone; a marathon ' +
      'sits entirely in the threshold zone; a half straddles the boundary and genuinely asks ' +
      'for both. No race distance doctrine publishes reaches down into the aerobic-capacity ' +
      'zone at all — the marathon, the slowest of them, begins exactly at its ceiling — which ' +
      'is what the engine used to return for every race from 5K to marathon.',
    check({ cite }) {
      // Side A · the race band, out of Research/08 §6.1's own %HRmax column.
      const raceBands = cite.table();
      // Side B · the zone bands, out of Research/03 §4's own table. Resolved
      // here rather than imported so BOTH sides of the overlap are read from
      // doctrine at run time — a claim that hardcodes either one only proves
      // the test agrees with itself.
      const zoneRows = resolveCitation(
        'Research/03-heart-rate-zones.md',
        '### 5-Zone (ACSM / generic / commercial wearables)',
      ).table();
      const zoneBands = zoneRows.rows.map((r) => parsePctBand(r['% HRmax']));
      if (zoneBands.length !== PCT_MAX_ZONE_BANDS.length) {
        throw new Error(
          `Research/03 §4 now publishes ${zoneBands.length} zones · PCT_MAX_ZONE_BANDS carries ` +
            `${PCT_MAX_ZONE_BANDS.length}, so every zone index in the app has shifted`,
        );
      }
      zoneBands.forEach(([lo, hi], i) => {
        const [eLo, eHi] = PCT_MAX_ZONE_BANDS[i];
        if (Math.abs(eLo - lo) > 0.001 || Math.abs(eHi - hi) > 0.001) {
          throw new Error(
            `PCT_MAX_ZONE_BANDS[${i}] is ${eLo}-${eHi}, Research/03 §4 zone ${i + 1} is ${lo}-${hi}`,
          );
        }
      });

      // The overlap, computed from the docs and from nothing else.
      const zonesFromDoc = (lo: number, hi: number) =>
        zoneBands.reduce<number[]>(
          (acc, [zLo, zHi], i) => (Math.min(hi, zHi) - Math.max(lo, zLo) > 0 ? [...acc, i + 1] : acc),
          [],
        );

      const docRow: Partial<Record<DistCategory, string>> = {
        '5k': '5K', '10k': '10K', hm: 'Half', m: 'Marathon',
      };
      // A distance inside each category, for driving the engine end to end.
      const miIn: Record<DistCategory, number> = {
        '5k': 3.1, '10k': 6.2, hm: 13.1, m: 26.2, ultra: 31,
      };
      for (const cat of CATS) {
        // §6.1 has no ultra row; RACEDAY.hr-ceilings already requires the ultra
        // ceiling to BE the marathon's, so its zone follows from that claim.
        const band = cat === 'ultra'
          ? RACE_HR_PCT_MAX.ultra
          : parsePctBand(raceBands.cell(docRow[cat]!, '%HRmax'));
        const want = zonesFromDoc(band[0], band[1]);
        if (want.length === 0) {
          throw new Error(`§6.1's ${cat} band ${band[0]}-${band[1]} overlaps no zone · one of the two tables has changed shape`);
        }
        const got = raceZoneTargets(miIn[cat]);
        if (got.join(',') !== want.join(',')) {
          throw new Error(
            `a ${cat} race is prescribed zone(s) ${got.join('+') || 'none'}, but §6.1's ` +
              `${(band[0] * 100).toFixed(0)}-${(band[1] * 100).toFixed(0)}% HRmax band lands in ` +
              `zone(s) ${want.join('+')} of Research/03 §4`,
          );
        }
        // And the same answer has to survive the switch the route actually calls.
        const viaSwitch = zoneTargetsForWorkout('race', miIn[cat]);
        if (viaSwitch.join(',') !== want.join(',')) {
          throw new Error(
            `zoneTargetsForWorkout('race', ${miIn[cat]}) returns ${viaSwitch.join('+') || 'none'} ` +
              `while raceZoneTargets returns ${want.join('+')} · the switch has its own answer again`,
          );
        }
      }

      // The specific wrongness this claim was written for: zone 3 was returned
      // for every race, and doctrine puts no race in it.
      const aerobicCapacity = ZONE_TARGET.aerobicCapacity;
      for (const cat of CATS) {
        if (raceZoneTargets(miIn[cat]).includes(aerobicCapacity)) {
          throw new Error(
            `a ${cat} race is still prescribed zone ${aerobicCapacity} · §6.1 puts no race ` +
              'distance inside the aerobic-capacity band',
          );
        }
      }

      // An unknown distance must assert nothing rather than pick a row. Same
      // rule lib/race/distance.ts states for every other per-distance table.
      for (const unknown of [null, undefined, 0, NaN]) {
        if (raceZoneTargets(unknown as number | null).length !== 0) {
          throw new Error(
            `a race with distance ${String(unknown)} is prescribed a zone · an unknown distance ` +
              'must highlight nothing, never default to a row',
          );
        }
      }
    },
  },
  {
    id: 'PRERUN.hr-short-rep-floor',
    binds: ['lib/training/spec-card.ts#HR_TARGET_MIN_REP_SEC'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Implications by Rep Duration',
    claim:
      'A rep short enough that heart rate has not arrived gets no heart-rate target on the ' +
      "pre-run card. The doc's own table names the boundary: the top row is the one whose HR " +
      'utility is useless, and the row below it is the first where late-rep HR means ' +
      'something. The engine constant is read off where those two meet, so a doc edit that ' +
      'moves the boundary moves the card with it. Live defect this was written for: ' +
      '"11 x 10s hills · 172-185" on two active plans, a band no runner reaches inside a ' +
      'ten-second rep, printed on a rep the plan had marked by_effort.',
    check({ cite }) {
      const t = cite.table();
      // The first row is the useless band ("<30 s"); its upper bound is the
      // floor below which no HR target may be stated. Parsed, not restated.
      const first = t.rows[0];
      const lenCol = Object.keys(first).find((k) => /rep length/i.test(k));
      const useCol = Object.keys(first).find((k) => /utility/i.test(k));
      if (!lenCol || !useCol) {
        throw new Error(`${cite.doc} §13's rep-duration table no longer has the columns this claim reads`);
      }
      if (!/useless/i.test(first[useCol])) {
        throw new Error(
          `${cite.doc} §13's first rep-duration row is now "${first[useCol]}" · this claim ` +
            'assumes the table opens with the band where HR is useless',
        );
      }
      const m = /<\s*(\d+)\s*s/i.exec(first[lenCol]);
      if (!m) {
        throw new Error(
          `cannot read a seconds bound out of "${first[lenCol]}" in ${cite.doc} §13`,
        );
      }
      const bound = Number(m[1]);
      if (HR_TARGET_MIN_REP_SEC !== bound) {
        throw new Error(
          `HR_TARGET_MIN_REP_SEC is ${HR_TARGET_MIN_REP_SEC}s, but ${cite.doc} §13 puts the ` +
            `useless-HR band at "${first[lenCol]}" · the constant must equal ${bound}`,
        );
      }
    },
  },
  /* -- RACE-RUNUP-1 (2026-08-24) --------------------------------------------
   *
   * `guardGoalRaceRunUp` is the pass that owns the seven days ending on race
   * day, across composed week boundaries. It exists because the race-week
   * composer only reaches inside the week the race falls in, and when race day
   * sits early in that week the run-up lives in the PREVIOUS week, where
   * nothing knew a race was coming -- a marathon block with a Monday anchor
   * and a Sunday race ended its last full week with a ten-mile long run on the
   * Saturday.
   *
   * These two claims read Research/08's four race-week templates and assert
   * the pass enforces what all four agree on, rather than what looked
   * reasonable in the diff.
   */
  {
    id: 'RACERUNUP.no-long-run-in-race-week',
    binds: ['lib/plan/generate.ts#RACE_RUNUP_DAYS'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.3 Day-by-day race week templates',
    claim:
      'Research/08 section 9.3 publishes a day-by-day race-week template for each of the ' +
      'marathon, half, 10K and 5K, each covering the seven days ending on race day. Not one ' +
      'row in any of the four prescribes a long run. So the window the engine protects must ' +
      'be at least as long as the templates are, and no day inside it may carry a long run.',
    check() {
      for (const heading of RACE_WEEK_TEMPLATES) {
        const t = resolveCitation('Research/08-pacing-and-race-week.md', heading).table();
        const day = t.headers[0];
        const workout = t.headers[1];
        // The template's own length, read out of the doc: the rows before the
        // RACE row are the run-up days the engine has to own.
        // The RACE row is the one whose Workout cell IS "RACE" - matching
        // /race/i would hit the marathon's Tuesday "Race-prep workout" and
        // silently shrink the template to one row.
        const raceIdx = t.rows.findIndex((r) => r[workout].trim().toUpperCase() === 'RACE');
        if (raceIdx < 0) {
          throw new Error(
            `section 9.3 template "${heading}" has no RACE row - the anchor or the table changed`,
          );
        }
        if (RACE_RUNUP_DAYS < raceIdx) {
          throw new Error(
            `RACE_RUNUP_DAYS = ${RACE_RUNUP_DAYS} is shorter than the ${raceIdx}-day run-up ` +
              `"${heading}" prescribes - the earliest template days sit outside the guard`,
          );
        }
        for (const r of t.rows.slice(0, raceIdx)) {
          if (/\blong\b/i.test(r[workout])) {
            throw new Error(
              `section 9.3 "${heading}" now prescribes a long run on ${r[day]} ` +
                `("${r[workout]}") - the engine eases every long run inside the run-up, so ` +
                'doctrine and engine disagree',
            );
          }
        }
      }
    },
  },
  {
    id: 'RACERUNUP.day-before-is-the-shortest-run',
    binds: ['lib/plan/generate.ts#RACE_RUNUP_DAYS'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.3 Day-by-day race week templates',
    claim:
      'In every one of the four section-9.3 templates the day before the race carries the ' +
      'SHORTEST run of the week - 15-25 min easy with a few strides. Three of the four name ' +
      'it a shakeout outright and the 5K describes the same session without the word, so the ' +
      'claim reads the Duration column rather than the label. The engine rewrites the last ' +
      'running day before the goal race to a two-mile shakeout for exactly this, and if a ' +
      'template ever stopped ending on its shortest run the engine would be standing on ' +
      'nothing.',
    check() {
      for (const heading of RACE_WEEK_TEMPLATES) {
        const t = resolveCitation('Research/08-pacing-and-race-week.md', heading).table();
        const day = t.headers[0];
        const workout = t.headers[1];
        const duration = t.headers[2];
        const raceIdx = t.rows.findIndex((r) => r[workout].trim().toUpperCase() === 'RACE');
        if (raceIdx < 1) {
          throw new Error(
            `section 9.3 template "${heading}" has no run-up rows before its RACE row`,
          );
        }
        // Longest end of each run-up day's published duration band, out of the
        // doc. A "0-30 min" rest-or-shakeout row tops out at 30.
        const tops = t.rows.slice(0, raceIdx).map((r) => parseBand(r[duration])[1]);
        const dayBefore = tops[tops.length - 1];
        const shortest = Math.min(...tops);
        if (dayBefore !== shortest) {
          throw new Error(
            `section 9.3 "${heading}" now puts ${dayBefore} min on ${t.rows[raceIdx - 1][day]}, ` +
              `the day before the race, and the shortest run of the run-up is ${shortest} min ` +
              '- the engine makes that day the shortest run of the week',
          );
        }
      }
    },
  },
  /* -- MAINT-LENGTH-1 (2026-08-24 · closed 2026-08-28) ----------------------
   *
   * How long the engine can hold a runner in a hold block, against how long
   * doctrine says a hold block lasts. Recorded 2026-08-24 as a violation
   * under the `no-ceiling-on-a-long-hold` exemption; closed in two halves.
   * The stranding argument (nothing re-authors a race-anchored hold block
   * that runs out) retired 2026-08-28 when the plan_elapsed branch of
   * /api/cron/plan-drift started re-authoring race-anchored elapsed plans,
   * and the owner then approved sizing the block to the doctrine ceiling:
   * `composeMaintenancePlan` caps TOTAL_WEEKS at HOLD_BLOCK_MAX_WEEKS, and a
   * capped hold that elapses is authored its next block toward the race.
   * The question this comment used to hold open — whether a long hold
   * PROGRESSES (section 6) or HOLDS flat (section 7) — was ruled by the
   * owner 2026-08-28 ("when in doubt we should also try for progress"):
   * a long hold progresses gently. That ruling is bound by
   * MAINTENANCE.long-hold-progresses-gently, directly below. This claim
   * binds LENGTH only.
   */
  {
    id: 'MAINTENANCE.hold-block-length',
    binds: [
      'lib/plan/goal-tiers.ts#BUILD_WINDOW_WEEKS',
      'lib/plan/generate.ts#HOLD_BLOCK_MAX_WEEKS',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 6. Base Building / Off-Season Plan',
    claim:
      'A hold block runs from today toward the day the race enters its build window, and a ' +
      'single authored block is capped at the doctrine ceiling. Doctrine publishes a ' +
      'Duration for the block this runner is in: section 6 Base Building says 8-16 weeks, ' +
      'and section 7 Maintenance says open-ended but 4-15 weeks realistically, on the ' +
      'stated basis that two thirds of training volume holds VO2max for about fifteen ' +
      'weeks. MAINTENANCE_BY_TIER already ruled that section 6 governs this mode, so the ' +
      'ceiling read here is section 6 own Duration row, HOLD_BLOCK_MAX_WEEKS must equal ' +
      'it, and composeMaintenancePlan must size TOTAL_WEEKS through that cap. A runner ' +
      'whose runway exceeds cap plus window is not stranded: the plan_elapsed branch of ' +
      'the plan-drift cron re-authors a race-anchored plan that runs out with its race ' +
      'still ahead.',
    check({ cite }) {
      const MAX_RUNWAY_WEEKS = 365 / 7;   // loadGeneratorInputs refuses beyond a year
      const ceiling = parseBand(cite.table().cell('Duration', 'Value'))[1];
      if (HOLD_BLOCK_MAX_WEEKS !== ceiling) {
        throw new Error(
          `HOLD_BLOCK_MAX_WEEKS is ${HOLD_BLOCK_MAX_WEEKS}, section 6's Duration row tops out at ${ceiling} wk`,
        );
      }
      const over: string[] = [];
      for (const cat of CATS) {
        const longestHold = Math.min(
          HOLD_BLOCK_MAX_WEEKS,
          Math.floor(MAX_RUNWAY_WEEKS - BUILD_WINDOW_WEEKS[cat]),
        );
        if (longestHold > ceiling) {
          over.push(`${cat}: up to ${longestHold} wk against a ${ceiling} wk ceiling`);
        }
      }
      if (over.length > 0) {
        throw new Error(
          `the hold block exceeds its length ceiling - ${over.join(' · ')}`,
        );
      }
      // The constant only caps anything if the sizing line actually runs
      // through it — the regression this half exists to catch is the cap
      // quietly dropping out of the min().
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      matchLiteral(
        src,
        /TOTAL_WEEKS = Math\.max\(1, Math\.min\(HOLD_BLOCK_MAX_WEEKS, Math\.floor\(weeksToRace - buildWindow\)\)\);/,
        'composeMaintenancePlan sizes the hold block through HOLD_BLOCK_MAX_WEEKS',
      );
    },
  },
  /* -- HOLD-PROGRESS-1 (2026-08-28) · the ruling hold-block-length left open -
   *
   * The owner ruled it ("when in doubt we should also try for progress" —
   * the progress-is-the-guiding-light principle: current fitness is a
   * floor, not a ceiling): a hold long enough to be Research/22 section 6's
   * base-building block PROGRESSES weekly volume gently instead of holding
   * one number flat. The doctrine's own rows draw the line — section 6 has
   * a Duration of 8-16 weeks, a "Peak weekly volume" row and a Phases row
   * that is progression outright ("Reverse periodization is fine"), while
   * section 7 Maintenance is "holding fitness without progression". So the
   * threshold is section 6's Duration FLOOR, and the climb's size comes
   * from Research/00a's per-cycle growth band at its CONSERVATIVE end —
   * a hold is maintenance-shaped base building, not a build. The climb
   * itself is volumeCurve with an overridden peak target, so every ramp
   * guardrail (GENERAL_RAMP_CEILING, the 0.80 cutback, the post-deload
   * re-entry cap) binds the hold exactly as it binds a build. The 5-15%
   * row is stated "for trained athletes"; a beginner's hold takes the same
   * 5%, which sits far under the novice figure the same row states, so the
   * conservative end is conservative for every cohort.
   */
  {
    id: 'MAINTENANCE.long-hold-progresses-gently',
    binds: [
      'lib/plan/generate.ts#HOLD_PROGRESSION_MIN_WEEKS',
      'lib/plan/generate.ts#HOLD_CYCLE_GROWTH',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'A hold block at least as long as section 6 Base Building\'s own Duration floor is the ' +
      'section 6 block, and section 6 progresses (its Phases row is reverse periodization; a ' +
      'Peak weekly volume row implies a climb to a peak), so the block climbs weekly volume ' +
      'gently instead of holding flat — the owner\'s ruling, 2026-08-28. The climb\'s whole-' +
      'block growth is the base-growth row\'s per-cycle band at its conservative end: ' +
      '"Year-on-year base growth | 5-15% per training cycle for trained athletes", so ' +
      'HOLD_CYCLE_GROWTH must equal 1 + the band\'s FLOOR, and HOLD_PROGRESSION_MIN_WEEKS ' +
      'must equal section 6\'s Duration floor (a shorter hold is section 7\'s flat shape — ' +
      '"holding fitness without progression" — and has nothing to progress). The composer ' +
      'must route the climb through volumeCurve with the growth-bounded peak target, not a ' +
      'parallel ramp, so every existing ramp guardrail binds the hold unchanged.',
    check({ cite }) {
      // Research/00a → "5–15% per training cycle for trained athletes; novices …".
      const spec = cite.table().cell('Year-on-year base growth', 'Specification');
      const trained = parseBand(spec.split(';')[0]);
      const growthPct = Math.round((HOLD_CYCLE_GROWTH - 1) * 1000) / 10;
      if (growthPct !== trained[0]) {
        throw new Error(
          `HOLD_CYCLE_GROWTH is ${HOLD_CYCLE_GROWTH} (${growthPct}% per hold block) · the ruling ` +
            `takes the CONSERVATIVE end of the doc's ${trained[0]}-${trained[1]}% per-cycle band, ` +
            `so it must be ${1 + trained[0] / 100}`,
        );
      }
      // Research/22 §6 → "Duration | 8-16 weeks" — the threshold is the FLOOR.
      const dur = parseBand(
        resolveCitation(
          'Research/22-plan-templates.md',
          '## 6. Base Building / Off-Season Plan',
        ).table().cell('Duration', 'Value'),
      );
      if (HOLD_PROGRESSION_MIN_WEEKS !== dur[0]) {
        throw new Error(
          `HOLD_PROGRESSION_MIN_WEEKS is ${HOLD_PROGRESSION_MIN_WEEKS}, section 6's Duration ` +
            `row opens at ${dur[0]} wk — a hold shorter than the section 6 block stays flat, ` +
            'one at least that long progresses',
        );
      }
      if (HOLD_PROGRESSION_MIN_WEEKS > HOLD_BLOCK_MAX_WEEKS) {
        throw new Error(
          `HOLD_PROGRESSION_MIN_WEEKS (${HOLD_PROGRESSION_MIN_WEEKS}) exceeds ` +
            `HOLD_BLOCK_MAX_WEEKS (${HOLD_BLOCK_MAX_WEEKS}) · no hold could ever progress`,
        );
      }
      // The composer must actually run the ruling: gate on the threshold, aim
      // at base × growth, and climb through volumeCurve rather than a copy.
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      matchLiteral(
        src,
        /TOTAL_WEEKS >= HOLD_PROGRESSION_MIN_WEEKS/,
        'composeMaintenancePlan gates hold progression on HOLD_PROGRESSION_MIN_WEEKS',
      );
      matchLiteral(
        src,
        /const holdPeakTarget = Math\.round\(targetWeekly \* HOLD_CYCLE_GROWTH\);/,
        'the hold peak target is base × HOLD_CYCLE_GROWTH',
      );
      matchLiteral(
        src,
        /\? volumeCurve\(targetWeekly, blocks, input\.level, [^)]*holdPeakTarget\)/,
        'the hold climb routes through volumeCurve with the growth-bounded peak target',
      );
    },
  },
  {
    id: 'SEASON.two-a-races-is-a-season-not-a-conflict',
    binds: ['lib/training/race-card.ts#A_RACE_COLLISION_DAYS'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Annual Race Planning Heuristic',
    claim:
      'Doctrine budgets a runner TWO A races a year. So two A races on the calendar is the ' +
      'shape doctrine expects, not a mistake to be corrected — and the Races screen must not ' +
      'demand the runner demote one of them merely for both existing. The card exists for a ' +
      'genuine collision: two A races close enough that one cannot get a build and a taper of ' +
      'its own. The window that defines "close enough" must therefore be far shorter than the ' +
      'spacing a two-per-year season implies, or the engine contradicts the doctrine it is ' +
      'built on every time a runner plans their year correctly.',
    check({ cite }) {
      // Read the allowance out of the doc rather than restating it here.
      const text = cite.text();
      const m = text.match(/A races:\s*(\d+)\s*max per year/i);
      if (!m) {
        throw new Error(
          `DOCTRINE · could not read the A-race-per-year allowance from ${cite.doc} under ` +
            'its Annual Race Planning Heuristic. The claim depends on that number.',
        );
      }
      const perYear = Number(m[1]);
      if (!Number.isFinite(perYear) || perYear < 1) {
        throw new Error(`DOCTRINE · unreadable A-race allowance "${m[1]}" in ${cite.doc}`);
      }
      // Evenly spaced, N A races a year sit this far apart. A collision window
      // at or above that would flag every doctrine-legal season.
      const evenSpacingDays = Math.floor(365 / perYear);
      if (A_RACE_COLLISION_DAYS >= evenSpacingDays) {
        throw new Error(
          `A_RACE_COLLISION_DAYS is ${A_RACE_COLLISION_DAYS} days, but ${cite.doc} budgets ` +
            `${perYear} A races a year — evenly spaced, that is ${evenSpacingDays} days apart. ` +
            'A window that wide calls a doctrine-legal season a conflict.',
        );
      }
      // And it must still be long enough to MEAN something: a window under a
      // month would let two A races a fortnight apart through, which is the
      // case the card was written for.
      if (A_RACE_COLLISION_DAYS < 28) {
        throw new Error(
          `A_RACE_COLLISION_DAYS is ${A_RACE_COLLISION_DAYS} days · too short to catch two A ` +
            'races stacked inside a single build, which is the collision the card exists for.',
        );
      }
    },
  },

  /**
   * MPLABEL-1 / RACEPACE-1 (2026-08-25) · the three claims that hold the
   * goal-relative pace path honest. They were prompted by a defect on the
   * owner's own CIM block: every marathon-pace session in fourteen weeks ran at
   * 7:54/mi while race day prescribed 6:52/mi, and both were called marathon
   * pace.
   */
  {
    id: 'PACE.marathon-pace-is-not-ramped',
    binds: [
      'lib/plan/spec-builder.ts#resolveMarathonPace',
      'lib/plan/recompute-paces.ts#blendedTPaceForWeek',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 4.4 Marathon-pace long run',
    claim:
      'Marathon-pace work is prescribed at ONE anchor, stated as "MP exactly — not faster". ' +
      'What doctrine progresses across a marathon build is the VOLUME at that pace (this ' +
      "section's own 8-16 mi at MP, and Daniels' 4-18 mi M cap), never the pace itself. No " +
      'passage in Research/ describes an MP pace that gets faster week by week, so the engine ' +
      'must not carry a calendar-indexed race-pace ramp. The only thing permitted to move a ' +
      'prescribed pace is evidence (engine-doctrine Rule 1), which is what the measured blend ' +
      'in blendedTPaceForWeek does and the deleted weekIdx ramp did not.',
    check({ cite }) {
      const text = cite.text();
      // Read the rule out of the doc rather than restating it.
      if (!/MP exactly\s*[—-]\s*not faster/i.test(text)) {
        throw new Error(
          'Research/04 §4.4 no longer states the MP pace rule as "MP exactly — not faster"',
        );
      }
      // And read the DOSE range out of the same table, which is the axis that
      // is allowed to move.
      const dose = /(\d+)\s*[–-]\s*(\d+)\s*mi at MP/i.exec(text);
      if (!dose) {
        throw new Error('Research/04 §4.4 no longer states a mileage range at MP · the volume axis is the one that progresses');
      }
      if (Number(dose[1]) >= Number(dose[2])) {
        throw new Error('Research/04 §4.4 MP dose is no longer a range · nothing left for the block to progress');
      }

      // The deleted violation must stay deleted. `blendedTPaceForWeek` still
      // TAKES weekIdx/buildWeeks (callers and the audit trail want them) but
      // nothing may read them back into the blend.
      const rp = sourceOf('web-v2/lib/plan/recompute-paces.ts');
      const body = /export function blendedTPaceForWeek[\s\S]*?\n}/.exec(rp)?.[0] ?? '';
      if (!body) throw new Error('blendedTPaceForWeek is no longer findable in recompute-paces.ts');
      if (/\bblend\s*=\s*[^;]*\bweekIdx\b/.test(body) || /weekIdx\s*\/\s*/.test(body)) {
        throw new Error(
          'blendedTPaceForWeek has re-introduced a calendar term · a pace that advances on the ' +
            'week number asserts a fitness change nobody measured (engine-doctrine Rule 1, ' +
            'violation #1 by file)',
        );
      }
    },
  },

  {
    id: 'PACE.marathon-pace-code-provenance',
    binds: ['lib/plan/spec-builder.ts#resolveMarathonPace'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## Pace zone shorthand',
    claim:
      'The corpus carries TWO marathon-pace codes in one table and keeps them apart: M is ' +
      'anchored to "Goal MP", MP to "Current MP". The engine prescribes both — the goal when ' +
      'it genuinely sits inside the marathon zone, the T+18 default when the goal is refused — ' +
      'and it must record WHICH, because every label and note downstream names the pace to the ' +
      'runner. A resolver that returns a bare number cannot be asked, and the sessions then ' +
      'assert the goal regardless of what they were built at.',
    check({ cite }) {
      const text = cite.text();
      // Both anchors come out of the doc's own table row.
      const mRow = /\|\s*M\s*\|\s*Marathon\s*\|[^\n]*\|\s*([^|\n]+?)\s*\|\s*$/m.exec(text);
      const mpRow = /\|\s*MP\s*\|\s*Marathon pace\s*\|[^\n]*\|\s*([^|\n]+?)\s*\|\s*$/m.exec(text);
      if (!mRow || !mpRow) {
        throw new Error('Research/04 §"Pace zone shorthand" no longer carries both an M and an MP row');
      }
      const mAnchor = mRow[1].trim();
      const mpAnchor = mpRow[1].trim();
      if (!/goal/i.test(mAnchor)) {
        throw new Error(`Research/04 M row is no longer goal-anchored (reads "${mAnchor}")`);
      }
      if (!/current/i.test(mpAnchor)) {
        throw new Error(`Research/04 MP row is no longer current-fitness-anchored (reads "${mpAnchor}")`);
      }
      if (mAnchor === mpAnchor) {
        throw new Error('Research/04 no longer distinguishes M from MP · the engine is carrying a distinction its doctrine dropped');
      }

      // The engine must answer the question the doc keeps open.
      const sb = sourceOf('web-v2/lib/plan/spec-builder.ts');
      if (!/type MarathonPaceSource\s*=\s*'goal'\s*\|\s*'current_fitness'/.test(sb)) {
        throw new Error(
          'spec-builder.ts no longer names which of the two marathon paces it resolved · ' +
            'the labels downstream go back to asserting the goal over a refused one',
        );
      }
      if (!/refusedGoalPaceSPerMi/.test(sb)) {
        throw new Error('resolveMarathonPace no longer reports the goal pace it declined');
      }
      // And the notes must actually consult it.
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/weekMpAtGoalPace/.test(gen)) {
        throw new Error('generate.ts no longer threads the marathon-pace provenance into the notes it writes');
      }
    },
  },

  {
    id: 'GOAL.prescribed-race-pace-ceiling',
    binds: [
      'lib/training/achievable-target.ts#GOAL_OPTIMISM_TOLERANCE',
      'lib/training/achievable-target.ts#achievableRaceTarget',
      'lib/race/effective-race-target.ts#MAX_GOAL_OPTIMISM_FRACTION',
    ],
    doc: 'Research/20-mental-training.md',
    anchor: '### SMART criteria',
    claim:
      'The corpus puts one number on how far a goal may sit from fitness and still be treated ' +
      'as achievable: "Within ~5% of current fitness ceiling". That bound governs what the ' +
      'engine PRESCRIBES, not what the runner may want — the stated goal is never moved ' +
      '(goal-pursuit-doctrine section 14). Threshold pace has had a ceiling since GOAL-2 ' +
      '(achievableFloorT); race pace had none, so an unreachable goal reached the race-day row ' +
      'untouched while every marathon-pace session in the block correctly refused it. The two ' +
      'moments that apply the bound — authoring and race-day execution — must apply the SAME ' +
      'number, and the ceiling under race pace must be the SAME ceiling as under threshold.',
    check({ cite }) {
      const text = cite.text();
      // The tolerance is read out of the doc's own Achievable row.
      const row = /\|\s*A\s*\|\s*Achievable\s*\|\s*([^|\n]+?)\s*\|/i.exec(text);
      if (!row) {
        throw new Error('Research/20 §"SMART criteria" no longer carries an Achievable row');
      }
      const pct = /~?\s*(\d+(?:\.\d+)?)\s*%/.exec(row[1]);
      if (!pct) {
        throw new Error(`Research/20 Achievable row no longer states a percentage (reads "${row[1]}")`);
      }
      if (!/current fitness/i.test(row[1])) {
        throw new Error(`Research/20 Achievable row is no longer anchored to current fitness (reads "${row[1]}")`);
      }
      const tolerance = Number(pct[1]) / 100;
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
      if (!near(GOAL_OPTIMISM_TOLERANCE, tolerance)) {
        throw new Error(
          `GOAL_OPTIMISM_TOLERANCE = ${GOAL_OPTIMISM_TOLERANCE}, doctrine's achievability band is ${tolerance}`,
        );
      }
      // ONE number across both moments. This module cannot import the other
      // (it must stay free of `pg` for client bundles), so the claim is what
      // pins them — the same posture as TAPER.trajectory-build-weeks.
      if (!near(MAX_GOAL_OPTIMISM_FRACTION, GOAL_OPTIMISM_TOLERANCE)) {
        throw new Error(
          `authoring bounds a prescribed target at ${GOAL_OPTIMISM_TOLERANCE} and execution at ` +
            `${MAX_GOAL_OPTIMISM_FRACTION} · one runner, one race, two rules`,
        );
      }

      // ONE ceiling under threshold and race pace. The defect this replaces was
      // a fourth, uncited gain model (min(6, 2 + weeks x 0.22)) that only
      // threshold read, whose cap sat ABOVE the bound block ceiling.
      // Comments are stripped first: the file DOCUMENTS the formula it
      // replaced, and a guard that cannot tell an epitaph from a resurrection
      // fires on the wrong one.
      const rp = sourceOf('web-v2/lib/plan/recompute-paces.ts')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      if (/Math\.min\(\s*6\s*,\s*2\s*\+/.test(rp)) {
        throw new Error(
          'recompute-paces.ts has re-introduced the uncited min(6, 2 + weeks x 0.22) seasonal ' +
            'gain formula · there is no VDOT-gain-per-build rate anywhere in Research/, so the ' +
            'only defensible ceiling is the ADAPTATION.vdot-gain-rate band',
        );
      }
      for (const weeks of [6, 14, 24]) {
        if (seasonalVdotCeiling(44, weeks, 26.22).gainVdot !== maxSeasonalVdotGain(weeks, 26.22)) {
          throw new Error('the threshold ceiling and the race-pace ceiling have diverged');
        }
        if (seasonalVdotCeiling(44, weeks, 26.22).gainVdot > MAX_BLOCK_GAIN_VDOT) {
          throw new Error('the seasonal ceiling now exceeds MAX_BLOCK_GAIN_VDOT');
        }
      }

      // Rule 1 · a ceiling-sourced target is modelled and must say so.
      const at = sourceOf('web-v2/lib/training/achievable-target.ts');
      if (!/basisModelled/.test(at) || !/MODELLED/.test(at)) {
        throw new Error('achievable-target.ts no longer marks a ceiling-sourced target as modelled');
      }
      // And the goal must survive the clamp untouched.
      const gen = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/goal_pace_s_per_mi:\s*input\.goalPaceSec/.test(gen)) {
        throw new Error(
          'authored_state no longer records the runner’s stated goal pace verbatim · ' +
            'bounding what is prescribed must never move what was asked for',
        );
      }

      // ── Rule 9 · the band is spent ONCE ─────────────────────────────────
      //
      // Doctrine names ONE edge. Spending the tolerance twice — forgive inside
      // the band, then snap back past it to the unreduced ceiling — put a 600 s
      // step at the edge with the MORE ambitious runner on the slower side.
      // Both moments must clamp TO the edge. The tolerance below is the one
      // parsed out of Research/20 above, not a second copy.
      const ceilingSec = predictRaceTime(seasonalVdotCeiling(44.1, 14, 26.2).ceilingVdot, 26.2)!;
      const edge = ceilingSec * (1 - tolerance);
      const fantasy = achievableRaceTarget({
        goalSec: Math.round(ceilingSec * 0.5),   // far beyond any band
        currentVdot: 44.1, raceDistanceMi: 26.2, totalWeeks: 14,
      })!;
      if (fantasy.targetSec > edge + 10) {
        throw new Error(
          `a goal beyond the achievability band is prescribed at ${fantasy.targetSec} s, past the ` +
            `band edge ${edge.toFixed(0)} s · the tolerance is being spent twice and the runner who ` +
            'wants it more is being handed the slower target (Rule 9)',
        );
      }
      if (fantasy.targetSec < edge) {
        throw new Error(
          `a prescribed target of ${fantasy.targetSec} s runs FASTER than the band edge ` +
            `${edge.toFixed(0)} s · the bound has stopped bounding`,
        );
      }
      // The same, at the execution moment. One runner, one race, one formula.
      const raced = resolveEffectiveRaceTarget(Math.round(12120 * 0.5), 12120);
      const racedEdge = 12120 * (1 - tolerance);
      if (raced.targetSec > racedEdge + 10 || raced.targetSec < racedEdge) {
        throw new Error(
          `execution clamps a beyond-band goal to ${raced.targetSec} s but the band edge is ` +
            `${racedEdge.toFixed(0)} s · authoring rehearses the block at the edge, so racing ` +
            'anywhere else is the pace step onto a start line that RACEPACE-1 exists to close',
        );
      }
    },
  },

  /**
   * TRAINING-LEAD-1 (2026-08-25) · what sustained training evidence is worth,
   * and the guard that keeps it reachable.
   *
   * Prompted by a defect with no bug in it: `TRAINING_ESTIMATE_SOFT_CAP_VDOT`
   * (1.0) capped every training-derived candidate, and the two constants that
   * decide whether to ACT on a fitness change both demanded more —
   * `REGRESSION_DELTA_THRESHOLD` 1.5 and `REANCHOR_VDOT_DELTA` 2.0. A ceiling
   * beneath a floor. The owner could nail every quality session for months and
   * nothing would move unless one of those weeks contained a race.
   */
  {
    id: 'ADAPTATION.training-lead-quantum',
    binds: [
      'lib/plan/adapt.ts#TRAINING_LEAD_DELTA_THRESHOLD',
      'lib/plan/adapt.ts#TRAINING_LEAD_MIN_SESSIONS',
      'lib/plan/adapt.ts#TRAINING_LEAD_MIN_SPAN_DAYS',
      'lib/training/vdot.ts#TRAINING_ESTIMATE_SOFT_CAP_VDOT',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Triggers to retest',
    claim:
      'Training evidence alone moves VDOT UP by exactly one point, and doctrine states that '
      + 'quantum twice in this table ("Add 1 VDOT point; re-derive paces" and "+1 VDOT, '
      + 'field-test"). The same rows give the corroboration: the downward hard-tempo row needs '
      + '2 sessions and the upward HR row needs the signal sustained 2 weeks. Three things must '
      + 'hold. (1) The engine\'s upward training quantum IS the doc\'s, not a mirror of the '
      + 'downward threshold — the table is deliberately asymmetric, +1 up against -1 to -2 down, '
      + 'because an over-read prescribes work the runner cannot absorb while an under-read only '
      + 'prescribes work that is too easy. (2) The corroboration gate is the doc\'s 2 sessions '
      + 'and 2 weeks, not the 4-6 week TESTING cadence, which answers a different question. '
      + '(3) THE FLOOR MUST BE REACHABLE FROM THE CEILING: the value that licenses acting on a '
      + 'training lead can never exceed the cap that bounds one, or the path is closed by '
      + 'construction and no test of either constant alone can see it.',
    check({ cite }) {
      const text = cite.text();

      // The upward training quantum, read out of the doc's own rows.
      const upRow = /\|\s*Tempo runs feel notably easier[^|]*\|\s*([^|\n]+?)\s*\|/i.exec(text);
      if (!upRow) {
        throw new Error('Research/01 §"Triggers to retest" no longer carries the "tempo feels notably easier" row');
      }
      const upStep = /Add\s+(\d+(?:\.\d+)?)\s+VDOT/i.exec(upRow[1]);
      if (!upStep) {
        throw new Error(`the tempo-easier row no longer states a VDOT step (reads "${upRow[1]}")`);
      }
      const up = Number(upStep[1]);
      if (TRAINING_LEAD_DELTA_THRESHOLD !== up) {
        throw new Error(
          `TRAINING_LEAD_DELTA_THRESHOLD = ${TRAINING_LEAD_DELTA_THRESHOLD}, doctrine's training-evidence step is ${up}`,
        );
      }
      // And the row must still demand a field test — the reason the quantum is
      // one point and not the race-row's 2-3.
      if (!/field.?test/i.test(upRow[1])) {
        throw new Error('the tempo-easier row no longer attaches a field test · the +1 is provisional by construction');
      }

      // The downward band, so the asymmetry is asserted rather than assumed.
      const downRow = /\|\s*Tempo runs unexpectedly hard[^|]*\|\s*([^|\n]+?)\s*\|/i.exec(text);
      if (!downRow) {
        throw new Error('Research/01 §"Triggers to retest" no longer carries the "tempo unexpectedly hard" row');
      }
      // The doc writes this band with EN-DASH minus signs ("–1 to –2 VDOT"),
      // so each magnitude carries a leading sign the separator must not eat.
      const downBand = /[-–—]?\s*(\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*[-–—]?\s*(\d+(?:\.\d+)?)\s*VDOT/i.exec(downRow[1]);
      if (!downBand) {
        throw new Error(`the tempo-hard row no longer states a VDOT band (reads "${downRow[1]}")`);
      }
      const downMin = Number(downBand[1]);
      if (!(up < downMin) && up !== downMin) {
        throw new Error(
          `doctrine's bands are +${up} up and -${downMin}..-${downBand[2]} down; the engine must not `
          + 'flatten that asymmetry',
        );
      }
      if (!(TRAINING_LEAD_DELTA_THRESHOLD <= REGRESSION_DELTA_THRESHOLD)) {
        throw new Error(
          `the upward gate (${TRAINING_LEAD_DELTA_THRESHOLD}) has risen above the downward one `
          + `(${REGRESSION_DELTA_THRESHOLD}) · doctrine is heavier DOWNWARD, not upward`,
        );
      }

      // The corroboration gate, read out of the same table.
      const sessions = /unexpectedly hard for\s*(?:≥|>=)\s*(\d+)\s*sessions/i.exec(text);
      if (!sessions) {
        throw new Error('Research/01 §"Triggers to retest" no longer states a session count for sustained tempo evidence');
      }
      if (TRAINING_LEAD_MIN_SESSIONS !== Number(sessions[1])) {
        throw new Error(
          `TRAINING_LEAD_MIN_SESSIONS = ${TRAINING_LEAD_MIN_SESSIONS}, doctrine's sustained-evidence count is ${sessions[1]}`,
        );
      }
      const weeks = /sustained\s*(?:≥|>=)\s*(\d+)\s*weeks/i.exec(text);
      if (!weeks) {
        throw new Error('Research/01 §"Triggers to retest" no longer states a sustained-signal window in weeks');
      }
      if (TRAINING_LEAD_MIN_SPAN_DAYS !== Number(weeks[1]) * 7) {
        throw new Error(
          `TRAINING_LEAD_MIN_SPAN_DAYS = ${TRAINING_LEAD_MIN_SPAN_DAYS}, doctrine's sustained window is `
          + `${weeks[1]} weeks (${Number(weeks[1]) * 7} days)`,
        );
      }

      // (3) THE CLOSED DOOR. This is the claim that could not have been made
      // about either constant on its own, and it is the whole reason this entry
      // exists: a gate that licenses acting on a training lead is unsatisfiable
      // the moment it demands more than the cap can supply.
      if (TRAINING_LEAD_DELTA_THRESHOLD > TRAINING_ESTIMATE_SOFT_CAP_VDOT) {
        throw new Error(
          `the upward training gate (${TRAINING_LEAD_DELTA_THRESHOLD}) now exceeds the soft cap that `
          + `bounds every training candidate (${TRAINING_ESTIMATE_SOFT_CAP_VDOT}) · the path is closed by `
          + 'construction, which is exactly the defect this claim was written after',
        );
      }
      if (TRAINING_ESTIMATE_SOFT_CAP_VDOT !== up) {
        throw new Error(
          `the training soft cap (${TRAINING_ESTIMATE_SOFT_CAP_VDOT}) has diverged from doctrine's `
          + `training-evidence quantum (${up}) · they are the same number in the same row`,
        );
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BIOMETRICS PIPELINE (2026-08-28) · the age-predicted HRmax fallback and
  // the resting-HR rolling baseline the nightly profile refresh writes.
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'HR.tanaka-age-predicted',
    binds: ['lib/training/zones.ts#tanakaMaxHr'],
    doc: 'Research/03-heart-rate-zones.md',
    // §2's own sub-heading · a section stops at the NEXT heading of any
    // level, and the formula code-fence lives under this one.
    anchor: '### Population formulas',
    claim:
      'When a runner has no LTHR and no measured/observed HRmax, the age-predicted anchor is ' +
      'Tanaka (208 − 0.7 × age) — never Fox 220 − age, which REVIEW_NOTES flags as a ' +
      'weak-evidence formula to never default to. The constants are read out of the doc\'s own ' +
      'formula block, not hand-copied here.',
    check({ cite }) {
      // The doc publishes the formula verbatim inside a code fence:
      //   Tanaka (2001):             HRmax = 208 − 0.7 × age
      const line = cite.text().split('\n').find((l) => /Tanaka \(2001\)/.test(l));
      if (!line) throw new Error('the Tanaka formula line is gone from §2 — re-read the doc');
      const m = line.match(/HRmax = (\d+(?:\.\d+)?) [−-] (\d+(?:\.\d+)?) × age/);
      if (!m) throw new Error(`cannot parse the Tanaka formula out of: "${line.trim()}"`);
      const intercept = Number(m[1]);
      const slope = Number(m[2]);
      for (const age of [20, 30, 40, 55, 70]) {
        const expected = Math.round(intercept - slope * age);
        const got = tanakaMaxHr(age);
        if (got !== expected) {
          throw new Error(
            `tanakaMaxHr(${age}) = ${got} · the doc's formula (${intercept} − ${slope} × age) says ${expected}`,
          );
        }
        // And it is demonstrably NOT Fox 220 − age (the two agree only at
        // age 40 under the published constants · every other age must differ).
        if (age !== 40 && got === 220 - age) {
          throw new Error(
            `tanakaMaxHr(${age}) equals 220 − age — the formula REVIEW_NOTES says never to default to`,
          );
        }
      }
      // Outside the doc's trust range ("Children/adolescents (<16) | None
      // reliable") the function must refuse rather than extrapolate.
      if (tanakaMaxHr(12) != null || tanakaMaxHr(null) != null) {
        throw new Error('tanakaMaxHr fabricates a ceiling for an age the doc calls unreliable');
      }
    },
  },
  {
    id: 'HR.rhr-rolling-baseline-window',
    binds: ['lib/training/biometrics-refresh.ts#RHR_ROLLING_WINDOW_DAYS'],
    doc: 'Research/15-wearable-data.md',
    anchor: 'Use a 7-day rolling average as the working baseline; recompute monthly.',
    claim:
      'The stored profile.rhr snapshot is a rolling average over the window doctrine names for ' +
      'a working baseline — read out of the anchor sentence itself, so a doc revision to the ' +
      'window length fails here rather than drifting silently.',
    check({ cite }) {
      const m = cite.text().match(/(\d+)-day rolling average as the working baseline/);
      if (!m) throw new Error('the working-baseline sentence no longer names an N-day window');
      const docDays = Number(m[1]);
      if (RHR_ROLLING_WINDOW_DAYS !== docDays) {
        throw new Error(
          `RHR_ROLLING_WINDOW_DAYS = ${RHR_ROLLING_WINDOW_DAYS} · doctrine's working baseline is ${docDays} days`,
        );
      }
    },
  },
  {
    id: 'GOALS.abc-tier-probability-bands',
    binds: ['lib/race/coach-goal.ts#deriveCoachGoal'],
    doc: 'Research/20-mental-training.md',
    anchor: "### Daniels' A/B/C tiered race goals",
    claim:
      'A race carries three tiers before race day: A the ~20-30% stretch, B the ~50-60% ' +
      'realistic outcome, C the ~80-90% floor. The coach-set goal emits all three, ordered ' +
      'fastest to slowest, with B the equivalent-fitness centre — the number whose CI the ' +
      'prediction doctrine publishes — and A/C one half-width to either side.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Probability of achievement on race day';
      const a = parsePctBand(t.cell('A', col));
      const b = parsePctBand(t.cell('B', col));
      const c = parsePctBand(t.cell('C', col));
      // The doc's probability ladder must still run A < B < C, or the whole
      // fast-to-slow mapping below reads the wrong way around.
      if (!(a[1] <= b[0] && b[1] <= c[0])) {
        throw new Error(
          `§A/B/C probability bands no longer ascend (A ${a}, B ${b}, C ${c}) · re-read the claim`,
        );
      }
      if (!/Set all three before race day/i.test(cite.text())) {
        throw new Error('the "Set all three before race day" rule is gone · re-read the claim');
      }
      // Engine: a plain race (no stated goal, representative anchor at the
      // race's own distance) emits all three tiers, fastest to slowest, with
      // B exactly the Daniels equivalence of the evidence VDOT.
      const TENK = 6.21371;
      const g = deriveCoachGoal({
        statedGoalSec: null, priority: 'B', distanceMi: TENK,
        vdot: 50, vdotAnchorDistanceMi: TENK, todayISO: '2026-08-28',
      });
      if (!g || g.kind !== 'time') {
        throw new Error('deriveCoachGoal no longer emits the three tiers for a plain race');
      }
      if (!(g.aSec < g.bSec && g.bSec < g.cSec)) {
        throw new Error('tier ladder is not A faster than B faster than C · the probability ordering is broken');
      }
      const base = predictRaceTime(50, TENK);
      if (base == null || Math.abs(g.bSec - base) > 10) {
        throw new Error(`B (${g.bSec}s) drifted from the equivalent-fitness centre (${base}s)`);
      }
      // A stated goal is untouchable — the tier engine must refuse outright.
      const stated = deriveCoachGoal({
        statedGoalSec: 3600, priority: 'B', distanceMi: TENK,
        vdot: 50, vdotAnchorDistanceMi: TENK, todayISO: '2026-08-28',
      });
      if (stated != null) {
        throw new Error('deriveCoachGoal produced tiers over a runner-stated goal · the standing rule is broken');
      }
    },
  },
  {
    id: 'PREDICTION.personal-exponent-two-point-fit',
    binds: [
      'lib/race/coach-goal.ts#fitPersonalExponent',
      'lib/race/coach-goal.ts#predictWithPersonalExponent',
    ],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '### 11.4 Two-Point Exponent Fit',
    claim:
      'With two recent races the runner-specific fatigue exponent is ' +
      'b = ln(T2/T1) / ln(D2/D1), used in place of the population default for a third ' +
      'distance — and only when both races are recent and on flat courses.',
    check({ cite }) {
      const text = cite.text();
      if (!/b = ln\(T2 \/ T1\) \/ ln\(D2 \/ D1\)/.test(text)) {
        throw new Error('§11.4 no longer states the two-point formula · re-read the claim');
      }
      if (!/recent, on flat courses/.test(text)) {
        throw new Error('§11.4 dropped the recent/flat caveat the qualifier enforces · re-read the claim');
      }
      // The engine reproduces the doc's own formula, exactly.
      const FIVEK = 3.10686; const TENK = 6.21371;
      const mk = (over: Partial<ExponentFitRace>): ExponentFitRace => ({
        date: '2026-08-20', distance_mi: TENK, finish_seconds: 2500,
        priority: 'B', provisional: false, hilly: false, ...over,
      });
      const races: ExponentFitRace[] = [
        mk({ date: '2026-08-10', distance_mi: FIVEK, finish_seconds: 1200 }),
        mk({}),
      ];
      const fit = fitPersonalExponent(races, '2026-08-28');
      const expected = Math.log(2500 / 1200) / Math.log(TENK / FIVEK);
      if (!fit || Math.abs(fit.b - expected) > 0.001) {
        throw new Error(`fitted b ${fit?.b} != the doc's formula (${expected.toFixed(4)})`);
      }
      // The flat-course caveat is enforced, not decorative.
      if (fitPersonalExponent([races[0], mk({ hilly: true })], '2026-08-28') != null) {
        throw new Error('a hilly race qualified for the fit · §11.4 says flat courses');
      }
      // And "recent" is Research/01's operative freshness window (checked
      // value-for-value by PREDICTION.exponent-fit-freshness-window).
      const staleDate = '2026-05-01'; // 119 days before the fixed today
      if (fitPersonalExponent([races[0], mk({ date: staleDate })], '2026-08-28') != null) {
        throw new Error('a stale race qualified for the fit · both inputs must be recent');
      }
    },
  },
  {
    id: 'PREDICTION.exponent-fit-freshness-window',
    binds: ['lib/race/coach-goal.ts#EXPONENT_FIT_WINDOW_DAYS'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '**Operative rule:** within the last 8 weeks',
    claim:
      "Recent means Research/01's operative freshness window — the last 8 weeks (≤56 " +
      'days), the same window inside which a race result is the canonical fitness input.',
    check({ cite }) {
      const m = matchLiteral(
        cite.text(), /within the last 8 weeks \(≤\s*(\d+)\s*days\)/,
        'the operative freshness window',
      );
      const docDays = Number(m[1]);
      if (EXPONENT_FIT_WINDOW_DAYS !== docDays) {
        throw new Error(
          `EXPONENT_FIT_WINDOW_DAYS = ${EXPONENT_FIT_WINDOW_DAYS} · doctrine's window is ${docDays} days`,
        );
      }
    },
  },
  {
    id: 'PREDICTION.marathon-specificity-point-adjustment',
    binds: [
      'lib/training/goal-projection.ts#MARATHON_SPECIFICITY_PENALTY_PCT',
      'lib/training/goal-projection.ts#marathonSpecificityAdjustment',
    ],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '**Adjustment rule**: for marathon prediction from a sub-half-marathon input',
    claim:
      'A marathon predicted from sub-marathon evidence without marathon-specific training ' +
      'carries a +5% one-sided adjustment to the prediction itself — not just a wider band. ' +
      "REVIEW_NOTES A5 (2026-08-28) resolves the corpus's four phrasings to this same +5% " +
      'for a half-marathon input, never stacked with the 1.5-VDOT prescription rule.',
    check({ cite }) {
      const m = matchLiteral(
        cite.text(), /add (\d+)% if marathon-specific training is absent/,
        "§13.1's adjustment rule",
      );
      const docPct = Number(m[1]);
      if (MARATHON_SPECIFICITY_PENALTY_PCT !== docPct) {
        throw new Error(
          `MARATHON_SPECIFICITY_PENALTY_PCT = ${MARATHON_SPECIFICITY_PENALTY_PCT} · doctrine says ${docPct}`,
        );
      }
      const M = 26.2188; const HM = 13.1094; const TENK = 6.21371; const FIVEK = 3.10686;
      for (const anchorMi of [FIVEK, TENK, HM]) {
        const adj = marathonSpecificityAdjustment(M, anchorMi, null);
        if (!adj || adj.pct !== docPct || adj.oneSided !== true) {
          throw new Error(`the +${docPct}% one-sided rule does not fire for a ${anchorMi}mi anchor with no block`);
        }
      }
      if (marathonSpecificityAdjustment(M, HM, true) != null) {
        throw new Error('the penalty fires even with a marathon block in place · §13.1 scopes it to absent training');
      }
      if (marathonSpecificityAdjustment(M, M, null) != null) {
        throw new Error('marathon evidence is being penalised · the rule is for sub-marathon inputs');
      }
      if (marathonSpecificityAdjustment(HM, TENK, null) != null) {
        throw new Error('the penalty fires on a non-marathon target · §13.1 states it for marathon prediction');
      }
    },
  },
  {
    id: 'COURSE.hilly-goal-framing-floor',
    binds: ['lib/race/coach-goal.ts#HILLY_GAIN_FT_PER_MI', 'lib/race/coach-goal.ts#STEEP_GAIN_FT_PER_MI', 'lib/race/coach-goal.ts#gradeCourse', 'lib/race/coach-goal.ts#courseIsHilly'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '### 13.2 Course Profile',
    claim:
      "§13.2's tiers, read per mile at marathon scale, partition the coach-goal course bands: " +
      'the Hilly row (500-1500 ft ≈ 19-57 ft/mi, 2-5% slowdown) is the ROLLING band — priceable ' +
      'terrain, graded time framing (David 2026-08-28) — and the Mountain row (> 1500 ft ≈ 57 ' +
      'ft/mi) is STEEP, where a flat-equivalent time stops meaning anything (Research/11: ' +
      'effort-based pacing, not pace-based). The two boundaries come from the same table row, ' +
      'so the bands are contiguous by construction.',
    check({ cite }) {
      // Read BOTH band edges out of the doc's own Hilly row label.
      const hillyRow = cite.section.find((l) => /Hilly \(/.test(l));
      if (!hillyRow) throw new Error('§13.2 no longer has a Hilly row · re-read the claim');
      const [floorFt, ceilFt] = parseBand(hillyRow.replace(/\/.*$/, ''));
      const M = 26.2188;
      const expectedFloor = Math.round(floorFt / M);
      const expectedCeil = Math.round(ceilFt / M);
      if (HILLY_GAIN_FT_PER_MI !== expectedFloor) {
        throw new Error(
          `HILLY_GAIN_FT_PER_MI = ${HILLY_GAIN_FT_PER_MI} · §13.2's Hilly floor (${floorFt} ft) ` +
          `at marathon scale is ${expectedFloor} ft/mi`,
        );
      }
      if (STEEP_GAIN_FT_PER_MI !== expectedCeil) {
        throw new Error(
          `STEEP_GAIN_FT_PER_MI = ${STEEP_GAIN_FT_PER_MI} · §13.2's Hilly ceiling (${ceilFt} ft) ` +
          `at marathon scale is ${expectedCeil} ft/mi`,
        );
      }
      // The Mountain row's own floor must agree — contiguity is the doc's.
      const mountainRow = cite.section.find((l) => /Mountain \(/.test(l));
      if (!mountainRow) throw new Error('§13.2 no longer has a Mountain row · re-read the claim');
      const [mountainFloorFt] = parseBand(mountainRow.replace(/\/.*$/, ''));
      if (mountainFloorFt !== ceilFt) {
        throw new Error(`§13.2's Mountain floor (${mountainFloorFt} ft) no longer meets the Hilly ceiling (${ceilFt} ft)`);
      }
      // The grader actually uses both boundaries, in all three directions.
      const gradeAt = (perMi: number) =>
        gradeCourse({ elevationGainFt: perMi * 6.2, distanceMi: 6.2 }).grade;
      if (gradeAt(expectedFloor - 5) !== 'flat') throw new Error('a course under the Hilly floor is not flat');
      if (gradeAt(expectedFloor + 2) !== 'rolling') throw new Error('a course past the Hilly floor is not rolling');
      if (gradeAt(expectedCeil + 2) !== 'steep') throw new Error('a course past the Mountain floor is not steep');
      // Back-compat boolean keeps the floor.
      if (!courseIsHilly({ elevationGainFt: expectedFloor * 6.2 + 10, distanceMi: 6.2 })) {
        throw new Error('a course past the Hilly floor is not classified hilly');
      }
      if (courseIsHilly({ elevationGainFt: expectedFloor * 6.2 - 40, distanceMi: 6.2 })) {
        throw new Error('a course well under the Hilly floor is classified hilly');
      }
    },
  },
  {
    id: 'COURSE.rolling-graded-steep-effort',
    binds: ['lib/race/coach-goal.ts#deriveCoachGoal', 'lib/race/goal-framing.ts#gradeGetsTheAsk'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: '### 13.2 Course Profile',
    claim:
      'Owner ruling 2026-08-28 over §13.2: in the Hilly tier (rolling band) the coach grades the ' +
      'A/B/C for the course and carries the effort guidance as a secondary line — the default ' +
      "while the race_goal_framing ask is unanswered — with the runner's persisted " +
      "meta.goalFraming as the override ('effort' flips to effort-only). Past the tier " +
      '(Mountain / steep) the framing is effort-only regardless, and a rolling grade with no ' +
      'measured gain behind it cannot be priced and stays effort — a fabricated number is worse ' +
      'than none. Only the rolling band ever gets the ask.',
    check() {
      const base = {
        statedGoalSec: null, priority: 'B', distanceMi: 6.21371,
        vdot: 50, todayISO: '2026-08-28',
      } as const;
      const rolling = { grade: 'rolling' as const, gainFtPerMi: 32.5, elevationGainFt: 202 };
      // Default (unanswered) → graded time plus the effort line.
      const g = deriveCoachGoal({ ...base, course: rolling });
      if (!g || g.kind !== 'time') throw new Error('a rolling course did not default to graded time framing');
      if (g.hillAdjustedSec == null || g.hillAdjustedSec <= 0) {
        throw new Error('the rolling default carries no hill adjustment');
      }
      if (!g.effortLine) throw new Error('the rolling default dropped the effort guidance line');
      // Answered 'time' → same shape. Answered 'effort' → effort framing.
      const gt = deriveCoachGoal({ ...base, course: rolling, goalFraming: 'time' });
      if (!gt || gt.kind !== 'time') throw new Error("an answered 'time' framing lost the graded numbers");
      const ge = deriveCoachGoal({ ...base, course: rolling, goalFraming: 'effort' });
      if (!ge || ge.kind !== 'effort') throw new Error("an answered 'effort' framing kept a time goal");
      // Steep → effort, even with an answered 'time' (no honest number exists).
      const steep = { grade: 'steep' as const, gainFtPerMi: 80, elevationGainFt: 500 };
      for (const goalFraming of [null, 'time'] as const) {
        const gs = deriveCoachGoal({ ...base, course: steep, goalFraming });
        if (!gs || gs.kind !== 'effort') {
          throw new Error('a steep course got a flat-equivalent time goal · Research/11 says effort, not pace');
        }
      }
      // Unpriceable rolling (terrain flag, no measurement) → effort.
      const gu = deriveCoachGoal({
        ...base, course: { grade: 'rolling', gainFtPerMi: null, elevationGainFt: null },
      });
      if (!gu || gu.kind !== 'effort') throw new Error('an unpriceable rolling course was given a fabricated number');
      // Legacy boolean keeps its meaning: hilly with nothing behind it → effort.
      const gl = deriveCoachGoal({ ...base, hilly: true });
      if (!gl || gl.kind !== 'effort') throw new Error('the legacy hilly boolean stopped meaning effort framing');
      // The ask is scoped to the band where both answers are defensible.
      if (!gradeGetsTheAsk('rolling') || gradeGetsTheAsk('flat') || gradeGetsTheAsk('steep')) {
        throw new Error('the framing ask is not scoped to the rolling band');
      }
    },
  },
  {
    id: 'COURSE.hill-cost-rate',
    binds: ['lib/race/coach-goal.ts#HILL_RATE_SEC_PER_MI_PER_100FT', 'lib/race/coach-goal.ts#HILL_ADJUSTMENT_MAX_PCT', 'lib/race/coach-goal.ts#hillAdjustmentSec'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: 'Rule of thumb: each 100 ft (30 m) of net elevation gain',
    claim:
      "§13.2's rule of thumb prices climb at ~2-4 sec/mile per 100 ft of gain, and states that " +
      'downhills do not symmetrically refund the cost. The engine spends the rate inside the ' +
      "doc's own 2-4 band (interpolated by gain density across the rolling band), charges GROSS " +
      'gain with no descent credit (pricing net on a hilly loop would claim exactly the refund ' +
      "02:389 denies), never returns a negative adjustment, and caps the total at the Hilly " +
      "tier's stated 5% ceiling.",
    check({ cite }) {
      const bands = parseBands(cite.section[0]);
      if (bands.length === 0) throw new Error('the rule-of-thumb line no longer carries the 2-4 s/mi band');
      const [rLo, rHi] = bands[0];
      if (HILL_RATE_SEC_PER_MI_PER_100FT[0] !== rLo || HILL_RATE_SEC_PER_MI_PER_100FT[1] !== rHi) {
        throw new Error(
          `HILL_RATE_SEC_PER_MI_PER_100FT = [${HILL_RATE_SEC_PER_MI_PER_100FT}] · doctrine's band is [${rLo}, ${rHi}]`,
        );
      }
      if (!/downhills do not symmetrically refund/.test(cite.text())) {
        throw new Error('02:389 no longer states the descent asymmetry · re-read the gross-gain argument');
      }
      // The cap comes from the Hilly row's own percentage band ceiling.
      const tier = resolveCitation('Research/02-race-time-prediction.md', '### 13.2 Course Profile');
      const hillyRow = tier.section.find((l) => /Hilly \(/.test(l));
      if (!hillyRow) throw new Error('§13.2 no longer has a Hilly row · re-read the claim');
      const pctBand = parseBand(hillyRow.replace(/^.*\)/, ''));
      if (HILL_ADJUSTMENT_MAX_PCT !== pctBand[1]) {
        throw new Error(
          `HILL_ADJUSTMENT_MAX_PCT = ${HILL_ADJUSTMENT_MAX_PCT} · the Hilly tier's ceiling is ${pctBand[1]}%`,
        );
      }
      // The engine reproduces the doc's arithmetic at the band floor: at the
      // rolling floor the rate is the doc's own low end, so
      // cost = (gain/100) × rLo × miles, exactly.
      const dist = 6.21371;
      const gainAtFloor = HILLY_GAIN_FT_PER_MI * dist;
      const atFloor = hillAdjustmentSec({ elevationGainFt: gainAtFloor, distanceMi: dist, baseSec: 2755 });
      if (!atFloor) throw new Error('the band floor is not priced');
      const expect = Math.round((gainAtFloor / 100) * rLo * dist);
      if (Math.abs(atFloor.costSec - expect) > 1) {
        throw new Error(`floor cost ${atFloor.costSec}s != the doc's own arithmetic (${expect}s)`);
      }
      // Monotone in gain, capped at the tier ceiling, never negative.
      const mid = hillAdjustmentSec({ elevationGainFt: 202, distanceMi: dist, baseSec: 2755 });
      if (!mid || mid.costSec <= atFloor.costSec) throw new Error('more climb does not cost more');
      const high = hillAdjustmentSec({
        elevationGainFt: (STEEP_GAIN_FT_PER_MI - 1) * dist, distanceMi: dist, baseSec: 2755,
      });
      if (!high || high.costSec > Math.round(2755 * (HILL_ADJUSTMENT_MAX_PCT / 100))) {
        throw new Error('the hill cost exceeds the Hilly tier\'s stated ceiling');
      }
      if (hillAdjustmentSec({ elevationGainFt: 0, distanceMi: dist, baseSec: 2755 }) != null
        || hillAdjustmentSec({ elevationGainFt: -100, distanceMi: dist, baseSec: 2755 }) != null) {
        throw new Error('a flat or net-downhill course was handed a hill adjustment · descents refund nothing here');
      }
    },
  },
  {
    id: 'RACEROLE.half-tuneup-window',
    binds: [
      'lib/race/race-role.ts#HALF_B_EFFORT_GAP_DAYS',
      'lib/race/race-role.ts#HALF_HONEST_RACE_GAP_DAYS',
      'lib/race/race-role.ts#recommendRaceRole',
    ],
    doc: 'Research/02-race-time-prediction.md',
    anchor: 'a half marathon 4–6 weeks before marathon goal, raced at race effort',
    claim:
      "§12.3 sanctions the tune-up half at 4-6 weeks before the marathon, raced at race effort. " +
      'REVIEW_NOTES A2 (2026-08-28) resolves the collision inside that window: at exactly 4 weeks ' +
      "an A-effort half's 10-14 no-quality days (00b) consume week -3's final MP session (08 §9.2), " +
      'so 4 weeks = B effort, 5-6 weeks = honest race, closer than 4 weeks = convert to the MP long. ' +
      'The recommendation bands must partition the doc\'s own window: the honest-race band tops out ' +
      "at the doc's 6 weeks, the B-effort band brackets the doc's 4 weeks, the two are contiguous, " +
      'and honest racing never reaches down into week 4.',
    check({ cite }) {
      // The doc's window, read off the anchor line itself ("4–6 weeks").
      const bands = parseBands(cite.section[0]);
      if (bands.length === 0) throw new Error('§12.3 protocol line no longer carries the 4-6 week band');
      const [loWk, hiWk] = bands[0];
      if (HALF_HONEST_RACE_GAP_DAYS[1] !== hiWk * 7) {
        throw new Error(
          `honest-race band tops out at ${HALF_HONEST_RACE_GAP_DAYS[1]}d · §12.3's window ends at ${hiWk * 7}d`,
        );
      }
      const fourWeeks = loWk * 7;
      if (fourWeeks < HALF_B_EFFORT_GAP_DAYS[0] || fourWeeks > HALF_B_EFFORT_GAP_DAYS[1]) {
        throw new Error(
          `B-effort band [${HALF_B_EFFORT_GAP_DAYS}] does not bracket the doc's 4-week mark (${fourWeeks}d)`,
        );
      }
      if (HALF_B_EFFORT_GAP_DAYS[1] + 1 !== HALF_HONEST_RACE_GAP_DAYS[0]) {
        throw new Error('the B-effort and honest-race bands must be contiguous · a gap day would have no recommendation');
      }
      if (HALF_HONEST_RACE_GAP_DAYS[0] <= HALF_B_EFFORT_GAP_DAYS[1]) {
        throw new Error('honest racing reaches down into the 4-week band · A2 sanctions A-effort at 5-6 weeks only');
      }
      // The matrix answers the doc, not just the constants.
      const at = (gapToADays: number) =>
        recommendRaceRole({ category: 'hm', priority: 'B', gapToADays, aRaceIsMarathon: true })?.role;
      if (at(fourWeeks) !== 'b_effort') throw new Error(`a half at ${fourWeeks}d (4 weeks) must recommend B effort`);
      if (at(HALF_HONEST_RACE_GAP_DAYS[0]) !== 'race' || at(hiWk * 7) !== 'race') {
        throw new Error('a half at 5-6 weeks must recommend racing it honestly');
      }
      if (at(fourWeeks - 7) !== 'mp_workout') {
        throw new Error('a half closer than the 4-week sanction must convert to the week -3 MP session');
      }
      // Decided races never get a card: C is a fun run, A is not a tune-up.
      for (const priority of ['C', 'A'] as const) {
        if (recommendRaceRole({ category: 'hm', priority, gapToADays: fourWeeks, aRaceIsMarathon: true }) != null) {
          throw new Error(`a ${priority}-priority race must never receive a race-role recommendation`);
        }
      }
    },
  },
  {
    id: 'RACEROLE.recovery-scale',
    binds: [
      'lib/race/race-role.ts#ROLE_POST_QUALITY_FREE_DAYS',
      'lib/plan/generate.ts#embedMidBlockRaces',
      'lib/race/race-role-apply.ts#applyRaceRole',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: 'For a B-race half marathon, expect 7–10 days of recovery rather than 14.',
    claim:
      'Recovery after a tune-up follows the EFFORT GIVEN, not the calendar letter. An answered ' +
      "B-effort half owes the doc's stated 7-10 days of no quality; an answered honest race owes " +
      "the by-distance A-effort table's window (half 10-14 · 10K 5-7 · 5K 3-5, taken at the floor " +
      'because an honest tune-up still is not a goal race). The role windows must sit inside their ' +
      "doc bands, an honest race must never owe LESS than a B effort, and the constant must be " +
      'SPENT by both consumers: the embedder (rebuild path) and the accept patch (immediate path).',
    check({ cite }) {
      // The B-scale sentence, read off the anchor line itself ("7–10 days").
      const bBands = parseBands(cite.section[0]);
      if (bBands.length === 0) throw new Error('00b no longer states the B-race half window in days');
      within(ROLE_POST_QUALITY_FREE_DAYS.hm.b_effort, bBands[0], 'ROLE_POST_QUALITY_FREE_DAYS.hm.b_effort');
      // Honest-race windows against the by-distance table (same anchor the
      // LIFECYCLE.open-block-recovery-window claim resolves).
      const dist = resolveCitation(
        'Research/00b-recovery-protocols.md',
        '| Total recovery days (no quality) | Days of zero/very-light running |',
      ).table();
      const col = 'Total recovery days (no quality)';
      within(ROLE_POST_QUALITY_FREE_DAYS.hm.race, parseBand(dist.cell('Half marathon', col)), 'ROLE_POST_QUALITY_FREE_DAYS.hm.race');
      within(ROLE_POST_QUALITY_FREE_DAYS['10k'].race, parseBand(dist.cell('10K', col)), 'ROLE_POST_QUALITY_FREE_DAYS.10k.race');
      within(ROLE_POST_QUALITY_FREE_DAYS['5k'].race, parseBand(dist.cell('5K', col)), 'ROLE_POST_QUALITY_FREE_DAYS.5k.race');
      for (const cat of ['hm', '10k', '5k'] as const) {
        const w = ROLE_POST_QUALITY_FREE_DAYS[cat];
        if (w.b_effort > w.race) {
          throw new Error(`${cat}: a B effort (${w.b_effort}d) owes more recovery than an honest race (${w.race}d)`);
        }
      }
      // WIRED · both consumers actually spend the constant.
      for (const [file, needle] of [
        ['web-v2/lib/plan/generate.ts', 'ROLE_POST_QUALITY_FREE_DAYS[roleCat][role]'],
        ['web-v2/lib/race/race-role-apply.ts', 'ROLE_POST_QUALITY_FREE_DAYS[cat][role]'],
      ] as const) {
        if (!sourceOf(file).includes(needle)) {
          throw new Error(`${file} shapes a role's recovery window without ROLE_POST_QUALITY_FREE_DAYS · the answered role would not change the window`);
        }
      }
    },
  },

  /**
   * 2026-08-30/31 · PACE-CORPUS-1 · the direct-evidence easy/threshold pace
   * readers (`lib/training/pace-corpus.ts`, Phase 2 of the owner's
   * anchor-in-the-running ruling — see `lib/training/vdot-corpus.ts`'s header
   * for Phase 1). Three claims: the %HRmax bands for Daniels E and T (§8's
   * own table), and the %LTHR crosswalk for both (§17) that the readers use
   * when a fresh LTHR outranks %HRmax per the doc's own stated precedence.
   */
  {
    id: 'PACE.easy-zone-is-daniels-e',
    binds: ['lib/training/pace-corpus.ts#EASY_PCT_HRMAX_BAND'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: "## 8. Daniels' HR Zones",
    claim:
      'The direct-evidence easy-pace corpus reader gates a candidate run\'s heart rate against ' +
      "the published Daniels E row's %HRmax column, read out of the table at run time rather " +
      'than hardcoded on both sides.',
    check({ cite }) {
      const t = cite.table();
      const band = parsePctBand(t.cell('E (Easy)', '%HRmax'));
      if (Math.abs(band[0] - EASY_PCT_HRMAX_BAND[0]) > 0.001 || Math.abs(band[1] - EASY_PCT_HRMAX_BAND[1]) > 0.001) {
        throw new Error(`EASY_PCT_HRMAX_BAND is ${EASY_PCT_HRMAX_BAND}, Research/03 §8's E row is ${band}`);
      }
    },
  },
  {
    id: 'PACE.threshold-zone-is-daniels-t',
    binds: [
      'lib/training/pace-corpus.ts#THRESHOLD_PCT_HRMAX_BAND',
      'lib/training/pace-corpus.ts#THRESHOLD_MIN_QUALIFYING_SEC',
      'lib/training/pace-corpus.ts#THRESHOLD_MAX_QUALIFYING_SEC',
      'lib/training/pace-corpus.ts#THRESHOLD_MAX_REP_SEC',
      'lib/training/pace-corpus.ts#THRESHOLD_MIN_SESSION_TOTAL_SEC',
    ],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: "## 8. Daniels' HR Zones",
    claim:
      'The direct-evidence threshold-pace corpus reader gates a candidate segment\'s heart rate ' +
      "against the published Daniels T row's %HRmax column, and its qualifying-duration floor " +
      "and ceiling — both the per-REP window (5-20 min, applied literally per-phase against " +
      "coach_intents.value.phases, since a phase IS one rep) and the per-SESSION pooled-total " +
      "window (20-60 min) — are the table's own \"reps 5-20 min, total 20-60 min\", read out of " +
      'the doc at run time, not hardcoded.',
    check({ cite }) {
      const t = cite.table();
      const band = parsePctBand(t.cell('T (Threshold)', '%HRmax'));
      if (Math.abs(band[0] - THRESHOLD_PCT_HRMAX_BAND[0]) > 0.001 || Math.abs(band[1] - THRESHOLD_PCT_HRMAX_BAND[1]) > 0.001) {
        throw new Error(`THRESHOLD_PCT_HRMAX_BAND is ${THRESHOLD_PCT_HRMAX_BAND}, Research/03 §8's T row is ${band}`);
      }
      const durationCell = t.cell('T (Threshold)', 'Typical duration');
      const bands = parseBands(durationCell);
      if (bands.length === 0) {
        throw new Error(`Research/03 §8's T row duration cell "${durationCell}" no longer states a rep/total band`);
      }
      const repFloorMin = bands[0][0];
      const repCeilMin = bands[0][1];
      const totalFloorMin = bands.length > 1 ? bands[1][0] : bands[0][0];
      const totalCeilMin = bands.length > 1 ? bands[1][1] : bands[0][1];
      if (THRESHOLD_MIN_QUALIFYING_SEC !== repFloorMin * 60) {
        throw new Error(
          `THRESHOLD_MIN_QUALIFYING_SEC is ${THRESHOLD_MIN_QUALIFYING_SEC}s, Research/03 §8's T row rep floor is ${repFloorMin} min`,
        );
      }
      if (THRESHOLD_MAX_QUALIFYING_SEC < totalCeilMin * 60) {
        throw new Error(
          `THRESHOLD_MAX_QUALIFYING_SEC is ${THRESHOLD_MAX_QUALIFYING_SEC}s, under Research/03 §8's T row total ceiling of ${totalCeilMin} min`,
        );
      }
      // Added 2026-08-31 alongside the coach_intents.value.phases source —
      // a phase is a real rep boundary, so unlike the mile-granular splits
      // pool the REP ceiling is enforced literally, not just the total.
      if (THRESHOLD_MAX_REP_SEC !== repCeilMin * 60) {
        throw new Error(
          `THRESHOLD_MAX_REP_SEC is ${THRESHOLD_MAX_REP_SEC}s, Research/03 §8's T row rep ceiling is ${repCeilMin} min`,
        );
      }
      if (THRESHOLD_MIN_SESSION_TOTAL_SEC !== totalFloorMin * 60) {
        throw new Error(
          `THRESHOLD_MIN_SESSION_TOTAL_SEC is ${THRESHOLD_MIN_SESSION_TOTAL_SEC}s, Research/03 §8's T row total floor is ${totalFloorMin} min`,
        );
      }
    },
  },
  {
    id: 'PACE.hrmax-lthr-crosswalk-matches-daniels-e-and-t',
    binds: [
      'lib/training/pace-corpus.ts#EASY_PCT_LTHR_BAND',
      'lib/training/pace-corpus.ts#THRESHOLD_PCT_LTHR_BAND',
    ],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Conversion Between Systems',
    claim:
      'When a fresh LTHR is available the direct-evidence pace readers gate on %LTHR instead of ' +
      '%HRmax (Research/03 §17: "If two systems disagree, the more individualized one (LTHR > ' +
      'Karvonen > %HRmax) wins"). The %LTHR bands for Daniels E and Daniels T are the doc\'s own ' +
      'crosswalk equivalences, read out of the text at run time.',
    check({ cite }) {
      const text = cite.text();
      const easyM = matchLiteral(text, /%LTHR\s+([\d.]+)[–-]([\d.]+)%\s*≈\s*Daniels E/, 'EASY_PCT_LTHR_BAND');
      const tM = matchLiteral(text, /%LTHR\s+([\d.]+)[–-]([\d.]+)%\s*≈\s*Daniels T/, 'THRESHOLD_PCT_LTHR_BAND');
      const easyBand: [number, number] = [Number(easyM[1]) / 100, Number(easyM[2]) / 100];
      const tBand: [number, number] = [Number(tM[1]) / 100, Number(tM[2]) / 100];
      if (Math.abs(easyBand[0] - EASY_PCT_LTHR_BAND[0]) > 0.001 || Math.abs(easyBand[1] - EASY_PCT_LTHR_BAND[1]) > 0.001) {
        throw new Error(`EASY_PCT_LTHR_BAND is ${EASY_PCT_LTHR_BAND}, Research/03 §17 crosswalk is ${easyBand}`);
      }
      if (Math.abs(tBand[0] - THRESHOLD_PCT_LTHR_BAND[0]) > 0.001 || Math.abs(tBand[1] - THRESHOLD_PCT_LTHR_BAND[1]) > 0.001) {
        throw new Error(`THRESHOLD_PCT_LTHR_BAND is ${THRESHOLD_PCT_LTHR_BAND}, Research/03 §17 crosswalk is ${tBand}`);
      }
    },
  },
];

/** The four race-week templates in Research/08 section 9.3, by their own
 *  headings. Shared by the two RACE_RUNUP claims so neither can be updated to
 *  a different set of templates than the other. */
const RACE_WEEK_TEMPLATES = [
  '**Marathon — race week template (Sunday race):**',
  '**Half marathon — race week template (Sunday race):**',
  '**10K — race week template (Saturday race):**',
  '**5K — race week template (Saturday race):**',
];
