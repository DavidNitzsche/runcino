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
  spacedQualityDowsFromAvailable,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ResolvedPrescriptions,
  composePlan,
  composeMaintenancePlan,
  composeRecoveryPlan,
  finalizeComposedPlan,
  weekStartBoundaryOf,
} from './generate';
import { lookupTierTarget, pickPlanMode, type PlanMode } from './goal-tiers';
import { tPaceFromGoal, conservativeVdotFromMileage } from './spec-builder';
import { vdotFromRace, tPaceFromVdot, predictRaceTime } from '@/lib/training/vdot';
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

/** Best VDOT across self-reported PRs · how the engine seeds current fitness.
 *  LSP2-2 · only PRs from the last ~6mo ('<6mo' bucket) count as current fitness.
 *  A sub-3 marathon from 18 months ago does not reflect today's shape.
 *  Cite: Research/01 §"Fitness anchor recency"; Pfitzinger §"Using recent races". */
function bestVdotFromHistory(rh: SimInputs['raceHistory']): number | undefined {
  let best: number | undefined;
  for (const e of rh) {
    if (e.whenRaced !== '<6mo') continue; // LSP2-2: only very recent PRs
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
    qualityStrandedByAvailability?: boolean;
    recentWeeklyMi?: number | null;
  };
}
export type SimBuildResult = SimBuildOk | { ok: false; reason: string };

