/**
 * Plan-simulator input translation · 2026-06-22
 *
 * Mirrors loadGeneratorInputs() (generate.ts) but builds a ComposePlanInput
 * from SYNTHETIC onboarding answers instead of reading the database. This is
 * the seam the simulator twists: friendly onboarding variables in →
 * engine-ready ComposePlanInput out → the REAL composePlan runs on it.
 *
 * Every derivation here is a deliberate line-for-line copy of the equivalent
 * step in loadGeneratorInputs so the simulator's plan matches what a runner who
 * gave these onboarding answers would actually receive. Where the live loader
 * reads run history (recentWeeklyMi, easyDayMedianMi, bestRecentVdot …) the
 * simulator takes those as explicit inputs — defaulting to the cold-start
 * values a brand-new no-Strava signup would have, and overridable in the
 * panel's "derived signals" section to simulate a runner with history.
 *
 * v1 scope: race-prep mode (composePlan), the mode EVERY race-goal onboarding
 * produces (goal-anchored plans always force race-prep — see generatePlan).
 * Maintenance/recovery (races-table path only) is a future toggle.
 *
 * No DB. No clock. Pure.
 */

import {
  type ComposePlanInput,
  type DOW,
  type DayKey,
  type LevelKey,
  dayKeyToDow,
  daysBetween,
  inlinePrescriptions,
  distanceCategoryOfPublic,
} from './generate';
import { tPaceFromGoal } from './spec-builder';

export type SimDistance = '5k' | '10k' | 'half' | 'marathon';

/** Standard race distances in miles (km ÷ 1.609344). Matches the values the
 *  app stores for these races; pace = goalSec ÷ miles depends on them. */
export const SIM_DISTANCE_MI: Record<SimDistance, number> = {
  '5k': 3.10686,
  '10k': 6.21371,
  'half': 13.10940,
  'marathon': 26.21875,
};

/** The friendly onboarding-language inputs the control panel sends. */
export interface SimInputs {
  // --- Goal (onboarding step 1) ---
  distance: SimDistance;
  /** Race day · YYYY-MM-DD. */
  raceDateISO: string;
  /** Optional goal finish time in seconds. null = by-feel (no goal pace). */
  goalTimeSec: number | null;
  /** Week-0 anchor · YYYY-MM-DD. Onboarding anchors week 0 at the runner's
   *  chosen start day, so the simulator uses it literally. */
  startDateISO: string;

  // --- Runner profile (onboarding steps 1b / 3) ---
  level: LevelKey;
  /** profile.weekly_frequency · 0-7 or null. null = legacy fill-every-slot
   *  (David / Strava-only / pre-frequency). 0 = "not running yet" → couch-to-X
   *  floor of 3. Drives quality-day count + total running-days cap. */
  weeklyFrequency: number | null;
  /** Long-run day. Training week ends here; week starts the day after. */
  longRunDay: DayKey;
  /** Self-reported recent avg weekly mileage (history_avg_weekly_mi midpoint,
   *  or weekly_mileage_target). Seeds the volume ramp. Cold start = 0 seeds
   *  from this self-report — exactly loadGeneratorInputs' fallback. */
  recentWeeklyMi: number;
  /** Self-reported recent peak long run (history_longest_recent_mi midpoint).
   *  Floors long-run sizing so the plan never asks for a shorter long than the
   *  runner has done. */
  recentLongMi: number;

  // --- Derived signals (normally read from Strava/runs · overridable) ---
  /** Best recent VDOT from races/quality runs. undefined = goal-pace only (no
   *  ramp), the cold no-Strava signup case. Set it to simulate a runner with
   *  fitness history — early weeks anchor here and ramp toward the goal tier. */
  bestRecentVdot?: number | null;
  /** Median easy-day distance (last 14d). Cold start = 0 (no runs). */
  easyDayMedianMi?: number | null;
  recentQualityDistanceMi?: number | null;
  recentQualityPerWeek?: number | null;
  /** Banister TSB at start · shifts cutback cadence (Rule 8). */
  tsbAtStart?: number | null;
  /** Mid-block runner (already deep in a training cycle). */
  isMidBlock?: boolean;
  lthr?: number | null;
  maxHr?: number | null;
  crossModes?: string[];
  /** Days the runner can run. >=2 → long/quality/easy land ONLY on these. */
  availableDays?: DayKey[] | null;
  /** Rest-day override. Default 'sat' (loadGeneratorInputs default). */
  restDay?: DayKey | null;
  /** Quality-day seeds before the frequency slice. Default tue/thu. */
  qualityDays?: DayKey[] | null;
}

export interface SimTranslateResult {
  ok: boolean;
  reason?: string;
  compose?: ComposePlanInput;
  /** Surfaced to the panel so the user sees what the friendly inputs became. */
  derived?: {
    raceDistanceMi: number;
    goalPaceSec: number | null;
    tPaceSec: number;
    longRunDow: DOW;
    restDow: DOW;
    qualityDows: DOW[];
    trainingDaysPerWeek: number | null;
    runwayWeeks: number;
    distanceCategory: string;
  };
}

/**
 * Friendly onboarding answers → ComposePlanInput. Mirrors loadGeneratorInputs
 * step by step (the comments cite the generate.ts step each block copies).
 */
