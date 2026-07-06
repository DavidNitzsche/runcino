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
  /** 2026-06-08 · True only on the closing HM/M pace segment of a long run
   *  (set by expandLong when the spec carries finish_mi). Consumers route it
   *  to a FINISH face instead of the rep face. Absent/false everywhere else. */
  isFinishSegment?: boolean;
}

export interface ExpandSpecInput {
  spec: WorkoutSpec;
  /** Total distance the runner will cover · used to size easy/long/recovery
   *  bars + to validate total = WU + core + CD where applicable. */
  totalMi: number;
  /** Easy-pace anchor when the spec doesn't include pace targets
   *  (WU/CD always use easy pace). seconds/mi.
   *  P1-47 fix 2026-07-06 · null means "no fitness signal" — WU/CD/recovery
   *  phases then go out BY FEEL (targetPaceSPerMi: null) instead of a
   *  fabricated number. Callers derive this from the runner's OWN easy pace
   *  (plan-authored easy band · Research/01-pace-zones-vdot.md §E-pace),
   *  never from goal race pace or a fixed constant. */
  easyPaceSec: number | null;
  /** Recovery jog pace · seconds/mi. Jog recoveries are easy jogging
   *  (Research/04-workout-vocabulary.md §1 recovery runs) — callers pass
   *  the same easy anchor. null → by-feel recovery (no pace target). */
  recoveryPaceSec?: number | null;
  /** Default tolerance per phase type · in seconds/mi. */
  toleranceSec?: number;
  /** Optional phase-label override for types that need a name other than
   *  the generic "N mi long run" / "N mi easy". Pass "Race effort" for
   *  race workouts and "Shakeout" for shakeout workouts. Internal label
   *  only — no behavior change. */
  workPhaseLabel?: string;
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
  // P1-47 fix 2026-07-06 · no 9:00/mi default. When the caller has no real
  // easy-pace anchor, recovery phases carry no pace target (by feel) — a
  // 12:00/mi runner was being handed a 9:00/mi jog-recovery target.
  const recoveryPace = input.recoveryPaceSec ?? input.easyPaceSec ?? null;
  const defaultTolerance = input.toleranceSec ?? 12;

  switch (kind) {
    case 'tempo':
      return expandTempo(s, easyPaceSec, defaultTolerance);
    case 'threshold':
    case 'intervals':
      return expandReps(s, easyPaceSec, recoveryPace, defaultTolerance);
    case 'long':
      return expandLong(s, totalMi, easyPaceSec, defaultTolerance, input.workPhaseLabel);
    case 'easy':
    case 'shakeout':
      return expandEasy(s, totalMi, easyPaceSec, defaultTolerance, input.workPhaseLabel);
    case 'recovery':
      return expandRecovery(s, totalMi, recoveryPace, defaultTolerance);
    default:
      return null;
  }
}

// ── per-kind expanders ─────────────────────────────────────────────────

/** Internal duration ESTIMATE (s/mi) used ONLY to size durationSec when no
 *  pace anchor exists — the wire contract requires durationSec even for
 *  by-feel phases. Never emitted as a pace target (P1-47 · 2026-07-06). */
const DURATION_EST_S_PER_MI = 540;

function expandTempo(
  s: Record<string, unknown>,
  easyPaceSec: number | null,
  tolerance: number,
): ExpandedPhase[] {
  const wu = Number(s.warmup_mi ?? 1.5) || 1.5;
  const tempoMi = Number(s.tempo_distance_mi ?? 4) || 4;
  const cd = Number(s.cooldown_mi ?? 1.0) || 1.0;
  // Legacy fallback (spec without tempo pace): T ≈ E − 80 inverts the
  // spec-builder easy offset (easy lo = T + 80 · Research/01 §T-pace).
  // Null easy anchor → by-feel tempo, never a fabricated number.
  const tempoPace = Number(s.tempo_pace_s_per_mi) || (easyPaceSec != null ? easyPaceSec - 80 : null);
  const easyEst = easyPaceSec ?? DURATION_EST_S_PER_MI;
  return [
    {
      type: 'warmup',
      label: 'Warm-up',
      distanceMi: Number(wu.toFixed(1)),
      durationSec: Math.round(wu * easyEst),
      targetPaceSPerMi: easyPaceSec,
      tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
    },
    {
      type: 'work',
      label: `${tempoMi.toFixed(1)} mi tempo`,
      distanceMi: Number(tempoMi.toFixed(1)),
      durationSec: Math.round(tempoMi * (tempoPace ?? DURATION_EST_S_PER_MI)),
      targetPaceSPerMi: tempoPace,
      tolerancePaceSPerMi: tempoPace != null ? tolerance : null,
    },
    {
      type: 'cooldown',
      label: 'Cool-down',
      distanceMi: Number(cd.toFixed(1)),
      durationSec: Math.round(cd * easyEst),
      targetPaceSPerMi: easyPaceSec,
      tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
    },
  ];
}

