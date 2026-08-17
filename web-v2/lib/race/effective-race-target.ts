/**
 * lib/race/effective-race-target.ts · the one resolver for what a race
 * execution surface paces off (2026-08-17 coaching-loop reconciliation).
 *
 * The defect: every race pacing surface — the watch race payload
 * (build-workout.ts), the execution plan (execution-plan.ts via its API
 * route), and the race-detail pacing (api/race/[slug] → buildRacePacing)
 * — paced off the STATED GOAL even when the projection said the runner
 * couldn't hold it. A 3:00 goal at 3:15 fitness produced 6:52/mi split
 * cards and watch targets that guarantee a blow-up (Research/08 §18.2:
 * ≥~5% adrift of honest pace by mile 5 is the unrecoverable zone).
 *
 * The rule: a race pacing surface never prescribes paces more than 5%
 * faster than the current projection.
 *
 *   effectiveTargetSec = goalSec                 when goal within 5% of projection
 *                      = projectionSec (rounded) otherwise
 *
 * The stated goal is not deleted: it rides along as `goalSec` (the
 * stretch) so surfaces with room show it as secondary — A-target =
 * effective, stretch = goal — per David's "goal caps ambition and frames
 * the season, but never writes paces the runner cannot run."
 *
 * No projection snapshot → goal fallback (cold start · nothing honest to
 * gate on, and the CI note on the execution plan already frames it).
 *
 * Cite: Research/08-pacing-and-race-week.md §3.1/§18.2 (execution-error
 * costs); Research/01-pace-zones-vdot.md §Freshness window (:659-677).
 */

import { pool } from '@/lib/db/pool';

export interface EffectiveRaceTarget {
  /** What the surface paces off. */
  targetSec: number;
  /** Where targetSec came from. */
  source: 'goal' | 'projection';
  /** The stated goal · the stretch when source === 'projection'. */
  goalSec: number;
  /** Latest projection for the distance · null when no snapshot. */
  projectionSec: number | null;
  /** ISO date of the snapshot used · null when none. */
  projectionDateISO: string | null;
}

/** Goal may run at most this fraction faster than projection. */
export const MAX_GOAL_OPTIMISM_FRACTION = 0.05;

/** Round a projection-sourced target to a clean number: nearest 10s for
 *  races over an hour, nearest 5s under. A watch target of 3:14:37 is
 *  noise pretending to be precision. */
export function roundTargetSec(sec: number): number {
  const step = sec >= 3600 ? 10 : 5;
  return Math.round(sec / step) * step;
}

/** Pure resolver · exported for tests. */
export function resolveEffectiveRaceTarget(
  goalSec: number,
  projectionSec: number | null | undefined,
  projectionDateISO: string | null = null,
): EffectiveRaceTarget {
  if (projectionSec == null || !Number.isFinite(projectionSec) || projectionSec <= 0) {
    return { targetSec: goalSec, source: 'goal', goalSec, projectionSec: null, projectionDateISO: null };
  }
  // goal within 5% of projection (goal is FASTER = smaller seconds; allow
  // goalSec down to 95% of projection).
  if (goalSec >= projectionSec * (1 - MAX_GOAL_OPTIMISM_FRACTION)) {
    return { targetSec: goalSec, source: 'goal', goalSec, projectionSec, projectionDateISO };
  }
  return {
    targetSec: roundTargetSec(projectionSec),
    source: 'projection',
    goalSec,
    projectionSec,
    projectionDateISO,
  };
}

/**
 * DB wrapper · latest projection snapshot for the race distance (±5%
 * band, same match the execution-plan route has always used) → pure
 * resolver. Best-effort: any read failure degrades to the goal.
 */
export async function loadEffectiveRaceTarget(
  userId: string,
  goalSec: number,
  distanceMi: number,
): Promise<EffectiveRaceTarget> {
  const snap = (await pool.query<{ projection_sec: number | null; snapshot_date: string | null }>(
    `SELECT projection_sec, snapshot_date::text AS snapshot_date
       FROM projection_snapshots
      WHERE user_uuid = $1 AND distance_mi BETWEEN $2 * 0.95 AND $2 * 1.05
        AND projection_sec IS NOT NULL
      ORDER BY snapshot_date DESC LIMIT 1`,
    [userId, distanceMi],
  ).catch(() => ({ rows: [] }))).rows[0];
  return resolveEffectiveRaceTarget(
    goalSec,
    snap?.projection_sec ?? null,
    snap?.snapshot_date ?? null,
  );
}
