/**
 * Doctrine — Race week protocol (taper + nutrition + sleep + warmup +
 * caffeine + race kit + travel).
 *
 * Source: Research/08-pacing-and-race-week.md §§9-17
 *
 * Engine consumers:
 *   - coach.taperDepth         → TAPER_DURATION_BY_DISTANCE
 *   - coach.briefRaceMorning   → RACE_MORNING_TIMING + WARMUP_BY_DISTANCE
 *   - coach.fuelingFor         → CARB_LOAD_BY_DISTANCE + RACE_DAY_FUELING
 *   - /races/[slug] page       → race-week template display
 *
 * Note: Existing taper.ts has overlapping content; that file's values
 * are subsumed here as Research/08 is the canonical source. taper.ts
 * stays for backward compat until callers migrate. */
import { cite, type Cited } from '.';

// ── Taper ─────────────────────────────────────────────────────────

export type RaceDistanceTaper = '5K' | '10K' | 'half' | 'marathon' | 'ultra';

/** Taper duration + volume reduction by race distance. */
export const TAPER_BY_DISTANCE: Cited<Record<RaceDistanceTaper, {
  taperDaysLow: number;
  taperDaysHigh: number;
  volumeReductionPctLow: number;
  volumeReductionPctHigh: number;
}>> = {
  value: {
    '5K':       { taperDaysLow: 5,  taperDaysHigh: 7,   volumeReductionPctLow: 25, volumeReductionPctHigh: 35 },
    '10K':      { taperDaysLow: 7,  taperDaysHigh: 10,  volumeReductionPctLow: 30, volumeReductionPctHigh: 40 },
    half:       { taperDaysLow: 10, taperDaysHigh: 14,  volumeReductionPctLow: 30, volumeReductionPctHigh: 50 },
    marathon:   { taperDaysLow: 14, taperDaysHigh: 21,  volumeReductionPctLow: 40, volumeReductionPctHigh: 60 },
    ultra:      { taperDaysLow: 14, taperDaysHigh: 28,  volumeReductionPctLow: 50, volumeReductionPctHigh: 70 },
  },
  note: 'Largest cut is to easy mileage; intensity is preserved through the taper. Run frequency stays at ~80% of normal — don\'t suddenly add rest days. Add no novel workout types in final 10 days (creates fatigue without adaptation).',
  citations: [
    cite('§9.1 Taper duration by distance', '5K 5-7d / 10K 7-10d / Half 10-14d / Marathon 14-21d / Ultra 14-28d. Volume reduction 25-70%.', 'research', '08'),
  ],
};

/** Marathon 3-week taper structure. */
export const MARATHON_TAPER_STRUCTURE: Cited<Array<{
  weekOut: number;
  volumePctOfPeakLow: number;
  volumePctOfPeakHigh: number;
  qualitySession: string;
  longRun: string;
}>> = {
  value: [
    { weekOut: 3, volumePctOfPeakLow: 80, volumePctOfPeakHigh: 90, qualitySession: 'Final MP-specific (14-16 mi w/ 10-12 mi at MP)', longRun: 'Last long (20-22 mi)' },
    { weekOut: 2, volumePctOfPeakLow: 60, volumePctOfPeakHigh: 70, qualitySession: '6-8 mi at MP, or 4-5 mi threshold',                  longRun: '12-14 mi w/ MP miles late' },
    { weekOut: 1, volumePctOfPeakLow: 40, volumePctOfPeakHigh: 50, qualitySession: '3-4 mi w/ 4-6 × 1 min at 5K pace, 4-5 days out',     longRun: '"Freshener" 8-10 mi' },
  ],
  citations: [
    cite('§9.2 Marathon taper structure (3 weeks)', 'Week / volume / quality / long run', 'research', '08'),
  ],
};

/** Day-by-day race-week templates by distance (Sunday race for
 *  marathon/half; Saturday race for 10K/5K). */
