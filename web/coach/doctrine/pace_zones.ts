/**
 * Doctrine — Pace zones and VDOT prescription.
 *
 * Source: Research/01-pace-zones-vdot.md
 *
 * The canonical pace-prescription reference. Converts a race time +
 * environmental conditions into prescribed training paces for any
 * workout. Engine consumers:
 *
 *   - coach-principles.ts → PACE_OFFSETS_S_PER_MI (replaced by
 *     DANIELS_PACE_OFFSETS_S_PER_MI here, with citation)
 *   - coach-workouts.ts   → pace target construction
 *   - coach-engine.ts     → applyConstraints pace bands
 *   - pacing.ts           → race-day pace tables
 *
 * Heat/altitude/wind/treadmill/hill adjustments live in this Research
 * doc but the engine extracts them in Stage 2 (`weather.ts`) and Stage
 * 6 (`course.ts`) — keeping pace_zones.ts focused on the pace
 * prescription itself rather than environmental modifiers.
 */
import { cite, type Cited } from './cite';

// ── VDOT formulas (Daniels & Gilbert 1979) ─────────────────────────

/** Daniels & Gilbert oxygen-cost equation. v in m/min, output in
 *  mL O2 / kg / min. Used to derive the VO2 demand of a race velocity. */
export const VDOT_OXYGEN_COST_FORMULA: Cited<{
  expression: string;
  description: string;
}> = {
  value: {
    expression: 'VO2 = -4.60 + 0.182258·v + 0.000104·v²',
    description: 'Quadratic in velocity (m/min). The quadratic term captures the disproportionate cost of faster running (air resistance, biomechanical inefficiency).',
  },
  citations: [
    cite('Jack Daniels VDOT system › How VDOT is calculated', 'VO2 = -4.60 + 0.182258·v + 0.000104·v²', 'research', '01'),
  ],
};

/** Fraction of VO2max sustainable for time t (minutes). Used to
 *  derive VDOT from a race performance. */
export const VDOT_FRACTION_SUSTAINABLE_FORMULA: Cited<{
  expression: string;
  description: string;
}> = {
  value: {
    expression: '%VO2max = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)',
    description: 'Exponential decay; for distance D (meters), time T (minutes): VDOT = VO2_demand(D/T) / fraction(T)',
  },
  citations: [
    cite('Jack Daniels VDOT system › How VDOT is calculated', '%VO2max = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)', 'research', '01'),
  ],
};

// ── VDOT lookup table (Daniels 2014) ───────────────────────────────

/** Race time per distance for each VDOT tier. Times in seconds. The
 *  engine interpolates linearly between tiers to derive VDOT from any
 *  race time. */
