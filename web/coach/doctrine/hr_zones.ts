/**
 * Doctrine, Heart rate zones, HRmax estimation, LTHR, HRV, recovery
 * decision rules.
 *
 * Source: Research/03-heart-rate-zones.md
 *
 * The canonical HR-based prescription reference. Engine consumers:
 *
 *   - coach-engine.ts:344  applyConstraints, replaces magic
 *                          `avgHr >= 152` cutoff with research-backed
 *                          threshold (RHR_RECOVERY_DECISION_RULES /
 *                          %HRmax band Z3 boundary).
 *   - coach-state.ts       RHR baseline construction reads
 *                          RHR_BASELINE_PROTOCOL.
 *   - coach.assessReadiness reads HRV_INTERPRETATION_PATTERNS for
 *                          green/yellow/red levels.
 *
 * Daniels HR percentages (E/M/T/I/R) live in pace_zones.ts since
 * they're paired with the Daniels pace prescription.
 */
import { cite, type Cited } from './cite';

// ── HRmax estimation formulas ──────────────────────────────────────

export type HrmaxFormulaId =
  | 'fox' | 'tanaka' | 'gellish' | 'nes_hunt' | 'inbar' | 'astrand';

/** Population HRmax estimation formulas. Each takes age in years and
 *  returns predicted HRmax in bpm. SEE = standard error of estimate. */
export const HRMAX_FORMULAS: Cited<Record<HrmaxFormulaId, {
  expression: string;
  /** seconds-per-bpm error band (1 SEE). */
  seeBpm: number;
  year: number;
  notes: string;
}>> = {
  value: {
    fox: {
      expression: 'HRmax = 220 - age',
      seeBpm: 12,  // ~10-15
      year: 1971,
      notes: 'Casual rule; biased high under 30, low over 40. Avoid for prescription if better data exists.',
    },
    tanaka: {
      expression: 'HRmax = 208 - 0.7 × age',
      seeBpm: 10,
      year: 2001,
      notes: 'Meta n=18,712 + lab n=514. r=-0.90; better than Fox over age 40. For women marathoners, over-predicts ~5 bpm; subtract 5.',
    },
    gellish: {
      expression: 'HRmax = 207 - 0.7 × age',
      seeBpm: 7,
      year: 2007,
      notes: 'n=908 longitudinal. Comparable to Tanaka; lower SEE.',
    },
    nes_hunt: {
      expression: 'HRmax = 211 - 0.64 × age',
      seeBpm: 11,  // ±10.8
      year: 2013,
      notes: 'HUNT Fitness Study, n=3,320. No interaction with sex/fitness/BMI. Largest current dataset, prefer for >50.',
    },
    inbar: {
      expression: 'HRmax = 205.8 - 0.685 × age',
      seeBpm: 6,  // ~6.4
      year: 1994,
      notes: 'Treadmill-derived. Lowest SEE but smaller sample.',
    },
    astrand: {
      expression: 'HRmax = 216.6 - 0.84 × age',
      seeBpm: 10,
      year: 1952,
      notes: 'Older cycle-ergometer sample. Prefer Tanaka or Nes.',
    },
  },
  note: 'Age-based formulas: 95% CI ≈ ±20 bpm individually; ~68% within ±10-12 bpm. Field- or lab-measured HRmax is always preferred when available.',
  citations: [
    cite('§2 Estimating HRmax › Population formulas', 'Fox, Tanaka, Gellish, Nes/HUNT, Inbar, Astrand HRmax formulas with SEE', 'research', '03'),
  ],
};

/** Which HRmax formula to use given the runner's profile. */
export const HRMAX_FORMULA_SELECTION: Cited<Array<{
  profile: string;
  formula: HrmaxFormulaId | 'field_test_required' | 'no_formula_reliable';
  note?: string;
}>> = {
  value: [
    { profile: 'General adult, no test data',         formula: 'tanaka',              note: 'Or Nes for similar accuracy.' },
    { profile: 'Marathon runner (men)',               formula: 'tanaka' },
    { profile: 'Marathon runner (women)',             formula: 'tanaka',              note: 'Subtract 5 bpm, Tanaka over-predicts for women marathoners.' },
    { profile: 'Athlete >50',                         formula: 'nes_hunt',            note: 'Largest older sample.' },
    { profile: 'Children/adolescents (<16)',          formula: 'no_formula_reliable' },
    { profile: 'Highly trained / elite',              formula: 'field_test_required' },
  ],
  citations: [
    cite('§2 Choosing a Formula', 'General adult → Tanaka or Nes; Women marathoners → Tanaka -5; >50 → Nes (HUNT); elite → field test', 'research', '03'),
  ],
};

// ── HRmax field-test protocols ─────────────────────────────────────