export const RACE_WEEK_TEMPLATES: Cited<Record<'marathon_sunday' | 'half_sunday' | '10K_saturday' | '5K_saturday', Array<{
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  workout: string;
  durationMinLow: number;
  durationMinHigh: number;
}>>> = {
  value: {
    marathon_sunday: [
      { day: 'Mon', workout: 'Easy run',                                                          durationMinLow: 35, durationMinHigh: 50 },
      { day: 'Tue', workout: 'Race-prep workout (3 mi w/ 5 × 1 min @ 5K pace, full recovery)',     durationMinLow: 35, durationMinHigh: 45 },
      { day: 'Wed', workout: 'Easy + 4-6 strides',                                                 durationMinLow: 30, durationMinHigh: 40 },
      { day: 'Thu', workout: 'Rest or short easy shakeout',                                        durationMinLow: 0,  durationMinHigh: 30 },
      { day: 'Fri', workout: 'Easy run + 4 strides',                                               durationMinLow: 25, durationMinHigh: 35 },
      { day: 'Sat', workout: 'Shakeout: 15-20 min easy + 2-4 strides',                            durationMinLow: 15, durationMinHigh: 25 },
      { day: 'Sun', workout: 'RACE',                                                                durationMinLow: 0,  durationMinHigh: 0  },
    ],
    half_sunday: [
      { day: 'Mon', workout: 'Easy run',                                                          durationMinLow: 40, durationMinHigh: 50 },
      { day: 'Tue', workout: '4-5 mi w/ 4 × 1K at HMP, 90s recovery',                             durationMinLow: 50, durationMinHigh: 60 },
      { day: 'Wed', workout: 'Easy',                                                               durationMinLow: 35, durationMinHigh: 45 },
      { day: 'Thu', workout: 'Easy + 6 strides',                                                   durationMinLow: 30, durationMinHigh: 40 },
      { day: 'Fri', workout: 'Rest or 25 min easy',                                                durationMinLow: 0,  durationMinHigh: 25 },
      { day: 'Sat', workout: 'Shakeout: 20 min easy + 3 strides',                                  durationMinLow: 20, durationMinHigh: 25 },
      { day: 'Sun', workout: 'RACE',                                                                durationMinLow: 0,  durationMinHigh: 0  },
    ],
    '10K_saturday': [
      { day: 'Mon', workout: 'Easy + strides',                                                     durationMinLow: 40, durationMinHigh: 50 },
      { day: 'Tue', workout: '4 mi w/ 5 × 400m at 5K pace, 1 min recovery',                       durationMinLow: 50, durationMinHigh: 55 },
      { day: 'Wed', workout: 'Easy',                                                                durationMinLow: 35, durationMinHigh: 45 },
      { day: 'Thu', workout: 'Easy + 4-6 strides',                                                  durationMinLow: 30, durationMinHigh: 40 },
      { day: 'Fri', workout: 'Shakeout: 20 min easy + 3 strides + 2 × 100m at 5K pace',            durationMinLow: 25, durationMinHigh: 30 },
      { day: 'Sat', workout: 'RACE',                                                                durationMinLow: 0,  durationMinHigh: 0  },
      { day: 'Sun', workout: '(after race) — rest or recovery jog',                                durationMinLow: 0,  durationMinHigh: 30 },
    ],
    '5K_saturday': [
      { day: 'Mon', workout: 'Easy + 6 strides',                                                   durationMinLow: 35, durationMinHigh: 45 },
      { day: 'Tue', workout: '3 mi w/ 4-6 × 200m at 3K-mile pace, full recovery',                  durationMinLow: 35, durationMinHigh: 45 },
      { day: 'Wed', workout: 'Easy',                                                                durationMinLow: 30, durationMinHigh: 40 },
      { day: 'Thu', workout: 'Easy + 4 strides',                                                    durationMinLow: 25, durationMinHigh: 35 },
      { day: 'Fri', workout: '15-20 min easy + 3 strides + 1 × 200m at race pace',                 durationMinLow: 20, durationMinHigh: 25 },
      { day: 'Sat', workout: 'RACE',                                                                durationMinLow: 0,  durationMinHigh: 0  },
      { day: 'Sun', workout: '(after race) — rest or recovery jog',                                durationMinLow: 0,  durationMinHigh: 30 },
    ],
  },
  note: '"Taper crud" / "taper madness" — fatigue, sluggish legs, irritability, sleeplessness, phantom pains — is normal. Resist the urge to test fitness. The work is done.',
  citations: [
    cite('§9.3 Day-by-day race week templates', 'Marathon / half (Sunday race) + 10K / 5K (Saturday race) day-by-day templates', 'research', '08'),
  ],
};

