/**
 * build-workout.ts
 *
 * Builds the WatchWorkout JSON the watch decodes from applicationContext.
 * Wire contract is FROZEN — see docs/coach/WATCH_CONTRACT.md and the
 * watch's own struct at legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift.
 *
 * For P1.5 the build emits a minimal valid payload from plan_workouts:
 * warmup + main + cooldown phases derived from the day's type/distance.
 * Detailed interval composition (rep splits, target paces, fueling cues)
 * grows in P3 and beyond.
 */
import { pool } from '@/lib/db/pool';

const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://next.faff.run';

export type WatchPhase = {
  id: string;
  kind: 'warmup' | 'work' | 'recovery' | 'cooldown';
  label: string;
  targetSec?: number | null;
  targetPaceSPerMi?: number | null;
  targetHrBpm?: number | null;
  tolerancePaceSPerMi?: number | null;
  haptic: 'none' | 'soft' | 'firm';
  repUnit: 'time' | 'distance';
  distanceMi?: number | null;
};

export type WatchWorkout = {
  workoutId: string;
  name: string;
  summary: string;
  totalEstimatedMinutes: number;
  phases: WatchPhase[];
  completionEndpoint: string;
  expiresAt: string;
  // Glance fields
  readinessScore?: number | null;
  readinessLabel?: string | null;
  distanceMi?: number | null;
  paceLabel?: string | null;
  // Race day
  isRace: boolean;
  goalSec?: number | null;
  strategyLabel?: string | null;
  gelsMi?: number[] | null;
  // Fueling
  fueling?: { atMins: number[]; itemLabel: string } | null;
  // HR ceiling for Z2/easy
  hrCeilingBpm?: number | null;
  // Face hint
  displayHint?: string | null;
};

export type WatchTodayResponse =
  | { workout: WatchWorkout; message?: undefined }
  | { workout?: undefined; message: string };

export async function buildWatchToday(userId: string): Promise<WatchTodayResponse> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // Find today's plan workout (if any).
  const plan = (await pool.query(
    `SELECT id FROM training_plans
      WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];
  if (!plan) return { message: "No active plan." };

  const wo = (await pool.query(
    `SELECT date_iso, dow, type, distance_mi, sub_label
       FROM plan_workouts
      WHERE plan_id = $1 AND date_iso = $2::text
      LIMIT 1`,
    [plan.id, today]
  )).rows[0];

  if (!wo) return { message: "Nothing on the calendar today." };
  if (wo.type === 'rest') return { message: "Rest day. Recover hard." };

  const distanceMi = Number(wo.distance_mi) || 0;
  if (distanceMi <= 0) return { message: "Rest day. Recover hard." };

  // Simple phase template: warmup mi 1, main mi (n-2), cooldown mi 1.
  // For workouts ≤ 3mi we keep just warmup + main (no cooldown segment).
  const warmupMi  = distanceMi >= 4 ? 1 : Math.min(distanceMi / 4, 0.75);
  const cooldownMi = distanceMi >= 4 ? 1 : 0;
  const mainMi   = Math.max(0, distanceMi - warmupMi - cooldownMi);

  const paceLabel = paceLabelFor(wo.type);
  const totalMinutes = Math.round(distanceMi * 9); // ~9min/mi rough

  // Pull readiness label (P1.5 — wires the §8.3 component data once it ships).
  // For now use placeholder; coach engine will populate later.
  const phases: WatchPhase[] = [];
  if (warmupMi > 0) {
    phases.push({
      id: `${today}-wu`, kind: 'warmup', label: 'Warmup',
      distanceMi: warmupMi, repUnit: 'distance', haptic: 'soft',
      targetPaceSPerMi: null, targetHrBpm: null, tolerancePaceSPerMi: null,
    });
  }
  if (mainMi > 0) {
    phases.push({
      id: `${today}-main`, kind: 'work', label: wo.sub_label || labelFor(wo.type),
      distanceMi: mainMi, repUnit: 'distance', haptic: 'firm',
      targetPaceSPerMi: null, targetHrBpm: null, tolerancePaceSPerMi: null,
    });
  }
  if (cooldownMi > 0) {
    phases.push({
      id: `${today}-cd`, kind: 'cooldown', label: 'Cooldown',
      distanceMi: cooldownMi, repUnit: 'distance', haptic: 'soft',
      targetPaceSPerMi: null, targetHrBpm: null, tolerancePaceSPerMi: null,
    });
  }

  const workout: WatchWorkout = {
    workoutId: `${userId}-${today}`,
    name: wo.sub_label || labelFor(wo.type),
    summary: `${distanceMi.toFixed(1)} mi · ${labelFor(wo.type)}`,
    totalEstimatedMinutes: totalMinutes,
    phases,
    completionEndpoint: `${DEFAULT_BASE_URL}/api/watch/workouts/complete`,
    expiresAt: new Date(Date.parse(today + 'T23:59:59Z')).toISOString(),
    distanceMi,
    paceLabel,
    isRace: false,
    hrCeilingBpm: wo.type === 'easy' || wo.type === 'long' ? 145 : null,
    displayHint: wo.type === 'long' ? 'hr' : null,
  };

  return { workout };
}

function paceLabelFor(t: string): string {
  switch (t) {
    case 'easy':       return 'E';
    case 'long':       return 'E';
    case 'tempo':      return 'T';
    case 'threshold':  return 'T';
    case 'intervals':  return 'I';
    case 'race':       return 'R';
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
    default:           return t.charAt(0).toUpperCase() + t.slice(1);
  }
}