export const HRMAX_FIELD_TEST_PROTOCOLS: Cited<Array<{
  id: 'mcmillan_flat_then_hill' | 'time_trial_2400m' | 'treadmill_ramp';
  name: string;
  protocol: string;
  reproducibilityBpm: number;
  contraindications: string[];
}>> = {
  value: [
    {
      id: 'mcmillan_flat_then_hill',
      name: 'McMillan flat-then-hill',
      protocol: '10-15 min warm-up + strides. 4 × 1 min hard on flat (2 min jog rest). Then 3-4 × hill (4-7% grade, 40-60 s) all-out, jog-down recovery, until consecutive peaks match. Peak observed = HRmax.',
      reproducibilityBpm: 3,
      contraindications: ['cardiac patients', 'untrained adults >40 without medical clearance', 'hypertension'],
    },
    {
      id: 'time_trial_2400m',
      name: '2400 m / 1.5 mi all-out',
      protocol: '15 min warm-up + strides. Run 2400 m building each lap; sprint last 200 m. Peak HR within 5-6 s of finish.',
      reproducibilityBpm: 3,
      contraindications: ['cardiac patients', 'untrained adults >40 without medical clearance', 'hypertension'],
    },
    {
      id: 'treadmill_ramp',
      name: 'Treadmill ramp',
      protocol: '10 min warm-up. 1% grade, start 8 km/h. Increase 1 km/h every 60 s; sprint final 30 s at max grade tolerable. Peak = HRmax.',
      reproducibilityBpm: 3,
      contraindications: ['cardiac patients', 'untrained adults >40 without medical clearance', 'hypertension'],
    },
  ],
  note: 'Common errors: reading average HR not peak; stopping at "felt hard" not volitional exhaustion; using wrist optical (use chest strap); testing in heat/illness/sleep debt (undershoots).',
  citations: [
    cite('§3 Field-Testing HRmax', 'Three protocols (McMillan flat-then-hill, 2400m TT, treadmill ramp) + common errors', 'research', '03'),
  ],
};

// ── %HRmax zone systems ────────────────────────────────────────────

export type HrmaxZone5 = 'recovery' | 'easy' | 'aerobic_tempo' | 'threshold' | 'vo2max';

/** ACSM / generic / commercial-wearable 5-zone system. */
export const HRMAX_ZONES_5: Cited<Record<HrmaxZone5, {
  pctLow: number;
  pctHigh: number;
  purpose: string;
  talkTest: string;
}>> = {
  value: {
    recovery:       { pctLow: 50, pctHigh: 60, purpose: 'Active recovery, walking',          talkTest: 'Full conversation' },
    easy:           { pctLow: 60, pctHigh: 70, purpose: 'Aerobic base, fat oxidation',        talkTest: 'Full sentences' },
    aerobic_tempo:  { pctLow: 70, pctHigh: 80, purpose: 'Aerobic capacity',                   talkTest: 'Short phrases' },
    threshold:      { pctLow: 80, pctHigh: 90, purpose: 'LT, race pace',                      talkTest: 'Few words' },
    vo2max:         { pctLow: 90, pctHigh: 100, purpose: 'Top-end aerobic, anaerobic',        talkTest: 'Single words / none' },
  },
  citations: [
    cite('§4 5-Zone (ACSM / generic / commercial wearables)', 'Z1 Recovery 50-60% / Z2 Easy 60-70% / Z3 Aerobic-Tempo 70-80% / Z4 Threshold 80-90% / Z5 VO2max 90-100% HRmax', 'research', '03'),
  ],
};

export type HrmaxZone7 = 'active_recovery' | 'endurance' | 'tempo' | 'sub_threshold' | 'threshold' | 'vo2max' | 'anaerobic';

/** British Cycling-style 7-zone system, adapted for running. */
export const HRMAX_ZONES_7: Cited<Record<HrmaxZone7, {
  pctLow: number;
  pctHigh: number;
  description: string;
  typicalDuration: string;
}>> = {
  value: {
    active_recovery: { pctLow: 0,  pctHigh: 60,  description: 'Shake-out',                  typicalDuration: '≤30 min' },
    endurance:       { pctLow: 60, pctHigh: 70,  description: 'Long, easy aerobic',         typicalDuration: '60 min - 4 h' },
    tempo:           { pctLow: 70, pctHigh: 80,  description: 'Marathon pace, steady',      typicalDuration: '30-90 min' },
    sub_threshold:   { pctLow: 80, pctHigh: 87,  description: 'Comfortably hard (LT1)',     typicalDuration: '20-60 min' },
    threshold:       { pctLow: 87, pctHigh: 92,  description: 'Cruise intervals (LT2)',     typicalDuration: '8 × 5 min' },
    vo2max:          { pctLow: 92, pctHigh: 98,  description: '3-5 min reps',                typicalDuration: '5 × 3 min' },
    anaerobic:       { pctLow: 98, pctHigh: 105, description: 'Neuromuscular',               typicalDuration: '8-12 × 30 s' },
  },
  citations: [
    cite('§4 7-Zone (British Cycling-style, adapted for running)', '7 zones from active recovery (<60%) to anaerobic (98-100%+) HRmax', 'research', '03'),
  ],
};

// ── Karvonen / HRR ────────────────────────────────────────────────

/** Karvonen heart-rate-reserve formula. More individual than %HRmax
 *  for athletes with extreme RHR. Requires accurate HRmax AND RHR;
 *  estimated HRmax compounds error. */
export const KARVONEN_FORMULA: Cited<{
  hrrExpression: string;
  targetExpression: string;
  zones: Record<'recovery' | 'endurance' | 'aerobic' | 'threshold' | 'vo2max', { hrrPctLow: number; hrrPctHigh: number }>;
}> = {
  value: {
    hrrExpression: 'HRR = HRmax - HRrest',
    targetExpression: 'Target HR = HRrest + (HRR × intensity_pct)',
    zones: {
      recovery:   { hrrPctLow: 50, hrrPctHigh: 60 },
      endurance:  { hrrPctLow: 60, hrrPctHigh: 70 },
      aerobic:    { hrrPctLow: 70, hrrPctHigh: 80 },
      threshold:  { hrrPctLow: 80, hrrPctHigh: 90 },
      vo2max:     { hrrPctLow: 90, hrrPctHigh: 100 },
    },
  },
  note: 'Karvonen yields higher absolute HR than %HRmax at the same percentage because RHR is the floor, not zero. Convergence at HRmax. ~10-20 bpm higher at low intensities. Standard in cardiac rehab and ACSM prescription.',
  citations: [
    cite('§5 Heart Rate Reserve / Karvonen Method', 'HRR = HRmax - HRrest; Target HR = HRrest + (HRR × intensity_pct); 5-zone HRR table', 'research', '03'),
  ],
};