export const VDOT_LOOKUP_TABLE: Cited<{
  vdot: number;
  /** All times in seconds. */
  mileS: number;
  km3S: number;
  km5S: number;
  km10S: number;
  km15S: number;
  halfS: number;
  marathonS: number;
}[]> = {
  value: [
    // Reproduces Daniels 2014 published tables, rounded to nearest second.
    { vdot: 30, mileS: 510,  km3S: 1047, km5S: 1840, km10S: 3826, km15S: 5894, halfS: 8464,  marathonS: 17357 },
    { vdot: 32, mileS: 481,  km3S: 990,  km5S: 1745, km10S: 3626, km15S: 5587, halfS: 8029,  marathonS: 16499 },
    { vdot: 34, mileS: 456,  km3S: 938,  km5S: 1659, km10S: 3446, km15S: 5311, halfS: 7636,  marathonS: 15723 },
    { vdot: 36, mileS: 434,  km3S: 893,  km5S: 1582, km10S: 3284, km15S: 5063, halfS: 7279,  marathonS: 15019 },
    { vdot: 38, mileS: 414,  km3S: 852,  km5S: 1512, km10S: 3137, km15S: 4838, halfS: 6955,  marathonS: 14375 },
    { vdot: 40, mileS: 395,  km3S: 815,  km5S: 1448, km10S: 3003, km15S: 4633, halfS: 6659,  marathonS: 13785 },
    { vdot: 42, mileS: 379,  km3S: 782,  km5S: 1389, km10S: 2881, km15S: 4446, halfS: 6387,  marathonS: 13243 },
    { vdot: 44, mileS: 363,  km3S: 751,  km5S: 1335, km10S: 2769, km15S: 4274, halfS: 6137,  marathonS: 12746 },
    { vdot: 45, mileS: 356,  km3S: 737,  km5S: 1310, km10S: 2716, km15S: 4193, halfS: 6020,  marathonS: 12506 },
    { vdot: 46, mileS: 349,  km3S: 724,  km5S: 1285, km10S: 2665, km15S: 4114, halfS: 5907,  marathonS: 12279 },
    { vdot: 48, mileS: 336,  km3S: 696,  km5S: 1239, km10S: 2570, km15S: 3968, halfS: 5701,  marathonS: 11849 },
    { vdot: 50, mileS: 324,  km3S: 671,  km5S: 1197, km10S: 2481, km15S: 3826, halfS: 5495,  marathonS: 11449 },
    { vdot: 52, mileS: 313,  km3S: 647,  km5S: 1157, km10S: 2399, km15S: 3698, halfS: 5311,  marathonS: 11076 },
    { vdot: 54, mileS: 303,  km3S: 625,  km5S: 1120, km10S: 2322, km15S: 3579, halfS: 5140,  marathonS: 10727 },
    { vdot: 55, mileS: 298,  km3S: 614,  km5S: 1102, km10S: 2286, km15S: 3524, halfS: 5058,  marathonS: 10561 },
    { vdot: 56, mileS: 293,  km3S: 604,  km5S: 1085, km10S: 2251, km15S: 3470, halfS: 4979,  marathonS: 10400 },
    { vdot: 58, mileS: 284,  km3S: 585,  km5S: 1053, km10S: 2184, km15S: 3369, halfS: 4830,  marathonS: 10094 },
    { vdot: 60, mileS: 276,  km3S: 567,  km5S: 1023, km10S: 2122, km15S: 3275, halfS: 4689,  marathonS: 9805  },
    { vdot: 62, mileS: 269,  km3S: 551,  km5S: 994,  km10S: 2063, km15S: 3187, halfS: 4558,  marathonS: 9534  },
    { vdot: 64, mileS: 262,  km3S: 535,  km5S: 967,  km10S: 2008, km15S: 3103, halfS: 4434,  marathonS: 9278  },
    { vdot: 65, mileS: 258,  km3S: 528,  km5S: 954,  km10S: 1981, km15S: 3063, halfS: 4375,  marathonS: 9155  },
    { vdot: 66, mileS: 255,  km3S: 521,  km5S: 942,  km10S: 1955, km15S: 3024, halfS: 4316,  marathonS: 9036  },
    { vdot: 68, mileS: 249,  km3S: 507,  km5S: 918,  km10S: 1906, km15S: 2949, halfS: 4205,  marathonS: 8807  },
    { vdot: 70, mileS: 243,  km3S: 495,  km5S: 895,  km10S: 1859, km15S: 2878, halfS: 4101,  marathonS: 8590  },
    { vdot: 72, mileS: 238,  km3S: 482,  km5S: 874,  km10S: 1816, km15S: 2811, halfS: 4002,  marathonS: 8384  },
    { vdot: 74, mileS: 232,  km3S: 471,  km5S: 853,  km10S: 1774, km15S: 2748, halfS: 3908,  marathonS: 8189  },
    { vdot: 75, mileS: 230,  km3S: 465,  km5S: 843,  km10S: 1754, km15S: 2718, halfS: 3863,  marathonS: 8095  },
    { vdot: 76, mileS: 227,  km3S: 460,  km5S: 834,  km10S: 1735, km15S: 2688, halfS: 3819,  marathonS: 8003  },
    { vdot: 78, mileS: 223,  km3S: 450,  km5S: 815,  km10S: 1698, km15S: 2633, halfS: 3733,  marathonS: 7827  },
    { vdot: 80, mileS: 218,  km3S: 441,  km5S: 798,  km10S: 1662, km15S: 2581, halfS: 3654,  marathonS: 7658  },
    { vdot: 82, mileS: 214,  km3S: 432,  km5S: 781,  km10S: 1629, km15S: 2531, halfS: 3579,  marathonS: 7497  },
    { vdot: 84, mileS: 210,  km3S: 424,  km5S: 766,  km10S: 1598, km15S: 2484, halfS: 3507,  marathonS: 7344  },
    { vdot: 85, mileS: 208,  km3S: 420,  km5S: 758,  km10S: 1583, km15S: 2461, halfS: 3473,  marathonS: 7271  },
  ],
  note: 'VDOT range ~30 (beginner) to 85+ (elite). Linear interpolation between rows for finer resolution.',
  citations: [
    cite('VDOT lookup table', 'Race times at each VDOT tier, computed from the Daniels & Gilbert equations. (Values reproduce Daniels\' published tables; rounded to nearest second.)', 'research', '01'),
  ],
};

/** When VDOT prediction is reliable. */
export const VDOT_RELIABILITY_RULES: Cited<{
  rules: Array<{ scenario: string; reliability: 'high' | 'lower' | 'do_not_use' | 'apply_correction' }>;
  rulesOfThumb: string[];
}> = {
  value: {
    rules: [
      { scenario: 'Race distance 1500m–half marathon, ≤6 weeks old, well-paced', reliability: 'high' },
      { scenario: 'Marathon time → predicting shorter distances', reliability: 'high' },
      { scenario: '5K time → predicting marathon (without marathon-specific training)', reliability: 'lower' },
      { scenario: 'Race run in heat, on hills, or as solo time trial', reliability: 'apply_correction' },
      { scenario: 'Race aborted or paced unevenly', reliability: 'do_not_use' },
    ],
    rulesOfThumb: [
      'Predictions are most accurate when the target distance is within 2–4× the input race distance.',
      'Marathon-specific fitness lags VDOT by ~1.5–3 VDOT points if the runner has not done marathon-specific endurance work.',
    ],
  },
  citations: [
    cite('Jack Daniels VDOT system › When VDOT works and when it doesn\'t', 'Predictions are most accurate when the target distance is within 2-4× the input race distance', 'research', '01'),
  ],
};