// ── Race week nutrition ────────────────────────────────────────────

/** Carb loading protocol by race distance. */
export const CARB_LOAD_BY_DISTANCE: Cited<Record<RaceDistanceTaper, {
  protocol: string;
  gramsPerKgPerDayLow: number;
  gramsPerKgPerDayHigh: number;
  durationHrLow: number;
  durationHrHigh: number;
}>> = {
  value: {
    '5K':       { protocol: 'Normal training carbs',          gramsPerKgPerDayLow: 5,  gramsPerKgPerDayHigh: 7,  durationHrLow: 0,  durationHrHigh: 0  },
    '10K':      { protocol: 'Normal training carbs',          gramsPerKgPerDayLow: 5,  gramsPerKgPerDayHigh: 7,  durationHrLow: 0,  durationHrHigh: 0  },
    half:       { protocol: 'Mild load',                      gramsPerKgPerDayLow: 7,  gramsPerKgPerDayHigh: 8,  durationHrLow: 24, durationHrHigh: 36 },
    marathon:   { protocol: 'Full glycogen supercompensation', gramsPerKgPerDayLow: 8,  gramsPerKgPerDayHigh: 12, durationHrLow: 36, durationHrHigh: 48 },
    ultra:      { protocol: 'Extended load',                  gramsPerKgPerDayLow: 8,  gramsPerKgPerDayHigh: 12, durationHrLow: 48, durationHrHigh: 72 },
  },
  note: 'Glycogen supercompensation matters for races >90 min. Below that, normal training nutrition suffices. Marathon example (70 kg, 3-day load): T-3: 7-8 g/kg = 490-560 g; T-2: 9-10 g/kg = 630-700 g; T-1: 9-10 g/kg = 630-700 g. Errors: all-you-can-eat pasta dinner before (carbs store slowly, GI distress); high-fiber the day before; novel foods.',
  citations: [
    cite('§10.1 Carb loading — by distance', '5K/10K normal 5-7 g/kg; HM 7-8 g/kg × 24-36h; Marathon 8-12 g/kg × 36-48h; Ultra 8-12 g/kg × 48-72h.', 'research', '08'),
  ],
};

/** Pre-race meal composition + timing windows. */
export const PRE_RACE_MEAL_PROTOCOL: Cited<{
  composition: { carbsGPerKgLow: number; carbsGPerKgHigh: number; fiberGMax: number; proteinGMax: number; fatGMax: number; familiarFoodsOnly: boolean };
  timingWindows: Array<{ hoursBeforeRace: number; carbsGPerKgLow: number; carbsGPerKgHigh: number; example: string }>;
  templates: string[];
}> = {
  value: {
    composition: {
      carbsGPerKgLow: 1, carbsGPerKgHigh: 4,
      fiberGMax: 10, proteinGMax: 15, fatGMax: 10,
      familiarFoodsOnly: true,
    },
    timingWindows: [
      { hoursBeforeRace: 4,    carbsGPerKgLow: 3,   carbsGPerKgHigh: 4,   example: 'Bagel + peanut butter + banana + 16 oz sports drink' },
      { hoursBeforeRace: 3,    carbsGPerKgLow: 2,   carbsGPerKgHigh: 3,   example: 'Oatmeal + banana + honey + coffee' },
      { hoursBeforeRace: 2,    carbsGPerKgLow: 1,   carbsGPerKgHigh: 2,   example: 'English muffin + jam + small banana' },
      { hoursBeforeRace: 1,    carbsGPerKgLow: 0.5, carbsGPerKgHigh: 1,   example: 'Banana + half bagel or 1 gel + sports drink' },
      { hoursBeforeRace: 0.25, carbsGPerKgLow: 0.3, carbsGPerKgHigh: 0.4, example: 'One gel (25-30 g) — topping off' },
    ],
    templates: [
      'Bagel + PB + jam + banana + coffee (3 h out)',
      'Oatmeal + banana + honey (3 h out)',
      'White toast + jam + applesauce (3 h out)',
    ],
  },
  note: 'Test the meal in training before 2-3 long runs at GP. Large breakfasts: 4 h out. Small stomachs: 2-3 h. Coffee on race morning only if a regular coffee drinker.',
  citations: [
    cite('§10.3 Pre-race meal', 'Composition: 1-4 g/kg carb, <10 g fiber, <15 g protein, <10 g fat, familiar foods. Timing windows 1h-4h pre-race.', 'research', '08'),
  ],
};