// ── Friel LTHR system ──────────────────────────────────────────────

/** 30-minute time trial protocol to determine LTHR. The only field
 *  method validated as not significantly different from
 *  blood-lactate-determined LTHR (out of four tested). */
export const LTHR_30MIN_TT_PROTOCOL: Cited<{
  steps: string[];
  retestEveryWeeks: { low: number; high: number };
  measurement: string;
}> = {
  value: {
    steps: [
      'Solo, flat (track or road), no draft, no pacers.',
      '15 min warm-up + strides.',
      '30 min hard TT, controlled start, strong finish; ~10K race effort.',
      'Press lap at 10 min.',
      'LTHR = average HR during final 20 min.',
    ],
    retestEveryWeeks: { low: 6, high: 12 },
    measurement: 'Average HR during final 20 minutes of the 30-min TT.',
  },
  citations: [
    cite('§6 Lactate Threshold HR (LTHR), Friel System › Determining LTHR', '30-min TT protocol, LTHR = avg HR final 20 min, retest every 6-12 weeks', 'research', '03'),
  ],
};

export type FrielZone = 'z1_recovery' | 'z2_aerobic' | 'z3_tempo' | 'z4_subthreshold' | 'z5a_threshold' | 'z5b_aerobic_capacity' | 'z5c_anaerobic';

export const FRIEL_LTHR_ZONES: Cited<Record<FrielZone, {
  pctLthrLow: number;
  pctLthrHigh: number;
  description: string;
}>> = {
  value: {
    z1_recovery:           { pctLthrLow: 0,   pctLthrHigh: 85,  description: 'Recovery, easy active days' },
    z2_aerobic:            { pctLthrLow: 85,  pctLthrHigh: 89,  description: 'Long-run aerobic base' },
    z3_tempo:              { pctLthrLow: 90,  pctLthrHigh: 94,  description: 'Sub-LT steady' },
    z4_subthreshold:       { pctLthrLow: 95,  pctLthrHigh: 99,  description: 'Just below LT' },
    z5a_threshold:         { pctLthrLow: 100, pctLthrHigh: 102, description: 'At LT, cruise intervals' },
    z5b_aerobic_capacity:  { pctLthrLow: 103, pctLthrHigh: 106, description: 'VO2max work, 3-5 min' },
    z5c_anaerobic:         { pctLthrLow: 107, pctLthrHigh: 130, description: 'Short reps, neuromuscular' },
  },
  citations: [
    cite('§6 Lactate Threshold HR (LTHR), Friel System › Friel 7-Zone Running HR Table', 'Z1 <85% / Z2 85-89% / Z3 90-94% / Z4 95-99% / Z5a 100-102% / Z5b 103-106% / Z5c >106% LTHR', 'research', '03'),
  ],
};

// ── MAF method ─────────────────────────────────────────────────────

/** Maffetone aerobic-only HR cap. Conservative; built-in MAF Test
 *  tracks aerobic efficiency improvement at fixed HR. */
export const MAF_FORMULA: Cited<{
  baseExpression: string;
  adjustments: Array<{ category: 'a' | 'b' | 'c' | 'd'; description: string; adjBpm: number }>;
  specialCases: Array<{ scenario: string; rule: string }>;
}> = {
  value: {
    baseExpression: 'Base MAF HR = 180 - age',
    adjustments: [
      { category: 'a', description: 'Sick / on medication / >2 colds-flus per year / chronic injury', adjBpm: -10 },
      { category: 'b', description: 'Injured, regressing, frequent colds, allergies, asthma',         adjBpm: -5 },
      { category: 'c', description: 'Healthy, training consistently up to 2 years, progressing',     adjBpm: 0 },
      { category: 'd', description: '≥2 years consistent, no problems, competitive progress',         adjBpm: 5 },
    ],
    specialCases: [
      { scenario: 'Age >65, category (d)',           rule: 'May add up to 10 (not automatic)' },
      { scenario: 'Age ≤16',                          rule: 'Formula invalid; use 165 bpm cap' },
      { scenario: 'Beta-blockers',                    rule: 'Formula invalid' },
    ],
  },
  note: 'Often very low for younger trained athletes (age 30 → 150 bpm cap); critiqued as under-estimating AeT in highly trained. Not a complete training system; lacks high-intensity prescription.',
  citations: [
    cite('§7 MAF Method (Maffetone)', 'Base MAF HR = 180 − age + Maffetone categorical adjustments + special cases', 'research', '03'),
  ],
};

// ── RHR baseline + recovery decision rules ─────────────────────────

