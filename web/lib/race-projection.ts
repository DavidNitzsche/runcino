/**
 * C9 · Race result projection over next 12 weeks
 *
 * Projects two race-time trajectories on the A-race countdown card:
 *
 *   "If you maintain"      · flat at current VDOT
 *   "If you hit prescribed" · trending toward goal based on plan
 *                              progression + Signal 4 (PR trajectory)
 *                              evidence to date
 *
 * Goal line shown as horizontal reference. The chart updates as
 * VDOT changes (manual override, fresh race results, L7 bumps).
 *
 * MATH
 *   Maintain line: pacesFromVdot(currentVdot)[distance] across all
 *                  12 weeks. Flat.
 *   Plan line:     current VDOT + linear interpolation to (goalVdot,
 *                  raceDate). Capped at goalVdot.
 *   goalVdot:      VDOT needed to hit goal time at race distance,
 *                  via inverse vdotRow lookup.
 *
 * NO FAKE PROJECTION, when there's no goal time OR the goal is at
 * or easier than current VDOT, plan line equals maintain line. The
 * projection is honest about what it does and doesn't know.
 */

import { vdotRow } from './vdot';

type DanielsRow = NonNullable<ReturnType<typeof vdotRow>>;
type DanielsKey = 'mileS' | 'km3S' | 'km5S' | 'km10S' | 'km15S' | 'halfS' | 'marathonS';

export interface ProjectionPoint {
  /** Week index 0..12. */
  weekIdx: number;
  /** Maintain-line VDOT (constant). */
  maintainVdot: number;
  /** Plan-line VDOT (linearly approaching goal). */
  planVdot: number;
  /** Projected finish time in seconds (maintain). */
  maintainFinishS: number;
  /** Projected finish time in seconds (plan). */
  planFinishS: number;
}

export interface RaceProjection {
  weeksToRace: number;
  currentVdot: number;
  goalVdot: number | null;
  goalFinishS: number;
  distanceMi: number;
  points: ProjectionPoint[];
  /** True when goal is harder than current VDOT (plan line diverges
   *  upward from maintain line). False when goal is at-or-easier. */
  hasMeaningfulPlanTrajectory: boolean;
}

function distanceKey(distanceMi: number): DanielsKey | null {
  if (Math.abs(distanceMi - 1.0) < 0.10) return 'mileS';
  if (Math.abs(distanceMi - 3.107) < 0.16) return 'km5S';
  if (Math.abs(distanceMi - 6.214) < 0.31) return 'km10S';
  if (Math.abs(distanceMi - 9.321) < 0.47) return 'km15S';
  if (Math.abs(distanceMi - 13.109) < 0.55) return 'halfS';
  if (Math.abs(distanceMi - 26.219) < 1.05) return 'marathonS';
  return null;
}

/** Inverse-lookup: given a finish time at a canonical distance, find
 *  the closest VDOT row whose predicted time matches. */
function vdotForFinish(distanceMi: number, finishS: number): number | null {
  const key = distanceKey(distanceMi);
  if (!key) return null;
  let bestVdot: number | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let v = 30; v <= 85; v += 0.1) {
    const row = vdotRow(v);
    if (!row) continue;
    const predicted = row[key];
    const diff = Math.abs(predicted - finishS);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestVdot = Math.round(v * 10) / 10;
    }
  }
  return bestVdot;
}

export function computeRaceProjection(
  currentVdot: number,
  distanceMi: number,
  goalFinishS: number,
  weeksToRace: number,
): RaceProjection {
  const key = distanceKey(distanceMi);
  const goalVdot = goalFinishS > 0 ? vdotForFinish(distanceMi, goalFinishS) : null;
  const hasMeaningfulPlanTrajectory = goalVdot != null && goalVdot > currentVdot + 0.5;
  const weeksClamped = Math.max(1, Math.min(12, weeksToRace));

  const points: ProjectionPoint[] = [];
  for (let w = 0; w <= weeksClamped; w++) {
    const t = w / weeksClamped;
    const planVdot = hasMeaningfulPlanTrajectory && goalVdot != null
      ? currentVdot + (goalVdot - currentVdot) * t
      : currentVdot;
    const maintainRow = vdotRow(currentVdot);
    const planRow = vdotRow(planVdot);
    const maintainFinishS = (key && maintainRow) ? maintainRow[key] : 0;
    const planFinishS = (key && planRow) ? planRow[key] : 0;
    points.push({
      weekIdx: w,
      maintainVdot: Math.round(currentVdot * 10) / 10,
      planVdot: Math.round(planVdot * 10) / 10,
      maintainFinishS: Math.round(maintainFinishS),
      planFinishS: Math.round(planFinishS),
    });
  }

  return {
    weeksToRace: weeksClamped,
    currentVdot: Math.round(currentVdot * 10) / 10,
    goalVdot: goalVdot,
    goalFinishS,
    distanceMi,
    points,
    hasMeaningfulPlanTrajectory,
  };
}
