/**
 * POST /api/run/manual
 *
 * Manual run entry — used when the watch/Strava sync didn't happen
 * (treadmill, indoor, forgot to start the watch). Lightweight thin
 * wrapper over /api/ingest/workout that generates the client id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCache } from '@/lib/coach/cache';
import { randomBytes } from 'crypto';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  if (!body.date || !body.distance_mi) {
    return NextResponse.json({ error: 'date + distance_mi required' }, { status: 400 });
  }

  const userId = body.user_id ?? DAVID_USER_ID;
  const clientId = `manual_${body.date}_${randomBytes(4).toString('hex')}`;
  const slug = `wko_${clientId}`;
  const durationSec = body.duration_min ? Math.round(Number(body.duration_min) * 60) : null;

  const data = {
    id: slug,
    activityId: slug,
    client_workout_id: clientId,
    source: 'manual',
    name: body.name ?? 'Manual entry',
    date: body.date,
    startLocal: `${body.date}T08:00:00`,
    distanceMi: Number(body.distance_mi),
    durationSec: durationSec ?? 0,
    timeMoving: durationSec ? formatMmSs(durationSec) : null,
    avgPaceMinPerMi: (durationSec && body.distance_mi)
      ? formatMmSs(Math.round(durationSec / Number(body.distance_mi)))
      : null,
    avgHr: body.avg_hr_bpm ?? null,
    maxHr: null,
    avgCadence: null,
    elevGainFt: body.elev_gain_ft ?? null,
    tempF: null,
    splits: [],
    hrZonePcts: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    routePolyline: null,
    notes: body.notes ?? null,
    ingestedAt: new Date().toISOString(),
  };

  try {
    await pool.query(
      `INSERT INTO strava_activities (user_uuid, data) VALUES ($1, $2)`,
      [userId, data]
    );
    await bustBriefingCache(userId);
    return NextResponse.json({ ok: true, id: slug });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function formatMmSs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
