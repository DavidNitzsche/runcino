/**
 * plan-builder · authoring algorithm for the plan-as-artifact.
 *
 * `buildPlan(inputs)` produces a full multi-week Plan. Session sizing
 * is proportion-based, not template-lookup based:
 *
 *   Long run   → 26% of weekly volume
 *   Threshold  → 18% (solo) / 17% (dual-quality week)
 *   Intervals  → 13% (dual-quality week only)
 *   Easy       → what remains, split across easy days
 *
 * These proportions match the advanced sample weeks in the training
 * research: Advanced HM at 60 mpw → Long 16 + T 10 + I 8 + Easy 26.
 *
 * Half marathon training is threshold-dominant.
 * Marathon training is durability-dominant.
 *
 * When the user explicitly selects a level, the plan starts from at
 * least 70% of that level's peak volume — so an Advanced runner who
 * selected Advanced but has a stale Strava cache doesn't get a
 * 1.5-mile easy-run plan.
 *
 * Two modes:
 *   race-prep   — A-race within ~16 weeks. BASE → BUILD → PEAK → TAPER → RACE_WEEK.
 *   maintenance — No A-race. 16 weeks flat aerobic, 1 quality/week.
 */

import type { CoachState } from '../lib/coach-state';
import { newId } from '../lib/plan-store';
import {
  type Plan, type PlanPhase, type PlanWeek, type PlanWorkout,
  type PlanMode, type WorkoutType, type PhaseLabel,
  snapshotFromState,
} from './plan-types';
import { PLAN_TEMPLATES, type PlanDistance } from './doctrine/plan_templates';
import { THRESHOLD_SESSION_PROGRESSION } from './doctrine/workouts';
import { RACE_WEEK_TEMPLATES } from './doctrine/race_week';
import { vdotSnapshot, pacesFromVdot, type DanielsPaceSet } from '../lib/vdot';

export type Level = 'beginner' | 'intermediate' | 'advanced';

/** Bump when the builder algorithm changes significantly. Plans authored
 *  at an older version are transparently rewritten on next load. */
export const BUILDER_VERSION = 9;

export interface BuildPlanRace {
  id: string;
  name: string;
  dateISO: string;
  distanceMi: number;
  priority: 'A' | 'B' | 'C';
}

export interface BuildPlanInputs {
  state: CoachState;
  prefs: {
    longRunDow: number;
    qualityDows: number[];
    restDow: number;
    level?: Level;
  };
  race?: BuildPlanRace;
  todayISO?: string;
  planId?: string;
  userId?: string;
}

// ─────────────────────────────────────────────────────────────────
// Proportion constants — grounded in the research example weeks.
// Advanced HM 60 mpw: Long 16 (27%) + T 10 (17%) + I 8 (13%) + Easy 26 (43%)
// ─────────────────────────────────────────────────────────────────

const LONG_PCT   = 0.26;   // Long run as share of weekly
const T_SOLO_PCT = 0.18;   // Threshold only (1 quality day)
const T_DUAL_PCT = 0.17;   // Threshold in dual-quality week
const I_DUAL_PCT = 0.13;   // Intervals in dual-quality week

// ─────────────────────────────────────────────────────────────────
// Level helpers
// ─────────────────────────────────────────────────────────────────

export function autoDetectLevel(weeklyAvg4w: number): Level {
  if (weeklyAvg4w >= 40) return 'advanced';
  if (weeklyAvg4w >= 20) return 'intermediate';
  return 'beginner';
}

// ─────────────────────────────────────────────────────────────────
// Doctrine-grounded lookups — all volume targets come from
// doctrine/plan_templates.ts which is the authoritative source.
// ─────────────────────────────────────────────────────────────────

function distanceToPlanDistance(distanceMi: number): PlanDistance {
  if (distanceMi >= 22) return 'marathon';
  if (distanceMi >= 11) return 'half_marathon';
  if (distanceMi >= 6)  return '10K';
  return '5K';
}

