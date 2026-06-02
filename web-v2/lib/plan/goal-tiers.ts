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
    advanced:     { peakWeeklyMileageBand: [40, 55], peakLongMiBand: [10, 13], qualityPerWeek: 2, longRunShare: 0.24, daysPerWeek: 5 },
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
export function classifyGoalTier(
  goalPaceSec: number | null | undefined,
  raceDistanceMi: number,
): GoalTier {
  if (goalPaceSec == null || !Number.isFinite(goalPaceSec) || goalPaceSec <= 0) {
    return 'intermediate';
  }
  const cat = distanceCategoryOf(raceDistanceMi);
  switch (cat) {
    case '5k':
      if (goalPaceSec <= 330) return 'elite';        // sub-17:00 5K
      if (goalPaceSec <= 360) return 'advanced';     // sub-18:30
      if (goalPaceSec <= 480) return 'intermediate'; // sub-24:30
      return 'developing';
    case '10k':
      if (goalPaceSec <= 345) return 'elite';        // sub-35:40 10K
      if (goalPaceSec <= 390) return 'advanced';     // sub-40:24
      if (goalPaceSec <= 510) return 'intermediate'; // sub-52:48
      return 'developing';
    case 'hm':
      if (goalPaceSec <= 360) return 'elite';        // sub-1:18:35 HM
      if (goalPaceSec <= 420) return 'advanced';     // sub-1:31:42 (covers 1:30)
      if (goalPaceSec <= 555) return 'intermediate'; // sub-2:01:12
      return 'developing';
    case 'm':
      if (goalPaceSec <= 360) return 'elite';        // sub-2:37:12 M
      if (goalPaceSec <= 420) return 'advanced';     // sub-3:03:24 (covers sub-3)
      if (goalPaceSec <= 555) return 'intermediate'; // sub-4:02:24
      return 'developing';
    case 'ultra':
      // Ultra paces are slower than marathon · classify by goal pace
      // tier shifted ~30s/mi slower than marathon equivalents.
      if (goalPaceSec <= 420) return 'elite';
      if (goalPaceSec <= 480) return 'advanced';
      if (goalPaceSec <= 600) return 'intermediate';
      return 'developing';
  }
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
): { tier: GoalTier; target: TierTarget } {
  const tier = classifyGoalTier(goalPaceSec, raceDistanceMi);
  const cat = distanceCategoryOf(raceDistanceMi);
  return { tier, target: TIER_TARGETS[cat][tier] };
}
