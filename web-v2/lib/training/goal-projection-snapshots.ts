/**
 * goal-projection-snapshots — daily snapshot of computeGoalProjection's
 * trajectory-projected finish time for a runner's next A race.
 *
 * Schema: db/migrations/155_goal_projection_snapshots.sql. NOT the same
 * table as lib/training/projection-snapshots.ts (that one stores the raw
 * VDOT-derived number for the canonical HM/M distances; this stores the
 * execution-scaled trajectory number keyed to the runner's actual goal
 * race — see the migration header for why these are two different things).
 *
 * Write path: /api/cron/snapshot-projections, once daily per user.
 * Read path: lib/notifications/projection-changed.ts, to diff today's
 * value against the most recent prior one.
 */
import { pool } from '@/lib/db/pool';

/**
 * Persist today's projection. Idempotent via UNIQUE (user_uuid, race_slug,
 * snapshot_date) — a second call the same day UPSERTs rather than
 * duplicating, so a re-run cron never produces two rows for one day.
 */
export async function recordGoalProjectionSnapshot(
  userUuid: string,
  raceSlug: string,
  snapshotDateISO: string,
  projectedSec: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO goal_projection_snapshots (user_uuid, race_slug, snapshot_date, projected_sec)
     VALUES ($1, $2, $3::date, $4)
     ON CONFLICT (user_uuid, race_slug, snapshot_date)
     DO UPDATE SET projected_sec = EXCLUDED.projected_sec`,
    [userUuid, raceSlug, snapshotDateISO, projectedSec],
  );
}

/**
 * The most recent projection recorded for this race BEFORE the given date.
 * Null when no prior snapshot exists (cold start, or a newly-set goal race)
 * — the caller reads that as "nothing to diff against yet", not as "no
 * change".
 */
export async function loadPreviousGoalProjectionSec(
  userUuid: string,
  raceSlug: string,
  beforeDateISO: string,
): Promise<number | null> {
  const row = (await pool.query<{ projected_sec: number | null }>(
    `SELECT projected_sec
       FROM goal_projection_snapshots
      WHERE user_uuid = $1 AND race_slug = $2 AND snapshot_date < $3::date
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [userUuid, raceSlug, beforeDateISO],
  )).rows[0];
  return row ? row.projected_sec : null;
}
