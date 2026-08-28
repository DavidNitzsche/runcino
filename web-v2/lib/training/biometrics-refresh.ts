/**
 * biometrics-refresh.ts · nightly snapshot of derived biometrics onto the
 * profile row, run from /api/cron/max-hr-ratchet alongside ratchetUsersMaxHr.
 *
 * WHY THESE COLUMNS EXIST AT ALL (2026-08-28): the live surfaces compute
 * every one of these fresh at read time — loadEffectiveMaxHr for the HR
 * ceiling, profile-state's health_samples AVG for RHR, the latest vo2_max
 * sample for VO2 — and those live paths remain canonical. But the profile
 * row also carries `rhr`, `hrmax_observed`, `vo2max_apple` columns that raw
 * SQL readers, admin scripts and diagnostics SELECT directly, and until this
 * module NOTHING wrote them: the primary runner had 450 resting_hr samples
 * and 58 vo2_max samples in health_samples while profile.rhr and
 * profile.vo2max_apple sat NULL forever. A snapshot column refreshed nightly
 * is honest; one that is never written is a trap. This is the same doctrine
 * as the users.max_hr ratchet (lib/training/max-hr.ts): keep the stored
 * value fresh for readers that bypass the resolver, never make it the
 * resolver.
 *
 * PRECEDENCE IS UNCHANGED: nothing here feeds pace resolution. VO2max from
 * the watch is display/reference only — race-evidence VDOT stays the pace
 * source of truth (lib/training/vdot-inputs.ts).
 */
import { pool } from '@/lib/db/pool';
import { attempt, rowOrNull, rowsOrNull } from '@/lib/db/read';

/**
 * Doctrine · Research/15-wearable-data.md ("Establishing a baseline"):
 * "Use a 7-day rolling average as the working baseline; recompute monthly."
 * Bound by `HR.rhr-rolling-baseline-window` in lib/doctrine/registry.ts.
 */
export const RHR_ROLLING_WINDOW_DAYS = 7;

/**
 * Same doctrine passage: "Minimum 14 days of data before drawing
 * conclusions." The snapshot is a working baseline, not a conclusion, so it
 * is written from the first plausible sample — but the sample count rides
 * along in the cron result so a consumer that wants the 14-day honesty gate
 * can apply it. Within the 7-day window we still require more than one
 * sample: a single reading is a data point, not an average.
 */
export const RHR_MIN_WINDOW_SAMPLES = 2;

/** Sanity band for a resting HR reading · rejects strap artefacts, not
 *  unusual runners (elite RHRs reach the mid-30s; illness can push past 90). */
export const RHR_FLOOR_BPM = 25;
export const RHR_CEILING_BPM = 120;

/**
 * Pure 7-day rolling RHR · exported for tests. `samples` are raw readings
 * (any order); values outside the sanity band are dropped BEFORE averaging —
 * one 220 bpm artefact in a 7-day mean moves it ~25 bpm, which is the whole
 * illness-signal scale of Research/15's decision table.
 */
export function rollingRestingHr(samples: Array<number | string | null | undefined>): {
  bpm: number | null;
  usedSamples: number;
} {
  const vals = samples
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n >= RHR_FLOOR_BPM && n <= RHR_CEILING_BPM);
  if (vals.length < RHR_MIN_WINDOW_SAMPLES) return { bpm: null, usedSamples: vals.length };
  const avg = vals.reduce((s, x) => s + x, 0) / vals.length;
  return { bpm: Math.round(avg), usedSamples: vals.length };
}

export interface BiometricsRefreshResult {
  rhrBpm: number | null;
  rhrSamples: number;
  vo2max: number | null;
  vo2maxRecordedAt: string | null;
  wrote: { rhr: boolean; vo2: boolean };
}

/**
 * Refresh profile.rhr (7-day rolling average of health_samples resting_hr)
 * and profile.vo2max_apple (+ vo2max_apple_updated_at · the latest Apple
 * Watch vo2_max sample). Idempotent · safe from cron.
 *
 * Writes are field-preserving (CLAUDE.md Rule 6 posture): a night with no
 * fresh data leaves the existing stored value alone rather than nulling it —
 * the column says "last known baseline", never "we looked and found nothing
 * tonight".
 */
export async function refreshProfileBiometrics(
  userId: string,
  todayArg?: string,
): Promise<BiometricsRefreshResult> {
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const today = todayArg ?? await runnerToday(userId);

  const out: BiometricsRefreshResult = {
    rhrBpm: null, rhrSamples: 0, vo2max: null, vo2maxRecordedAt: null,
    wrote: { rhr: false, vo2: false },
  };

  // ── RHR · 7-day rolling average ─────────────────────────────────────────
  // rowsOrNull: a FAILED read is null (skip the refresh, keep last snapshot),
  // an empty array is an honest "no samples this week" — the distinction
  // lib/db/read.ts exists for.
  const rhrRows = await rowsOrNull<{ value: number | string }>(
    'biometrics-refresh · resting_hr window',
    pool.query(
      `SELECT value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = 'resting_hr'
          AND sample_date >= ($2::date - interval '${RHR_ROLLING_WINDOW_DAYS} days')
          AND sample_date <= $2::date`,
      [userId, today],
    ),
  );
  if (rhrRows != null) {
    const rhr = rollingRestingHr(rhrRows.map((r) => r.value));
    out.rhrBpm = rhr.bpm;
    out.rhrSamples = rhr.usedSamples;
    if (rhr.bpm != null) {
      const w = await attempt(
        'biometrics-refresh · profile.rhr write',
        pool.query(`UPDATE profile SET rhr = $1 WHERE user_uuid = $2`, [rhr.bpm, userId]),
      );
      out.wrote.rhr = w.ok && (w.value.rowCount ?? 0) > 0;
    }
  }

  // ── VO2max · latest Apple sample, display/reference only ────────────────
  const vo2Row = await rowOrNull<{ value: number | string; recorded_at: string }>(
    'biometrics-refresh · latest vo2_max sample',
    pool.query(
      `SELECT value, recorded_at::text AS recorded_at FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'vo2_max'
        ORDER BY recorded_at DESC LIMIT 1`,
      [userId],
    ),
  );
  if (vo2Row != null) {
    const v = Number(vo2Row.value);
    // Sanity band · published VO2max range for adults is roughly 20-90
    // ml/kg/min; outside that is an ingest artefact, not a runner.
    if (Number.isFinite(v) && v >= 15 && v <= 95) {
      out.vo2max = +v.toFixed(1);
      out.vo2maxRecordedAt = vo2Row.recorded_at;
      // attempt (logged, non-fatal): the columns arrive via migration 156
      // (already present in prod, where they had been added by hand with no
      // writer) — a DB that has not applied 156 yet degrades to rhr-only
      // instead of failing the whole refresh.
      const w = await attempt(
        'biometrics-refresh · profile.vo2max_apple write',
        pool.query(
          `UPDATE profile
              SET vo2max_apple = $1, vo2max_apple_updated_at = $2::timestamptz
            WHERE user_uuid = $3`,
          [out.vo2max, vo2Row.recorded_at, userId],
        ),
      );
      out.wrote.vo2 = w.ok && (w.value.rowCount ?? 0) > 0;
    }
  }

  return out;
}
