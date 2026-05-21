/**
 * VDOT-derived pace prescription.
 *
 * Source doctrine: web/coach/doctrine/pace_zones.ts (Research/01).
 *
 * Replaces the static PACE_OFFSETS_S_PER_MI table in
 * coach-principles.ts with research-anchored, runner-specific paces.
 * VDOT is derived from the runner's most recent race result; the
 * Daniels lookup table maps that VDOT to E/M/T/I/R race-time
 * equivalents, and PACE_ZONE_WIDTH gives the tolerance window per
 * zone.
 *
 * Pipeline:
 *   1. Pick the strongest recent race result (well-paced, ≤8 weeks
 *      old, neutral conditions).
 *   2. Convert to VDOT via VDOT_LOOKUP_TABLE (linear interp).
 *   3. From VDOT, look up that runner's E/M/T/I/R equivalent paces.
 *   4. Map a RunWorkoutType to its Daniels zone, return a band.
 *
 * Falls back to null when no recent race is available — caller
 * uses the legacy PACE_OFFSETS_S_PER_MI table as a fallback in that
 * case.
 */

import {
  VDOT_LOOKUP_TABLE,
  PACE_ZONE_WIDTH,
  DANIELS_E_OFFSET_S_PER_MI,
  MARATHON_VDOT_CORRECTION,
  type DanielsPace,
} from '../coach/doctrine';
import type { CoachState } from './coach-state';
import type { RunWorkoutType } from './coach-workouts';

// ── Race-time → VDOT ──────────────────────────────────────────────

type DistanceKey = 'mileS' | 'km3S' | 'km5S' | 'km10S' | 'km15S' | 'halfS' | 'marathonS';

/** Pick the closest distance key in the VDOT table for a given race
 *  distance in miles. The table covers Mile / 3K / 5K / 10K / 15K /
 *  Half / Marathon — race distances within 5% of one of these are
 *  treated as that distance for VDOT lookup. */
function distanceKeyForMi(distMi: number): { key: DistanceKey; canonicalMi: number } | null {
  const candidates: Array<{ key: DistanceKey; canonicalMi: number }> = [
    { key: 'mileS',     canonicalMi: 1 },
    { key: 'km3S',      canonicalMi: 1.864 },
    { key: 'km5S',      canonicalMi: 3.107 },
    { key: 'km10S',     canonicalMi: 6.214 },
    { key: 'km15S',     canonicalMi: 9.321 },
    { key: 'halfS',     canonicalMi: 13.109 },
    { key: 'marathonS', canonicalMi: 26.219 },
  ];
  for (const c of candidates) {
    if (Math.abs(distMi - c.canonicalMi) / c.canonicalMi < 0.05) return c;
  }
  return null;
}

/** Linear-interpolate a runner's VDOT from a race time at a known
 *  distance. Returns null when the race is outside the table range
 *  or distance doesn't map to a canonical lookup distance. */
export function vdotFromRace(distanceMi: number, timeS: number): number | null {
  const dist = distanceKeyForMi(distanceMi);
  if (!dist) return null;
  const rows = VDOT_LOOKUP_TABLE.value;
  // Time decreases as VDOT increases. Walk the table to find the
  // pair of rows the runner sits between.
  for (let i = 0; i < rows.length - 1; i++) {
    const hi = rows[i];     // higher time = lower VDOT
    const lo = rows[i + 1]; // lower time = higher VDOT
    const tHi = hi[dist.key];
    const tLo = lo[dist.key];
    if (timeS <= tHi && timeS >= tLo) {
      // Linear interp between the two VDOT tiers.
      const t = (tHi - timeS) / (tHi - tLo);
      return Math.round((hi.vdot + t * (lo.vdot - hi.vdot)) * 10) / 10;
    }
  }
  // Outside the table — return the closest endpoint VDOT for
  // graceful degradation.
  if (timeS > rows[0][dist.key]) return rows[0].vdot;
  if (timeS < rows[rows.length - 1][dist.key]) return rows[rows.length - 1].vdot;
  return null;
}

/** Look up the VDOT row, interpolating between tiers when the runner
 *  sits between them. Returns the full set of equivalent race times. */