/** Protocol for establishing the runner's resting-HR baseline. */
export const RHR_BASELINE_PROTOCOL: Cited<{
  measurement: string;
  averageOverDays: number;
  recomputeEveryWeeks: { low: number; high: number };
  bandsByStatus: Record<'elite_endurance' | 'trained_recreational' | 'generally_fit' | 'average_sedentary' | 'elevated_unfit_stressed', { low: number; high: number }>;
  womenOffsetBpm: number;
}> = {
  value: {
    measurement: 'On waking, supine, before standing or coffee. Chest strap or oximeter preferred; wrist optical at rest is adequate.',
    averageOverDays: 14,
    recomputeEveryWeeks: { low: 4, high: 8 },
    bandsByStatus: {
      elite_endurance:        { low: 30, high: 45 },
      trained_recreational:   { low: 45, high: 55 },
      generally_fit:          { low: 55, high: 65 },
      average_sedentary:      { low: 65, high: 80 },
      elevated_unfit_stressed:{ low: 80, high: 999 },
    },
    womenOffsetBpm: 5,  // RHR runs 5-10 bpm higher in women than men on average
  },
  citations: [
    cite('§9 Resting HR Baseline', 'Average over 14 days of normal training; recompute every 4-8 weeks. Adult RHR bands by status. Women average ~5 bpm higher.', 'research', '03'),
  ],
};

/** Daily RHR-vs-baseline → action mapping. The engine consumes this
 *  for daily readiness decisions. Replaces the magic-number cutoff
 *  approach previously in coach-engine.ts. */
export const RHR_RECOVERY_DECISION_RULES: Cited<Array<{
  condition: string;
  /** Delta from baseline in bpm. */
  deltaBpmLow: number | null;
  deltaBpmHigh: number | null;
  sustainedDays?: number;
  action: 'train_as_planned' | 'reduce_intensity' | 'easy_or_rest' | 'investigate' | 'rest_investigate' | 'reduce_load' | 'suspect_overtraining';
  note: string;
}>> = {
  value: [
    {
      condition: 'Within ±3 bpm of baseline',
      deltaBpmLow: -3, deltaBpmHigh: 3,
      action: 'train_as_planned',
      note: 'Day-to-day RHR has natural ±3-4 bpm noise.',
    },
    {
      condition: '+4 to +6 bpm above baseline',
      deltaBpmLow: 4, deltaBpmHigh: 6,
      action: 'reduce_intensity',
      note: 'Replace quality with aerobic.',
    },
    {
      condition: '+7 or more bpm above baseline',
      deltaBpmLow: 7, deltaBpmHigh: null,
      action: 'easy_or_rest',
      note: 'Easy day or rest. Single-day signal.',
    },
    {
      condition: '+5 or more bpm sustained ≥3 days',
      deltaBpmLow: 5, deltaBpmHigh: null,
      sustainedDays: 3,
      action: 'suspect_overtraining',
      note: 'Suspect overtraining, illness, or dehydration.',
    },
    {
      condition: '+10 or more bpm above baseline',
      deltaBpmLow: 10, deltaBpmHigh: null,
      action: 'rest_investigate',
      note: 'Rest; investigate (illness, sleep loss).',
    },
    {
      condition: 'Upward drift over 2-3 weeks',
      deltaBpmLow: null, deltaBpmHigh: null,
      action: 'reduce_load',
      note: 'Over-reaching. Reduce training load.',
    },
    {
      condition: 'Suppressed RHR + suppressed HRV',
      deltaBpmLow: null, deltaBpmHigh: null,
      action: 'investigate',
      note: 'Possible parasympathetic overtraining (rare). Investigate.',
    },
  ],
  citations: [
    cite('§9 Recovery Decision Rules', 'RHR vs baseline (morning) → action mapping (within ±3 train, +4-6 reduce, +7 easy or rest, etc)', 'research', '03'),
  ],
};

// ── HRV ────────────────────────────────────────────────────────────

/** Daily HRV measurement protocol. */
export const HRV_DAILY_PROTOCOL: Cited<{
  primaryMetric: 'RMSSD' | 'LnRMSSD';
  measurement: string;
  durationStabilizationS: number;
  durationRecordingS: number;
}> = {
  value: {
    primaryMetric: 'RMSSD',
    measurement: 'Within ~5 min of waking, supine, calm breathing. Same time, posture, conditions daily.',
    durationStabilizationS: 60,
    durationRecordingS: 60,
  },
  note: 'For daily training decisions, RMSSD or LnRMSSD is standard. SDNN influenced by both branches; less specific to recovery.',
  citations: [
    cite('§10 HRV, Daily Protocol', 'Within ~5 min of waking, supine. 1 min stabilization + 1 min recording. RMSSD/LnRMSSD primary.', 'research', '03'),
  ],
};

/** Daily-vs-trend interpretation patterns. The engine reads these for
 *  green/yellow/red readiness levels. */
export const HRV_INTERPRETATION_PATTERNS: Cited<Array<{
  pattern: string;
  interpretation: 'train_as_planned' | 'reduce_intensity' | 'easy_or_rest' | 'positive_adaptation' | 'functional_stress' | 'reduce_load' | 'overload_signal' | 'parasympathetic_overtraining';
  durationDays?: number;
}>> = {
  value: [
    { pattern: 'Daily within "normal range" (±0.5-1 SD of 7-day rolling mean)',                  interpretation: 'train_as_planned' },
    { pattern: 'Daily drop >1 SD below 7-day mean',                                              interpretation: 'reduce_intensity' },
    { pattern: 'Daily drop ~20% below baseline',                                                 interpretation: 'easy_or_rest' },
    { pattern: '7-day rolling mean rising over weeks',                                           interpretation: 'positive_adaptation' },
    { pattern: '7-day rolling mean stable + acute drops normalize',                              interpretation: 'functional_stress' },
    { pattern: '7-day rolling mean declining over 2+ weeks + elevated RHR',                      interpretation: 'reduce_load',         durationDays: 14 },
    { pattern: 'Elevated CV of HRV (RMSSDcv) >10-14% if persistent',                             interpretation: 'overload_signal' },
    { pattern: 'Suppressed HRV with suppressed RHR',                                             interpretation: 'parasympathetic_overtraining' },
  ],
  note: 'A single HRV value is noise. Use 7-day rolling average vs. individual normal range (rolling mean ± SD or ±20%). Act on trend, not single readings.',
  citations: [
    cite('§10 HRV, Interpreting Daily vs. Trend', 'Pattern → interpretation table', 'research', '03'),
  ],
};

