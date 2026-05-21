/**
 * Coaching principles encoded from the research synthesis.
 *
 * Most of the literature-anchored constants in this file have moved to
 * the doctrine layer (web/coach/doctrine/*.ts). This file now layers
 * engine-specific organization on top — sub-phase fractions, easy-share
 * targets per phase, post-race recovery curves — that aren't direct
 * doctrine values but are computed from doctrine principles.
 *
 * **Source-of-truth rule:** if you need to change a number in this
 * file, check first whether it lives in doctrine. If it does, change
 * doctrine; if it doesn't, document the engine-specific reason here.
 *
 * The engine in coach-engine.ts orchestrates these.
 */

import type { CoachState } from './coach-state';
import {
  ACWR_BAND, SINGLE_SESSION_SPIKE,
  LONG_RUN, STRIDES,
  SLEEP,
  HARD_EFFORT_HRMAX_FRACTION, QUALITY_REDLINE_HRMAX_FRACTION,
} from '../coach/doctrine';

/* ── 1. Race-window math (§2.1) ──────────────────────────────────
   Each race distance has an associated build-window length. Inside
   the window the runner is "in race mode" with structured BASE →
   BUILD → PEAK → TAPER sub-phases. Outside it, the default mode is
   maintenance.

   The doc recommends 16-24 weeks for a marathon cycle, with longer
   the more conservative. We use 16 here as the typical sweet spot
   for an experienced runner; 5K/10K/half scale down. */
export function buildWindowDays(distanceMi: number): number {
  if (distanceMi >= 20) return 16 * 7;
  if (distanceMi >= 10) return 12 * 7;
  if (distanceMi >= 5)  return 8 * 7;
  return 6 * 7;
}

/* ── 2. Sub-phase boundaries (§2.1) ──────────────────────────────
   Inside the build window, divide into 4 sub-phases. Boundaries
   given as PERCENTAGE of window remaining (since windows differ by
   distance). E.g., for a 16-week marathon block:
     - First 4 weeks (weeks 16-13 out)        → BASE
     - Next 6 weeks  (weeks 12-7 out)         → BUILD
     - Next 4 weeks  (weeks 6-3 out)          → PEAK
     - Final 2 weeks (weeks 2-0 out)          → TAPER
   Base proportions (4/6/4/2 = 16w) generalize via the same fractions
   to the shorter race windows. */
export type RaceSubPhase = 'BASE' | 'BUILD' | 'PEAK' | 'TAPER';

const SUBPHASE_FRACTIONS: Record<RaceSubPhase, number> = {
  TAPER: 2 / 16,   // last 12.5%
  PEAK:  4 / 16,   // before that, 25%
  BUILD: 6 / 16,   // before that, 37.5%
  BASE:  4 / 16,   // earliest, 25%
};

export function raceSubPhase(daysAway: number, distanceMi: number): RaceSubPhase {
  const window = buildWindowDays(distanceMi);
  const taperEnd = 0;
  const peakEnd  = window * SUBPHASE_FRACTIONS.TAPER;
  const buildEnd = peakEnd + window * SUBPHASE_FRACTIONS.PEAK;
  const baseEnd  = buildEnd + window * SUBPHASE_FRACTIONS.BUILD;
  if (daysAway <= peakEnd)  return 'TAPER';
  if (daysAway <= buildEnd) return 'PEAK';
  if (daysAway <= baseEnd)  return 'BUILD';
  return 'BASE';
}

/* ── 3. Intensity distribution by sub-phase (§3.1) ───────────────
   Targets for the 14-day rolling easy-share metric. The doc says
   pyramidal in build, polarized in peak — translated to "easy share":
   pyramidal ≈ 75% easy (more time at threshold), polarized ≈ 80%
   easy (less middle, more VO2). Maintenance defaults to 80%. */
export interface IntensityTarget {
  easyShareMin: number;   // bottom of acceptable band
  easyShareTarget: number;
  qualityDaysPerWeek: number;
}

