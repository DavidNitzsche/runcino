/**
 * max-hr.ts · canonical effective-max-HR resolution for any user.
 *
 * Single source of truth so every downstream reader (zone math, HRR
 * percentages, run-gate, projection snapshots, race header, coach
 * engine) sees the same number for the same runner on the same day.
 *
 * Doctrine (Joel Friel / Research/03 §HRmax):
 *
 *   HRmax is a physiological ceiling that doesn't drift much
 *   year-over-year for trained runners. Use the highest verified
 *   value from a hard effort in the last 12 months. A 30-day window
 *   is too short · most runners don't max-out monthly.
 *
 * Resolution order (first non-null wins):
 *
 *   1. users.max_hr_override · explicit user setting · CAN'T be
 *      overridden by observation · user knows their physiology best.
 *
 *   2. Hybrid 12-month rolling MAX from:
 *        · health_samples.max_hr (HealthKit daily summary)
 *        · runs.data.maxHr (race / interval peak from watch + Strava)
 *      We take GREATEST · race efforts often produce higher peaks
 *      than HealthKit's daily rollup.
 *
 *   3. users.max_hr · the stored value from manual entry. Becomes
 *      the fallback for runners with no HealthKit / runs history.
 *
 *   4. null · cold start. Downstream falls back to age-derived
 *      estimate or LTHR-anchored zones.
 *
 * Generic mechanism: works for any user. No hardcoded values.
 */
import { pool } from '@/lib/db/pool';

export interface EffectiveMaxHr {
  /** The number to use everywhere. */
  bpm: number | null;
  /** Where it came from. Drives the doctrine surface ("based on your
   *  override" vs "based on observed efforts over the last year"). */
  source: 'user_override' | 'observed_12mo' | 'manual_stored' | 'unknown';
  /** When source === 'observed_12mo', which sample type produced the
   *  ceiling. Helps debug + lets the UI show "from your race on
   *  2026-04-12" eventually. */
  observedFrom: 'health_samples' | 'runs' | null;
}

/**
 * Resolve the effective max HR for a user as of today.
 *
 * @param userId UUID string
 * @param today  YYYY-MM-DD anchor for the 12-month rolling window
 */
export async function loadEffectiveMaxHr(
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<EffectiveMaxHr> {
  // 1. Override always wins.
  const overrideRow = await pool.query<{ ovr: number | string | null; stored: number | string | null }>(
    `SELECT max_hr_override AS ovr, max_hr AS stored FROM users WHERE id = $1`,
    [userId],
  ).then((r) => r.rows[0]);

  if (overrideRow?.ovr != null) {
    const bpm = Number(overrideRow.ovr);
    if (Number.isFinite(bpm) && bpm >= 100 && bpm <= 230) {
      return { bpm: Math.round(bpm), source: 'user_override', observedFrom: null };
    }
  }

  // 2. Hybrid 12-month observed max from health_samples + runs.
  //    Compute both sources independently so we know which "won."
  const [hkRow, runsRow] = await Promise.all([
    pool.query<{ value: number | string | null }>(
      `SELECT COALESCE(MAX(value::numeric), 0) AS value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'max_hr'
          AND sample_date >= ($2::date - interval '365 days')`,
      [userId, today],
    ).then((r) => r.rows[0]),
    pool.query<{ value: number | string | null }>(
      `SELECT COALESCE(MAX((data->>'maxHr')::numeric), 0) AS value FROM runs
        WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
          AND data->>'maxHr' IS NOT NULL
          AND (data->>'maxHr')::numeric BETWEEN 100 AND 230
          AND (data->>'date')::date >= ($2::date - interval '365 days')`,
      [userId, today],
    ).then((r) => r.rows[0]),
  ]);

  const hkMax = Number(hkRow?.value ?? 0);
  const runsMax = Number(runsRow?.value ?? 0);
  if (hkMax >= 100 || runsMax >= 100) {
    const observed = Math.max(hkMax, runsMax);
    const observedFrom: 'health_samples' | 'runs' = runsMax >= hkMax ? 'runs' : 'health_samples';
    return { bpm: Math.round(observed), source: 'observed_12mo', observedFrom };
  }

  // 3. Stored manual value.
  if (overrideRow?.stored != null) {
    const bpm = Number(overrideRow.stored);
    if (Number.isFinite(bpm) && bpm >= 100 && bpm <= 230) {
      return { bpm: Math.round(bpm), source: 'manual_stored', observedFrom: null };
    }
  }

  // 4. Cold start.
  return { bpm: null, source: 'unknown', observedFrom: null };
}

/**
 * Background ratchet · idempotent. Updates users.max_hr to the
 * 12-month observed ceiling so downstream reads that bypass
 * loadEffectiveMaxHr() (legacy code paths, raw SQL pulls) still see
 * a sensible recent value. Does NOT touch max_hr_override.
 *
 * Safe to call from cron · ratchets up only when observed exceeds
 * stored, so a low-effort week never drags the stored value down.
 *
 * Returns the new value if a write happened, null otherwise.
 */
export async function ratchetUsersMaxHr(
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<number | null> {
  const eff = await loadEffectiveMaxHr(userId, today);
  if (eff.source !== 'observed_12mo' || eff.bpm == null) return null;

  // GREATEST ensures we only ratchet up · never down.
  // Skip when override is set (override is sovereign).
  const r = await pool.query<{ new_max: number | string | null }>(
    `UPDATE users
        SET max_hr = GREATEST(COALESCE(max_hr, 0), $1::int)
      WHERE id = $2 AND max_hr_override IS NULL
      RETURNING max_hr AS new_max`,
    [eff.bpm, userId],
  );
  return r.rows[0]?.new_max != null ? Number(r.rows[0].new_max) : null;
}
