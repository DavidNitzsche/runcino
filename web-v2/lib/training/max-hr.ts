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

/**
 * 2026-08-25 · THE PLAUSIBILITY BAND FOR AN OBSERVED HRmax, NAMED ONCE.
 *
 * 100-230 bpm was already hardcoded four times in this file — the override
 * check, the `runs` aggregate, the stored-manual check, and the implicit
 * `>= 100` on the merged observation — and NOT AT ALL on the `health_samples`
 * aggregate, which is the branch a HealthKit import writes to. A constant
 * repeated by hand at four sites and forgotten at the fifth is how the fifth
 * happens; naming it is what makes the omission visible.
 *
 * This is a sanity band, not a doctrine claim. It says "no human running
 * outdoors has a max heart rate outside this", which is what you need to
 * reject a strap artefact. The doctrine claim in this file is the 12-month
 * window (Research/03 §HRmax), which is cited in the header and unchanged.
 *
 * The band is deliberately generous at both ends. It exists to reject
 * impossible values, not to second-guess an unusual runner.
 */
export const MAX_HR_FLOOR_BPM = 100;
export const MAX_HR_CEILING_BPM = 230;

/** True when `bpm` is a number a human heart could actually have produced. */
export function isPlausibleMaxHr(bpm: unknown): boolean {
  const n = Number(bpm);
  return Number.isFinite(n) && n >= MAX_HR_FLOOR_BPM && n <= MAX_HR_CEILING_BPM;
}

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
  todayArg?: string,
): Promise<EffectiveMaxHr> {
  // 2026-06-03 · default to runner TZ instead of server UTC.
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const today = todayArg ?? await runnerToday(userId);
  // 2026-08-21 perf · three queries per call, and a render resolves the same
  // (user, day) max-HR more than once. Request-scoped only; the returned
  // record is read-only at every call site. See lib/runtime/request-memo.ts.
  const { memo } = await import('@/lib/runtime/request-memo');
  return memo(`maxHr:${userId}:${today}`, () => resolveEffectiveMaxHr(userId, today));
}

async function resolveEffectiveMaxHr(
  userId: string,
  today: string,
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
      // 2026-08-25 · THE SAME PHYSIOLOGICAL BAND THE `runs` BRANCH BELOW HAS
      // ALWAYS HAD. This branch had none.
      //
      // Every heart-rate zone and every HR-derived pace in the app descends
      // from this number, and the ratchet that stores it is monotone UP with a
      // 365-day memory and no history row. So one absurd HealthKit `max_hr`
      // sample — a strap artefact, a cadence lock, a bad import — set the
      // runner's ceiling for a year, invisibly and irreversibly except by
      // typing an override.
      //
      // The `>= 100` check below caught garbage that was too LOW and let
      // through anything too HIGH, which is the wrong half: the ratchet only
      // moves upward, so high garbage is the only kind that sticks.
      //
      // Bounded in SQL rather than in JS on purpose. `MAX()` picks the winner
      // inside the database, so a value filtered afterwards has already won;
      // it has to be excluded before the aggregate sees it.
      //
      // Verified against prod 2026-08-25: `health_samples` does hold
      // out-of-band `max_hr` rows (81, 84, 86, 88, 90, 94, 97). All of them
      // happen to be low, so nothing has stuck yet. The guard was absent, not
      // merely untested.
      `SELECT COALESCE(MAX(value::numeric), 0) AS value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'max_hr'
          AND value::numeric BETWEEN ${MAX_HR_FLOOR_BPM} AND ${MAX_HR_CEILING_BPM}
          AND sample_date >= ($2::date - interval '365 days')`,
      [userId, today],
    ).then((r) => r.rows[0]),
    pool.query<{ value: number | string | null }>(
      `SELECT COALESCE(MAX((data->>'maxHr')::numeric), 0) AS value FROM runs
        WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
          AND data->>'maxHr' IS NOT NULL
          AND (data->>'maxHr')::numeric BETWEEN ${MAX_HR_FLOOR_BPM} AND ${MAX_HR_CEILING_BPM}
          AND (data->>'date')::date >= ($2::date - interval '365 days')`,
      [userId, today],
    ).then((r) => r.rows[0]),
  ]);

  const hkMax = Number(hkRow?.value ?? 0);
  const runsMax = Number(runsRow?.value ?? 0);
  if (hkMax >= MAX_HR_FLOOR_BPM || runsMax >= MAX_HR_FLOOR_BPM) {
    const observed = Math.max(hkMax, runsMax);
    const observedFrom: 'health_samples' | 'runs' = runsMax >= hkMax ? 'runs' : 'health_samples';
    // 2026-08-25 · belt to the SQL band's braces. Both aggregates are bounded
    // now, so this cannot fire; it is here because the number leaving this
    // function sets every HR zone the runner trains to, and "cannot fire" is
    // what was true of the `runs` branch while the `health_samples` branch
    // beside it had no bound at all.
    if (!isPlausibleMaxHr(observed)) {
      return { bpm: null, source: 'unknown', observedFrom: null };
    }
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
  todayArg?: string,
): Promise<number | null> {
  // 2026-06-03 · runner TZ default.
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const today = todayArg ?? await runnerToday(userId);
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
