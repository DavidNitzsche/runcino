/**
 * POST /api/run/manual
 *
 * Manual run entry — used when the watch/Strava sync didn't happen
 * (treadmill, indoor, forgot to start the watch). Lightweight thin
 * wrapper over /api/ingest/workout that generates the client id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { autoMergeForDate } from '@/lib/runs/merge';
import { randomBytes, createHash } from 'crypto';
import { requireUserId } from '@/lib/auth/session';
import { isSubThresholdRun, MIN_DISTANCE_MI, MIN_DURATION_SEC } from '@/lib/runs/length-guard';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  if (!body.date || !body.distance_mi) {
    return NextResponse.json({ error: 'date + distance_mi required' }, { status: 400 });
  }
  const clientId = `manual_${body.date}_${randomBytes(4).toString('hex')}`;
  const slug = `wko_${clientId}`;
  const durationSec = body.duration_min ? Math.round(Number(body.duration_min) * 60) : null;

  // 2026-06-02 · length guard. Manual entries usually have a real
  // distance, but the same tap-test risk applies if the form ever
  // accepts a 0.1mi "test" entry. See lib/runs/length-guard.ts.
  const guard = isSubThresholdRun({
    distanceMi: Number(body.distance_mi),
    durationSec: durationSec ?? 0,
  });
  if (guard.isSubThreshold) {
    console.log(`[run/manual] dropped sub-threshold entry ${clientId} · ${guard.distanceMi}mi / ${guard.durationSec}s (min ${MIN_DISTANCE_MI}mi / ${MIN_DURATION_SEC}s)`);
    return NextResponse.json({
      ok: true,
      id: slug,
      dropped: guard.reason,
      distanceMi: guard.distanceMi,
      durationSec: guard.durationSec,
    });
  }

  // F20: physiological bounds guard for manual entries.
  if (Number(body.distance_mi) > 50) {
    return NextResponse.json({ error: 'distance_mi exceeds 50 mi ceiling' }, { status: 400 });
  }
  if (body.avg_hr_bpm != null && (body.avg_hr_bpm < 30 || body.avg_hr_bpm > 230)) {
    body.avg_hr_bpm = null;
  }

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
    // Stable negative bigint id from client_workout_id so the INSERT
    // satisfies NOT NULL and re-imports stay idempotent. Same scheme as
    // /api/ingest/workout (see that file for rationale).
    const digest = createHash('sha256').update(clientId).digest();
    let n = 0n;
    for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(digest[i]);
    n = n & 0x000fffffffffffffn;
    const stableId = (-n).toString();

    await pool.query(
      `INSERT INTO runs (id, user_uuid, data)
       VALUES ($1::bigint, $2, $3)`,
      [stableId, userId, data]
    );
    // 2026-06-03 · post-write hook · calibration auto-complete on
    // manual entry. Manual rows rarely have splits, but the engine
    // falls back to whole-run avg pace.
    void (await import('@/lib/runs/post-write-hooks'))
      .afterRunWrite({ userUuid: userId, runId: String(stableId), source: 'manual' });
    // P27.3 — auto-merge: a manual entry typically backfills something
    // that wasn't captured by watch/Strava, but if it overlaps we want
    // the manual row to lose to the richer source.
    // 2026-06-01 · was silently swallowing all autoMerge errors. Log
    // them loudly so absorber failures surface in production logs.
    // Failure here doesn't block the manual write (row already inserted).
    try {
      await autoMergeForDate(userId, body.date);
    } catch (e: any) {
      console.warn('[run/manual] autoMerge failed', {
        userId, date: body.date, err: String(e?.message ?? e).slice(0, 200),
      });
    }
    await bustBriefingCacheForEvent(userId, 'run_ingest');

    // Auto-push to Strava when the runner opted in. Manual entries are
    // valid candidates · runners often hand-log a treadmill / track
    // session that didn't fire any of the watch paths, and Strava
    // tolerates an upload with no GPS as long as the TCX carries a
    // duration + sport. The helper checks profile.strava_auto_push
    // and fires in the background · idempotent on run_id.
    const { maybeAutoPush } = await import('@/lib/strava/auto-push');
    maybeAutoPush(userId, slug);

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
