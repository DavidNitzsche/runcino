/**
 * build-workout.ts
 *
 * Builds the WatchWorkout JSON the watch decodes from applicationContext.
 *
 * Wire contract: docs/coach/WATCH_CONTRACT.md + the watch's Swift struct
 * at legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift.
 *
 * The payload feeds the SAME prescription module the iPhone modal uses
 * (lib/training/prescriptions.ts), so what the watch executes matches
 * what you see on the phone exactly. For repeat blocks (cruise intervals,
 * threshold reps, etc.) the recovery folds out into individual phases:
 *
 *   warmup → work₁ → recovery₁ → work₂ → recovery₂ → ... → workN → cooldown
 *
 * Wire field names ARE NOT the same as the prescription module — watch
 * uses `type` (not `kind`) and a specific haptic enum. Don't free-style
 * the field names; the Swift decoder will refuse them.
 */
import { pool } from '@/lib/db/pool';
import { prescriptionFor, type WorkoutType, type PrescriptionStep } from '@/lib/training/prescriptions';
import { expandSpecToPhases, type ExpandedPhase } from '@/lib/training/expand-spec';
import { parseRaceTime as parseRaceGoalSec } from '@/lib/training/vdot';

const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.faff.run';

// ── Wire-format types (must match Swift WatchPhase/WatchWorkout) ───────

export type WatchPhaseType = 'warmup' | 'work' | 'recovery' | 'cooldown';
export type WatchHaptic =
  | 'start'
  | 'transition-work'
  | 'transition-recovery'
  | 'transition-cooldown'
  | 'end';
export type WatchRepUnit = 'time' | 'distance';

export interface WatchPhase {
  type: WatchPhaseType;
  label: string;
  durationSec: number;                // required, even for distance reps (estimate)
  targetPaceSPerMi?: number | null;
  tolerancePaceSPerMi?: number | null;
  haptic: WatchHaptic;
  repUnit?: WatchRepUnit;
  distanceMi?: number | null;
}

export interface WatchWorkout {
  workoutId: string;
  name: string;
  summary: string;
  totalEstimatedMinutes: number;
  phases: WatchPhase[];
  completionEndpoint: string;
  expiresAt: string;
  readinessScore?: number | null;
  readinessLabel?: string | null;
  distanceMi?: number | null;
  paceLabel?: string | null;
  isRace: boolean;
  goalSec?: number | null;
  strategyLabel?: string | null;
  gelsMi?: number[] | null;
  fueling?: { needed: boolean; gels: number; atMins: number[]; gPerHr: number; totalCarbsG: number; isRehearsal: boolean; heatAdjusted: boolean; shortLine: string; why: string } | null;
  hrCeilingBpm?: number | null;
  displayHint?: string | null;
}

export type WatchTodayResponse =
  | { workout: WatchWorkout; message?: undefined }
  | { workout?: undefined; message: string };

// ── Parsers ─────────────────────────────────────────────────────────────

/** "6:47" → 407 · "6:47 /mi" → 407 · null otherwise */
function parsePaceSec(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d+):(\d{2})/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

/** Range like "7:47-8:37 /mi" → { target: midpoint, tolerance: half-range }.
 *  Single value like "6:47" → { target: 407, tolerance: 8 } */
function parsePaceTarget(
  s: string | null | undefined,
  defaultTolerance = 8,
): { targetSec: number | null; toleranceSec: number | null } {
  if (!s) return { targetSec: null, toleranceSec: null };
  const rangeMatch = String(s).match(/(\d+):(\d{2})\s*-\s*(\d+):(\d{2})/);
  if (rangeMatch) {
    const lo = (+rangeMatch[1]) * 60 + (+rangeMatch[2]);
    const hi = (+rangeMatch[3]) * 60 + (+rangeMatch[4]);
    return {
      targetSec: Math.round((lo + hi) / 2),
      toleranceSec: Math.round((hi - lo) / 2),
    };
  }
  const single = parsePaceSec(s);
  if (single != null) return { targetSec: single, toleranceSec: defaultTolerance };
  return { targetSec: null, toleranceSec: null };
}

