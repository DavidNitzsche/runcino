/**
 * lib/training/course-impact.ts · Course chunk for the Targets GapPanel.
 *
 * Returns the elevation-driven seconds penalty for a given race, derived
 * from course_library's editorial gross + net elevation fields. Used by
 * `goalRace.courseImpactSec` in the seed → GapPanel reads it directly.
 *
 * Two independent inputs drive the penalty:
 *
 *   1. NET elevation (signed end-of-course − start-of-course):
 *      · positive = net climb · costs +10 s/mi per 100 ft/mi net climb
 *      · negative = net drop  · gives back -7 s/mi per 100 ft/mi net drop
 *      A net-downhill course (CIM is -340 ft) gets a credit; we still
 *      FLOOR the final total at 0 sec per the brief's UX call (the
 *      doctrine drawer copy surfaces the upside in words instead of
 *      a negative-time chunk).
 *
 *   2. GROSS elevation gain (sum of all positive sample-to-sample deltas):
 *      · adds +2 s/mi per 100 ft/mi gross gain as a fatigue tax
 *      Even on a net-flat or net-downhill course, climbing 1000 ft over
 *      the day costs you something in the back half. Big Sur (2182 ft
 *      gross, +260 ft net) pays both: most of the impact comes from
 *      the gross fatigue tax.
 *
 * The per-mile coefficients are Daniels-calibrated for mid-pack
 * marathon pace (~8:00/mi). Faster runners feel less per ft, slower
 * runners feel more — we apply a gentle goal-pace scaler
 * (goalPaceSPerMi / 480) so an elite 5:30/mi runner gets a smaller
 * chunk than David's 6:51/mi marathon goal at the same course.
 *
 * Citations:
 *   · Daniels' Running Formula · §elevation correction
 *   · learn_articles slug=doctrine-elevation-correction (seeded alongside)
 *
 * Returns null when both gross AND net are unknown (stub courses) — the
 * panel hides the chunk gracefully in that case. Returns 0 when the
 * math floored at zero (the course is a non-factor or a net upside).
 */

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

const NET_CLIMB_S_PER_MI_PER_100FT = 10;
const NET_DROP_S_PER_MI_PER_100FT  = -7;
const GROSS_FATIGUE_S_PER_MI_PER_100FT = 2;
const PACE_BASELINE_S_PER_MI = 480;  // 8:00/mi

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

  // Per-mile pace factor. <1 = faster runner, less per-ft impact.
  // Capped to a sane band so a 4:00/mi elite isn't getting unrealistically
  // small penalties and a 12:00/mi runner isn't getting unrealistically large.
  const goalPaceSPerMi = goalSec / dist;
  const paceFactor = Math.max(0.6, Math.min(1.6, goalPaceSPerMi / PACE_BASELINE_S_PER_MI));

  // Gross fatigue: applies whenever we know gross, regardless of net.
  const grossPerMi = (gross ?? 0) / dist;
  const fatigueSec = (grossPerMi / 100) * GROSS_FATIGUE_S_PER_MI_PER_100FT * dist * paceFactor;

  // Net time impact: only when net is known.
  let netSec = 0;
  if (net != null && isFinite(net)) {
    const netClimbPerMi = Math.max(0, net) / dist;
    const netDropPerMi  = Math.max(0, -net) / dist;
    const netClimb = (netClimbPerMi / 100) * NET_CLIMB_S_PER_MI_PER_100FT * dist;
    const netDrop  = (netDropPerMi  / 100) * NET_DROP_S_PER_MI_PER_100FT  * dist;
    netSec = (netClimb + netDrop) * paceFactor;
  }

  const total = Math.max(0, Math.round(fatigueSec + netSec));

  return {
    seconds: total,
    elevGainFtPerMi: Math.round(grossPerMi * 10) / 10,
    netElevFtPerMi:  net == null ? 0 : Math.round((net / dist) * 10) / 10,
    source,
  };
}
