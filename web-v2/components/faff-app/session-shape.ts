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

/** 2026-06-02 · richer per-segment shape for the SESSION blueprint
 *  (the SVG Z1-Z5 lane chart). Carries effort zone + mile bounds so
 *  the renderer can place each block on the distance axis at the
 *  correct height. */
export interface BlueprintSegment {
  /** Start mile · cumulative distance from the run start. */
  from: number;
  /** End mile · cumulative distance from the run start. */
  to: number;
  /** Effort zone 1-5 · drives block height + color. */
  zone: 1 | 2 | 3 | 4 | 5;
  /** Display label · "Warm-up" / "6 × 800m" / "MP finish". */
  label: string;
  /** Target pace · "8:45" or null when paceless (e.g. some warm-ups). */
  pace: string | null;
  /** Z-label · "Z2" / "Z4" / "Z5". */
  zn: string;
  /** Color token. */
  color: string;
  /** Reps count when this is an interval/threshold work block · the
   *  renderer draws a comb of N work bars + N-1 float-recovery bars. */
  reps?: number;
  /** Float-recovery distance per gap (mi) · used inside the comb to
   *  size the low-zone bars between reps. */
  restMi?: number;
  /** Per-rep distance label · "800m" / "1 mi". */
  repDistanceLabel?: string;
  /** Per-rep pace pretty · "@ 2:55 · 400m float". */
  repPaceLabel?: string;
}

export interface BlueprintData {
  segs: BlueprintSegment[];
  /** Total distance (mi) · used to scale the x-axis. */
  totalMi: number;
  /** Fuel pin positions (mi) · drop icons drawn above the chart with a
   *  dashed line down to the axis. Empty when the run has no fueling. */
  fuelMi: number[];
  /** Effort label for the totals strip · "Z2" / "Z2→Z4" / "Z5". */
  effortLabel: string;
}

const COL = {
  easy:      '#14C08C',   // Warm-up / Cool-down / single bar for easy
  tempo:     '#FF5722',   // Tempo block
  threshold: '#F3AD38',   // Threshold reps
  intervals: '#FC4D64',   // Interval reps
  long:      '#F3AD38',   // Long-run amber
  recovery:  '#27B4E0',   // Recovery cyan
  shakeout:  '#27B4E0',   // Shakeout cyan
  race:      '#FC4D64',   // Race-day red
  progression: '#FF5722', // Progression core
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

/* ============================================================
   Blueprint shape · 2026-06-02 SESSION card redesign.
   Same source data, richer output for the SVG Z1-Z5 lane chart.
   See designs/from Design agent/session-card/README.md.
   ============================================================ */

/** Z1-Z5 colour ramp · matches the design's ZC array. */
const ZONE_COLOR: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '#27B4E0', 2: '#14C08C', 3: '#F3AD38', 4: '#FF5722', 5: '#F43F5E',
};

/** Default zone per spec kind · used by the blueprint to place each
 *  segment on the Z1-Z5 axis. Doctrine map (Daniels / Friel):
 *    easy = Z2   ·  recovery = Z1   ·  long = Z2
 *    tempo = Z4  ·  threshold = Z4  ·  intervals/vo2max = Z5
 *    progression mid = Z3 (core) · fartlek surges = Z4
 *    mp (marathon pace) = Z3      ·  warmup/cooldown = Z2 */
function zoneFor(specKind: string, role: 'core' | 'warmup' | 'cooldown' | 'rest'): 1 | 2 | 3 | 4 | 5 {
  if (role === 'rest') return 1;
  if (role === 'warmup' || role === 'cooldown') return 2;
  switch (specKind) {
    case 'easy': return 2;
    case 'recovery': return 1;
    case 'long': return 2;
    case 'tempo': return 4;
    case 'threshold': return 4;
    case 'intervals': return 5;
    case 'vo2max': return 5;
    case 'progression': return 3;
    case 'fartlek': return 4;
    case 'mp': return 3;
    case 'race': return 4;
    default: return 2;
  }
}

function zLabel(z: number): string { return `Z${z}`; }

