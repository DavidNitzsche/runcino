/**
 * lib/plan/synthetic-runners.ts · 6 synthetic runner personas for the
 * plan engine test bench (Phase 3.1).
 *
 * Each persona is a self-contained input to the plan engine:
 *   · Profile (experience level, weekly base, age, etc.)
 *   · Initial calibration (cold-start vs building vs calibrated)
 *   · Race + goal time
 *   · Expected plan shape (weekly mileage band, quality density,
 *     long-run share, taper depth)
 *
 * The bench (plan-engine.test.ts · Phase 3.2) runs every persona
 * through the full engine and asserts integrity at each step.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 3.1
 */

import type { RunnerCalibrationLike } from './simulator';
import type { ExperienceLevel } from '@/lib/coach/runner-calibration';

export interface PersonaProfile {
  experienceLevel: ExperienceLevel;
  weeklyBaseMi: number;
  vdotAtStart: number;
  ageYears: number;
}

export interface PersonaRace {
  slug: string;
  distanceMi: number;
  goalSec: number;
  weeksOut: number;
}

export interface PersonaExpectedPlan {
  /** Acceptable weekly mileage band [min, max] at PEAK volume week. */
  peakWeeklyMileageBand: [number, number];
  /** Quality workouts per week in QUALITY phase. */
  qualityPerWeek: number;
  /** Long-run share at PEAK (longRunMi / weeklyMi). */
  longRunShare: number;
  /** Taper depth · cut from peak to race-week volume. */
  taperDepth: 'shallow' | 'medium' | 'deep';
}

export interface SyntheticRunner {
  name: string;
  profile: PersonaProfile;
  /** Cold-start defaults to seed calibration with. */
  initialCalibration: RunnerCalibrationLike;
  race: PersonaRace;
  expectedPlan: PersonaExpectedPlan;
  /** Health-signal stream pattern · drives readiness adapter behavior. */
  healthPattern: 'baseline' | 'sleep-debt' | 'rhr-sensitive' | 'returning-from-injury';
}