function doctrineTemplate(distanceMi: number, level: Level) {
  const planDistance = distanceToPlanDistance(distanceMi);
  return PLAN_TEMPLATES.value.find(
    t => t.distance === planDistance && t.level === level,
  );
}

/** Peak weekly mileage for a (race distance, level) pair.
 *  Conservative: low (peakWeeklyMpwLow) end so the ramp is achievable.
 *  Values come from doctrine/plan_templates.ts (Research/22). */
export function peakVolumeForLevel(distanceMi: number, level: Level): number {
  return doctrineTemplate(distanceMi, level)?.peakWeeklyMpwLow ?? 25;
}

/** Peak long-run mileage for a (race distance, level) pair.
 *  Values come from doctrine/plan_templates.ts (Research/22). */
export function peakLongRunForLevel(distanceMi: number, level: Level): number {
  return doctrineTemplate(distanceMi, level)?.peakLongRunMiLow ?? 10;
}

/** Minimum weekly starting volume when the user explicitly picks a level.
 *  An Advanced runner who selects Advanced should not get a plan anchored
 *  at 20 mi/wk just because their Strava cache is stale. */
export function levelMinStartMpw(distanceMi: number, level: Level): number {
  return Math.round(peakVolumeForLevel(distanceMi, level) * 0.70);
}

/** Minimum easy run to prescribe. Days that can't reach this are
 *  dropped to 0 (effectively rest) rather than prescribing junk mileage. */
export function minEasyRunMi(level: Level): number {
  if (level === 'advanced')     return 4;
  if (level === 'intermediate') return 3;
  return 2;
}

// ─────────────────────────────────────────────────────────────────
// Phase decomposition
// ─────────────────────────────────────────────────────────────────

interface PhaseSlice {
  label: PhaseLabel;
  startWeekIdx: number;
  endWeekIdx: number;
  rationale: string;
  citation: string;
}

/** Split N weeks into training phases. */
export function planPhases(totalWeeks: number, mode: PlanMode): PhaseSlice[] {
  if (mode === 'maintenance') {
    return [{
      label: 'MAINTENANCE',
      startWeekIdx: 0,
      endWeekIdx: totalWeeks - 1,
      rationale: 'No A-race — holding aerobic base with 1 quality session/week.',
      citation: 'Advanced training research §13 Periodization',
    }];
  }

  if (totalWeeks <= 1) {
    return [{
      label: 'RACE_WEEK',
      startWeekIdx: 0,
      endWeekIdx: 0,
      rationale: 'Race week — shakeout + race only.',
      citation: 'Advanced training research §12 Tapering',
    }];
  }

  const raceWeekIdx = totalWeeks - 1;
  const taperWeekIdx = totalWeeks - 2;
  const buildable = totalWeeks - 2;  // weeks before taper/race
  // 4:4:3 base/build/peak split
  const baseEnd  = Math.max(0, Math.floor(buildable * 4 / 11) - 1);
  const buildEnd = Math.max(baseEnd + 1, Math.floor(buildable * 8 / 11) - 1);
  const peakEnd  = taperWeekIdx - 1;

  const slices: PhaseSlice[] = [];
  if (baseEnd >= 0) {
    slices.push({
      label: 'BASE',
      startWeekIdx: 0,
      endWeekIdx: baseEnd,
      rationale: 'Aerobic base — durability before the quality load climbs.',
      citation: 'Advanced training research §13.1 Phase 1: Base / speed support',
    });
  }
  if (buildEnd > baseEnd) {
    slices.push({
      label: 'BUILD',
      startWeekIdx: baseEnd + 1,
      endWeekIdx: buildEnd,
      rationale: 'Threshold-dominant block — LT continuous + VO2max introduction.',
      citation: 'Advanced training research §13.2 Phase 2: Threshold build',
    });
  }
  if (peakEnd > buildEnd) {
    slices.push({
      label: 'PEAK',
      startWeekIdx: buildEnd + 1,
      endWeekIdx: peakEnd,
      rationale: 'Race-specific — long runs with race-pace finish + sharpening.',
      citation: 'Advanced training research §13.3 Phase 3: Race-specific',
    });
  }
  if (taperWeekIdx > peakEnd) {
    slices.push({
      label: 'TAPER',
      startWeekIdx: taperWeekIdx,
      endWeekIdx: taperWeekIdx,
      rationale: 'Volume −40%, intensity touches preserved. Not rest — fatigue reduction.',
      citation: 'Advanced training research §12 Tapering',
    });
  }
  slices.push({
    label: 'RACE_WEEK',
    startWeekIdx: raceWeekIdx,
    endWeekIdx: raceWeekIdx,
    rationale: 'Shakeout + race day.',
    citation: 'Advanced training research §15 Race execution',
  });
  return slices;
}

