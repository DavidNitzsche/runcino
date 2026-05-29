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
 * least 70% of that level's peak volume, so an Advanced runner who
 * selected Advanced but has a stale Strava cache doesn't get a
 * 1.5-mile easy-run plan.
 *
 * Two modes:
 *   race-prep, A-race within ~16 weeks. BASE → BUILD → PEAK → TAPER → RACE_WEEK.
 *   maintenance, No A-race. 16 weeks flat aerobic, 1 quality/week.
 */

import type { CoachState } from '../lib/coach-state';
import { newId } from '../lib/plan-store';
import {
  type Plan, type PlanPhase, type PlanWeek, type PlanWorkout,
  type PlanMode, type WorkoutType, type PhaseLabel, type WorkoutSpec,
  snapshotFromState,
} from './plan-types';
import { PLAN_TEMPLATES, type PlanDistance } from './doctrine/plan_templates';
import { THRESHOLD_SESSION_PROGRESSION, STRENGTH_SCHEDULE } from './doctrine/workouts';
import { RACE_WEEK_TEMPLATES } from './doctrine/race_week';
import { vdotSnapshot, pacesFromVdot, vdotFromRace, type DanielsPaceSet } from '../lib/vdot';

export type Level = 'beginner' | 'intermediate' | 'advanced';

/** Bump when the builder algorithm changes significantly. Plans authored
 *  at an older version are transparently rewritten on next load. */
export const BUILDER_VERSION = 20;

export interface BuildPlanRace {
  id: string;
  name: string;
  dateISO: string;
  distanceMi: number;
  priority: 'A' | 'B' | 'C';
}

/**
 * Onboarding goals captured on the "No specific race" path (migration
 * 118 · /api/onboarding/complete). Every field is optional so the
 * builder can fall through to its existing behavior when nothing was
 * provided (race-anchored path, mid-build runner, etc).
 *
 * Values mirror the profile columns persisted by the no-race
 * Step 1b · goal-details screen.
 */
export interface OnboardingGoals {
  /** From profile.tt_goal_distance + tt_goal_time.
   *  Optional time-trial target — drives a build toward a TT effort
   *  during the first 8 weeks of a maintenance plan when both are set.
   *  Daniels Running Formula §VDOT table is the anchor: a 22-25 5K
   *  bucket → midpoint 23:30 → table lookup → VDOT seed. */
  ttDistance: '1mi' | '5k' | '10k' | null;
  /** Bucketed chip value (e.g. "22-25"). Builder translates the bucket
   *  to a target time using `parseTTTimeBucket()` (midpoint of the
   *  range, in seconds). */
  ttTimeBucket: string | null;

  /** From profile.weekly_mileage_target + weekly_frequency.
   *  When set, weeklyMiTarget becomes the peak weekly mileage (instead
   *  of auto-derived from history); weeklyFrequency hints at the
   *  number of run days but is honored upstream by callers that
   *  derive `prefs.qualityDows`. The builder itself reads only the
   *  prefs that were passed in. */
  weeklyMiTarget: number | null;
  weeklyFrequency: number | null;

  /** From profile.history_avg_weekly_mi (chip midpoint) — used as a
   *  cold-start floor when `state.volume.weeklyAvg4w` is 0 (no Strava
   *  history yet). */
  historyAvgWeeklyMi: number | null;
  /** From profile.history_longest_recent_mi (chip midpoint) — used as
   *  the long-run floor when state.volume.longestTrainingRunLast28Mi
   *  is 0, mirroring the recent-long anchor rule in Research/00a
   *  §"The 10% rule, reconsidered". */
  historyLongestRecentMi: number | null;
  /** From profile.history_years_running — coarse experience hint.
   *  Currently unused inside the builder (kept on the interface for
   *  forward-compat: an upstream caller can use it to bump the
   *  auto-detected level). */
  historyYearsRunning: '<1' | '1-3' | '3-7' | '7+' | null;
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
  /** No-race-path onboarding inputs (migration 118). Read only by the
   *  maintenance branch — the race-anchored path uses the race table
   *  and ignores these. See `OnboardingGoals` for the field mapping. */
  onboardingGoals?: OnboardingGoals;
  todayISO?: string;
  planId?: string;
  userId?: string;
}

/**
 * Translate a `TT_TIME_LADDERS` bucket value (e.g. "22-25", "Under 5:00",
 * "Under 40", "5:00-6:00", "8:00+") to a target time in seconds — the
 * midpoint of the range when both ends are present, the boundary when
 * one side is open-ended. Returns null when the bucket is unparseable.
 *
 * Buckets used by the chip ladders (see lib/onboarding/state.ts):
 *   1mi: 'Under 5:00' | '5:00-6:00' | '6:00-7:00' | '7:00-8:00' | '8:00+'
 *   5k:  'Under 20:00' | '20-22' | '22-25' | '25-28' | '28-32' | '32+'
 *   10k: 'Under 40' | '40-45' | '45-50' | '50-60' | '60+'
 *
 *  The mile bucket uses MM:SS strings; the 5K/10K buckets use minute
 *  integers. We detect format with a colon presence.
 */
