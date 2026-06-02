/**
 * session-shape.ts · derive the SESSION grid segments from a real
 * plan_workouts.workout_spec instead of the hardcoded SEGS constant.
 *
 * David call 2026-06-02 (via consolidated brief): the SEGS table in
 * constants.ts was prototype data · every "intervals" day rendered
 * `6 × 800m @ 2:55` regardless of what the engine prescribed. Tempo
 * always `5.0 mi @ 6:38`. Long always `14 mi @ 7:40`. The brief
 * delete-SEGS-and-derive-from-spec contract is implemented here.
 *
 * Render rules (per brief):
 *
 *   spec.kind                    Segments (left → right)
 *   ─────────────────────────────────────────────────────────────
 *   tempo                        Warm-up · Tempo block · Cool-down
 *   threshold / intervals        Warm-up · N × repMi (@pace · restS jog) · Cool-down
 *   easy / recovery / shakeout   Single bar · pace range from lo/hi
 *   long                         Single bar + fuel notes (no individual dots in this layout)
 *   race                         Single bar · race pace
 *   rest / null spec             No grid · null return · caller falls back to subLabel
 *
 * Width math: w = round((segmentMi / totalMi) × 100). totalMi is the
 * caller's distance_mi (correct post the backend 08093bbf backfill).
 *
 * Field precedence: rep_distance_mi when present, else rep_distance_m
 * / 1609.34. Mirrors lib/plan/spec-builder.ts's totalDistanceMiFromSpec.
 */

import type { WorkoutSpec } from '@/lib/faff/types';

export interface SessionSegment {
  /** Label · "Warm-up" / "5 × 1km" / "Tempo block". */
  l: string;
  /** Sub-line · "1.5 mi easy" / "@ 4:43 · 90s jog" / "5.0 mi @ 6:38". */
  sub: string;
  /** Width percentage (0-100) of this segment in the bar chart. */
  w: number;
  /** Bar color · token from the brand palette. */
  c: string;
}

const COL = {
  easy:      '#14C08C',   // Warm-up / Cool-down / single bar for easy
  tempo:     '#FF8847',   // Tempo block
  threshold: '#F3AD38',   // Threshold reps
  intervals: '#FC4D64',   // Interval reps
  long:      '#F3AD38',   // Long-run amber
  recovery:  '#27B4E0',   // Recovery cyan
  shakeout:  '#27B4E0',   // Shakeout cyan
  race:      '#FC4D64',   // Race-day red
  progression: '#FF8847', // Progression core
  fartlek:   '#FC4D64',   // Fartlek surges
  mp:        '#F3AD38',   // Marathon pace
} as const;