export function vdotRow(vdot: number): {
  vdot: number;
  mileS: number;
  km3S: number;
  km5S: number;
  km10S: number;
  km15S: number;
  halfS: number;
  marathonS: number;
} | null {
  const rows = VDOT_LOOKUP_TABLE.value;
  if (vdot <= rows[0].vdot) return rows[0];
  if (vdot >= rows[rows.length - 1].vdot) return rows[rows.length - 1];
  for (let i = 0; i < rows.length - 1; i++) {
    if (vdot >= rows[i].vdot && vdot <= rows[i + 1].vdot) {
      const t = (vdot - rows[i].vdot) / (rows[i + 1].vdot - rows[i].vdot);
      const lerp = (a: number, b: number) => Math.round(a + t * (b - a));
      return {
        vdot,
        mileS:     lerp(rows[i].mileS,     rows[i + 1].mileS),
        km3S:      lerp(rows[i].km3S,      rows[i + 1].km3S),
        km5S:      lerp(rows[i].km5S,      rows[i + 1].km5S),
        km10S:     lerp(rows[i].km10S,     rows[i + 1].km10S),
        km15S:     lerp(rows[i].km15S,     rows[i + 1].km15S),
        halfS:     lerp(rows[i].halfS,     rows[i + 1].halfS),
        marathonS: lerp(rows[i].marathonS, rows[i + 1].marathonS),
      };
    }
  }
  return null;
}

// ── VDOT → Daniels pace bands ─────────────────────────────────────

export interface DanielsPaceSet {
  /** Source VDOT — for diagnostic / display. */
  vdot: number;
  /** E pace band — Easy / aerobic / recovery floor. s/mi. */
  E: { lowS: number; highS: number };
  /** M pace band — marathon pace. s/mi. */
  M: { lowS: number; highS: number };
  /** T pace band — threshold (anchored to HM pace by default; 15K
   *  for slower runners). s/mi. */
  T: { lowS: number; highS: number };
  /** I pace band — VO2max intervals (5K-3K range). s/mi. */
  I: { lowS: number; highS: number };
  /** R pace band — repetition / mile-pace work. s/mi. */
  R: { lowS: number; highS: number };
}

/** Build Daniels pace bands from a VDOT. The math:
 *  - M = marathon time / 26.219
 *  - T = HM pace for sub-elite, 15K pace for slower runners
 *  - I = 5K race pace (slightly slower for very long intervals)
 *  - R = mile race pace (or ~6 sec faster than I per 400m)
 *  - E = M + 60-90 sec/mi (Daniels' E is wide on purpose)
 *  Bands use PACE_ZONE_WIDTH per zone. */
export function pacesFromVdot(vdot: number): DanielsPaceSet | null {
  const row = vdotRow(vdot);
  if (!row) return null;

  // M pace (marathon) — center pace, 5 sec/mi band per Daniels
  const mCenterS = row.marathonS / 26.219;
  // T pace — for vdot >= 50 use HM pace; below that use 15K pace
  // (slower runners benefit from longer distance anchor per
  // Pfitzinger/Daniels).
  const tCenterS = vdot >= 50 ? row.halfS / 13.109 : row.km15S / 9.321;
  // I pace — 5K race pace
  const iCenterS = row.km5S / 3.107;
  // R pace — mile race pace
  const rCenterS = row.mileS / 1;
  // E pace — Daniels says E is 60-90 sec/mi slower than M; anchor the
  // center at the cited band midpoint.
  const eCenterS = mCenterS + DANIELS_E_OFFSET_S_PER_MI.value.center;

  const widthFor = (zone: DanielsPace): number => PACE_ZONE_WIDTH.value[zone].rangeWidthSPerMi;

  const band = (centerS: number, zone: DanielsPace) => {
    const half = widthFor(zone) / 2;
    return { lowS: Math.round(centerS - half), highS: Math.round(centerS + half) };
  };

  return {
    vdot,
    E: band(eCenterS, 'E'),
    M: band(mCenterS, 'M'),
    T: band(tCenterS, 'T'),
    I: band(iCenterS, 'I'),
    R: band(rCenterS, 'R'),
  };
}

