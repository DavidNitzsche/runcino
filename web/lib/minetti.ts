/**
 * Minetti's cost-of-running curve.
 *
 * From Minetti et al. (2002), "Energy cost of walking and running at
 * extreme uphill and downhill slopes," J Appl Physiol 93(3):1039-1046.
 *
 * The polynomial is fit to treadmill measurements across grades in
 * [-0.45, +0.45]. Outside that range we clamp — extrapolation is
 * untrustworthy.
 *
 * This is the same model Strava uses for GAP.
 */

/** Cost of running in J/(kg·m) at grade g (as a decimal, not percent). */
export function minettiCost(g: number): number {
  const gc = Math.max(-0.45, Math.min(0.45, g));
  return (
    155.4 * Math.pow(gc, 5) -
    30.4  * Math.pow(gc, 4) -
    43.3  * Math.pow(gc, 3) +
    46.3  * Math.pow(gc, 2) +
    19.5  * gc +
    3.6
  );
}

/** Flat-ground baseline — C(0). */
export const FLAT_COST = minettiCost(0); // 3.6

/**
 * Grade Adjustment Factor — the ratio of energy cost at grade g to
 * flat-ground cost. Multiply flat-equivalent pace by this to get the
 * pace you'd have to run at grade g to expend the same energy per second.
 *
 * GAF(-0.05) ≈ 0.78   (downhill feels easier at same pace)
 * GAF(0)     =  1.00
 * GAF(+0.05) ≈ 1.80   (Hurricane Point territory)
 */
export function gradeAdjustmentFactor(gradePct: number): number {
  return minettiCost(gradePct / 100) / FLAT_COST;
}

/** Alias for readability in pacing code. */
export const gaf = gradeAdjustmentFactor;
