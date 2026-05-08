/**
 * Doctrine — Wearable data interpretation.
 *
 * Source: Research/15-wearable-data.md
 *
 * Engine consumers:
 *   - coach.assessReadiness    → CTL_ATL_TSB_BANDS, ILLNESS_EARLY_SIGNALS
 *   - coach-state.ts            → TRAINING_LOAD_METRICS for state
 *                                 aggregation
 *   - profile / settings UI    → DEVICE_SOURCE_OF_TRUTH */
import { cite, type Cited } from './cite';

// ── Training load metrics ─────────────────────────────────────────

export const TRAINING_LOAD_METRICS: Cited<{
  trimp: { formula: string; useCase: string };
  tss: { formula: string; useCase: string };
  acwr: { acuteDays: number; chronicDays: number; sweetSpotLow: number; sweetSpotHigh: number; dangerZoneAbove: number };
  monotony: { definition: string; thresholdHigh: number };
  strain: { formula: string; useCase: string };
}> = {
  value: {
    trimp: {
      formula: 'TRIMP (Edwards) = sum of (HR zone × min in zone × zone weight). Banister: TRIMP = duration × (avg HR fraction) × e^(b × HR fraction).',
      useCase: 'Bayesian alternative to TSS for HR-only data. Strong correlation with internal training load.',
    },
    tss: {
      formula: 'TSS = duration × (NGP / threshold pace)² × 100 / 3600 (running adaptation). 1 hr at threshold = 100 TSS.',
      useCase: 'Pace-based load metric. Most useful when GPS pace is reliable.',
    },
    acwr: {
      acuteDays: 7, chronicDays: 28,
      sweetSpotLow: 0.8, sweetSpotHigh: 1.3,
      dangerZoneAbove: 1.5,
    },
    monotony: {
      definition: 'Monotony = mean weekly load / SD of daily load. High monotony (>2.0) means every day is similar — no recovery rhythm.',
      thresholdHigh: 2.0,
    },
    strain: {
      formula: 'Strain = weekly load × monotony',
      useCase: 'Combined high-load + low-variation signal predicts illness/injury risk',
    },
  },
  note: 'EWMA (exponentially weighted moving average) ACWR is preferred over rolling-average ACWR — gives more weight to recent days, decays correctly.',
  citations: [
    cite('§Training Load Metrics', 'TRIMP, TSS, ACWR (0.8-1.3 sweet spot, >1.5 danger), monotony >2.0, strain', 'research', '15'),
  ],
};

// ── CTL / ATL / TSB ───────────────────────────────────────────────

export const CTL_ATL_TSB_BANDS: Cited<{
  definitions: { ctl: string; atl: string; tsb: string };
  tsbBands: Array<{ tsbLow: number; tsbHigh: number; meaning: 'over_reached' | 'fatigued' | 'productive' | 'fresh' | 'detrained'; action: string }>;
  rampRateGuidance: { healthyCtlPctPerWeekLow: number; healthyCtlPctPerWeekHigh: number; injuryRiskAbovePctPerWeek: number };
}> = {
  value: {
    definitions: {
      ctl: 'Chronic Training Load — 42-day exponentially weighted average of daily load. Proxy for fitness.',
      atl: 'Acute Training Load — 7-day exponentially weighted average. Proxy for fatigue.',
      tsb: 'Training Stress Balance — CTL minus ATL. Proxy for form. Positive = fresh; negative = fatigued.',
    },
    tsbBands: [
      { tsbLow: -50, tsbHigh: -30,  meaning: 'over_reached',   action: 'Insert recovery week. High illness/injury risk.' },
      { tsbLow: -30, tsbHigh: -10,  meaning: 'fatigued',        action: 'Productive training zone — building. Monitor for overshoot.' },
      { tsbLow: -10, tsbHigh: 5,    meaning: 'productive',      action: 'Optimal training zone for adaptation' },
      { tsbLow: 5,   tsbHigh: 25,   meaning: 'fresh',           action: 'Race-ready zone (taper window)' },
      { tsbLow: 25,  tsbHigh: 100,  meaning: 'detrained',       action: 'Fitness loss likely — return to training' },
    ],
    rampRateGuidance: {
      healthyCtlPctPerWeekLow: 3, healthyCtlPctPerWeekHigh: 7,
      injuryRiskAbovePctPerWeek: 10,
    },
  },
  note: 'Form (TSB) +5 to +25 is the "race-ready" range — peaks around +20 for marathon, +10-15 for shorter races. Building cycles run TSB negative; race weeks build TSB positive.',
  citations: [
    cite('§Fitness/Fatigue/Form (CTL/ATL/TSB)', 'CTL 42-day, ATL 7-day, TSB = CTL-ATL. Bands: over-reached -50 to -30 / fatigued -30 to -10 / productive -10 to +5 / fresh +5 to +25 / detrained +25.', 'research', '15'),
  ],
};

