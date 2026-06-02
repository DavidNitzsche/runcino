/**
 * lib/plan/spec-builder.ts · single source of truth for workout_spec +
 * pace_target_s_per_mi derivation from runner VDOT + LTHR.
 *
 * Extracted from app/api/admin/backfill-workout-spec/route.ts so the
 * generator + backfill cron + adapter all derive the same way.
 *
 * Inputs: workout type + distance + T-pace (from VDOT) + LTHR (optional).
 * Optional: prescription string (e.g. "6×800m @ I pace · 90s jog") ·
 *           when present, threshold + intervals branches read rep
 *           count / rep distance / rest seconds from the parsed
 *           prescription instead of hardcoded defaults. Fixes the
 *           sub_label vs workout_spec mismatch flagged 2026-06-02.
 *
 * Outputs: workout_spec jsonb + a primary pace_target_s_per_mi scalar
 * for the column (the "headline" pace for the type · used by chip render).
 *
 * Doctrine:
 *   · Daniels' Running Formula · T/I/M/E pace offsets
 *   · Research/01 §pace-zones
 *   · Friel zones for HR caps (Z2 ≤ 80% LTHR for easy · ≤ 85% for long)
 */

import { parsePrescription } from './prescription-parser';

export type WorkoutSpec = Record<string, unknown> | null;

export interface SpecBuildResult {
  /** workout_spec column value · null for types where it's intentionally absent. */
  spec: WorkoutSpec;
  /** Primary pace target in seconds per mile for the pace_target_s_per_mi
   *  column · null for easy/recovery/rest (no specific target). */
  paceTargetSPerMi: number | null;
}

// ── HR helpers ──────────────────────────────────────────────────────────

function hrCapEasy(lthr: number | null): number | null {
  return lthr ? Math.round(lthr * 0.80) : null;
}
function hrCapLong(lthr: number | null): number | null {
  return lthr ? Math.round(lthr * 0.85) : null;
}
function hrLthrBpm(lthr: number | null): number | null {
  return lthr ?? null;
}

// ── Fuel timing ──────────────────────────────────────────────────────────

function fuelMi(dist: number | null): number[] {
  if (!dist || dist < 8) return [];
  const out: number[] = [];
  // First fuel at mi 5, then every 4 mi
  for (let m = 5; m < dist; m += 4) out.push(m);
  return out;
}

/**
 * Build a workout_spec + pace_target for a single workout row.
 *
 * Returns `{ spec: null, paceTargetSPerMi: null }` for types whose spec
 * is intentionally absent (rest / cross / strength). For easy / recovery,
 * spec is populated but paceTargetSPerMi stays null (no single headline
 * pace · the spec carries a lo/hi range).
 */