// ── Daniels training paces ─────────────────────────────────────────

export type DanielsPace = 'E' | 'M' | 'T' | 'I' | 'R';

/** Daniels' five canonical training paces with their physiological
 *  intensities and purposes. */
export const DANIELS_PACES: Cited<Record<DanielsPace, {
  name: string;
  vo2maxPctLow: number;
  vo2maxPctHigh: number;
  hrMaxPctLow: number;
  hrMaxPctHigh: number;
  vVO2maxPctLow: number;
  vVO2maxPctHigh: number;
  purpose: string;
}>> = {
  value: {
    E: {
      name: 'Easy',
      vo2maxPctLow: 59, vo2maxPctHigh: 74,
      hrMaxPctLow: 65, hrMaxPctHigh: 78,
      vVO2maxPctLow: 59, vVO2maxPctHigh: 74,
      purpose: 'Aerobic base, recovery, capillarization, mitochondrial density',
    },
    M: {
      name: 'Marathon',
      vo2maxPctLow: 75, vo2maxPctHigh: 84,
      hrMaxPctLow: 80, hrMaxPctHigh: 85,
      vVO2maxPctLow: 75, vVO2maxPctHigh: 84,
      purpose: 'Marathon-specific muscular endurance and fueling',
    },
    T: {
      name: 'Threshold',
      vo2maxPctLow: 83, vo2maxPctHigh: 88,
      hrMaxPctLow: 88, hrMaxPctHigh: 92,
      vVO2maxPctLow: 86, vVO2maxPctHigh: 88,
      purpose: 'Lactate threshold elevation, sustained tempo',
    },
    I: {
      name: 'Interval',
      vo2maxPctLow: 95, vo2maxPctHigh: 100,
      hrMaxPctLow: 95, hrMaxPctHigh: 100,
      vVO2maxPctLow: 95, vVO2maxPctHigh: 100,
      purpose: 'VO2max ceiling, oxygen-delivery system',
    },
    R: {
      name: 'Repetition',
      vo2maxPctLow: 105, vo2maxPctHigh: 120,
      hrMaxPctLow: 0, hrMaxPctHigh: 0,
      vVO2maxPctLow: 105, vVO2maxPctHigh: 120,
      purpose: 'Running economy, neuromuscular speed',
    },
  },
  note: 'HR is not a useful target for R pace (efforts are too short).',
  citations: [
    cite('Daniels training paces (E, M, T, I, R)', 'Each pace targets a distinct adaptation. Definitions, percentage of VDOT-derived velocity, and dosing rules', 'research', '01'),
  ],
};

/** Approximate Daniels pace offsets relative to a runner's race
 *  performances, in seconds per mile. Replaces the uncited
 *  `PACE_OFFSETS_S_PER_MI` previously in coach-principles.ts.
 *
 *  Polarized distribution Daniels recommends: 70-80% E, 10-15% M+T,
 *  10-15% I+R. */
export const DANIELS_PACE_OFFSETS_S_PER_MI: Cited<Record<DanielsPace, {
  /** Anchor reference: 'MP' (marathon pace), '5K' (5K race pace),
   *  'HM' (half-marathon pace), 'mile' (mile race pace). */
  anchor: 'MP' | '5K' | 'HM' | 'mile' | 'race';
  /** Offset in seconds per mile. Positive = slower than anchor. */
  offsetSPerMi: { low: number; high: number };
  note: string;
}>> = {
  value: {
    E: {
      anchor: 'MP',
      offsetSPerMi: { low: 60, high: 90 },
      note: 'MP + 60-90 sec/mi (or 5K pace + 90-150 sec/mi).',
    },
    M: {
      anchor: 'MP',
      offsetSPerMi: { low: 0, high: 0 },
      note: 'Marathon race pace itself.',
    },
    T: {
      anchor: 'HM',
      offsetSPerMi: { low: -30, high: 0 },
      note: 'Half-marathon pace to 15K pace. Faster runners use HM, slower runners use 15K.',
    },
    I: {
      anchor: '5K',
      offsetSPerMi: { low: -10, high: 0 },
      note: '~3K to 5K race pace (often 3K race pace).',
    },
    R: {
      anchor: 'mile',
      offsetSPerMi: { low: 0, high: 0 },
      note: '~Mile race pace, or ~6 sec per 400m faster than I pace.',
    },
  },
  citations: [
    cite('Daniels training paces › Pace conversion from a race time', 'E: ~MP + 60-90 sec/mi (or 5K pace + 90-150 sec/mi). T: ~half-marathon pace to 15K pace. I: ~3K to 5K race pace. R: ~mile race pace, or ~6 sec/400m faster than I.', 'research', '01'),
  ],
};

