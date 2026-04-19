/**
 * Shared types for the Runcino pacing pipeline.
 * Maps 1:1 with docs/SCHEMA.md v1.1.0.
 */

export interface GpxPoint {
  lat: number;
  lon: number;
  eleM: number;            // elevation, meters
  distM: number;           // cumulative distance from start, meters
}

export interface GpxTrack {
  points: GpxPoint[];
  totalDistanceM: number;
  rawGainFt: number;
  rawLossFt: number;
  smoothedGainFt: number;
  smoothedLossFt: number;
}

export interface Segment {
  startMi: number;
  endMi: number;
  distanceM: number;
  meanGradePct: number;    // signed percent, +up / -down
  gainFt: number;
  lossFt: number;
  gaf: number;             // Minetti grade adjustment factor
  targetPaceSPerMi: number;
}

export interface PacingInput {
  goalFinishS: number;
  strategy: 'even_effort' | 'even_split' | 'negative_split';
  warmup?: { distanceMi: number; paceSPerMi: number } | null;
  toleranceSPerMi: number;
  segmentDistanceM?: number;   // default 800
}

export interface Phase {
  index: number;
  label: string;
  startMi: number;
  endMi: number;
  distanceMi: number;
  targetPaceSPerMi: number;
  targetPaceDisplay: string;
  meanGradePct: number;
  elevationGainFt: number;
  elevationLossFt: number;
  cumulativeTimeS: number;
  cumulativeTimeDisplay: string;
  note: string;
}

export type IntervalKind = 'pace' | 'fuel' | 'landmark';

export interface PaceInterval {
  index: number;
  phaseIdx: number;
  kind: 'pace';
  atMi: number;
  distanceMi: number;
  targetPaceSPerMi: number;
  toleranceSPerMi: number;
  label: string;
}

export interface FuelInterval {
  index: number;
  phaseIdx: number;
  kind: 'fuel';
  atMi: number;
  durationS: number;
  item: string;
  gelNumber: number;
  label: string;
}

export interface LandmarkInterval {
  index: number;
  phaseIdx: number;
  kind: 'landmark';
  atMi: number;
  durationS: number;
  label: string;
}

export type Interval = PaceInterval | FuelInterval | LandmarkInterval;

export interface FuelingSummary {
  carbTargetGPerHr: number;
  totalCarbsG: number;
  gelCount: number;
  gelCarbsG: number;
  gelBrand: string;
  notes: string;
}

export interface FitnessSummary {
  baselineRace: { name: string; finishS: number; monthsAgo: number } | null;
  weeklyMileage: number | null;
  weeklyMileageTrend6Wk: number | null;
  longestRecentLongRunMi: number | null;
  longestRecentLongRunAgeWk: number | null;
  restingHrBpm: number | null;
  restingHrTrend8Wk: number | null;
  age: number | null;
  weightLb: number | null;
  source: 'manual' | 'healthkit' | 'strava';
}

export interface RuncinoPlan {
  schema_version: '1.1.0';
  generated_at: string;
  generator: string;
  race: {
    name: string;
    date: string;
    distance_mi: number;
    distance_m: number;
    total_gain_ft: number;
    total_loss_ft: number;
  };
  goal: {
    finish_time_s: number;
    finish_time_display: string;
    strategy: PacingInput['strategy'];
    flat_pace_s_per_mi: number;
    warmup: {
      enabled: boolean;
      distance_mi: number;
      pace_s_per_mi: number | null;
    };
    claude_rationale: string | null;
  };
  fitness_summary: FitnessSummary;
  tolerance: { pace_s_per_mi: number };
  phases: Array<{
    index: number;
    label: string;
    start_mi: number;
    end_mi: number;
    distance_mi: number;
    target_pace_s_per_mi: number;
    target_pace_display: string;
    mean_grade_pct: number;
    elevation_gain_ft: number;
    elevation_loss_ft: number;
    cumulative_time_s: number;
    cumulative_time_display: string;
    note: string;
  }>;
  intervals: Array<
    | { index: number; phase_idx: number; kind: 'pace'; at_mi: number; distance_mi: number; target_pace_s_per_mi: number; tolerance_s_per_mi: number; label: string }
    | { index: number; phase_idx: number; kind: 'fuel'; at_mi: number; duration_s: number; item: string; gel_number: number; label: string }
    | { index: number; phase_idx: number; kind: 'landmark'; at_mi: number; duration_s: number; label: string }
  >;
  fueling: {
    carb_target_g_per_hr: number;
    total_carbs_g: number;
    gel_count: number;
    gel_carbs_g: number;
    gel_brand: string;
    notes: string;
  };
  brief: null | {
    generated_at: string;
    weather_input: string;
    narrative: string;
    plan_adjustments: Array<{ phase_idx: number; pace_delta_s_per_mi: number; reason: string }>;
  };
}