export function simInputsToComposeInput(sim: SimInputs): SimTranslateResult {
  // Step 1 · target. (loadGeneratorInputs §1 — goalTarget branch.)
  const raceDistanceMi = SIM_DISTANCE_MI[sim.distance];
  const raceDateISO = sim.raceDateISO;
  const goalSec = sim.goalTimeSec ?? null;

  // Runway guards · mirror loadGeneratorInputs (≥14 days, ≤365 days, ≥3 weeks).
  const totalDays = daysBetween(sim.startDateISO, raceDateISO);
  if (Number.isNaN(totalDays)) return { ok: false, reason: 'invalid date' };
  if (totalDays < 14) return { ok: false, reason: 'Race is under 2 weeks out — too close to build a plan. Push the race date later or move the start date earlier.' };
  if (totalDays > 365) return { ok: false, reason: 'Race is over a year out — the engine only plans within a year. Pull the race date closer.' };

  // goalPaceSec · loadGeneratorInputs:2655.
  const goalPaceSec = goalSec ? Math.round(goalSec / raceDistanceMi) : null;

  // Step 2 · layout prefs. (loadGeneratorInputs §2.)
  let longRunDow = dayKeyToDow(sim.longRunDay);
  let restDow = dayKeyToDow(sim.restDay ?? 'sat');
  let qualityDows: DOW[] = (sim.qualityDays ?? ['tue', 'thu']).map((d) => dayKeyToDow(d));

  // available-days placement · loadGeneratorInputs:2671-2688.
  let availableDows: Set<number> | null = null;
  const avail = (sim.availableDays ?? []).map((d) => dayKeyToDow(d));
  if (avail.length >= 2) {
    const aset = new Set<number>(avail);
    availableDows = aset;
    longRunDow = (aset.has(longRunDow) ? longRunDow
      : aset.has(6) ? 6 : aset.has(0) ? 0 : Math.max(...avail)) as DOW;
    const unavail = [0, 1, 2, 3, 4, 5, 6].filter((d) => !aset.has(d));
    restDow = (!aset.has(restDow) ? restDow : (unavail[0] ?? restDow)) as DOW;
    qualityDows = avail.filter((d) => d !== longRunDow)
      .sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3)) as DOW[];
  }

  // stated frequency → trainingDaysPerWeek · loadGeneratorInputs:2710-2723.
  const rawFreq = sim.weeklyFrequency != null ? Number(sim.weeklyFrequency) : null;
  const trainingDaysPerWeek = rawFreq == null ? null
    : rawFreq === 0 ? 3
    : (rawFreq >= 1 && rawFreq <= 7) ? rawFreq
    : null;
  if (trainingDaysPerWeek != null) {
    const qCount = trainingDaysPerWeek <= 1 ? 0 : trainingDaysPerWeek >= 5 ? 2 : 1;
    qualityDows = qualityDows.slice(0, qCount);
  }

  // Step 4 · start anchor. Onboarding anchors week 0 at the chosen start day
  // (loadGeneratorInputs:2753 onboarding branch · startDateISO used literally).
  const startMondayISO = sim.startDateISO;
  const runwayWeeks = Math.max(3, Math.floor(daysBetween(startMondayISO, raceDateISO) / 7) + 1);

  // Cold-start volume seeds · loadGeneratorInputs:2760-2780. A new signup has
  // no runs, so recent* read 0 and seed from the self-reported baselines.
  const recentWeeklyMi = sim.recentWeeklyMi;
  const recentLongMi = sim.recentLongMi;
  const easyDayMedianMi = sim.easyDayMedianMi ?? 0;

  // Step 6 · prescriptions. The live loader reads workout_library and falls
  // back to inlinePrescriptions on a miss; the simulator uses the inline
  // catalog directly (same shape, no DB). loadGeneratorInputs:2847-2852.
  const cat = distanceCategoryOfPublic(raceDistanceMi);
  const rxQuality = inlinePrescriptions(cat);
  const rxRaceSpecific = inlinePrescriptions(cat);

  // Step 7 · T-pace. loadGeneratorInputs:2867 — 480s/mi default when no goal.
  const tPaceSec = tPaceFromGoal(goalSec, raceDistanceMi) ?? 480;

  const compose: ComposePlanInput = {
    raceDistanceMi,
    goalSec,
    goalPaceSec,
    raceDateISO,
    startMondayISO,
    level: sim.level,
    recentWeeklyMi,
    easyDayMedianMi,
    recentLongMi,
    recentQualityDistanceMi: sim.recentQualityDistanceMi != null && sim.recentQualityDistanceMi > 0 ? sim.recentQualityDistanceMi : undefined,
    recentQualityPerWeek: sim.recentQualityPerWeek != null && sim.recentQualityPerWeek > 0 ? sim.recentQualityPerWeek : undefined,
    bestRecentVdot: sim.bestRecentVdot != null && sim.bestRecentVdot > 0 ? sim.bestRecentVdot : undefined,
    tsbAtStart: sim.tsbAtStart != null ? sim.tsbAtStart : undefined,
    horizonRaces: undefined,
    isMidBlock: sim.isMidBlock ?? false,
    longRunDow,
    restDow,
    qualityDows,
    availableDows,
    trainingDaysPerWeek,
    crossModes: sim.crossModes ?? [],
    rxQuality,
    rxRaceSpecific,
    tPaceSec,
    lthr: sim.lthr ?? null,
    maxHr: sim.maxHr ?? null,
  };

  return {
    ok: true,
    compose,
    derived: {
      raceDistanceMi,
      goalPaceSec,
      tPaceSec,
      longRunDow,
      restDow,
      qualityDows,
      trainingDaysPerWeek,
      runwayWeeks,
      distanceCategory: cat,
    },
  };
}
