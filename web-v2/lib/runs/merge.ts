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
import { planMergeOps, type RunRow } from '@/lib/runs/identity';
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

  // Load ALL of the day's rows UNFILTERED (merged + unmerged). planMergeOps
  // re-derives the canonical state from physical-run identity, so it can heal a
  // day whose flags are corrupt — a circular A↔B pair, or a row orphaned by a
  // prior unstable clustering — not just flag fresh dupes.
  const rows = (await pool.query(
    `SELECT id::text AS id, user_uuid::text AS user_uuid, data
       FROM runs
      WHERE user_uuid = $1
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2`,
    [userId, date],
  )).rows as RunRow[];

  if (rows.length === 0) return { changed: 0, clusters: 0 };

  const { clears, sets, absorptions, clusters } = planMergeOps(rows);
  let changed = 0;

  // ORDER MATTERS · clear canonical/orphan flags FIRST, then point the losers.
  // A loser is therefore never set to point at a row that still points back, so
  // no circular mergedIntoId can survive a merge pass (the 2026-06-07 bug class
  // that zeroed 5 of David's days in volume.ts).
  for (const id of clears) {
    await pool.query(`UPDATE runs SET data = data - 'mergedIntoId' WHERE id = $1::BIGINT`, [id]);
    changed++;
  }
  for (const { id, canonicalId } of sets) {
    await pool.query(
      `UPDATE runs SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT)) WHERE id = $2::BIGINT`,
      [canonicalId, id],
    );
    changed++;
  }

  // Absorb each loser's unique fields into its canonical. Idempotent; a single
  // bad row never blocks the rest. Runs AFTER the flag writes so the absorber's
  // read-modify-write of the canonical sees the cleared (no-mergedIntoId) state.
  for (const { canonicalId, loserId } of absorptions) {
    const loser = rows.find((r) => r.id === loserId);
    if (!loser?.user_uuid) continue;
    try {
      await enhanceCanonicalFromAbsorbed({
        canonicalId,
        absorbedRow: { id: loser.id, data: loser.data ?? {}, user_uuid: loser.user_uuid },
      });
    } catch (err) {
      console.warn('[merge] absorber failed for', loserId, '→', canonicalId, err);
    }
  }

  // Loud log when a >1-row day produced no flag change — historically the
  // parallel-ingest race (each endpoint saw only its own row). Now rarer:
  // Fix 1 fires autoMerge on the correct startLocal-derived date from both
  // ingest paths, so both rows are present when the second one lands.
  if (rows.length >= 2 && clears.length === 0 && sets.length === 0) {
    const sources = rows.map((r) => r.data?.source ?? '?').join(',');
    console.warn(
      `[merge] autoMergeForDate · user=${userId.slice(0, 8)} date=${date} · ` +
      `${rows.length} rows · ${clusters} clusters · 0 merges fired · sources=${sources}`,
    );
  }

  return { changed, clusters };
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