export function parseTTTimeBucket(
  ttDistance: 'mile' | '5k' | '10k' | '1mi',
  bucket: string,
): number | null {
  const b = bucket.trim();
  if (!b) return null;

  // Silence the unused-arg lint (kept for future per-distance sanity
  // bounds, e.g. clamp to plausible mile / 5K / 10K times).
  void ttDistance;

  // Boundary handling — "Under X" returns X, "X+" returns X. We treat
  // these as conservative reads (don't credit fitness the runner hasn't
  // earned with an open bucket).
  const toSeconds = (s: string): number | null => {
    s = s.trim();
    if (s.length === 0) return null;
    // MM:SS form (mile bucket).
    const colon = s.match(/^(\d+):(\d{2})$/);
    if (colon) return (+colon[1]) * 60 + (+colon[2]);
    // Plain minutes (5K/10K buckets).
    const mins = s.match(/^(\d+(?:\.\d+)?)$/);
    if (mins) return Math.round(parseFloat(mins[1]) * 60);
    return null;
  };

  // "Under X" or "X+" — boundary.
  const under = b.match(/^Under\s+(.+)$/i);
  if (under) {
    const t = toSeconds(under[1]);
    return t;
  }
  const plus = b.match(/^(.+)\+$/);
  if (plus) {
    const t = toSeconds(plus[1]);
    return t;
  }
  // "X-Y" — midpoint.
  const range = b.match(/^([\d.:]+)-([\d.:]+)$/);
  if (range) {
    const lo = toSeconds(range[1]);
    const hi = toSeconds(range[2]);
    if (lo == null || hi == null) return null;
    return Math.round((lo + hi) / 2);
  }
  // Fall through: try as a single value.
  return toSeconds(b);
}

/** Map a TT distance chip value to the canonical distance-in-miles the
 *  VDOT table understands. */
function ttDistanceMi(d: 'mile' | '5k' | '10k' | '1mi'): number {
  if (d === '1mi' || d === 'mile') return 1;
  if (d === '5k') return 3.107;
  return 6.214; // 10k
}