// ── Workout-type → zone band ──────────────────────────────────────

/** Map a RunWorkoutType to a Daniels zone band. */
function zoneForWorkout(type: RunWorkoutType): DanielsPace | null {
  switch (type) {
    case 'recovery':            return 'E';
    case 'general_aerobic':     return 'E';
    case 'medium_long':         return 'E';
    case 'long_steady':         return 'E';
    case 'long_progression':    return 'M';   // ramps E→M; engine builds the structure, pace target = M
    case 'long_mp_block':       return 'M';
    case 'threshold':           return 'T';
    case 'threshold_intervals': return 'T';
    case 'sub_threshold':       return 'T';   // 10-15s slower than T applied at description level
    case 'vo2':                 return 'I';
    case 'marathon_specific':   return 'M';
    case 'strides_appended':    return 'R';
    case 'shakeout':            return 'E';
    case 'race':                return null;  // pace IS race pace; no band
    case 'rest':                return null;
  }
}

// ── Recent-race picker ────────────────────────────────────────────

interface RecentRace {
  date: string;
  distanceMi: number;
  timeS: number;
  name: string;
}

/** Pick the strongest recent race for VDOT inference. Heuristics:
 *  - state.races.recent is already filtered to the last 28 days
 *    (well within Daniels' ≤8w currency window).
 *  - Standard distance (within 5% of canonical Mile/5K/10K/15K/HM/M)
 *  - Highest derived VDOT wins. (Strongest race, not most recent —
 *    a runner's true fitness is the best of their recent results.)
 *  Returns null when no usable race is available. */
function pickStrongestRecentRace(state: CoachState): RecentRace | null {
  const pool = (state.races.bestForVdot?.length ? state.races.bestForVdot : state.races.recent);
  let best: { race: RecentRace; vdot: number } | null = null;
  for (const r of pool) {
    if (r.finishS == null) continue;                  // no time logged
    if (!distanceKeyForMi(r.distanceMi)) continue;    // non-canonical
    // Marathon performances underestimate aerobic VDOT — late-race
    // fatigue, fueling, heat, and connective-tissue endurance pull
    // marathon times below what pure aerobic ceiling would predict.
    // Daniels + every contemporary VDOT picker excludes marathon
    // (and ultra) distances from current-fitness inference. They're
    // fine for goal-time prediction (the marathonS column on the
    // lookup table is used elsewhere), just not for VDOT itself.
    if (r.distanceMi >= 22) continue;
    const vdot = vdotFromRace(r.distanceMi, r.finishS);
    if (vdot == null) continue;
    if (best == null || vdot > best.vdot) {
      best = {
        race: { date: r.date, distanceMi: r.distanceMi, timeS: r.finishS, name: r.name },
        vdot,
      };
    }
  }
  return best ? best.race : null;
}

// ── Public API ────────────────────────────────────────────────────

export interface VdotPaceTarget {
  /** Pace band, s/mi. */
  lowS: number;
  highS: number;
  /** Source VDOT — surfaces in coach voice ("at your VDOT 50 fitness…"). */
  vdot: number;
  /** Which Daniels zone this pace lives in. */
  zone: DanielsPace;
}

/** True when the runner shows a marathon-specific block: a long run
 *  ≥18 mi in at least 6 distinct weeks of the last ~10. This is the
 *  long-run half of MARATHON_VDOT_CORRECTION.blockDefinition. The
 *  "MP work ≥6 mi" half is not separately verified — there's no reliable
 *  marathon-pace-segment signal yet — so this is a conservative proxy:
 *  it confirms a block from long-run evidence only, and returns false
 *  (block unproven) when there's no activity history to inspect.
 *  @research Research/01 §Marathon-specific correction */
function hasMarathonSpecificBlock(state: CoachState): boolean {
  const acts = state.activities;
  if (!acts || acts.length === 0) return false;
  const weeks = new Set<number>();
  for (const a of acts) {
    const bucket = Math.floor((Date.now() - Date.parse(a.date)) / (7 * 86_400_000));
    if (bucket >= 0 && bucket < 10 && a.distanceMi >= 18) weeks.add(bucket);
  }
  return weeks.size >= 6;
}