/** Race-week fiber reduction. */
export const RACE_WEEK_FIBER_RULES: Cited<{
  finalDaysFiberMaxG: number;
  goalDescription: string;
  foodsToAvoid: string[];
}> = {
  value: {
    finalDaysFiberMaxG: 10,
    goalDescription: 'Empty the colon before the race. Final 24-48h.',
    foodsToAvoid: [
      'Salad, leafy greens, raw vegetables',
      'Beans, lentils, chickpeas',
      'Whole grains (oats borderline; many tolerate)',
      'Cruciferous vegetables (broccoli, cauliflower, cabbage)',
      'Nuts, seeds, dried fruit',
      'High-fat foods',
      'Dairy if lactose-sensitive',
    ],
  },
  citations: [
    cite('§10.2 Fiber reduction (T-1 to T-0)', 'Final 24-48h, drop fiber to <10 g/day. Avoid: salad, raw veg, beans, whole grains, cruciferous, nuts, seeds, dried fruit, high-fat, lactose-sensitive dairy.', 'research', '08'),
  ],
};

/** Hydration in the final 48 hours. */
export const RACE_WEEK_HYDRATION: Cited<Array<{
  timing: 'T-2_days' | 'T-1_day' | 'race_morning' | 'final_30_min';
  fluid: string;
  notes?: string;
}>> = {
  value: [
    { timing: 'T-2_days',     fluid: 'Normal + extra 500-1000 ml; salt food liberally' },
    { timing: 'T-1_day',      fluid: '30-40 ml/kg fluid (sports drink or electrolyte)' },
    { timing: 'race_morning', fluid: '400-500 ml water/electrolyte 2-3 h before; sip 150-250 ml in final 60 min' },
    { timing: 'final_30_min', fluid: 'Sip only',                                          notes: 'Avoid chugging 1 L of water race morning ("preloading"). Causes mid-race urination and dilutes sodium.' },
  ],
  note: 'Goals: arrive normally hydrated (not over-hydrated); sodium 3-5 g/day (above normal); urine pale yellow on race morning, not clear.',
  citations: [
    cite('§10.4 Hydration in the final 48 hours', 'T-2 days normal + extra; T-1 day 30-40 ml/kg; race morning 400-500 ml 2-3h before, sip 150-250 ml final 60min; final 30 min sip only.', 'research', '08'),
  ],
};

