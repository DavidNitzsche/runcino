/**
 * Doctrine — Cross-training substitution and equivalent stimulus.
 *
 * Source: Research/09-cross-training.md
 *
 * Engine consumers:
 *   - coach.adjustForReality (Stage A)  → swap missed run for XT
 *   - coach.prescribeWorkout            → suggest XT substitute on
 *                                         injury or weather flag
 *   - injury_return.ts CROSS_TRAIN_OK   pulls from this catalog */
import { cite, type Cited } from './cite';

// ── Master decision rules ─────────────────────────────────────────

export const XT_DECISION_RULES: Cited<Array<{
  rule: number;
  name: string;
  statement: string;
}>> = {
  value: [
    { rule: 1, name: 'Specificity',  statement: 'Closer biomechanical match = higher run-fitness carryover. Rank: AlterG > Pool running (DWR) > Elliptical > Stair climber > Cycling > Rowing > Swimming.' },
    { rule: 2, name: 'Intensity',    statement: 'Match internal load (HR, RPE), NOT pace or distance.' },
    { rule: 3, name: 'HR offset',     statement: 'In every non-running modality, HR at a given VO2 is LOWER than running. Build sport-specific HR zones.' },
    { rule: 4, name: 'Duration',      statement: 'Use time-equivalent substitution as default (1 min run → 1 min XT) when intensity matched. Exception: cycling typically requires 1.3-1.5× the time of the run it replaces.' },
    { rule: 5, name: 'Load',          statement: 'sRPE = RPE(0-10) × minutes. Use to compare weekly load across mixed running + XT weeks.' },
  ],
  citations: [
    cite('§Master Decision Rules', '5 master decision rules for XT substitution', 'research', '09'),
  ],
};

// ── Carryover matrix ──────────────────────────────────────────────

export type XTModality =
  | 'altergreens' | 'deep_water_running' | 'shallow_water_running'
  | 'elliptical' | 'stair_climber' | 'nordic_ski' | 'hiking_uphill'
  | 'cycling' | 'rowing' | 'swimming' | 'walking' | 'yoga' | 'pilates';

export const XT_CARRYOVER_MATRIX: Cited<Array<{
  modality: XTModality;
  modalityLabel: string;
  biomechSpecificity: 'very_high' | 'high' | 'medium_high' | 'medium' | 'low' | 'very_low';
  aerobicCarryover: 'very_high' | 'high' | 'medium_high' | 'medium' | 'low_medium' | 'low' | 'negligible';
  impactLoad: 'reduced' | 'none' | 'low' | 'low_medium' | 'medium';
  bestUseCase: string;
}>> = {
  value: [
    { modality: 'altergreens',           modalityLabel: 'AlterG (≥80% BW)',          biomechSpecificity: 'very_high',  aerobicCarryover: 'very_high',  impactLoad: 'reduced', bestUseCase: 'Return-to-run, calf/Achilles, stress fx' },
    { modality: 'deep_water_running',    modalityLabel: 'Deep water running (DWR)',  biomechSpecificity: 'high',       aerobicCarryover: 'high',       impactLoad: 'none',    bestUseCase: 'Acute injury, joint pain' },
    { modality: 'shallow_water_running', modalityLabel: 'Shallow water run',         biomechSpecificity: 'high',       aerobicCarryover: 'high',       impactLoad: 'low',     bestUseCase: 'Late-stage rehab, mild impact tolerated' },
    { modality: 'elliptical',            modalityLabel: 'Elliptical',                 biomechSpecificity: 'medium_high', aerobicCarryover: 'high',       impactLoad: 'none',    bestUseCase: 'Tendon/joint sparing, cold weather' },
    { modality: 'stair_climber',         modalityLabel: 'Stair climber',              biomechSpecificity: 'medium',     aerobicCarryover: 'medium_high', impactLoad: 'low_medium', bestUseCase: 'Hill simulation, glute/calf load' },
    { modality: 'nordic_ski',            modalityLabel: 'Nordic ski / SkiErg',       biomechSpecificity: 'medium',     aerobicCarryover: 'high',       impactLoad: 'none',    bestUseCase: 'Winter base, upper-body inclusion' },
    { modality: 'hiking_uphill',         modalityLabel: 'Hiking (uphill)',            biomechSpecificity: 'medium',     aerobicCarryover: 'medium',     impactLoad: 'medium',  bestUseCase: 'Aerobic volume, eccentric quad work' },
    { modality: 'cycling',               modalityLabel: 'Cycling',                    biomechSpecificity: 'low',        aerobicCarryover: 'medium',     impactLoad: 'none',    bestUseCase: 'Volume add, recovery, weather backup' },
    { modality: 'rowing',                modalityLabel: 'Rowing',                     biomechSpecificity: 'low',        aerobicCarryover: 'medium',     impactLoad: 'none',    bestUseCase: 'Posterior chain + aerobic engine' },
    { modality: 'swimming',              modalityLabel: 'Swimming',                   biomechSpecificity: 'very_low',   aerobicCarryover: 'low_medium', impactLoad: 'none',    bestUseCase: 'Recovery, respiratory work, total rest' },
    { modality: 'walking',               modalityLabel: 'Walking',                    biomechSpecificity: 'low',        aerobicCarryover: 'low',        impactLoad: 'low',     bestUseCase: 'Recovery, deload, beginner' },
    { modality: 'yoga',                  modalityLabel: 'Yoga',                       biomechSpecificity: 'very_low',   aerobicCarryover: 'negligible', impactLoad: 'none',    bestUseCase: 'Mobility, recovery, breath' },
    { modality: 'pilates',               modalityLabel: 'Pilates',                    biomechSpecificity: 'low',        aerobicCarryover: 'low',        impactLoad: 'none',    bestUseCase: 'Core, hip stability, posture' },
  ],
  citations: [
    cite('§Cross-Modality Carryover Matrix', '13 modalities × biomechanical specificity / aerobic carryover / impact load / best use case', 'research', '09'),
  ],
};