function expandReps(
  s: Record<string, unknown>,
  easyPaceSec: number | null,
  recoveryPace: number | null,
  tolerance: number,
): ExpandedPhase[] {
  const wu = Number(s.warmup_mi ?? 1.5) || 1.5;
  const cd = Number(s.cooldown_mi ?? 1.0) || 1.0;
  const reps = Number(s.rep_count ?? 4) || 4;
  // Field precedence · prefer _mi · fall back to _m / 1609.34 (legacy rows).
  const repMi = Number(s.rep_distance_mi ?? 0) || 0;
  const repM = Number(s.rep_distance_m ?? 0) || 0;
  const effRepMi = repMi > 0 ? repMi : (repM / 1609.34);
  // Null easy anchor → by-feel rep target (legacy specs without a rep pace
  // AND no fitness signal) — never a fabricated number (P1-47).
  const repPace = Number(s.rep_pace_s_per_mi) || (easyPaceSec != null ? easyPaceSec - 80 : null);
  const restS = Number(s.rep_rest_s ?? 60) || 60;
  const easyEst = easyPaceSec ?? DURATION_EST_S_PER_MI;
  const phases: ExpandedPhase[] = [];

  phases.push({
    type: 'warmup',
    label: 'Warm-up',
    distanceMi: Number(wu.toFixed(1)),
    durationSec: Math.round(wu * easyEst),
    targetPaceSPerMi: easyPaceSec,
    tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
  });

  for (let i = 0; i < reps; i++) {
    phases.push({
      type: 'work',
      label: `Interval · ${formatRepLabel(effRepMi)}`,
      distanceMi: Number(effRepMi.toFixed(2)),
      durationSec: Math.round(effRepMi * (repPace ?? DURATION_EST_S_PER_MI)),
      targetPaceSPerMi: repPace,
      tolerancePaceSPerMi: repPace != null ? tolerance : null,
    });
    // Recovery between reps (not after last)
    if (i < reps - 1) {
      phases.push({
        type: 'recovery',
        label: `Jog ${formatSec(restS)}`,
        distanceMi: null,
        durationSec: restS,
        targetPaceSPerMi: recoveryPace,
        tolerancePaceSPerMi: recoveryPace != null ? 60 : null,
      });
    }
  }

  phases.push({
    type: 'cooldown',
    label: 'Cool-down',
    distanceMi: Number(cd.toFixed(1)),
    durationSec: Math.round(cd * easyEst),
    targetPaceSPerMi: easyPaceSec,
    tolerancePaceSPerMi: easyPaceSec != null ? 30 : null,
  });
  return phases;
}

