/**
 * lib/coach/strength-load.ts · convert strength sessions to
 * running-mile-equivalents so ACWR sees ALL the training stress, not
 * just the running portion.
 *
 * Why: Gabbett's acute:chronic workload ratio (Research/15 §ACWR) is
 * a TRAINING LOAD ratio, not a running-mileage ratio. As soon as a
 * runner adds strength work the running-only ACWR understates real
 * stress · the recommender ends up recommending strength on a day
 * where the body already has another high-load session queued.
 *
 * Per Research/07 §1.1-1.3, heavy compound lifting taxes the same
 * neuromuscular + endocrine systems endurance work does · CNS load,
 * cortisol response, glycogen turnover. The conversion is rough but
 * defensible · we use a fixed minute-to-mile-equivalent constant.
 *
 * The constant: 0.07 mi-equivalent per minute of strength.
 *   · 45-min compound lift     ≈ 3.15 mi-equivalent
 *   · 60-min full session      ≈ 4.20 mi-equivalent
 *   · 20-min activation/mobility ≈ 1.40 mi-equivalent
 *
 * Anchored to: 1 min strength ≈ 60% of 1 min easy running stress, at
 * a ~9 min/mi easy pace = 0.067 mi · rounded to 0.07 for clean math.
 *
 * NOT differentiated by session_type yet · all strength_sessions get
 * the same coefficient. Future: bump plyo to ~0.10, drop mobility to
 * ~0.03. Skipped for now because session_type values aren't yet
 * standardized in the table.
 */

import { pool } from '@/lib/db/pool';

/** Mile-equivalents per minute of logged strength session. */
export const STRENGTH_MI_PER_MIN = 0.07;

/**
 * Load strength sessions in [fromISO, toISO] inclusive for one user
 * and return a date → mi-equivalent map. Dates with no logged strength
 * don't appear in the map.
 *
 * Empty map on any error · ACWR callers fall back to running-only,
 * which is the current (pre-fold) behavior.
 */
export async function strengthLoadByDay(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = (await pool.query<{ d: string; dur: string }>(
    `SELECT date::text AS d, SUM(COALESCE(duration_min, 0))::text AS dur
       FROM strength_sessions
      WHERE user_uuid = $1
        AND date >= $2::date
        AND date <= $3::date
      GROUP BY date`,
    [userUuid, fromISO, toISO],
  ).catch(() => ({ rows: [] }))).rows;
  for (const r of rows) {
    const minutes = Number(r.dur ?? 0);
    if (minutes <= 0) continue;
    const miEquiv = Math.round(minutes * STRENGTH_MI_PER_MIN * 100) / 100;
    out.set(r.d, miEquiv);
  }
  return out;
}

/**
 * Sum strength mi-equivalent across a date range. Convenience for
 * ACWR sites that just need a scalar to add to acute / chronic sums.
 */
export async function strengthLoadSum(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<number> {
  const byDay = await strengthLoadByDay(userUuid, fromISO, toISO);
  let total = 0;
  for (const mi of byDay.values()) total += mi;
  return Math.round(total * 100) / 100;
}
