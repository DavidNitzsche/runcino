/**
 * GET /api/health/series?kind=hrv|rhr|sleep_hours|vo2_max&days=30
 *
 * P35 — time-series biometric data for the iPhone health view + future
 * web line-chart replacement. Returns { points: [{date, value}, ...] }
 * sorted ascending. Daily values are AVG per sample_date (apple_health
 * sometimes posts multiple samples a day).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const ALLOWED_KINDS = new Set([
  'hrv', 'resting_hr', 'sleep_hours', 'vo2_max', 'max_hr',
  'body_mass', 'wrist_temp', 'respiratory_rate', 'spo2',
]);

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') ?? 'hrv';
  const days = Math.min(Number(req.nextUrl.searchParams.get('days') ?? '30'), 365);
  const userId = req.nextUrl.searchParams.get('user_id') ?? DAVID_USER_ID;
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: `kind must be one of ${[...ALLOWED_KINDS].join(', ')}` }, { status: 400 });
  }
  try {
    const r = (await pool.query(
      `SELECT sample_date::text AS date, ROUND(AVG(value)::numeric, 1) AS value
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = $2
          AND sample_date >= CURRENT_DATE - $3::int
        GROUP BY sample_date
        ORDER BY sample_date ASC`,
      [userId, kind, days],
    )).rows;
    return NextResponse.json({
      kind,
      days,
      points: r.map((row: any) => ({ date: row.date, value: Number(row.value) })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
