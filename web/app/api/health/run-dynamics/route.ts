/**
 * GET /api/health/run-dynamics?date=YYYY-MM-DD
 *
 * The running-form metrics for a single day, read from health_samples
 * (ingested from Apple Health by the iPhone). Used by the web run recap
 * to show per-run dynamics, the day's running average is the run's form
 * when there's one run that day, mirroring the iPhone recap's per-run read.
 *
 * Returns { dynamics: { cadence, stride_length, vertical_oscillation,
 * ground_contact_time, vertical_ratio, run_power } } with nulls for any
 * metric not synced for that date.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

const DYNAMIC_TYPES = [
  'cadence', 'stride_length', 'vertical_oscillation',
  'ground_contact_time', 'vertical_ratio', 'run_power',
] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const date = req.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) required' }, { status: 400 });
  }

  interface Row { sample_type: string; value: number }
  const rows = await query<Row>(
    `SELECT sample_type, value
       FROM health_samples
      WHERE user_id = $1 AND sample_date = $2
        AND sample_type = ANY($3)`,
    [user.id, date, [...DYNAMIC_TYPES]],
  ).catch(() => [] as Row[]);

  const map = new Map(rows.map((r) => [r.sample_type, Number(r.value)]));
  const dynamics = Object.fromEntries(
    DYNAMIC_TYPES.map((t) => [t, map.get(t) ?? null]),
  );

  return NextResponse.json({ ok: true, date, dynamics });
}
