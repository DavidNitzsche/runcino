/**
 * POST /api/ingest/workout
 *
 * Ingest a single completed workout from the iPhone (reading HKWorkout from
 * HealthKit after the watch finished it). This is the SOURCE OF TRUTH path
 * per the architectural pivot — Strava is now a destination (push), not the
 * primary source (pull).
 *
 * Body shape (mirrors what an iPhone HealthKit reader would post):
 *
 * {
 *   client_workout_id: "watch-uuid-abc123",   // HKWorkout.uuid; idempotent dedup key
 *   start_local:       "2026-05-25T07:24:39", // ISO local time
 *   date:              "2026-05-25",          // local date (PT)
 *   activity_type:     "running",
 *   distance_mi:       6.16,
 *   duration_sec:      3450,
 *   moving_sec:        3420,
 *   avg_pace_min_per_mi: "9:18",
 *   avg_hr_bpm:        133,
 *   max_hr_bpm:        149,
 *   avg_cadence_spm:   168,
 *   elev_gain_ft:      82,
 *   temp_f:            58,
 *   source:            "apple_watch",
 *   name:              "Morning easy",       // optional title
 *   splits:            [{ mile: 1, pace: "9:15", hr: 128 }, ...],
 *   hr_zone_pcts:      { z1: 78, z2: 22, z3: 0, z4: 0, z5: 0 },
 *   route_polyline:    null   // optional GPS polyline
 * }
 *
 * We dedupe on client_workout_id. Writes into strava_activities.data
 * (jsonb) so all existing readers work unchanged. Busts the briefing
 * cache so the next /today render sees the new run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCache } from '@/lib/coach/cache';
import { autoMergeForDate } from '@/lib/runs/merge';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });

  if (!body.client_workout_id) {
    return NextResponse.json({ error: 'client_workout_id required (HKWorkout.uuid)' }, { status: 400 });
  }
  if (!body.date || !body.distance_mi) {
    return NextResponse.json({ error: 'date + distance_mi required' }, { status: 400 });
  }

  const userId = body.user_id ?? DAVID_USER_ID;
  const slug = `wko_${body.client_workout_id}`;

  // Build the data payload matching the strava_activities.data shape.
  const data = {
    id: slug,                            // synthetic id (no Strava id yet)
    activityId: slug,
    client_workout_id: body.client_workout_id,
    source: body.source ?? 'apple_watch',
    name: body.name ?? 'Run',
    date: body.date,
    startLocal: body.start_local ?? `${body.date}T08:00:00`,
    distanceMi: Number(body.distance_mi),
    durationSec: Number(body.duration_sec ?? 0),
    timeMoving: body.moving_sec
      ? formatMmSs(Number(body.moving_sec))
      : (body.duration_sec ? formatMmSs(Number(body.duration_sec)) : null),
    avgPaceMinPerMi: body.avg_pace_min_per_mi ?? deriveAvgPace(body),
    avgHr: body.avg_hr_bpm ?? null,
    maxHr: body.max_hr_bpm ?? null,
    avgCadence: body.avg_cadence_spm ?? null,
    elevGainFt: body.elev_gain_ft ?? null,
    tempF: body.temp_f ?? null,
    splits: Array.isArray(body.splits) ? body.splits : [],
    hrZonePcts: body.hr_zone_pcts ?? { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    routePolyline: body.route_polyline ?? null,
    ingestedAt: new Date().toISOString(),
  };

  try {
    // Upsert on client_workout_id (idempotent: HKWorkout.uuid is stable).
    // strava_activities doesn't have a unique key on jsonb fields, so we
    // delete-then-insert under the synthetic slug to keep at most one row
    // per client_workout_id.
    await pool.query(
      `DELETE FROM strava_activities
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND data->>'client_workout_id' = $2`,
      [userId, body.client_workout_id]
    );
    await pool.query(
      `INSERT INTO strava_activities (user_uuid, data)
       VALUES ($1, $2)`,
      [userId, data]
    );

    // P27.3 — auto-merge dupes for this date. If a hollow watch row + a
    // rich HKWorkout row both exist for the same start time, this marks
    // the hollow one's data.mergedIntoId so the coach sees one run.
    try {
      await autoMergeForDate(userId, body.date);
    } catch (e: any) {
      console.error('[ingest/workout] autoMerge warn:', e?.message);
    }

    await bustBriefingCache(userId);
    return NextResponse.json({ ok: true, id: slug });
  } catch (err: any) {
    console.error('[ingest/workout] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function formatMmSs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function deriveAvgPace(b: any): string | null {
  if (!b.duration_sec || !b.distance_mi) return null;
  const sPerMi = Math.round(Number(b.duration_sec) / Number(b.distance_mi));
  return formatMmSs(sPerMi);
}
