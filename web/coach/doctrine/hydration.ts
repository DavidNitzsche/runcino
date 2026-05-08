/**
 * Doctrine — Hydration and electrolytes.
 *
 * Source: Research/19-hydration-electrolytes.md
 *
 * Engine consumers:
 *   - coach.fuelingFor (Stage 5)        → SODIUM_INTAKE_BY_SCENARIO
 *                                         + FLUID_DURING_RACE
 *   - coach.briefRaceMorning             → PRE_RACE_HYDRATION
 *                                         + EAH_RISK_FACTORS
 *   - coach-strength sweat-rate intake   → SWEAT_RATE_PROTOCOL */
import { cite, type Cited } from './cite';

// ── Daily baseline ────────────────────────────────────────────────

export const DAILY_HYDRATION_BASELINE: Cited<Array<{
  population: string;
  mlPerKgPerDayLow: number;
  mlPerKgPerDayHigh: number;
  notes: string;
}>> = {
  value: [
    { population: 'Sedentary, temperate',                 mlPerKgPerDayLow: 30, mlPerKgPerDayHigh: 35, notes: 'Total intake (fluids + food)' },
    { population: 'Recreational runner (3-5 h/wk)',       mlPerKgPerDayLow: 35, mlPerKgPerDayHigh: 40, notes: 'Add training-day sweat losses' },
    { population: 'Endurance runner (6-10 h/wk)',         mlPerKgPerDayLow: 40, mlPerKgPerDayHigh: 45, notes: 'Plus sweat replacement' },
    { population: 'High-volume (10+ h/wk)',                mlPerKgPerDayLow: 45, mlPerKgPerDayHigh: 55, notes: 'Plus sweat replacement' },
    { population: 'Hot/humid additive',                    mlPerKgPerDayLow: 5,  mlPerKgPerDayHigh: 10, notes: 'Above baseline' },
    { population: 'Altitude (>2500m) additive',            mlPerKgPerDayLow: 0,  mlPerKgPerDayHigh: 0,  notes: '+0.5-1 L/day total. Respiratory/renal losses.' },
  ],
  citations: [
    cite('§Daily Hydration Baseline', 'ml/kg/day by training volume + hot/altitude additives. National Academies absolute baseline: M ~3.7 L, F ~2.7 L total.', 'research', '19'),
  ],
};

export const HYDRATION_STATUS_INDICATORS: Cited<Array<{
  marker: string;
  euhydrated: string;
  hypohydrated: string;
}>> = {
  value: [
    { marker: 'First-morning urine specific gravity (USG)', euhydrated: '<1.020',           hypohydrated: '>1.020' },
    { marker: 'Urine color (Armstrong scale 1-8)',          euhydrated: '1-3 (pale yellow)', hypohydrated: '4+ (dark)' },
    { marker: 'Body mass (multi-day stable)',                euhydrated: 'Within 1% of baseline', hypohydrated: '>1% below baseline' },
    { marker: 'Plasma osmolality',                            euhydrated: '280-295 mOsm/kg',     hypohydrated: '>295 mOsm/kg' },
  ],
  note: 'WUT check (Weight, Urine, Thirst) — any two abnormal = hypohydration.',
  citations: [
    cite('§Daily Hydration Baseline › Hydration status indicators', 'USG, urine color, body mass, plasma osmolality thresholds', 'research', '19'),
  ],
};

// ── Drink-to-thirst vs structured ─────────────────────────────────

