/**
 * plan-builder · authoring algorithm for the plan-as-artifact rewrite.
 *
 * `buildPlan(state, prefs, race?)` produces a full multi-week Plan:
 * phases, weeks, workouts. Every number is either (a) doctrine-prescribed
 * for the level (Research/22 plan-template tables), (b) derived from
 * doctrine + the runner's current state (the ramp curve), or (c) from
 * Research/22 sample-week templates scaled to the week's volume target.
 *
 * Two modes:
 *   - race-prep: there's an A-race within ~16 weeks. Phases land at
 *     BASE → BUILD → PEAK → TAPER → RACE_WEEK with cutback every 3rd.
 *   - maintenance: no A-race in window. 16 weeks flat at ~current
 *     volume, 1 quality/week, long run on prefs.longRunDow at 50% of
 *     historical longest. No phase arc.
 *
 * The builder doesn't persist — call saveActivePlan(plan) afterward.
 * This separation keeps the function pure for tests.
 *
 * Citations:
 *  - Phase shape & cutback: Research/00a §Volume progression rules
 *  - Level bands & sample weeks: Research/22 §3-4
 *  - Long-run cap (≤25-30% of weekly): Research/00a §Volume progression rules
 *  - Race-week template: Research/08 §9.2 (HM) / Research/08 §9.1 taper
 *  - Maintenance: Research/22 §7 Maintenance Plan
 */

import type { CoachState } from '../lib/coach-state';
import { newId } from '../lib/plan-store';
import {
  type Plan, type PlanPhase, type PlanWeek, type PlanWorkout,
  type PlanMode, type WorkoutType, type PhaseLabel,
  snapshotFromState,
} from './plan-types';

export type Level = 'beginner' | 'intermediate' | 'advanced';

export interface BuildPlanRace {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD) of race day. */
  dateISO: string;
  distanceMi: number;
  priority: 'A' | 'B' | 'C';
}

export interface BuildPlanInputs {
  /** Coach state — provides current volume/recovery/race calendar. */
  state: CoachState;
  /** User-level prefs override CoachState.prefs for authoring. */
  prefs: {
    longRunDow: number;
    qualityDows: number[];
    restDow: number;
    /** Explicit level setting; omit to auto-detect from weeklyAvg4w. */
    level?: Level;
  };
  /** Target A-race (race-prep mode). Omit for maintenance. */
  race?: BuildPlanRace;
  /** Override "today" for tests / deterministic runs. */
  todayISO?: string;
  /** Plan ID — generated when omitted (real builds use newId()). */
  planId?: string;
  /** User id — defaults to 'me'. */
  userId?: string;
}

// ─────────────────────────────────────────────────────────────────
// Level autodetect — Research/22 band bottoms
// ─────────────────────────────────────────────────────────────────

export function autoDetectLevel(weeklyAvg4w: number): Level {
  if (weeklyAvg4w >= 40) return 'advanced';
  if (weeklyAvg4w >= 20) return 'intermediate';
  return 'beginner';
}

/** Peak weekly volume for a (distance, level) pair. Conservative ramp:
 *  pick the LOW end of each band, not the top (so the plan doesn't
 *  ask a 25mpw runner to ramp to 45 in 12 weeks). */
export function peakVolumeForLevel(distanceMi: number, level: Level): number {
  if (distanceMi >= 22) {
    // Marathon
    if (level === 'beginner')      return 30;
    if (level === 'intermediate')  return 45;
    return 65;
  }
  if (distanceMi >= 11) {
    // Half-marathon — Research/22 §3
    if (level === 'beginner')      return 25;     // band 22-28
    if (level === 'intermediate')  return 35;     // band 35-45 (low end)
    return 55;                                    // band 55-85 (low end)
  }
  if (distanceMi >= 8) {
    // 10K
    if (level === 'beginner')      return 20;
    if (level === 'intermediate')  return 32;
    return 50;
  }
  // 5K
  if (level === 'beginner')      return 14;
  if (level === 'intermediate')  return 26;
  return 42;
}

