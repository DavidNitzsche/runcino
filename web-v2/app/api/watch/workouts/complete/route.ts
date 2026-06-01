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
import { createHash } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { autoMergeForDate } from '@/lib/runs/merge';
import { requireUserId } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  // 2026-05-30 user-isolation fix: identity comes from the Bearer token,
  // not from body.user_id. Accepting body.user_id meant any caller could
  // write watch completions into any runner's training history.
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body || typeof body !== 'object' || !body.workoutId) {
    return NextResponse.json({ error: 'workoutId required' }, { status: 400 });
  }

  // ── 1. Full per-phase blob into coach_intents ──
  // The coach reads this via getWorkoutCompletion. Idempotent on
  // (user_id, reason, field) — re-POSTing the same workoutId overwrites.
  await pool.query(
    `DELETE FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1 AND reason = 'watch_completion' AND field = $2`,
    [userId, body.workoutId]
  ).catch(() => {});
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value, briefing_id)
     VALUES ($1, $1, 'watch_completion', $2, $3, NULL)`,
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
    // Active calories from HKLiveWorkoutBuilder (2026-06-01) ·
    // resolveCalories() tier 1 reads this and skips the estimator
    // fallback when it's present. Optional · the watch may omit it
    // on very short runs or sensor glitches, and the field is also
    // omitted by older watch builds. Doctrine:
    // designs/briefs/iphone-calories-and-absorption-brief.md.
    kcal: body.kcal ?? null,
    splits: deriveSplitsFromPhases(body.phases),
    ingestedAt: new Date().toISOString(),
    // Reference to the full per-phase blob for any downstream consumer
    // that wants the structured detail.
    watchCompletionRef: body.workoutId,
  };
  // strava_activities.id is bigint NOT NULL with no default. The legacy
  // shape uses Strava's numeric activity id; watch-side activities have
  // no Strava id, so we generate a stable bigint deterministically from
  // the workoutId. Negative numbers are reserved for synthetic sources
  // (matches the existing apple_health pattern), keeping our keyspace
  // disjoint from Strava's positive numeric ids. Idempotent: same
  // workoutId → same id, so re-POSTing overwrites.
  const stableId = -stableBigintFromString(body.workoutId);

  let stravaWriteErr: string | null = null;
  try {
    await pool.query(
      `DELETE FROM runs
        WHERE user_uuid = $1
          AND data->>'client_workout_id' = $2`,
      [userId, body.workoutId]
    );
    await pool.query(
      `INSERT INTO runs (id, user_uuid, data) VALUES ($1, $2, $3)`,
      [stableId, userId, data]
    );
  } catch (e: any) {
    stravaWriteErr = e?.message ?? String(e);
    console.error('[watch/complete] strava_activities write failed:', e);
  }

  // P27.3 — auto-merge dupes for the workout's date. Watch-completion
  // often arrives alongside a HKWorkout import for the same run; this
  // ensures only the richer row is visible to the coach + log.
  try {
    const date = body.date ?? body.dateLocal ?? new Date().toISOString().slice(0, 10);
    await autoMergeForDate(userId, date);
  } catch (e: any) {
    console.error('[watch/complete] autoMerge warn:', e?.message);
  }

  // Event-driven cache: a workout just finished. Bust only the surfaces
  // a run actually changes (today + training); /races + /profile + /health
  // don't need fresh voice for a single run. See lib/coach/regen-policy.ts.
  await bustBriefingCacheForEvent(userId, 'run_ingest');

  // Auto-push to Strava when the runner opted in. Fire-and-forget · the
  // helper checks profile.strava_auto_push internally, pushes in the
  // background, and never blocks this response. Idempotent on run_id ·
  // a re-POST of the same watch completion won't double-upload.
  const { maybeAutoPush } = await import('@/lib/strava/auto-push');
  maybeAutoPush(userId, String(stableId));

  return NextResponse.json({
    ok: true,
    workoutId: body.workoutId,
    accepted_at: new Date().toISOString(),
    // Deploy marker. Kept (small + harmless) so future audits can detect
    // when this endpoint's behavior changes without depending on side
    // effects. Bump the suffix on behavioral changes.
    api_version: 'watch-complete/p21',
    // Strava-table write outcome surfaced explicitly: harmless on
    // success, and on failure tells the watch agent + audit harnesses
    // exactly what went wrong without log access.
    strava_write: stravaWriteErr ? { ok: false, error: stravaWriteErr } : { ok: true },
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

/** Stable, positive bigint derived from a string (first 12 hex chars of
 *  SHA-1 → unsigned int, capped well under 2^48 so the negation stays
 *  inside the bigint range). Same input → same number. */
function stableBigintFromString(s: string): number {
  const hex = createHash('sha1').update(s).digest('hex').slice(0, 12);
  return parseInt(hex, 16);
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