// ── HR offset by modality ─────────────────────────────────────────

export const XT_HR_OFFSETS: Cited<Array<{
  modality: XTModality;
  hrOffsetVsRunningBpmLow: number;
  hrOffsetVsRunningBpmHigh: number;
  notes: string;
}>> = {
  value: [
    { modality: 'cycling',               hrOffsetVsRunningBpmLow: -15, hrOffsetVsRunningBpmHigh: -5, notes: 'Smaller active muscle mass; seated; no body-weight support cost. Gap shrinks with cycling familiarity.' },
    { modality: 'deep_water_running',    hrOffsetVsRunningBpmLow: -15, hrOffsetVsRunningBpmHigh: -8, notes: 'Immersion bradycardia from hydrostatic pressure, cooler water temp, cardiac preload changes. HRmax in pool ~10-15 bpm lower than land.' },
    { modality: 'rowing',                hrOffsetVsRunningBpmLow: -10, hrOffsetVsRunningBpmHigh: -3, notes: 'Whole-body engagement; HR closer to running than cycling' },
    { modality: 'elliptical',            hrOffsetVsRunningBpmLow: -8,  hrOffsetVsRunningBpmHigh: -3, notes: 'Closer to run HR; reduced impact' },
    { modality: 'stair_climber',         hrOffsetVsRunningBpmLow: -5,  hrOffsetVsRunningBpmHigh: 2,  notes: 'HR may match or slightly exceed running at similar effort' },
  ],
  note: 'Best practice: establish sport-specific zones via a sport-specific test (e.g., 20-min FTP for cycling) rather than reusing run zones.',
  citations: [
    cite('§Cycling + Aqua Jogging + others', 'HR offset by modality. Cycling -5 to -15 bpm; DWR -8 to -15 bpm.', 'research', '09'),
  ],
};

// ── Time-equivalent substitution ──────────────────────────────────

export const XT_TIME_EQUIVALENT_RATIOS: Cited<Array<{
  modality: XTModality;
  timeRatioVsRunLow: number;
  timeRatioVsRunHigh: number;
  notes: string;
}>> = {
  value: [
    { modality: 'altergreens',           timeRatioVsRunLow: 1.0, timeRatioVsRunHigh: 1.0, notes: '1:1 — running motion at reduced body weight' },
    { modality: 'deep_water_running',    timeRatioVsRunLow: 1.0, timeRatioVsRunHigh: 1.0, notes: '1:1 with HR/RPE matching' },
    { modality: 'elliptical',            timeRatioVsRunLow: 1.0, timeRatioVsRunHigh: 1.2, notes: 'Approx 1:1; slight time bonus for matching aerobic load' },
    { modality: 'cycling',               timeRatioVsRunLow: 1.3, timeRatioVsRunHigh: 1.5, notes: 'Cycling typically requires 1.3-1.5× time of replaced run for equal stress' },
    { modality: 'rowing',                timeRatioVsRunLow: 1.0, timeRatioVsRunHigh: 1.3, notes: 'Time-match works at similar HR/RPE' },
    { modality: 'swimming',              timeRatioVsRunLow: 0.5, timeRatioVsRunHigh: 0.8, notes: 'Less time needed for cardiovascular stress; biomechanical carryover poor' },
  ],
  note: 'Common rule: 1 mile of running ≈ 10-15 min moderate cycling for aerobic stress, OR 3-4 miles cycling ≈ 1 mile running. Coarse; HR/RPE matching more reliable.',
  citations: [
    cite('§Time-Equivalency vs. Intensity-Equivalency', 'XT time ratio vs run by modality. Cycling 1.3-1.5×; DWR/elliptical/AlterG 1:1.', 'research', '09'),
  ],
};

// ── Forced layoff fitness preservation ────────────────────────────

export const FORCED_LAYOFF_FITNESS_PRESERVATION: Cited<{
  dwr: { fitnessRetainedWeeksLow: number; fitnessRetainedWeeksHigh: number; protocol: string };
  elliptical: { fitnessRetainedWeeksLow: number; fitnessRetainedWeeksHigh: number; protocol: string };
  cycling: { fitnessRetainedWeeksLow: number; fitnessRetainedWeeksHigh: number; protocol: string };
  generalSubstitutionPct: { low: number; high: number };
}> = {
  value: {
    dwr: {
      fitnessRetainedWeeksLow: 6, fitnessRetainedWeeksHigh: 8,
      protocol: 'DWR 5×/week, alternating 30-min sessions at 90-100% VO2max with 60-min at 70-75% VO2max (Wilber 1996).',
    },
    elliptical: {
      fitnessRetainedWeeksLow: 4, fitnessRetainedWeeksHigh: 6,
      protocol: 'High-cadence sessions matched to run HR; periodic intervals at threshold and VO2max bands.',
    },
    cycling: {
      fitnessRetainedWeeksLow: 4, fitnessRetainedWeeksHigh: 8,
      protocol: 'Endurance + 1-2 quality (FTP intervals + VO2max). Time multiplier 1.3-1.5×.',
    },
    generalSubstitutionPct: { low: 70, high: 100 },
  },
  note: 'Trained runners can maintain VO2max and 2-mile run performance over 6 weeks of DWR-only training. Subsequent reviews confirm fitness can be maintained for up to 6-8 weeks of full DWR substitution.',
  citations: [
    cite('§Maintaining Run Fitness During Forced Layoffs', 'DWR maintains fitness 6-8 wk; elliptical 4-6 wk; cycling 4-8 wk', 'research', '09'),
  ],
};
