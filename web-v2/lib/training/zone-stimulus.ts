/**
 * lib/training/zone-stimulus.ts · CEIL-ZONE-1 (2026-08-19) · what VDOT a
 * prescribed pace is worth, read at the session's OWN zone.
 *
 * ── The bug this replaces ──────────────────────────────────────────────────
 *
 * `plan-target.ts` used to carry one branch that was false four times out of
 * five:
 *
 *     if (r.type === 'race_week_tuneup')
 *       implied = vdotFromRace(pace * goalDistanceMi, goalDistanceMi);
 *
 * under the comment "prescribed at goal race effort → read as a race at the
 * goal distance". `generate.ts` picks the race-week primer by distance and
 * `spec-builder.ts` turns it into `pace_target_s_per_mi`, and only one of the
 * five prescriptions is anything like a race at the goal distance:
 *
 *   | goal  | prescription       | stored pace | what the old branch called it |
 *   | 5K    | 5×200m @ 5K pace   | I-pace      | a 5K race · right by accident |
 *   | 10K   | 4×400m @ 5K pace   | I-pace      | a 10K raced at 5K pace        |
 *   | HM    | 4×1km @ race pace  | goal HM     | the goal time · circular      |
 *   | M     | 5×400m @ 5K pace   | I-pace      | a MARATHON raced at 5K pace   |
 *   | ultra | 5×400m @ T pace    | T−5         | an ultra raced at T pace      |
 *
 * The marathon row did the damage. At VDOT 48 the plan's I-pace is 398 s/mi,
 * and `vdotFromRace(398 × 26.2188, 26.2188)` is VDOT 55.7 — a 2:53 marathon,
 * read off four hundred-metre reps, 7.7 points above the runner the plan was
 * written for. Since the ceiling is a MAX over rows, that beat every honest
 * threshold row, so `planBuiltForGoal` was unconditionally true for every
 * marathon plan and `planUnderBuilt` unconditionally false.
 *
 * ── The reading ────────────────────────────────────────────────────────────
 *
 * A rep is not a race. Four hundred metres at VO2max pace says the plan is
 * training a runner whose I-PACE is that number; it says nothing about holding
 * it for 26 miles. `Research/01-pace-zones-vdot.md` §"Pace conversion from a
 * race time" defines every training zone as a column of the published table
 * ("T | ~half-marathon pace to 15K pace", "I | ~3K to 5K race pace", "R |
 * ~mile race pace"), so reading a prescribed pace means reading THAT zone's
 * column, backwards.
 *
 * `lib/plan/zone-anchors.ts#resolveZoneAnchors` is already the single forward
 * answer to "what pace is this zone for this runner" — the selector prices
 * sessions off it and `buildWorkoutSpec` paces them off it. `vdotFromZonePace`
 * inverts that same function by binary search rather than re-deriving anything,
 * so the VDOT read OUT of a pace and the pace written IN are one relation by
 * construction. `PACE.zone-stimulus-inversion` asserts the round trip.
 *
 * Pure: no clock, no random, no I/O. `plan-target.ts` supplies the rows.
 *
 * Cite: Research/01-pace-zones-vdot.md §Pace conversion from a race time
 * Cite: Research/01-pace-zones-vdot.md §VDOT lookup table
 */

import type { PaceZone } from '@/lib/workout-catalogue/types';
import { primaryZone } from '@/lib/plan/prescription-parser';
import { resolveZoneAnchors, zonePaceSec } from '@/lib/plan/zone-anchors';
import {
  tPaceFromVdot,
  iPaceFromVdot,
  racePaceFromVdot,
  TABLE_RACE_DISTANCE_MI,
  DANIELS_VDOT_MIN,
  DANIELS_VDOT_MAX,
} from './vdot';

/**
 * The pace `resolveZoneAnchors` gives this zone for a runner AT this VDOT.
 *
 * Every input to the forward table is derived from the one VDOT — T off the
 * published half column, I off the 5K column, M off the marathon column — so
 * the result is a pure, monotone-decreasing function of it.
 */
export function zonePaceAtVdot(vdot: number, zone: PaceZone): number | null {
  const anchors = resolveZoneAnchors({
    tPaceSec: tPaceFromVdot(vdot),
    iPaceSec: iPaceFromVdot(vdot),
    marathonPaceSec: racePaceFromVdot(vdot, TABLE_RACE_DISTANCE_MI.marathon),
  });
  return zonePaceSec(zone, anchors);
}

