/**
 * lib/runs/volume.ts · shared weekly-mileage computation.
 *
 * David flagged 2026-06-02: his 4-week avg was reading 32.6 mi/wk
 * when the actual was ~35.7. Root cause: drift-monitor + generator
 * + adapter all used `MAX((data->>'distanceMi'))` grouped by date,
 * which correctly catches HK+Watch duplicate-of-the-same-run pairs
 * but drops legitimate same-day doubles (AM/PM, separate lunch runs).
 *
 * Now: smart-dedup at 0.1-mi precision.
 *   · Two rows same date AND same distance (rounded to 0.1 mi) → one
 *     physical run from two sources → keep MAX
 *   · Two rows same date AND different distances → distinct runs →
 *     SUM both
 *
 * Single source of truth for ingest-side volume reads. The three
 * historical sites (drift-monitor, generate, adapt) now import this
 * instead of inlining the MAX-per-day SQL.
 *
 * Doctrine:
 *   · Research/09-volume-and-recovery.md §weekly-mileage
 *   · matches what autoMergeForDate WOULD do at write time if it
 *     consistently caught the HK+Watch pair · this is the read-side
 *     defense when the write-side dedup missed
 */

import { pool } from '@/lib/db/pool';

/**
 * Sum of last N days of running mileage with smart-dedup applied.
 * Returns total miles (not weekly average) · caller divides as needed.
 *
 * @param userUuid · runner's UUID
 * @param windowDays · how far back to look (default 28 for 4-week avg)
 */
export async function recentMileageMi(
  userUuid: string,
  windowDays: number = 28,
): Promise<number> {
  // ROUND(distanceMi, 1) buckets identical-distance rows together
  // within a day · catches the HK+Watch pairs that record identical
  // values for the same physical run. Differing-distance rows fall
  // in separate buckets · both contribute to the sum.
  const r = await pool.query<{ mi: string }>(
    `WITH dedup AS (
       SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date AS d,
              ROUND((data->>'distanceMi')::numeric, 1) AS bucket,
              MAX((data->>'distanceMi')::numeric) AS mi
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date
              >= CURRENT_DATE - $2::int
        GROUP BY 1, 2
     )
     SELECT COALESCE(SUM(mi), 0)::text AS mi FROM dedup`,
    [userUuid, windowDays],
  ).catch(() => ({ rows: [{ mi: '0' }] }));
  return Number(r.rows[0]?.mi ?? 0);
}

/**
 * Weekly average (mi/wk) over last 4 weeks · rounded to 0.1 mi.
 * Returns null when total is zero (cold-start runner).
 *
 * Used by:
 *   · lib/plan/generate.ts:recentWeeklyMileage (plan baseline)
 *   · lib/plan/drift-monitor.ts:loadCurrentWeeklyMileage (drift trigger)
 *   · lib/plan/adapt.ts (adapter's volume check)
 */
export async function recentWeeklyMileageMi(
  userUuid: string,
): Promise<number | null> {
  const total = await recentMileageMi(userUuid, 28);
  return total > 0 ? Math.round((total / 4) * 10) / 10 : null;
}
