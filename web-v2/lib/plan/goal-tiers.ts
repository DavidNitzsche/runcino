/**
 * lib/plan/goal-tiers.ts · goal-tier classification + doctrine targets.
 *
 * David's 2026-06-02 ask: fail-proof plan generator. Bench-tested
 * against every tier × distance combination. No hardcoded one-offs.
 *
 * The system was previously "race distance" based (`cat: '5k' | '10k'
 * | 'hm' | 'm'`) which is too coarse. A 1:30 HM runner needs different
 * training than a 2:00 HM runner even though both target HM. This
 * module classifies plans by GOAL TIER (elite / advanced /
 * intermediate / developing) per race distance · then provides tier
 * targets sourced directly from Research/22-plan-templates.md.
 *
 * Architecture:
 *   1. classifyGoalTier(goalPaceSec, raceDistanceMi) → GoalTier
 *   2. TIER_TARGETS[distance][tier] → { peakWeekly, peakLong, ...}
 *   3. generator ramps baseMi → tier.peakWeekly over the build
 *   4. peakLong respects tier.peakLong band (top of the band when
 *      runner has runway, lower when conservative)
 *
 * Cite: Research/22-plan-templates.md
 * Cite: Research/00a-distance-running-training.md §periodization
 */

export type GoalTier =
  | 'elite'         // sub-elite paces · world-class targets
  | 'advanced'      // sub-1:30 HM, sub-3 M, sub-18 5K territory
  | 'intermediate'  // sub-2:00 HM, sub-4 M, sub-25 5K
  | 'developing';   // first-race / 2:00+ HM, 4:30+ M

export type DistCategory = '5k' | '10k' | 'hm' | 'm' | 'ultra';

/**
 * 2026-06-03 · Rule 12 · build-window per distance.
 *
 * The maximum useful race-specific build duration. Past this, you're
 * burning the runner out without additional gain. Used by pickPlanMode
 * to decide if a future race is close enough to warrant race-prep mode
 * (vs maintenance mode that waits for the build window to open).
 *
 * Cite: Daniels Running Formula 3rd ed §"Building the Plan"
 * Cite: Pfitzinger Faster Road Racing §"Block Periodization"
 */
export const BUILD_WINDOW_WEEKS: Record<DistCategory, number> = {
  '5k': 10,
  '10k': 12,
  'hm': 14,
  'm': 18,
  'ultra': 24,
};

/**
 * 2026-06-03 · Rule 13 · post-race recovery weeks per distance.
 *
 * Mandatory low-volume easy-running window AFTER a race finishes,
 * BEFORE either maintenance or the next race-prep starts. Pfitz
 * explicitly says skipping recovery causes overtraining 80% of the
 * time. Race-prep blocks that fire too soon after a race land into
 * a runner with depleted glycogen + microscopic muscle damage and
 * stall out by week 3.
 *
 * Cite: Pfitzinger Advanced Marathoning §"Post-race recovery"
 * Cite: Daniels Running Formula §"Recovery after racing"
 */
// 2026-06-23 · RECOVERY-1 · post-race recovery duration per Research/00b:197-208 (marathon 21-28
// days / return to quality wk3-4; HM 10-14 days). Was hm:1/m:2 — ~2 weeks too short → under-recovery
// (this composer's own header warns under-recovery causes overtraining 80% of the time).
export const POST_RACE_RECOVERY_WEEKS: Record<DistCategory, number> = {
  '5k': 0,    // 2-3 days easy, no full week needed
  '10k': 1,
  'hm': 2,
  'm': 4,
  'ultra': 4,
};

/**
 * 2026-06-03 · Rule 12 · maintenance-mode shape per tier.
 *
 * When a runner has no race within the build window (BUILD_WINDOW_WEEKS),
 * the plan enters MAINTENANCE mode · holds aerobic fitness + leg
 * turnover without race-specific stress. Anchored to the runner's
 * recent peak (from the just-completed race-prep block) so the
 * shape is per-runner even though the percentages are doctrine.
 *
 * Frequency holds (Daniels' "use it or lose it" curve · dropping
 * days/wk loses neuromuscular pattern fast). Volume + quality drop.
 * VO2 work is CUT entirely · with no race in window that stress
 * is just damaging.
 *
 * Cite: Pfitzinger Faster Road Racing §"Recovery & Off-Season Training"
 * Cite: Daniels Running Formula 3rd ed §"Off-Season Training"
 * Cite: Hudson Run Faster Ch. 7 §"Maintenance Periods"
 */
export interface MaintenanceShape {
  /** Days running per week · held from race-prep habit. */
  daysPerWeek: number;
  /** Weekly volume as fraction of recent race-prep peak (0-1). */
  weeklyPctOfPeak: number;
  /** Long run as fraction of recent peak long (0-1). */
  longPctOfPeak: number;
  /** Quality sessions per week (always 1 for maintenance · never 2). */
  qualityPerWeek: 0 | 1;
  /** Quality type for maintenance · NO vo2/intervals. */
  qualityType: 'threshold' | 'fartlek' | 'none';
}