/** Race-day in-race fueling targets by distance. */
export const RACE_DAY_FUELING: Cited<{
  carbsPerHourByDistance: Record<RaceDistanceTaper, { carbsGPerHrLow: number; carbsGPerHrHigh: number }>;
  glucoseFructoseRatio: Array<{ carbsGPerHrLow: number; carbsGPerHrHigh: number; ratio: '2:1_acceptable' | '2:1_ideal' | '1:0.8_required'; notes: string }>;
  sodiumMgPerHrByCondition: { coolLow: number; coolHigh: number; hotLow: number; hotHigh: number; saltySweatersMax: number };
  fluidMlPerHrByCondition: { coolLow: number; coolHigh: number; warmLow: number; warmHigh: number };
}> = {
  value: {
    carbsPerHourByDistance: {
      '5K':       { carbsGPerHrLow: 0,  carbsGPerHrHigh: 0 },
      '10K':      { carbsGPerHrLow: 0,  carbsGPerHrHigh: 0 },
      half:       { carbsGPerHrLow: 30, carbsGPerHrHigh: 60 },
      marathon:   { carbsGPerHrLow: 60, carbsGPerHrHigh: 90 },
      ultra:      { carbsGPerHrLow: 90, carbsGPerHrHigh: 120 },
    },
    glucoseFructoseRatio: [
      { carbsGPerHrLow: 0,  carbsGPerHrHigh: 60,  ratio: '2:1_acceptable', notes: 'Most single-source gels are fine' },
      { carbsGPerHrLow: 60, carbsGPerHrHigh: 90,  ratio: '2:1_ideal',      notes: '1:0.8 acceptable' },
      { carbsGPerHrLow: 90, carbsGPerHrHigh: 120, ratio: '1:0.8_required', notes: 'Glucose alone hits absorption ceiling around 60 g/h' },
    ],
    sodiumMgPerHrByCondition: { coolLow: 300, coolHigh: 500, hotLow: 500, hotHigh: 800, saltySweatersMax: 1000 },
    fluidMlPerHrByCondition: { coolLow: 400, coolHigh: 500, warmLow: 500, warmHigh: 800 },
  },
  note: 'Drink to thirst, not ahead of thirst. Hyponatremia from over-hydration is more dangerous than mild dehydration.',
  citations: [
    cite('§10.5 Race-day fueling plan', 'Carbs/h by distance: 5K/10K none; HM 30-60; Marathon 60-90; Ultra 90-120. Glucose:fructose 2:1 ideal at 60-90, 1:0.8 required >90. Sodium 300-1000 mg/h.', 'research', '08'),
  ],
};

/** Marathon fueling template (sub-3 to 4-hour runner, 70 kg). */
export const MARATHON_FUELING_TEMPLATE: Cited<Array<{
  timing: string;
  fuel: string;
}>> = {
  value: [
    { timing: '15 min pre',       fuel: '1 gel (25 g) + sip water' },
    { timing: 'Mile 4-5',         fuel: '1 gel (25 g) + 2-3 sips water/electrolyte' },
    { timing: 'Mile 8-9',         fuel: '1 gel (25 g) + electrolyte at aid station' },
    { timing: 'Mile 12-13',       fuel: '1 gel (25 g) + 100 mg caffeine' },
    { timing: 'Mile 16-17',       fuel: '1 gel (25 g) + electrolyte' },
    { timing: 'Mile 20-21',       fuel: '1 gel (25 g) + 100 mg caffeine' },
    { timing: 'Mile 23-24',       fuel: 'Optional gel or sports drink' },
  ],
  note: 'Total: ~150 g carbs in race + ~25 g pre-race = 175 g; ~70-80 g/h depending on finish time.',
  citations: [
    cite('§10.5 Race-day fueling plan › Marathon fueling template', 'Sub-3 to 4-hour runner, 70 kg. 7 fueling cues across the race.', 'research', '08'),
  ],
};

// ── Sleep + race morning ──────────────────────────────────────────

export const SLEEP_PRIORITY: Cited<{
  mostImportantNight: 'T-2';
  bankingProtocol: { addMinutesPerNight: { low: number; high: number }; nights: { low: number; high: number } };
  napsMinutes: { low: number; high: number };
  tMinus1Reality: string;
}> = {
  value: {
    mostImportantNight: 'T-2',
    bankingProtocol: { addMinutesPerNight: { low: 60, high: 90 }, nights: { low: 5, high: 7 } },
    napsMinutes: { low: 20, high: 90 },
    tMinus1Reality: 'Accept poor sleep is likely (lying still delivers ~50% of sleep\'s recovery value); no alcohol or screens after dinner; lay out kit before bed; set two alarms.',
  },
  note: 'T-2 has the largest impact on race-day performance. T-1 disruption common but minimal physiological effect (HR, VO2, leg strength preserved). RPE rises with poor sleep but pace can be held.',
  citations: [
    cite('§11.1 Sleep priority: T-2 night matters most', 'Sleep banking T-7 to T-2: add 60-90 min/night for 5-7 nights. Naps 20-90 min substitute partial night sleep. T-1 protocol.', 'research', '08'),
  ],
};