/**
 * The VDOT whose published table puts this zone at this pace — the inverse of
 * `resolveZoneAnchors`.
 *
 * Binary search over the table's own range, against the forward function
 * itself. A pace off either end of the table returns null rather than clamping
 * onto the nearest edge: a pace nobody in the table runs is not evidence about
 * the fastest or slowest runner in it. A zone the forward table declines to
 * price for a self-consistent runner (only ST, and only where sub-threshold
 * would invert past marathon pace) likewise returns null rather than a guess,
 * exactly as the forward direction does.
 */
export function vdotFromZonePace(zone: PaceZone, paceSPerMi: number): number | null {
  if (!Number.isFinite(paceSPerMi) || paceSPerMi <= 0) return null;
  let lo = DANIELS_VDOT_MIN, hi = DANIELS_VDOT_MAX;
  const slowest = zonePaceAtVdot(lo, zone);
  const fastest = zonePaceAtVdot(hi, zone);
  if (slowest == null || fastest == null) return null;
  if (paceSPerMi > slowest || paceSPerMi < fastest) return null;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const p = zonePaceAtVdot(mid, zone);
    if (p == null) return null;
    // Slower (larger s/mi) than the target pace → VDOT too low → search up.
    if (p > paceSPerMi) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/**
 * The zone a quality row is paced at when its prescription declares none.
 *
 * Deliberately the same defaults `dosing.ts#dosePaceOf` falls back to for the
 * same types, so the bucket a session is charged to and the zone it is read at
 * cannot disagree. `race_week_tuneup` is absent on purpose — see
 * `CEILING_TYPES`.
 */
export const TYPE_DEFAULT_ZONE: Readonly<Record<string, PaceZone>> = {
  tempo: 'T',
  threshold: 'T',
  intervals: 'I',
  vo2max: 'I',
};

/**
 * The types whose prescribed pace is a stimulus target the ceiling can read.
 *
 * `race_week_tuneup` is NOT one of them, at any distance.
 * `Research/08-pacing-and-race-week.md` §9.1: "The largest cut is to easy
 * mileage; intensity is preserved through the taper." The taper expresses
 * fitness; it does not build it — the same reading `fitness-trajectory.ts`
 * already applies when it subtracts `taperWeeksForDistance` from the build
 * window. A session inside the window the model credits with no gain cannot be
 * the ceiling of the gain.
 *
 * It also removes the half-marathon circularity for free. The HM primer is
 * paced AT the runner's goal (`spec-builder.ts` `wantsRacePace` →
 * `goalPaceSPerMi`), so counting it proved the plan reached the goal by
 * restating the goal.
 */
export const CEILING_TYPES: readonly string[] = Object.keys(TYPE_DEFAULT_ZONE);

/**
 * Zones whose pace is set FROM THE RUNNER'S GOAL rather than from the plan's
 * own progression, and which therefore cannot be evidence about the plan's
 * ambition.
 *
 * `spec-builder.ts#marathonPaceSPerMi` returns the runner's own GOAL marathon
 * pace whenever that pace sits inside the marathon zone. For a marathon goal
 * that row is the goal wearing a workout's clothes, and reading it back as
 * evidence the plan reaches the goal is the same circularity by a second route.
 */
export const GOAL_ECHO_ZONES: ReadonlySet<PaceZone> = new Set<PaceZone>(['M', 'MP']);

/** One row's contribution to the ceiling, for diagnosis and for the gate. */
export interface PlannedStimulusRow {
  type: string;
  zone: PaceZone;
  paceSPerMi: number;
  vdot: number;
}

/**
 * Read one plan row's stimulus, or null when the row is not evidence about the
 * plan's ceiling.
 */
export function stimulusVdotForRow(
  type: string,
  subLabel: string | null | undefined,
  paceSPerMi: number | null | undefined,
): PlannedStimulusRow | null {
  if (paceSPerMi == null || !Number.isFinite(paceSPerMi) || paceSPerMi <= 0) return null;
  if (!CEILING_TYPES.includes(type)) return null;
  const declared = primaryZone(subLabel) as PaceZone | null;
  const zone = declared ?? TYPE_DEFAULT_ZONE[type] ?? null;
  if (zone == null) return null;
  if (GOAL_ECHO_ZONES.has(zone)) return null;
  const vdot = vdotFromZonePace(zone, paceSPerMi);
  if (vdot == null) return null;
  return { type, zone, paceSPerMi, vdot };
}