export const MAINTENANCE_BY_TIER: Record<GoalTier, MaintenanceShape> = {
  elite:        { daysPerWeek: 7, weeklyPctOfPeak: 0.75, longPctOfPeak: 0.80, qualityPerWeek: 1, qualityType: 'threshold' },
  advanced:     { daysPerWeek: 6, weeklyPctOfPeak: 0.75, longPctOfPeak: 0.80, qualityPerWeek: 1, qualityType: 'threshold' },
  intermediate: { daysPerWeek: 5, weeklyPctOfPeak: 0.70, longPctOfPeak: 0.75, qualityPerWeek: 1, qualityType: 'fartlek' },
  developing:   { daysPerWeek: 5, weeklyPctOfPeak: 0.70, longPctOfPeak: 0.70, qualityPerWeek: 0, qualityType: 'none' },
};

export type PlanMode = 'race-prep' | 'maintenance' | 'recovery';

/**
 * 2026-06-03 · Rule 12 + 13 · pick plan mode based on temporal context.
 *
 * Three modes:
 *   - 'recovery'    · within POST_RACE_RECOVERY_WEEKS of the last race
 *                     finish. Light easy running. Mandatory.
 *   - 'race-prep'   · next race is within BUILD_WINDOW_WEEKS of today.
 *                     Full periodized build (Base/Build/Peak/Taper).
 *   - 'maintenance' · next race is OUTSIDE the build window. Holding
 *                     pattern · 70-80% of peak, 1 quality/wk, no
 *                     race-specific work. Waits for transition.
 *
 * The maintenance-to-race-prep transition fires automatically when
 * today crosses (nextRaceDate − BUILD_WINDOW_WEEKS).
 *
 * Cite: Pfitzinger Faster Road Racing §"Block Periodization"
 */
export function pickPlanMode(
  todayISO: string,
  nextRaceDateISO: string | null,
  nextRaceDistanceMi: number | null,
  lastRaceFinishedISO: string | null,
  lastRaceDistanceMi: number | null,
): PlanMode {
  const today = new Date(todayISO + 'T12:00:00Z').getTime();
  // 1. Recovery check · within POST_RACE_RECOVERY_WEEKS of last race finish?
  if (lastRaceFinishedISO && lastRaceDistanceMi) {
    const lastCat = distanceCategoryOf(lastRaceDistanceMi);
    const recoveryEnd = new Date(lastRaceFinishedISO + 'T12:00:00Z').getTime()
      + POST_RACE_RECOVERY_WEEKS[lastCat] * 7 * 86400000;
    if (today < recoveryEnd) return 'recovery';
  }
  // 2. No next race · maintenance by default
  if (!nextRaceDateISO || !nextRaceDistanceMi) return 'maintenance';
  // 3. Race-prep when next race is within build window
  const nextCat = distanceCategoryOf(nextRaceDistanceMi);
  const buildWindowMs = BUILD_WINDOW_WEEKS[nextCat] * 7 * 86400000;
  const raceMs = new Date(nextRaceDateISO + 'T12:00:00Z').getTime();
  const weeksOut = (raceMs - today) / (7 * 86400000);
  if (weeksOut > 0 && (raceMs - today) <= buildWindowMs) return 'race-prep';
  // 4. Too far out · maintenance until build window opens
  return 'maintenance';
}

export interface TierTarget {
  /** Peak weekly volume target [min, max] in miles. From Research/22. */
  peakWeeklyMileageBand: [number, number];
  /** Peak long run target [min, max] in miles. From Research/22. */
  peakLongMiBand: [number, number];
  /** Quality sessions per week during build/race-specific phase. */
  qualityPerWeek: number;
  /** Long-run share of weekly volume. */
  longRunShare: number;
  /** Days/week running (rest days = 7 - this). */
  daysPerWeek: number;
}

/**
 * Doctrine table · sourced row-by-row from Research/22-plan-templates.md.
 * Each row maps (race distance, goal tier) → training-shape parameters.
 *
 * If a row needs to change, update Research/22 FIRST, then this table.
 * The bench (generator-bench.test.ts) asserts plans match these bands ·
 * any plan-engine commit that breaks the assertions will fail CI.
 */
