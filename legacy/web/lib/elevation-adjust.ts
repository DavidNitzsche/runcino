/**
 * S3 · Elevation-adjusted finish times
 *
 * Rather than binary-excluding hilly courses from VDOT calculation,
 * compute an "adjusted finish time" (raw time minus elevation
 * distortion) and surface BOTH alongside each other:
 *
 *   Actual finish:    3:36:55 (Big Sur, +1,800 ft net gain)
 *   Flat-equivalent:  3:24:30 (using elevation-cost model)
 *
 * Aggregate VDOT can opt to use the adjusted value when course is
 * flagged as significantly hilly. User can override to use raw.
 *
 * ADJUSTMENT FORMULA
 *   Cost of climbing: ~1 second per foot of net elevation gain at
 *   marathon pace (rule-of-thumb from running literature).
 *   For shorter distances, the impact compresses slightly because
 *   net gain is smaller relative to total work.
 *
 *   adjusted_s = raw_s - (net_elev_gain_ft × cost_per_ft)
 *
 *   cost_per_ft scales with distance:
 *     marathon: 1.0 s/ft
 *     half:     0.85 s/ft
 *     10K:      0.7 s/ft
 *     5K:       0.6 s/ft
 *
 * HILLY THRESHOLD
 *   Significant elevation = ≥ 50 ft/mi (e.g., Big Sur ~70 ft/mi).
 *   Below this, no adjustment surfaces; the raw time is honest.
 *
 * SOURCE OF TRUTH
 *   Reads net elevation gain from strava_activities.data.elevGainFt
 *   (already normalized via normalizeActivity). For race-source PRs,
 *   the linked Strava activity provides the elevation; if missing,
 *   adjustment isn't computed.
 *
 * RULE 2 (FALSIFIER): The adjustment is a model, not a measurement.
 * It's accurate within ±30 seconds for marathons on rolling courses
 * but errs more on point-to-point net-loss courses where downhill
 * gain doesn't fully cancel climb cost.
 */

export interface ElevationAdjustment {
  /** Raw finish time in seconds. */
  rawFinishS: number;
  /** Net elevation gain in feet (Strava elevGainFt). */
  elevGainFt: number;
  /** Distance in miles. */
  distanceMi: number;
  /** Elevation per mile (used for "significantly hilly" check). */
  elevPerMi: number;
  /** Flat-equivalent finish time in seconds (raw - cost). */
  adjustedFinishS: number;
  /** Seconds saved by the adjustment. */
  adjustmentSeconds: number;
  /** True when course is "significantly hilly" (≥50 ft/mi). */
  isSignificantlyHilly: boolean;
}

const HILLY_THRESHOLD_FT_PER_MI = 50;

function costPerFt(distanceMi: number): number {
  if (distanceMi >= 22) return 1.0;       // marathon
  if (distanceMi >= 11) return 0.85;      // half
  if (distanceMi >= 6) return 0.7;        // 10K
  if (distanceMi >= 3) return 0.6;        // 5K
  return 0.5;                              // shorter
}

export function computeElevationAdjustment(
  rawFinishS: number,
  elevGainFt: number,
  distanceMi: number,
): ElevationAdjustment {
  const safeDist = Math.max(0.1, distanceMi);
  const elevPerMi = elevGainFt / safeDist;
  const cost = costPerFt(distanceMi);
  const adjustmentSeconds = Math.max(0, Math.round(elevGainFt * cost));
  const adjustedFinishS = Math.max(0, rawFinishS - adjustmentSeconds);
  return {
    rawFinishS,
    elevGainFt,
    distanceMi,
    elevPerMi: Math.round(elevPerMi * 10) / 10,
    adjustedFinishS,
    adjustmentSeconds,
    isSignificantlyHilly: elevPerMi >= HILLY_THRESHOLD_FT_PER_MI,
  };
}