export const RACE_MORNING_TIMING: Cited<Array<{
  hoursBeforeGun: number;
  action: string;
}>> = {
  value: [
    { hoursBeforeGun: 4.0,   action: 'Wake up' },
    { hoursBeforeGun: 3.25,  action: 'Pre-race meal' },
    { hoursBeforeGun: 2.0,   action: 'Begin sipping water/electrolyte' },
    { hoursBeforeGun: 1.5,   action: 'Depart for venue (allow buffer for traffic, security, gear check)' },
    { hoursBeforeGun: 1.0,   action: 'Arrive at venue, gear check, first bathroom visit' },
    { hoursBeforeGun: 0.85,  action: 'First gel + small sip if 4 h since meal' },
    { hoursBeforeGun: 0.5,   action: 'Begin warmup (longer for shorter races; see WARMUP_BY_DISTANCE)' },
    { hoursBeforeGun: 0.25,  action: 'Final bathroom, final gel if marathon' },
    { hoursBeforeGun: 0.083, action: 'Corral / start position' },
    { hoursBeforeGun: 0,     action: 'Gun' },
  ],
  note: 'Early-start races (7:00 AM gun) often force a 4:00 AM wake. Alternative: wake 4:30, smaller breakfast (~1.5 g/kg) at 5:00, gel top-up at 6:30.',
  citations: [
    cite('§11.2 Race morning timing', 'Working backward from gun time: T-4h wake, T-3.25h pre-race meal, T-2h hydration begin, T-30 min warmup begin, etc.', 'research', '08'),
  ],
};

// ── Warmup ────────────────────────────────────────────────────────

export const WARMUP_BY_DISTANCE: Cited<Record<'5K' | '10K' | 'half' | 'marathon', {
  totalTimeMinLow: number;
  totalTimeMinHigh: number;
  protocol: string;
}>> = {
  value: {
    '5K':       { totalTimeMinLow: 15, totalTimeMinHigh: 25, protocol: '2-3 mi easy + dynamic drills + 4-6 strides ending with 1 at 3K-mile pace (research-backed primer: ~6 sec faster 5K)' },
    '10K':      { totalTimeMinLow: 15, totalTimeMinHigh: 20, protocol: '1.5-2.5 mi easy + drills + 4-6 strides, last 1-2 at 10K pace' },
    half:       { totalTimeMinLow: 10, totalTimeMinHigh: 15, protocol: '0.5-1.5 mi easy + drills + 3-4 strides at HMP (or walk 5 min + 4 strides if no space)' },
    marathon:   { totalTimeMinLow: 5,  totalTimeMinHigh: 10, protocol: 'Walk 5-10 min or jog 3-5 min + 2-3 strides; first 3 km of race is the warmup' },
  },
  note: 'The shorter the race, the longer the warmup. Marathon runs at 80-88% VO2max; a few easy miles in cost no race fatigue. 5K runs at 95-100% from gun; without priming, the first km wastes time hitting steady state. Glycogen conservation > muscle priming as race lengthens. Cold-weather (<40°F): add 5 min. Hot weather (>70°F or high dew point): shorten 30-50% and emphasize cooling.',
  citations: [
    cite('§12 Warmup Protocols', 'Warmup by distance + cold/hot adjustments. Inverse relationship: shorter race = longer warmup.', 'research', '08'),
  ],
};

// ── Caffeine ──────────────────────────────────────────────────────

