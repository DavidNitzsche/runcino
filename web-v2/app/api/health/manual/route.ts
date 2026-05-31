/**
 * /api/health/manual — manual entry for the health signals that
 * normally flow from Apple Health.
 *
 * Web-only users (no iOS app, no HealthKit) need a path to log sleep,
 * HRV, weight, etc. Without this, the readiness algorithm (Sleep 25% +
 * HRV 25% + RHR 20%) silently degrades for them.
 *
 * POST /api/health/manual { sample_type, value, sample_date? }
 *
 * Allowed sample_types (matches what Apple Health auto-ingests):
 *   sleep_hours, hrv, resting_hr, max_hr, body_mass, body_fat_pct,
 *   vo2_max, hr_recovery
 *
 * Writes to health_samples with source='manual' so the coach engine
 * can distinguish runner-entered from device-measured values.
 *
 * UPSERT on (user_id, sample_type, sample_date) — re-entering today's
 * value updates rather than duplicating.
 *
 * Cite: docs/SYSTEM_DOCTRINE.md §3.3 Apple Health is recommended, not
 * required. Every signal has a manual fallback (this is the writer).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const ALLOWED_SAMPLE_TYPES = new Set([
  'sleep_hours',    // 0-12 hrs
  'hrv',            // 10-200 ms
  'resting_hr',     // 30-100 bpm
  'max_hr',         // 100-230 bpm
  'body_mass',      // 30-200 kg (or lb if user_prefs.units=imperial; we accept either, no unit conversion here)
  'body_fat_pct',   // 3-50 %
  'vo2_max',        // 25-90 ml/kg/min
  'hr_recovery',    // 5-80 bpm (1-min HR drop)
]);

const SAMPLE_RANGES: Record<string, { min: number; max: number }> = {
  sleep_hours:    { min: 0,   max: 16 },
  hrv:            { min: 10,  max: 200 },
  resting_hr:     { min: 30,  max: 100 },
  max_hr:         { min: 100, max: 230 },
  body_mass:      { min: 30,  max: 200 },
  body_fat_pct:   { min: 3,   max: 50 },
  vo2_max:        { min: 25,  max: 90 },
  hr_recovery:    { min: 5,   max: 80 },
};

export async function POST(req: NextRequest) {
  const userId = await userIdFromRequest(req);
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  const sampleType = String(body.sample_type ?? '').toLowerCase();
  if (!ALLOWED_SAMPLE_TYPES.has(sampleType)) {
    return NextResponse.json({
      ok: false,
      error: `sample_type must be one of: ${[...ALLOWED_SAMPLE_TYPES].join(', ')}`,
    }, { status: 400 });
  }

  const value = Number(body.value);
  if (!isFinite(value)) {
    return NextResponse.json({ ok: false, error: 'value must be a finite number' }, { status: 400 });
  }
  const range = SAMPLE_RANGES[sampleType];
  if (range && (value < range.min || value > range.max)) {
    return NextResponse.json({
      ok: false,
      error: `${sampleType} must be between ${range.min} and ${range.max}`,
    }, { status: 400 });
  }

  const sampleDate = typeof body.sample_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.sample_date)
    ? body.sample_date
    : new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  try {
    const r = await pool.query(
      `INSERT INTO health_samples (user_id, user_uuid, sample_type, value, sample_date, source, recorded_at)
       VALUES ($1, $1, $2, $3, $4::date, 'manual', NOW())
       ON CONFLICT (user_id, sample_type, sample_date) DO UPDATE
       SET value = EXCLUDED.value, source = 'manual',
           user_uuid = COALESCE(health_samples.user_uuid, EXCLUDED.user_uuid),
           recorded_at = NOW()
       RETURNING id, sample_type, value, sample_date::text AS sample_date, source`,
      [userId, sampleType, value, sampleDate],
    );

    // Manual entries should also ratchet users.max_hr / users.resting_hr
    // when the value exceeds / averages-out the auto-ratched value. This
    // mirrors the Apple Health ingest path so the canonical ladder stays
    // consistent — manual override columns (users.*_override) are the
    // true winner; this just updates the auto column when manual lands.
    if (sampleType === 'max_hr') {
      await pool.query(
        `UPDATE users SET max_hr = GREATEST(COALESCE(max_hr, 0), $1::int)
          WHERE id = $2 AND max_hr_override IS NULL`,
        [Math.round(value), userId],
      ).catch(() => {});
    } else if (sampleType === 'resting_hr') {
      await pool.query(
        `UPDATE users SET resting_hr = LEAST(COALESCE(resting_hr, 999), $1::int)
          WHERE id = $2 AND resting_hr_override IS NULL`,
        [Math.round(value), userId],
      ).catch(() => {});
    }

    // The readiness algorithm reads these tables on every render — bust
    // the cache so the next briefing sees the new value.
    await bustBriefingCacheForEvent(userId, 'hk_signal_sample').catch(() => {});

    return NextResponse.json({ ok: true, sample: r.rows[0] });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