// ─────────────────────────────────────────────────────────────────
// Weekly volume curve
// ─────────────────────────────────────────────────────────────────

/** Compute volume target per week. Ramps startMpw → peakMpw at ≤10%/wk,
 *  cutback every 3rd week (−18%), taper −40%, race week ballpark. */
export function weeklyVolumeCurve(
  weeksTotal: number,
  startMpw: number,
  peakMpw: number,
  phases: PhaseSlice[],
): { volumeMi: number[]; isCutback: boolean[]; isPeak: boolean[]; isRaceWeek: boolean[] } {
  const volumeMi  = new Array(weeksTotal).fill(0);
  const isCutback = new Array(weeksTotal).fill(false);
  const isPeak    = new Array(weeksTotal).fill(false);
  const isRaceWeek = new Array(weeksTotal).fill(false);

  if (phases.length === 1 && phases[0].label === 'MAINTENANCE') {
    for (let i = 0; i < weeksTotal; i++) {
      volumeMi[i] = (i + 1) % 3 === 0
        ? round1(startMpw * 0.82)
        : startMpw;
      if ((i + 1) % 3 === 0) isCutback[i] = true;
    }
    return { volumeMi, isCutback, isPeak, isRaceWeek };
  }

  const peakSlice    = phases.find(p => p.label === 'PEAK');
  const buildSlice   = phases.find(p => p.label === 'BUILD');
  const taperSlice   = phases.find(p => p.label === 'TAPER');
  const raceWeekSlice = phases.find(p => p.label === 'RACE_WEEK');

  const peakAtIdx =
    peakSlice  ? peakSlice.endWeekIdx  :
    buildSlice ? buildSlice.endWeekIdx :
    Math.max(0, weeksTotal - 3);

  for (let i = 0; i <= peakAtIdx; i++) {
    const t = peakAtIdx === 0 ? 1 : i / peakAtIdx;
    let v = startMpw + (peakMpw - startMpw) * t;
    if (i > 0) {
      const priorIntent = startMpw + (peakMpw - startMpw) * ((i - 1) / Math.max(1, peakAtIdx));
      v = Math.min(v, priorIntent * 1.10);
    }
    if ((i + 1) % 3 === 0 && i !== peakAtIdx) {
      v = v * 0.82;
      isCutback[i] = true;
    }
    volumeMi[i] = round1(v);
    if (i === peakAtIdx) isPeak[i] = true;
  }

  if (taperSlice) {
    const peakVol = volumeMi[peakAtIdx];
    for (let i = taperSlice.startWeekIdx; i <= taperSlice.endWeekIdx; i++) {
      const drop = (i - peakAtIdx) === 1 ? 0.38 : 0.55;
      volumeMi[i] = round1(peakVol * (1 - drop));
    }
  }

  if (raceWeekSlice) {
    const idx = raceWeekSlice.startWeekIdx;
    isRaceWeek[idx] = true;
    volumeMi[idx] = round1(startMpw * 0.35);
  }

  return { volumeMi, isCutback, isPeak, isRaceWeek };
}

// ─────────────────────────────────────────────────────────────────
// Day-of-week layout
// ─────────────────────────────────────────────────────────────────