/** Return a VDOT-derived pace target for the given workout type, or
 *  null when no recent race is available (caller uses legacy table).
 *
 *  Marathon-pace prescription (M zone) applies the marathon-specific
 *  VDOT correction: a 5K/10K-derived VDOT over-predicts marathon
 *  fitness, so when the source race is short AND we can see the runner
 *  has NOT built a marathon-specific block, we subtract the cited
 *  correction before deriving M pace. We only apply it when activity
 *  history is present (so "no block" is an observation, not an
 *  assumption). @research Research/01 §Marathon-specific correction */
export function paceTargetFromVdot(
  state: CoachState,
  workoutType: RunWorkoutType,
): VdotPaceTarget | null {
  const race = pickStrongestRecentRace(state);
  if (!race) return null;
  const vdot = vdotFromRace(race.distanceMi, race.timeS);
  if (vdot == null) return null;
  const zone = zoneForWorkout(workoutType);
  if (zone == null) return null;

  let effVdot = vdot;
  const sourceIsShort = race.distanceMi <= 7;   // 5K / 10K, not half+
  if (
    zone === 'M' &&
    sourceIsShort &&
    (state.activities?.length ?? 0) > 0 &&
    !hasMarathonSpecificBlock(state)
  ) {
    effVdot = vdot - MARATHON_VDOT_CORRECTION.value.subtractVdotPoints;
  }

  const set = pacesFromVdot(effVdot);
  if (!set) return null;
  const band = set[zone];
  // Report the source VDOT (true fitness), not the marathon-adjusted one.
  return { lowS: band.lowS, highS: band.highS, vdot, zone };
}

// ── Dashboard snapshot ────────────────────────────────────────────

export interface VdotSnapshot {
  /** Current VDOT (rounded to 1 decimal). */
  vdot: number;
  /** The race the VDOT was inferred from. */
  source: {
    name: string;
    date: string;        // ISO YYYY-MM-DD
    daysAgo: number;
    distanceMi: number;
    timeS: number;
    paceSPerMi: number;  // computed for display
  };
  /** Full Daniels pace bands. */
  paces: DanielsPaceSet;
}

/** Bundle the VDOT picture for the dashboard tile: source race +
 *  current VDOT + all 5 pace bands. Returns null when no usable
 *  recent race is logged. */
export function vdotSnapshot(state: CoachState): VdotSnapshot | null {
  // Use 180-day window (bestForVdot) to find peak fitness — a casual race
  // during a recovery block shouldn't drag VDOT below a runner's real ceiling.
  // Falls back to recent (28-day) if bestForVdot isn't populated (old state shape).
  const pool = (state.races.bestForVdot?.length ? state.races.bestForVdot : state.races.recent);
  let best: { race: typeof state.races.recent[number]; vdot: number } | null = null;
  for (const r of pool) {
    if (r.finishS == null) continue;
    if (!distanceKeyForMi(r.distanceMi)) continue;
    // Marathon (and ultra) results don't reflect aerobic VDOT cleanly —
    // late-race fatigue + fueling + heat are confounders. Skip for
    // current-fitness inference. (Marathon times are still used by
    // raceFitnessPrediction via vdotRow.marathonS — for predicting,
    // not inferring.)
    if (r.distanceMi >= 22) continue;
    const v = vdotFromRace(r.distanceMi, r.finishS);
    if (v == null) continue;
    if (best == null || v > best.vdot) best = { race: r, vdot: v };
  }
  if (!best || best.race.finishS == null) return null;

  const paces = pacesFromVdot(best.vdot);
  if (!paces) return null;

  return {
    vdot: best.vdot,
    source: {
      name: best.race.name,
      date: best.race.date,
      daysAgo: best.race.daysAgo,
      distanceMi: best.race.distanceMi,
      timeS: best.race.finishS,
      paceSPerMi: Math.round(best.race.finishS / best.race.distanceMi),
    },
    paces,
  };
}