/** Native onboarding answers → composed plan via the real engine. */
export function buildSimPlan(sim: SimInputs, rxOverride?: { rxQuality: ResolvedPrescriptions; rxRaceSpecific: ResolvedPrescriptions }): SimBuildResult {
  const startMondayISO = sim.startDateISO;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startMondayISO)) return { ok: false, reason: 'invalid start date' };

  // ── shared runner-profile derivation (mirrors loadGeneratorInputs) ──
  const level = sim.experienceLevel as LevelKey;
  const recentWeeklyMi = recentWeeklyMiFromBucket(sim.weeklyMileageBucket);
  let recentLongMi = recentLongMiFromBucket(sim.longestRunBucket);
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
    qualityDows = spacedQualityDowsFromAvailable(avail, longRunDow);
  }
  // SIM-FIDELITY (2026-06-24) · the sim uses the LITERAL chosen start date, exactly as production
  // onboarding does (generate.ts loadGeneratorInputs / seed-from-onboarding), so the previewed week-0
  // matches what production builds — including frontLoadFirstRun ("run on day one" on the chosen start).
  // The earlier MAINT-ALIGN-1 snap-to-longRunDow was reverted: it mutated the week-0 day shape away
  // from production AND only aligned sun-long weeks anyway. Calendar-row alignment is now handled purely
  // at render time (app/sim/plan/page.tsx groups days into rows by PLAN-WEEK membership, so no Sun-Sat
  // row ever merges two training weeks — for ANY long-run day), which is the correct layer for a display
  // concern. Keeping startMondayISO un-snapped is what makes the sim a faithful preview.

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
  // COH-1 · clamp the reported longest run to be coherent with weekly volume (mirrors the loader).
  // SIM-COH-1 · cap the coherence floor to the bucket's upper bound so switching buckets
  // always produces a visibly different plan (prevents "nothing changes" when
  // avg-run-distance > bucket ceiling — e.g. 30mpw / 3 days → avg=10mi overrides both
  // "0-3mi" and "3-6mi" to 10mi, making them identical).
  const SIM_LONG_BUCKET_MAX: Record<string, number> = { '0-3': 3, '3-6': 6, '6-10': 10, '10+': 999 };
  const _bucketMax = SIM_LONG_BUCKET_MAX[sim.longestRunBucket as string] ?? 999;
  const _avgRun = trainingDaysPerWeek ? Math.round(recentWeeklyMi / trainingDaysPerWeek) : 0;
  recentLongMi = Math.min(
    Math.max(recentLongMi, Math.min(_avgRun, _bucketMax)),
    Math.round(recentWeeklyMi * 0.8),
  );
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
    // SIM-FIDELITY · snap the goal deadline to the runner's LONG-RUN day, exactly as production does
    // (generate.ts:3385 · raceDateISO = weekStartBoundaryOf(raw, (longRunDow+1)%7) + 6, which lands on
    // longRunDow). The earlier unconditional Saturday-snap diverged from production for 6 of 7 long-run
    // days — the sim previewed a Saturday race the runner would never get — and, with weeks now
    // grouped by plan-week at render time, a non-Saturday long would leave trailing post-race rest days.
    // Placing the race on longRunDow keeps it the natural end of its (now plan-week-grouped) final week.
    const rawDeadline = addDaysISO(startMondayISO, weeks * 7);
    raceDateISO = addDaysISO(weekStartBoundaryOf(rawDeadline, ((longRunDow + 1) % 7)), 6);
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

  // PACE-3 · guard an absurd implied pace (e.g. a wheel hours-truncation putting an HM
  // time onto a 5K goal → ~30 min/mi threading into every workout). Treat an implausibly
  // slow sub-HM goal as absent → it falls to the currentT fitness anchor below.
  // GOAL-4 · null an off-table goal (impossibly slow sub-HM, or off-the-top faster-than-VDOT-85) so
  // it can't thread impossible paces; falls to the currentT anchor (VAR-05). Mirrors the loader.
  if (goalSec != null && (
    (raceDistanceMi < 13.1 && goalSec / raceDistanceMi > 900) ||
    (vdotFromRace(goalSec, raceDistanceMi) == null && goalSec < (predictRaceTime(85, raceDistanceMi) ?? 0))
  )) goalSec = null;
  const goalPaceSec = goalSec ? Math.round(goalSec / raceDistanceMi) : null;
  // VAR-05 · by-feel (no goal) or ultra (PACE-5 → tPaceFromGoal null) anchors T to the
  // runner's actual fitness (currentT), never the flat 480s/mi literal. Mirrors composePlan.
  const currentT = tPaceFromVdot(bestRecentVdot ?? conservativeVdotFromMileage(recentWeeklyMi));
  // NEW-A · floor tPaceSec at currentT (mirrors the loader) so maintenance/recovery don't inherit a slow soft goal.
  const goalTpSim = tPaceFromGoal(goalSec, raceDistanceMi);
  const tPaceSec = (goalTpSim != null && currentT != null ? Math.min(goalTpSim, currentT) : goalTpSim) ?? currentT ?? 480;

  if (mode === 'race-prep') {
    const d = daysBetween(startMondayISO, raceDateISO);
    if (d < 14) return { ok: false, reason: 'Race is under 2 weeks out — too close to build a plan. Push it later or pick a longer plan.' };
    if (d > 365) return { ok: false, reason: 'Race is over a year out — the engine plans within a year.' };
  }

  const cat = distanceCategoryOfPublic(raceDistanceMi);
  // FID-2 · prefer the real level + phase-aware prescriptions (resolved by the route
  // from workout_library, matching the production engine); fall back to the inline
  // catalog when not provided (e.g. unit tests with no DB).
  const rxQuality = rxOverride?.rxQuality ?? inlinePrescriptions(cat);
  const rxRaceSpecific = rxOverride?.rxRaceSpecific ?? inlinePrescriptions(cat);

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
    const tier = lookupTierTarget(goalPaceSec, raceDistanceMi, level).tier; // VAR-01 · experience clamps the tier
    if (mode !== 'recovery' && sim.goalMode === 'race') {
      nextRace = { slug: 'sim-race', name: 'Goal race', date: raceDateISO, distanceMi: raceDistanceMi, goalPaceSec };
    }
    const nonRace: ComposeNonRaceInput = {
      startMondayISO, level, recentWeeklyMi, recentLongMi, recentPeakWeeklyMi: recentWeeklyMi,
      easyDayMedianMi, longRunDow, restDow, qualityDows, availableDows, trainingDaysPerWeek, crossModes,
      tier, nextRace, lastRaceFinished, rxQuality, tPaceSec, lthr: sim.lthr ?? null,
    };
    composed = mode === 'recovery' ? composeRecoveryPlan(nonRace) : composeMaintenancePlan(nonRace);

    // MAINT+RACE-PREP CHAIN (2026-06-24) · when a race is scheduled outside the build
    // window, show maintenance weeks THEN the full race-prep plan in a single calendar.
    // The user sees the complete picture: "maintenance until the build window opens, then
    // your race plan." Without this, the sim only shows the maintenance block and the
    // race-prep plan is invisible.
    if (mode === 'maintenance' && sim.goalMode === 'race') {
      const maintWeeksArr = composed.weeks;
      const racePrepStartISO = addDaysISO(startMondayISO, maintWeeksArr.length * 7);
      const daysTillRace = daysBetween(racePrepStartISO, raceDateISO);
      if (daysTillRace >= 14 && daysTillRace <= 365) {
        const maintPeakWeekly = maintWeeksArr.reduce((mx, w) => Math.max(mx, w.weeklyMi), recentWeeklyMi);
        const maintPeakLong = maintWeeksArr.reduce(
          (mx, w) => Math.max(mx, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi), 0),
          recentLongMi,
        );
        const racePrepInput: ComposePlanInput = {
          raceDistanceMi, goalSec, goalPaceSec, raceDateISO,
          startMondayISO: racePrepStartISO, level,
          recentWeeklyMi: maintPeakWeekly, easyDayMedianMi,
          recentLongMi: Math.max(maintPeakLong, 1),
          recentQualityDistanceMi: undefined, recentQualityPerWeek: undefined,
          bestRecentVdot, tsbAtStart: undefined, horizonRaces: undefined, isMidBlock: false,
          longRunDow, restDow, qualityDows, availableDows, trainingDaysPerWeek, crossModes,
          rxQuality, rxRaceSpecific, tPaceSec, lthr: sim.lthr ?? null, maxHr: sim.maxHr ?? null,
        };
        try {
          const racePrepPlan = composePlan(racePrepInput);
          finalizeComposedPlan(racePrepPlan, raceDistanceMi);
          composed = {
            ...racePrepPlan,
            weeks: [...maintWeeksArr, ...racePrepPlan.weeks],
            totalWeeks: maintWeeksArr.length + racePrepPlan.weeks.length,
            vols: [...composed.vols, ...racePrepPlan.vols],
          };
        } catch { /* compose failed · show maintenance block only */ }
      }
    }
  }
  finalizeComposedPlan(composed, raceDistanceMi);
  // VOLS-SNAP (2026-06-24) · re-snapshot the volume-curve series from the VOL-1/COH-4-reconciled
  // weeklyMi, exactly as the production generatePlan path does (generate.ts:3098). finalize mutates
  // weeklyMi to the realized day-sum but never touches composed.vols, which composePlan returned
  // straight from the un-reconciled curve budget — so without this the sim API ships two volume series
  // that disagree by up to 33mi (and the maint+race-prep chain concatenated two pre-finalize budgets).
  composed.vols = composed.weeks.map((w) => w.weeklyMi);

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
      // GOAL-1 · available_days stranded quality to empty → composer folds to long+easy (valid)
      qualityStrandedByAvailability: availableDows != null && qualityDows.length === 0,
      recentWeeklyMi, // CC-2 · cold-start ramp base
    },
  };
}
