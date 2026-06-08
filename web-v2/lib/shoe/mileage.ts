/**
 * lib/shoe/mileage.ts · single-source shoe mileage, computed ON READ
 * from canonical runs. Replaces the stored `shoes.mileage` column,
 * which only updated on the run-detail PATCH path and was therefore
 * stale/fictional everywhere else (Overnight Item 16 · 0 of 7 stored
 * values matched the run sum).
 *
 * Same dedupe as the old recompute: MAX-distance row per (day, shoe)
 * defends against absorber gaps / duplicate source rows, and
 * mergedIntoId losers are excluded so a merged dupe never double-counts.
 *
 * Mirrors the doctrine the audit blessed for volume.ts / training-form.ts:
 * compute from the canonical ids on read, never store a value a second
 * writer can stale.
 *
 * v1 scope (David, baseline decision): app-tracked miles only. Pre-app
 * starting mileage is NOT seeded — 0 is honest, and the fictional seeds
 * are discarded. A manual "starting mileage" field is a logged
 * fast-follow (AUDIT-FIXES.md).
 */
import { pool } from '@/lib/db/pool';

/**
 * Map of shoe_id → tracked miles for one runner. Shoes with no assigned
 * runs are simply absent from the map (caller treats missing as 0).
 */
export async function computeShoeMileage(userId: string): Promise<Map<number, number>> {
  const rows = (await pool.query<{ shoe_id: number; total_mi: string }>(
    `WITH per_day_shoe AS (
       SELECT shoe_id,
              COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date AS d,
              MAX((data->>'distanceMi')::numeric) AS mi
         FROM runs
        WHERE user_uuid = $1
          AND shoe_id IS NOT NULL
          AND NOT (data ? 'mergedIntoId')
        GROUP BY shoe_id, 2
     )
     SELECT shoe_id, SUM(mi) AS total_mi
       FROM per_day_shoe
      GROUP BY shoe_id`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ shoe_id: number; total_mi: string }> }))).rows;

  const out = new Map<number, number>();
  for (const r of rows) {
    out.set(Number(r.shoe_id), Math.round(Number(r.total_mi) * 100) / 100);
  }
  return out;
}