// ── Daniels dosing rules ───────────────────────────────────────────

/** Per-workout and per-week volume caps, plus rep length and recovery
 *  rules. The engine reads these to constrain workout prescription. */
export const DANIELS_DOSING_RULES: Cited<Record<DanielsPace, {
  singleWorkoutCap: string;
  weeklyCap: string;
  repLengthRange: string;
  recoveryBetweenReps: string;
}>> = {
  value: {
    E: {
      singleWorkoutCap: 'None',
      weeklyCap: '70-80% of weekly volume',
      repLengthRange: 'n/a',
      recoveryBetweenReps: 'n/a',
    },
    M: {
      singleWorkoutCap: 'The lesser of 18 mi or 20% of weekly mi',
      weeklyCap: 'n/a',
      repLengthRange: '4-18 mi',
      recoveryBetweenReps: 'n/a',
    },
    T: {
      singleWorkoutCap: '10% of weekly mi (typically 4-6 mi at T)',
      weeklyCap: '10% of weekly mi',
      repLengthRange: '5-15 min reps; 20-60 min cumulative',
      recoveryBetweenReps: '1 min jog per 5 min T',
    },
    I: {
      singleWorkoutCap: '8% of weekly mi (max 10K cumulative)',
      weeklyCap: '8% of weekly mi',
      repLengthRange: '3-5 min (max 11 min)',
      recoveryBetweenReps: 'Equal duration jog (≥0.5× rep)',
    },
    R: {
      singleWorkoutCap: '5% of weekly mi (max 8K cumulative)',
      weeklyCap: '5% of weekly mi',
      repLengthRange: '200-600m, ≤2 min',
      recoveryBetweenReps: '2-3× duration of rep',
    },
  },
  citations: [
    cite('Daniels training paces › Dosing rules — Daniels\' caps', 'Single-workout cap, weekly cap, rep length range, recovery between reps for E/M/T/I/R', 'research', '01'),
  ],
};

// ── Pfitzinger zones (Pfitzinger & Douglas 2019) ────────────────────

export type PfitzingerZone =
  | 'recovery' | 'general_aerobic' | 'endurance_long' | 'marathon_pace'
  | 'lactate_threshold' | 'vo2max' | 'speed';

export const PFITZINGER_ZONES: Cited<Record<PfitzingerZone, {
  paceAnchor: string;
  hrMaxPctLow: number | null;
  hrMaxPctHigh: number | null;
  hrrPctLow: number | null;
  hrrPctHigh: number | null;
  typicalUse: string;
}>> = {
  value: {
    recovery: {
      paceAnchor: 'MP + ≥3:00/mi (very easy)',
      hrMaxPctLow: 0,  hrMaxPctHigh: 76,
      hrrPctLow: 0,    hrrPctHigh: 70,
      typicalUse: '4-7 mi the day after a hard session',
    },
    general_aerobic: {
      paceAnchor: 'MP + 15-25%',
      hrMaxPctLow: 70, hrMaxPctHigh: 81,
      hrrPctLow: 62,   hrrPctHigh: 75,
      typicalUse: 'Standard 6-10 mi mid-week run',
    },
    endurance_long: {
      paceAnchor: 'MP + 10-20%',
      hrMaxPctLow: 74, hrMaxPctHigh: 84,
      hrrPctLow: 65,   hrrPctHigh: 78,
      typicalUse: '11+ mi medium-long and long runs',
    },
    marathon_pace: {
      paceAnchor: 'Goal MP exactly',
      hrMaxPctLow: 80, hrMaxPctHigh: 85,
      hrrPctLow: 73,   hrrPctHigh: 84,
      typicalUse: 'MP segments inside long runs (5-14 mi)',
    },
    lactate_threshold: {
      paceAnchor: '15K to half-marathon race pace (slower runners use 15K, faster use HM)',
      hrMaxPctLow: 82, hrMaxPctHigh: 91,
      hrrPctLow: 77,   hrrPctHigh: 88,
      typicalUse: '20-60 min continuous tempo',
    },
    vo2max: {
      paceAnchor: '5K race pace (5K-3K)',
      hrMaxPctLow: 93, hrMaxPctHigh: 98,
      hrrPctLow: 91,   hrrPctHigh: 98,
      typicalUse: '600-1600m repeats, 2-4 min recovery',
    },
    speed: {
      paceAnchor: 'Mile race pace and faster',
      hrMaxPctLow: null, hrMaxPctHigh: null,
      hrrPctLow: null,   hrrPctHigh: null,
      typicalUse: '100-300m strides, neuromuscular',
    },
  },
  note: 'Slower runners (≥4-hour marathon) anchor LT to 15K race pace; faster runners anchor to half-marathon pace. Pfitzinger long-run pace is faster than Daniels E pace in absolute terms — closer to mid-E to low-M.',
  citations: [
    cite('Pfitzinger pace ranges', 'Pete Pfitzinger ("Advanced Marathoning," with Scott Douglas) uses a marathon-pace-anchored system rather than a VDOT lookup. Six primary zones plus speedwork.', 'research', '01'),
  ],
};