export const HYDRATION_STRATEGY_BY_SCENARIO: Cited<Array<{
  scenario: string;
  defaultApproach: 'drink_to_thirst' | 'drink_to_thirst_pre_hydrate' | 'drink_to_thirst_with_sodium' | 'structured_with_thirst_upper_bound' | 'sweat_rate_plan' | 'cap_thirst_led_eah_risk';
}>> = {
  value: [
    { scenario: '<60 min, any',                                  defaultApproach: 'drink_to_thirst_pre_hydrate' },
    { scenario: '60-90 min, temperate',                          defaultApproach: 'drink_to_thirst' },
    { scenario: '90 min - 3 h, temperate',                       defaultApproach: 'drink_to_thirst_with_sodium' },
    { scenario: '90 min - 3 h, hot/humid',                       defaultApproach: 'structured_with_thirst_upper_bound' },
    { scenario: '>3 h, any',                                      defaultApproach: 'sweat_rate_plan' },
    { scenario: 'Slow runners (>5h marathon)',                   defaultApproach: 'cap_thirst_led_eah_risk' },
    { scenario: 'Elite/fast in heat',                            defaultApproach: 'structured_with_thirst_upper_bound' },
  ],
  note: 'Convergent rule: never drink so much that body mass increases during exercise. Mass gain = overdrinking = EAH risk.',
  citations: [
    cite('§Drink-to-Thirst vs. Structured Hydration', 'Position A (Noakes) ad lib; Position B (ACSM) structured. Scenario → default approach.', 'research', '19'),
  ],
};

// ── Pre-race ──────────────────────────────────────────────────────

export const PRE_RACE_HYDRATION: Cited<{
  twentyFourHourPre: { dailyBaseline: string; addExtraMlLow: number; addExtraMlHigh: number; notes: string[] };
  twoToFourHourPre: { volumeMlPerKgLow: number; volumeMlPerKgHigh: number; sodiumMgLow: number; sodiumMgHigh: number; sodiumLoadingNote: string };
  finalHourPre: string[];
}> = {
  value: {
    twentyFourHourPre: {
      dailyBaseline: 'Daily baseline fluid + extra',
      addExtraMlLow: 500, addExtraMlHigh: 1000,
      notes: ['Liberal salt with meals', 'No alcohol', 'Maintain habitual caffeine', 'Verify first-morning USG <1.020'],
    },
    twoToFourHourPre: {
      volumeMlPerKgLow: 5, volumeMlPerKgHigh: 10,
      sodiumMgLow: 1000, sodiumMgHigh: 1500,
      sodiumLoadingNote: 'Sodium preloading at ~7.5 g NaCl/L (≈3000 mg Na/L) divided across 2 h pre-exercise. Increases plasma volume and reduces urinary loss of ingested fluid. Standard sports drinks (~230-690 mg Na/L) are insufficient.',
    },
    finalHourPre: [
      '60-30 min pre: stop large bolus drinking; allow void',
      '15-10 min pre: 150-250 ml top-up if thirsty',
      '0: final mouthful',
      'Goal: start euhydrated with plasma volume mildly expanded, not over-volumed',
    ],
  },
  citations: [
    cite('§Pre-Race Hydration', '24h pre + 2-4h pre 5-10 ml/kg + 1000-1500 mg Na sodium preload + final hour rules', 'research', '19'),
  ],
};

// ── During-race ───────────────────────────────────────────────────

