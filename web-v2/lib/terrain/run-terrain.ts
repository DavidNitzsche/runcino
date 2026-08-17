/**
 * lib/terrain/run-terrain.ts · read a stored run row's terrain honestly, then
 * hand it to `lib/terrain/grade-adjust.ts`.
 *
 * `grade-adjust.ts` is pure arithmetic and knows nothing about the database.
 * This file is the part that knows what `runs.data` actually contains, which
 * turns out to be four different elevation conventions and one surface that
 * has no elevation at all.
 *
 * ── WHAT THE ROWS ACTUALLY CARRY (audited 2026-08-17 against prod) ─────────
 *
 *   `source`          'watch' | 'apple_watch' | 'apple_health' | 'strava' |
 *                     'treadmill' | absent
 *   `indoor`          boolean. In prod it is true on exactly the rows whose
 *                     source is 'treadmill' and false on every outdoor row,
 *                     so either signal identifies the surface; we accept both
 *                     because only one of them is guaranteed present.
 *   `elevGainFt`      total climb. Present on essentially every row.
 *   `elevGainSource`  'raw' | 'recomputed' | 'gps_derived' | 'watch' |
 *                     'treadmill_incline' | absent. Provenance stamp from
 *                     `lib/runs/elev-sanity.ts` and friends.
 *   `phases[]`        treadmill + watch rows. Carries `actualInclinePct`,
 *                     `actualDistanceMi` — the belt angle, per phase.
 *   `splits[]`        per-mile. The elevation delta hides under any of
 *                     `elev_ft`, `elevation_difference`, `elev_change_ft`,
 *                     `elevDeltaFt` depending on which importer wrote it.
 *
 * There is NO elevation-loss field anywhere. That absence is the whole reason
 * `resolveRunTerrain` prefers per-split deltas: summing the negatives is the
 * only way this data model can tell a net-downhill run from a rolling one.
 *
 * ── THE TREADMILL TRAP ────────────────────────────────────────────────────
 *
 * Treadmill rows DO carry `elevGainFt` — 476 ft on a 9-mile run — with
 * `elevGainSource: 'treadmill_incline'`. That number is not fictional; it is
 * back-computed from the belt angle the runner entered (9.01 mi × 5280 × 1% =
 * 476 ft, exactly). But it is not terrain either, and reading it through the
 * outdoor model does two wrong things at once: it invents 476 feet of hill
 * that never existed, and it credits a 1% belt as a 1% climb when doctrine
 * says 1% belt IS flat ground (`Research/01` §"The 1% incline rule"). So a
 * treadmill run's elevation field is deliberately ignored here and the belt
 * angle is read from `phases[]` instead — the source that number came from,
 * consumed once rather than twice.
 */
import { sanitizeElevGain } from '@/lib/runs/elev-sanity';
import {
  runGradeAdjustment,
  type RunGradeAdjustment,
  type TerrainBasis,
} from './grade-adjust';

/** The subset of `runs.data` this module reads. Everything optional. */
export interface RunTerrainRow {
  source?: string | null;
  indoor?: boolean | null;
  distanceMi?: number | string | null;
  durationSec?: number | string | null;
  movingTimeS?: number | string | null;
  movingSec?: number | string | null;
  elapsedTimeS?: number | string | null;
  paceSPerMi?: number | string | null;
  elevGainFt?: number | string | null;
  elevGainSource?: string | null;
  startLatLng?: unknown;
  endLatLng?: unknown;
  splits?: unknown;
  phases?: unknown;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** True when this row is an indoor / treadmill effort rather than terrain. */
export function isTreadmillRow(row: RunTerrainRow): boolean {
  return row.indoor === true || String(row.source ?? '').toLowerCase() === 'treadmill';
}

/**
 * Per-mile elevation delta, accepting all four field names in the wild.
 * `lib/runs/elev-sanity.ts` documents why three of them exist; `elevDeltaFt`
 * is the fourth, written by older Strava-shaped rows.
 *
 * Returns null (not 0) when the split carries no elevation at all, so that
 * "flat mile" and "mile with no elevation data" stay distinguishable.
 */
function splitElevDeltaFt(s: unknown): number | null {
  if (!s || typeof s !== 'object') return null;
  const r = s as Record<string, unknown>;
  for (const k of ['elev_change_ft', 'elevation_difference', 'elev_ft', 'elevDeltaFt']) {
    const v = num(r[k]);
    if (v != null) return v;
  }
  return null;
}

/** Gain and loss summed from per-mile deltas, or null when no split has one. */
function gainLossFromSplits(splits: unknown): { gainFt: number; lossFt: number; miles: number } | null {
  if (!Array.isArray(splits) || splits.length === 0) return null;
  let gain = 0;
  let loss = 0;
  let miles = 0;
  for (const s of splits) {
    const d = splitElevDeltaFt(s);
    if (d == null) continue;
    miles += 1;
    if (d > 0) gain += d;
    else loss += -d;
  }
  return miles > 0 ? { gainFt: gain, lossFt: loss, miles } : null;
}

/** Same lat/lng within ~0.002° (≈200 m) at start and finish. */
function isClosedLoop(row: RunTerrainRow): boolean | null {
  const a = row.startLatLng;
  const b = row.endLatLng;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return null;
  const [a0, a1] = [num(a[0]), num(a[1])];
  const [b0, b1] = [num(b[0]), num(b[1])];
  if (a0 == null || a1 == null || b0 == null || b1 == null) return null;
  return Math.abs(a0 - b0) < 0.002 && Math.abs(a1 - b1) < 0.002;
}

/**
 * Distance-weighted mean belt incline across a treadmill run's phases.
 *
 * Weighted, not averaged: David's 2026-08-06 session ran 2 miles of warm-up at
 * 1% and 2.86 miles of tempo at 0%. The unweighted mean of the phase inclines
 * says 0.5%; the weighted mean says 0.41%, and the tempo block — the part any
 * judgement actually cares about — was flat. Phases with no recorded distance
 * fall back to equal weighting rather than dropping out.
 *
 * Returns null when no phase records an incline at all, which is the honest
 * "we do not know what this belt was set to" answer.
 */
export function treadmillMeanInclinePct(phases: unknown): number | null {
  if (!Array.isArray(phases) || phases.length === 0) return null;
  let weighted = 0;
  let weight = 0;
  let plainSum = 0;
  let plainN = 0;
  for (const p of phases) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const inc = num(r.actualInclinePct);
    if (inc == null) continue;
    plainSum += inc;
    plainN += 1;
    const d = num(r.actualDistanceMi);
    if (d != null && d > 0) {
      weighted += inc * d;
      weight += d;
    }
  }
  if (plainN === 0) return null;
  return weight > 0 ? weighted / weight : plainSum / plainN;
}