// ── Hansons pace offsets ───────────────────────────────────────────

export type HansonsPace = 'recovery' | 'easy' | 'long' | 'strength' | 'tempo' | 'speed';

/** All Hansons paces are offsets from goal marathon pace.
 *  Distinctive features: 16-mile long-run cap (cumulative fatigue),
 *  Strength = MP - 10 sec/mi for 6-10 mi after warmup, no Daniels
 *  equivalent. */
export const HANSONS_PACE_OFFSETS_S_PER_MI: Cited<Record<HansonsPace, {
  offsetFromMpSPerMi: { low: number; high: number };
  notes: string;
}>> = {
  value: {
    recovery: {
      offsetFromMpSPerMi: { low: 90, high: 120 },
      notes: 'Minimum allowable easy pace.',
    },
    easy: {
      offsetFromMpSPerMi: { low: 60, high: 90 },
      notes: 'Routine mileage.',
    },
    long: {
      offsetFromMpSPerMi: { low: 30, high: 60 },
      notes: 'Capped at 16 mi (cumulative fatigue principle).',
    },
    strength: {
      offsetFromMpSPerMi: { low: -10, high: -10 },
      notes: 'Long marathon-pace work on tired legs. 6-10 mi at MP-10/mi after warm-up. No Daniels equivalent.',
    },
    tempo: {
      offsetFromMpSPerMi: { low: 0, high: 0 },
      notes: '5-10 mi at goal MP exactly.',
    },
    speed: {
      offsetFromMpSPerMi: { low: -120, high: -25 },
      notes: 'Early plan: 5K pace; late plan: ~MP - 25 sec/mi or 10K pace. 600m-1600m repeats. Fixed gap doesn\'t scale precisely for very fast runners.',
    },
  },
  citations: [
    cite('Hansons pace methodology', 'The Hansons-Brooks Distance Project method (Keith and Kevin Hanson, Luke Humphrey) is built around a single goal-marathon pace. All other paces are offsets from MP.', 'research', '01'),
  ],
};

/** Daniels' Easy-pace offset from marathon pace, in s/mi. Daniels
 *  defines E as a deliberately wide effort band, 60-90 s/mi slower than
 *  M; the engine anchors the E-band center at +75 (the band midpoint).
 *  @research Research/01 §Daniels training paces (Easy). */
export const DANIELS_E_OFFSET_S_PER_MI: Cited<{ low: number; center: number; high: number }> = {
  value: { low: 60, center: 75, high: 90 },
  citations: [
    cite('Daniels training paces › Easy (E)', 'Easy running is 60-90 sec/mi slower than marathon pace.', 'research', '01'),
  ],
};

// ── Pace zone width and lock-in rules ──────────────────────────────

/** Tolerance window per pace zone, in sec/mi (or sec/rep where the
 *  effort is interval-based). The harder the workout, the tighter the
 *  lock. */
export const PACE_ZONE_WIDTH: Cited<Record<DanielsPace, {
  rangeWidthSPerMi: number;
  lockToSinglePace: boolean;
  lockNote: string;
}>> = {
  value: {
    E: { rangeWidthSPerMi: 30, lockToSinglePace: false, lockNote: 'Never. Prescribe a window.' },
    M: { rangeWidthSPerMi: 5,  lockToSinglePace: true,  lockNote: 'Lock for race-simulation; window for general MP segments.' },
    T: { rangeWidthSPerMi: 3,  lockToSinglePace: true,  lockNote: 'Narrow window required for adaptation.' },
    I: { rangeWidthSPerMi: 3,  lockToSinglePace: true,  lockNote: 'Lock by interval time, not by per-mile pace.' },
    R: { rangeWidthSPerMi: 2,  lockToSinglePace: true,  lockNote: 'Lock by rep time. ±1-2 sec.' },
  },
  note: 'The harder the workout, the tighter the lock. Easy work is effort-based; threshold and faster work is pace-based; all work uses HR as a guardrail.',
  citations: [
    cite('Pace zone width and lock-in rules', 'Default range (sec/mi) per pace + Lock to specific pace? per Daniels zone', 'research', '01'),
  ],
};

