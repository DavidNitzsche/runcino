/**
 * projection-snapshots — daily snapshots of (VDOT, projection_sec) per user
 * per race distance, used by race-header.ts to compute the projection-trend
 * delta without re-running the full VDOT chain on every read.
 *
 * Schema lives in db/migrations/123_projection_snapshots.sql.
 *
 * Write path: cron at 00:30 local (or any time a snapshot is desired) calls
 *   recordProjectionSnapshot(userUuid, today, distanceMi, vdot, projSec, raceSlug)
 *
 * Read path: race-header (or any trend consumer) calls
 *   loadProjectionSnapshot(userUuid, asOfDate, distanceMi)
 * which returns the snapshot for that exact date, or null if none exists.
 *
 * Race-header currently falls back to a live re-compute when no snapshot
 * exists (V1 graceful degradation). Once the cron has been running for
 * 30+ days, snapshots will be the primary read path.
 */
import { pool } from '@/lib/db/pool';

export interface ProjectionSnapshot {
  user_uuid: string;
  snapshot_date: string;
  distance_mi: number;
  vdot: number | null;
  projection_sec: number | null;
  race_slug: string | null;
  source: string;
}

/**
 * Persist a snapshot. Idempotent via UNIQUE (user_uuid, snapshot_date,
 * distance_mi); a second call for the same key UPSERTs.
 */
export async function recordProjectionSnapshot(
  userUuid: string,
  snapshotDateISO: string,
  distanceMi: number,
  vdot: number | null,
  projectionSec: number | null,
  raceSlug: string | null,
  source = 'cron',
): Promise<void> {
  await pool.query(
    `INSERT INTO projection_snapshots
       (user_uuid, snapshot_date, distance_mi, vdot, projection_sec, race_slug, source)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7)
     ON CONFLICT (user_uuid, snapshot_date, distance_mi)
     DO UPDATE SET
       vdot = EXCLUDED.vdot,
       projection_sec = EXCLUDED.projection_sec,
       race_slug = EXCLUDED.race_slug,
       source = EXCLUDED.source`,
    [userUuid, snapshotDateISO, distanceMi, vdot, projectionSec, raceSlug, source],
  );
}

/**
 * Read the exact snapshot for (user, date, distance). Returns null if no
 * snapshot was recorded for that day (cron didn't run, user wasn't onboarded,
 * etc.). Callers should fall back to live computation in that case.
 */
export async function loadProjectionSnapshot(
  userUuid: string,
  snapshotDateISO: string,
  distanceMi: number,
): Promise<ProjectionSnapshot | null> {
  const r = await pool.query<ProjectionSnapshot>(
    `SELECT user_uuid::text AS user_uuid,
            snapshot_date::text AS snapshot_date,
            distance_mi::float AS distance_mi,
            vdot::float AS vdot,
            projection_sec, race_slug, source
       FROM projection_snapshots
      WHERE user_uuid = $1
        AND snapshot_date = $2::date
        AND distance_mi = $3
      LIMIT 1`,
    [userUuid, snapshotDateISO, distanceMi],
  ).catch(() => ({ rows: [] }));
  return r.rows[0] ?? null;
}

/**
 * Read the nearest snapshot at or before `snapshotDateISO`. Useful when the
 * cron hasn't fired for the exact date (weekend, deploy, daylight savings)
 * but a slightly older snapshot is good enough for trend math.
 */
export async function loadNearestSnapshot(
  userUuid: string,
  snapshotDateISO: string,
  distanceMi: number,
  maxLookbackDays = 7,
): Promise<ProjectionSnapshot | null> {
  const cutoff = new Date(Date.parse(snapshotDateISO + 'T12:00:00Z') - maxLookbackDays * 86400000)
    .toISOString().slice(0, 10);
  const r = await pool.query<ProjectionSnapshot>(
    `SELECT user_uuid::text AS user_uuid,
            snapshot_date::text AS snapshot_date,
            distance_mi::float AS distance_mi,
            vdot::float AS vdot,
            projection_sec, race_slug, source
       FROM projection_snapshots
      WHERE user_uuid = $1
        AND distance_mi = $2
        AND snapshot_date BETWEEN $3::date AND $4::date
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [userUuid, distanceMi, cutoff, snapshotDateISO],
  ).catch(() => ({ rows: [] }));
  return r.rows[0] ?? null;
}
