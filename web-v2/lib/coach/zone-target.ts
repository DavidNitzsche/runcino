/**
 * Which heart-rate zone a prescribed workout is meant to live in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE, AND WHY IT HAS A DOCTRINE CLAIM
 *
 * The v5 Today screen draws a zone bar with one zone highlighted: the one the
 * session ASKED for. That is a physiological assertion — it says a threshold
 * session belongs in zone 4 and an easy run in zone 2 — and CLAUDE.md Rule 7
 * says a constant that asserts physiology carries a registry entry.
 *
 * It arrived inline in the route with a comment citing "Friel's 5-zone table
 * (Research/03 §6)". Two things were wrong with that:
 *
 *   · §6 is Friel's SEVEN-zone LTHR table. The five-zone table is §4, the
 *     ACSM one, and that is the table this maps onto.
 *   · `intervals` was mapped to zone 4. §4 puts VO2max work in zone 5
 *     ("5 VO2max / Anaerobic, 90–100%"), and zone 4 is "Threshold, LT, race
 *     pace". A VO2max session drawn as a threshold session is exactly the
 *     kind of quiet wrongness the doctrine gate exists to catch.
 *
 * The mapping is read off §4's own Purpose column, and
 * `ZONE_TARGET.workout-zone-mapping` in lib/doctrine/registry.ts parses that
 * column at run time and fails the build if it stops saying what this assumes.
 */

/** ACSM five-zone system, Research/03 §4. */
export const ZONE_TARGET = {
  /** "Aerobic base, fat oxidation". */
  aerobicBase: 2,
  /** "Aerobic capacity" — the tempo zone. */
  aerobicCapacity: 3,
  /** "LT, race pace". */
  threshold: 4,
  /** "Top-end aerobic, anaerobic". */
  vo2max: 5,
} as const;

/**
 * Null rather than a guess for a type this does not cover: an unhighlighted
 * zone bar is honest, a wrongly highlighted one is not.
 */
export function zoneTargetForWorkout(plannedType: string | null): number | null {
  switch ((plannedType ?? '').toLowerCase()) {
    case 'easy':
    case 'recovery':
    case 'shakeout':
    case 'long':
      return ZONE_TARGET.aerobicBase;
    case 'tempo':
    case 'progression':
    case 'race_week_tuneup':
    case 'race':
      return ZONE_TARGET.aerobicCapacity;
    case 'threshold':
    case 'fartlek':
      return ZONE_TARGET.threshold;
    case 'intervals':
    case 'vo2max':
      return ZONE_TARGET.vo2max;
    default:
      return null;
  }
}