/** Situations that change the pace-prescription style. */
export const PACE_LOCK_BY_SITUATION: Cited<Array<{
  situation: string;
  prescriptionStyle: 'wide_range_effort_anchored' | 'lock_to_single_pace' | 'narrow_window' | 'lock_to_lap_split' | 'use_hr_or_effort' | 'environmental_adjustment';
}>> = {
  value: [
    { situation: 'Easy day, base mileage',           prescriptionStyle: 'wide_range_effort_anchored' },
    { situation: 'Marathon-pace dress rehearsal',    prescriptionStyle: 'lock_to_single_pace' },
    { situation: 'Tempo / threshold session',        prescriptionStyle: 'narrow_window' },
    { situation: 'VO2max intervals on track',        prescriptionStyle: 'lock_to_lap_split' },
    { situation: 'Hilly course',                     prescriptionStyle: 'use_hr_or_effort' },
    { situation: 'Trail / soft surface',             prescriptionStyle: 'use_hr_or_effort' },
    { situation: 'Heat, humidity, wind, altitude',   prescriptionStyle: 'environmental_adjustment' },
  ],
  citations: [
    cite('Pace zone width and lock-in rules › When to lock to a specific pace vs. give a range', 'Situation → pace prescription style decision table', 'research', '01'),
  ],
};

// ── Recalibration triggers ─────────────────────────────────────────

/** When the engine should retest VDOT and update zones. */
export const VDOT_RECALIBRATION_TRIGGERS: Cited<Array<{
  trigger: string;
  action: string;
  vdotDelta?: number;
}>> = {
  value: [
    { trigger: 'New race result (any distance, all-out, well-paced, ≤2 weeks old)',  action: 'Update VDOT from race' },
    { trigger: 'Tempo runs feel notably easier at the same target pace',             action: 'Add 1 VDOT point; re-derive paces; field-test within 2 weeks',  vdotDelta: +1 },
    { trigger: 'Last race beat predicted time by >30 sec/mi',                        action: 'Add 2-3 VDOT points; field-test',                                  vdotDelta: +2.5 },
    { trigger: 'HR is 5+ bpm lower at the same workout pace, sustained ≥2 weeks',    action: '+1 VDOT, field-test',                                              vdotDelta: +1 },
    { trigger: 'Tempo runs unexpectedly hard for ≥2 sessions; HR elevated',          action: '-1 to -2 VDOT; check overtraining',                                vdotDelta: -1.5 },
    { trigger: 'Returning from layoff ≥2 weeks',                                     action: 'Drop ~3-5 VDOT; rebuild',                                          vdotDelta: -4 },
    { trigger: 'Returning from layoff ≥6 weeks',                                     action: 'Drop 5-8 VDOT; rebuild from base',                                 vdotDelta: -6.5 },
    { trigger: 'Calendar trigger: 6-8 weeks since last test or race',                action: 'Field-test' },
  ],
  citations: [
    cite('How to recalibrate paces › Triggers to retest', 'Retest VDOT/threshold and update zones immediately if any of these are true', 'research', '01'),
  ],
};

/** Field-test protocols when no recent race exists. */
export const FIELD_TEST_PROTOCOLS: Cited<Array<{
  test: string;
  protocol: string;
  output: string;
}>> = {
  value: [
    {
      test: '30-min time trial',
      protocol: 'After 15-min warm-up: run as far as possible in 30 min (flat course or track). Average pace of last 20 min ≈ LT pace. HR last 20 min ≈ LT HR.',
      output: 'T pace; LTHR',
    },
    {
      test: '5K time trial (solo)',
      protocol: 'Same logistics as a race. Treat as race result, but VDOT may under-read by 1-2 points (no competition).',
      output: 'VDOT (apply +1 correction)',
    },
    {
      test: 'Cooper test',
      protocol: '12-min run for distance. Coarse VO2max estimate.',
      output: 'VO2max; less accurate than VDOT',
    },
    {
      test: '3K + 5K combined',
      protocol: 'Two time trials on separate days. Take VDOT from the better one.',
      output: 'VDOT',
    },
    {
      test: 'Lactate threshold (lab)',
      protocol: 'Graded treadmill protocol; gold standard if available.',
      output: 'LT velocity; LTHR',
    },
  ],
  citations: [
    cite('How to recalibrate paces › Field-test protocols', 'When no recent race exists, use a field test to derive VDOT/LT pace', 'research', '01'),
  ],
};

/** Marathon-specific correction: VDOT derived from a short race
 *  (5K/10K) over-predicts marathon fitness if the runner hasn't done
 *  marathon-specific work. Subtract the correction before prescribing
 *  marathon pace. */