export const PERSONAS: SyntheticRunner[] = [
  // 1. Beginner 5K · first race ever, building from 12 mpw
  {
    name: 'beginner-5k',
    profile: {
      experienceLevel: 'beginner',
      weeklyBaseMi: 12,
      vdotAtStart: 38,
      ageYears: 32,
    },
    initialCalibration: {
      vdotPerQuality: 0.15,
      longRunWeight: 0.10,
      recoveryMult: 0.85,
      plateauVdot: 50,
    },
    race: {
      slug: 'persona-beginner-5k',
      distanceMi: 3.1,
      goalSec: 1500,  // 25:00 5K
      weeksOut: 10,
    },
    expectedPlan: {
      peakWeeklyMileageBand: [16, 22],
      qualityPerWeek: 1,
      longRunShare: 0.28,
      taperDepth: 'shallow',
    },
    healthPattern: 'baseline',
  },

  // 2. Advanced HM · David's actual profile + goal (sub-1:30)
  // Per Research/22 "HM Advanced" tier · 45+ mpw base · 55-85 peak ·
  // 15-17 mi peak long · longShare 0.25. The persona is named "david-
  // sub-1-30-hm" so it's unambiguous.
  {
    name: 'david-sub-1-30-hm',
    profile: {
      experienceLevel: 'advanced',
      weeklyBaseMi: 35,
      vdotAtStart: 48,
      ageYears: 35,
    },
    initialCalibration: {
      vdotPerQuality: 0.10,
      longRunWeight: 0.30,
      recoveryMult: 1.0,
      plateauVdot: 65,
    },
    race: {
      slug: 'persona-david-sub-1-30-hm',
      distanceMi: 13.1,
      goalSec: 5400,  // 1:30:00 HM
      weeksOut: 12,
    },
    expectedPlan: {
      // Tier band from Research/22 (HM Advanced). The runner's base
      // (35 mpw) is below the typical tier-base (45+), so the
      // generator ramps from 35 toward the LOWER band (55) over 12
      // weeks. ±10% tolerance in the bench.
      peakWeeklyMileageBand: [50, 70],
      qualityPerWeek: 2,
      longRunShare: 0.25,
      taperDepth: 'medium',
    },
    healthPattern: 'baseline',
  },

  // 2b. Intermediate HM · sub-2:00 goal
  // Per Research/22 "HM Intermediate" tier · 25-35 mpw base · 35-45
  // peak · 12-14 mi peak long · longShare 0.30.
  {
    name: 'intermediate-hm-sub-2',
    profile: {
      experienceLevel: 'intermediate',
      weeklyBaseMi: 28,
      vdotAtStart: 42,
      ageYears: 38,
    },
    initialCalibration: {
      vdotPerQuality: 0.10,
      longRunWeight: 0.30,
      recoveryMult: 1.0,
      plateauVdot: 55,
    },
    race: {
      slug: 'persona-intermediate-hm-sub-2',
      distanceMi: 13.1,
      goalSec: 7080,  // 1:58:00 HM
      weeksOut: 12,
    },
    expectedPlan: {
      peakWeeklyMileageBand: [32, 45],
      qualityPerWeek: 2,
      longRunShare: 0.30,
      taperDepth: 'medium',
    },
    healthPattern: 'baseline',
  },

  // 3. Advanced marathon · sub-3 attempt
  // Per Research/22 "Marathon Advanced" tier · 55-75 peak · 20-22 peak long.
  {
    name: 'advanced-marathon',
    profile: {
      experienceLevel: 'advanced',
      weeklyBaseMi: 60,
      vdotAtStart: 58,
      ageYears: 38,
    },
    initialCalibration: {
      vdotPerQuality: 0.08,
      longRunWeight: 0.60,
      recoveryMult: 1.1,
      plateauVdot: 75,
    },
    race: {
      slug: 'persona-advanced-marathon',
      distanceMi: 26.2,
      goalSec: 10800,  // 3:00:00 marathon
      weeksOut: 16,
    },
    expectedPlan: {
      peakWeeklyMileageBand: [55, 75],
      qualityPerWeek: 2,
      longRunShare: 0.30,
      taperDepth: 'deep',
    },
    healthPattern: 'baseline',
  },

  // 4. Advanced+ ultra · 50K goal
  {
    name: 'advanced-plus-ultra',
    profile: {
      experienceLevel: 'advanced_plus',
      weeklyBaseMi: 85,
      vdotAtStart: 62,
      ageYears: 42,
    },
    initialCalibration: {
      vdotPerQuality: 0.05,
      longRunWeight: 0.70,
      recoveryMult: 1.15,
      plateauVdot: 80,
    },
    race: {
      slug: 'persona-ultra-50k',
      distanceMi: 31.0,
      goalSec: 16200,  // 4:30:00 50K
      weeksOut: 20,
    },
    expectedPlan: {
      // Ultra · keep above marathon-advanced band (uses M tier for now ·
      // explicit ultra tier is a Phase-4 follow-up).
      peakWeeklyMileageBand: [65, 100],
      qualityPerWeek: 2,
      longRunShare: 0.32,
      taperDepth: 'deep',
    },
    healthPattern: 'baseline',
  },

  // 5. Returning from injury · 1:45 HM goal · conservative ramp
  // Goal pace 8:00/mi → intermediate HM tier (peak 35-45, long 12-14).
  // Base 20mpw is well under tier base · 14 weeks lets the ramp catch
  // up at 10%/week. Bench tolerance: ±10% on the lower band.
  {
    name: 'returning-from-injury',
    profile: {
      experienceLevel: 'intermediate',
      weeklyBaseMi: 20,
      vdotAtStart: 45,
      ageYears: 36,
    },
    initialCalibration: {
      vdotPerQuality: 0.08,
      longRunWeight: 0.20,
      recoveryMult: 0.7,    // recovering · slower bounce-back
      plateauVdot: 55,
    },
    race: {
      slug: 'persona-injury-hm',
      distanceMi: 13.1,
      goalSec: 6300,  // 1:45:00 conservative HM
      weeksOut: 14,
    },
    expectedPlan: {
      // Goal 1:45 = 8:00/mi → HM intermediate tier (35-45 mpw peak).
      // Bench: lower band ±10% so the ramp from 20mpw is realistic
      // within 14 weeks · accepts that the runner won't fully reach
      // 35 from base of 20.
      peakWeeklyMileageBand: [28, 45],
      qualityPerWeek: 2,
      longRunShare: 0.30,
      taperDepth: 'medium',
    },
    healthPattern: 'returning-from-injury',
  },

  // 6. Sleep-debt-prone · chronic 6.5h sleep, RHR sensitive · 1:40 HM
  // Goal 1:40 = 7:38/mi → intermediate HM tier (35-45 peak, 12-14 long).
  {
    name: 'sleep-debt-prone',
    profile: {
      experienceLevel: 'intermediate',
      weeklyBaseMi: 30,
      vdotAtStart: 46,
      ageYears: 41,
    },
    initialCalibration: {
      vdotPerQuality: 0.08,
      longRunWeight: 0.30,
      recoveryMult: 0.75,   // sleep debt cuts recovery 25%
      plateauVdot: 60,
    },
    race: {
      slug: 'persona-sleep-debt-hm',
      distanceMi: 13.1,
      goalSec: 6000,  // 1:40:00 HM
      weeksOut: 12,
    },
    expectedPlan: {
      peakWeeklyMileageBand: [33, 45],
      qualityPerWeek: 2,
      longRunShare: 0.30,
      taperDepth: 'medium',
    },
    healthPattern: 'sleep-debt',
  },
];

/** Look up a persona by name. */
export function persona(name: string): SyntheticRunner | undefined {
  return PERSONAS.find((p) => p.name === name);
}
