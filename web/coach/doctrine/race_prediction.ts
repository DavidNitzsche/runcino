/**
 * Doctrine — Race time prediction across distances.
 *
 * Source: Research/02-race-time-prediction.md
 *
 * Predicts race times across distances from a known performance plus
 * runner profile + race conditions. Engine consumers:
 *
 *   - /races/[slug] page    → goal-time validation ("is this realistic
 *                              given recent races?")
 *   - coach.paceStrategy    → race-day pacing plan derived from target
 *                              time
 *   - coach.briefRaceMorning → race-morning brief reads predicted time
 *                              + confidence interval to set expectations
 *
 * VDOT formulas + lookup live in pace_zones.ts (Research 01); this
 * file focuses on cross-distance prediction itself: Riegel, Cameron,
 * runner-type, age-grading, weighted multi-race fit. */
import { cite, type Cited } from './cite';

// ── Power-law time-distance relationship ───────────────────────────

/** The fundamental endurance prediction model. T = k · D^b, where
 *  b is the fatigue exponent (>1 because pace slows as distance
 *  grows). */
export const POWER_LAW_TIME_DISTANCE: Cited<{
  expression: string;
  logForm: string;
  pureSpeedExponent: number;
  typicalRunnerExponent: number;
  applicableRange: string;
}> = {
  value: {
    expression: 'T = k · D^b',
    logForm: 'ln T = ln k + b · ln D',
    pureSpeedExponent: 1.00,
    typicalRunnerExponent: 1.06,
    applicableRange: '1500m–marathon for trained runners; events lasting ~3.5–230 min',
  },
  note: 'A pure-speed model gives b = 1.00 (constant pace). Empirically b > 1: pace slows as distance grows because fuel, thermoregulation, mechanical wear, and central drive constraints accumulate.',
  citations: [
    cite('§1 Core Concept: Power-Law Time–Distance Relationship', 'When race times across distances are plotted on log-log axes (ln T vs ln D), the relationship is approximately linear. The slope is the fatigue exponent (~1.06 for most runners).', 'research', '02'),
  ],
};

// ── Riegel formula ─────────────────────────────────────────────────

/** The Riegel fatigue exponent — the single computational source for
 *  T2 = T1 × (D2/D1)^b. Import this everywhere a Riegel scaling is
 *  evaluated rather than re-typing the 1.06 literal (which had drifted
 *  across coach.ts). @research Research/02 §2.1 */
export const RIEGEL_EXPONENT = 1.06;

/** Riegel 1981 power-law race-time predictor. Default for predictions
 *  within 1500m–half marathon among trained runners. */
export const RIEGEL_FORMULA: Cited<{
  expression: string;
  defaultExponent: number;
  defaultExponentSource: string;
  applicableRange: string;
}> = {
  value: {
    expression: 'T2 = T1 × (D2 / D1)^1.06',
    defaultExponent: RIEGEL_EXPONENT,
    defaultExponentSource: 'Riegel 1977 cross-sport mean (running, swimming, cycling, speed skating WRs)',
    applicableRange: 'Events 3.5–230 minutes (≈ 1500m to marathon). Falls apart at sprints and ultras.',
  },
  citations: [
    cite('§2.1 Riegel Formula › Equation', 'T2 = T1 × (D2/D1)^1.06', 'research', '02'),
    cite('§2.2 Origin and Derivation', 'Riegel published the formula in Runner\'s World in 1977 and formalized it in "Athletic Records and Human Endurance," American Scientist 69(3): 285-290 (1981).', 'research', '02'),
  ],
};

/** Riegel accuracy by distance gap. Used to set confidence intervals
 *  on predictions. */