/** Coefficient of variation of RMSSD (RMSSDcv) population bands. */
export const HRV_CV_BANDS: Cited<{
  expression: string;
  bands: Record<'elite_endurance' | 'recreational' | 'intensified_block' | 'non_functional_overreaching', { pctLow: number; pctHigh: number }>;
}> = {
  value: {
    expression: 'CV = SD(RMSSD) / mean(RMSSD) × 100%',
    bands: {
      elite_endurance:                  { pctLow: 5,   pctHigh: 8 },
      recreational:                     { pctLow: 8,   pctHigh: 12 },
      intensified_block:                { pctLow: 8,   pctHigh: 14 },
      non_functional_overreaching:      { pctLow: 14,  pctHigh: 100 },
    },
  },
  citations: [
    cite('§10 CV (Coefficient of Variation)', 'CV = SD(RMSSD) / mean(RMSSD) × 100%; population bands 5-8% elite to >14% non-functional overreaching', 'research', '03'),
  ],
};

// ── HR vs Pace divergence ──────────────────────────────────────────

/** Conditions where HR and pace tell different stories about effort.
 *  The engine consults this when reconciling pace target vs HR
 *  feedback. */
export const HR_VS_PACE_DIVERGENCE: Cited<Array<{
  condition: string;
  paceEffect: 'slows' | 'fastens' | 'on_target' | 'same_or_slower' | 'same' | 'slower';
  hrEffect: 'rises' | 'same' | 'same_or_lower' | 'mixed' | 'higher' | 'lags' | 'far_below' | 'submax_up_max_down' | 'suppressed';
  trustWhich: 'HR' | 'pace_plus_rpe' | 'mixed';
}>> = {
  value: [
    { condition: 'Headwind',                                paceEffect: 'slows',          hrEffect: 'same',                trustWhich: 'HR' },
    { condition: 'Tailwind',                                paceEffect: 'fastens',        hrEffect: 'same',                trustWhich: 'HR' },
    { condition: 'Uphill',                                  paceEffect: 'slows',          hrEffect: 'rises',               trustWhich: 'HR' },
    { condition: 'Downhill',                                paceEffect: 'fastens',        hrEffect: 'same_or_lower',       trustWhich: 'mixed' },
    { condition: 'Hot day',                                 paceEffect: 'slows',          hrEffect: 'rises',               trustWhich: 'HR' },
    { condition: 'Dehydrated long run',                     paceEffect: 'slows',          hrEffect: 'rises',               trustWhich: 'HR' },
    { condition: 'Fatigue residue',                         paceEffect: 'same_or_slower', hrEffect: 'higher',              trustWhich: 'HR' },
    { condition: 'Detrained / sick',                        paceEffect: 'slower',         hrEffect: 'higher',              trustWhich: 'HR' },
    { condition: 'Short interval (<2 min)',                 paceEffect: 'on_target',      hrEffect: 'lags',                trustWhich: 'pace_plus_rpe' },
    { condition: 'Sprint (<30 s)',                          paceEffect: 'on_target',      hrEffect: 'far_below',           trustWhich: 'pace_plus_rpe' },
    { condition: 'Beta-blockers',                           paceEffect: 'same',           hrEffect: 'suppressed',          trustWhich: 'pace_plus_rpe' },
    { condition: 'Altitude (acclimatized)',                 paceEffect: 'slows',          hrEffect: 'submax_up_max_down',  trustWhich: 'HR' },
  ],
  note: 'Coaching: easy/long aerobic prioritize HR; threshold/tempo use both, trust lower-intensity signal on disagreement; VO2max (3-5 min) pace primary, confirm HR reaches band; reps/sprints pace and RPE only.',
  citations: [
    cite('§11 HR vs. Pace, Divergence Patterns', 'Condition → pace effect, HR effect, true effort metric', 'research', '03'),
  ],
};

// ── Cardiac drift / Pa:HR decoupling ───────────────────────────────

/** Pa:HR aerobic-decoupling thresholds. Low decoupling = strong
 *  aerobic endurance. */
