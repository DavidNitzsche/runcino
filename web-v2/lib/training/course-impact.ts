/**
 * lib/training/course-impact.ts · Course chunk for the Targets GapPanel.
 *
 * Returns the elevation-driven seconds penalty for a given race, derived
 * from course_library's editorial gross + net elevation fields. Used by
 * `goalRace.courseImpactSec` in the seed → GapPanel reads it directly.
 *
 * ── 2026-08-17 · doctrine-conformance audit, cluster 4 ────────────────────
 *
 * This file used to carry its own elevation model: +10 s/mi per 100 ft/mi of
 * net climb, −7 for a net drop, +2 as a "gross fatigue tax", all times an
 * invented goal-pace scaler, cited to "Daniels' Running Formula §elevation
 * correction" — a section with no copy in this repo and no counterpart in
 * Research/. It disagreed with lib/race/pacing.ts, which prices the same
 * physics off Research/11's cited 3.3%-per-1%-of-grade energy cost, by a
 * factor of 3-6. This file is the one the Targets projection reads, so the
 * projection systematically under-read hilly goal races: Big Sur came out at
 * 59 seconds of course cost where the cited model gives 308.
 *
 * There is now one model, in lib/training/elevation-model.ts, and both
 * consumers call it. What remains here is presentation: the per-mile figures
 * the doctrine drawer quotes, the course_library provenance flag, and the
 * floor at 0 (the brief's UX call — a net-downhill upside is surfaced in
 * words, not as a negative-time chunk).
 *
 * Returns null when both gross AND net are unknown (stub courses) — the
 * panel hides the chunk gracefully in that case. Returns 0 when the
 * math floored at zero (the course is a non-factor or a net upside).
 */
import { courseElevationCostSec } from './elevation-model';

export interface CourseImpactInput {
  /** Race distance in miles. Required. */
  distanceMi: number;
  /** Target finish time in seconds (the runner's A-goal). Required. */
  goalSec: number;
  /** Gross climbed feet across the course. Null when course_library is
   *  a stub with no data. */
  elevationGainFt: number | null | undefined;
  /** Signed net elevation change in feet (finish − start). Positive =
   *  net climb. Null when course_library hasn't been editorial'd. */
  netElevationFt: number | null | undefined;
}

export interface CourseImpactResult {
  /** Seconds added to the projected race time by the course profile.
   *  Floored at 0. Null when neither gross nor net is known. */
  seconds: number | null;
  /** Per-mile gross gain (ft/mi). 0 when unknown. Surfaced for the
   *  doctrine drawer copy ("16 ft/mi gross — essentially flat"). */
  elevGainFtPerMi: number;
  /** Per-mile net change (ft/mi). 0 when unknown. */
  netElevFtPerMi: number;
  /** Provenance flag for the panel (matches course_library.source). */
  source: 'editorial' | 'crowd' | 'stub';
}

export function computeCourseImpact(
  input: CourseImpactInput,
  courseSource: 'editorial' | 'crowd' | 'stub' | null = null,
): CourseImpactResult {
  const dist = Number(input.distanceMi);
  const goalSec = Number(input.goalSec);
  const gross = input.elevationGainFt == null ? null : Number(input.elevationGainFt);
  const net = input.netElevationFt == null ? null : Number(input.netElevationFt);
  const source = courseSource ?? 'stub';

  // Hide the chunk entirely when we have no course data at all.
  if (!isFinite(dist) || dist <= 0 || !isFinite(goalSec) || goalSec <= 0) {
    return { seconds: null, elevGainFtPerMi: 0, netElevFtPerMi: 0, source };
  }
  if (gross == null && net == null) {
    return { seconds: null, elevGainFtPerMi: 0, netElevFtPerMi: 0, source };
  }

  // The doctrine model does its own pace scaling — Research/11's cost is a
  // FRACTION of pace, so a 5:30/mi runner already pays fewer seconds per foot
  // than a 9:00/mi runner. The old hand-tuned goalPace/480 scaler is gone.
  const goalPaceSPerMi = goalSec / dist;
  const grossPerMi = (gross ?? 0) / dist;
  const signedSec = courseElevationCostSec({
    distanceMi: dist,
    flatPaceSPerMi: goalPaceSPerMi,
    gainFt: gross,
    netFt: net,
  });

  // Floor at 0 per the brief's UX call · a net-downhill credit is surfaced in
  // the drawer copy, not as a negative chunk in the gap arithmetic.
  const total = signedSec == null ? 0 : Math.max(0, Math.round(signedSec));

  return {
    seconds: total,
    elevGainFtPerMi: Math.round(grossPerMi * 10) / 10,
    netElevFtPerMi:  net == null ? 0 : Math.round((net / dist) * 10) / 10,
    source,
  };
}