export const RIEGEL_ACCURACY_BY_GAP: Cited<Array<{
  gap: string;
  errorBandPctLow: number;
  errorBandPctHigh: number;
  notes: string;
}>> = {
  value: [
    { gap: '5K → 10K',          errorBandPctLow: 2,  errorBandPctHigh: 4,   notes: 'Most reliable extrapolation' },
    { gap: '10K → half',        errorBandPctLow: 3,  errorBandPctHigh: 6,   notes: 'Reliable when half is endurance-trained' },
    { gap: 'Half → marathon',   errorBandPctLow: 3,  errorBandPctHigh: 8,   notes: 'Reliable with marathon-specific training' },
    { gap: '5K → marathon',     errorBandPctLow: 8,  errorBandPctHigh: 15,  notes: 'Often optimistic; high variance. Vickers/Vertosick (2016): "dramatically underestimates marathon time, giving times at least 10 minutes too fast for half of runners" when extrapolating from a half marathon.' },
    { gap: 'Marathon → 5K',     errorBandPctLow: 5,  errorBandPctHigh: 10,  notes: 'Often pessimistic; speed underdeveloped' },
  ],
  note: 'Population studies put traditional formula accuracy at roughly 80% of runners within ±5%, meaning 1 in 5 runners miss the prediction by a meaningful margin.',
  citations: [
    cite('§2.3 Reported Accuracy', 'Distance gap → typical error band table', 'research', '02'),
  ],
};

// ── Cameron formula (long-distance correction) ─────────────────────

/** Cameron's non-linear regression. Better than Riegel for ultra
 *  predictions; agrees closely with Riegel up to half marathon. */
export const CAMERON_FORMULA: Cited<{
  expression: string;
  velocityFactorExpression: string;
  preferredFor: string;
  agreesWithRiegel: string;
}> = {
  value: {
    expression: 'T2 = (T1 / a(D1)) · a(D2)',
    velocityFactorExpression: 'a(d) = 13.49681 - 0.000030363 · d + 835.7114 · d^(-0.7905)',
    preferredFor: 'Marathon target or longer, when input is shorter than a half',
    agreesWithRiegel: 'Within 30 seconds at marathon distance; Cameron predicts longer/slower past marathon, matching empirical ultra data better',
  },
  citations: [
    cite('§3.1 Cameron Formula › Equation', 'a(d) = 13.49681 - 0.000030363·d + 835.7114·d^(-0.7905); T2 = (T1/a(D1))·a(D2)', 'research', '02'),
  ],
};

// ── Fatigue exponent variation ─────────────────────────────────────

/** Empirical fatigue-exponent estimates from the literature. The
 *  engine selects a default based on runner profile + target distance. */
export const FATIGUE_EXPONENT_LITERATURE: Cited<Array<{
  source: string;
  population: string;
  exponent: number;
  notes: string;
}>> = {
  value: [
    { source: 'Riegel 1977',          population: 'World records, multiple sports',      exponent: 1.06,   notes: 'Original cross-sport mean' },
    { source: 'Riegel 1981',          population: 'Men\'s running WRs (track only)',     exponent: 1.0773, notes: '1500m–marathon track' },
    { source: 'George 2017',          population: 'Men\'s road WRs',                     exponent: 1.0497, notes: 'Modern records, 5K–marathon' },
    { source: 'George 2017',          population: 'Men\'s track WRs',                    exponent: 1.0777, notes: 'Stable vs. Riegel original' },
    { source: 'George 2017',          population: 'Women\'s road WRs',                   exponent: 1.0397, notes: '~4% flatter than Riegel — women hold pace better with distance' },
    { source: 'George 2017',          population: 'Women\'s track WRs',                  exponent: 1.1228, notes: 'Track women still fade more' },
    { source: 'Vickers/Vertosick 2016', population: '2,000+ recreational',                exponent: 1.07,   notes: 'Adds weekly mileage correction term' },
    { source: 'Recreational averages',population: 'Mass-participation finishers',        exponent: 1.10,   notes: 'Range 1.07–1.12; higher than world-record curve' },
  ],
  citations: [
    cite('§6.1 Reported Exponent Estimates', 'Source / population / exponent for Riegel, George 2017, Vickers/Vertosick, recreational averages', 'research', '02'),
  ],
};

/** When to use which exponent. Engine reads this to select a default. */
export const FATIGUE_EXPONENT_BY_USE_CASE: Cited<Array<{
  useCase: string;
  exponentLow: number;
  exponentHigh: number;
}>> = {
  value: [
    { useCase: 'World-class endurance specialists; women on roads; strong marathon block',  exponentLow: 1.04, exponentHigh: 1.05 },
    { useCase: 'Default for trained runners, 1500m–half marathon',                          exponentLow: 1.06, exponentHigh: 1.06 },
    { useCase: 'Recreational runners with average endurance training',                       exponentLow: 1.07, exponentHigh: 1.08 },
    { useCase: 'Speed-biased runners; insufficient long-run base; marathon target',         exponentLow: 1.09, exponentHigh: 1.12 },
    { useCase: 'Ultra distances 50K–100K',                                                   exponentLow: 1.13, exponentHigh: 1.15 },
    { useCase: 'Multi-day events',                                                           exponentLow: 1.15, exponentHigh: 1.50 },
  ],
  note: 'Practical rule: estimate the exponent empirically from two recent races at different distances, then use it for the third.',
  citations: [
    cite('§6.2 When Each Applies', 'Use case → exponent range table', 'research', '02'),
  ],
};