export const CAFFEINE_PROTOCOL: Cited<{
  doseMgPerKgLow: number;
  doseMgPerKgHigh: number;
  preRaceTimingMinLow: number;
  preRaceTimingMinHigh: number;
  midRaceRedoseMgPerKgLow: number;
  midRaceRedoseMgPerKgHigh: number;
  redoseFrequencyMinLow: number;
  redoseFrequencyMinHigh: number;
  halfLifeHrLow: number;
  halfLifeHrHigh: number;
  templates: Record<RaceDistanceTaper, string>;
}> = {
  value: {
    doseMgPerKgLow: 3,
    doseMgPerKgHigh: 6,
    preRaceTimingMinLow: 45,
    preRaceTimingMinHigh: 60,
    midRaceRedoseMgPerKgLow: 1,
    midRaceRedoseMgPerKgHigh: 2,
    redoseFrequencyMinLow: 60,
    redoseFrequencyMinHigh: 90,
    halfLifeHrLow: 4,
    halfLifeHrHigh: 5,
    templates: {
      '5K':       'Single pre-race dose 3-6 mg/kg, 45-60 min before gun.',
      '10K':      'Single pre-race dose 3-6 mg/kg, 45-60 min before gun.',
      half:       'Single pre-race dose 45-60 min before gun; optional 50-100 mg gel at mile 8.',
      marathon:   '3 mg/kg pre-race + 100 mg gel at mile 13 + 100 mg gel at mile 20.',
      ultra:      'Lower per-dose (1-2 mg/kg) but more frequent (every 90-120 min) to manage habituation.',
    },
  },
  note: 'For a 70 kg runner: 210-420 mg pre-race. 8 oz coffee ≈ 95-150 mg; 1 espresso ≈ 65-75 mg; one Maurten 100 caf gel = 100 mg. Cautions: caffeine-naive runners do not start during race (test 4-6 weeks out); caffeine increases gut motility; caffeine before evening races impairs post-race sleep.',
  citations: [
    cite('§13 Caffeine Timing and Dose', 'Dose 3-6 mg/kg, 45-60 min pre-race. Mid-race redose 1-2 mg/kg every 60-90 min for races >2h. Half-life 4-5 h.', 'research', '08'),
  ],
};

// ── Pre-committed pacing rules ────────────────────────────────────

export const PACE_PLAN_COMPONENTS: Cited<string[]> = {
  value: [
    'Goal time and goal pace (min:sec/mile and /km)',
    'First-mile target (5-15 sec slower than GP)',
    'Halfway split target with band',
    'Late-race rules (e.g., "no push before mile 20")',
    'Fueling schedule (gels, caffeine)',
    'Walk-through-aid rule if used',
    'Bail-out plan (hold form, fuel, restart at adjusted pace)',
  ],
  note: 'A pre-race written plan cuts in-race decision fatigue.',
  citations: [
    cite('§14.1 Writing it down', '7-component pre-race written plan', 'research', '08'),
  ],
};

export const WATCH_FIELD_SETUP: Cited<Array<{
  field: string;
  why: string;
}>> = {
  value: [
    { field: 'Current lap pace (most recent km or mile)', why: 'Best-of-class pacing feedback; avoid instant pace which is noisy' },
    { field: 'Total time',                                why: 'Anchors against goal time' },
    { field: 'Distance',                                  why: 'Anchors against course' },
    { field: 'Heart rate',                                why: 'Backstop against over-effort' },
  ],
  note: 'A pace band or wrist tattoo with mile-by-mile splits is a useful backup if the watch fails or auto-laps drift from course markers.',
  citations: [
    cite('§14.2 Watch field setup', '4 optimal display fields for most runners', 'research', '08'),
  ],
};

// ── Mental preparation ────────────────────────────────────────────

export const SELF_TALK_PHRASES: Cited<Array<{
  phase: string;
  selfTalk: string;
}>> = {
  value: [
    { phase: 'Start',                       selfTalk: '"You\'re prepared. Stick to the plan."' },
    { phase: 'Body of race',                selfTalk: '"Smooth and strong."' },
    { phase: 'First sign of fatigue',       selfTalk: '"This is normal. Keep moving."' },
    { phase: 'Mid-race doubt',              selfTalk: '"One mile at a time."' },
    { phase: 'Wall / dark patch',           selfTalk: '"You\'ve trained for this. Drive the elbows."' },
    { phase: 'Final 2K',                    selfTalk: '"Empty the tank."' },
  ],
  note: 'Research supports second-person self-talk over first-person ("you\'ve got this" outperforms "I\'ve got this"). Pre-race anxiety is normal and useful (sympathetic activation primes performance). Manage excess via box breathing (4-4-4-4) for 2-3 min pre-gun.',
  citations: [
    cite('§15.2 Self-talk', '6-phrase library by race phase, second-person', 'research', '08'),
  ],
};

// ── Travel / time zone ────────────────────────────────────────────