/** Peak long-run distance per Research/22 template constants. */
export function peakLongRunForLevel(distanceMi: number, level: Level): number {
  if (distanceMi >= 22) {
    if (level === 'beginner')      return 20;
    if (level === 'intermediate')  return 20;
    return 22;
  }
  if (distanceMi >= 11) {
    if (level === 'beginner')      return 10;
    if (level === 'intermediate')  return 12;
    return 15;
  }
  if (distanceMi >= 8) {
    if (level === 'beginner')      return 6;
    if (level === 'intermediate')  return 9;
    return 13;
  }
  if (level === 'beginner')      return 4;
  if (level === 'intermediate')  return 6;
  return 10;
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

/** Distribute N weeks across BASE/BUILD/PEAK/TAPER/RACE_WEEK.
 *  Doc: BASE (≈33%) → BUILD (≈33%) → PEAK (≈25%) → TAPER (1 wk)
 *       → RACE_WEEK (always 1 wk, the week race-day falls in). */
export function planPhases(totalWeeks: number, mode: PlanMode): PhaseSlice[] {
  if (mode === 'maintenance') {
    return [{
      label: 'MAINTENANCE',
      startWeekIdx: 0,
      endWeekIdx: totalWeeks - 1,
      rationale: 'No A-race in window — holding aerobic baseline with a single weekly quality session.',
      citation: 'Research/22 §7 Maintenance Plan',
    }];
  }
  // race-prep
  const slices: PhaseSlice[] = [];
  if (totalWeeks <= 1) {
    return [{
      label: 'RACE_WEEK',
      startWeekIdx: 0,
      endWeekIdx: 0,
      rationale: 'Race-week template — shakeout + race only.',
      citation: 'Research/08 §9.2 HM race-week template',
    }];
  }
  // The final week is always RACE_WEEK. The penultimate week is TAPER.
  const raceWeekIdx = totalWeeks - 1;
  const taperWeekIdx = totalWeeks - 2;
  const buildAndPeakWeeks = totalWeeks - 2;
  // Roughly split base/build/peak in 4:4:3 ratio (HM intermediate doc default).
  const baseEnd = Math.max(0, Math.floor(buildAndPeakWeeks * 4 / 11) - 1);
  const buildEnd = Math.max(baseEnd + 1, Math.floor(buildAndPeakWeeks * 8 / 11) - 1);
  const peakEnd = taperWeekIdx - 1;

  if (baseEnd >= 0) {
    slices.push({
      label: 'BASE',
      startWeekIdx: 0,
      endWeekIdx: baseEnd,
      rationale: `Aerobic base — building durability before the workload climbs.`,
      citation: 'Research/00a §Plan skeletons + Volume progression rules',
    });
  }
  if (buildEnd > baseEnd) {
    slices.push({
      label: 'BUILD',
      startWeekIdx: baseEnd + 1,
      endWeekIdx: buildEnd,
      rationale: 'Threshold-dominant block — LT continuous + VO2max introduction.',
      citation: 'Research/22 §3 Half Marathon Plans (BUILD phase)',
    });
  }
  if (peakEnd > buildEnd) {
    slices.push({
      label: 'PEAK',
      startWeekIdx: buildEnd + 1,
      endWeekIdx: peakEnd,
      rationale: 'Race-specific — long runs with race-pace segments + sharpening.',
      citation: 'Research/22 §3 Half Marathon Plans (PEAK phase)',
    });
  }
  if (taperWeekIdx > peakEnd) {
    slices.push({
      label: 'TAPER',
      startWeekIdx: taperWeekIdx,
      endWeekIdx: taperWeekIdx,
      rationale: 'Volume drops 30-50%, intensity preserved via strides + a short tune-up.',
      citation: 'Research/08 §9.1 HM taper table',
    });
  }
  slices.push({
    label: 'RACE_WEEK',
    startWeekIdx: raceWeekIdx,
    endWeekIdx: raceWeekIdx,
    rationale: 'Shakeout + race day. No quality work inside ±7 days of race.',
    citation: 'Research/08 §9.2 HM race-week template',
  });
  return slices;
}

// ─────────────────────────────────────────────────────────────────
// Weekly volume curve
// ─────────────────────────────────────────────────────────────────

/** Compute weekly volume target per week index. Ramps from current
 *  toward peak (5-8% per week, capped at +10%/wk), cutback every 3rd
 *  week (-15-20%), taper drops 30-50%. Race week = ~14mi (shakeout +
 *  race). */
export function weeklyVolumeCurve(
  weeksTotal: number,
  startMpw: number,
  peakMpw: number,
  phases: PhaseSlice[],
): { volumeMi: number[]; isCutback: boolean[]; isPeak: boolean[]; isRaceWeek: boolean[] } {
  const volumeMi = new Array(weeksTotal).fill(0);
  const isCutback = new Array(weeksTotal).fill(false);
  const isPeak = new Array(weeksTotal).fill(false);
  const isRaceWeek = new Array(weeksTotal).fill(false);

  const phaseOf = (i: number) => phases.find(p => i >= p.startWeekIdx && i <= p.endWeekIdx)!;

  // Maintenance: flat at startMpw.
  if (phases.length === 1 && phases[0].label === 'MAINTENANCE') {
    for (let i = 0; i < weeksTotal; i++) {
      volumeMi[i] = startMpw;
      if ((i + 1) % 3 === 0) {
        volumeMi[i] = round1(startMpw * 0.82);
        isCutback[i] = true;
      }
    }
    return { volumeMi, isCutback, isPeak, isRaceWeek };
  }

  // race-prep — find PEAK phase end (the last non-taper week)
  const peakSlice = phases.find(p => p.label === 'PEAK');
  const buildSlice = phases.find(p => p.label === 'BUILD');
  const taperSlice = phases.find(p => p.label === 'TAPER');
  const raceWeekSlice = phases.find(p => p.label === 'RACE_WEEK');

  // Identify which idx hits peak: prefer last week of PEAK; else last
  // BUILD week if no PEAK; else mid-way week.
  const peakAtIdx =
    peakSlice ? peakSlice.endWeekIdx :
    buildSlice ? buildSlice.endWeekIdx :
    Math.max(0, weeksTotal - 3);

  // Ramp from startMpw to peakMpw over [0..peakAtIdx]. Linear+cap.
  for (let i = 0; i <= peakAtIdx; i++) {
    const t = peakAtIdx === 0 ? 1 : i / peakAtIdx;
    let v = startMpw + (peakMpw - startMpw) * t;
    // 10% cap per week vs prior week's intended (uncutback) value.
    if (i > 0) {
      const priorIntent = startMpw + (peakMpw - startMpw) * ((i - 1) / Math.max(1, peakAtIdx));
      v = Math.min(v, priorIntent * 1.10);
    }
    // Cutback every 3rd week: weeks 3, 6, 9, ... (1-indexed).
    if ((i + 1) % 3 === 0 && i !== peakAtIdx) {
      v = v * 0.82;
      isCutback[i] = true;
    }
    volumeMi[i] = round1(v);
    if (i === peakAtIdx) isPeak[i] = true;
  }

  // Taper: typically 30-50% drop from peak in first taper week.
  if (taperSlice) {
    const taperFirst = taperSlice.startWeekIdx;
    const taperLast = taperSlice.endWeekIdx;
    const peakVol = volumeMi[peakAtIdx];
    for (let i = taperFirst; i <= taperLast; i++) {
      const stepsFromPeak = i - peakAtIdx;
      const drop = stepsFromPeak === 1 ? 0.35 : 0.55;   // wk1 of taper ~65%, wk2 ~45%
      volumeMi[i] = round1(peakVol * (1 - drop));
    }
  }

  // Race week: shakeout + race only.
  if (raceWeekSlice) {
    const idx = raceWeekSlice.startWeekIdx;
    isRaceWeek[idx] = true;
    // Volume = race distance + ~4 mi of shakeout/easy
    volumeMi[idx] = round1(startMpw * 0.35);   // ballpark — race distance dominates anyway
  }

  return { volumeMi, isCutback, isPeak, isRaceWeek };
}

// ─────────────────────────────────────────────────────────────────
// Day-of-week layout
// ─────────────────────────────────────────────────────────────────

interface DayPick {
  /** Which type the slot will be. */
  type: WorkoutType;
  isQuality: boolean;
  isLong: boolean;
}

/** Build the 7-day shape for a single week. Long on prefs.longRunDow,
 *  quality on prefs.qualityDows, rest on prefs.restDow, easy on the
 *  remaining days. Phase scales the quality count:
 *   BASE: 1 quality
 *   BUILD: 2 quality
 *   PEAK: 2 quality (+ long-run-w/-HMP-segment, handled in author)
 *   TAPER: 1 quality
 *   RACE_WEEK: 0 quality (race day only)
 *   MAINTENANCE: 1 quality
 */
export function weekShape(
  phaseLabel: PhaseLabel,
  prefs: { longRunDow: number; qualityDows: number[]; restDow: number },
  raceDow: number | null,
): DayPick[] {
  const days: DayPick[] = [];
  for (let dow = 0; dow < 7; dow++) {
    days.push({ type: 'easy', isQuality: false, isLong: false });
  }
  // Rest
  if (prefs.restDow >= 0 && prefs.restDow < 7) {
    days[prefs.restDow] = { type: 'rest', isQuality: false, isLong: false };
  }
  // Long
  if (prefs.longRunDow >= 0 && prefs.longRunDow < 7
      && prefs.longRunDow !== prefs.restDow) {
    days[prefs.longRunDow] = { type: 'long', isQuality: false, isLong: true };
  }

  // Quality slot count by phase
  let qualityCount: number;
  switch (phaseLabel) {
    case 'BASE':        qualityCount = 1; break;
    case 'BUILD':       qualityCount = 2; break;
    case 'PEAK':        qualityCount = 2; break;
    case 'TAPER':       qualityCount = 1; break;
    case 'RACE_WEEK':   qualityCount = 0; break;
    case 'MAINTENANCE': qualityCount = 1; break;
  }

  // Quality day assignment — uses prefs.qualityDows in order, skipping
  // rest/long. Tempo first, then intervals (alternates by index).
  const qualityCandidates = prefs.qualityDows.filter(d =>
    d >= 0 && d < 7 && d !== prefs.restDow && d !== prefs.longRunDow);
  const assignedQuality: number[] = [];
  for (const d of qualityCandidates) {
    if (assignedQuality.length >= qualityCount) break;
    days[d] = {
      type: assignedQuality.length === 0 ? 'threshold' : 'interval',
      isQuality: true,
      isLong: false,
    };
    assignedQuality.push(d);
  }

  // RACE_WEEK overrides
  if (phaseLabel === 'RACE_WEEK' && raceDow != null) {
    for (let i = 0; i < 7; i++) {
      // Most days easy / shakeout; race-day → race; ±1 day soft.
      const dist = (i - raceDow + 7) % 7;
      if (i === raceDow) {
        days[i] = { type: 'race', isQuality: false, isLong: false };
      } else if (dist === 6 /* day before race in mod-7 land = 1 day ahead */ || (raceDow - i + 7) % 7 === 1) {
        days[i] = { type: 'shakeout', isQuality: false, isLong: false };
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
// Distance allocation for the week
// ─────────────────────────────────────────────────────────────────

/** Allocate distance across the 7 days such that long run gets its
 *  doctrine share, quality gets the template distance (scaled), and
 *  easy days share the remainder with a 3-mi floor.
 *  Returns mileage per dow index. */
export function allocateDistances(
  shape: DayPick[],
  weeklyMi: number,
  longMi: number,
  qualityMi: number,
): number[] {
  const out = new Array(7).fill(0);
  const qualityDows: number[] = [];
  const easyDows: number[] = [];
  let longDow: number | null = null;
  for (let i = 0; i < 7; i++) {
    if (shape[i].type === 'rest' || shape[i].type === 'race' || shape[i].type === 'shakeout') {
      // Race/shakeout get fixed values below.
      continue;
    }
    if (shape[i].isLong) longDow = i;
    else if (shape[i].isQuality) qualityDows.push(i);
    else easyDows.push(i);
  }
  if (longDow != null) out[longDow] = round1(longMi);
  let qualityTotal = 0;
  for (const d of qualityDows) {
    out[d] = round1(qualityMi);
    qualityTotal += qualityMi;
  }
  const longShare = longDow != null ? longMi : 0;
  let remaining = weeklyMi - longShare - qualityTotal;
  // race-week special: race day's distance set externally
  for (let i = 0; i < 7; i++) {
    if (shape[i].type === 'shakeout') out[i] = 3;
    if (shape[i].type === 'race') {/* leave 0 here; caller fills with race distance */}
  }
  if (easyDows.length > 0 && remaining > 0) {
    const baseEasy = round1(remaining / easyDows.length);
    for (const d of easyDows) {
      out[d] = baseEasy;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Top-level builder
// ─────────────────────────────────────────────────────────────────

export async function buildPlan(inputs: BuildPlanInputs): Promise<Plan> {
  const { state, prefs, race } = inputs;
  const todayISO = inputs.todayISO ?? state.now;
  const userId = inputs.userId ?? 'me';
  const planId = inputs.planId ?? newId();

  // Mode: race-prep if race within ~16 weeks; else maintenance.
  const today = new Date(todayISO + 'T12:00:00Z');
  const raceDate = race ? new Date(race.dateISO + 'T12:00:00Z') : null;
  const daysToRace = raceDate
    ? Math.round((raceDate.getTime() - today.getTime()) / 86_400_000)
    : null;
  const mode: PlanMode =
    race && daysToRace != null && daysToRace > 0 && daysToRace <= 16 * 7
      ? 'race-prep'
      : 'maintenance';

  // Level
  const level: Level = prefs.level ?? autoDetectLevel(state.volume.weeklyAvg4w);

  // Total weeks
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

  // Phases
  const phaseSlices = planPhases(totalWeeks, mode);

  // Volume curve
  const peakMpwTarget = mode === 'race-prep' && race
    ? peakVolumeForLevel(race.distanceMi, level)
    : Math.max(8, state.volume.weeklyAvg4w);
  const peakLongTarget = mode === 'race-prep' && race
    ? peakLongRunForLevel(race.distanceMi, level)
    : Math.max(4, round1(state.volume.longestTrainingRunLast28Mi * 0.5));
  const startMpw = mode === 'race-prep'
    ? Math.max(8, state.volume.weeklyAvg4w)
    : Math.max(8, state.volume.weeklyAvg4w);
  const curve = weeklyVolumeCurve(totalWeeks, startMpw, peakMpwTarget, phaseSlices);

  // ── Materialize phases ───────────────────────────────────────
  const phases: PlanPhase[] = phaseSlices.map(ps => ({
    id: newId(),
    label: ps.label,
    startWeekIdx: ps.startWeekIdx,
    endWeekIdx: ps.endWeekIdx,
    rationale: ps.rationale,
    citation: ps.citation,
  }));

  // ── Materialize weeks + workouts ─────────────────────────────
  const weeks: PlanWeek[] = [];
  const raceDow = raceDate ? raceDate.getUTCDay() : null;
  for (let w = 0; w < totalWeeks; w++) {
    const weekStart = new Date(startMonday);
    weekStart.setUTCDate(weekStart.getUTCDate() + w * 7);
    const weekStartISO = weekStart.toISOString().slice(0, 10);
    const phaseSlice = phaseSlices.find(p => w >= p.startWeekIdx && w <= p.endWeekIdx)!;
    const phaseRow = phases.find(p => p.label === phaseSlice.label
      && p.startWeekIdx === phaseSlice.startWeekIdx)!;

    const weekShapeArr = weekShape(
      phaseSlice.label,
      prefs as { longRunDow: number; qualityDows: number[]; restDow: number },
      curve.isRaceWeek[w] ? raceDow : null,
    );
    const weeklyMi = curve.volumeMi[w];

    // Long run distance — peak long scaled by week's volume ratio to peak
    const peakVol = curve.volumeMi[curve.isPeak.indexOf(true)] || peakMpwTarget;
    let weekLongMi = curve.isCutback[w]
      ? round1(peakLongTarget * 0.80)
      : round1(peakLongTarget * Math.min(1, weeklyMi / peakVol));
    if (phaseSlice.label === 'TAPER') weekLongMi = round1(peakLongTarget * 0.5);
    if (phaseSlice.label === 'RACE_WEEK') weekLongMi = 0;
    if (phaseSlice.label === 'BASE') weekLongMi = Math.max(weekLongMi, round1(peakLongTarget * 0.6));

    // Quality block size — peak-week template sizes scaled to this week's volume.
    // Research/00a: quality sessions combined should not exceed ~30% of weekly.
    const qualityBlockRaw = qualityBlockMi(phaseSlice.label, level, race?.distanceMi ?? 13.1);
    const numQualitySlots = weekShapeArr.filter(d => d.isQuality).length;
    const volScale = peakMpwTarget > 0 ? Math.min(1, weeklyMi / peakMpwTarget) : 1;
    const qualityBudgetPerSession = numQualitySlots > 0
      ? round1(weeklyMi * 0.30 / numQualitySlots)
      : 0;
    const qualityMi = Math.max(2, Math.min(round1(qualityBlockRaw * volScale), qualityBudgetPerSession));

    const distances = allocateDistances(weekShapeArr, weeklyMi, weekLongMi, qualityMi);
    if (curve.isRaceWeek[w] && race) {
      const raceDowIdx = raceDow!;
      distances[raceDowIdx] = race.distanceMi;
    }

    // Iterate calendar days Mon → Sun (offset 0..6 from Monday-anchored
    // weekStart). Use the JS getUTCDay() value as the dow so it matches
    // CoachState.prefs.*Dow conventions (0=Sun..6=Sat) — that's what
    // weekShapeArr and distances are indexed by.
    const workouts: PlanWorkout[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const d = new Date(weekStart);
      d.setUTCDate(weekStart.getUTCDate() + offset);
      const dateISO = d.toISOString().slice(0, 10);
      const jsDow = d.getUTCDay();
      const pick = weekShapeArr[jsDow];
      const dist = distances[jsDow];
      workouts.push({
        id: newId(),
        dateISO,
        dow: jsDow,
        type: pick.type,
        distanceMi: dist,
        paceTargetSPerMi: null,
        durationMin: null,
        isQuality: pick.isQuality,
        isLong: pick.isLong,
        notes: notesFor(pick.type, phaseSlice.label, level),
        originalDateISO: dateISO,
        originalType: pick.type,
        originalDistanceMi: dist,
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
    authoredFromState: snapshotFromState(state, level),
    phases,
    weeks,
    archivedISO: null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function startOfWeekMonday(d: Date): Date {
  // JS getUTCDay: 0=Sun..6=Sat. We want Monday = start of week.
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  const out = new Date(d);
  out.setUTCDate(d.getUTCDate() + delta);
  out.setUTCHours(12, 0, 0, 0);
  return out;
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

function qualityBlockMi(phase: PhaseLabel, level: Level, raceDistanceMi: number): number {
  // From Research/22 §3 templates (HM intermediate sample):
  //  T = 5 mi (WU+T+CD = 8); I = 4×1200 = ~3 mi reps + 5mi WU/CD = 8.
  //  These are PEAK-week sizes — the caller scales proportionally by vol.
  if (phase === 'TAPER' || phase === 'RACE_WEEK') return 3;
  // Maintenance: Research/22 §7 "WU + 20 min @ T + CD ≈ 5 mi" — smaller dose.
  if (phase === 'MAINTENANCE') {
    if (level === 'advanced')     return 7;
    if (level === 'intermediate') return 6;
    return 5;
  }
  const hm = raceDistanceMi >= 11 && raceDistanceMi < 22;
  const mar = raceDistanceMi >= 22;
  if (level === 'beginner')      return mar ? 5 : hm ? 4 : 3;
  if (level === 'intermediate')  return mar ? 9 : hm ? 8 : 6;
  return mar ? 11 : hm ? 10 : 8;
}

function notesFor(t: WorkoutType, phase: PhaseLabel, level: Level): string {
  switch (t) {
    case 'rest':      return 'Full rest day.';
    case 'easy':      return 'Easy / conversational. E pace.';
    case 'long':      return phase === 'PEAK'
      ? `Long run with race-pace segment (middle 5 mi @ HMP per Research/22 §3 ${level} template).`
      : 'Long run at E pace.';
    case 'threshold': return 'Threshold continuous block at T pace per Research/01 Daniels.';
    case 'interval':  return 'VO2max intervals — 1000-1200 m at I pace.';
    case 'mp':        return 'Marathon-pace block.';
    case 'race':      return 'Race day — execute per Research/08 pacing strategy.';
    case 'shakeout':  return 'Short shakeout, optional 4 strides.';
    case 'recovery':  return 'Recovery run — lower than easy.';
    default:          return '';
  }
}

function weekRationale(idx: number, phase: PhaseLabel, isCutback: boolean, isPeak: boolean, isRaceWeek: boolean): string {
  if (isRaceWeek) return 'Race week — shakeout + race day.';
  if (isPeak)     return `Peak week of ${phase} — highest volume of the plan.`;
  if (isCutback)  return `Cutback week — volume down ~18% per Research/00b §Cutback Weeks.`;
  return `Week ${idx + 1} · ${phase.toLowerCase()} phase.`;
}