/** Two-point empirical exponent fit. Use when two recent races on
 *  flat courses in similar weather are available. */
export const TWO_POINT_EXPONENT_FIT: Cited<{
  expression: string;
  preconditions: string[];
}> = {
  value: {
    expression: 'b = ln(T2 / T1) / ln(D2 / D1)',
    preconditions: [
      'Both races recent (within 8 weeks)',
      'Both on flat courses',
      'Both in similar weather',
      'Both at race effort, well-paced',
    ],
  },
  citations: [
    cite('§11.4 Two-Point Exponent Fit', 'b = ln(T2/T1) / ln(D2/D1). Use that b to project to the target distance instead of the default 1.06.', 'research', '02'),
  ],
};

// ── McMillan runner-type classification ────────────────────────────

export type RunnerType = 'speedster' | 'combo' | 'endurance_monster';

/** McMillan's three runner archetypes from race-curve shape. */
export const MCMILLAN_RUNNER_TYPES: Cited<Record<RunnerType, {
  diagnosticRatio: string;
  riegelEquivalentExponentLow: number;
  riegelEquivalentExponentHigh: number;
  practicalMarkers: string[];
  shortToLongAdjustment: string;
  longToShortAdjustment: string;
}>> = {
  value: {
    speedster: {
      diagnosticRatio: '5K → marathon underperforms by 5-10% vs. Riegel',
      riegelEquivalentExponentLow: 1.10, riegelEquivalentExponentHigh: 1.13,
      practicalMarkers: [
        'Stronger at 1500m–10K than at half/marathon',
        'Long runs and tempo work feel disproportionately hard',
        'Marathon prediction from 5K is consistently optimistic',
      ],
      shortToLongAdjustment: 'Add 3-5% to Riegel time (or use exponent ~1.10)',
      longToShortAdjustment: 'Default 1.06',
    },
    combo: {
      diagnosticRatio: 'Within ±2% of Riegel across distances',
      riegelEquivalentExponentLow: 1.06, riegelEquivalentExponentHigh: 1.08,
      practicalMarkers: [
        'Race-time curve closely follows Riegel/Daniels',
        'Predictions are reliable in both directions',
      ],
      shortToLongAdjustment: 'Default 1.06',
      longToShortAdjustment: 'Default 1.06',
    },
    endurance_monster: {
      diagnosticRatio: '5K → marathon overperforms vs. Riegel by 3-8%',
      riegelEquivalentExponentLow: 1.03, riegelEquivalentExponentHigh: 1.06,
      practicalMarkers: [
        'Stronger at half/marathon than 5K',
        'Short, fast workouts feel disproportionately hard',
        '5K predictions from a marathon are consistently pessimistic',
      ],
      shortToLongAdjustment: 'Default 1.06',
      longToShortAdjustment: 'Subtract 2-4% from Riegel time (or use exponent ~1.04)',
    },
  },
  citations: [
    cite('§7 Runner-Type Adjustments (McMillan)', 'Speedster (1.10-1.13) / Combo (1.06-1.08) / Endurance Monster (1.03-1.06) classification + practical markers + adjustments', 'research', '02'),
  ],
};

// ── Asymmetry: short→long vs long→short ───────────────────────────

/** Why short→long predictions are less reliable than long→short.
 *  Engine should widen confidence intervals when extrapolating from a
 *  shorter race to a much longer target. */