export const TRAVEL_ARRIVAL_TIMING: Cited<Array<{
  raceLocation: string;
  recommendedArrival: string;
}>> = {
  value: [
    { raceLocation: 'Same city / drive',          recommendedArrival: 'T-1 day or T-0 morning' },
    { raceLocation: 'Same time zone, flight',     recommendedArrival: 'T-1 day minimum, T-2 preferred' },
    { raceLocation: '1-3 time zones',             recommendedArrival: 'T-2 to T-3 days' },
    { raceLocation: '4-6 time zones',             recommendedArrival: 'T-5 to T-7 days; or arrive T-1 to "punch through" jet lag (single-night strategy)' },
    { raceLocation: '7+ time zones',              recommendedArrival: 'T-7 to T-10 days' },
  ],
  note: 'Eastward travel is harder than westward. Eastward: advance bedtime 30-60 min/day for 3-5 days pre-flight. Westward: delay bedtime 30-60 min/day. Rule of thumb: 1 day per time zone for full circadian adjustment.',
  citations: [
    cite('§16 Travel and Time Zone Management', 'Arrival timing by location distance + eastward vs westward asymmetry', 'research', '08'),
  ],
};

// ── Race kit ──────────────────────────────────────────────────────

export const RACE_KIT_BY_WEATHER: Cited<Array<{
  conditions: string;
  top: string;
  bottom: string;
  accessories: string;
}>> = {
  value: [
    { conditions: '35-45°F, dry, light wind', top: 'Long sleeve or arm warmers + singlet',  bottom: 'Shorts or capris',                accessories: 'Gloves, hat (discardable)' },
    { conditions: '45-55°F (optimal)',         top: 'Singlet',                                bottom: 'Shorts',                          accessories: 'Optional arm warmers (discardable)' },
    { conditions: '55-65°F',                   top: 'Singlet',                                bottom: 'Shorts',                          accessories: 'None' },
    { conditions: '65-75°F',                   top: 'Singlet',                                bottom: 'Shorts',                          accessories: 'Hat for sun, sunglasses' },
    { conditions: '75°F+',                     top: 'Singlet (light color)',                  bottom: 'Shortest tested shorts',          accessories: 'White hat, sunglasses; ice strategy' },
    { conditions: 'Cold + rain',               top: 'Lightweight long-sleeve + singlet',     bottom: 'Shorts (legs warm up faster)',    accessories: 'Hat, gloves; trash bag at start (discard before gun)' },
    { conditions: 'Heavy rain',                top: 'As above + body glide on chafe points', bottom: 'Shorts',                           accessories: 'Hat with brim' },
    { conditions: 'Snow / ice',                top: 'Long-sleeve base + lightweight wind',    bottom: 'Tights',                          accessories: 'Gloves, hat, screw-traction shoes if icy' },
  ],
  note: 'Race shoe must have ≥40 miles of training use, ideally with at least one MP long run. For marathon, race shoe should have ≤200-250 miles to preserve foam responsiveness. Backup shoe ready at gear check. Socks tested, mid-thickness, wool or synthetic blend — never cotton.',
  citations: [
    cite('§17.2-17.3 Kit selection by weather + Shoe selection', '8 weather conditions → kit. Shoe ≥40 mi training, ≤200-250 mi race. Cotton sock prohibition.', 'research', '08'),
  ],
};

export const RACE_WEEK_ERRORS: Cited<Array<{
  error: string;
  cost: string;
}>> = {
  value: [
    { error: 'Novel workouts in final 10 days',  cost: 'Fatigue without adaptation' },
    { error: 'New food day before',              cost: 'GI distress in race' },
    { error: 'Over-hydrating (1+ L water)',      cost: 'Hyponatremia, mid-race urination' },
    { error: 'New shoes / kit / fuel',           cost: 'Blisters, GI distress, failures' },
    { error: 'Going out 5+ sec/mile too fast',   cost: 'Wall, blow-up' },
    { error: 'Skipping habitual caffeine',       cost: 'Headache, withdrawal' },
    { error: 'Cutting all intensity in taper',   cost: 'Sluggish legs' },
    { error: 'Excessive carb load (>12 g/kg)',   cost: 'GI distress, water weight' },
  ],
  citations: [
    cite('§18.2 Race week errors', '8 common errors + cost', 'research', '08'),
  ],
};
