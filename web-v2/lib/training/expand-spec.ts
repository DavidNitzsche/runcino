/**
 * lib/training/expand-spec.ts · the SINGLE source for expanding a
 * plan_workouts.workout_spec into the flat phase list every consumer
 * needs (watch payload, today purpose, recap deltas, brief copy).
 *
 * iPhone agent 2026-06-02 brief flagged the bug class:
 *   buildWatchToday was calling `prescriptionFor()` (generic template)
 *   instead of expanding `workout_spec` (authored truth). David's watch
 *   was showing "6×800m @ 90s" when his spec said "4×1mi @ 180s."
 *
 * Architecture (per iPhone brief Tier 2):
 *   · workout_spec is the source of truth (authored by generator)
 *   · expandSpecToPhases(spec) → WatchPhase[] is the ONLY path that
 *     turns a spec into a phase list
 *   · every consumer calls this · no other code path generates phases
 *   · prescriptionFor() becomes a fallback ONLY when spec is null
 *     (cold start, pre-migration rows · backfill cron handles these)
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md
 * Cite: designs/briefs/iphone-workout-spec-single-source-2026-06-02.md
 */

import type { WorkoutSpec } from '@/lib/plan/spec-builder';

export type ExpandedPhaseType = 'warmup' | 'work' | 'recovery' | 'cooldown';

export interface ExpandedPhase {
  type: ExpandedPhaseType;
  label: string;
  /** Optional · for distance-based phases (rep N of M, WU/CD). When
   *  set, also set durationSec via durationFromDistance(). */
  distanceMi?: number | null;
  /** Optional · for time-based phases (jog recovery, time-only intervals). */
  durationSec?: number | null;
  /** Target pace · null for recovery / unstructured. */
  targetPaceSPerMi?: number | null;
  /** Tolerance band around target · pace ± this still counts as "on pace". */
  tolerancePaceSPerMi?: number | null;
}

export interface ExpandSpecInput {
  spec: WorkoutSpec;
  /** Total distance the runner will cover · used to size easy/long/recovery
   *  bars + to validate total = WU + core + CD where applicable. */
  totalMi: number;
  /** Easy-pace fallback when the spec doesn't include pace targets
   *  (WU/CD always use easy pace). seconds/mi. */
  easyPaceSec: number;
  /** Recovery jog pace · seconds/mi. ~9:00/mi default. */
  recoveryPaceSec?: number;
  /** Default tolerance per phase type · in seconds/mi. */
  toleranceSec?: number;
}

/**
 * Expand a workout_spec into a flat phase list. Pure function ·
 * deterministic · no DB. Returns null when the spec is null or
 * unrecognized · caller should fall back to a generic prescription.
 *
 * Coverage:
 *   · tempo       · WU + tempo block + CD
 *   · threshold   · WU + (rep + recovery) × N (last rep no recovery) + CD
 *   · intervals   · same as threshold (different paces)
 *   · long        · single work block · optional fuel-mi markers
 *   · easy        · single work block
 *   · recovery    · single recovery-paced block
 *   · race        · single work block at race pace
 *
 * For threshold + intervals, the recovery between reps is a TIME-based
 * phase (rep_rest_s) at the recovery pace. The watch UI advances by
 * timer, not by GPS distance, for those phases.
 */
export function expandSpecToPhases(input: ExpandSpecInput): ExpandedPhase[] | null {
  const { spec, totalMi, easyPaceSec } = input;
  if (!spec || typeof spec !== 'object') return null;

  const s = spec as Record<string, unknown>;
  const kind = String(s.kind ?? '');
  const recoveryPace = input.recoveryPaceSec ?? 540;  // 9:00/mi default
  const defaultTolerance = input.toleranceSec ?? 12;

  switch (kind) {
    case 'tempo':
      return expandTempo(s, easyPaceSec, defaultTolerance);
    case 'threshold':
    case 'intervals':
      return expandReps(s, easyPaceSec, recoveryPace, defaultTolerance);
    case 'long':
      return expandLong(s, totalMi, easyPaceSec, defaultTolerance);
    case 'easy':
    case 'shakeout':
      return expandEasy(s, totalMi, easyPaceSec, defaultTolerance);
    case 'recovery':
      return expandRecovery(s, totalMi, recoveryPace, defaultTolerance);
    default:
      return null;
  }
}

// ── per-kind expanders ─────────────────────────────────────────────────

function expandTempo(
  s: Record<string, unknown>,
  easyPaceSec: number,
  tolerance: number,
): ExpandedPhase[] {
  const wu = Number(s.warmup_mi ?? 1.5) || 1.5;
  const tempoMi = Number(s.tempo_distance_mi ?? 4) || 4;
  const cd = Number(s.cooldown_mi ?? 1.0) || 1.0;
  const tempoPace = Number(s.tempo_pace_s_per_mi) || (easyPaceSec - 80);
  return [
    {
      type: 'warmup',
      label: 'Warm-up',
      distanceMi: Number(wu.toFixed(1)),
      durationSec: Math.round(wu * easyPaceSec),
      targetPaceSPerMi: easyPaceSec,
      tolerancePaceSPerMi: 30,
    },
    {
      type: 'work',
      label: `${tempoMi.toFixed(1)} mi tempo`,
      distanceMi: Number(tempoMi.toFixed(1)),
      durationSec: Math.round(tempoMi * tempoPace),
      targetPaceSPerMi: tempoPace,
      tolerancePaceSPerMi: tolerance,
    },
    {
      type: 'cooldown',
      label: 'Cool-down',
      distanceMi: Number(cd.toFixed(1)),
      durationSec: Math.round(cd * easyPaceSec),
      targetPaceSPerMi: easyPaceSec,
      tolerancePaceSPerMi: 30,
    },
  ];
}