export function intensityTarget(phase: Phase): IntensityTarget {
  switch (phase) {
    case 'TAPER':            return { easyShareMin: 0.78, easyShareTarget: 0.85, qualityDaysPerWeek: 1 };
    case 'PEAK':             return { easyShareMin: 0.75, easyShareTarget: 0.80, qualityDaysPerWeek: 2 };
    case 'BUILD':            return { easyShareMin: 0.70, easyShareTarget: 0.75, qualityDaysPerWeek: 2 };
    case 'BASE':             return { easyShareMin: 0.80, easyShareTarget: 0.85, qualityDaysPerWeek: 1 };
    case 'BASE_MAINTENANCE': return { easyShareMin: 0.78, easyShareTarget: 0.82, qualityDaysPerWeek: 1 };
    case 'POST_RACE':        return { easyShareMin: 0.90, easyShareTarget: 1.00, qualityDaysPerWeek: 0 };
    case 'REBUILD':          return { easyShareMin: 0.85, easyShareTarget: 0.95, qualityDaysPerWeek: 0 };
  }
}

/* ── 4. The full phase enum used by the engine ──────────────────
   Race-mode sub-phases (BASE / BUILD / PEAK / TAPER) + base-mode
   states (BASE_MAINTENANCE = default, REBUILD = coming back, POST_RACE
   = within recovery window of a finished race). Distinct from the
   trainingPulse() chip on the dashboard, which uses friendlier user-
   facing labels. */
export type Phase = RaceSubPhase | 'BASE_MAINTENANCE' | 'POST_RACE' | 'REBUILD';

/* ── 5. Single-session spike rule (§13.1) ────────────────────────
   Strongest predictor of injury. Doctrine: SINGLE_SESSION_SPIKE in
   coach/doctrine/load.ts. Engine-side hard ceiling: 10 % (the doctrine
   ceiling, expressed as a multiplier on `longestRecentLast30d`). */
export const LONG_RUN_SPIKE_CAP =
  1 + SINGLE_SESSION_SPIKE.value.ceilingPctAboveLongestRecent / 100;

export function maxLongRunMi(state: CoachState): number {
  // Floor at 8mi so a runner returning from a break has a sane minimum.
  //
  // BUG FIX: anchor on longestTrainingRunLast28Mi (races excluded).
  // 26mi race × 1.10 = 29mi unsafe training prescription. Research/00a
  // §13.1 spike rule applies to the longest TRAINING run, not the
  // runner's longest competitive effort.
  return Math.max(8, state.volume.longestTrainingRunLast28Mi * LONG_RUN_SPIKE_CAP);
}

/* ── 6. ACWR (§13.1) ─────────────────────────────────────────────
   Doctrine: ACWR_BAND in coach/doctrine/load.ts. */
export const ACWR_LOW = ACWR_BAND.value.sweetSpotLow;
export const ACWR_HIGH = ACWR_BAND.value.sweetSpotHigh;

export function acwr(state: CoachState): number | null {
  const acute   = state.volume.last7Mi;
  const chronic = state.volume.last28Mi / 4;  // weekly avg over last 28d
  if (chronic <= 0) return null;
  return acute / chronic;
}

/* ── 7. Volume budget per week by phase (§4.2 / §4.3) ────────────
   Weekly target relative to the runner's established weekly average.
   Base/Build climb to a peak; Peak holds; Taper slashes 40-60%;
   Maintenance is 50-70% of an A-race peak, but for a runner without
   a recent peak we just hold the recent 4-week average.
   Returns a multiplier applied to the recent 4-week weekly avg. */
export function weeklyVolumeMultiplier(phase: Phase): { low: number; high: number } {
  switch (phase) {
    case 'TAPER':            return { low: 0.40, high: 0.60 };
    case 'PEAK':             return { low: 1.05, high: 1.20 };
    case 'BUILD':            return { low: 0.95, high: 1.10 };
    case 'BASE':             return { low: 0.90, high: 1.05 };
    case 'BASE_MAINTENANCE': return { low: 0.90, high: 1.05 };
    case 'POST_RACE':        return { low: 0.30, high: 0.50 };
    case 'REBUILD':          return { low: 0.50, high: 0.70 };
  }
}

/* ── 8. Post-race recovery duration (§13.3) ──────────────────────
   Doc rule of thumb: a runner peaking at 70 mpw needs 2-4 weeks of
   reduced training before structured work; 100+ mpw → 3-6 weeks.
   Easy mileage at 30-50% of peak is fine, no quality.
   Plus the legacy "1 day per mile" guide → 26 days for a marathon. */
export function postRaceRecoveryDays(distanceMi: number, peakWeeklyMi: number): number {
  // Distance-based floor: 1 day per mile (capped).
  const distanceFloor = Math.min(28, Math.round(distanceMi));
  // Volume-based extension: high-mileage runners need longer.
  const volumeFloor = peakWeeklyMi >= 100 ? 28 : peakWeeklyMi >= 70 ? 21 : 14;
  return Math.max(distanceFloor, volumeFloor);
}