export const FLUID_DURING_RACE: Cited<Record<'5K' | '10K' | 'half' | 'marathon' | 'ultra', {
  cool: { lowMlPerHr: number; highMlPerHr: number };
  temperate: { lowMlPerHr: number; highMlPerHr: number };
  warm: { lowMlPerHr: number; highMlPerHr: number };
  hot: { lowMlPerHr: number; highMlPerHr: number };
}>> = {
  value: {
    '5K':       { cool: { lowMlPerHr: 0,   highMlPerHr: 0   }, temperate: { lowMlPerHr: 0,   highMlPerHr: 0   }, warm: { lowMlPerHr: 0,   highMlPerHr: 100 }, hot: { lowMlPerHr: 100, highMlPerHr: 200 } },
    '10K':      { cool: { lowMlPerHr: 0,   highMlPerHr: 200 }, temperate: { lowMlPerHr: 100, highMlPerHr: 300 }, warm: { lowMlPerHr: 200, highMlPerHr: 400 }, hot: { lowMlPerHr: 300, highMlPerHr: 500 } },
    half:       { cool: { lowMlPerHr: 200, highMlPerHr: 400 }, temperate: { lowMlPerHr: 300, highMlPerHr: 500 }, warm: { lowMlPerHr: 400, highMlPerHr: 600 }, hot: { lowMlPerHr: 500, highMlPerHr: 800 } },
    marathon:   { cool: { lowMlPerHr: 300, highMlPerHr: 500 }, temperate: { lowMlPerHr: 400, highMlPerHr: 600 }, warm: { lowMlPerHr: 500, highMlPerHr: 700 }, hot: { lowMlPerHr: 600, highMlPerHr: 900 } },
    ultra:      { cool: { lowMlPerHr: 400, highMlPerHr: 600 }, temperate: { lowMlPerHr: 400, highMlPerHr: 700 }, warm: { lowMlPerHr: 500, highMlPerHr: 800 }, hot: { lowMlPerHr: 600, highMlPerHr: 1000 } },
  },
  note: 'EAH ceilings: general upper limit ~800 ml/hr. Slow finishers (>5h marathon, >6h 50K): ~500 ml/hr. Body mass should drop 1-3% during long events; mass gain = overdrinking. Per-aid-station (every 10-15 min): 400 ml/hr → 100 ml/station; 600 → 150; 800 → 200.',
  citations: [
    cite('§During-Race Hydration by Distance and Conditions', 'Distance × condition fluid intake table', 'research', '19'),
  ],
};

// ── Sweat rate calculation ────────────────────────────────────────

export const SWEAT_RATE_PROTOCOL: Cited<{
  steps: string[];
  formula: string;
  exampleCalc: string;
  testConditions: string[];
  typicalRanges: Array<{ category: 'low' | 'average' | 'high' | 'very_high'; lPerHrLow: number; lPerHrHigh: number | null }>;
}> = {
  value: {
    steps: [
      'Void, weigh nude or in dry minimal clothing to 0.1 kg',
      'Run 60-90 min at race-relevant intensity in target conditions',
      'Record fluid consumed (ml)',
      'Towel off, reweigh in same condition',
      'Subtract any urine voided',
    ],
    formula: 'Sweat loss (L) = pre-weight - post-weight + fluid in - urine out; Sweat rate (L/hr) = sweat loss / duration (hr)',
    exampleCalc: 'Example: 70.0 kg pre, 68.5 kg post, drank 0.5 L, no urine, 60 min → 2.0 L/hr',
    testConditions: ['Cool (~10°C)', 'Temperate (~18°C)', 'Warm (~25°C)', 'Hot (~30°C+)', 'Easy + race-pace intensities'],
    typicalRanges: [
      { category: 'low',                 lPerHrLow: 0,   lPerHrHigh: 0.8 },
      { category: 'average',             lPerHrLow: 0.8, lPerHrHigh: 1.2 },
      { category: 'high',                lPerHrLow: 1.2, lPerHrHigh: 1.8 },
      { category: 'very_high',           lPerHrLow: 1.8, lPerHrHigh: null },
    ],
  },
  note: 'A library of 4-6 measurements covers most race scenarios. Limit single-session test to 45 min - 2 h.',
  citations: [
    cite('§Sweat Rate Calculation', 'Protocol + formula + typical ranges (low <0.8, avg 0.8-1.2, high 1.2-1.8, very high >1.8 L/hr)', 'research', '19'),
  ],
};

// ── Sodium during exercise ────────────────────────────────────────