export const PA_HR_DECOUPLING_BANDS: Cited<{
  expression: string;
  efExpression: string;
  measurementProtocol: string;
  bands: Array<{ pctLow: number; pctHigh: number; meaning: 'strong_endurance' | 'acceptable' | 'endurance_gap' | 'above_aerobic_threshold' }>;
  heatArtifactPct: { low: number; high: number };
  marathonGoal: string;
}> = {
  value: {
    efExpression: 'EF = speed / HR  (use speed, not min/km)',
    expression: 'Pa:HR Decoupling % = ((EF_1st_half / EF_2nd_half) - 1) × 100%',
    measurementProtocol: 'Compare first vs. second half of a steady aerobic run (60-90 min).',
    bands: [
      { pctLow: 0,   pctHigh: 5,   meaning: 'strong_endurance' },
      { pctLow: 5,   pctHigh: 8,   meaning: 'acceptable' },
      { pctLow: 8,   pctHigh: 10,  meaning: 'endurance_gap' },
      { pctLow: 10,  pctHigh: 100, meaning: 'above_aerobic_threshold' },
    ],
    heatArtifactPct: { low: 2, high: 5 },
    marathonGoal: 'A well-paced marathon shows <5% Pa:HR decoupling at 30 km. High early decoupling = inadequate base or too-aggressive start.',
  },
  citations: [
    cite('§12 Cardiac Drift and Aerobic Decoupling (Pa:HR)', 'EF = speed / HR; decoupling = ((EF_1st / EF_2nd) - 1) × 100%; bands <5% strong / 5-8% acceptable / 8-10% gap / >10% above threshold', 'research', '03'),
  ],
};

// ── HR utility by interval duration ────────────────────────────────

/** HR onset is slow (~30 s half-time, 90-180 s plateau). For short
 *  reps, HR lags actual effort. The engine consults this when
 *  deciding which metric to prescribe for a given workout. */
export const HR_UTILITY_BY_REP_DURATION: Cited<Array<{
  repLength: string;
  repLengthLowS: number;
  repLengthHighS: number | null;
  hrUtility: 'useless_lags' | 'late_rep_meaningful' | 'reaches_band_late' | 'reaches_band_mid' | 'steady_state_achievable' | 'reliable';
  primaryAnchor: 'pace' | 'pace_rpe' | 'pace_hr' | 'hr_pace' | 'hr';
}>> = {
  value: [
    { repLength: '<30 s (sprints, R)',     repLengthLowS: 0,   repLengthHighS: 30,   hrUtility: 'useless_lags',           primaryAnchor: 'pace_rpe' },
    { repLength: '30-90 s',                repLengthLowS: 30,  repLengthHighS: 90,   hrUtility: 'late_rep_meaningful',    primaryAnchor: 'pace' },
    { repLength: '90 s - 3 min',           repLengthLowS: 90,  repLengthHighS: 180,  hrUtility: 'reaches_band_late',      primaryAnchor: 'pace' },
    { repLength: '3-5 min (classic VO2)',  repLengthLowS: 180, repLengthHighS: 300,  hrUtility: 'reaches_band_mid',       primaryAnchor: 'pace_hr' },
    { repLength: '5-15 min (T)',           repLengthLowS: 300, repLengthHighS: 900,  hrUtility: 'steady_state_achievable', primaryAnchor: 'hr_pace' },
    { repLength: '≥15 min',                repLengthLowS: 900, repLengthHighS: null, hrUtility: 'reliable',               primaryAnchor: 'hr' },
  ],
  note: 'HR rises with half-time of ~30 s on intensity step-up, plateauing at 90-180 s. Recovery half-time ~30 s, slower in fatigue or heat. HR is also a poor index of true recovery between reps (Sangan 2015), use fixed time-recovery, not HR-based.',
  citations: [
    cite('§13 Why HR is Unreliable for Short Intervals', 'HR rises with half-time of ~30 s, plateaus at 90-180 s. Rep length → HR utility table.', 'research', '03'),
  ],
};

// ── Decision logic: HR vs pace vs RPE ──────────────────────────────

/** Master decision table, for each workout type, which metric is
 *  primary and which is secondary. Drives coach prescription style. */
export const COACH_BY_METRIC_DECISION: Cited<Array<{
  workoutType: string;
  primary: 'hr' | 'pace' | 'rpe' | 'effort' | 'pace_plus_rpe' | 'hr_or_pace' | 'pace_early_hr_later' | 'hr_plus_rpe';
  secondary: 'hr' | 'pace' | 'rpe' | 'none';
  notes?: string;
}>> = {
  value: [
    { workoutType: 'Recovery jog',                  primary: 'hr',                  secondary: 'rpe',  notes: 'Cap HR; ignore pace.' },
    { workoutType: 'Easy aerobic',                  primary: 'hr',                  secondary: 'rpe',  notes: 'HR cap (MAF or Z2).' },
    { workoutType: 'Long run (steady)',             primary: 'hr',                  secondary: 'rpe',  notes: 'Expect mild drift.' },
    { workoutType: 'Long run with fast finish',     primary: 'pace',                secondary: 'hr',   notes: 'Target pace last 25%.' },
    { workoutType: 'Marathon-pace run',             primary: 'pace',                secondary: 'hr',   notes: 'M-pace anchored to goal.' },
    { workoutType: 'Tempo (continuous)',            primary: 'hr_or_pace',          secondary: 'rpe',  notes: 'Both valid >15 min.' },
    { workoutType: 'Threshold reps (5-15 min)',     primary: 'pace',                secondary: 'hr',   notes: 'Pace primary, HR confirms.' },
    { workoutType: 'VO2max reps (3-5 min)',         primary: 'pace',                secondary: 'rpe',  notes: 'HR lags; reaches band by rep 2-3.' },
    { workoutType: 'VO2max short (<3 min)',         primary: 'pace',                secondary: 'rpe',  notes: 'Ignore HR target.' },
    { workoutType: 'Reps / R-pace (<2 min)',        primary: 'pace',                secondary: 'rpe',  notes: 'Ignore HR.' },
    { workoutType: 'Strides / sprints',             primary: 'effort',              secondary: 'pace', notes: 'No HR target.' },
    { workoutType: 'Hill repeats',                  primary: 'rpe',                 secondary: 'hr',   notes: 'Pace meaningless.' },
    { workoutType: 'Race (5K-HM)',                  primary: 'pace_plus_rpe',       secondary: 'hr',   notes: 'HR informs pacing.' },
    { workoutType: 'Race (marathon+)',              primary: 'pace_early_hr_later', secondary: 'rpe',  notes: 'HR cap first 20 km.' },
    { workoutType: 'Trail / mountain',              primary: 'hr',                  secondary: 'rpe',  notes: 'Pace unusable.' },
    { workoutType: 'Hot weather any session',       primary: 'hr_plus_rpe',         secondary: 'none', notes: 'Pace targets invalid.' },
    { workoutType: 'Sick / illness recovery',       primary: 'hr_plus_rpe',         secondary: 'none', notes: 'Pace meaningless.' },
    { workoutType: 'Beta-blocker user',             primary: 'rpe',                 secondary: 'pace', notes: 'HR invalid.' },
  ],
  note: 'Master rule: pace = objective external (what got done); HR = physiological internal (what it cost); RPE = integrated perceived. Coach by the metric reflecting the adaptive stimulus: internal (HR/RPE) for aerobic/recovery work, external (pace) for VO2max and speed.',
  citations: [
    cite('§14 Decision Logic, Coach by HR vs. Pace vs. RPE', 'Workout type → primary metric, secondary metric, notes', 'research', '03'),
  ],
};

