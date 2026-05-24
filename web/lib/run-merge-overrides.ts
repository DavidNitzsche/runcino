/**
 * Manual merge overrides — the user's "no, keep these separate" + "yes, merge
 * these even though they don't overlap" decisions on the auto-dedup output.
 *
 * Stored in a lazy-created table so deploys don't need a schema migration.
 * Two modes per row:
 *   - 'keep-separate' · this activity must never be folded into a canonical,
 *                        even if its start overlaps another run.
 *   - 'merge-into'    · this activity should be folded into `merge_target_id`,
 *                        even if its start doesn't overlap.
 */

import { query } from './db';
import type { KeepSeparateIds, ForceMergeMap } from './dedupe-runs';

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS run_merge_overrides (
       user_uuid       UUID NOT NULL,
       activity_id     BIGINT NOT NULL,
       mode            TEXT NOT NULL CHECK (mode IN ('keep-separate', 'merge-into')),
       merge_target_id BIGINT,
       created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (user_uuid, activity_id)
     )`,
  );
  tableEnsured = true;
}

interface Overrides {
  keepSeparate: KeepSeparateIds;
  forceMerge: ForceMergeMap;
}

/** Load all merge overrides for a user. Returns empty sets when no overrides
 *  exist (the common case — auto-dedup carries the work). */
export async function loadMergeOverrides(userId: string | undefined): Promise<Overrides> {
  if (!userId) return { keepSeparate: new Set(), forceMerge: new Map() };
  try {
    await ensureTable();
  } catch {
    return { keepSeparate: new Set(), forceMerge: new Map() };
  }
  const rows = await query<{ activity_id: string; mode: string; merge_target_id: string | null }>(
    `SELECT activity_id::text AS activity_id, mode, merge_target_id::text AS merge_target_id
       FROM run_merge_overrides
      WHERE user_uuid = $1`,
    [userId],
  ).catch(() => [] as Array<{ activity_id: string; mode: string; merge_target_id: string | null }>);
  const keepSeparate = new Set<number>();
  const forceMerge = new Map<number, number>();
  for (const r of rows) {
    const aid = Number(r.activity_id);
    if (!Number.isFinite(aid)) continue;
    if (r.mode === 'keep-separate') {
      keepSeparate.add(aid);
    } else if (r.mode === 'merge-into') {
      const tid = Number(r.merge_target_id);
      if (Number.isFinite(tid)) forceMerge.set(aid, tid);
    }
  }
  return { keepSeparate, forceMerge };
}

/** Pin a single activity as "keep separate" — the dedup grouper will never
 *  fold it into another canonical even if their start times overlap. Also
 *  strips any `mergedIntoId` flag the DB had written at ingest time, so the
 *  row immediately re-appears on /log without waiting for a re-sync. */
export async function setKeepSeparate(userId: string, activityId: number): Promise<void> {
  await ensureTable();
  await query(
    `INSERT INTO run_merge_overrides (user_uuid, activity_id, mode, merge_target_id)
     VALUES ($1, $2::BIGINT, 'keep-separate', NULL)
     ON CONFLICT (user_uuid, activity_id)
     DO UPDATE SET mode = 'keep-separate', merge_target_id = NULL, created_at = NOW()`,
    [userId, activityId],
  );
  // Surface the row back into the cache + every downstream aggregation
  // by clearing the DB-level dedup flag. Without this the row stays
  // hidden until the next Strava re-sync would re-evaluate it (and even
  // then ingest would re-merge it — the override is what stops that).
  await query(
    `UPDATE strava_activities
        SET data = data - 'mergedIntoId'
      WHERE id = $1::BIGINT
        AND (user_uuid = $2 OR user_uuid IS NULL)`,
    [activityId, userId],
  );
}

/** Pin a source activity as "merge into target" — the dedup grouper will
 *  always fold it into the target's group. Used by the multi-select Merge
 *  affordance on /log: pick a target row, mark all others to merge into it.
 *  Also writes `mergedIntoId` to the source row's data so the cache filter
 *  hides it immediately + downstream SUMs don't double-count. */
export async function setForceMerge(
  userId: string,
  sourceId: number,
  targetId: number,
): Promise<void> {
  if (sourceId === targetId) return;
  await ensureTable();
  await query(
    `INSERT INTO run_merge_overrides (user_uuid, activity_id, mode, merge_target_id)
     VALUES ($1, $2::BIGINT, 'merge-into', $3::BIGINT)
     ON CONFLICT (user_uuid, activity_id)
     DO UPDATE SET mode = 'merge-into', merge_target_id = $3::BIGINT, created_at = NOW()`,
    [userId, sourceId, targetId],
  );
  await query(
    `UPDATE strava_activities
        SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT))
      WHERE id = $2::BIGINT
        AND (user_uuid = $3 OR user_uuid IS NULL)`,
    [targetId, sourceId, userId],
  );
}

/** Clear any override on an activity (back to default auto-dedup behavior). */
export async function clearMergeOverride(userId: string, activityId: number): Promise<void> {
  await ensureTable();
  await query(
    `DELETE FROM run_merge_overrides WHERE user_uuid = $1 AND activity_id = $2::BIGINT`,
    [userId, activityId],
  );
}

/** For every canonical that has rows folded into it, returns the count of
 *  merged sources. Lets /log show a "Merged · N" badge without loading the
 *  full source rows. Cache filter excludes mergedIntoId rows, so the badge
 *  count can't come from the dedup grouper itself anymore. */
export async function countMergedSourcesByCanonical(
  userId: string | undefined,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  try {
    const rows = await query<{ canonical: string; n: string }>(
      `SELECT (data->>'mergedIntoId')::BIGINT::TEXT AS canonical, COUNT(*)::TEXT AS n
         FROM strava_activities
        WHERE ${userId ? '(user_uuid = $1 OR user_uuid IS NULL)' : 'TRUE'}
          AND data ? 'mergedIntoId'
        GROUP BY canonical`,
      userId ? [userId] : [],
    );
    for (const r of rows) {
      const c = Number(r.canonical);
      const n = Number(r.n);
      if (Number.isFinite(c) && Number.isFinite(n)) out.set(c, n);
    }
  } catch {
    /* badge is decorative — silent fallback to empty map */
  }
  return out;
}