export const SWEAT_SODIUM_CLASSIFICATIONS: Cited<Array<{
  category: 'low' | 'medium' | 'high' | 'very_high_salty_sweater';
  mmolPerLLow: number;
  mmolPerLHigh: number | null;
  mgPerLLow: number;
  mgPerLHigh: number | null;
}>> = {
  value: [
    { category: 'low',                            mmolPerLLow: 0,  mmolPerLHigh: 30,  mgPerLLow: 0,    mgPerLHigh: 700 },
    { category: 'medium',                         mmolPerLLow: 30, mmolPerLHigh: 50,  mgPerLLow: 700,  mgPerLHigh: 1150 },
    { category: 'high',                           mmolPerLLow: 50, mmolPerLHigh: 70,  mgPerLLow: 1150, mgPerLHigh: 1600 },
    { category: 'very_high_salty_sweater',        mmolPerLLow: 70, mmolPerLHigh: null, mgPerLLow: 1600, mgPerLHigh: null },
  ],
  note: 'Population range ~10-90 mmol/L (~10-fold variation). Largely genetic; relatively stable within an individual at given training/acclimation status. Salty-sweater indicators: white salt crusts on kit/hat/skin; stinging eyes from sweat; salty taste on lips; cramping in long/hot events despite adequate fluid; CF carrier history.',
  citations: [
    cite('§Sweat Sodium Concentration', 'Low <30 / Medium 30-50 / High 50-70 / Very high >70 mmol/L', 'research', '19'),
  ],
};

export const SODIUM_INTAKE_BY_SCENARIO: Cited<Array<{
  scenario: string;
  sodiumMgPerHrLow: number;
  sodiumMgPerHrHigh: number | null;
}>> = {
  value: [
    { scenario: '<60 min, any',                                          sodiumMgPerHrLow: 0,    sodiumMgPerHrHigh: 200 },
    { scenario: '60-90 min, temperate',                                  sodiumMgPerHrLow: 200,  sodiumMgPerHrHigh: 400 },
    { scenario: '60-90 min, hot',                                        sodiumMgPerHrLow: 300,  sodiumMgPerHrHigh: 600 },
    { scenario: '90 min - 3 h, temperate',                               sodiumMgPerHrLow: 300,  sodiumMgPerHrHigh: 600 },
    { scenario: '90 min - 3 h, hot/humid',                               sodiumMgPerHrLow: 500,  sodiumMgPerHrHigh: 900 },
    { scenario: '>3 h, temperate',                                        sodiumMgPerHrLow: 500,  sodiumMgPerHrHigh: 800 },
    { scenario: '>3 h, hot/humid',                                        sodiumMgPerHrLow: 700,  sodiumMgPerHrHigh: 1200 },
    { scenario: 'Salty sweater + hot + >3 h',                            sodiumMgPerHrLow: 1000, sodiumMgPerHrHigh: null },
  ],
  note: 'ACSM baseline 300-600 mg/hr. Replace 50-100% of measured sweat sodium loss for events >3h or extreme heat. Optimal absorption + EAH prevention: 10-30 mmol/L Na in drink (230-690 mg/L). Standard sports drinks fit; high-Na products (LMNT, PH 1500) exceed for salty sweaters or pre-loading.',
  citations: [
    cite('§Sodium Intake During Exercise', 'Scenario → sodium mg/hr table', 'research', '19'),
  ],
};

// ── EAH ───────────────────────────────────────────────────────────

export const EAH_CLASSIFICATION: Cited<Array<{
  serumNaMmolPerL: string;
  classification: 'normal' | 'mild_eah' | 'moderate_eah' | 'severe_eah' | 'critical_eah';
}>> = {
  value: [
    { serumNaMmolPerL: '≥135',     classification: 'normal' },
    { serumNaMmolPerL: '130-134',  classification: 'mild_eah' },
    { serumNaMmolPerL: '125-129',  classification: 'moderate_eah' },
    { serumNaMmolPerL: '120-125',  classification: 'severe_eah' },
    { serumNaMmolPerL: '<120',     classification: 'critical_eah' },
  ],
  note: 'Per Hew-Butler 2015 consensus. Serum [Na+] <135 mmol/L during or within 24h of activity. <120: cerebral edema, seizure, death possible. <115: often fatal without intervention. Mechanism almost always dilutional — excess hypotonic fluid intake exceeds renal excretion, often combined with non-osmotic ADH/AVP secretion. Sodium loss alone rarely causes EAH; over-drinking is dominant.',
  citations: [
    cite('§Hyponatremia (Exercise-Associated)', 'Hew-Butler 2015 consensus: 130-134 mild / 125-129 moderate / <125 severe / <120 cerebral edema risk', 'research', '19'),
  ],
};