function expandReps(
  s: Record<string, unknown>,
  easyPaceSec: number,
  recoveryPace: number,
  tolerance: number,
): ExpandedPhase[] {
  const wu = Number(s.warmup_mi ?? 1.5) || 1.5;
  const cd = Number(s.cooldown_mi ?? 1.0) || 1.0;
  const reps = Number(s.rep_count ?? 4) || 4;
  // Field precedence · prefer _mi · fall back to _m / 1609.34 (legacy rows).
  const repMi = Number(s.rep_distance_mi ?? 0) || 0;
  const repM = Number(s.rep_distance_m ?? 0) || 0;
  const effRepMi = repMi > 0 ? repMi : (repM / 1609.34);
  const repPace = Number(s.rep_pace_s_per_mi) || easyPaceSec - 80;
  const restS = Number(s.rep_rest_s ?? 60) || 60;
  const phases: ExpandedPhase[] = [];

  phases.push({
    type: 'warmup',
    label: 'Warm-up',
    distanceMi: Number(wu.toFixed(1)),
    durationSec: Math.round(wu * easyPaceSec),
    targetPaceSPerMi: easyPaceSec,
    tolerancePaceSPerMi: 30,
  });

  for (let i = 0; i < reps; i++) {
    phases.push({
      type: 'work',
      label: `Rep ${i + 1}/${reps} · ${formatRepLabel(effRepMi)}`,
      distanceMi: Number(effRepMi.toFixed(2)),
      durationSec: Math.round(effRepMi * repPace),
      targetPaceSPerMi: repPace,
      tolerancePaceSPerMi: tolerance,
    });
    // Recovery between reps (not after last)
    if (i < reps - 1) {
      phases.push({
        type: 'recovery',
        label: `Jog ${formatSec(restS)}`,
        distanceMi: null,
        durationSec: restS,
        targetPaceSPerMi: recoveryPace,
        tolerancePaceSPerMi: 60,
      });
    }
  }

  phases.push({
    type: 'cooldown',
    label: 'Cool-down',
    distanceMi: Number(cd.toFixed(1)),
    durationSec: Math.round(cd * easyPaceSec),
    targetPaceSPerMi: easyPaceSec,
    tolerancePaceSPerMi: 30,
  });
  return phases;
}

function expandLong(
  s: Record<string, unknown>,
  totalMi: number,
  easyPaceSec: number,
  tolerance: number,
): ExpandedPhase[] {
  const lo = Number(s.pace_target_s_per_mi_lo ?? easyPaceSec - 30) || (easyPaceSec - 30);
  const hi = Number(s.pace_target_s_per_mi_hi ?? easyPaceSec + 30) || (easyPaceSec + 30);
  const mid = Math.round((lo + hi) / 2);
  return [{
    type: 'work',
    label: `${totalMi.toFixed(1)} mi long run`,
    distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * mid),
    targetPaceSPerMi: mid,
    tolerancePaceSPerMi: Math.max(tolerance, Math.round((hi - lo) / 2)),
  }];
}

function expandEasy(
  s: Record<string, unknown>,
  totalMi: number,
  easyPaceSec: number,
  tolerance: number,
): ExpandedPhase[] {
  const lo = Number(s.pace_target_s_per_mi_lo ?? easyPaceSec - 30) || (easyPaceSec - 30);
  const hi = Number(s.pace_target_s_per_mi_hi ?? easyPaceSec + 60) || (easyPaceSec + 60);
  const mid = Math.round((lo + hi) / 2);
  return [{
    type: 'work',
    label: `${totalMi.toFixed(1)} mi easy`,
    distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * mid),
    targetPaceSPerMi: mid,
    tolerancePaceSPerMi: Math.max(tolerance, Math.round((hi - lo) / 2)),
  }];
}

function expandRecovery(
  s: Record<string, unknown>,
  totalMi: number,
  recoveryPace: number,
  tolerance: number,
): ExpandedPhase[] {
  const lo = Number(s.pace_target_s_per_mi_lo ?? recoveryPace) || recoveryPace;
  const hi = Number(s.pace_target_s_per_mi_hi ?? recoveryPace + 60) || (recoveryPace + 60);
  const mid = Math.round((lo + hi) / 2);
  return [{
    type: 'work',
    label: `${totalMi.toFixed(1)} mi recovery jog`,
    distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * mid),
    targetPaceSPerMi: mid,
    tolerancePaceSPerMi: Math.max(tolerance, Math.round((hi - lo) / 2)),
  }];
}

// ── helpers ────────────────────────────────────────────────────────────

function formatRepLabel(repMi: number): string {
  // 1.0 → "1 mi"; 0.62 → "1 km"; 0.5 → "800 m"; 0.25 → "400 m"
  if (Math.abs(repMi - 1.0) < 0.05) return '1 mi';
  if (Math.abs(repMi - 0.621) < 0.02) return '1 km';
  if (Math.abs(repMi - 0.497) < 0.02) return '800 m';
  if (Math.abs(repMi - 0.249) < 0.02) return '400 m';
  if (Math.abs(repMi - 1.243) < 0.03) return '2 km';
  return `${repMi.toFixed(2)} mi`;
}

function formatSec(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, '0')}`;
  }
  return `${s}s`;
}