/* ── 9. Heavy-block detection (§13.3 + your insight) ─────────────
   3+ races in 21 days OR sustained ≥1.5× weekly avg volume for 3+
   consecutive weeks → suggest 3-5 days FULL rest before resuming
   structured work. State already computes the heavyBlockSuspected
   flag; the engine acts on it. */
export const HEAVY_BLOCK_REST_DAYS = 5;

/* ── 10. Quality-day spacing (§5.5 / §8.3) ───────────────────────
   24-72h between hard efforts. Long runs count as "hard" when they're
   over 90 min OR include MP/progression segments. Engine refuses to
   prescribe two hard sessions back-to-back. */
export const MIN_HARD_SPACING_HOURS = 24;

/* ── 11. Strides cadence (§5.8) ──────────────────────────────────
   Doctrine: STRIDES in coach/doctrine/workouts.ts. */
export const STRIDES_PER_WEEK = STRIDES.value.perWeekLow;

/* ── 12. Long-run progression rules (§5.4) ──────────────────────
   Doctrine: LONG_RUN in coach/doctrine/workouts.ts. The day-of-week
   default (Saturday) is engine-specific organisation, not doctrine. */
export const LONG_RUN_DAY_DOW = 6;  // Saturday (0 = Sunday in JS Date.getDay())
export const LONG_RUN_MIN_MIN = LONG_RUN.value.thresholdMinutes;
export const LONG_RUN_MAX_MI = LONG_RUN.value.distanceMiHigh;

/* ── 13. Strength training periodization (§6.3) ──────────────────
   Heavy resistance + plyometrics, 2 sessions/week year-round. Periodized:
     BASE      → 2x heavy
     BUILD     → 1 heavy + 1 power/plyo
     PEAK      → 1-2x maintenance (low volume, intensity preserved)
     TAPER     → 1 short session in first taper week, then drop
     BASE_MAINTENANCE → ramp up: 2x heavy, can chase strength gains
     POST_RACE → optional 1 light session toward end of recovery window
     REBUILD   → 1 heavy + 1 mobility
   Drops entirely in final 7-10 days before A race. */
export type StrengthSessionType = 'heavy' | 'power' | 'maintenance' | 'mobility' | 'rest';

export interface StrengthCadence {
  perWeek: number;
  composition: StrengthSessionType[];   // length = perWeek
  notes: string;
}

export function strengthCadence(phase: Phase, daysToRace: number | null): StrengthCadence {
  // In the final 7-10 days before an A race, no strength.
  if (daysToRace != null && daysToRace <= 10 && (phase === 'TAPER')) {
    return { perWeek: 0, composition: [], notes: 'No strength in final 10 days — preserve freshness for race day.' };
  }
  switch (phase) {
    case 'BASE':
      return { perWeek: 2, composition: ['heavy', 'heavy'], notes: 'Build maximum-force capacity. Heavy lifts (3-6 reps × 3-5 sets at 80%+ 1RM).' };
    case 'BUILD':
      return { perWeek: 2, composition: ['heavy', 'power'], notes: 'One heavy session + one power/plyometric. Volume trims as run intensity rises.' };
    case 'PEAK':
      return { perWeek: 1, composition: ['maintenance'], notes: 'Maintain — low volume, intensity preserved. Goal is preservation, not gain.' };
    case 'TAPER':
      return { perWeek: 1, composition: ['maintenance'], notes: 'One light session in first taper week. Drop entirely in final 7-10 days.' };
    case 'BASE_MAINTENANCE':
      return { perWeek: 2, composition: ['heavy', 'heavy'], notes: 'Strength emphasis can ramp up between race cycles. Chase max-force gains here.' };
    case 'POST_RACE':
      return { perWeek: 1, composition: ['mobility'], notes: 'Mobility-focused recovery. No heavy loading until you\'ve been back to easy running for a week.' };
    case 'REBUILD':
      return { perWeek: 2, composition: ['heavy', 'mobility'], notes: 'Reintroduce heavy lifting; pair with mobility for tendon recovery.' };
  }
}

/* ── 14. Sleep / HRV thresholds (Research 03 §10) ────────────────
   Doctrine: SLEEP in coach/doctrine/recovery.ts. HRV threshold pulls
   from Research 03 §10 HRV_INTERPRETATION_PATTERNS — daily drop ~20%
   below baseline triggers easy/rest. The 12% used here is the
   engine's recovery-day flag (more sensitive than the rest threshold). */