/** "2:00" → 120 seconds */
function parseDurationSec(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

// Rough pace estimates by phase type, used for durationSec on distance reps
// when the prescription doesn't carry one explicitly.
function estimatePaceSecPerMi(type: WatchPhaseType, isEasy: boolean): number {
  if (type === 'warmup' || type === 'cooldown' || isEasy) return 9 * 60;
  return 7 * 60;
}

// ── Step → WatchPhase mapping ───────────────────────────────────────────

/** Map a prescription step's label keyword to the watch's phase type. */
function classifyStep(step: PrescriptionStep): WatchPhaseType {
  const l = step.label.toLowerCase();
  if (l.includes('warmup')) return 'warmup';
  if (l.includes('cooldown')) return 'cooldown';
  if (l.includes('recovery')) return 'recovery';
  // 'easy build', 'easy run', 'reps', 'rep', 'tempo', 'race', 'marathon-pace',
  // 'strides', 'today (rest)' all become 'work'
  return 'work';
}

function isEasyStep(step: PrescriptionStep): boolean {
  const l = step.label.toLowerCase();
  return l.includes('easy') || l.includes('warmup') || l.includes('cooldown') || l.includes('recovery');
}

/** Convert one prescription step to one or more WatchPhases.
 *  Repeat blocks (step.recovery present) expand to N reps + (N-1) recoveries. */
function stepToPhases(step: PrescriptionStep, defaultTolerance: number): WatchPhase[] {
  const phaseType = classifyStep(step);
  const easy = isEasyStep(step);
  const { targetSec, toleranceSec } = parsePaceTarget(step.pace_target, defaultTolerance);

  // Repeat block: N reps (with recovery between, skipping after the last rep)
  if (step.recovery && step.reps != null && step.reps > 0) {
    const reps = step.reps;
    const repDistMi = step.rep_distance_mi ?? 1;
    const repPaceSec = targetSec ?? estimatePaceSecPerMi('work', false);
    const repDurSec = Math.round(repPaceSec * repDistMi);
    const recDurSec = parseDurationSec(step.recovery.duration) ?? 120;
    const recPace = parsePaceTarget(step.recovery.pace_target, 30);

    const phases: WatchPhase[] = [];
    for (let i = 0; i < reps; i++) {
      phases.push({
        type: 'work',
        label: `Rep ${i + 1}/${reps}`,
        durationSec: repDurSec,
        targetPaceSPerMi: targetSec,
        tolerancePaceSPerMi: toleranceSec,
        haptic: 'transition-work',
        repUnit: 'distance',
        distanceMi: repDistMi,
      });
      if (i < reps - 1) {
        phases.push({
          type: 'recovery',
          label: `Recovery ${i + 1}/${reps - 1}`,
          durationSec: recDurSec,
          targetPaceSPerMi: recPace.targetSec,
          tolerancePaceSPerMi: recPace.toleranceSec,
          haptic: 'transition-recovery',
          repUnit: 'time',
        });
      }
    }
    return phases;
  }

  // Simple distance step (warmup, cooldown, easy run, tempo, MP finish, race)
  if (step.distance_mi != null && step.distance_mi > 0) {
    const paceSec = targetSec ?? estimatePaceSecPerMi(phaseType, easy);
    const durSec = Math.round(paceSec * step.distance_mi);
    const haptic: WatchHaptic =
      phaseType === 'warmup'   ? 'start'
    : phaseType === 'cooldown' ? 'transition-cooldown'
    :                            'transition-work';
    return [{
      type: phaseType,
      label: step.label,
      durationSec: durSec,
      targetPaceSPerMi: targetSec,
      tolerancePaceSPerMi: toleranceSec,
      haptic,
      repUnit: 'distance',
      distanceMi: step.distance_mi,
    }];
  }

  // Pure duration step (no reps, no distance) — e.g. shakeout strides set
  if (step.duration) {
    const durSec = parseDurationSec(step.duration) ?? 60;
    return [{
      type: phaseType,
      label: step.label,
      durationSec: durSec,
      targetPaceSPerMi: targetSec,
      tolerancePaceSPerMi: toleranceSec,
      haptic: phaseType === 'cooldown' ? 'transition-cooldown' : 'transition-work',
      repUnit: 'time',
    }];
  }

  return [];
}

// ── Pace label helpers ──────────────────────────────────────────────────

function paceLabelFor(t: string): string {
  switch (t) {
    case 'easy':       return 'E';
    case 'long':       return 'L';
    case 'tempo':      return 'M';
    case 'threshold':  return 'T';
    case 'intervals':  return 'I';
    case 'race':       return 'R';
    case 'shakeout':   return 'E';
    default:           return '';
  }
}

function labelFor(t: string): string {
  switch (t) {
    case 'easy':       return 'Easy';
    case 'long':       return 'Long';
    case 'tempo':      return 'Tempo';
    case 'threshold':  return 'Threshold';
    case 'intervals':  return 'Intervals';
    case 'race':       return 'Race';
    case 'shakeout':   return 'Shakeout';
    default:           return t.charAt(0).toUpperCase() + t.slice(1);
  }
}

// ── Profile helpers ─────────────────────────────────────────────────────

// 2026-06-03 · parseRaceGoalSec used to live inline here as a local
// fork · removed because it mis-parsed "1:30" as 90 seconds (MM:SS)
// instead of 5400 (H:MM). Now uses parseRaceTime from vdot.ts (imported
// at module top) which has the heuristic fix.

function distanceMiFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const l = String(label).toLowerCase();
  if (l.includes('marathon') && !l.includes('half')) return 26.2;
  if (l.includes('half') || l.includes('21k'))  return 13.1;
  if (l.includes('10k')) return 6.2;
  if (l.includes('5k')) return 3.1;
  return null;
}