// ── Sensor accuracy ────────────────────────────────────────────────

export const HR_SENSOR_ACCURACY: Cited<{
  classes: Record<'chest_strap' | 'wrist_optical' | 'arm_optical', {
    steadyRunningBpmError: { low: number; high: number };
    intervalsBpmError: { low: number; high: number };
    sprintsBpmError: { low: number; high: number };
    laggS: number | null;
  }>;
  recommendations: Record<string, 'chest_strap_mandatory' | 'chest_strap_preferred' | 'chest_strap_strongly_preferred' | 'wrist_optical_adequate'>;
  failureModes: string[];
}> = {
  value: {
    classes: {
      chest_strap:    { steadyRunningBpmError: { low: 1, high: 2 },  intervalsBpmError: { low: 1, high: 2 },  sprintsBpmError: { low: 1, high: 2 },  laggS: null },
      wrist_optical:  { steadyRunningBpmError: { low: 3, high: 10 }, intervalsBpmError: { low: 5, high: 15 }, sprintsBpmError: { low: 20, high: 40 }, laggS: 10 },
      arm_optical:    { steadyRunningBpmError: { low: 2, high: 5 },  intervalsBpmError: { low: 3, high: 8 },  sprintsBpmError: { low: 5, high: 15 },  laggS: null },
    },
    recommendations: {
      'LTHR field test':           'chest_strap_mandatory',
      'HRmax field test':          'chest_strap_mandatory',
      'HRV daily':                 'chest_strap_mandatory',
      'Easy steady runs':          'wrist_optical_adequate',
      'Race / marathon':           'chest_strap_preferred',
      'Intervals / threshold':     'chest_strap_strongly_preferred',
      'RHR (waking, still)':       'wrist_optical_adequate',
    },
    failureModes: [
      'Cadence lock: sensor reports cadence (steps/min) instead of HR, often "stuck" at 150-180.',
      'Slow rise: HR shows 130 when chest strap shows 165 in first minute of a hard rep.',
      'Drop-out: HR briefly reads zero or implausibly low.',
    ],
  },
  citations: [
    cite('§15 Wrist Optical vs. Chest Strap Accuracy', 'Chest strap ±1-2 bpm; wrist optical ±3-10 steady, ±5-15 intervals, 20-40 off in sprints. Use-case recommendations.', 'research', '03'),
  ],
};

// ── System picker ──────────────────────────────────────────────────

/** Which HR system to use given the runner's data quality. */
export const HR_SYSTEM_PICKER: Cited<Array<{
  context: string;
  recommendedSystem: 'pct_hrmax_via_formula' | 'karvonen_hrr' | 'friel_lthr' | 'daniels_hr' | 'maf' | 'maf_minus_5' | 'maf_minus_10' | 'rpe_primary' | 'lab_lactate' | 'vt1_vt2_anchored' | 'hr_primary_pace_secondary';
}>> = {
  value: [
    { context: 'No HRmax, no RHR, no test',                                            recommendedSystem: 'pct_hrmax_via_formula' },
    { context: 'Reliable RHR + field-tested HRmax',                                    recommendedSystem: 'karvonen_hrr' },
    { context: 'Reliable LTHR (30-min TT)',                                            recommendedSystem: 'friel_lthr' },
    { context: 'Lab lactate test',                                                     recommendedSystem: 'lab_lactate' },
    { context: 'Lab gas exchange',                                                     recommendedSystem: 'vt1_vt2_anchored' },
    { context: 'Healthy beginner, base building',                                      recommendedSystem: 'maf' },
    { context: 'Returning from injury / illness',                                      recommendedSystem: 'maf_minus_5' },
    { context: 'Trail / mountain / variable terrain',                                  recommendedSystem: 'hr_primary_pace_secondary' },
    { context: 'Track / road racing focus',                                            recommendedSystem: 'daniels_hr' },
    { context: 'Beta-blocker / cardiac med user',                                      recommendedSystem: 'rpe_primary' },
  ],
  citations: [
    cite('§17 Picking a System', 'Data quality / context → recommended primary HR system', 'research', '03'),
  ],
};

