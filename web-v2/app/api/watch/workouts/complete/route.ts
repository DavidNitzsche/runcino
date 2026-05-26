/**
 * POST /api/watch/workouts/complete
 *
 * The watch hands the phone a WatchCompletion payload via transferUserInfo;
 * the phone POSTs here. Idempotent on (workoutId) — re-POSTing the same
 * workoutId overwrites, so the watch's durable retry queue is safe.
 *
 * Persists into two tables (P21):
 *   1. coach_intents (reason='watch_completion', value=raw payload) —
 *      preserves the full per-phase breakdown for the coach's
 *      getWorkoutCompletion tool.
 *   2. strava_activities (data jsonb, source='watch') — gives all the
 *      OTHER readers (mode resolver, getRuns, run detail, log view)
 *      the same "the runner ran today" truth that Strava ingest gives.
 *      Without this, the watch could finish a run but pre-run mode
 *      would still fire on /today.
 *
 * Contract: docs/coach/WATCH_CONTRACT.md
 * Payload spec: docs/WATCH_COMPLETION_PAYLOAD.md
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCache } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body || typeof body !== 'object' || !body.workoutId) {
    return NextResponse.json({ error: 'workoutId required' }, { status: 400 });
  }

  const userId = body.user_id ?? DAVID_USER_ID;

  // ── 1. Full per-phase blob into coach_intents ──
  // The coach reads this via getWorkoutCompletion. Idempotent on
  // (user_id, reason, field) — re-POSTing the same workoutId overwrites.
  await pool.query(
    `DELETE FROM coach_intents
      WHERE user_id = $1 AND reason = 'watch_completion' AND field = $2`,
    [userId, body.workoutId]
  ).catch(() => {});
  await pool.query(
    `INSERT INTO coach_intents (user_id, reason, field, value, briefing_id)
     VALUES ($1, 'watch_completion', $2, $3, NULL)`,
    [userId, body.workoutId, JSON.stringify(body)]
  ).catch(() => {});

  // ── 2. strava_activities-shaped row so non-coach consumers see the run ──
  // Shape mirrors /api/ingest/workout — keeps a single canonical activity
  // shape across watch, Strava, HealthKit, and manual entry sources.
  const date = (body.startedAt ?? '').slice(0, 10) || todayPT();
  const startLocal = (body.startedAt ?? '').replace('Z', '').replace(/\.\d+$/, '');
  const totalSec = Number(body.totalDurationSec) || 0;
  const totalMi = Number(body.totalDistanceMi) || 0;
  const avgPace = totalSec > 0 && totalMi > 0
    ? formatPace(Math.round(totalSec / totalMi))
    : null;
  const data: any = {
    id: body.workoutId,
    activityId: body.workoutId,
    client_workout_id: body.workoutId,
    source: 'watch',
    name: 'Run',
    date,
    startLocal: startLocal || `${date}T08:00:00`,
    distanceMi: totalMi,
    durationSec: totalSec,
    timeMoving: totalSec > 0 ? formatMmSs(totalSec) : null,
    avgPaceMinPerMi: avgPace,
    avgHr: body.avgHr ?? null,
    maxHr: body.maxHr ?? null,
    avgCadence: body.avgCadence ?? null,
    splits: deriveSplitsFromPhases(body.phases),
    ingestedAt: new Date().toISOString(),
    // Reference to the full per-phase blob for any downstream consumer
    // that wants the structured detail.
    watchCompletionRef: body.workoutId,
  };
  // Idempotent: same workoutId always overwrites.
  await pool.query(
    `DELETE FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND data->>'client_workout_id' = $2`,
    [userId, body.workoutId]
  ).catch(() => {});
  await pool.query(
    `INSERT INTO strava_activities (user_uuid, data) VALUES ($1, $2)`,
    [userId, data]
  ).catch((e) => {
    console.error('[watch/complete] failed to write strava_activities row:', e);
  });

  // Event-driven cache: a workout just finished. Bust so the next /today
  // open generates a fresh post-run brief.
  await bustBriefingCache(userId);

  return NextResponse.json({
    ok: true,
    workoutId: body.workoutId,
    accepted_at: new Date().toISOString(),
    // Deploy marker — bumped when this endpoint's behavior changes.
    // Helps the audit harness detect "yes, Railway has my latest code"
    // without depending on side effects (the strava_activities INSERT
    // can silently fail; this response field can't).
    api_version: 'watch-complete/p21-1',
  });
}

// ── helpers ──

function todayPT(): string {
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

function formatMmSs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPace(secPerMi: number): string {
  const m = Math.floor(secPerMi / 60);
  const s = secPerMi % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Derive a mile-by-mile splits array from the structured WatchCompletionPhase[].
 *  Each phase becomes one "split" entry; downstream display layers may
 *  re-aggregate. */
function deriveSplitsFromPhases(phases: any[] | undefined): any[] {
  if (!Array.isArray(phases)) return [];
  return phases
    .filter((p) => p && (p.actualDistanceMi != null || p.actualDurationSec != null))
    .map((p, i) => ({
      mi: i + 1,
      label: p.label ?? p.type ?? `Phase ${i + 1}`,
      distanceMi: p.actualDistanceMi ?? null,
      durationSec: p.actualDurationSec ?? null,
      paceSecPerMi: p.actualPaceSPerMi ?? null,
      avgHr: p.avgHr ?? null,
      maxHr: p.maxHr ?? null,
      avgCadence: p.avgCadence ?? null,
      type: p.type ?? null,
      completed: p.completed ?? null,
    }));
}