// ─────────────────────────────────────────────────────────────────
// Proportion constants, grounded in the research example weeks.
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
// Doctrine-grounded lookups, all volume targets come from
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
      rationale: 'No A-race, holding aerobic base with 1 quality session/week.',
      citation: 'Advanced training research §13 Periodization',
    }];
  }

  if (totalWeeks <= 1) {
    return [{
      label: 'RACE_WEEK',
      startWeekIdx: 0,
      endWeekIdx: 0,
      rationale: 'Race week, shakeout + race only.',
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
      rationale: 'Aerobic base, durability before the quality load climbs.',
      citation: 'Advanced training research §13.1 Phase 1: Base / speed support',
    });
  }
  if (buildEnd > baseEnd) {
    slices.push({
      label: 'BUILD',
      startWeekIdx: baseEnd + 1,
      endWeekIdx: buildEnd,
      rationale: 'Threshold-dominant block, LT continuous + VO2max introduction.',
      citation: 'Advanced training research §13.2 Phase 2: Threshold build',
    });
  }
  if (peakEnd > buildEnd) {
    slices.push({
      label: 'PEAK',
      startWeekIdx: buildEnd + 1,
      endWeekIdx: peakEnd,
      rationale: 'Race-specific, long runs with race-pace finish + sharpening.',
      citation: 'Advanced training research §13.3 Phase 3: Race-specific',
    });
  }
  if (taperWeekIdx > peakEnd) {
    slices.push({
      label: 'TAPER',
      startWeekIdx: taperWeekIdx,
      endWeekIdx: taperWeekIdx,
      rationale: 'Volume −40%, intensity touches preserved. Not rest, fatigue reduction.',
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

/** Compute volume target per week. Ramps startMpw → peakMpw at ≤5%/wk
 *  inside BUILD and ≤10%/wk inside PEAK (BUILD ramps gently, PEAK takes
 *  the steep climb, Daniels §13). Cutback every 3rd week (−18%),
 *  taper −40%, race week ballpark. */
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

  // Phase-aware per-week growth cap. Daniels' Advanced Training §13:
  // BUILD ramps GENTLY (≤5%/wk) so threshold load can be absorbed;
  // PEAK is where the steep climb happens (≤10%/wk) to reach race-
  // specific volume. A flat 10%/wk cap across BUILD+PEAK pushed BUILD
  // weeks past 1.35× of baseline by mid-block and left no headroom
  // for PEAK. Holding BUILD at 5%/wk lets the curve breathe.
  const phaseGrowthCapFor = (weekIdx: number): number => {
    if (buildSlice && weekIdx >= buildSlice.startWeekIdx && weekIdx <= buildSlice.endWeekIdx) {
      return 1.05;
    }
    return 1.10;
  };
  for (let i = 0; i <= peakAtIdx; i++) {
    const t = peakAtIdx === 0 ? 1 : i / peakAtIdx;
    let v = startMpw + (peakMpw - startMpw) * t;
    if (i > 0) {
      const priorIntent = startMpw + (peakMpw - startMpw) * ((i - 1) / Math.max(1, peakAtIdx));
      v = Math.min(v, priorIntent * phaseGrowthCapFor(i));
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
        // Tuesday tune-up: short sharpener, not a quality stimulus.
        // Daniels + Pfitzinger treat the race-week tune-up as a
        // neuromuscular primer with negligible training fatigue, so
        // isQuality is false and the day-after suppression rules
        // skip it. (Research/08 §9.3)
        days[i] = { type: 'race_week_tuneup', isQuality: false, isLong: false };
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
  const { state, prefs, race, onboardingGoals } = inputs;
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
  // Maintenance branch · cold-start: if the runner has no race history
  // but seeded a time-trial goal during onboarding (migration 118), we
  // derive paces from the TT bucket midpoint via Daniels Running Formula
  // §VDOT table. This is conservative — the runner's stated bucket time
  // is what they think they can hit, not a verified result, so we never
  // overwrite a real vdotSnap when one exists.
  const vdotSnap = vdotSnapshot(state);
  let paces: DanielsPaceSet | null = vdotSnap ? pacesFromVdot(vdotSnap.vdot) : null;
  if (
    paces == null &&
    mode === 'maintenance' &&
    onboardingGoals?.ttDistance &&
    onboardingGoals?.ttTimeBucket
  ) {
    const ttSec = parseTTTimeBucket(onboardingGoals.ttDistance, onboardingGoals.ttTimeBucket);
    if (ttSec != null && ttSec > 0) {
      const distMi = ttDistanceMi(onboardingGoals.ttDistance);
      const ttVdot = vdotFromRace(distMi, ttSec);
      if (ttVdot != null) {
        paces = pacesFromVdot(ttVdot);
      }
    }
  }

  // Friel LTHR from profile (Research/03 §6 · 30-min TT field method).
  // Drives the HR ceilings emitted into workout_spec so /runs/[id]
  // WorkoutBreakdown and /today Poster A3 breakdown rows can show real HR
  // caps instead of placeholder bpm strings. Null when the runner hasn't
  // set a manual LTHR — downstream emits null HR fields and the renderer
  // falls back to its existing placeholder. Path A auto-derivation
  // (Phase 32 follow-up) will lift this from manual-only to also-from-
  // data; this round just consumes whatever profile.lthr already carries.
  const lthr: number | null = state.recovery.lthrBpm ?? null;

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

  // ── Maintenance-branch overrides (onboarding goals, migration 118) ─
  // When the runner picked "No specific race" but supplied weekly /
  // history targets through Step 1b · goal-details, honor those numbers
  // instead of auto-deriving everything from Strava cache. The race-
  // anchored path is intentionally untouched (race table + doctrine
  // template remain the source of truth there).
  //
  // Cite: Daniels Running Formula §13 · "Periodization" — maintenance
  // weeks hold ~peak with a small cutback every third week, so anchoring
  // the peak to a runner-stated target is the cleanest single dial.

  // Volume targets
  let peakMpwTarget: number;
  if (mode === 'race-prep') {
    peakMpwTarget = peakVolumeForLevel(raceDist, level);
  } else if (onboardingGoals?.weeklyMiTarget != null && onboardingGoals.weeklyMiTarget > 0) {
    // Honor the runner's stated weekly mileage target as the peak.
    // weeklyVolumeCurve applies the 0.82× cutback every third week.
    peakMpwTarget = Math.max(8, onboardingGoals.weeklyMiTarget);
  } else {
    peakMpwTarget = Math.max(8, state.volume.weeklyAvg4w);
  }

  let peakLongTarget: number;
  if (mode === 'race-prep') {
    peakLongTarget = peakLongRunForLevel(raceDist, level);
  } else {
    // Maintenance: 50% of the longest training run in the recent window
    // (Research/00a §"The 10% rule, reconsidered" — never anchor off a
    // race effort). When there's no recent training data but the runner
    // reported a historical longest in onboarding, use that as a floor
    // so a 12mi-history runner doesn't get a 4mi-long plan.
    const recentLongest = round1(state.volume.longestTrainingRunLast28Mi * 0.5);
    const historyLongest = onboardingGoals?.historyLongestRecentMi != null
      ? round1(onboardingGoals.historyLongestRecentMi * 0.5)
      : 0;
    peakLongTarget = Math.max(4, recentLongest, historyLongest);
  }

  // Cold-start handling for the maintenance branch:
  // (a) state.volume.weeklyAvg4w <= 0 + onboardingGoals.historyAvgWeeklyMi set
  //     → use the runner-reported number as the starting volume.
  //     Daniels §13 anchors maintenance ramps off "what the runner is
  //     already running" — a fresh-onboarder with no Strava yet but a
  //     declared "I run ~20 mi/wk" should land on 20, not 8.
  // (b) Otherwise existing behavior (weeklyAvg4w, floor 8).
  const stravaMpw = state.volume.weeklyAvg4w;
  const seedMpw = mode === 'maintenance' && stravaMpw <= 0
      && onboardingGoals?.historyAvgWeeklyMi != null
      && onboardingGoals.historyAvgWeeklyMi > 0
    ? onboardingGoals.historyAvgWeeklyMi
    : stravaMpw;
  const actualMpw = Math.max(8, seedMpw);

  // When the user explicitly sets their level, honour the level's minimum
  // starting volume, avoids embarrassingly tiny runs from stale Strava data.
  let startMpw = prefs.level != null
    ? Math.max(actualMpw, levelMinStartMpw(raceDist, level))
    : actualMpw;

  // Maintenance branch · weeklyVolumeCurve holds flat at startMpw (not
  // peakMpwTarget), so a runner who picked a 35 mpw target with only
  // 12 mpw of stale Strava history would otherwise stay at 12. Lift
  // startMpw to the runner-stated target in maintenance mode so the
  // flat hold lands on the requested volume. Daniels §13 — maintenance
  // weeks ARE peak weeks (no ramp), the runner's stated number is the
  // single dial.
  if (
    mode === 'maintenance' &&
    onboardingGoals?.weeklyMiTarget != null &&
    onboardingGoals.weeklyMiTarget > 0
  ) {
    startMpw = Math.max(startMpw, onboardingGoals.weeklyMiTarget);
  }

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
    // Anchor early long runs to the athlete's recent longest *training*
    // run (excludes races), so the plan progresses FROM proven fitness
    // instead of ramping up to a distance they already cover, e.g. an
    // 11 mi runner shouldn't be prescribed a 10.5 mi "build-up" long.
    // Capped at peakLongTarget (never start above the plan's peak) and
    // suppressed on cutback/taper weeks, which intentionally pull back.
    // The single-jump ceiling stays governed by the 110%-of-recent rule
    // (Research/00a §"The 10% rule, reconsidered": a single long run
    // should not exceed 110% of the longest run in the prior 30 days).
    const recentLongFloor = Math.min(
      round1(state.volume.longestTrainingRunLast28Mi ?? 0),
      peakLongTarget,
    );
    let longMi = 0;
    if (phaseSlice.label !== 'RACE_WEEK' && shape.some(d => d.isLong)) {
      if (phaseSlice.label === 'TAPER') {
        longMi = round1(peakLongTarget * 0.50);
      } else if (curve.isCutback[w]) {
        longMi = round1(peakLongTarget * 0.75);
      } else {
        // Scale toward peakLongTarget proportionally with weekly volume.
        // Minimum: 60% of peakLong in BASE so early weeks aren't trivial,
        // and never below the athlete's recent proven long.
        const scaledLong = round1(peakLongTarget * Math.min(1, weeklyMi / peakVol));
        longMi = phaseSlice.label === 'BASE'
          ? Math.max(scaledLong, round1(peakLongTarget * 0.60), recentLongFloor)
          : Math.max(scaledLong, recentLongFloor);
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

    // Race-week tune-up: warmup + 4×1K work + cooldown ≈ 4.5 mi
    // (Research/08 §9.3, "4-5 mi w/ 4 × 1K at HMP").
    const tuneupMi = shape.some(d => d.type === 'race_week_tuneup') ? 4.5 : 0;

    // ── Easy days ───────────────────────────────────────────────
    const usedMi     = longMi + threshMi + (numQ >= 2 ? intervalMi : 0) + tuneupMi;
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
      if (d.type === 'race_week_tuneup') { distances[i] = tuneupMi; continue; }
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

      const subLabel = subLabelFor(effectiveType, phaseSlice.label, w, curve.isCutback[w]);
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
        hasStrength: false,
        notes: notesFor(effectiveType, phaseSlice.label, level, w, curve.isCutback[w]),
        subLabel,
        // Migration 120 (2026-05-28): structured spec for WorkoutBreakdown +
        // Poster A3 breakdown rows. null when no VDOT (runner has no race
        // result yet); downstream falls back to label-only render.
        workoutSpec: buildWorkoutSpec(effectiveType, subLabel, distances[jsDow], paces, lthr),
        originalDateISO: dateISO,
        originalType: effectiveType,
        originalDistanceMi: distances[jsDow],
        mutations: [],
      });
    }

    // ── Strength training annotations ────────────────────────────
    // Adaptive placement: score each easy day by its circular distance from
    // quality sessions and the long run. Pick the best N slots per phase.
    // Research/07 §12.3, §13, §21 Rule 7, "pair hard with hard."
    const ss = STRENGTH_SCHEDULE.value;
    const maxStr: number =
      phaseSlice.label === 'RACE_WEEK' ? ss.sessionsPerWeek.RACE_WEEK :
      phaseSlice.label === 'TAPER'     ? ss.sessionsPerWeek.TAPER     :
      phaseSlice.label === 'PEAK'      ? ss.sessionsPerWeek.PEAK      :
      phaseSlice.label === 'BUILD'     ? ss.sessionsPerWeek.BUILD     :
      ss.sessionsPerWeek.BASE;
    const strDurMin: number =
      phaseSlice.label === 'RACE_WEEK' ? ss.durationMin.RACE_WEEK :
      phaseSlice.label === 'TAPER'     ? ss.durationMin.TAPER     :
      phaseSlice.label === 'PEAK'      ? ss.durationMin.PEAK      :
      phaseSlice.label === 'BUILD'     ? ss.durationMin.BUILD     :
      ss.durationMin.BASE;

    // Effort cue per phase.
    const effortCue =
      phaseSlice.label === 'TAPER' || phaseSlice.label === 'RACE_WEEK'
        ? '4–5/10 effort, maintenance only.'
        : phaseSlice.label === 'PEAK'
        ? '6/10 effort, strong but controlled.'
        : '7/10 effort, work hard, leave something in the tank.';

    const strSlots = selectStrengthSlots(workouts, maxStr);
    for (const slot of strSlots) {
      const focusLabel = slot.focus === 'lower' ? 'Lower + Core' : 'Upper + Core';
      const focusNote  = slot.focus === 'lower'
        ? `Lower body + core, squats, deadlifts, single-leg work, planks. ${effortCue} Run first, always.`
        : `Upper body + core, rows, presses, pull-ups, carries. ${effortCue} Keep it controlled.`;
      slot.workout.notes += `\n\nStrength: ${focusLabel}, ${strDurMin} min Amp Fitness session after your run. ${focusNote}`;
      slot.workout.hasStrength = true;
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

function round1(n: number): number { return Math.round(n * 2) / 2; }

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
    // HM tune-up work intervals are at HMP ≈ T pace (Research/08 §9.3).
    case 'race_week_tuneup': return paceCenter(paceSet.T);
    default:          return null; // rest, race, no target
  }
}

/** Build the structured workout_spec JSONB payload for a given workout.
 *
 *  Returns null when paceSet is unavailable (no VDOT) so callers know to
 *  fall back to the existing label-only render path. Per the migration 120
 *  schema, rest / cross / strength / shakeout / race types intentionally
 *  return null (no structured spec — those rows have no pace targets).
 *
 *  The threshold/interval cases parse the rep structure out of the sub_label
 *  emitted by `subLabelFor` (e.g. "Cruise Intervals" → 5×1K). Cite Daniels
 *  Running Formula §VDOT table for the pace anchor + Research/04 §5.3,
 *  §5.4, §6 for the rep structures. */
function buildWorkoutSpec(
  type: WorkoutType,
  subLabel: string | null,
  distanceMi: number,
  paceSet: DanielsPaceSet | null,
  lthr: number | null,
): WorkoutSpec | null {
  if (!paceSet) return null;

  // LTHR-anchored HR ceilings per Friel zones (Research/03 §6):
  //   easy      → ~88% LTHR (Z2 ceiling, aerobic)
  //   long      → ~85% LTHR (long-day cap — more conservative than Z2
  //                because aerobic drift on multi-hour days outpaces HR
  //                zone midpoints)
  //   recovery  → ~75% LTHR (Z1 ceiling, strict aerobic)
  //   tempo/mp  → ~92% LTHR (Z3 mid-band, sub-LT steady)
  //   threshold → emit LTHR directly so renderers can show the anchor
  //                alongside the rep pace (Z5a sits at 100–102% LTHR)
  // Null when no LTHR set — renderers fall back to placeholders.
  const easyHrCap     = lthr != null ? Math.round(lthr * 0.88) : null;
  const longHrCap     = lthr != null ? Math.round(lthr * 0.85) : null;
  const recoveryHrCap = lthr != null ? Math.round(lthr * 0.75) : null;
  const tempoHrTarget = lthr != null ? Math.round(lthr * 0.92) : null;

  switch (type) {
    case 'easy': {
      // Easy: Daniels E pace band + optional fuel beyond ~8 mi.
      // HR cap = ~88% LTHR (Z2 ceiling, Friel · Research/03 §6).
      const fuelMi = distanceMi >= 8 ? [Math.round(distanceMi / 2)] : undefined;
      return {
        kind: 'easy',
        pace_target_s_per_mi_lo: paceSet.E.lowS,
        pace_target_s_per_mi_hi: paceSet.E.highS,
        hr_cap_bpm: easyHrCap,
        ...(fuelMi ? { fuel_mi: fuelMi } : {}),
      };
    }

    case 'long': {
      // Long: Daniels E pace band + fuel checkpoints every ~4 mi.
      // (Research/22 §5 · "fuel early, fuel often.")
      // HR cap = ~85% LTHR (long-day ceiling, more conservative than the
      // Z2 cap because aerobic drift on multi-hour days outpaces HR-zone
      // midpoint targets). Research/03 §6.
      const checkpoints: number[] = [];
      if (distanceMi >= 4) {
        for (let mi = 4; mi <= Math.floor(distanceMi); mi += 4) checkpoints.push(mi);
      }
      // Progression-style long runs (HM Finish / Progression) build to T
      // pace at the end — emit a progression spec instead so the chart
      // shows the fade-in. Research/22 §3. The progression cap stays at
      // the long-day ceiling (HR drifts up naturally as pace climbs).
      if (subLabel === 'Long Run · Progression' || subLabel === 'Long Run · HM Finish') {
        const progDist = Math.max(2, Math.round(distanceMi / 3));
        const wm = Math.max(1, Math.round((distanceMi - progDist) * 0.5));
        const cd = Math.max(0, +(distanceMi - wm - progDist).toFixed(1));
        return {
          kind: 'progression',
          warmup_mi: wm,
          prog_distance_mi: progDist,
          prog_start_s_per_mi: paceSet.E.lowS,
          prog_end_s_per_mi: paceSet.T.lowS,
          cooldown_mi: cd,
          hr_cap_bpm: longHrCap,
        };
      }
      return {
        kind: 'long',
        pace_target_s_per_mi_lo: paceSet.E.lowS,
        pace_target_s_per_mi_hi: paceSet.E.highS,
        hr_cap_bpm: longHrCap,
        fuel_mi: checkpoints,
      };
    }

    case 'threshold': {
      // Threshold reps · structure parsed from sub_label per
      // THRESHOLD_SESSION_PROGRESSION (workouts.ts). Default: 5×1K at T
      // pace with 60s jog (Research/04 §5.3 · cruise intervals).
      // sub_label examples:
      //   'Cruise Intervals'       → 5×1K  · 60s jog
      //   'HM Cruise Intervals'    → 3×2mi @ HM pace · 90s jog
      //   'HM Threshold Blocks'    → 2×3mi @ HM pace · 120s jog
      //   'HM Continuous Tempo'    → 4mi continuous (tempo spec)
      //   'Threshold Touch'        → 2×1.5mi · 90s jog
      //
      // HR anchor: emit LTHR directly so the renderer shows
      // "LTHR · 162 bpm" alongside the rep pace target. Cruise intervals
      // sit at Friel Z5a (100–102% LTHR · Research/03 §6) — surfacing
      // LTHR lets the runner gut-check rep HR against the anchor.
      const warmupMi = 1.5;
      const cooldownMi = 1;
      const repPaceS = paceCenter(paceSet.T) ?? paceSet.T.lowS;
      if (subLabel === 'HM Continuous Tempo') {
        // Tempo: sustained sub-T effort · HR target ≈ 92% LTHR (Friel Z3
        // mid · Research/03 §6 · "Tempo, sub-LT steady"). Sits below
        // threshold-cruise reps because the continuous block is held
        // longer than rep duration.
        const tempoMi = Math.max(2, distanceMi - warmupMi - cooldownMi);
        return {
          kind: 'tempo',
          warmup_mi: warmupMi,
          tempo_distance_mi: +tempoMi.toFixed(1),
          tempo_pace_s_per_mi: repPaceS,
          cooldown_mi: cooldownMi,
          hr_target_bpm: tempoHrTarget,
        };
      }
      if (subLabel === 'HM Cruise Intervals') {
        return {
          kind: 'threshold',
          warmup_mi: warmupMi,
          rep_count: 3,
          rep_distance_mi: 2,
          rep_pace_s_per_mi: repPaceS,
          rep_rest_s: 90,
          cooldown_mi: cooldownMi,
          lthr_bpm: lthr,
        };
      }
      if (subLabel === 'HM Threshold Blocks') {
        return {
          kind: 'threshold',
          warmup_mi: warmupMi,
          rep_count: 2,
          rep_distance_mi: 3,
          rep_pace_s_per_mi: repPaceS,
          rep_rest_s: 120,
          cooldown_mi: cooldownMi,
          lthr_bpm: lthr,
        };
      }
      if (subLabel === 'Threshold Touch') {
        return {
          kind: 'threshold',
          warmup_mi: warmupMi,
          rep_count: 2,
          rep_distance_mi: 1.5,
          rep_pace_s_per_mi: repPaceS,
          rep_rest_s: 90,
          cooldown_mi: cooldownMi,
          lthr_bpm: lthr,
        };
      }
      // Default cruise intervals (BASE).
      return {
        kind: 'threshold',
        warmup_mi: warmupMi,
        rep_count: 5,
        rep_distance_m: 1000,
        rep_pace_s_per_mi: repPaceS,
        rep_rest_s: 60,
        cooldown_mi: cooldownMi,
        lthr_bpm: lthr,
      };
    }

    case 'interval': {
      // VO2max intervals · Daniels I pace · Research/04 §6.
      // Phase-shaped default: 5×1K with 90s jog. Builder doesn't track
      // phase here; downstream notes have the variant context.
      // HR anchor: emit LTHR so the renderer can show the anchor (Friel
      // Z5b sits at 103–106% LTHR for VO2max work · Research/03 §6).
      return {
        kind: 'intervals',
        warmup_mi: 1.5,
        rep_count: 5,
        rep_distance_m: 1000,
        rep_pace_s_per_mi: paceCenter(paceSet.I) ?? paceSet.I.lowS,
        rep_rest_s: 90,
        cooldown_mi: 1,
        lthr_bpm: lthr,
      };
    }

    case 'mp': {
      // Marathon-pace block · Daniels M pace. HR target ≈ 92% LTHR
      // (Friel Z3 sub-LT steady · Research/03 §6) — M pace sits between
      // E and T, and the HR pin lets the runner hold the block as pace
      // alone drifts with fatigue on long blocks.
      const warmupMi = 1;
      const cooldownMi = 1;
      const mpDist = Math.max(2, +(distanceMi - warmupMi - cooldownMi).toFixed(1));
      return {
        kind: 'mp',
        warmup_mi: warmupMi,
        mp_distance_mi: mpDist,
        mp_pace_s_per_mi: paceCenter(paceSet.M) ?? paceSet.M.lowS,
        cooldown_mi: cooldownMi,
        hr_target_bpm: tempoHrTarget,
      };
    }

    case 'recovery': {
      // Recovery: E + ~30s buffer (per paceTargetFor's recovery branch).
      // HR cap = ~75% LTHR (Z1 ceiling, Friel · Research/03 §6 — strict
      // aerobic-only to protect adaptation on a recovery day).
      const lo = paceSet.E.lowS + 30;
      const hi = paceSet.E.highS + 30;
      return {
        kind: 'recovery',
        pace_target_s_per_mi_lo: lo,
        pace_target_s_per_mi_hi: hi,
        hr_cap_bpm: recoveryHrCap,
      };
    }

    case 'race_week_tuneup': {
      // Race week tune-up · 4×1K at HMP (≈T pace). Research/08 §9.3.
      // HR anchor = LTHR (tune-up sits at Z5a cruise like a normal
      // threshold session, just with fewer reps).
      return {
        kind: 'threshold',
        warmup_mi: 1.5,
        rep_count: 4,
        rep_distance_m: 1000,
        rep_pace_s_per_mi: paceCenter(paceSet.T) ?? paceSet.T.lowS,
        rep_rest_s: 90,
        cooldown_mi: 1,
        lthr_bpm: lthr,
      };
    }

    case 'shakeout':
    case 'rest':
    case 'race':
      // No structured spec — caller falls back to label-only render.
      return null;

    default:
      return null;
  }
}

/** Short tile label for the calendar, null means use the type default. */
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
    if (phase === 'BASE') return tsp.BASE.label;
    if (phase === 'TAPER') return tsp.TAPER.label;
    if (phase === 'PEAK') return tsp.PEAK.label;
    if (phase === 'BUILD') {
      return weekIdx % 2 === 1 ? tsp.BUILD_EARLY.label : tsp.BUILD_LATE.label;
    }
    return null;
  }
  if (t === 'race_week_tuneup') return 'Race Week Tune-Up';
  return null;
}

function notesFor(t: WorkoutType, phase: PhaseLabel, _level: Level, weekIdx: number, isCutback: boolean): string {
  const tsp = THRESHOLD_SESSION_PROGRESSION.value;
  switch (t) {
    case 'rest':
      return 'Full rest. Don\'t sneak in a "light walk" or bonus core work, the adaptation happens when you\'re not moving. Let the work land.';

    case 'easy':
      if (isCutback) return 'Cutback easy, shorter, slower, no agenda. Your job is to move blood through the legs and get out of the way of recovery. If you feel great, that\'s the cutback working. Don\'t fix it.';
      if (phase === 'BASE') return 'Easy run, conversational pace, full stop. If you can\'t hold a sentence, you\'re running someone else\'s workout. Base miles are compounding interest: boring now, pays off in July.';
      if (phase === 'BUILD') return 'Easy run, keep it honest. The threshold and long run sessions are where adaptation happens; easy days just need to not cost you anything. Run slow enough that the hard days stay hard.';
      if (phase === 'PEAK') return 'Easy run in a peak week. The volume around this one is the real load, treat this as active recovery, not a run you try to make worth something. Slow is correct.';
      if (phase === 'TAPER') return 'Taper easy, legs might feel stiff or flat right now. That\'s normal. Don\'t race this run trying to "feel ready." The fitness is banked; trust it.';
      return 'Easy / conversational pace. No watch-staring, if you can\'t hold a sentence, slow down.';

    case 'recovery':
      return 'Recovery run, genuinely easy, below easy. This exists to move blood through legs that are tired from real work, not to add fitness. If you feel worse at the end than the start, you ran too fast.';

    case 'shakeout':
      return 'Short shakeout, 15–20 min to get the legs moving the day before the race. Four light strides if you want them, nothing more. You are not getting fitter today. You are just reminding your body what running feels like.';

    case 'race':
      return 'Race day. The training is done, you can\'t add fitness now, only spend what you\'ve built. Go out controlled, trust your pacing plan, and run the second half faster than the first.';

    case 'mp':
      return 'Marathon pace block, find the rhythm, practice fueling, show restraint. If it feels easy in the first half, good. That\'s exactly how this is supposed to feel.';

    case 'long': {
      if (phase === 'TAPER') return 'Last long run before race day, keep it easy and cut the distance. You\'re not banking fitness here, you\'re staying sharp. Run relaxed, finish feeling like you held back.';
      if (phase === 'PEAK' && !isCutback) return 'Peak long run, this one matters. Easy throughout unless the structure calls for a finish push. You\'ll feel the volume from this week; that\'s the point. Sleep more than you think you need to.';
      if (isCutback) return 'Cutback long run, shorter, easier, no workout within it. Let the body absorb the last block of work. If you feel surprisingly good, that\'s the cutback doing its job. Don\'t extend it.';

      // BUILD non-cutback: alternate HM-finish vs progression. Research/22 §3.
      const isSpecificWeek = !isCutback && phase === 'BUILD';
      if (isSpecificWeek) {
        if (weekIdx % 6 < 3) {
          return 'Long run with HM finish, first two-thirds easy, then close the last 3–5 miles at goal half-marathon effort. This teaches your legs to run fast when they\'re already tired, which is exactly what mile 10 of the race asks for. Negative-split the whole thing.';
        }
        return 'Progression long run, three gears: first third easy, middle third steady (marathon effort), final third squeezing toward HM goal pace. Not a race. A controlled fade-in. If you go out too fast, you\'ll feel it in the back third and learn the same lesson the hard way.';
      }
      return 'Long run at easy conversational pace. Duration builds durability; pace is irrelevant today. Run slow enough to make tomorrow\'s easy run actually easy.';
    }

    case 'threshold': {
      if (phase === 'BASE') return tsp.BASE.prescription;
      if (phase === 'TAPER') return tsp.TAPER.prescription;
      if (phase === 'PEAK') return tsp.PEAK.prescription;
      if (phase === 'BUILD') return weekIdx % 2 === 1 ? tsp.BUILD_EARLY.prescription : tsp.BUILD_LATE.prescription;
      return tsp.BASE.prescription;
    }

    case 'race_week_tuneup': {
      const tuneUp = RACE_WEEK_TEMPLATES.value.half_sunday.find(d => d.day === 'Tue');
      return tuneUp
        ? `Race week tune-up, ${tuneUp.workout}. Sharp legs, not tired legs. This is a sharpener, not a stimulus, get in, get out, don\'t add reps because it felt good.`
        : 'Race week tune-up, 4–5 mi with 4 × 1K at goal half-marathon pace, 90 sec jog. Sharp, not draining. Get in, get out.';
    }

    case 'interval': {
      if (phase === 'BASE') return 'VO₂max intervals, warm up 1.5 mi easy, then 5 × 800m at 5K effort, jog equal distance between. You should finish each rep feeling like you could have gone one more. If you\'re destroyed after rep 3, the pace is too fast.';
      if (phase === 'BUILD') return 'VO₂max intervals, 5–6 × 1K at 5K effort, 90 sec jog between. Fast and controlled. These exist to protect your top-end speed while threshold mileage is the main story, don\'t skip them, but don\'t race them either.';
      if (phase === 'PEAK') return 'Controlled VO₂ fartlek, 8–10 × 1 min fast / 1 min easy, or 5 × 3 min at 10K effort / 2 min easy. This sits between big long runs on purpose. You want pop, not damage. If you\'re still sore from the long run, back off the pace and prioritize the leg turnover.';
      return 'VO₂max intervals, 5K to 10K effort. 1K reps with equal-time jog recovery. Finish feeling fast, not finished.';
    }

    default: return '';
  }
}

// ─────────────────────────────────────────────────────────────────
// Adaptive strength slot selection
// Research/07 §12.3, §13, §21 Rule 7:
//   "Pair hard with hard." Heavy strength on days with 48h+ clearance
//   from both the preceding hard session and the next hard session.
//   Lower body needs 48h before the next hard run (§13: Heavy lower-body
//   → hard run → 24–48 h). Upper body needs only 4–12 h (§13: Heavy
//   upper-body → hard run → 4–12 h), so it can sit 24h before quality.
// ─────────────────────────────────────────────────────────────────

interface StrengthSlot { workout: PlanWorkout; focus: 'lower' | 'upper' }

/** Score an easy day for strength placement. Higher = better.
 *  Returns days-after-hard and days-before-hard for focus assignment. */
function strengthDayScore(
  dow: number,
  hardDows: Set<number>,
): { score: number; daysAfterHard: number; daysBeforeHard: number } {
  if (hardDows.size === 0) {
    return { score: 50, daysAfterHard: 7, daysBeforeHard: 7 };
  }
  let daysAfterHard  = 7; // min circular days elapsed since last hard session
  let daysBeforeHard = 7; // min circular days until next hard session
  for (const hd of hardDows) {
    const after  = (dow - hd + 7) % 7; // days since hd; 0 = same day (excluded)
    const before = (hd - dow + 7) % 7;
    if (after  > 0) daysAfterHard  = Math.min(daysAfterHard,  after);
    if (before > 0) daysBeforeHard = Math.min(daysBeforeHard, before);
  }
  // Scoring (Research/07 §13):
  //   48h+ after last hard  → heavy lifting cleared → +40
  //   24h after last hard   → maintenance only       → +10
  //   48h+ before next hard → lower body safe        → +40
  //   24h before next hard  → upper body OK          → +20
  const scoreAfter  = daysAfterHard  >= 2 ? 40 : daysAfterHard  === 1 ? 10 : 0;
  const scoreBefore = daysBeforeHard >= 2 ? 40 : daysBeforeHard === 1 ? 20 : 0;
  return { score: scoreAfter + scoreBefore, daysAfterHard, daysBeforeHard };
}

/** Pick up to maxSlots easy days per week, ranked by placement quality.
 *  Focus: lower body when 48h+ before next hard run, upper body otherwise. */
function selectStrengthSlots(workouts: PlanWorkout[], maxSlots: number): StrengthSlot[] {
  if (maxSlots === 0) return [];

  const hardDows = new Set(
    workouts.filter(wo => wo.isQuality || wo.isLong).map(wo => wo.dow),
  );
  const eligible = workouts.filter(
    wo => wo.type === 'easy' && wo.distanceMi > 0,
  );

  const scored = eligible.map(wo => {
    const { score, daysAfterHard, daysBeforeHard } = strengthDayScore(wo.dow, hardDows);
    // Lower body requires 48h before the next hard run to avoid interference.
    // If the next hard session is only 24h away, use upper body instead.
    const focus: 'lower' | 'upper' =
      daysAfterHard >= 2 && daysBeforeHard >= 2 ? 'lower' : 'upper';
    return { wo, score, focus };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSlots).map(s => ({ workout: s.wo, focus: s.focus }));
}

function weekRationale(
  idx: number, phase: PhaseLabel,
  isCutback: boolean, isPeak: boolean, isRaceWeek: boolean,
): string {
  if (isRaceWeek) return 'Race week. The training is done. Protect your legs, sleep well, and trust what you\'ve built.';
  if (isPeak)     return 'Peak week, highest volume of the plan. This week will either make you feel like a weapon or expose where recovery is leaking. Sleep, carbs, hydration, and no dumb bonus intensity. Nail this, and race day gets a lot less mysterious.';
  if (isCutback)  return `Cutback week, volume drops ~18% so the last block of work can actually land. Don\'t fill the extra time with bonus activity. Feeling suspiciously good by Friday is the goal.`;
  const phaseNote: Partial<Record<PhaseLabel, string>> = {
    BASE:     'Building the aerobic foundation. Nothing glamorous, nothing dramatic, just consistent work that makes everything else possible.',
    BUILD:    'Build phase. Quality sessions get harder and more specific. The easy days need to stay easy so the hard days can actually be hard.',
    PEAK:     'Peak phase. The volume is high and the workouts are race-specific. Execute the structure, manage recovery, don\'t add anything extra.',
    TAPER:    'Taper. Volume comes down, intensity stays live. Legs might feel flat or anxious, both are normal. The fitness is there.',
  };
  return phaseNote[phase] ?? `Week ${idx + 1} · ${phase.toLowerCase()} phase.`;
}