export const SLEEP_HOURS_FLOOR = SLEEP.value.generalHoursLow;
export const SLEEP_HOURS_HIGH_LOAD = SLEEP.value.highLoadHoursLow;
export const HRV_DROP_FLAG_PCT = 0.12;  // 12 % drop from baseline = recovery day

/* ── 14b. Hard-effort HR threshold (Research 03 §4) ──────────────
   Population-default cutoffs, used ONLY when the runner's HRmax is
   unknown. 152 ≈ 80% × 190 (Z4 threshold floor); 170 ≈ 90% × 190 (Z4
   ceiling / VO2max floor). When HRmax is known, the helpers below
   personalize off it via the HRMAX_FRACTION doctrine anchors. */
export const HARD_EFFORT_HR_DEFAULT_BPM = 152;
export const QUALITY_REDLINE_HR_DEFAULT_BPM = 170;

/** bpm at/above which a sustained effort counts as "hard" for the
 *  hard-day/easy-day spacing rule. Personalized to 0.80 × HRmax when
 *  known; else the population default. @research Research/03 §4 */
export function hardEffortHrThresholdBpm(effectiveHrmaxBpm: number | null | undefined): number {
  return effectiveHrmaxBpm != null
    ? Math.round(HARD_EFFORT_HRMAX_FRACTION * effectiveHrmaxBpm)
    : HARD_EFFORT_HR_DEFAULT_BPM;
}

/** bpm above which a quality session's AVERAGE HR signals a redlined
 *  (VO2max) effort rather than a controlled threshold/tempo. Personalized
 *  to 0.90 × HRmax when known; else the population default.
 *  @research Research/03 §4 */
export function qualityRedlineHrBpm(effectiveHrmaxBpm: number | null | undefined): number {
  return effectiveHrmaxBpm != null
    ? Math.round(QUALITY_REDLINE_HRMAX_FRACTION * effectiveHrmaxBpm)
    : QUALITY_REDLINE_HR_DEFAULT_BPM;
}

/* ── 15. Pace targets relative to goal pace ─────────────────────
   Daniels-style training paces expressed as offsets from goal MP.
   Source: Research/01-pace-zones-vdot.md §"Daniels training paces"
   and §"Pace conversion from a race time"; Research/04 §"Pace zone
   shorthand". Doctrine constants:
     pace_zones.ts → DANIELS_PACE_OFFSETS_S_PER_MI (canonical anchors)
     pace_zones.ts → HANSONS_PACE_OFFSETS_S_PER_MI (Hansons offsets)
     workouts.ts   → PACE_ZONE_SHORTHAND (E/M/T/ST/I/R/HM/MP/10K/5K/3K)
   The values below are the engine's per-workout-type lookup,
   approximated from those doctrine sources for fast read access in
   coach-workouts.ts. They preserve the existing engine behavior.
   When the user has a recent race result, replace with VDOT-derived
   paces (pace_zones.ts VDOT_LOOKUP_TABLE). */
export const PACE_OFFSETS_S_PER_MI: Record<string, { lowS: number; highS: number }> = {
  recovery:        { lowS: 90,  highS: 150 }, // Hansons recovery 90-120; Daniels E slow end
  general_aerobic: { lowS: 30,  highS: 60  }, // Pfitzinger GA 15-25% slower than MP
  medium_long:     { lowS: 25,  highS: 50  }, // Pfitzinger endurance/long anchor
  long_steady:     { lowS: 20,  highS: 60  }, // Mid-E to upper-E (Pfitzinger long-run pace)
  long_progression:{ lowS: 0,   highS: 60  }, // Ramps E → M at the end
  long_mp_block:   { lowS: -5,  highS: 5   }, // Locked at MP per Daniels M
  threshold:       { lowS: -25, highS: -10 }, // T pace ≈ HM to 15K (Daniels T)
  threshold_intervals: { lowS: -25, highS: -10 },
  sub_threshold:   { lowS: -15, highS: -5  }, // ST: 10-15 s/mi slower than T (Norwegian)
  vo2:             { lowS: -50, highS: -35 }, // I pace ≈ 5K-3K (Daniels I)
  marathon_specific: { lowS: -10, highS: 5 },
  strides:         { lowS: -45, highS: -25 }, // R pace ≈ mile to 800m race pace (Daniels R)
};
