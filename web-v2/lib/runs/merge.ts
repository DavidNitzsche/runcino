/**
 * P27.3 — automatic run de-duplication.
 *
 * Before this, every `strava_activities` row survived independently. When
 * a single run landed via three paths (Strava webhook + HKWorkout import
 * + Faff watch-app completion), the coach saw three runs, the log
 * showed three, and weekly volume tripled. The state-loaders all
 * filter rows with `data.mergedIntoId` set — but nothing was ever
 * writing that field. This is the writer.
 *
 * Strategy:
 *   - When a new row is ingested, look at any sibling rows on the same
 *     date for the same user.
 *   - Two rows are "the same run" if they have similar start times
 *     (within 30 min) AND similar distance (within 15%).
 *   - Choose a canonical: richer source wins (strava > watch > manual >
 *     apple_health). On ties, the row with more keys/data wins.
 *   - Set `data.mergedIntoId = canonical.id` on every loser.
 *
 * Idempotent: safe to call multiple times. If everything is already
 * merged correctly, it's a no-op. If the canonical changes (e.g. a
 * richer source arrives later), we rewire mergedIntoId pointers.
 */
import { pool } from '@/lib/db/pool';

type Row = {
  id: string;
  user_uuid: string | null;
  data: any;
};

const SOURCE_RANK: Record<string, number> = {
  strava: 4,
  watch: 3,
  manual: 2,
  apple_health: 1,
  apple_watch: 3,  // alias used by /api/ingest/workout
};

function rankFor(row: Row): number {
  const src = row.data?.source ?? 'unknown';
  return SOURCE_RANK[src] ?? 0;
}

function startMs(row: Row): number {
  const s = row.data?.startLocal;
  if (!s) return 0;
  // startLocal can be "2026-05-26T18:20:51" (no Z) or with Z. Date.parse
  // handles both — the comparison is relative, so tz exact-match doesn't
  // matter as long as we use the same parser on both sides.
  return Date.parse(s) || 0;
}

function distanceMi(row: Row): number {
  return Number(row.data?.distanceMi ?? 0);
}

function richness(row: Row): number {
  // Tiebreaker for same-source rows: prefer the one with more populated
  // fields (avgHr, splits, route, etc.).
  let n = 0;
  const d = row.data ?? {};
  if (d.avgHr != null) n++;
  if (d.maxHr != null) n++;
  if (Array.isArray(d.splits) && d.splits.length > 0) n++;
  if (d.routePolyline) n++;
  if (d.avgCadence != null) n++;
  if (d.elevGainFt != null) n++;
  if (d.tempF != null) n++;
  return n;
}

/** Group rows that look like the same run. */
function clusterDuplicates(rows: Row[]): Row[][] {
  const sorted = [...rows].sort((a, b) => startMs(a) - startMs(b));
  const clusters: Row[][] = [];
  for (const row of sorted) {
    let added = false;
    for (const cluster of clusters) {
      const head = cluster[0];
      const dt = Math.abs(startMs(row) - startMs(head));
      if (dt > 30 * 60 * 1000) continue;
      const distA = distanceMi(head);
      const distB = distanceMi(row);
      // If either is 0 (e.g. a hollow watch shell), treat distance as
      // matching — start time + same date is enough signal.
      if (distA === 0 || distB === 0) {
        cluster.push(row);
        added = true;
        break;
      }
      const ratio = Math.abs(distA - distB) / Math.max(distA, distB);
      if (ratio <= 0.15) {
        cluster.push(row);
        added = true;
        break;
      }
    }
    if (!added) clusters.push([row]);
  }
  return clusters;
}

/** Within a cluster, pick the canonical row + return the rest as losers. */
function pickCanonical(cluster: Row[]): { canonical: Row; losers: Row[] } {
  const ranked = [...cluster].sort((a, b) => {
    const rankDiff = rankFor(b) - rankFor(a);
    if (rankDiff !== 0) return rankDiff;
    return richness(b) - richness(a);
  });
  return { canonical: ranked[0], losers: ranked.slice(1) };
}

/**
 * Run auto-merge for one user's recent runs.
 *
 * @param userId Postgres uuid for the runner
 * @param dateISO  YYYY-MM-DD to evaluate (PT local date). Defaults to today.
 * @returns count of rows whose mergedIntoId state changed.
 */
export async function autoMergeForDate(
  userId: string,
  dateISO?: string,
): Promise<{ changed: number; clusters: number }> {
  const date = dateISO ?? new Date().toISOString().slice(0, 10);

  const rows = (await pool.query(
    `SELECT id::text AS id, user_uuid::text AS user_uuid, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND data->>'date' = $2`,
    [userId, date],
  )).rows as Row[];

  if (rows.length < 2) return { changed: 0, clusters: rows.length };

  const clusters = clusterDuplicates(rows);
  let changed = 0;

  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const { canonical, losers } = pickCanonical(cluster);
    const canonicalId = canonical.id;

    // Clear any merged flag on the canonical itself (it might have been
    // flagged before when a richer source hadn't arrived yet).
    if (canonical.data?.mergedIntoId != null) {
      await pool.query(
        `UPDATE strava_activities
            SET data = data - 'mergedIntoId'
          WHERE id = $1::BIGINT`,
        [canonicalId],
      );
      changed++;
    }

    for (const loser of losers) {
      const current = loser.data?.mergedIntoId;
      if (String(current) === canonicalId) continue;  // already merged correctly
      await pool.query(
        `UPDATE strava_activities
            SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT))
          WHERE id = $2::BIGINT`,
        [canonicalId, loser.id],
      );
      changed++;
    }
  }

  return { changed, clusters: clusters.length };
}

/**
 * Convenience: bust merge for the latest N days (handy after Strava
 * webhook or any backfill ingest). Sequential, not parallel — these are
 * cheap and ordering doesn't matter.
 */
export async function autoMergeRecent(
  userId: string,
  days: number = 3,
): Promise<{ totalChanged: number }> {
  const today = new Date();
  let totalChanged = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateISO = d.toISOString().slice(0, 10);
    const { changed } = await autoMergeForDate(userId, dateISO);
    totalChanged += changed;
  }
  return { totalChanged };
}