export const TIER_TARGETS: Record<DistCategory, Record<GoalTier, TierTarget>> = {
  '5k': {
    elite:        { peakWeeklyMileageBand: [55, 80], peakLongMiBand: [10, 14], qualityPerWeek: 3, longRunShare: 0.18, daysPerWeek: 6 },
    advanced:     { peakWeeklyMileageBand: [35, 50], peakLongMiBand: [8, 12],  qualityPerWeek: 2, longRunShare: 0.22, daysPerWeek: 5 },
    intermediate: { peakWeeklyMileageBand: [25, 35], peakLongMiBand: [6, 8],   qualityPerWeek: 2, longRunShare: 0.23, daysPerWeek: 4 },
    developing:   { peakWeeklyMileageBand: [16, 24], peakLongMiBand: [3.5, 5], qualityPerWeek: 1, longRunShare: 0.20, daysPerWeek: 3 },
  },
  '10k': {
    elite:        { peakWeeklyMileageBand: [65, 90], peakLongMiBand: [13, 17], qualityPerWeek: 3, longRunShare: 0.20, daysPerWeek: 6 },
    advanced:     { peakWeeklyMileageBand: [40, 55], peakLongMiBand: [13, 15], qualityPerWeek: 2, longRunShare: 0.24, daysPerWeek: 5 }, // XTIER-1 (2026-06-23) · was [10,13] — Research/22:144 10K-Advanced peak long is 13-15mi; the old top sat at research's FLOOR (RC2-2 then drives it into band, clamped ≤30%/week)
    intermediate: { peakWeeklyMileageBand: [30, 42], peakLongMiBand: [9, 12],  qualityPerWeek: 2, longRunShare: 0.28, daysPerWeek: 5 },
    developing:   { peakWeeklyMileageBand: [22, 30], peakLongMiBand: [6, 8],   qualityPerWeek: 1, longRunShare: 0.27, daysPerWeek: 4 },
  },
  'hm': {
    // Research/22 §"Half Marathon — Advanced" · sub-1:30, 45+ mpw base
    // Sample peak week shows 16mi LR / 63mi weekly = 0.254 long share.
    elite:        { peakWeeklyMileageBand: [70, 100], peakLongMiBand: [16, 20], qualityPerWeek: 3, longRunShare: 0.25, daysPerWeek: 7 },
    advanced:     { peakWeeklyMileageBand: [55, 85],  peakLongMiBand: [15, 17], qualityPerWeek: 2, longRunShare: 0.25, daysPerWeek: 6 },
    // Research/22 §"Half Marathon — Intermediate" · sub-2:00, 25-35 mpw base
    intermediate: { peakWeeklyMileageBand: [35, 45],  peakLongMiBand: [12, 14], qualityPerWeek: 2, longRunShare: 0.30, daysPerWeek: 5 },
    developing:   { peakWeeklyMileageBand: [25, 35],  peakLongMiBand: [9, 12],  qualityPerWeek: 1, longRunShare: 0.32, daysPerWeek: 4 },
  },
  'm': {
    // Research/22 §"Marathon — Advanced" · sub-3, 60+ mpw base
    elite:        { peakWeeklyMileageBand: [70, 100], peakLongMiBand: [22, 25], qualityPerWeek: 3, longRunShare: 0.28, daysPerWeek: 7 },
    advanced:     { peakWeeklyMileageBand: [55, 75],  peakLongMiBand: [20, 22], qualityPerWeek: 2, longRunShare: 0.30, daysPerWeek: 6 },
    intermediate: { peakWeeklyMileageBand: [40, 55],  peakLongMiBand: [18, 20], qualityPerWeek: 2, longRunShare: 0.34, daysPerWeek: 5 },
    developing:   { peakWeeklyMileageBand: [30, 45],  peakLongMiBand: [16, 20], qualityPerWeek: 1, longRunShare: 0.40, daysPerWeek: 5 },
  },
  'ultra': {
    // Research/22 §"Ultramarathon" · peak long 22-32 mi or 5-7 hr
    // time-on-feet · 70-100 mpw advanced · B2B long-run option.
    elite:        { peakWeeklyMileageBand: [85, 120], peakLongMiBand: [28, 32], qualityPerWeek: 1, longRunShare: 0.30, daysPerWeek: 6 },
    advanced:     { peakWeeklyMileageBand: [65, 100], peakLongMiBand: [24, 28], qualityPerWeek: 1, longRunShare: 0.30, daysPerWeek: 6 },
    intermediate: { peakWeeklyMileageBand: [50, 75],  peakLongMiBand: [20, 24], qualityPerWeek: 1, longRunShare: 0.32, daysPerWeek: 5 },
    developing:   { peakWeeklyMileageBand: [35, 55],  peakLongMiBand: [16, 20], qualityPerWeek: 1, longRunShare: 0.35, daysPerWeek: 5 },
  },
};

