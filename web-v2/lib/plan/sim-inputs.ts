/**
 * Plan-simulator translation · 2026-06-22
 *
 * Turns the NATIVE onboarding + goal-setup answers (SimInputs) into a composed
 * plan by running the REAL engine — no DB. Mirrors generatePlan's dispatch:
 *
 *   goalMode 'goal'    → race date = start + planWeeks·7 → composePlan (race-prep)
 *   goalMode 'race'    → pickPlanMode(date) → composePlan / composeMaintenance /
 *                        composeRecovery  (covers all three engine modes)
 *   goalMode 'justRun' → no race → composeMaintenancePlan (the consistency block)
 *
 * Runner-profile derivation mirrors loadGeneratorInputs step-for-step, but from
 * the native onboarding buckets (a new no-Strava signup's cold-start seeds):
 *   - weekly mileage bucket → recentWeeklyMi (lossy histAvg-midpoint path)
 *   - longest-run bucket    → recentLongMi
 *   - self-reported PRs     → bestRecentVdot (vdotFromRace of the best entry)
 * Derived signals are overridable for simulating a runner with history.
 *
 * Pure · no DB · no clock (start date is an explicit input).
 */

import {
  type ComposePlanInput,
  type ComposeNonRaceInput,
  type ComposePlanResult,
  type DOW,
  type LevelKey,
  dayKeyToDow,
  daysBetween,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  composePlan,
  composeMaintenancePlan,
  composeRecoveryPlan,
  finalizeComposedPlan,
} from './generate';
import { lookupTierTarget, pickPlanMode, type PlanMode } from './goal-tiers';
import { tPaceFromGoal } from './spec-builder';
import { vdotFromRace } from '@/lib/training/vdot';
import {
  SIM_DISTANCE_MI,
  recentWeeklyMiFromBucket,
  recentLongMiFromBucket,
  type SimInputs,
} from './sim-constants';

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Best VDOT across self-reported PRs · how the engine seeds current fitness. */
function bestVdotFromHistory(rh: SimInputs['raceHistory']): number | undefined {
  let best: number | undefined;
  for (const e of rh) {
    const mi = SIM_DISTANCE_MI[e.distance];
    const v = vdotFromRace(e.timeSec, mi);
    if (v != null && (best === undefined || v > best)) best = v;
  }
  return best;
}

export interface SimBuildOk {
  ok: true;
  mode: PlanMode;
  raceDistanceMi: number;
  composed: ComposePlanResult;
  derived: {
    mode: PlanMode;
    raceDistanceMi: number;
    raceDateISO: string;
    goalPaceSec: number | null;
    tPaceSec: number;
    bestRecentVdot: number | null;
    recentWeeklyMi: number;
    recentLongMi: number;
    longRunDow: DOW;
    restDow: DOW;
    qualityDows: DOW[];
    trainingDaysPerWeek: number | null;
    distanceCategory: string;
  };
  validateCtx: {
    level: LevelKey;
    isSteppingStoneToMarathon: boolean;
    priorPlanPeakLongMi: number | null;
    todayISO: string;
    trainingDaysPerWeek: number | null;
    trailingAvgWeeklyMi: number | null;
  };
}
export type SimBuildResult = SimBuildOk | { ok: false; reason: string };