export const PREDICTION_ASYMMETRY_RULES: Cited<{
  shortToLongRiskHigher: boolean;
  mechanisms: Array<{ name: string; description: string }>;
}> = {
  value: {
    shortToLongRiskHigher: true,
    mechanisms: [
      {
        name: 'Energy system mismatch',
        description: '5K is ~95-100% VO2max with anaerobic contribution; marathon is 75-85% VO2max, almost entirely aerobic. A great 5K does not require fat oxidation, glycogen capacity, or fatigue resistance to mechanical impact. Conversion is bounded by whichever capacity is less developed.',
      },
      {
        name: 'Specificity-limited predictions',
        description: 'A 5K can be raced near full potential after a few weeks. A marathon cannot — long-run volume, midweek MLR, and weeks of race-pace effort take 12-18 weeks to develop. A 5K reveals current top-end fitness; it does not reveal whether endurance has been built.',
      },
      {
        name: 'Failure-mode asymmetry',
        description: 'In a 5K, suboptimal fueling/pacing/weather costs seconds. In a marathon, the same errors can cost 10+ minutes (the wall, cramping, dehydration). Prediction error grows non-linearly with distance.',
      },
      {
        name: 'Reverse direction is bounded',
        description: 'A marathoner predicted to run a fast 5K is bounded by max VO2 and neuromuscular ceiling — both easy to develop in 4-6 weeks of speed work. So a marathoner\'s 5K prediction is usually near actual potential.',
      },
    ],
  },
  citations: [
    cite('§8 Asymmetry: Why Marathon Predictions From Short Races Are Less Reliable Than the Reverse', 'Energy system mismatch, specificity, failure modes, reverse direction is bounded', 'research', '02'),
  ],
};

// ── Multi-race weighted estimation ─────────────────────────────────

/** Combining multiple race results for a more stable VDOT estimate. */
export const MULTI_RACE_VDOT_WEIGHTS: Cited<{
  decision: Array<{ pointSpread: string; method: string }>;
  weightFunction: string;
  recencyWeights: Array<{ ageWeeks: string; weight: number }>;
  specificityWeights: Array<{ relationship: string; weight: number }>;
  effortWeights: Array<{ context: string; weight: number }>;
  excludeRules: string[];
}> = {
  value: {
    decision: [
      { pointSpread: 'Within ±2 VDOT points',  method: 'Take the simple mean' },
      { pointSpread: 'Diverge by >2 VDOT points', method: 'Information signal — fit an exponent and classify runner type' },
    ],
    weightFunction: 'VDOT_estimate = Σ (w_i · VDOT_i) / Σ w_i; w_i = recency_weight · specificity_weight · effort_weight',
    recencyWeights: [
      { ageWeeks: '0-3 weeks',   weight: 1.0 },
      { ageWeeks: '4-6 weeks',   weight: 0.7 },
      { ageWeeks: '7-12 weeks',  weight: 0.4 },
      { ageWeeks: '>12 weeks',   weight: 0.0 },
    ],
    specificityWeights: [
      { relationship: 'Same distance class as target (e.g., half for marathon)',  weight: 1.5 },
      { relationship: 'Adjacent distance class',                                  weight: 1.0 },
      { relationship: 'Far distance class',                                       weight: 0.6 },
    ],
    effortWeights: [
      { context: 'Time-trial or A-race',  weight: 1.0 },
      { context: 'Tune-up race',          weight: 0.7 },
      { context: 'Fitness check',         weight: 0.4 },
    ],
    excludeRules: [
      'Discard any race run in heat >18°C (64°F) without correction',
      'Discard any race run on a hilly course without correction',
      'Discard any race run in a depleted state without correction',
    ],
  },
  citations: [
    cite('§11 Combining Multiple Race Times for a Better VDOT Estimate', 'Compute VDOT for each race; if within ±2 take mean; if >2 fit exponent. Weighted average uses recency × specificity × effort.', 'research', '02'),
  ],
};

// ── Age grading ────────────────────────────────────────────────────

/** WMA (World Masters Athletics) age-graded percentage. Allows
 *  comparison of performances across ages, sexes, distances. */