export const MARATHON_VDOT_CORRECTION: Cited<{
  subtractVdotPoints: number;
  appliesWhen: string;
  blockDefinition: string;
}> = {
  value: {
    subtractVdotPoints: 1.5,
    appliesWhen: 'Most recent race is 5K or 10K AND no marathon-specific block in last 6 weeks',
    blockDefinition: '≥6 weeks of long runs ≥18 mi and MP work ≥6 mi',
  },
  citations: [
    cite('Marathon-specific correction', 'Marathon performance is more sensitive to long-run training and fueling than VDOT alone. … subtract 1.5 VDOT points for marathon-pace prescription if they have not done a marathon-specific block', 'research', '01'),
  ],
};

// ── Pace prescription by workout type ──────────────────────────────

export type WorkoutPaceType =
  | 'recovery_jog' | 'easy_aerobic' | 'long_general' | 'long_with_mp_segments'
  | 'marathon_pace_tempo' | 'steady_state_subthreshold'
  | 'tempo_continuous' | 'cruise_intervals' | 'pace_10k'
  | 'vo2max_intervals' | 'long_vo2max_intervals'
  | 'hill_repeats_short' | 'hill_repeats_long'
  | 'repetitions_200_400' | 'strides' | 'race_pace_simulation';

/** Single-source-of-truth lookup: workout type → pace zone + effort
 *  target. Used by the engine to prescribe a pace anchor for any named
 *  workout. */
export const WORKOUT_PACE_PRESCRIPTION: Cited<Record<WorkoutPaceType, {
  danielsZone: string;
  paceAnchor: string;
  rpeLow: number;
  rpeHigh: number;
  hrMaxPctLow: number | null;
  hrMaxPctHigh: number | null;
  typicalDurationOrVolume: string;
}>> = {
  value: {
    recovery_jog: {
      danielsZone: 'E (slow)',          paceAnchor: 'E pace + 30 sec/mi',
      rpeLow: 2, rpeHigh: 3,            hrMaxPctLow: 65, hrMaxPctHigh: 72,
      typicalDurationOrVolume: '20-45 min',
    },
    easy_aerobic: {
      danielsZone: 'E',                 paceAnchor: 'E pace',
      rpeLow: 3, rpeHigh: 4,            hrMaxPctLow: 70, hrMaxPctHigh: 78,
      typicalDurationOrVolume: '30-90 min',
    },
    long_general: {
      danielsZone: 'E',                 paceAnchor: 'E pace, optionally fading to M last 20%',
      rpeLow: 4, rpeHigh: 5,            hrMaxPctLow: 70, hrMaxPctHigh: 82,
      typicalDurationOrVolume: '90 min - 3 hr',
    },
    long_with_mp_segments: {
      danielsZone: 'E + M',             paceAnchor: 'E base, then MP for 4-14 mi',
      rpeLow: 4, rpeHigh: 7,            hrMaxPctLow: 70, hrMaxPctHigh: 85,
      typicalDurationOrVolume: '2-3 hr',
    },
    marathon_pace_tempo: {
      danielsZone: 'M',                 paceAnchor: 'MP',
      rpeLow: 6, rpeHigh: 7,            hrMaxPctLow: 80, hrMaxPctHigh: 85,
      typicalDurationOrVolume: '5-14 mi',
    },
    steady_state_subthreshold: {
      danielsZone: 'T (slow end)',      paceAnchor: 'MP - 10 to MP - 20 sec/mi',
      rpeLow: 6, rpeHigh: 7,            hrMaxPctLow: 83, hrMaxPctHigh: 87,
      typicalDurationOrVolume: '30-60 min',
    },
    tempo_continuous: {
      danielsZone: 'T',                 paceAnchor: 'T pace',
      rpeLow: 7, rpeHigh: 8,            hrMaxPctLow: 88, hrMaxPctHigh: 92,
      typicalDurationOrVolume: '20-40 min',
    },
    cruise_intervals: {
      danielsZone: 'T',                 paceAnchor: 'T pace',
      rpeLow: 7, rpeHigh: 8,            hrMaxPctLow: 88, hrMaxPctHigh: 92,
      typicalDurationOrVolume: '4-6 × 1mi @ T, 1 min jog',
    },
    pace_10k: {
      danielsZone: 'between T/I',       paceAnchor: '10K race pace',
      rpeLow: 8, rpeHigh: 8,            hrMaxPctLow: 90, hrMaxPctHigh: 93,
      typicalDurationOrVolume: '3-5 × 2km',
    },
    vo2max_intervals: {
      danielsZone: 'I',                 paceAnchor: 'I pace (~3K-5K pace)',
      rpeLow: 8, rpeHigh: 9,            hrMaxPctLow: 95, hrMaxPctHigh: 100,
      typicalDurationOrVolume: '4-6 × 800m or 5 × 1000m',
    },
    long_vo2max_intervals: {
      danielsZone: 'I',                 paceAnchor: 'I pace',
      rpeLow: 9, rpeHigh: 9,            hrMaxPctLow: 95, hrMaxPctHigh: 100,
      typicalDurationOrVolume: '4 × 1200m or 3 × 1mi',
    },
    hill_repeats_short: {
      danielsZone: 'R/I effort',        paceAnchor: 'Effort-based; flat-equiv ~mile pace',
      rpeLow: 9, rpeHigh: 9,            hrMaxPctLow: null, hrMaxPctHigh: null,
      typicalDurationOrVolume: '6-12 × 60-90 sec',
    },
    hill_repeats_long: {
      danielsZone: 'I effort',          paceAnchor: 'Effort-based; ~5K pace',
      rpeLow: 8, rpeHigh: 9,            hrMaxPctLow: 92, hrMaxPctHigh: 98,
      typicalDurationOrVolume: '4-6 × 3-5 min',
    },
    repetitions_200_400: {
      danielsZone: 'R',                 paceAnchor: 'R pace',
      rpeLow: 9, rpeHigh: 9,            hrMaxPctLow: null, hrMaxPctHigh: null,
      typicalDurationOrVolume: '8 × 200m or 6 × 400m',
    },
    strides: {
      danielsZone: 'R',                 paceAnchor: 'R pace, controlled',
      rpeLow: 8, rpeHigh: 8,            hrMaxPctLow: null, hrMaxPctHigh: null,
      typicalDurationOrVolume: '4-8 × 20 sec, full rec',
    },
    race_pace_simulation: {
      danielsZone: 'race pace',         paceAnchor: 'Goal race pace',
      rpeLow: 6, rpeHigh: 9,            hrMaxPctLow: null, hrMaxPctHigh: null,
      typicalDurationOrVolume: 'Event-specific',
    },
  },
  citations: [
    cite('Pace prescription by workout type', 'Single-source-of-truth lookup: workout type → pace zone → effort target', 'research', '01'),
  ],
};