/** Native onboarding answers → composed plan via the real engine. */
export function buildSimPlan(sim: SimInputs): SimBuildResult {
  const startMondayISO = sim.startDateISO;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startMondayISO)) return { ok: false, reason: 'invalid start date' };

  // ── shared runner-profile derivation (mirrors loadGeneratorInputs) ──
  const level = sim.experienceLevel as LevelKey;
  const recentWeeklyMi = recentWeeklyMiFromBucket(sim.weeklyMileageBucket);
  const recentLongMi = recentLongMiFromBucket(sim.longestRunBucket);
  const easyDayMedianMi = sim.easyDayMedianMi != null && sim.easyDayMedianMi > 0 ? sim.easyDayMedianMi : 0;
  const bestRecentVdot = sim.bestRecentVdotOverride != null && sim.bestRecentVdotOverride > 0
    ? sim.bestRecentVdotOverride
    : bestVdotFromHistory(sim.raceHistory);

  // layout (loadGeneratorInputs §2)
  let longRunDow = dayKeyToDow(sim.longRunDay);
  let restDow = dayKeyToDow(sim.restDay ?? 'sat');
  let qualityDows: DOW[] = [dayKeyToDow('tue'), dayKeyToDow('thu')];
  let availableDows: Set<number> | null = null;
  const avail = (sim.availableDays ?? []).map((d) => dayKeyToDow(d));
  if (avail.length >= 2) {
    const aset = new Set<number>(avail);
    availableDows = aset;
    longRunDow = (aset.has(longRunDow) ? longRunDow : aset.has(6) ? 6 : aset.has(0) ? 0 : Math.max(...avail)) as DOW;
    const unavail = [0, 1, 2, 3, 4, 5, 6].filter((d) => !aset.has(d));
    restDow = (!aset.has(restDow) ? restDow : (unavail[0] ?? restDow)) as DOW;
    qualityDows = avail.filter((d) => d !== longRunDow).sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3)) as DOW[];
  }
  // stated frequency → trainingDaysPerWeek + quality-count slice
  const rawFreq = Number.isFinite(sim.weeklyFrequency) ? Number(sim.weeklyFrequency) : null;
  const trainingDaysPerWeek = rawFreq == null ? null
    : rawFreq === 0 ? 3
    : (rawFreq >= 1 && rawFreq <= 7) ? rawFreq
    : null;
  if (trainingDaysPerWeek != null) {
    const qCount = trainingDaysPerWeek <= 1 ? 0 : trainingDaysPerWeek >= 5 ? 2 : 1;
    qualityDows = qualityDows.slice(0, qCount);
  }
  const crossModes: string[] = [];

  // ── mode + horizon ──
  let mode: PlanMode;
  let raceDistanceMi: number;
  let raceDateISO: string;
  let goalSec: number | null;
  let lastRaceFinished: ComposeNonRaceInput['lastRaceFinished'] = null;
  let nextRace: ComposeNonRaceInput['nextRace'] = null;

  if (sim.goalMode === 'justRun') {
    // No goal · the consistency block. Reference distance (half) only selects
    // the validator's constraint row; maintenance skips the long-run cap.
    mode = 'maintenance';
    raceDistanceMi = SIM_DISTANCE_MI['half'];
    raceDateISO = addDaysISO(startMondayISO, 28);
    goalSec = null;
  } else if (sim.goalMode === 'goal') {
    raceDistanceMi = SIM_DISTANCE_MI[sim.distance];
    const weeks = Math.max(4, Math.min(52, Math.round(sim.planWeeks || 0)));
    raceDateISO = addDaysISO(startMondayISO, weeks * 7); // /api/profile/goal: deadline = start + weeks·7
    goalSec = sim.goalTimeSec ?? null;
    mode = 'race-prep'; // goal-anchored is always a build
  } else {
    raceDistanceMi = SIM_DISTANCE_MI[sim.distance];
    raceDateISO = sim.raceDateISO;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDateISO)) return { ok: false, reason: 'invalid race date' };
    goalSec = sim.goalTimeSec ?? null;
    const lastDaysAgo = sim.lastRaceFinishedDaysAgo ?? 0;
    const lastISO = lastDaysAgo > 0 ? addDaysISO(startMondayISO, -lastDaysAgo) : null;
    const lastDistMi = sim.lastRaceDistance ? SIM_DISTANCE_MI[sim.lastRaceDistance] : null;
    mode = pickPlanMode(startMondayISO, raceDateISO, raceDistanceMi, lastISO, lastDistMi);
    if (mode === 'recovery' && lastISO && lastDistMi) {
      lastRaceFinished = { slug: 'sim-last', name: 'Last race', date: lastISO, distanceMi: lastDistMi };
    }
  }

  const goalPaceSec = goalSec ? Math.round(goalSec / raceDistanceMi) : null;
  const tPaceSec = tPaceFromGoal(goalSec, raceDistanceMi) ?? 480;

  if (mode === 'race-prep') {
    const d = daysBetween(startMondayISO, raceDateISO);
    if (d < 14) return { ok: false, reason: 'Race is under 2 weeks out — too close to build a plan. Push it later or pick a longer plan.' };
    if (d > 365) return { ok: false, reason: 'Race is over a year out — the engine plans within a year.' };
  }

  const cat = distanceCategoryOfPublic(raceDistanceMi);
  const rxQuality = inlinePrescriptions(cat);
  const rxRaceSpecific = inlinePrescriptions(cat);

  let composed: ComposePlanResult;
  if (mode === 'race-prep') {
    const input: ComposePlanInput = {
      raceDistanceMi, goalSec, goalPaceSec, raceDateISO, startMondayISO, level,
      recentWeeklyMi, easyDayMedianMi, recentLongMi,
      recentQualityDistanceMi: undefined, recentQualityPerWeek: undefined,
      bestRecentVdot, tsbAtStart: undefined, horizonRaces: undefined,
      isMidBlock: sim.isMidBlock ?? false,
      longRunDow, restDow, qualityDows, availableDows, trainingDaysPerWeek, crossModes,
      rxQuality, rxRaceSpecific, tPaceSec, lthr: sim.lthr ?? null, maxHr: sim.maxHr ?? null,
    };
    composed = composePlan(input);
  } else {
    const tier = lookupTierTarget(goalPaceSec, raceDistanceMi).tier;
    if (mode !== 'recovery' && sim.goalMode === 'race') {
      nextRace = { slug: 'sim-race', name: 'Goal race', date: raceDateISO, distanceMi: raceDistanceMi, goalPaceSec };
    }
    const nonRace: ComposeNonRaceInput = {
      startMondayISO, level, recentWeeklyMi, recentLongMi, recentPeakWeeklyMi: recentWeeklyMi,
      easyDayMedianMi, longRunDow, restDow, qualityDows, availableDows, trainingDaysPerWeek, crossModes,
      tier, nextRace, lastRaceFinished, rxQuality, tPaceSec, lthr: sim.lthr ?? null,
    };
    composed = mode === 'recovery' ? composeRecoveryPlan(nonRace) : composeMaintenancePlan(nonRace);
  }
  finalizeComposedPlan(composed, raceDistanceMi);

  return {
    ok: true,
    mode,
    raceDistanceMi,
    composed,
    derived: {
      mode, raceDistanceMi, raceDateISO, goalPaceSec, tPaceSec,
      bestRecentVdot: bestRecentVdot ?? null, recentWeeklyMi, recentLongMi,
      longRunDow, restDow, qualityDows, trainingDaysPerWeek, distanceCategory: cat,
    },
    validateCtx: {
      level, isSteppingStoneToMarathon: false, priorPlanPeakLongMi: null,
      todayISO: startMondayISO, trainingDaysPerWeek,
      trailingAvgWeeklyMi: recentWeeklyMi > 0 ? recentWeeklyMi : null,
    },
  };
}
