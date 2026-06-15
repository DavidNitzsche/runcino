/**
 * reanchor-maintenance — self-heal for no-race (maintenance / TT-goal) plans.
 *
 * A no-race plan's paces are baked at onboarding. If the runner's fitness
 * wasn't measurable then (data not synced yet, or a true cold start), the plan
 * was anchored on a conservative mileage estimate and NOTHING ever upgraded it
 * — the runner stayed on provisional paces forever. That's the Justin bug,
 * generalized.
 *
 * This runs daily inside the projection cron (which already computes every
 * runner's measured VDOT). When a measured read becomes available, or the
 * runner's fitness has shifted materially, it refreshes the FUTURE workouts'
 * paces IN PLACE — same buildWorkoutSpec the seeder uses, so a re-anchor and a
 * fresh seed at the same VDOT converge. Plan structure, dates, distances,
 * phases, and any already-run history are untouched; only pace_target +
 * workout_spec on workouts dated >= today change.
 *
 * It also powers calibration mode: a calibrating plan (seeded with no measured
 * VDOT) commits to its real paces here the moment its first honest effort reads.
 *
 * Cite: Research/01-pace-zones-vdot.md §"How to recalibrate paces" — update
 * VDOT and re-derive zones when a new measured signal lands.
 */

import { pool } from '@/lib/db/pool';
import { buildWorkoutSpec } from './spec-builder';
import { tPaceFromVdot, iPaceFromVdot } from '@/lib/training/vdot';

/** Refresh only when fitness moved enough to matter — avoids churning paces on
 *  day-to-day VDOT jitter (the fade/candidate set wiggles ±~0.5). */
export const REANCHOR_VDOT_DELTA = 2.0;

/**
 * Should we re-anchor? Yes when a measured read exists AND either the plan is
 * still on a provisional / calibrating anchor (one-time upgrade), or measured
 * fitness has diverged from the plan's anchor by >= the threshold.
 */
export function shouldReanchor(
  anchorSource: string | null,
  anchorVdot: number | null,
  measuredVdot: number | null,
): boolean {
  if (measuredVdot == null) return false;
  if (anchorSource !== 'measured_run') return true; // provisional / calibrating → upgrade
  if (anchorVdot == null) return true;
  return Math.abs(measuredVdot - anchorVdot) >= REANCHOR_VDOT_DELTA;
}

/**
 * The refreshed pace + spec for one workout at a new fitness level — IDENTICAL
 * to what the seeder emits at that VDOT (same buildWorkoutSpec call shape:
 * lthr/maxHr null, prescription default, goal-build I-pace when a TT goal
 * exists), so re-anchor and fresh-seed produce the same numbers.
 */
export function refreshedPaceAndSpec(
  type: string,
  distanceMi: number | null,
  newVdot: number,
  ttDistance: string | null,
): { paceTargetSPerMi: number | null; spec: unknown } {
  const tPaceSec = tPaceFromVdot(newVdot) ?? 480;
  const iPaceSec = ttDistance ? iPaceFromVdot(newVdot) : null;
  const built = buildWorkoutSpec(type, distanceMi, tPaceSec, null, undefined, null, null, iPaceSec);
  return { paceTargetSPerMi: built.paceTargetSPerMi, spec: built.spec };
}

export interface ReanchorResult {
  planId: string;
  fromVdot: number | null;
  toVdot: number;
  fromSource: string | null;
  workoutsUpdated: number;
}

/**
 * Re-anchor a user's active no-race plan to their measured fitness. No-op
 * (returns null) when there's no active no-race plan, no measured VDOT, or no
 * refresh is warranted. Best-effort by design — the cron catches per-user.
 */
export async function reanchorMaintenancePlan(
  userId: string,
  measuredVdot: number | null,
  today: string,
): Promise<ReanchorResult | null> {
  if (measuredVdot == null) return null;

  const planRow = (await pool.query<{ id: string; authored_state: Record<string, unknown> | null }>(
    `SELECT id, authored_state FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
        AND mode = 'maintenance' AND race_id IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!planRow) return null;

  const st = (planRow.authored_state ?? {}) as Record<string, any>;
  const anchorVdot = st.anchorVdot != null ? Number(st.anchorVdot) : null;
  const anchorSource = (st.anchorSource as string) ?? null;
  if (!shouldReanchor(anchorSource, anchorVdot, measuredVdot)) return null;

  const ttDistance = (st.onboarding_goals?.ttDistance as string) ?? null;

  // Future, pace-bearing workouts only — rest/cross/strength/shakeout carry no
  // pace target and are exempt from the workout_spec CHECK.
  const wkos = (await pool.query<{ id: string; type: string; distance_mi: string | null }>(
    `SELECT id, type, distance_mi FROM plan_workouts
      WHERE plan_id = $1 AND date_iso >= $2
        AND type NOT IN ('rest','cross','strength','shakeout')`,
    [planRow.id, today],
  )).rows;

  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const w of wkos) {
      const { paceTargetSPerMi, spec } = refreshedPaceAndSpec(
        w.type, w.distance_mi != null ? Number(w.distance_mi) : null, measuredVdot, ttDistance,
      );
      await client.query(
        `UPDATE plan_workouts SET pace_target_s_per_mi = $1, workout_spec = $2 WHERE id = $3`,
        [paceTargetSPerMi, spec ? JSON.stringify(spec) : null, w.id],
      );
      updated++;
    }
    const tPaceSec = tPaceFromVdot(measuredVdot) ?? 480;
    const iPaceSec = ttDistance ? iPaceFromVdot(measuredVdot) : null;
    const newState = {
      ...st,
      anchorVdot: measuredVdot,
      anchorSource: 'measured_run',
      tPaceSec, iPaceSec,
      calibrating: false,
      reanchored_at: today,
    };
    await client.query(
      `UPDATE training_plans SET authored_state = $1 WHERE id = $2`,
      [JSON.stringify(newState), planRow.id],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  try { (await import('./lookup')).bustPlanLookupCache(userId); } catch { /* best-effort */ }

  return {
    planId: planRow.id,
    fromVdot: anchorVdot,
    toVdot: measuredVdot,
    fromSource: anchorSource,
    workoutsUpdated: updated,
  };
}
