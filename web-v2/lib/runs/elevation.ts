/**
 * WHICH ELEVATION READING TO BELIEVE.
 *
 * A run can arrive carrying several climb figures from several ingests, and
 * they are not different spellings of one measurement — they are different
 * INSTRUMENTS, and one of them is much better than the others.
 *
 * `raw` is the watch's barometric altimeter: a pressure sensor, reading the
 * air the runner is actually standing in. `gps_derived` is arithmetic over GPS
 * altitude, which is the weakest axis of a GPS fix and wanders tens of feet
 * while standing still — on flat ground that wander integrates into a climb
 * that never happened.
 *
 * Measured on this database, 2026-08-24, across every row carrying a source:
 *
 *     raw            94 rows   avg    96 ft
 *     gps_derived    14 rows   avg   218 ft
 *     recomputed      7 rows   avg  1012 ft
 *     absent          8 rows   avg   890 ft
 *     watch           3 rows   avg  4285 ft
 *
 * `gps_derived` runs 2.3x the barometer. The tail is not noise, it is nonsense:
 * one 11-mile run holds 3195 ft against barometric twins reading 94 and 57.
 *
 * The runner said it first: "I have a hard time believing my elevation on
 * today's run was 128 feet. I can promise you it was not." His watch agreed —
 * 13 ft, barometric, on the twin the merge absorbed and then overwrote.
 *
 * This is the same shape as the clock family and the pace family. A member may
 * not enter a row from a weaker instrument than the one already there, and
 * provenance belongs to the FAMILY rather than the field.
 */

/** Sources in descending order of trust. Anything unlisted is untrusted. */
export const ELEVATION_TRUST: Record<string, number> = {
  // A pressure sensor. The only direct measurement of altitude here.
  raw: 100,
  // The treadmill's own incline setting, times the distance. Not a sensor,
  // but an exact statement of what the machine was set to.
  treadmill_incline: 90,
  // Arithmetic over GPS altitude. Systematically high, sometimes wildly.
  gps_derived: 40,
  // Recomputed by us from stored samples, provenance already lost.
  recomputed: 20,
};

/** Below this, a figure may be carried but must never be presented as measured. */
export const ELEVATION_MEASURED_FLOOR = 90;

export interface ElevationCandidate {
  ft: number | null | undefined;
  source: string | null | undefined;
  /** For the message only — which ingest wrote it. */
  ingest?: string | null;
}

export interface ElevationReading {
  ft: number;
  source: string;
  /** True only when a real instrument measured it. Rule 1 lives here. */
  measured: boolean;
}

function trustOf(source: string | null | undefined): number {
  if (!source) return 0;
  return ELEVATION_TRUST[source] ?? 0;
}

/**
 * The best climb figure among everything a run and its absorbed twins carry.
 *
 * Returns null when nothing is trustworthy enough to print. A refusal is a
 * correct answer: an invented 3195 ft is worse than no number, because the
 * runner cannot tell it is invented.
 */
export function pickElevationGain(candidates: ElevationCandidate[]): ElevationReading | null {
  let best: ElevationReading | null = null;
  let bestTrust = -1;

  for (const c of candidates) {
    const ft = typeof c.ft === 'number' ? c.ft : Number(c.ft);
    if (!Number.isFinite(ft) || ft < 0) continue;
    const t = trustOf(c.source);
    // Untrusted sources are not ranked at all. `watch`, `absent` and an
    // unlabelled figure average four-figure climbs on this data; taking the
    // best of several bad instruments still leaves a bad instrument.
    if (t <= 0) continue;
    if (t > bestTrust) {
      bestTrust = t;
      best = { ft: Math.round(ft), source: String(c.source), measured: t >= ELEVATION_MEASURED_FLOOR };
    }
  }
  return best;
}
