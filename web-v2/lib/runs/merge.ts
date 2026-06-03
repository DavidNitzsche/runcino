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
import { SOURCE_TIER, enhanceCanonicalFromAbsorbed } from '@/lib/runs/canonical';

type Row = {
  id: string;
  user_uuid: string | null;
  data: any;
};

// Doctrine (2026-05-31): canonical-run model ladder. Faff first, then
// HealthKit, then Strava. SOURCE_TIER is the single source of truth ·
// see lib/runs/canonical.ts. The old SOURCE_RANK that put Strava on
// top was wrong; this aligns the writer with the enhancement layer.
function rankFor(row: Row): number {
  const src = row.data?.source ?? '';
  return SOURCE_TIER[src] ?? 0;
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
      const distA = distanceMi(head);
      const distB = distanceMi(row);

      // 2026-05-27 P-DOUBLECOUNT-TIGHTER: same-day rows with nearly
      // identical distances are duplicates regardless of start time.
      // David's case: Mon shows 12.3 done in the strip vs /log's 6.2.
      // That's two ~6.15 rows. The original 30-min window missed them
      // because Faff-watch-app timestamps differ from Apple-Watch-
      // Workout timestamps (one stamps start-of-run, the other stamps
      // session-write). Real same-day doubles essentially never have
      // distances within 5% of each other.
      if (distA > 0 && distB > 0) {
        const ratio = Math.abs(distA - distB) / Math.max(distA, distB);
        if (ratio <= 0.05) {
          cluster.push(row);
          added = true;
          break;
        }
      }

      // Original rule: tight start-time window + looser distance.
      if (dt > 30 * 60 * 1000) continue;
      // Hollow shell rule (2026-06-01 · loosened from === 0 to < 0.5 mi).
      // Watch sometimes records 0.01 mi or 0.1 mi when a workout gets
      // started by accident or interrupted. These shells should
      // absorb into the real run that happened around the same time.
      if (distA < 0.5 || distB < 0.5) {
        cluster.push(row);
        added = true;
        break;
      }
      // 2026-06-01 · loosened from 15% to 20%. Strava and HK measure
      // distance differently and can disagree by up to 18% on the same
      // physical run (HR-watch overshoot, GPS recovery, treadmill drift).
      // 20% catches these without over-clustering legitimate separate
      // runs (which typically differ by > 30% or aren't within 30 min
      // of each other anyway).
      const ratio = Math.abs(distA - distB) / Math.max(distA, distB);
      if (ratio <= 0.20) {
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
       FROM runs
      WHERE user_uuid = $1
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
        `UPDATE runs
            SET data = data - 'mergedIntoId'
          WHERE id = $1::BIGINT`,
        [canonicalId],
      );
      changed++;
    }

    for (const loser of losers) {
      const current = loser.data?.mergedIntoId;
      const alreadyMerged = String(current) === canonicalId;
      if (!alreadyMerged) {
        await pool.query(
          `UPDATE runs
              SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT))
            WHERE id = $2::BIGINT`,
          [canonicalId, loser.id],
        );
        changed++;
      }

      // Inline absorption · pulls the loser's unique fields into the
      // canonical row's data + provenance per the source-tier ladder.
      // Idempotent: if this loser was already absorbed, the canonical
      // module re-stamps absorbed_into_canonical_at and writes any
      // newly-promoted fields, but the field-level enhance check
      // skips no-op tier comparisons. Wrapped in try/catch so a single
      // bad row never blocks the rest of the cluster.
      try {
        if (loser.user_uuid) {
          await enhanceCanonicalFromAbsorbed({
            canonicalId,
            absorbedRow: {
              id: loser.id,
              data: loser.data ?? {},
              user_uuid: loser.user_uuid,
            },
          });
        }
      } catch (err) {
        console.warn('[merge] absorber failed for', loser.id, '→', canonicalId, err);
      }
    }
  }

  // 2026-06-03 · loud log when autoMerge leaves a cluster un-resolved
  // (>1 row in cluster but neither got mergedIntoId set). This typically
  // means the absorber ran with only one row present and the second row
  // landed milliseconds later · race between two ingest endpoints firing
  // in parallel. Without this log, the symptom is invisible: two
  // duplicate rows sit in `runs` forever, downstream dedupes at read-
  // time and looks fine, but data hygiene rots.
  //
  // The right structural fix is hard (both endpoints must coordinate via
  // a lock or post-write hook). The loud log lets us see when it
  // happens and tighten the absorber later if it's frequent.
  if (rows.length >= 2 && changed === 0) {
    const sources = rows.map((r) => r.data?.source ?? '?').join(',');
    console.warn(
      `[merge] autoMergeForDate · user=${userId.slice(0,8)} date=${date} · ` +
      `${rows.length} rows · ${clusters.length} clusters · 0 merges fired · ` +
      `sources=${sources} · race condition? (each ingest path may have ` +
      `seen only its own row)`,
    );
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

/**
 * 2026-05-27 P-DOUBLECOUNT: defensive query-time dedupe so the
 * aggregation never trusts that mergedIntoId is correctly set. Returns
 * a map { 'YYYY-MM-DD' → { mi, canonicalIds[] } } where each day's
 * mi is the sum of CANONICAL runs (not duplicates).
 *
 * Why: the merge writer only runs from a few ingest paths. A Strava
 * webhook (or any direct row insert that bypasses the writers) can
 * leave duplicate rows un-flagged, and every downstream aggregation
 * inflates. /log displays one row per day truthfully — strip and
 * coach state were summing all un-flagged rows. David hit 31.6 done
 * vs /log's 19.6 real because Mon/Tue/Wed each had one un-merged
 * duplicate.
 *
 * Same clustering rules as autoMergeForDate, just applied at read time:
 *  - same day (the WHERE already filters)
 *  - start within 30 min
 *  - distance within 15% (or one is zero — hollow watch shell)
 *
 * Within each cluster, sum once (pick max-distance row's distance,
 * since that's the GPS-measured one most of the time). Returns a map
 * keyed by date so glance-state / state-loader can lift it directly.
 */
export async function canonicalMileageByDay(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, { mi: number; canonicalIds: string[] }>> {
  const rows = (await pool.query(
    `SELECT id::text AS id, user_uuid::text AS user_uuid, data
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3`,
    [userId, fromDate, toDate],
  )).rows as Row[];

  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const day = (r.data?.date as string)
      ?? String(r.data?.startLocal ?? '').slice(0, 10);
    if (!day) continue;
    const arr = byDay.get(day) ?? [];
    arr.push(r);
    byDay.set(day, arr);
  }

  const out = new Map<string, { mi: number; canonicalIds: string[] }>();
  for (const [day, dayRows] of byDay) {
    const clusters = clusterDuplicates(dayRows);
    let total = 0;
    const ids: string[] = [];
    for (const cluster of clusters) {
      const { canonical } = pickCanonical(cluster);
      total += distanceMi(canonical);
      ids.push(canonical.id);
    }
    out.set(day, { mi: Math.round(total * 10) / 10, canonicalIds: ids });
  }
  return out;
}