export interface RunTerrain extends RunGradeAdjustment {
  /**
   * One short sentence for the coach to say when the terrain changed how this
   * run should be read, or null when it did not. Never contains the adjusted
   * pace on its own — adjusted figures only appear beside the real one.
   */
  note: string | null;
}

/**
 * Resolve a stored run into its terrain adjustment.
 *
 * Precedence for outdoor runs:
 *   1. Per-split elevation deltas — gives real gain AND real loss.
 *   2. `elevGainFt`, barometric-sanity-checked through the module that
 *      already owns that judgement, with loss taken as equal to gain.
 *   3. Nothing. The adjustment is an exact no-op and says so.
 *
 * The sanity check is REUSED, not reimplemented: a second 250 ft/mi threshold
 * living in this file is a second thing to keep in step with `Research/12`.
 */
export function resolveRunTerrain(row: RunTerrainRow): RunTerrain {
  const distanceMi = num(row.distanceMi) ?? 0;
  const durationSec =
    num(row.durationSec) ??
    num(row.movingTimeS) ??
    num(row.movingSec) ??
    num(row.elapsedTimeS) ??
    (num(row.paceSPerMi) != null && distanceMi > 0 ? (num(row.paceSPerMi) as number) * distanceMi : null) ??
    0;

  if (isTreadmillRow(row)) {
    const incline = treadmillMeanInclinePct(row.phases);
    const adj = runGradeAdjustment({
      distanceMi,
      durationSec,
      surface: 'treadmill',
      treadmillInclinePct: incline,
    });
    return { ...adj, note: terrainNote(adj, incline) };
  }

  const fromSplits = gainLossFromSplits(row.splits);
  if (fromSplits) {
    const adj = runGradeAdjustment({
      distanceMi,
      durationSec,
      gainFt: fromSplits.gainFt,
      lossFt: fromSplits.lossFt,
      surface: 'outdoor',
    });
    return { ...adj, note: terrainNote(adj, null) };
  }

  const sane = sanitizeElevGain({
    elevGainFt: num(row.elevGainFt),
    distanceMi,
    splits: Array.isArray(row.splits)
      ? (row.splits as Array<{
          elev_change_ft?: number | null;
          elevation_difference?: number | null;
          elev_ft?: number | null;
        }>)
      : undefined,
  });
  const adj = runGradeAdjustment({
    distanceMi,
    durationSec,
    gainFt: sane.value,
    lossFt: null,
    closedLoop: isClosedLoop(row),
    surface: 'outdoor',
  });
  return { ...adj, note: terrainNote(adj, null) };
}

/**
 * The coach's sentence about terrain. Plain runner-English per the voice
 * doctrine — no "grade-adjusted pace", no coefficients, no citations.
 *
 * The treadmill-with-no-incline case gets a note even though the adjustment is
 * a no-op, because "we do not know" is itself the finding: the brief's
 * requirement is that an unknown incline is stated rather than silently
 * treated as flat-and-therefore-easy.
 */
function terrainNote(a: RunGradeAdjustment, inclinePct: number | null): string | null {
  if (a.basis === 'treadmill-incline-unknown') {
    return 'Treadmill, incline not recorded. Pace alone does not say how hard this was.';
  }
  if (a.surface === 'treadmill') {
    if (!a.material) {
      return inclinePct != null && inclinePct > 0
        ? `Treadmill at ${trimPct(inclinePct)}% · that is flat-equivalent, so pace reads straight.`
        : 'Treadmill, flat belt. Pace reads straight.';
    }
    return `Treadmill at ${trimPct(inclinePct ?? 0)}% · the incline is doing real work here, so the pace is worth more than it looks.`;
  }
  if (!a.material) return null;
  const secs = Math.abs(Math.round(a.deltaSPerMi));
  return a.deltaSPerMi < 0
    ? `The climbing was worth about ${secs}s/mi · this was a harder effort than the pace shows.`
    : `Net downhill gave you about ${secs}s/mi · the pace flatters the effort a little.`;
}

function trimPct(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export type { TerrainBasis };
