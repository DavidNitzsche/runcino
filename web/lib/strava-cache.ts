/**
 * Postgres-backed Strava activities cache.
 *
 * Replaces the old in-memory module-scoped cache. Now:
 *   - Activity list is pulled from Strava once per 15 min and the
 *     resulting normalized rows land in `strava_activities`.
 *   - Per-activity detail (splits + best_efforts) is cached in the
 *     `detail` column on demand by the activity-detail endpoint.
 *   - Sync metadata (last fetch time) lives in `strava_sync_state`.
 *
 * Survives Railway redeploys + cold starts — the whole app rides one
 * 100-req/15-min Strava budget across all pages and all sessions.
 */

import { fetchActivities, type StravaActivity } from './strava';
import { normalizeActivity, type NormalizedActivity } from '../app/api/strava/activities/route-shared';
import { query, withClient } from './db';

const TTL_MS = 15 * 60 * 1000;

interface SyncState { lastFetchedAt: string | null }

async function getSyncState(): Promise<SyncState> {
  const rows = await query<{ value: SyncState }>(
    `SELECT value FROM strava_sync_state WHERE key = 'activities_sync'`,
  );
  return rows[0]?.value ?? { lastFetchedAt: null };
}

async function setSyncState(state: SyncState): Promise<void> {
  await query(
    `INSERT INTO strava_sync_state (key, value, updated_at)
     VALUES ('activities_sync', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(state)],
  );
}

/** Force-refresh: pull a new activity list from Strava and upsert
 *  every row into Postgres. Returns the fresh list. */
export async function refreshActivities(): Promise<{ activities: StravaActivity[]; fetchedAt: number }> {
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
  const activities = await fetchActivities({ after: Math.floor(yearStart) });
  const fetchedAt = Date.now();

  // Upsert each in one transaction so partial failures roll back.
  await withClient(async client => {
    await client.query('BEGIN');
    try {
      for (const a of activities) {
        const norm = normalizeActivity(a);
        await client.query(
          `INSERT INTO strava_activities (id, data, fetched_at)
           VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (id) DO UPDATE SET
             data = EXCLUDED.data,
             fetched_at = EXCLUDED.fetched_at`,
          [a.id, JSON.stringify(norm), new Date(fetchedAt).toISOString()],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });

  await setSyncState({ lastFetchedAt: new Date(fetchedAt).toISOString() });
  return { activities, fetchedAt };
}

/** Read all cached activities from Postgres as their normalized form
 *  (the shape the rest of the app uses). Includes a forced refresh if
 *  the cache is stale or empty.
 *
 *  When per-activity detail has been fetched (via the lazy fetcher in
 *  /api/strava/bests or sync), this function re-normalizes off the
 *  detail row so canonical-distance best_effort fields populate. So
 *  for a half marathon ran as 13.4 mi, the returned activity carries
 *  canonicalFinishS = 1:32:37 (chip time at exactly 13.10 mi) and
 *  canonicalDistanceMi = 13.10. For activities without detail, the
 *  canonical fields stay null and consumers fall back to movingTimeS. */
export async function getCachedActivities(): Promise<{ activities: NormalizedActivity[]; fetchedAt: number }> {
  const state = await getSyncState();
  const lastAt = state.lastFetchedAt ? Date.parse(state.lastFetchedAt) : 0;
  const stale = !lastAt || Date.now() - lastAt > TTL_MS;

  if (stale && process.env.STRAVA_REFRESH_TOKEN) {
    try {
      await refreshActivities();
    } catch (e) {
      console.error('[strava-cache] refresh failed, using stale rows:', e);
    }
  }

  const rows = await query<{ data: NormalizedActivity; detail: StravaActivity | null; fetched_at: Date }>(
    `SELECT data, detail, fetched_at FROM strava_activities ORDER BY (data->>'startLocal') DESC`,
  );
  // Re-normalize from detail when we have it, so canonical-distance
  // best_efforts surface in the listing. Falls back to the stored
  // summary normalization otherwise.
  const activities = rows.map(r => r.detail ? normalizeActivity(r.detail) : r.data);
  const fetchedAt = activities.length > 0 ? new Date(rows[0].fetched_at).getTime() : Date.now();
  return { activities, fetchedAt };
}

export async function getCacheFetchedAt(): Promise<number | null> {
  const state = await getSyncState();
  return state.lastFetchedAt ? Date.parse(state.lastFetchedAt) : null;
}

/** Read one activity's detail from cache. Returns null if the detail
 *  has not yet been pulled. */
export async function getCachedDetail(id: number): Promise<{ data: NormalizedActivity; detail: unknown | null; detailAt: Date | null } | null> {
  const rows = await query<{ data: NormalizedActivity; detail: unknown | null; detail_at: Date | null }>(
    `SELECT data, detail, detail_at FROM strava_activities WHERE id = $1`,
    [id],
  );
  return rows[0] ? { data: rows[0].data, detail: rows[0].detail, detailAt: rows[0].detail_at } : null;
}

export async function setCachedDetail(id: number, detail: unknown): Promise<void> {
  await query(
    `UPDATE strava_activities SET detail = $2::jsonb, detail_at = NOW() WHERE id = $1`,
    [id, JSON.stringify(detail)],
  );
}

/** Bookkeeping a writeback rename — caller (sync route) records the
 *  title it sent to Strava so the next sync can short-circuit.
 *  Also updates the cached `data` blob so the in-app activity list
 *  reflects the new name without waiting for the next Strava pull. */
export async function markWriteback(
  id: number,
  newName: string,
): Promise<void> {
  await query(
    `UPDATE strava_activities
     SET writeback_at = NOW(),
         writeback_name = $2,
         data = jsonb_set(data, '{name}', to_jsonb($2::text), false)
     WHERE id = $1`,
    [id, newName],
  );
}

export interface ActivitySyncMeta {
  shoe_id: number | null;
  shoe_auto_assigned_at: Date | null;
  writeback_at: Date | null;
  writeback_name: string | null;
}

/** Read the sync-meta row for one activity (writeback + shoe state).
 *  null when the activity isn't in our cache. */
export async function getActivitySyncMeta(id: number): Promise<ActivitySyncMeta | null> {
  const rows = await query<ActivitySyncMeta>(
    `SELECT shoe_id, shoe_auto_assigned_at, writeback_at, writeback_name
     FROM strava_activities WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Auto-assign a shoe to an activity. Increments the shoe's mileage by
 *  the activity's distance. Idempotent on shoe_id (caller checks that
 *  shoe_id is currently NULL before invoking — we don't overwrite a
 *  user's manual pick). */
export async function autoAssignShoe(
  activityId: number,
  shoeId: number,
  distanceMi: number,
): Promise<void> {
  await query(
    `UPDATE strava_activities
     SET shoe_id = $2, shoe_auto_assigned_at = NOW()
     WHERE id = $1`,
    [activityId, shoeId],
  );
  await query(
    `UPDATE shoes SET mileage = mileage + $1 WHERE id = $2`,
    [distanceMi, shoeId],
  );
}