interface DayPick {
  type: WorkoutType;
  isQuality: boolean;
  isLong: boolean;
}

/** Assign workout types to each day of the week.
 *  BASE / MAINTENANCE: 1 quality (threshold)
 *  BUILD / PEAK:       2 quality (threshold + intervals)
 *  TAPER:              1 quality (short threshold)
 *  RACE_WEEK:          tune-up (Tue) + shakeout + race */
export function weekShape(
  phaseLabel: PhaseLabel,
  prefs: { longRunDow: number; qualityDows: number[]; restDow: number },
  raceDow: number | null,
  raceDist?: number,
): DayPick[] {
  const days: DayPick[] = Array.from({ length: 7 }, () => ({
    type: 'easy' as WorkoutType, isQuality: false, isLong: false,
  }));

  if (prefs.restDow >= 0 && prefs.restDow < 7) {
    days[prefs.restDow] = { type: 'rest', isQuality: false, isLong: false };
  }
  if (prefs.longRunDow >= 0 && prefs.longRunDow < 7
      && prefs.longRunDow !== prefs.restDow) {
    days[prefs.longRunDow] = { type: 'long', isQuality: false, isLong: true };
  }

  const qualityCount: number =
    phaseLabel === 'BUILD' || phaseLabel === 'PEAK' ? 2 :
    phaseLabel === 'RACE_WEEK' ? 0 : 1;

  const candidates = prefs.qualityDows.filter(
    d => d >= 0 && d < 7 && d !== prefs.restDow && d !== prefs.longRunDow,
  );
  let assigned = 0;
  for (const d of candidates) {
    if (assigned >= qualityCount) break;
    days[d] = {
      type: assigned === 0 ? 'threshold' : 'interval',
      isQuality: true,
      isLong: false,
    };
    assigned++;
  }

  if (phaseLabel === 'RACE_WEEK' && raceDow != null) {
    // HM race: Tuesday gets the 4×1K tune-up session (Research/08 §9.3).
    // Tuesday = JS day-of-week 2.
    const isHmRace = raceDist != null && raceDist >= 10 && raceDist <= 15;
    for (let i = 0; i < 7; i++) {
      if (i === raceDow) {
        days[i] = { type: 'race', isQuality: false, isLong: false };
      } else if ((raceDow - i + 7) % 7 === 1) {
        days[i] = { type: 'shakeout', isQuality: false, isLong: false };
      } else if (isHmRace && i === 2) {
        // Tuesday tune-up: short quality session to stay sharp (Research/08 §9.3).
        days[i] = { type: 'threshold', isQuality: true, isLong: false };
      } else if (i === prefs.restDow) {
        days[i] = { type: 'rest', isQuality: false, isLong: false };
      } else {
        days[i] = { type: 'easy', isQuality: false, isLong: false };
      }
    }
  }

  return days;
}

// ─────────────────────────────────────────────────────────────────
// Top-level builder
// ─────────────────────────────────────────────────────────────────

