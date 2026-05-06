/**
 * Doctrine §7 — Marathon nutrition and fueling.
 *
 * Extracted from docs/coaching-research.md §7.1, §7.2, §7.3, §7.4.
 * Carb intake during, before, and around training; hydration; daily
 * training nutrition; what underfueling actually breaks.
 */
import { cite, type Cited } from '.';

/** Carb-intake bands during the race itself. The historical 30–60 g/h
 *  is the floor, not the target. */
export const RACE_CARB_TARGETS_G_PER_HR: Cited<{
  floor: number;
  baselineLow: number;
  baselineHigh: number;
  /** Default we plan around for most marathoners. */
  defaultLow: number;
  defaultHigh: number;
  /** Ultra-trained, gut-trained athletes. */
  stretchTarget: number;
}> = {
  value: {
    floor: 60,
    baselineLow: 60, baselineHigh: 90,
    defaultLow: 80, defaultHigh: 100,
    stretchTarget: 120,
  },
  note: '60 g/h is the floor. 80–100 is the planning target for most marathoners. 120 is a stretch goal that requires gut training in the build phase.',
  citations: [
    cite('§7.1', '60 to 90 g/h remains the baseline recommendation for marathon-distance events using multiple transportable carbohydrates'),
    cite('§7.1', 'Trail and ultra research now supports 120 g/h as superior to 90 g/h'),
    cite('§7.1', 'Planning around 80 to 100 g/h is reasonable for most marathoners'),
  ],
};

/** Glucose-to-fructose ratio depends on hourly intake. */
export const GLUCOSE_FRUCTOSE_RATIO: Cited<{
  /** Up to and including this g/h, use the lower-intake ratio. */
  switchpointGPerHr: number;
  lowerIntake: '2:1';
  higherIntake: '1:0.8';
}> = {
  value: { switchpointGPerHr: 90, lowerIntake: '2:1', higherIntake: '1:0.8' },
  note: 'Below 90 g/h, 2:1 glucose:fructose. Above 90 g/h, 1:0.8 (the Kipchoge-era ratio).',
  citations: [cite('§7.1', 'At 90 g/h or below, 2:1 (glucose:fructose) is ideal. At 90 to 120 g/h, switch to 1:0.8')],
};

/** Carb load before the race. */
export const CARB_LOAD_24_48HR: Cited<{
  gPerKgPerDayLow: number;
  gPerKgPerDayHigh: number;
  /** Glycogen storage uplift vs baseline. */
  glycogenUpliftPctLow: number;
  glycogenUpliftPctHigh: number;
}> = {
  value: { gPerKgPerDayLow: 8, gPerKgPerDayHigh: 10, glycogenUpliftPctLow: 20, glycogenUpliftPctHigh: 40 },
  citations: [cite('§7.2', '8 to 10 g/kg/day in the 24 to 48 hours before the race. … glycogen storage can be increased 20 to 40 percent above baseline')],
};

/** Pre-race meal. */
export const PRE_RACE_MEAL: Cited<{
  gPerKgLow: number;
  gPerKgHigh: number;
  hoursBeforeLow: number;
  hoursBeforeHigh: number;
  rules: ['low_fiber', 'low_fat', 'low_protein', 'familiar_food_only'];
}> = {
  value: {
    gPerKgLow: 1, gPerKgHigh: 4,
    hoursBeforeLow: 1, hoursBeforeHigh: 4,
    rules: ['low_fiber', 'low_fat', 'low_protein', 'familiar_food_only'],
  },
  citations: [cite('§7.2', '1 to 4 g/kg of carbohydrate 1 to 4 hours before the start, low fiber, low fat, low protein. Familiar foods only.')],
};

/** Hydration. "Drink to thirst" replaces the older "drink ahead". */
export const HYDRATION: Cited<{
  mlPerHrLow: number;
  mlPerHrHigh: number;
  sodiumMgPerHrLow: number;
  sodiumMgPerHrHigh: number;
  rule: 'drink_to_thirst';
}> = {
  value: { mlPerHrLow: 400, mlPerHrHigh: 800, sodiumMgPerHrLow: 300, sodiumMgPerHrHigh: 700, rule: 'drink_to_thirst' },
  note: 'Sodium intake of 300–700 mg/h matters more for cramping prevention than fluid volume alone.',
  citations: [
    cite('§7.3', 'Drink to thirst is the consensus replacement for the older "drink ahead of thirst" advice'),
    cite('§7.3', 'Aim for roughly 400 to 800 ml/h depending on conditions. Sodium intake of 300 to 700 mg/h'),
  ],
};

/** Hot-day adjustment — bump carb target. */
export const HEAT_CARB_BUMP: Cited<{
  ifTempFAbove: number;
  bumpGPerHr: number;
}> = {
  // From the existing fueling-claude.ts prompt. Calibrated against
  // "+10 g/hr if >65 °F" advice that's already in the system prompt.
  value: { ifTempFAbove: 65, bumpGPerHr: 10 },
  note: 'Practical adjustment threshold; not directly in the research §7 but consistent with the heat-adaptation cost noted in §11.',
  citations: [cite('§11.1', 'Plasma volume expansion happens within the first week of heat exposure.')],
};

/** Daily training nutrition. */
export const DAILY_TRAINING_NUTRITION: Cited<{
  carbsGPerKgPerDayLow: number;
  carbsGPerKgPerDayHigh: number;
  carbsGPerKgHighVolumeWeek: number;
  proteinGPerKgPerDayLow: number;
  proteinGPerKgPerDayHigh: number;
}> = {
  value: {
    carbsGPerKgPerDayLow: 5, carbsGPerKgPerDayHigh: 8,
    carbsGPerKgHighVolumeWeek: 10,
    proteinGPerKgPerDayLow: 1.6, proteinGPerKgPerDayHigh: 2.0,
  },
  note: 'Underfueling daily training is the most common nutrition mistake — primary contributor to injury, illness, stalled progress, and RED-S.',
  citations: [
    cite('§7.4', '5 to 8 g/kg/day of carbohydrate for general training, up to 10 g/kg/day for high-volume weeks'),
    cite('§7.4', 'Protein 1.6 to 2.0 g/kg/day to support recovery'),
  ],
};