export const AGE_GRADING: Cited<{
  expression: string;
  source: string;
  performanceBands: Array<{ pctLow: number; pctHigh: number; class: 'world_class' | 'national_class' | 'regional_class' | 'local_class' | 'recreational' }>;
  equivalentOpenTimeExpression: string;
}> = {
  value: {
    expression: 'Age-Grade % = (Open WR Standard / Age Factor) / Actual Time × 100',
    source: 'World Masters Athletics 2023 Age-Grading Tables',
    performanceBands: [
      { pctLow: 90, pctHigh: 100, class: 'world_class' },
      { pctLow: 80, pctHigh: 89,  class: 'national_class' },
      { pctLow: 70, pctHigh: 79,  class: 'regional_class' },
      { pctLow: 60, pctHigh: 69,  class: 'local_class' },
      { pctLow: 0,  pctHigh: 59,  class: 'recreational' },
    ],
    equivalentOpenTimeExpression: 'Equivalent Open Time = Actual Time × Age Factor',
  },
  note: 'For masters runners, age-grading is more robust than VDOT for cross-distance prediction because the underlying tables are calibrated against age-specific records, not extrapolated from an open-class curve.',
  citations: [
    cite('§9 Age Grading and Age-Graded Predictions', 'Age-Grade % formula, performance bands (world class ≥90%, national 80-89%, regional 70-79%, local 60-69%, recreational <60%), and equivalent open time conversion. Source: WMA 2023 Age-Grading Tables.', 'research', '02'),
  ],
};

// ── Sex-specific differences ───────────────────────────────────────

/** Sex gap in world records by distance + adjustment recommendation. */
export const SEX_DIFFERENCES_BY_DISTANCE: Cited<{
  worldRecordGapPctByDistance: Array<{ distance: string; gapPct: number; notes?: string }>;
  patterns: string[];
  predictionAdjustment: string;
}> = {
  value: {
    worldRecordGapPctByDistance: [
      { distance: '100m',           gapPct: 9.5 },
      { distance: '5K (track)',     gapPct: 11.3 },
      { distance: '10K (track)',    gapPct: 10.3 },
      { distance: 'Half marathon',  gapPct: 9.3 },
      { distance: 'Marathon',       gapPct: 7.8 },
      { distance: '100K',           gapPct: 6.5 },
      { distance: '24-hour',        gapPct: 15,  notes: 'Small N — women approach or exceed men in 100+ mile and multi-day events' },
    ],
    patterns: [
      'Marathon and shorter: 7-11% gap, tightening with increasing aerobic specialization.',
      'Ultras with comparable participation: 1-3% in some race classes.',
      'Pacing: women are markedly more even-paced in marathons; men slow more in the second half.',
      'Updated fatigue exponents: Women\'s road 1.04 (modern) vs. Riegel\'s 1.07 — women hold pace better with distance than the original formula assumes.',
    ],
    predictionAdjustment: 'Default Riegel/VDOT slightly under-predicts women\'s marathon performance from a 5K input and slightly over-predicts men\'s. Apply -1% to women\'s predicted marathon time (faster) and +1% to men\'s (slower) when extrapolating short → long, or use exponent 1.04-1.05 for endurance-trained women.',
  },
  citations: [
    cite('§10 Sex-Specific Differences', 'World-record gap by distance, pacing patterns, and prediction adjustments', 'research', '02'),
  ],
};

// ── Predictor workouts ─────────────────────────────────────────────

export type PredictorWorkout = 'yasso_800s' | 'fast_finish_long_run' | 'tune_up_race' | 'race_effort_tempo';