/** Cross-system equivalences for "Z2 easy" and "Threshold". */
export const HR_SYSTEM_CROSSWALK: Cited<{
  z2_easy: { hrmaxPctLow: number; hrmaxPctHigh: number; hrrPctLow: number; hrrPctHigh: number; lthrPctLow: number; lthrPctHigh: number };
  threshold: { hrmaxPctLow: number; hrmaxPctHigh: number; hrrPctLow: number; hrrPctHigh: number; lthrPctLow: number; lthrPctHigh: number };
}> = {
  value: {
    z2_easy:    { hrmaxPctLow: 65, hrmaxPctHigh: 75, hrrPctLow: 60, hrrPctHigh: 72, lthrPctLow: 75, lthrPctHigh: 88 },
    threshold:  { hrmaxPctLow: 86, hrmaxPctHigh: 92, hrrPctLow: 83, hrrPctHigh: 90, lthrPctLow: 95, lthrPctHigh: 102 },
  },
  note: 'Exact crosswalks differ by athlete (RHR, LTHR/HRmax ratio). If two systems disagree, the more individualized one (LTHR > Karvonen > %HRmax) wins.',
  citations: [
    cite('§17 Conversion Between Systems', '%HRmax 65-75% ≈ %HRR 60-72% ≈ %LTHR 75-88% ≈ Daniels E (Z2 easy); %HRmax 86-92% ≈ %HRR 83-90% ≈ %LTHR 95-102% ≈ Daniels T', 'research', '03'),
  ],
};

// ── Coaching heuristics ────────────────────────────────────────────

/** Quick-action rules from the research's coaching-heuristics
 *  section. Each is paired with the trigger and the prescribed
 *  response. */
export const HR_COACHING_HEURISTICS: Cited<Array<{
  trigger: string;
  action: string;
}>> = {
  value: [
    { trigger: 'Morning RHR +7 bpm above baseline',                              action: 'Easy day' },
    { trigger: 'HRV trending down 5+ days + RHR trending up',                    action: 'Unload week' },
    { trigger: 'Cardiac drift >5% in a Z2 run that previously showed <5%',       action: 'Heat, fatigue, or detraining, investigate' },
    { trigger: 'HR not reaching VO2max band by rep 3 of 5 × 3 min',              action: 'Pace too slow' },
    { trigger: 'Easy-pace HR dropping at fixed pace over weeks',                 action: 'Aerobic adaptation working' },
    { trigger: 'Easy-pace HR rising at fixed pace over weeks',                   action: 'Under-recovery or stress' },
  ],
  citations: [
    cite('§18 Coaching Heuristics', 'Quick-action rules from RHR, HRV, cardiac drift, and easy-pace HR signals', 'research', '03'),
  ],
};

// ── HR confounders ─────────────────────────────────────────────────

/** Known confounders that distort HR at fixed effort. The engine uses
 *  this list when deciding whether to trust an HR-derived signal. */
export const HR_CONFOUNDERS: Cited<Array<{
  confounder: string;
  effectAtFixedEffort: 'rises' | 'suppresses' | 'lower_at_low_intensity' | 'submax_rises_max_falls' | 'fasted_higher' | 'onset_lag';
  magnitude: string;
}>> = {
  value: [
    { confounder: 'Cardiac drift (>30 min steady)',          effectAtFixedEffort: 'rises',                      magnitude: '+5-15% over 60 min' },
    { confounder: 'Heat (≥25°C / 77°F)',                     effectAtFixedEffort: 'rises',                      magnitude: '+5-20 bpm' },
    { confounder: 'Dehydration (>2% body weight)',           effectAtFixedEffort: 'rises',                      magnitude: '+5-10 bpm' },
    { confounder: 'Sleep deprivation',                       effectAtFixedEffort: 'rises',                      magnitude: '+3-10 bpm' },
    { confounder: 'Caffeine (≥200 mg)',                      effectAtFixedEffort: 'rises',                      magnitude: '+3-7 bpm' },
    { confounder: 'Stress / illness',                        effectAtFixedEffort: 'rises',                      magnitude: '+5-15 bpm' },
    { confounder: 'Beta-blockers',                           effectAtFixedEffort: 'suppresses',                  magnitude: '-20 to -40 bpm; zones invalid' },
    { confounder: 'Cold (<5°C / 41°F)',                      effectAtFixedEffort: 'lower_at_low_intensity',     magnitude: '-3-5 bpm easy' },
    { confounder: 'Altitude (>1500 m / 4900 ft)',            effectAtFixedEffort: 'submax_rises_max_falls',      magnitude: '+5-10 bpm submax' },
    { confounder: 'Fasted vs. fueled',                       effectAtFixedEffort: 'fasted_higher',               magnitude: 'Fasted ~3-5 bpm higher' },
    { confounder: 'Onset lag (intensity step-up)',           effectAtFixedEffort: 'onset_lag',                   magnitude: '30-90 s to plateau; unreliable for short reps' },
  ],
  note: 'HR is a response, not a measure of effort. Coaching by HR alone fails on hot days, short intervals, fatigued sessions, and steep terrain.',
  citations: [
    cite('§1 Why Heart Rate as a Training Metric › Limitations and Confounders', 'Confounder → effect at fixed effort table', 'research', '03'),
  ],
};