function expandLong(
  s: Record<string, unknown>,
  totalMi: number,
  easyPaceSec: number | null,
  tolerance: number,
  workPhaseLabel?: string,
): ExpandedPhase[] {
  // Spec band first (authored truth) · else the easy anchor · else by feel
  // (null target — P1-47, no fabricated pace).
  const specLo = Number(s.pace_target_s_per_mi_lo) || null;
  const specHi = Number(s.pace_target_s_per_mi_hi) || null;
  const lo = specLo ?? (easyPaceSec != null ? easyPaceSec - 30 : null);
  const hi = specHi ?? (easyPaceSec != null ? easyPaceSec + 30 : null);
  const mid = lo != null && hi != null ? Math.round((lo + hi) / 2) : null;
  const easyTol = lo != null && hi != null
    ? Math.max(tolerance, Math.round((hi - lo) / 2))
    : null;

  // 2026-06-07 · Audit D / D1 · race-specific + LT-phase long runs carry a
  // faster finish (last N mi @ HM/M pace). Split into easy-build + finish
  // so the watch executes — and guards — each correctly, instead of one
  // flat phase under a label that promised the finish. Cite: Research/22 §3.
  const finishMi = Number(s.finish_mi) || 0;
  const finishPace = Number(s.finish_pace_s_per_mi) || 0;
  if (finishMi > 0 && finishPace > 0 && finishMi < totalMi) {
    const easyMi = Number((totalMi - finishMi).toFixed(1));
    const finishLabel = String(s.finish_label ?? '').trim();
    const finishPaceLabel = finishLabel === 'M' ? 'marathon pace'
      : finishLabel === 'HM' ? 'half marathon pace'
      : finishLabel === 'T' ? 'tempo pace'
      : finishLabel ? `${finishLabel} pace` : 'race pace';
    const finishTag = `@ ${finishPaceLabel}`;
    return [
      {
        type: 'work',
        label: `${easyMi.toFixed(1)} mi easy`,
        distanceMi: easyMi,
        durationSec: Math.round(easyMi * (mid ?? DURATION_EST_S_PER_MI)),
        targetPaceSPerMi: mid,
        tolerancePaceSPerMi: easyTol,
      },
      {
        type: 'work',
        label: `${finishMi.toFixed(1)} mi ${finishTag}`,
        distanceMi: Number(finishMi.toFixed(1)),
        durationSec: Math.round(finishMi * finishPace),
        targetPaceSPerMi: finishPace,
        // Finish is race-pace quality work · tighter band than the easy
        // build (never looser than 12 s/mi, the tempo tolerance).
        tolerancePaceSPerMi: easyTol != null ? Math.min(easyTol, 12) : 12,
        isFinishSegment: true,
      },
    ];
  }

  return [{
    type: 'work',
    label: workPhaseLabel ?? `${totalMi.toFixed(1)} mi long run`,
    distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * (mid ?? DURATION_EST_S_PER_MI)),
    targetPaceSPerMi: mid,
    tolerancePaceSPerMi: easyTol,
  }];
}

function expandEasy(
  s: Record<string, unknown>,
  totalMi: number,
  easyPaceSec: number | null,
  tolerance: number,
  workPhaseLabel?: string,
): ExpandedPhase[] {
  // Spec band first · else the easy anchor · else by feel (P1-47).
  const specLo = Number(s.pace_target_s_per_mi_lo) || null;
  const specHi = Number(s.pace_target_s_per_mi_hi) || null;
  const lo = specLo ?? (easyPaceSec != null ? easyPaceSec - 30 : null);
  const hi = specHi ?? (easyPaceSec != null ? easyPaceSec + 60 : null);
  const mid = lo != null && hi != null ? Math.round((lo + hi) / 2) : null;
  return [{
    type: 'work',
    label: workPhaseLabel ?? `${totalMi.toFixed(1)} mi easy`,
    distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * (mid ?? DURATION_EST_S_PER_MI)),
    targetPaceSPerMi: mid,
    tolerancePaceSPerMi: lo != null && hi != null
      ? Math.max(tolerance, Math.round((hi - lo) / 2))
      : null,
  }];
}

function expandRecovery(
  s: Record<string, unknown>,
  totalMi: number,
  recoveryPace: number | null,
  tolerance: number,
): ExpandedPhase[] {
  // Spec band first · else the recovery anchor · else by feel (P1-47).
  const specLo = Number(s.pace_target_s_per_mi_lo) || null;
  const specHi = Number(s.pace_target_s_per_mi_hi) || null;
  const lo = specLo ?? recoveryPace;
  const hi = specHi ?? (recoveryPace != null ? recoveryPace + 60 : null);
  const mid = lo != null && hi != null ? Math.round((lo + hi) / 2) : null;
  return [{
    type: 'work',
    label: `${totalMi.toFixed(1)} mi recovery jog`,
    distanceMi: Number(totalMi.toFixed(1)),
    durationSec: Math.round(totalMi * (mid ?? DURATION_EST_S_PER_MI)),
    targetPaceSPerMi: mid,
    tolerancePaceSPerMi: lo != null && hi != null
      ? Math.max(tolerance, Math.round((hi - lo) / 2))
      : null,
  }];
}

