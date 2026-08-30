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
 * Read paths:
 *   · lib/notifications/projection-changed.ts, to diff today's value
 *     against the most recent prior one.
 *   · app/api/v5/races/route.ts, via loadGoalProjectionSeries below — the
 *     Races card's projected-finish chart. Added 2026-08-30, when the chart
 *     was found plotting the OTHER table (the frozen current-fitness
 *     equivalence) underneath a headline computed from this one.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { addDaysToDayKey } from '@/lib/runtime/day-key';
import { TREND_WINDOW_DAYS, type ProjectionRead } from './projection-trend';

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

/**
 * The daily trend series for one goal race, oldest first.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE WINDOW IS TRIMMED ON THE RUNNER'S CALENDAR
 *
 * Same reason `loadProjectionSeries` does it: a server-UTC cutoff adds or
 * drops a day of the chart depending on the hour the page is loaded, so the
 * same series looks different at 4pm and at 6pm.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE CATCH IS NOT A SWALLOW
 *
 * `goal_projection_snapshots` is migration 155, and migrations in this repo
 * ship as files and are applied by hand. On 2026-08-30 the table did not
 * exist in prod at all — the writer had been UPSERTing into nothing for
 * days behind a `.catch(() => null)`, which is exactly why nobody noticed.
 * An empty series here is a legitimate cold start (a new goal race, a
 * migration not yet applied), and the card says so in words rather than
 * drawing an empty chart. The failure is logged so the next occurrence is
 * visible rather than silent.
 */
export async function loadGoalProjectionSeries(
  userUuid: string,
  raceSlug: string,
  daysBack = TREND_WINDOW_DAYS,
): Promise<ProjectionRead[]> {
  let cutoff: string;
  try {
    cutoff = addDaysToDayKey(await runnerToday(userUuid), -daysBack);
  } catch (e) {
    console.error('[goal-projection-snapshots] runner day lookup failed:', userUuid, e);
    return [];
  }
  const r = await pool.query<{ d: string; ps: number | null }>(
    `SELECT snapshot_date::text AS d, projected_sec AS ps
       FROM goal_projection_snapshots
      WHERE user_uuid = $1
        AND race_slug = $2
        AND snapshot_date >= $3::date
      ORDER BY snapshot_date ASC`,
    [userUuid, raceSlug, cutoff],
  ).catch((e: unknown) => {
    console.error('[goal-projection-snapshots] series read failed:', userUuid, raceSlug, e);
    return { rows: [] as Array<{ d: string; ps: number | null }> };
  });
  return r.rows.map((row) => ({ date: row.d, projectedSec: row.ps }));
}
