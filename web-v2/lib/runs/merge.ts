/**
 * P27.3 — automatic run de-duplication (the writer).
 *
 * One physical run can land as multiple `runs` rows from different ingest
 * paths that share no id (watch keys on workoutId, HK on HKWorkout.uuid,
 * Strava on its activity id). autoMergeForDate flags the dupes: it clusters
 * a day's rows by physical-run identity, picks the canonical, sets
 * `data.mergedIntoId` on every loser, and absorbs the losers' unique fields
 * into the canonical (lib/runs/canonical.ts).
 *
 * Identity (isSameRun) + canonical selection (pickCanonical) live in
 * lib/runs/identity.ts and are the SAME logic the read-time volume reader
 * (lib/runs/volume.ts:mileageByDay) uses — so write- and read-time dedup can
 * never disagree. Idempotent.
 */
import { pool } from '@/lib/db/pool';
import { enhanceCanonicalFromAbsorbed } from '@/lib/runs/canonical';
import { clusterRuns, pickCanonical, type RunRow } from '@/lib/runs/identity';
import { mileageByDay } from '@/lib/runs/volume';

/**
 * Run auto-merge for one user's runs on a given local date.
 *
 * @param userId  Postgres uuid for the runner
 * @param dateISO YYYY-MM-DD, the runner-local date. Callers MUST pass the
 *                run's own startLocal-derived date (Fix 1) — the UTC-now
 *                default only applies when called bare.
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
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2`,
    [userId, date],
  )).rows as RunRow[];

  if (rows.length < 2) return { changed: 0, clusters: rows.length };

  const clusters = clusterRuns(rows);
  let changed = 0;

  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const { canonical, losers } = pickCanonical(cluster);
    const canonicalId = canonical.id;

    // Clear any stale merged flag on the canonical itself (it may have been
    // flagged earlier, before a better/richer source arrived — e.g. the
    // trustworthy-startLocal override now promoting it).
    if (canonical.data?.mergedIntoId != null) {
      await pool.query(`UPDATE runs SET data = data - 'mergedIntoId' WHERE id = $1::BIGINT`, [canonicalId]);
      changed++;
    }

    for (const loser of losers) {
      const alreadyMerged = String(loser.data?.mergedIntoId) === canonicalId;
      if (!alreadyMerged) {
        await pool.query(
          `UPDATE runs SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT)) WHERE id = $2::BIGINT`,
          [canonicalId, loser.id],
        );
        changed++;
      }
      // Absorb the loser's unique fields into the canonical. Idempotent;
      // a single bad row never blocks the rest of the cluster.
      try {
        if (loser.user_uuid) {
          await enhanceCanonicalFromAbsorbed({
            canonicalId,
            absorbedRow: { id: loser.id, data: loser.data ?? {}, user_uuid: loser.user_uuid },
          });
        }
      } catch (err) {
        console.warn('[merge] absorber failed for', loser.id, '→', canonicalId, err);
      }
    }
  }

  // Loud log when a >1-row day produced no merge — historically the
  // parallel-ingest race (each endpoint saw only its own row). Now rarer:
  // Fix 1 fires autoMerge on the correct startLocal-derived date from both
  // ingest paths, so both rows are present when the second one lands.
  if (rows.length >= 2 && changed === 0) {
    const sources = rows.map((r) => r.data?.source ?? '?').join(',');
    console.warn(
      `[merge] autoMergeForDate · user=${userId.slice(0, 8)} date=${date} · ` +
      `${rows.length} rows · ${clusters.length} clusters · 0 merges fired · sources=${sources}`,
    );
  }

  return { changed, clusters: clusters.length };
}

/**
 * Convenience: re-merge the latest N days (after a webhook or backfill).
 * Sequential — cheap, and ordering doesn't matter.
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
    const { changed } = await autoMergeForDate(userId, d.toISOString().slice(0, 10));
    totalChanged += changed;
  }
  return { totalChanged };
}

/**
 * Canonical mileage per day — thin wrapper over the single reader
 * (lib/runs/volume.ts:mileageByDay), kept for its existing call sites
 * (state-loader, glance-state, plan/week, onboarding/strava-history).
 * Phase B migrates those to mileageByDay directly and removes this.
 */
export async function canonicalMileageByDay(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, { mi: number; canonicalIds: string[] }>> {
  return mileageByDay(userId, fromDate, toDate);
}