export function buildWorkoutSpec(
  type: string,
  distance_mi: number | null,
  tPaceSec: number,
  lthr: number | null,
  prescription?: string | null,
): SpecBuildResult {
  // 2026-06-02 · parse the prescription up front (e.g. "6×800m @ I
  // pace · 90s jog" → {reps:6, repDistanceMi:0.497, restS:90}). When
  // parseable, threshold + intervals branches use these instead of
  // the hardcoded defaults so the spec matches the prescription text.
  // Null when prescription is absent or doesn't carry a rep pattern
  // (e.g. "continuous tempo") · branches fall back to historical
  // defaults.
  const parsed = parsePrescription(prescription);
  const easyLo = tPaceSec + 60, easyHi = tPaceSec + 110;
  const longLo = tPaceSec + 55, longHi = tPaceSec + 90;
  const tempo  = tPaceSec + 12;         // mid of T+5 to T+18
  const interval = tPaceSec - 18;       // ~10K pace
  const recovery = tPaceSec + 100;      // very easy
  const mp = tPaceSec + 18;             // marathon pace

  switch (type) {
    case 'easy':
      return {
        spec: {
          kind: 'easy',
          pace_target_s_per_mi_lo: easyLo,
          pace_target_s_per_mi_hi: easyHi,
          hr_cap_bpm: hrCapEasy(lthr),
          fuel_mi: [],
        },
        // Easy days don't have a single "headline" pace · the chip
        // shows a lo-hi range from the spec, not pace_target_s_per_mi.
        paceTargetSPerMi: null,
      };
    case 'recovery':
      return {
        spec: {
          kind: 'recovery',
          pace_target_s_per_mi_lo: recovery,
          pace_target_s_per_mi_hi: recovery + 30,
          hr_cap_bpm: hrCapEasy(lthr),
        },
        paceTargetSPerMi: null,
      };
    case 'long': {
      // Long runs in race-specific phase carry an MP segment ·
      // pace_target reflects that mid-effort prescription.
      return {
        spec: {
          kind: 'long',
          pace_target_s_per_mi_lo: longLo,
          pace_target_s_per_mi_hi: longHi,
          hr_cap_bpm: hrCapLong(lthr),
          fuel_mi: fuelMi(distance_mi),
        },
        // Long-run "headline" pace is the easy long pace · take the
        // middle of the range.
        paceTargetSPerMi: Math.round((longLo + longHi) / 2),
      };
    }
    case 'tempo': {
      const tempoDist = Math.max(2, Math.min(7, (distance_mi ?? 8) - 3));
      const wu = ((distance_mi ?? 8) - tempoDist) / 2;
      return {
        spec: {
          kind: 'tempo',
          warmup_mi: Number(wu.toFixed(1)),
          tempo_distance_mi: Number(tempoDist.toFixed(1)),
          tempo_pace_s_per_mi: tempo,
          cooldown_mi: Number(wu.toFixed(1)),
          hr_target_bpm: lthr ? Math.round(lthr * 0.92) : null,
        },
        paceTargetSPerMi: tempo,
      };
    }
    case 'threshold': {
      // 2026-06-02 · prefer parsed prescription · falls back to
      // historical defaults when the rx string is absent / unparseable.
      const repCount = parsed?.reps ?? 4;
      const repMi = parsed?.repDistanceMi ?? 1.0;
      const restS = parsed?.restS ?? 60;
      const wu = ((distance_mi ?? 7) - repCount * repMi - 1) / 2;
      return {
        spec: {
          kind: 'threshold',
          warmup_mi: Number(Math.max(1.5, wu).toFixed(1)),
          rep_count: repCount,
          rep_distance_mi: repMi,
          rep_pace_s_per_mi: tPaceSec,
          rep_rest_s: restS,
          cooldown_mi: Number(Math.max(1.0, wu).toFixed(1)),
          lthr_bpm: hrLthrBpm(lthr),
        },
        paceTargetSPerMi: tPaceSec,
      };
    }
    case 'intervals':
    case 'vo2max': {
      // 2026-06-02 · prefer parsed prescription · falls back to
      // historical defaults when the rx string is absent / unparseable.
      const repCount = parsed?.reps ?? 5;
      const repMi = parsed?.repDistanceMi ?? 0.62;
      const restS = parsed?.restS ?? 90;
      const wu = ((distance_mi ?? 7) - repCount * repMi - 1) / 2;
      return {
        spec: {
          kind: 'intervals',
          warmup_mi: Number(Math.max(1.5, wu).toFixed(1)),
          rep_count: repCount,
          rep_distance_mi: repMi,
          rep_pace_s_per_mi: interval,
          rep_rest_s: restS,
          cooldown_mi: Number(Math.max(1.0, wu).toFixed(1)),
          lthr_bpm: hrLthrBpm(lthr),
        },
        paceTargetSPerMi: interval,
      };
    }
    case 'race':
      return {
        spec: {
          kind: 'long',  // no 'race' kind in WorkoutSpec union · stash as long
          pace_target_s_per_mi_lo: tPaceSec - 10,
          pace_target_s_per_mi_hi: tPaceSec + 5,
          hr_cap_bpm: lthr ? Math.round(lthr * 0.95) : null,
          fuel_mi: fuelMi(distance_mi),
        },
        paceTargetSPerMi: tPaceSec,  // race pace ≈ T-pace for HM, slightly slower for M
      };
    case 'shakeout':
      return {
        spec: {
          kind: 'easy',
          pace_target_s_per_mi_lo: easyHi,
          pace_target_s_per_mi_hi: easyHi + 30,
          hr_cap_bpm: hrCapEasy(lthr),
          fuel_mi: [],
        },
        paceTargetSPerMi: null,
      };
    case 'race_week_tuneup':
      return {
        spec: {
          kind: 'threshold',
          warmup_mi: 1.5,
          rep_count: 2,
          rep_distance_mi: 0.5,
          rep_pace_s_per_mi: tPaceSec - 5,  // slightly faster than T · primes the system
          rep_rest_s: 60,
          cooldown_mi: 1.0,
          lthr_bpm: hrLthrBpm(lthr),
        },
        paceTargetSPerMi: tPaceSec - 5,
      };
    case 'rest':
    case 'cross':
    case 'strength':
      return { spec: null, paceTargetSPerMi: null };
    default:
      return { spec: null, paceTargetSPerMi: null };
  }
}

