/**
 * GET /api/health/series?type=hrv&days=30
 *
 * Daily time-series for one health metric, for the iPhone metric-detail
 * trend chart (7D / 30D / 90D toggle). Reads health_samples directly.
 *
 * type, one of SAMPLE_TYPES (hrv, resting_hr, sleep_hours, vo2_max, …)
 * days, window length, clamped 1..365 (default 30)
 *
 * Response: { ok, type, days, series: [{ date: 'YYYY-MM-DD', value }] }
 *
 * Auth optional: anonymous callers (demo) have no UUID-keyed samples, so
 * they get an empty series (honest, the chart shows its no-data state).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { SAMPLE_TYPES, type HealthSampleType } from '@/lib/health-samples';

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? '';
  if (!SAMPLE_TYPES.includes(type as HealthSampleType)) {
    return NextResponse.json({ error: `type must be one of ${SAMPLE_TYPES.join(', ')}` }, { status: 400 });
  }
  const daysRaw = Number(req.nextUrl.searchParams.get('days') ?? '30');
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? Math.round(daysRaw) : 30, 1), 365);

  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: true, type, days, series: [] });

  const rows = await query<{ date: string; value: number }>(
    `SELECT sample_date::text AS date, value
       FROM health_samples
      WHERE user_id = $1
        AND sample_type = $2
        AND sample_date >= (CURRENT_DATE - ($3 || ' days')::interval)
      ORDER BY sample_date ASC`,
    [user.id, type, String(days)],
  );

  return NextResponse.json({
    ok: true,
    type,
    days,
    series: rows.map((r) => ({ date: r.date, value: Number(r.value) })),
  });
}