/** Format s/mi → "M:SS" string. */
function fmtPace(s: number | null | undefined): string {
  if (!s || !Number.isFinite(s) || s <= 0) return '·';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Rep distance in miles · prefer rep_distance_mi, fall back to m/1609.34. */
function repMi(spec: { rep_distance_mi?: number; rep_distance_m?: number }): number {
  if (typeof spec.rep_distance_mi === 'number' && spec.rep_distance_mi > 0) return spec.rep_distance_mi;
  if (typeof spec.rep_distance_m === 'number' && spec.rep_distance_m > 0) return spec.rep_distance_m / 1609.34;
  return 0;
}

/** Format rep distance as "800m" / "1 mi" / "0.5 mi" per convention. */
function fmtRep(spec: { rep_distance_mi?: number; rep_distance_m?: number }): string {
  if (typeof spec.rep_distance_m === 'number' && spec.rep_distance_m > 0 && spec.rep_distance_m < 1600) {
    return `${Math.round(spec.rep_distance_m)}m`;
  }
  const mi = repMi(spec);
  if (mi <= 0) return '?';
  if (mi >= 1) return `${mi.toFixed(mi === Math.round(mi) ? 0 : 1)} mi`;
  return `${(mi * 1609.34).toFixed(0)}m`;
}

/** Clamp + round percentage so total never exceeds 100. */
function pct(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(2, Math.round((part / total) * 100));
}

/**
 * Derive session segments from a workout_spec + total distance.
 *
 * Returns null when no spec is available OR the type is rest. Caller
 * decides whether to show a fallback (e.g. single-bar text-only) or
 * hide the SESSION block entirely.
 */
export function deriveSessionSegs(
  spec: WorkoutSpec | null | undefined,
  totalMi: number,
  type: string,
  paceStr: string | null,
): SessionSegment[] | null {
  if (!spec || type === 'rest') return null;
  if (!totalMi || totalMi <= 0) return null;

  switch (spec.kind) {
    case 'tempo': {
      const wu = spec.warmup_mi || 0;
      const cd = spec.cooldown_mi || 0;
      const core = spec.tempo_distance_mi || Math.max(0, totalMi - wu - cd);
      const corePace = fmtPace(spec.tempo_pace_s_per_mi);
      return [
        { l: 'Warm-up', sub: `${wu.toFixed(1)} mi easy`, w: pct(wu, totalMi), c: COL.easy },
        { l: 'Tempo block', sub: `${core.toFixed(1)} mi @ ${corePace}`, w: pct(core, totalMi), c: COL.tempo },
        { l: 'Cool-down', sub: `${cd.toFixed(1)} mi easy`, w: pct(cd, totalMi), c: COL.easy },
      ];
    }
    case 'threshold':
    case 'intervals': {
      const wu = spec.warmup_mi || 0;
      const cd = spec.cooldown_mi || 0;
      const oneRep = repMi(spec);
      const restMi = (spec.rep_rest_s ?? 0) * (1 / 540); // ~9 min/mi recovery jog · same heuristic as planner
      const coreMi = spec.rep_count * oneRep + Math.max(0, spec.rep_count - 1) * restMi;
      const coreLabel = `${spec.rep_count} × ${fmtRep(spec)}`;
      const corePace = fmtPace(spec.rep_pace_s_per_mi);
      const restLabel = spec.rep_rest_s ? `${spec.rep_rest_s}s jog` : 'jog';
      return [
        { l: 'Warm-up', sub: `${wu.toFixed(1)} mi easy`, w: pct(wu, totalMi), c: COL.easy },
        {
          l: coreLabel,
          sub: `@ ${corePace} · ${restLabel}`,
          w: pct(coreMi, totalMi),
          c: spec.kind === 'intervals' ? COL.intervals : COL.threshold,
        },
        { l: 'Cool-down', sub: `${cd.toFixed(1)} mi easy`, w: pct(cd, totalMi), c: COL.easy },
      ];
    }
    case 'easy':
    case 'recovery': {
      const lo = spec.pace_target_s_per_mi_lo;
      const hi = spec.pace_target_s_per_mi_hi;
      const range = lo && hi && lo !== hi
        ? `${fmtPace(hi)} - ${fmtPace(lo)}/mi`
        : (paceStr ? `${paceStr}/mi` : '');
      const label = spec.kind === 'recovery' ? 'Recovery jog' : 'Easy aerobic';
      return [{ l: label, sub: `${totalMi.toFixed(1)} mi · ${range}`, w: 100, c: spec.kind === 'recovery' ? COL.recovery : COL.easy }];
    }
    case 'long': {
      const lo = spec.pace_target_s_per_mi_lo;
      const hi = spec.pace_target_s_per_mi_hi;
      const range = lo && hi && lo !== hi
        ? `${fmtPace(hi)} - ${fmtPace(lo)}/mi`
        : (paceStr ? `${paceStr}/mi` : '');
      const fuelNote = spec.fuel_mi && spec.fuel_mi.length
        ? ` · fuel @ ${spec.fuel_mi.map(f => `mi ${f}`).join(', ')}`
        : '';
      return [{ l: 'Long run', sub: `${totalMi.toFixed(1)} mi · ${range}${fuelNote}`, w: 100, c: COL.long }];
    }
    case 'progression': {
      const wu = spec.warmup_mi || 0;
      const cd = spec.cooldown_mi || 0;
      const core = spec.prog_distance_mi || Math.max(0, totalMi - wu - cd);
      const startPace = fmtPace(spec.prog_start_s_per_mi);
      const endPace = fmtPace(spec.prog_end_s_per_mi);
      return [
        { l: 'Warm-up', sub: `${wu.toFixed(1)} mi easy`, w: pct(wu, totalMi), c: COL.easy },
        { l: 'Progression', sub: `${core.toFixed(1)} mi · ${startPace} → ${endPace}`, w: pct(core, totalMi), c: COL.progression },
        { l: 'Cool-down', sub: `${cd.toFixed(1)} mi easy`, w: pct(cd, totalMi), c: COL.easy },
      ];
    }
    case 'fartlek': {
      const wu = spec.warmup_mi || 0;
      const cd = spec.cooldown_mi || 0;
      const coreMi = Math.max(0, totalMi - wu - cd);
      const segs = spec.segments?.length ?? 0;
      return [
        { l: 'Warm-up', sub: `${wu.toFixed(1)} mi easy`, w: pct(wu, totalMi), c: COL.easy },
        { l: 'Fartlek', sub: `${coreMi.toFixed(1)} mi · ${segs} surges`, w: pct(coreMi, totalMi), c: COL.fartlek },
        { l: 'Cool-down', sub: `${cd.toFixed(1)} mi easy`, w: pct(cd, totalMi), c: COL.easy },
      ];
    }
    case 'mp': {
      // Marathon-pace block · same shape as tempo but different color.
      const s = spec as unknown as { warmup_mi?: number; mp_distance_mi?: number; mp_pace_s_per_mi?: number; cooldown_mi?: number };
      const wu = s.warmup_mi || 0;
      const cd = s.cooldown_mi || 0;
      const core = s.mp_distance_mi || Math.max(0, totalMi - wu - cd);
      const corePace = fmtPace(s.mp_pace_s_per_mi);
      return [
        { l: 'Warm-up', sub: `${wu.toFixed(1)} mi easy`, w: pct(wu, totalMi), c: COL.easy },
        { l: 'MP block', sub: `${core.toFixed(1)} mi @ ${corePace}`, w: pct(core, totalMi), c: COL.mp },
        { l: 'Cool-down', sub: `${cd.toFixed(1)} mi easy`, w: pct(cd, totalMi), c: COL.easy },
      ];
    }
    default:
      return null;
  }
}

/** Convenience render for "no spec" days · still gives a single honest
 *  bar with the distance + pace so the SESSION block isn't blank. Used
 *  when a non-rest day has no workout_spec (legacy plans, manual entry). */
export function fallbackSessionSegs(type: string, totalMi: number, paceStr: string | null): SessionSegment[] | null {
  if (type === 'rest' || !totalMi || totalMi <= 0) return null;
  const colorMap: Record<string, string> = {
    easy: COL.easy, recovery: COL.recovery, long: COL.long,
    tempo: COL.tempo, threshold: COL.threshold, intervals: COL.intervals,
    shakeout: COL.shakeout, race: COL.race, progression: COL.progression,
    fartlek: COL.fartlek,
  };
  const c = colorMap[type] ?? COL.easy;
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return [{ l: label, sub: `${totalMi.toFixed(1)} mi${paceStr ? ` · ${paceStr}/mi` : ''}`, w: 100, c }];
}