export const EAH_RISK_FACTORS: Cited<string[]> = {
  value: [
    'Slow finish (>4 h marathon) — more time to over-consume',
    'Female sex — smaller body mass, higher relative intake',
    'Low BMI — lower fluid distribution volume',
    'Inexperienced racers — following "drink as much as possible" advice',
    'Many aid stations on course',
    'Non-acclimated in cool conditions — low sweat rate, normal drinking',
    'NSAID use pre/during — impairs renal water excretion',
    'Body mass gain during race — direct evidence of overdrinking',
    'Sodium-poor fluid >1.5 L/hr for hours — dilutional risk',
  ],
  citations: [
    cite('§Hyponatremia › Risk factors', '9 risk factors for EAH', 'research', '19'),
  ],
};

export const EAH_PREVENTION_AND_TREATMENT: Cited<{
  prevention: string[];
  acuteTreatment: string[];
}> = {
  value: {
    prevention: [
      'Cap fluid intake by sweat rate',
      'Body mass should drop 1-3% in long events',
      'Sodium-containing fluids >90 min',
      'No NSAIDs pre/during racing',
      'Slow runners and first-timers: conservative caps',
      'Drink to thirst is the simplest safe default',
    ],
    acuteTreatment: [
      'Stop fluid intake immediately',
      'Hypertonic saline (3% NaCl) is first-line for symptomatic EAH; isotonic saline can worsen it',
      'Field: small volume of high-Na fluid (~100 ml strong oral electrolyte) only if conscious',
      'Transport for definitive care',
      'Never give hypotonic fluid to a downed runner who has gained weight',
    ],
  },
  citations: [
    cite('§Hyponatremia › Prevention + Treatment', '6 prevention rules + 5 acute treatment steps', 'research', '19'),
  ],
};

// ── Dehydration impact ────────────────────────────────────────────

export const DEHYDRATION_PERFORMANCE_IMPACT: Cited<Array<{
  bodyMassLossPctLow: number;
  bodyMassLossPctHigh: number;
  effect: string;
  symptoms: string[];
}>> = {
  value: [
    { bodyMassLossPctLow: 1, bodyMassLossPctHigh: 2, effect: 'Negligible to small in cool; small impairment in heat',  symptoms: ['Thirst (variable)', 'Mildly elevated HR for given pace'] },
    { bodyMassLossPctLow: 2, bodyMassLossPctHigh: 3, effect: '~3-5% slowdown in endurance running; cognitive blunting', symptoms: ['Persistent thirst', 'Dry mouth', 'Mild dizziness', 'Perceived exertion up'] },
    { bodyMassLossPctLow: 3, bodyMassLossPctHigh: 4, effect: '5-10% slowdown; clear cardiovascular strain',                symptoms: ['Headache', 'Fatigue', 'Irritability', 'Dark urine', 'Reduced sweat'] },
    { bodyMassLossPctLow: 4, bodyMassLossPctHigh: 6, effect: 'Severe performance loss; thermoregulation compromised',     symptoms: ['Nausea', 'Weakness', 'Cessation of urine', 'Mental cloudiness'] },
    { bodyMassLossPctLow: 6, bodyMassLossPctHigh: 100, effect: 'Heat illness risk high; medical emergency potential',     symptoms: ['Cramps', 'Hyperthermia signs', 'Syncope risk'] },
  ],
  note: 'Aerobic performance consistently impaired at ≥2% body mass loss from water deficit, especially warm/hot. Mechanisms: reduced plasma volume → ↓ stroke volume → cardiovascular drift → ↓ VO2max in heat. Augmented core temperature rise. Glycogen utilization rises. Cognition declines.',
  citations: [
    cite('§Dehydration Symptoms and Performance Impact', 'Body mass loss % → effect + symptoms', 'research', '19'),
  ],
};
