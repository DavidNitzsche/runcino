/**
 * Which heart-rate zone a prescribed workout is meant to live in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE, AND WHY IT HAS A DOCTRINE CLAIM
 *
 * The v5 Today screen draws a zone bar with the prescribed zone highlighted:
 * the one the session ASKED for. That is a physiological assertion — it says a
 * threshold session belongs in zone 4 and an easy run in zone 2 — and
 * CLAUDE.md Rule 7 says a constant that asserts physiology carries a registry
 * entry.
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
 * ─────────────────────────────────────────────────────────────────────────
 * A RACE IS NOT ONE ZONE, AND IT WAS NEVER ZONE 3 (2026-08-21)
 *
 * `race` used to return zone 3 — one answer for every race, from 5K to
 * marathon. Round three of the iPhone handoff said a race prescribes Z4 and
 * Z5 and was refused on the correct principle: a design ruling does not move a
 * physiological constant. Refusing the ruling was right. Keeping zone 3 was
 * not, and the single answer was the deeper defect.
 *
 * Doctrine publishes the race heart-rate band per distance —
 * Research/08 §6.1, "Heart-rate ceilings by distance" — and the five ACSM
 * zones are bands of the same quantity, %HRmax. So the zone a race is run in
 * is not a judgement at all. It is an overlap, and the two tables settle it:
 *
 *   distance   §6.1 %HRmax    §4 zones it lands in
 *   5K         95-100%        Z5
 *   10K        92-96%         Z5
 *   Half       88-92%         Z4 + Z5   (the band straddles the 90% edge)
 *   Marathon   80-88%         Z4
 *
 * Zone 3 is 70-80% HRmax. NO race distance doctrine publishes reaches down
 * into it — the marathon, the slowest of them, starts exactly at its ceiling.
 * The old constant was wrong for every race the app can be handed, and the
 * handoff's "Z4 and Z5" is right as a statement about races in general and
 * exactly right for the half.
 *
 * Nothing below is a new number. `RACE_HR_PCT_MAX` is Research/08 §6.1's own
 * column, already bound by `RACEDAY.hr-ceilings`; `PCT_MAX_ZONE_BANDS` is
 * Research/03 §4's own table, already bound by `HR.pct-hrmax-zones`. This
 * module only intersects them, and
 * `ZONETARGET.race-zone-comes-from-the-race-hr-band` re-derives the whole
 * mapping out of both docs at run time.
 */
import { RACE_HR_PCT_MAX, raceDistanceCategory } from '@/lib/race/distance-doctrine';
import { PCT_MAX_ZONE_BANDS } from '@/lib/training/zones';

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
 * Every ACSM zone a %HRmax band spends real time in, 1-indexed and ascending.
 *
 * "Real time" means the overlap has positive width. A marathon's 80-88% band
 * touches zone 3 at exactly 80% and no further, so zone 3 is not part of the
 * prescription — highlighting it would tell a marathoner to run the first
 * third of the bar, which is the opposite of the instruction.
 */
export function zonesSpanning(lo: number, hi: number): number[] {
  const out: number[] = [];
  PCT_MAX_ZONE_BANDS.forEach(([zLo, zHi], i) => {
    if (Math.min(hi, zHi) - Math.max(lo, zLo) > 0) out.push(i + 1);
  });
  return out;
}

/**
 * The zone(s) a race is run in, from its distance.
 *
 * Empty when the distance is unknown. `lib/race/distance.ts` states the
 * codebase rule — "callers must treat null as no distance, never default it" —
 * and an unhighlighted bar is honest where a guessed one is not.
 */
export function raceZoneTargets(distanceMi: number | null | undefined): number[] {
  const cat = raceDistanceCategory(distanceMi);
  if (!cat) return [];
  const [lo, hi] = RACE_HR_PCT_MAX[cat];
  return zonesSpanning(lo, hi);
}

/**
 * The zones a prescribed session asked for, ascending. Empty rather than a
 * guess for a type this does not cover: an unhighlighted zone bar is honest,
 * a wrongly highlighted one is not.
 *
 * `distanceMi` is only read for a race, where doctrine's answer depends on it.
 */
export function zoneTargetsForWorkout(
  plannedType: string | null,
  distanceMi?: number | null,
): number[] {
  switch ((plannedType ?? '').toLowerCase()) {
    case 'easy':
    case 'recovery':
    case 'shakeout':
    case 'long':
      return [ZONE_TARGET.aerobicBase];
    case 'race':
      return raceZoneTargets(distanceMi);
    case 'tempo':
    case 'progression':
    case 'race_week_tuneup':
      return [ZONE_TARGET.aerobicCapacity];
    case 'threshold':
    case 'fartlek':
      return [ZONE_TARGET.threshold];
    case 'intervals':
    case 'vo2max':
      return [ZONE_TARGET.vo2max];
    default:
      return [];
  }
}

/**
 * Back-compatible single-zone read, for the `zoneTarget` wire field the phone
 * already decodes. Null when the prescription is a SET — a half asks for Z4
 * and Z5, and picking one of them to satisfy an Int field would put the
 * emphasis on half the instruction. Callers that can carry a set should read
 * `zoneTargetsForWorkout` instead.
 */
export function zoneTargetForWorkout(
  plannedType: string | null,
  distanceMi?: number | null,
): number | null {
  const zones = zoneTargetsForWorkout(plannedType, distanceMi);
  return zones.length === 1 ? zones[0] : null;
}
