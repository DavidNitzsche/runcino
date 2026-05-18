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
import { getActivityDetail } from '@/lib/sync-strava-user';

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

  // Lazy-fetch the activity detail to extract per-mile splits.
  // splits_standard = imperial-mile splits from Strava.
  interface StravaSplit {
    split: number;
    distance: number;        // meters
    elapsed_time: number;    // seconds
    moving_time: number;
    average_speed: number;   // m/s
    average_heartrate?: number;
    elevation_difference?: number;
    pace_zone?: number;
  }
  let splits: Array<{ mile: number; paceSPerMi: number; paceDisplay: string; avgHr: number | null; elevDeltaFt: number }> = [];
  let summaryPolyline: string | null = (d as { summaryPolyline?: string | null }).summaryPolyline ?? null;
  let startLatLng: [number, number] | null = null;
  let endLatLng: [number, number] | null = null;
  try {
    const detail = await getActivityDetail(user.id, row.id);
    const detailTyped = detail as unknown as {
      splits_standard?: StravaSplit[];
      map?: { summary_polyline?: string };
      start_latlng?: [number, number];
      end_latlng?: [number, number];
    } | null;
    const std = detailTyped?.splits_standard;
    if (std && Array.isArray(std)) {
      splits = std
        // Only count splits that covered at least 0.95 of a mile. Strava
        // emits a final partial row for the last fractional mile which
        // would otherwise show as a "9th split" of 0.1 mi at slow pace.
        .filter((s) => s.distance >= 1609.344 * 0.95 && s.moving_time > 0)
        .map((s) => {
          const distMi = s.distance / 1609.344;
          const paceSPerMi = Math.round(s.moving_time / Math.max(distMi, 0.0001));
          const m = Math.floor(paceSPerMi / 60);
          const sec = paceSPerMi % 60;
          return {
            mile: s.split,
            paceSPerMi,
            paceDisplay: `${m}:${String(sec).padStart(2, '0')}`,
            avgHr: s.average_heartrate ? Math.round(s.average_heartrate) : null,
            elevDeltaFt: s.elevation_difference != null ? Math.round(s.elevation_difference * 3.28084) : 0,
          };
        });
    }
    if (detailTyped?.map?.summary_polyline) summaryPolyline = detailTyped.map.summary_polyline;
    if (detailTyped?.start_latlng && detailTyped.start_latlng.length === 2) startLatLng = detailTyped.start_latlng;
    if (detailTyped?.end_latlng && detailTyped.end_latlng.length === 2) endLatLng = detailTyped.end_latlng;
  } catch (e) {
    console.warn('[api/runs/by-date] detail fetch failed for', row.id, e);
    // Splits stay empty; the rest of the response still works
  }

  // Pull user's max HR so the modal can do %max zone math in the debrief
  const hrRows = await query<{ max_hr: number | null }>(`SELECT max_hr FROM users WHERE id = $1 LIMIT 1`, [user.id]);

  return NextResponse.json({
    ok: true,
    maxHr: hrRows[0]?.max_hr ?? null,
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
      splits,
      summaryPolyline,
      startLatLng,
      endLatLng,
    },
  });
}