export const PREDICTOR_WORKOUTS: Cited<Record<PredictorWorkout, {
  protocol: string;
  accuracyByRunnerType: Record<RunnerType, string>;
  errorPattern: string;
  appliesTo: 'marathon' | 'marathon_or_half' | 'multiple';
}>> = {
  value: {
    yasso_800s: {
      protocol: '10 × 800m at the time (in min:sec) you want to run the marathon (in hours:min). E.g., 3:00 800s = 3:00 marathon goal. Recovery: jog 800m or equal time.',
      accuracyByRunnerType: {
        speedster:           'Optimistic by 5-10 min',
        combo:               'Accurate ±3 min',
        endurance_monster:   'Pessimistic by 3-5 min',
      },
      errorPattern: 'Anecdotal correlation reported by Bart Yasso; not validated in controlled studies. Speedsters routinely hit Yasso targets in training but blow up — workout taxes VO2max and lactate buffering, not marathon-specific endurance.',
      appliesTo: 'marathon',
    },
    fast_finish_long_run: {
      protocol: 'Long run of 14-18 mi (22-29 km) where the final 3-10 mi (5-16 km) progress from marathon pace to half-marathon pace. Best when 3-5 of these complete in the final 8-12 weeks.',
      accuracyByRunnerType: {
        speedster:           'Accurate',
        combo:               'Accurate',
        endurance_monster:   'Accurate (often beats prediction)',
      },
      errorPattern: 'Low false positives — rarely passes a runner who can\'t deliver the marathon. Failing this workout is a clear signal that the goal is too aggressive.',
      appliesTo: 'marathon',
    },
    tune_up_race: {
      protocol: 'A half marathon 4-6 weeks before marathon goal, raced at race effort. Or a 10K-15K 6-8 weeks out for half-marathon target.',
      accuracyByRunnerType: {
        speedster:           'Optimistic by 2-4%',
        combo:               'Accurate ±2%',
        endurance_monster:   'Slightly pessimistic',
      },
      errorPattern: 'Highest accuracy of the four. Plug into Riegel/VDOT/Cameron with adjustment for the larger distance gap. Used by Pfitzinger and Daniels as the default predictor. ±2-4% on marathon target if specific endurance is in place.',
      appliesTo: 'marathon_or_half',
    },
    race_effort_tempo: {
      protocol: '6-10 mi (10-16 km) at projected half-marathon pace, or 8-12 mi at projected marathon pace, in the final 3-5 weeks.',
      accuracyByRunnerType: {
        speedster:           'Useful',
        combo:               'Useful',
        endurance_monster:   'Useful',
      },
      errorPattern: 'Not a quantitative predictor; binary go/no-go signal. If the tempo feels redline, the goal is too aggressive.',
      appliesTo: 'multiple',
    },
  },
  citations: [
    cite('§12 Predictor Workouts', 'Yasso 800s, Fast Finish LR, Tune-up race, Race-Effort Tempo — protocols + accuracy + runner-type matrix', 'research', '02'),
  ],
};

// ── Common error sources for prediction ───────────────────────────

/** Adjustments applied to a base prediction for course, weather,
 *  altitude, and runner profile. The race-prediction equivalents of
 *  the pace_zones training-pace adjustments. */
export const RACE_PREDICTION_ADJUSTMENTS: Cited<{
  trainingSpecificity: { addPctNoMarathonBlock: number; addPctNoMileageOrLR: number };
  courseProfile: Array<{ description: string; netGainFt: { low: number; high: number | null }; slowdownPctLow: number; slowdownPctHigh: number }>;
  perElevationGainSecPerMi: { ftPer: number; secPerMiLow: number; secPerMiHigh: number; downhillSymmetric: boolean };
  weatherHeatFactorByTempPlusDewF: Array<{ sumLow: number; sumHigh: number | null; pctLow: number; pctHigh: number | null }>;
  marathonHeatRule: string;
  altitudeAboveMSlowdownPct: Array<{ aboveMeters: number; pctLow: number; pctHigh: number; conditionUnacclimated: boolean }>;
  runnerProfile: { bmiAbove25AddPct: { low: number; high: number }; noviceWidenCiPct: { low: number; high: number } };
}> = {
  value: {
    trainingSpecificity: { addPctNoMarathonBlock: 5, addPctNoMileageOrLR: 8 },
    courseProfile: [
      { description: 'Flat',     netGainFt: { low: 0,    high: 100  }, slowdownPctLow: 0, slowdownPctHigh: 0 },
      { description: 'Rolling',  netGainFt: { low: 100,  high: 500  }, slowdownPctLow: 1, slowdownPctHigh: 2 },
      { description: 'Hilly',    netGainFt: { low: 500,  high: 1500 }, slowdownPctLow: 2, slowdownPctHigh: 5 },
      { description: 'Mountain', netGainFt: { low: 1500, high: null }, slowdownPctLow: 5, slowdownPctHigh: 15 },
    ],
    perElevationGainSecPerMi: { ftPer: 100, secPerMiLow: 2, secPerMiHigh: 4, downhillSymmetric: false },
    weatherHeatFactorByTempPlusDewF: [
      { sumLow: 0,   sumHigh: 100,  pctLow: 0,    pctHigh: 0    },
      { sumLow: 101, sumHigh: 120,  pctLow: 0.5,  pctHigh: 1    },
      { sumLow: 121, sumHigh: 130,  pctLow: 1,    pctHigh: 2    },
      { sumLow: 131, sumHigh: 140,  pctLow: 2,    pctHigh: 3    },
      { sumLow: 141, sumHigh: 150,  pctLow: 3,    pctHigh: 5    },
      { sumLow: 151, sumHigh: 160,  pctLow: 5,    pctHigh: 8    },
      { sumLow: 161, sumHigh: 170,  pctLow: 8,    pctHigh: 12   },
      { sumLow: 171, sumHigh: null, pctLow: 12,   pctHigh: 20   },
    ],
    marathonHeatRule: 'Marathon performance declines ~1.5-3% per 10°F (5.5°C) above 55°F (13°C).',
    altitudeAboveMSlowdownPct: [
      { aboveMeters: 1500, pctLow: 3, pctHigh: 5,  conditionUnacclimated: true },
      { aboveMeters: 2500, pctLow: 6, pctHigh: 10, conditionUnacclimated: true },
    ],
    runnerProfile: {
      bmiAbove25AddPct: { low: 1, high: 2 },
      noviceWidenCiPct: { low: 2, high: 2 },
    },
  },
  note: 'Wind: a 10 mph headwind/tailwind asymmetrically slows by more than a tailwind speeds up — net slowdown on out-and-back courses. Most prediction failures at the marathon are pacing failures (going out 5 sec/mi too fast in first 10K costs 30-60 sec/mi in final 10K — a net loss that can wipe out 20+ minutes).',
  citations: [
    cite('§13 Common Prediction Error Sources', 'Training specificity, course profile, weather, altitude, runner profile, pacing execution adjustments', 'research', '02'),
  ],
};