// ── Cross-system equivalence ───────────────────────────────────────

/** Conceptual mapping across the four major pace systems. Used when
 *  translating a runner from one program to another. */
export const PACE_SYSTEM_CROSSWALK: Cited<Array<{
  concept: string;
  daniels: string;
  pfitzinger: string;
  mcMillanZone: string;
  hansons: string;
}>> = {
  value: [
    { concept: 'Recovery',           daniels: 'E (slow end)', pfitzinger: 'Recovery',          mcMillanZone: '1',                hansons: 'Recovery'    },
    { concept: 'Easy / aerobic',     daniels: 'E',            pfitzinger: 'General Aerobic',   mcMillanZone: '2',                hansons: 'Easy'        },
    { concept: 'Long-run pace',      daniels: 'E (mid-high)', pfitzinger: 'Endurance / Long', mcMillanZone: '2 (upper)',         hansons: 'Long'        },
    { concept: 'Marathon pace',      daniels: 'M',            pfitzinger: 'Marathon Pace',    mcMillanZone: '3 (upper) / 4 lower', hansons: 'Tempo / MP'},
    { concept: 'Tempo / threshold',  daniels: 'T',            pfitzinger: 'Lactate Threshold',mcMillanZone: '4',                hansons: '(no direct equiv)' },
    { concept: 'Cruise intervals',   daniels: 'T (broken)',   pfitzinger: 'LT intervals',     mcMillanZone: '5',                hansons: 'Strength'    },
    { concept: '10K pace',           daniels: 'between T & I',pfitzinger: '(not a zone)',     mcMillanZone: '5-6 boundary',     hansons: '(not a zone)' },
    { concept: 'VO2max / 5K',        daniels: 'I',            pfitzinger: 'VO2max',           mcMillanZone: '6',                hansons: 'Speed'       },
    { concept: 'Repetition / mile',  daniels: 'R',            pfitzinger: 'Speed / R',        mcMillanZone: '6 (top)',          hansons: 'Speed (top)' },
  ],
  citations: [
    cite('Cross-system conversions', 'Pace ranges across systems for the same fitness level. Use this table to translate when a runner moves between programs.', 'research', '01'),
  ],
};

/** Riegel race-time equivalency. Used by McMillan and is the basis
 *  for race-prediction formulas in race_prediction.ts (Stage 1, next).
 *  Recorded here because pace_zones.ts uses it for cross-distance
 *  pace anchoring. */
export const RIEGEL_FATIGUE_EXPONENT: Cited<{
  k: number;
  expression: string;
  marathonAdjustment: string;
}> = {
  value: {
    k: 1.06,
    expression: 'T2 = T1 · (D2 / D1)^k',
    marathonAdjustment: 'McMillan flattens k slightly toward longer distances (some sources cite ~1.05 for marathon predictions) to correct Riegel\'s tendency to over-predict at long range.',
  },
  citations: [
    cite('McMillan pace methodology › Calculator engine', 'McMillan uses a modified Riegel formula for race-time equivalency: T2 = T1 · (D2 / D1)^k with k ≈ 1.06 (Riegel\'s "fatigue exponent")', 'research', '01'),
  ],
};
