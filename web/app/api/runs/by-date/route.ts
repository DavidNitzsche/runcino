/**
 * GET /api/runs/by-date?date=YYYY-MM-DD
 *
 * Returns the most-recent activity logged on the given date for the
 * authenticated user (or null if none). Used by the workout-detail
 * modal on /overview + /training so a past workout cell can surface
 * its actual results alongside the plan.
 *
 * If multiple activities ran the same date (e.g. two-a-day), returns
 * the one with the greatest distance — best proxy for "the main run".
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';

interface ActivityRow {
  id: string;
  data: Record<string, unknown>;
  shoe_id: number | null;
}

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const date = req.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD required' }, { status: 400 });
  }

  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data, shoe_id
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2
      ORDER BY (data->>'distanceMi')::NUMERIC DESC NULLS LAST
      LIMIT 1`,
    [user.id, date],
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ ok: true, run: null });

  const d = row.data as {
    name?: string; description?: string | null;
    startLocal?: string; date?: string;
    distanceMi?: number; movingTimeS?: number; paceSPerMi?: number;
    avgHr?: number | null; maxHr?: number | null; avgCadence?: number | null;
    elevGainFt?: number; type?: string; workoutType?: number | null;
  };

  return NextResponse.json({
    ok: true,
    run: {
      id: row.id,
      name: d.name || 'Untitled run',
      description: d.description || null,
      date: d.date || (d.startLocal || '').slice(0, 10),
      distanceMi: Number(d.distanceMi) || 0,
      movingTimeS: Number(d.movingTimeS) || 0,
      paceSPerMi: Number(d.paceSPerMi) || 0,
      avgHr: d.avgHr ? Number(d.avgHr) : null,
      maxHr: d.maxHr ? Number(d.maxHr) : null,
      avgCadence: d.avgCadence ? Number(d.avgCadence) : null,
      elevGainFt: Number(d.elevGainFt) || 0,
      type: d.type || 'Run',
      workoutType: d.workoutType ?? null,
    },
  });
}