// ── HRV / RHR signals ─────────────────────────────────────────────

export const ILLNESS_EARLY_SIGNALS: Cited<{
  hrvDropPct: number;
  rhrIncreaseBpm: number;
  sleepEfficiencyDropPct: number;
  consecutiveDays: number;
  combinedRule: string;
  actionWindow: string;
}> = {
  value: {
    hrvDropPct: 20,
    rhrIncreaseBpm: 5,
    sleepEfficiencyDropPct: 5,
    consecutiveDays: 3,
    combinedRule: 'Two of three (HRV down 20%, RHR up 5 bpm, sleep efficiency down 5%) sustained 3+ days = high illness probability within 24-72h.',
    actionWindow: 'Extra 1-2 hours of sleep + reduce training intensity 20-30% for 3-5 days. Often catches it before symptoms manifest.',
  },
  citations: [
    cite('§Spotting Illness Early', 'Combined HRV/RHR/sleep signal predicts URTI within 24-72h', 'research', '15'),
  ],
};

export const OVERTRAINING_EARLY_SIGNALS: Cited<{
  hrvTrendDays: number;
  rhrTrendDirection: 'rising';
  performanceCriterion: string;
  moodCriterion: string;
  combinedSignalAction: string;
}> = {
  value: {
    hrvTrendDays: 14,
    rhrTrendDirection: 'rising',
    performanceCriterion: 'Submaximal HR rising 5+ bpm at fixed easy pace over 2-3 weeks',
    moodCriterion: 'Profile of Mood States score declining (irritability, low mood, low motivation)',
    combinedSignalAction: 'Functional overreaching → non-functional overreaching → overtraining is a continuum. Catch at functional with cutback week. NFOR requires 2-4 weeks reduced training; OTS requires months.',
  },
  citations: [
    cite('§Spotting Overtraining Early', 'HRV declining 2+ wk + RHR rising + submax HR rising + mood drop = NFOR signal', 'research', '15'),
  ],
};

// ── Sensor accuracy + source-of-truth ─────────────────────────────

export const DEVICE_SOURCE_OF_TRUTH: Cited<{
  hrAccuracy: { chestStrap: 'gold'; armOptical: 'good'; wristOptical: 'fair_to_poor_in_intervals' };
  paceAccuracy: { gpsRoad: 'good_with_drift'; gpsTrail: 'fair'; treadmill: 'requires_calibration' };
  sleepStaging: 'consumer_devices_disagree_with_polysomnography_but_relative_trends_useful';
  hrvDailyMustHave: string[];
  multiDeviceRule: string;
}> = {
  value: {
    hrAccuracy: {
      chestStrap: 'gold',
      armOptical: 'good',
      wristOptical: 'fair_to_poor_in_intervals',
    },
    paceAccuracy: {
      gpsRoad: 'good_with_drift',
      gpsTrail: 'fair',
      treadmill: 'requires_calibration',
    },
    sleepStaging: 'consumer_devices_disagree_with_polysomnography_but_relative_trends_useful',
    hrvDailyMustHave: [
      'Same time daily (within 30 min of waking)',
      'Same posture (supine or seated)',
      'Same recording duration',
      'Stable measurement environment',
      'Trend over 7-14 days, not single readings',
    ],
    multiDeviceRule: 'When HR readings disagree, trust the chest strap. When pace readings disagree, GPS-corrected (post-run smoothing) > raw. Don\'t mix data sources within a metric — pick one device family for ACWR/CTL trending and stick to it.',
  },
  citations: [
    cite('§Heart Rate Sensor Accuracy + Pace and GPS Accuracy + Multi-Device Sync', 'Chest strap = gold; arm optical = good; wrist = fair-poor in intervals. Pick one device family for trending.', 'research', '15'),
  ],
};