export async function buildPlan(inputs: BuildPlanInputs): Promise<Plan> {
  const { state, prefs, race } = inputs;
  const todayISO = inputs.todayISO ?? state.now;
  const userId   = inputs.userId  ?? 'me';
  const planId   = inputs.planId  ?? newId();

  const today    = new Date(todayISO + 'T12:00:00Z');
  const raceDate = race ? new Date(race.dateISO + 'T12:00:00Z') : null;
  const daysToRace = raceDate
    ? Math.round((raceDate.getTime() - today.getTime()) / 86_400_000)
    : null;
  const mode: PlanMode =
    race && daysToRace != null && daysToRace > 0 && daysToRace <= 16 * 7
      ? 'race-prep' : 'maintenance';

  const level: Level = prefs.level ?? autoDetectLevel(state.volume.weeklyAvg4w);
  const raceDist = race?.distanceMi ?? 13.1;

  // VDOT-derived Daniels pace bands (null when no race result is available).
  const vdotSnap = vdotSnapshot(state);
  const paces: DanielsPaceSet | null = vdotSnap ? pacesFromVdot(vdotSnap.vdot) : null;

  // Plan window
  const startMonday = startOfWeekMonday(today);
  let totalWeeks: number;
  let goalISO: string;
  if (mode === 'race-prep' && raceDate) {
    const raceMonday = startOfWeekMonday(raceDate);
    totalWeeks = Math.max(
      1,
      Math.round((raceMonday.getTime() - startMonday.getTime()) / (7 * 86_400_000)) + 1,
    );
    goalISO = race!.dateISO;
  } else {
    totalWeeks = 16;
    const end = new Date(startMonday);
    end.setUTCDate(end.getUTCDate() + totalWeeks * 7 - 1);
    goalISO = end.toISOString().slice(0, 10);
  }

  const phaseSlices = planPhases(totalWeeks, mode);

  // Volume targets
  const peakMpwTarget = mode === 'race-prep'
    ? peakVolumeForLevel(raceDist, level)
    : Math.max(8, state.volume.weeklyAvg4w);

  const peakLongTarget = mode === 'race-prep'
    ? peakLongRunForLevel(raceDist, level)
    : Math.max(4, round1(state.volume.longestTrainingRunLast28Mi * 0.5));

  // When the user explicitly sets their level, honour the level's minimum
  // starting volume — avoids embarrassingly tiny runs from stale Strava data.
  const actualMpw = Math.max(8, state.volume.weeklyAvg4w);
  const startMpw = prefs.level != null
    ? Math.max(actualMpw, levelMinStartMpw(raceDist, level))
    : actualMpw;

  const curve = weeklyVolumeCurve(totalWeeks, startMpw, peakMpwTarget, phaseSlices);

  const phases: PlanPhase[] = phaseSlices.map(ps => ({
    id: newId(),
    label: ps.label,
    startWeekIdx: ps.startWeekIdx,
    endWeekIdx: ps.endWeekIdx,
    rationale: ps.rationale,
    citation: ps.citation,
  }));

  const raceDow  = raceDate ? raceDate.getUTCDay() : null;
  const peakVol  = (() => {
    const peakIdx = curve.isPeak.indexOf(true);
    return peakIdx >= 0 ? curve.volumeMi[peakIdx] : peakMpwTarget;
  })();
  const minEasy  = minEasyRunMi(level);

  const weeks: PlanWeek[] = [];

  for (let w = 0; w < totalWeeks; w++) {
    const weekStart    = new Date(startMonday);
    weekStart.setUTCDate(weekStart.getUTCDate() + w * 7);
    const weekStartISO = weekStart.toISOString().slice(0, 10);

    const phaseSlice = phaseSlices.find(p => w >= p.startWeekIdx && w <= p.endWeekIdx)!;
    const phaseRow   = phases.find(p =>
      p.label === phaseSlice.label && p.startWeekIdx === phaseSlice.startWeekIdx,
    )!;

    const shape    = weekShape(
      phaseSlice.label,
      prefs as { longRunDow: number; qualityDows: number[]; restDow: number },
      curve.isRaceWeek[w] ? raceDow : null,
      raceDist,
    );
    const weeklyMi = curve.volumeMi[w];

    // ── Long run ────────────────────────────────────────────────
    let longMi = 0;
    if (phaseSlice.label !== 'RACE_WEEK' && shape.some(d => d.isLong)) {
      if (phaseSlice.label === 'TAPER') {
        longMi = round1(peakLongTarget * 0.50);
      } else {
        // Scale toward peakLongTarget proportionally with weekly volume.
        // Minimum: 60% of peakLong in BASE so early weeks aren't trivial.
        const scaledLong = round1(peakLongTarget * Math.min(1, weeklyMi / peakVol));
        longMi = phaseSlice.label === 'BASE'
          ? Math.max(scaledLong, round1(peakLongTarget * 0.60))
          : scaledLong;
        if (curve.isCutback[w]) longMi = round1(peakLongTarget * 0.75);
      }
      // Hard cap: long run ≤ 50% of weekly. Lower-volume plans (e.g. HM beginner
      // at 22 mpw) legitimately have long runs = 40-50% of weekly volume.
      longMi = Math.min(longMi, round1(weeklyMi * 0.50));
    }

    // ── Quality sessions (proportion-based) ─────────────────────
    const numQ = shape.filter(d => d.isQuality).length;
    let threshMi  = 0;
    let intervalMi = 0;

    if (phaseSlice.label === 'TAPER') {
      // Taper: keep intensity alive with a shorter touch
      threshMi = Math.max(4, round1(weeklyMi * 0.15));
    } else if (numQ === 2) {
      threshMi   = round1(weeklyMi * T_DUAL_PCT);
      intervalMi = round1(weeklyMi * I_DUAL_PCT);
    } else if (numQ === 1) {
      threshMi = round1(weeklyMi * T_SOLO_PCT);
    }

    // Minimum quality size: at least 4 mi total (warmup + some work + cooldown)
    if (threshMi > 0)   threshMi   = Math.max(4, threshMi);
    if (intervalMi > 0) intervalMi = Math.max(4, intervalMi);

    // ── Easy days ───────────────────────────────────────────────
    const usedMi     = longMi + threshMi + (numQ >= 2 ? intervalMi : 0);
    const easyBudget = Math.max(0, weeklyMi - usedMi);
    const easySlots  = shape.reduce<number[]>((acc, d, i) => {
      if (!d.isQuality && !d.isLong && d.type === 'easy') acc.push(i);
      return acc;
    }, []);

    // How many easy days the budget can support at minEasy?
    const activeDays = easyBudget >= minEasy
      ? Math.min(easySlots.length, Math.max(1, Math.floor(easyBudget / minEasy)))
      : easySlots.length > 0 ? 1 : 0;
    const easyPerDay = activeDays > 0 ? round1(easyBudget / activeDays) : 0;

    // ── Assemble distances array indexed by JS dow ───────────────
    const distances: number[] = new Array(7).fill(0);
    for (let i = 0; i < 7; i++) {
      const d = shape[i];
      if (d.type === 'rest' || d.type === 'race') continue;
      if (d.type === 'shakeout') { distances[i] = 3; continue; }
      if (d.isLong) { distances[i] = longMi; continue; }
      if (d.isQuality) {
        // threshold first, then interval
        const qualityIdx = shape.slice(0, i + 1).filter(x => x.isQuality).length - 1;
        distances[i] = qualityIdx === 0 ? threshMi : intervalMi;
        continue;
      }
      // Easy day
      const easyIdx = shape.slice(0, i + 1).filter(
        x => !x.isQuality && !x.isLong && x.type === 'easy',
      ).length - 1;
      distances[i] = easyIdx < activeDays ? easyPerDay : 0;
    }

    // Race day gets actual race distance
    if (curve.isRaceWeek[w] && race && raceDow != null) {
      distances[raceDow] = race.distanceMi;
    }

    // ── Materialize workout rows ─────────────────────────────────
    const workouts: PlanWorkout[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const d       = new Date(weekStart);
      d.setUTCDate(weekStart.getUTCDate() + offset);
      const dateISO = d.toISOString().slice(0, 10);
      const jsDow   = d.getUTCDay();
      const pick    = shape[jsDow];
      // If this easy day was dropped (distance=0 but type=easy), mark as rest
      const effectiveType: WorkoutType =
        pick.type === 'easy' && distances[jsDow] === 0 && !pick.isQuality && !pick.isLong
          ? 'rest'
          : pick.type;

      workouts.push({
        id: newId(),
        dateISO,
        dow: jsDow,
        type: effectiveType,
        distanceMi: distances[jsDow],
        paceTargetSPerMi: paceTargetFor(effectiveType, paces),
        durationMin: null,
        isQuality: pick.isQuality,
        isLong: pick.isLong,
        notes: notesFor(effectiveType, phaseSlice.label, level, w, curve.isCutback[w]),
        subLabel: subLabelFor(effectiveType, phaseSlice.label, w, curve.isCutback[w]),
        originalDateISO: dateISO,
        originalType: effectiveType,
        originalDistanceMi: distances[jsDow],
        mutations: [],
      });
    }

    weeks.push({
      id: newId(),
      weekIdx: w,
      weekStartISO,
      phaseId: phaseRow.id,
      isCutback: curve.isCutback[w],
      isPeak: curve.isPeak[w],
      isRaceWeek: curve.isRaceWeek[w],
      rationale: weekRationale(w, phaseSlice.label, curve.isCutback[w], curve.isPeak[w], curve.isRaceWeek[w]),
      workouts,
    });
  }

  return {
    id: planId,
    userId,
    mode,
    raceId: race?.id ?? null,
    goalISO,
    authoredISO: new Date().toISOString(),
    authoredFromState: snapshotFromState(state, level, BUILDER_VERSION),
    phases,
    weeks,
    archivedISO: null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function startOfWeekMonday(d: Date): Date {
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  const out = new Date(d);
  out.setUTCDate(d.getUTCDate() + delta);
  out.setUTCHours(12, 0, 0, 0);
  return out;
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

/** Center of a pace band in s/mi (null when paces unavailable or not applicable). */
function paceCenter(band: { lowS: number; highS: number } | undefined | null): number | null {
  if (!band) return null;
  return Math.round((band.lowS + band.highS) / 2);
}

/** VDOT-derived pace target in s/mi for a given workout type. */
function paceTargetFor(type: WorkoutType, paceSet: DanielsPaceSet | null): number | null {
  if (!paceSet) return null;
  switch (type) {
    case 'easy':      return paceCenter(paceSet.E);
    case 'long':      return paceCenter(paceSet.E);
    case 'recovery':  return paceCenter(paceSet.E) ? Math.round(paceCenter(paceSet.E)! + 30) : null;
    case 'threshold': return paceCenter(paceSet.T);
    case 'interval':  return paceCenter(paceSet.I);
    case 'mp':        return paceCenter(paceSet.M);
    case 'shakeout':  return paceCenter(paceSet.E);
    default:          return null; // rest, race — no target
  }
}

/** Short tile label for the calendar — null means use the type default. */
function subLabelFor(t: WorkoutType, phase: PhaseLabel, weekIdx: number, isCutback: boolean): string | null {
  if (t === 'long') {
    if (phase === 'TAPER') return 'Long Run · Taper';
    // All non-cutback BUILD/PEAK long runs are HM-specific (Research/22 §3).
    // Alternate between two formats to vary the stimulus.
    if (!isCutback && (phase === 'BUILD' || phase === 'PEAK')) {
      return weekIdx % 2 === 0 ? 'Long Run · HM Finish' : 'Long Run · Progression';
    }
    return null; // default: "Long Run · Steady"
  }
  if (t === 'threshold') {
    const tsp = THRESHOLD_SESSION_PROGRESSION.value;
    if (phase === 'RACE_WEEK') return 'Race Week Tune-Up';
    if (phase === 'BASE') return tsp.BASE.label;
    if (phase === 'TAPER') return tsp.TAPER.label;
    if (phase === 'PEAK') return tsp.PEAK.label;
    if (phase === 'BUILD') {
      return weekIdx % 2 === 1 ? tsp.BUILD_EARLY.label : tsp.BUILD_LATE.label;
    }
    return null;
  }
  return null;
}

function notesFor(t: WorkoutType, phase: PhaseLabel, _level: Level, weekIdx: number, isCutback: boolean): string {
  const tsp = THRESHOLD_SESSION_PROGRESSION.value;
  switch (t) {
    case 'rest':     return 'Full rest day.';
    case 'easy':     return 'Easy / conversational pace. No watch-staring — if you can\'t hold a sentence, slow down.';
    case 'recovery': return 'Recovery run — genuinely easy. Below easy pace. Legs should feel better when you finish.';
    case 'shakeout': return 'Short shakeout. Optional 4 strides at the end. Stay loose.';
    case 'race':     return 'Race day.';
    case 'mp':       return 'Marathon pace block — find the rhythm, practice fueling, show restraint.';

    case 'long': {
      if (phase === 'TAPER') return 'Taper long — easy pace, cut distance. Absorb the work.';
      const isSpecificWeek = !isCutback && (phase === 'BUILD' || phase === 'PEAK');
      if (isSpecificWeek) {
        // Alternate two HM-specific long run formats. Research/22 §3.
        if (weekIdx % 6 < 3) {
          return 'Long run with HM finish — run the first two-thirds easy, then close the last 3–5 miles at goal half-marathon effort. Last 4 miles at HM goal pace: run the first 10 easy, then gradually drop to race effort over the final stretch — negative split the whole thing. (Research/22 §3)';
        }
        return 'Progression long run — first third easy, middle third steady (marathon effort), final third squeezing toward HM goal pace. Three gears, controlled the whole way — not a race, a controlled fade-in. (Research/22 §3)';
      }
      return phase === 'PEAK'
        ? 'Long run — easy throughout. Save the race-specific work for the designated HM-finish weeks.'
        : 'Long run at easy conversational pace. Durability, not speed.';
    }

    case 'threshold': {
      // RACE_WEEK Tuesday tune-up: 4×1K at HMP (Research/08 §9.3).
      if (phase === 'RACE_WEEK') {
        const tuneUp = RACE_WEEK_TEMPLATES.value.half_sunday.find(d => d.day === 'Tue');
        return tuneUp
          ? `Race week tune-up — ${tuneUp.workout}. Keep it sharp, not draining. (Research/08 §9.3)`
          : 'Race week tune-up — 4–5 mi w/ 4 × 1K at goal HMP, 90 sec jog. Sharp, not draining. (Research/08 §9.3)';
      }
      // Phase-specific threshold progressions from THRESHOLD_SESSION_PROGRESSION doctrine.
      if (phase === 'BASE') return tsp.BASE.prescription;
      if (phase === 'TAPER') return tsp.TAPER.prescription;
      if (phase === 'BUILD' || phase === 'PEAK') {
        // BUILD: alternate early (odd weekIdx → 3×2mi blocks) and late (even → 2×3mi).
        // PEAK: continuous HM tempo.
        if (phase === 'PEAK') return tsp.PEAK.prescription;
        return weekIdx % 2 === 1 ? tsp.BUILD_EARLY.prescription : tsp.BUILD_LATE.prescription;
      }
      return tsp.BASE.prescription;
    }

    case 'interval': {
      if (phase === 'BASE') return 'VO₂max intervals — warm up 1.5 mi, then 5 × 800m at 5K effort, jog equal distance between. Finish feeling like you could do one more rep. (Research/04 §I-pace)';
      if (phase === 'BUILD') return 'VO₂max intervals — 5–6 × 1K at 5K effort, 90 sec jog between. Fast and controlled — this is speed support for your threshold work. (Research/04 §I-pace, Research/22 §3)';
      if (phase === 'PEAK') return 'VO₂max sharpener — 4 × 1200m at 10K effort, 2 min jog between. Economy and top-end speed. (Research/04 §I-pace)';
      return 'VO₂max intervals — 5K to 10K effort. 1K reps with equal-time jog recovery. (Research/04 §I-pace)';
    }

    default: return '';
  }
}

function weekRationale(
  idx: number, phase: PhaseLabel,
  isCutback: boolean, isPeak: boolean, isRaceWeek: boolean,
): string {
  if (isRaceWeek) return 'Race week — shakeout + race day.';
  if (isPeak)     return `Peak week — highest volume of the plan.`;
  if (isCutback)  return `Cutback week — volume down ~18% to absorb the work.`;
  return `Week ${idx + 1} · ${phase.toLowerCase()} phase.`;
}