// ── Main entrypoint ─────────────────────────────────────────────────────

export async function buildWatchToday(
  userId: string,
  /** Override "today" for testing/smoke. Defaults to PT-adjusted now. */
  overrideDate?: string,
): Promise<WatchTodayResponse> {
  const today = overrideDate ?? new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // 1. Find today's plan workout
  const plan = (await pool.query(
    `SELECT id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];
  if (!plan) return { message: "No active plan." };

  const wo = (await pool.query(
    `SELECT date_iso, dow, type, distance_mi, sub_label, workout_spec, pace_target_s_per_mi
       FROM plan_workouts
      WHERE plan_id = $1 AND date_iso = $2::text
      LIMIT 1`,
    [plan.id, today]
  )).rows[0];

  if (!wo) return { message: "Nothing on the calendar today." };
  if (wo.type === 'rest') return { message: "Rest day. Recover hard." };

  const distanceMi = Number(wo.distance_mi) || 0;
  if (distanceMi <= 0) return { message: "Rest day. Recover hard." };

  // 2. Pull profile inputs for the prescription (LTHR + race goal)
  const prof = (await pool.query(
    `SELECT lthr FROM profile
      WHERE user_uuid = $1
      ORDER BY (user_uuid=$1) DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = prof?.lthr ?? null;

  const raceRow = (await pool.query(
    `SELECT meta FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' = 'A'
        AND meta->>'goalDisplay' IS NOT NULL
        AND (meta->>'date')::date >= $2::date
      ORDER BY (meta->>'date') ASC LIMIT 1`,
    [userId, today]
  ).catch(() => ({ rows: [] }))).rows[0];
  const goal_seconds = raceRow ? parseRaceGoalSec(raceRow.meta?.goalDisplay) : null;
  const goal_distance_mi = raceRow
    ? (Number(raceRow.meta?.distanceMi) || distanceMiFromLabel(raceRow.meta?.distanceLabel))
    : null;

  // 3. Weekly mileage — MUST match the iPhone modal exactly, otherwise the
  // watch shows a different number of reps than the modal does. The modal
  // uses a per-day proxy `Math.max(day.plannedMi * 6, 25)` (it doesn't have
  // a cheap way to sum the whole week). We do the same here so the two
  // surfaces agree. We also read the real summed week as a floor, in case
  // the proxy under-counts (e.g. tomorrow is a recovery day in a hot week).
  const todayDow = new Date(today + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = todayDow === 0 ? 6 : todayDow - 1;
  const weeklyMiRow = (await pool.query(
    `SELECT SUM(distance_mi)::numeric AS mi FROM plan_workouts
      WHERE plan_id = $1
        AND date_iso::date BETWEEN ($2::date - $3::int) AND ($2::date - $3::int + 6)`,
    [plan.id, today, daysSinceMonday]
  ).catch(() => ({ rows: [{ mi: 30 }] }))).rows[0];
  const realWeeklyMi = Number(weeklyMiRow?.mi) || 30;
  const proxyWeeklyMi = Math.max(distanceMi * 6, 25);
  // Use whichever is HIGHER — matches the modal when modal's proxy wins,
  // and matches reality when the real week is denser than 6×today.
  const weeklyMi = Math.max(realWeeklyMi, proxyWeeklyMi);

  // 4. Generate the same prescription the iPhone modal uses · used as
  //    a fallback (and to source the headline / pacing strings when
  //    workout_spec is absent).
  const prescription = prescriptionFor(
    wo.type as WorkoutType,
    weeklyMi,
    { lthr, goal_seconds, goal_distance_mi },
    distanceMi,
  );

  // Tolerance defaults per workout type (tighter for threshold/intervals).
  const defaultTolerance =
    wo.type === 'threshold' || wo.type === 'intervals' ? 8
  : wo.type === 'tempo' || wo.type === 'race'          ? 12
  :                                                      20;

  // 5. Expand to phases · PREFER workout_spec (authored truth) over
  //    prescriptionFor() (generic template). Per iPhone agent's
  //    2026-06-02 brief · workout_spec is the single source of truth.
  //    When the spec is absent (pre-migration rows, easy/rest days
  //    without quality structure), fall back to the prescription
  //    template so older plans + simple types still render.
  const phases: WatchPhase[] = [];
  // Easy-pace fallback · derive from goal pace if available (goal +
  // 60-90 s/mi is standard easy pace) · default to 9:00/mi.
  const easyPaceFallback = goal_seconds && goal_distance_mi
    ? Math.round(goal_seconds / goal_distance_mi) + 90
    : 540;
  const expanded = wo.workout_spec
    ? expandSpecToPhases({
        spec: wo.workout_spec,
        totalMi: distanceMi,
        easyPaceSec: easyPaceFallback,
        recoveryPaceSec: 540,
        toleranceSec: defaultTolerance,
      })
    : null;
  if (expanded && expanded.length > 0) {
    // workout_spec drove the phase list · convert ExpandedPhase →
    // WatchPhase (same shape, just need to add haptic + repUnit).
    for (const p of expanded) {
      phases.push({
        type: p.type,
        label: p.label,
        durationSec: p.durationSec ?? Math.round((p.distanceMi ?? 0) * (p.targetPaceSPerMi ?? 540)),
        targetPaceSPerMi: p.targetPaceSPerMi ?? null,
        tolerancePaceSPerMi: p.tolerancePaceSPerMi ?? null,
        haptic: 'start',  // patched below
        repUnit: p.distanceMi != null ? 'distance' : 'time',
        distanceMi: p.distanceMi ?? null,
      });
    }
  } else {
    // Fallback · workout_spec absent or unrecognized kind.
    for (const step of prescription.steps) {
      phases.push(...stepToPhases(step, defaultTolerance));
    }
  }
  if (phases.length === 0) {
    // Last-resort fallback: single open work phase covering the planned distance
    phases.push({
      type: 'work',
      label: prescription.headline,
      durationSec: Math.round(distanceMi * 9 * 60),
      targetPaceSPerMi: null, tolerancePaceSPerMi: null,
      haptic: 'start', repUnit: 'distance', distanceMi,
    });
  }

  // 6. Patch haptics: first phase = 'start', last phase = 'transition-cooldown'
  //    (the engine treats the last cooldown as the wind-down marker)
  if (phases.length > 0) {
    phases[0].haptic = 'start';
    const last = phases[phases.length - 1];
    if (last.type === 'cooldown') last.haptic = 'transition-cooldown';
  }

  // 7. Workout-level fields
  const totalSec = phases.reduce((s, p) => s + p.durationSec, 0);
  const totalEstimatedMinutes = Math.round(totalSec / 60);
  // HR ceiling only for easy/long where staying aerobic is the discipline
  const hrCeilingBpm = (wo.type === 'easy' || wo.type === 'long') && lthr
    ? Math.round(lthr * 0.89)  // top of Z2 in Friel zones
    : null;

  const summary = `${distanceMi.toFixed(1)} mi · ${prescription.headline}`;

  const workout: WatchWorkout = {
    workoutId: `${userId}-${today}`,
    name: wo.sub_label || labelFor(wo.type),
    summary,
    totalEstimatedMinutes,
    phases,
    completionEndpoint: `${DEFAULT_BASE_URL}/api/watch/workouts/complete`,
    // 2026-06-02 · Flag 6 from watch audit · sliding 14h window from
    // issue time. Replaces the end-of-day-UTC stamp that clipped
    // runners starting workouts near midnight UTC even when they
    // were inside the real "today" window. Watch agent enforces this
    // on start (refuses + re-fetches when stale). Covers:
    //   · early-AM (issued 6PM → valid until 8AM next-day)
    //   · late-PM (issued 8AM → valid until 10PM same-day)
    // 14h covers both extremes. Doctrine:
    //   designs/briefs/backend-response-to-watch-2026-06-02.md
    expiresAt: new Date(Date.now() + 14 * 3600 * 1000).toISOString(),
    distanceMi,
    paceLabel: paceLabelFor(wo.type),
    isRace: wo.type === 'race',
    hrCeilingBpm,
    displayHint: wo.type === 'long' ? 'hr' : null,
  };

  // P27.5 — populate readiness on the watch payload. Before this the
  // model declared readinessScore/Label fields but the server never
  // sent them, so the watch face fell through to a hardcoded fixture.
  try {
    const { loadCoachState } = await import('@/lib/coach/state-loader');
    const { computeReadiness } = await import('@/lib/coach/readiness');
    const state = await loadCoachState(userId);
    const r = computeReadiness(state);
    workout.readinessScore = r.score ?? null;
    workout.readinessLabel = r.label ?? r.band ?? null;
  } catch {
    /* don't fail the watch payload over readiness — best effort only */
  }

  return { workout };
}