/**
 * 2026-06-02 · derive the TOTAL miles a workout actually covers from
 * its spec · used to populate plan_workouts.distance_mi so the chip
 * the runner reads matches the title.
 *
 * Was: distance_mi stored only the CORE workout (e.g. "4×1 mi @ T" →
 * 4.0 mi), but the title also listed WU + CD. Runner saw "2 mi WU ·
 * 4 mi @ T · 2 mi CD · 4.0 mi" which doesn't math (8 mi of running,
 * card said 4 mi). David called this out 2026-06-02.
 *
 * Now: distance_mi = WU + core + floats + CD. Matches what the watch
 * will record + the runner's actual mileage.
 *
 * Float distance · for threshold/intervals the rest is a jog (not
 * standing still) so it counts toward total. Approximated at a 9:00/mi
 * jog pace (540 s/mi) · float_mi = (rep_rest_s × (reps-1)) / 540.
 * The actual float pace varies by runner but the approximation is
 * within 5-10% of reality and beats the old "core-only" lie.
 *
 * Returns the fallback when:
 *   · spec is null (rest / cross / strength / unrecognized type)
 *   · spec.kind is a single-segment shape (easy / long / recovery /
 *     shakeout / race) · those carry their full distance already
 */
export function totalDistanceMiFromSpec(
  spec: WorkoutSpec,
  fallbackDistanceMi: number,
): number {
  if (!spec || typeof spec !== 'object') return fallbackDistanceMi;
  const s = spec as Record<string, unknown>;
  const kind = String(s.kind ?? '');
  const wu = Number(s.warmup_mi ?? 0) || 0;
  const cd = Number(s.cooldown_mi ?? 0) || 0;
  switch (kind) {
    case 'tempo': {
      const core = Number(s.tempo_distance_mi ?? 0) || 0;
      return Number((wu + core + cd).toFixed(1));
    }
    case 'threshold':
    case 'intervals': {
      const reps = Number(s.rep_count ?? 0) || 0;
      // 2026-06-02 · schema has two historical key variants:
      //   · rep_distance_mi (newer, miles · what spec-builder emits today)
      //   · rep_distance_m  (older, metres · legacy plan rows)
      // Prefer miles when present; fall back to metres / 1609.34.
      const repMi = Number(s.rep_distance_mi ?? 0) || 0;
      const repM = Number(s.rep_distance_m ?? 0) || 0;
      const effRepMi = repMi > 0 ? repMi : repM / 1609.34;
      const restS = Number(s.rep_rest_s ?? 0) || 0;
      const repTotal = reps * effRepMi;
      const floatTotal = Math.max(0, reps - 1) * (restS / 540);
      return Number((wu + repTotal + floatTotal + cd).toFixed(1));
    }
    case 'long':
    case 'easy':
    case 'recovery':
      // Single-segment workouts · distance_mi as-passed IS the total.
      return fallbackDistanceMi;
    default:
      return fallbackDistanceMi;
  }
}

/**
 * Derive T-pace (s/mi) from the runner's goal race + distance.
 * Same formula as lib/training/prescriptions.ts § tPaceSecPerMi.
 *
 * Returns null when the runner has no goal · callers should fall back
 * to a default (e.g. 480s/mi = 8:00/mi) and leave specs null until
 * goal lands.
 */
export function tPaceFromGoal(
  goalSeconds: number | null | undefined,
  goalDistanceMi: number | null | undefined,
): number | null {
  if (!goalSeconds || !goalDistanceMi) return null;
  const goalSPerMi = Math.round(goalSeconds / goalDistanceMi);
  if (goalDistanceMi >= 25) return goalSPerMi - 18;   // marathon
  if (goalDistanceMi >= 12) return goalSPerMi - 5;    // half
  if (goalDistanceMi >= 5)  return goalSPerMi + 8;    // 10K
  return goalSPerMi + 15;                              // 5K
}