function repMiB(spec: { rep_distance_mi?: number; rep_distance_m?: number }): number {
  if (typeof spec.rep_distance_mi === 'number' && spec.rep_distance_mi > 0) return spec.rep_distance_mi;
  if (typeof spec.rep_distance_m === 'number' && spec.rep_distance_m > 0) return spec.rep_distance_m / 1609.34;
  return 0;
}

function fmtRepB(spec: { rep_distance_mi?: number; rep_distance_m?: number }): string {
  if (typeof spec.rep_distance_m === 'number' && spec.rep_distance_m > 0 && spec.rep_distance_m < 1600) {
    return `${Math.round(spec.rep_distance_m)} m`;
  }
  const mi = repMiB(spec);
  if (mi <= 0) return '?';
  if (mi >= 1) return `${mi.toFixed(mi === Math.round(mi) ? 0 : 1)} mi`;
  return `${(mi * 1609.34).toFixed(0)} m`;
}

function fmtPaceB(s: number | null | undefined): string {
  if (!s || !Number.isFinite(s) || s <= 0) return '·';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Build blueprint data · effort-zone-aware segments + fuel pins + a
 * combined effort label for the totals strip. Renderer (SessionBlueprint
 * in TodayView) consumes this; no callers reach into the SVG math.
 */
export function deriveBlueprintData(
  spec: WorkoutSpec | null | undefined,
  totalMi: number,
  type: string,
  paceStr: string | null,
): BlueprintData | null {
  if (!totalMi || totalMi <= 0 || type === 'rest') return null;
  const segs: BlueprintSegment[] = [];

  if (!spec) {
    // No spec · render single full-width block at the type's default zone.
    const z = zoneFor(type, 'core');
    segs.push({
      from: 0, to: totalMi, zone: z, label: type.charAt(0).toUpperCase() + type.slice(1),
      pace: paceStr, zn: zLabel(z), color: ZONE_COLOR[z],
    });
    return { segs, totalMi, fuelMi: [], effortLabel: zLabel(z) };
  }

  switch (spec.kind) {
    case 'tempo': {
      const wu = spec.warmup_mi || 0;
      const cd = spec.cooldown_mi || 0;
      const core = spec.tempo_distance_mi || Math.max(0, totalMi - wu - cd);
      if (wu > 0) segs.push({ from: 0, to: wu, zone: 2, label: 'Warm-up', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      segs.push({ from: wu, to: wu + core, zone: 4, label: 'Tempo block', pace: fmtPaceB(spec.tempo_pace_s_per_mi), zn: 'Z4', color: ZONE_COLOR[4] });
      if (cd > 0) segs.push({ from: wu + core, to: wu + core + cd, zone: 2, label: 'Cool-down', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      return { segs, totalMi, fuelMi: [], effortLabel: 'Z2→Z4' };
    }
    case 'threshold':
    case 'intervals': {
      const wu = spec.warmup_mi || 0;
      const cd = spec.cooldown_mi || 0;
      const oneRep = repMiB(spec);
      const restMi = (spec.rep_rest_s ?? 0) * (1 / 540); // ~9 min/mi recovery jog
      const coreMi = spec.rep_count * oneRep + Math.max(0, spec.rep_count - 1) * restMi;
      const coreZ = spec.kind === 'intervals' ? 5 : 4;
      if (wu > 0) segs.push({ from: 0, to: wu, zone: 2, label: 'Warm-up', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      segs.push({
        from: wu, to: wu + coreMi, zone: coreZ,
        label: `${spec.rep_count} × ${fmtRepB(spec)}`,
        pace: fmtPaceB(spec.rep_pace_s_per_mi),
        zn: zLabel(coreZ), color: ZONE_COLOR[coreZ],
        reps: spec.rep_count,
        restMi,
        repDistanceLabel: fmtRepB(spec),
        repPaceLabel: `@ ${fmtPaceB(spec.rep_pace_s_per_mi)} · ${spec.rep_rest_s ?? 0}s jog`,
      });
      if (cd > 0) segs.push({ from: wu + coreMi, to: wu + coreMi + cd, zone: 2, label: 'Cool-down', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      return { segs, totalMi, fuelMi: [], effortLabel: `Z2→${zLabel(coreZ)}` };
    }
    case 'easy':
    case 'recovery': {
      const z = spec.kind === 'recovery' ? 1 : 2;
      const label = spec.kind === 'recovery' ? 'Recovery jog' : 'Easy aerobic';
      segs.push({ from: 0, to: totalMi, zone: z, label, pace: paceStr, zn: zLabel(z), color: ZONE_COLOR[z] });
      return { segs, totalMi, fuelMi: [], effortLabel: zLabel(z) };
    }
    case 'long': {
      segs.push({ from: 0, to: totalMi, zone: 2, label: 'Long run', pace: paceStr, zn: 'Z2', color: ZONE_COLOR[2] });
      const fuelMi = Array.isArray(spec.fuel_mi) ? spec.fuel_mi.filter(n => Number.isFinite(n) && n > 0 && n < totalMi) : [];
      return { segs, totalMi, fuelMi, effortLabel: 'Z2' };
    }
    case 'progression': {
      const wu = spec.warmup_mi || 0;
      const cd = spec.cooldown_mi || 0;
      const core = spec.prog_distance_mi || Math.max(0, totalMi - wu - cd);
      const startPace = fmtPaceB(spec.prog_start_s_per_mi);
      const endPace = fmtPaceB(spec.prog_end_s_per_mi);
      if (wu > 0) segs.push({ from: 0, to: wu, zone: 2, label: 'Warm-up', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      segs.push({ from: wu, to: wu + core, zone: 3, label: 'Progression', pace: `${startPace} → ${endPace}`, zn: 'Z3', color: ZONE_COLOR[3] });
      if (cd > 0) segs.push({ from: wu + core, to: wu + core + cd, zone: 2, label: 'Cool-down', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      return { segs, totalMi, fuelMi: [], effortLabel: 'Z2→Z3' };
    }
    case 'fartlek': {
      const wu = spec.warmup_mi || 0;
      const cd = spec.cooldown_mi || 0;
      const coreMi = Math.max(0, totalMi - wu - cd);
      const surgeCount = spec.segments?.length ?? 0;
      if (wu > 0) segs.push({ from: 0, to: wu, zone: 2, label: 'Warm-up', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      segs.push({ from: wu, to: wu + coreMi, zone: 4, label: `Fartlek · ${surgeCount} surges`, pace: null, zn: 'Z4', color: ZONE_COLOR[4] });
      if (cd > 0) segs.push({ from: wu + coreMi, to: wu + coreMi + cd, zone: 2, label: 'Cool-down', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      return { segs, totalMi, fuelMi: [], effortLabel: 'Z2→Z4' };
    }
    case 'mp': {
      const s = spec as unknown as { warmup_mi?: number; mp_distance_mi?: number; mp_pace_s_per_mi?: number; cooldown_mi?: number };
      const wu = s.warmup_mi || 0;
      const cd = s.cooldown_mi || 0;
      const core = s.mp_distance_mi || Math.max(0, totalMi - wu - cd);
      if (wu > 0) segs.push({ from: 0, to: wu, zone: 2, label: 'Warm-up', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      segs.push({ from: wu, to: wu + core, zone: 3, label: 'MP block', pace: fmtPaceB(s.mp_pace_s_per_mi), zn: 'Z3', color: ZONE_COLOR[3] });
      if (cd > 0) segs.push({ from: wu + core, to: wu + core + cd, zone: 2, label: 'Cool-down', pace: null, zn: 'Z2', color: ZONE_COLOR[2] });
      return { segs, totalMi, fuelMi: [], effortLabel: 'Z2→Z3' };
    }
    default: {
      const z = zoneFor(type, 'core');
      segs.push({ from: 0, to: totalMi, zone: z, label: type.charAt(0).toUpperCase() + type.slice(1), pace: paceStr, zn: zLabel(z), color: ZONE_COLOR[z] });
      return { segs, totalMi, fuelMi: [], effortLabel: zLabel(z) };
    }
  }
}