/**
 * Map a goal pace + race distance to the appropriate tier.
 *
 * Thresholds chosen to match Research/22's named cohorts:
 *   · HM advanced ≈ sub-1:30 (6:52/mi) · advanced threshold = 7:00/mi
 *   · HM intermediate ≈ sub-2:00 (9:09/mi) · intermediate threshold = 9:15/mi
 *   · M advanced ≈ sub-3 (6:52/mi) · advanced threshold = 7:00/mi
 *   · 5K advanced ≈ sub-18 (5:48/mi) · advanced threshold = 6:00/mi
 *
 * Falls back to 'intermediate' when goalPaceSec is null (no goal time
 * set yet · plan still needs a tier to build against).
 */
/** Runner experience level for tier clamping · mirrors generate.ts LevelKey, kept local to avoid a circular import. */
export type ExperienceLevelInput = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null | undefined;

const TIER_ORD: Record<GoalTier, number> = { developing: 0, intermediate: 1, advanced: 2, elite: 3 };

export function classifyGoalTier(
  goalPaceSec: number | null | undefined,
  raceDistanceMi: number,
  level?: ExperienceLevelInput,
): GoalTier {
  // VAR-01 · experience CLAMPS the pace-derived tier. Research/22 has distinct per-experience
  // templates (5K Beginner 12-15mi/3day vs Advanced 40-70mi/6-7day; M Beginner 30-35mi/20-long vs
  // Advanced 65-90mi/22-24-long). The tier reflects training CAPACITY (experience), not only goal
  // AMBITION (pace): an advanced runner with a soft goal still has the base for advanced volume; a
  // beginner with an aggressive goal can't absorb advanced bands.
  if (goalPaceSec == null || !Number.isFinite(goalPaceSec) || goalPaceSec <= 0) {
    // No goal yet → default off experience, not a hardcoded 'intermediate'.
    return level === 'beginner' ? 'developing'
      : (level === 'advanced' || level === 'advanced_plus') ? 'advanced'
      : 'intermediate';
  }
  const cat = distanceCategoryOf(raceDistanceMi);
  let tier: GoalTier = 'intermediate';
  switch (cat) {
    case '5k': // sub-17:00 elite · sub-18:30 advanced · sub-24:30 intermediate
      tier = goalPaceSec <= 330 ? 'elite' : goalPaceSec <= 360 ? 'advanced' : goalPaceSec <= 480 ? 'intermediate' : 'developing';
      break;
    case '10k': // sub-35:40 elite · sub-40:24 advanced · sub-52:48 intermediate
      tier = goalPaceSec <= 345 ? 'elite' : goalPaceSec <= 390 ? 'advanced' : goalPaceSec <= 510 ? 'intermediate' : 'developing';
      break;
    case 'hm': // sub-1:18:35 elite · sub-1:31:42 advanced (covers 1:30) · sub-2:01:12 intermediate
      tier = goalPaceSec <= 360 ? 'elite' : goalPaceSec <= 420 ? 'advanced' : goalPaceSec <= 555 ? 'intermediate' : 'developing';
      break;
    case 'm': // sub-2:37:12 elite · sub-3:03:24 advanced (covers sub-3) · sub-4:02:24 intermediate
      tier = goalPaceSec <= 360 ? 'elite' : goalPaceSec <= 420 ? 'advanced' : goalPaceSec <= 555 ? 'intermediate' : 'developing';
      break;
    case 'ultra': // ~30s/mi slower bands than marathon
      tier = goalPaceSec <= 420 ? 'elite' : goalPaceSec <= 480 ? 'advanced' : goalPaceSec <= 600 ? 'intermediate' : 'developing';
      break;
  }
  // Clamp to experience capacity: advanced(+) never below advanced, beginner never above intermediate.
  if (level === 'advanced' || level === 'advanced_plus') return TIER_ORD[tier] < TIER_ORD.advanced ? 'advanced' : tier;
  if (level === 'beginner') return TIER_ORD[tier] > TIER_ORD.intermediate ? 'intermediate' : tier;
  return tier;
}

/**
 * Distance categorization · same buckets as the existing generator
 * but exported as a pure function so the tier classifier doesn't
 * depend on generate.ts. Kept in sync with generate.ts §
 * distanceCategoryOf.
 */
export function distanceCategoryOf(raceDistanceMi: number): DistCategory {
  if (raceDistanceMi <= 4)  return '5k';
  if (raceDistanceMi <= 8)  return '10k';
  if (raceDistanceMi <= 17) return 'hm';
  if (raceDistanceMi <= 30) return 'm';
  return 'ultra';
}

/**
 * Convenience · lookup the tier-target for a (goal pace, race distance)
 * pair. Returns the full TierTarget struct.
 */
export function lookupTierTarget(
  goalPaceSec: number | null | undefined,
  raceDistanceMi: number,
  level?: ExperienceLevelInput,
): { tier: GoalTier; target: TierTarget } {
  const tier = classifyGoalTier(goalPaceSec, raceDistanceMi, level);
  const cat = distanceCategoryOf(raceDistanceMi);
  return { tier, target: TIER_TARGETS[cat][tier] };
}