// ── helpers ────────────────────────────────────────────────────────────

/**
 * 2026-06-03 · iPhone agent Tier 2.d brief · derive sub_label from
 * workout_spec so the title row and grid can never drift.
 *
 * Produces the same human-readable strings the generator's prescription
 * resolver produces, but sourced from the authored spec instead of a
 * template. Used at generator write time + adapter mutation sites + a
 * one-off backfill for rows where stored sub_label diverged from spec.
 *
 * Returns null for spec=null (rest/cross/strength · no breakdown).
 *
 * Output examples:
 *   tempo  spec wu=2 tempo=4 cd=2  → "2 mi WU · 4 mi @ T · 2 mi CD"
 *   intervals 4×1mi 180s rest     → "4×1 mi @ I · 3 min jog"
 *   threshold 5×1km 60s rest      → "5×1 km @ T pace · 60s jog"
 *   easy / recovery / long / race → "EASY" / "RECOVERY" / "LONG" / "RACE"
 */
export function subLabelFromSpec(spec: WorkoutSpec): string | null {
  if (!spec || typeof spec !== 'object') return null;
  const s = spec as Record<string, unknown>;
  const kind = String(s.kind ?? '');
  switch (kind) {
    case 'tempo': {
      const wu = Number(s.warmup_mi ?? 0);
      const tempo = Number(s.tempo_distance_mi ?? 0);
      const cd = Number(s.cooldown_mi ?? 0);
      if (!wu && !cd) return `${formatMi(tempo)} mi continuous tempo`;
      return `${formatMi(wu)} mi WU · ${formatMi(tempo)} mi @ T · ${formatMi(cd)} mi CD`;
    }
    case 'threshold':
    case 'intervals': {
      const reps = Number(s.rep_count ?? 0) || 0;
      const repMi = Number(s.rep_distance_mi ?? 0) || 0;
      const repM = Number(s.rep_distance_m ?? 0) || 0;
      const effRepMi = repMi > 0 ? repMi : (repM / 1609.34);
      const restS = Number(s.rep_rest_s ?? 0) || 0;
      const repLabel = formatRepLabel(effRepMi);
      const paceTag = kind === 'intervals' ? '@ I' : '@ T pace';
      const restLabel = formatRestLabel(restS);
      return `${reps}×${repLabel} ${paceTag} · ${restLabel}`;
    }
    // 2026-06-07 · Audit D / D1 · long runs with a finish segment now
    // carry it IN the spec (finish_mi/finish_label), so the label can be
    // derived. race rows are also kind:'long' (stash) but carry no
    // finish_mi → fall through to null and keep the "RACE" label.
    case 'long': {
      const finishMi = Number(s.finish_mi) || 0;
      const finishLabel = String(s.finish_label ?? '').trim();
      if (finishMi > 0 && finishLabel) {
        return `LONG · ${formatMi(finishMi)}mi @ ${finishLabel}`;
      }
      return null;  // plain long / race · keep generator-time label
    }
    // 2026-06-03 · easy / recovery / race / shakeout · return null so the
    // caller's existing sub_label sticks. The spec's `kind` doesn't carry
    // the decorations these labels need:
    //   · race  · spec.kind='long' (stash) · would mis-derive as "LONG"
    //   · shakeout · spec.kind='easy' · would mis-derive as "EASY"
    // Only the rep/tempo/long-finish shapes get derived. Everything else
    // keeps generator-time labels.
    default:
      return null;
  }
}

function formatMi(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
}
function formatRestLabel(s: number): string {
  if (s <= 0) return 'jog rest';
  if (s >= 60 && s % 60 === 0) return `${s / 60} min jog`;
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')} jog`;
  }
  return `${s}s jog`;
}

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
