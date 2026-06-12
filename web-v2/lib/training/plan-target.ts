/**
 * plan-target.ts — what VDOT does this plan train you TOWARD?
 *
 * The fitness-trajectory model needs to know the plan's stimulus ceiling: the
 * fittest the plan is prescribing you to be by peak. We read it straight from
 * the plan's prescribed quality paces and convert each to an implied VDOT by
 * training zone, then take the highest (the plan's most goal-directed work).
 *
 * Only the zones with a clean, defensible VDOT inversion are used:
 *   · tempo / threshold      → invert T-pace (vdotFromTpace)
 *   · race_week_tuneup       → the prescribed pace IS goal race effort; read it
 *                              as a race at the goal distance (vdotFromRace)
 * Intervals are deliberately skipped: I-pace → VDOT is too approximate to
 * anchor a ceiling on, and any plan worth its salt carries tempo work too.
 *
 * Returns null when the plan has no T-pace / race-pace quality work to read
 * (the trajectory then falls back to the research build rate alone).
 *
 * Cite: Research/01-pace-zones-vdot.md §Daniels-T-pace; vdot.ts inversions.
 */

import { pool } from '@/lib/db/pool';
import { vdotFromTpace, vdotFromRace } from './vdot';

export async function loadPlannedTargetVdot(
  userUuid: string,
  goalDistanceMi: number,
): Promise<number | null> {
  const rows = (await pool.query<{ type: string; tgt: number | string | null }>(
    `SELECT pw.type, pw.pace_target_s_per_mi AS tgt
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.type IN ('tempo','threshold','race_week_tuneup')
        AND pw.pace_target_s_per_mi IS NOT NULL`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows;

  let best: number | null = null;
  for (const r of rows) {
    const pace = r.tgt != null ? Number(r.tgt) : null;
    if (!pace || pace <= 0) continue;
    let implied: number | null = null;
    if (r.type === 'race_week_tuneup') {
      // Prescribed at goal race effort → read as a race at the goal distance.
      implied = vdotFromRace(Math.round(pace * goalDistanceMi), goalDistanceMi);
    } else {
      // tempo / threshold → the prescribed pace is T-pace.
      implied = vdotFromTpace(pace);
    }
    if (implied != null && (best == null || implied > best)) best = implied;
  }
  return best;
}