// ── Confidence intervals ───────────────────────────────────────────

/** 80% confidence intervals to report with predictions, by span. */
export const PREDICTION_CONFIDENCE_INTERVALS: Cited<Array<{
  span: string;
  ciPct: number;
  oneSided?: 'pessimistic' | 'optimistic';
}>> = {
  value: [
    { span: '5K → 10K, recent input',                           ciPct: 1.5 },
    { span: '10K → half, recent input',                         ciPct: 2.5 },
    { span: 'Half → marathon, marathon-trained',                ciPct: 3 },
    { span: '5K → marathon, marathon-trained',                  ciPct: 5 },
    { span: '5K → marathon, no marathon block',                 ciPct: 10, oneSided: 'pessimistic' },
    { span: 'Marathon → 5K, recent base',                       ciPct: 3 },
    { span: 'Cross-prediction with >6-month-old input',         ciPct: 8 },
  ],
  note: 'Always report a confidence interval, not a point estimate. Coaches who report point estimates for marathon goals from 5K times systematically over-predict.',
  citations: [
    cite('§13.7 Confidence Intervals to Report with Predictions', 'Prediction span → suggested 80% CI', 'research', '02'),
  ],
};

// ── Practical decision rules ───────────────────────────────────────

/** The full decision tree for picking a prediction method. */
export const PREDICTION_DECISION_RULES: Cited<Array<{
  rule: string;
  application: string;
}>> = {
  value: [
    {
      rule: 'Default formula',
      application: 'Riegel 1.06 for predictions within 1500m–half marathon among trained runners.',
    },
    {
      rule: 'Marathon target',
      application: 'Daniels VDOT or Cameron, but only if marathon-specific training is in place. Otherwise add a specificity penalty (Section 13.1).',
    },
    {
      rule: 'Two recent races available',
      application: 'Fit the runner\'s own exponent (Section 11.4) and use that for the third distance.',
    },
    {
      rule: 'Three recent races available',
      application: 'Classify as Speedster / Combo / Endurance Monster from the curve shape; apply runner-type adjustments.',
    },
    {
      rule: 'Masters runner',
      application: 'Convert to age-graded standard, predict, then convert back.',
    },
    {
      rule: 'Ultra target',
      application: 'Use Cameron or exponent ≥1.10; switch to time-on-feet models beyond 100K.',
    },
    {
      rule: 'Always report a confidence interval, not a point estimate',
      application: 'Coaches who report point estimates for marathon goals from 5K times systematically over-predict.',
    },
  ],
  citations: [
    cite('§14 Practical Decision Rules', '7-step decision tree for picking a prediction method', 'research', '02'),
  ],
};
