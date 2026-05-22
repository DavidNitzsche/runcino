/**
 * S6/native-bridge · watch workout completion storage + validation.
 *
 * Phase 6 of the watchOS work (docs/native/01-watchos-scoping.md
 * §6 "Workout completion → backend roundtrip").  The companion
 * endpoint POST /api/watch/workouts/complete writes here.
 *
 * This is the SIMPLER companion path, distinct from HealthKit ingest
 * (lib/health-samples.ts):
 *
 *   · /api/health/ingest   · biometric time-series (RHR, sleep, VO2max,
 *                            workout HR averages) read FROM HealthKit
 *   · /api/watch/.../complete · the structured per-interval result of
 *                            executing a watch workout · what the runner
 *                            actually ran vs. what was prescribed
 *
 * Each watch payload advertises this endpoint as its completionEndpoint
 * (lib/watch-workout.ts).  The flat phases array the watch executed
 * comes back with actuals filled in, so coaching surfaces can compare
 * prescribed vs. executed on next render.
 *
 * IDEMPOTENCY: UNIQUE(user_id, workout_id) · the HealthKit observer on
 * the iPhone can fire more than once for the same completed workout, so
 * re-POSTing the same workoutId UPSERTs rather than duplicating.
 */

import { query } from './db';

// ── Input shapes · what the route accepts ────────────────────────

export type WatchCompletionStatus = 'completed' | 'partial' | 'abandoned';

const STATUSES: readonly WatchCompletionStatus[] = ['completed', 'partial', 'abandoned'] as const;

export type WatchPhaseType = 'warmup' | 'work' | 'recovery' | 'cooldown';

const PHASE_TYPES: readonly WatchPhaseType[] = ['warmup', 'work', 'recovery', 'cooldown'] as const;

export interface WatchCompletionPhaseInput {
  /** Cursor position in the prescribed phases array. */
  index: number;
  type: string;
  label: string;
  /** Prescribed pace · echoed back from the payload for easy diffing. */
  targetPaceSPerMi?: number | null;
  /** What the runner actually averaged for this phase. */
  actualPaceSPerMi?: number | null;
  /** Actual elapsed seconds · differs from prescribed when the runner
   *  bailed early via the manual lap button. */
  actualDurationSec: number;
  avgHr?: number | null;
  /** false when the runner ended this rep early ("End interval"). */
  completed: boolean;
}

export interface WatchCompletionInput {
  /** Stable id from the GET /api/watch/today payload. */
  workoutId: string;
  startedAt: string;    // ISO 8601 datetime
  completedAt: string;  // ISO 8601 datetime
  status: string;
  totalDistanceMi?: number | null;
  totalDurationSec: number;
  avgHr?: number | null;
  maxHr?: number | null;
  phases: WatchCompletionPhaseInput[];
  source?: string;      // defaults to 'apple_watch'
}

export interface StoreCompletionResult {
  ok: boolean;
  completionId?: string;
  workoutId?: string;
  phaseCount?: number;
  error?: string;
}

// ── Plausibility bounds ──────────────────────────────────────────

const MAX_WORKOUT_SEC = 12 * 60 * 60;   // 12h · longest plausible session
const MAX_DISTANCE_MI = 200;            // ultra cap
const MAX_PHASES = 500;                 // a long interval session, with headroom
const MAX_LABEL_LEN = 200;
const HR_MIN = 30;
const HR_MAX = 230;
const PACE_MIN_S = 120;                 // 2:00/mi · faster than any human
const PACE_MAX_S = 3600;                // 60:00/mi · slow walk floor
const FUTURE_SLACK_MS = 12 * 60 * 60 * 1000;
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

// ── Validation ───────────────────────────────────────────────────

export interface ValidationError {
  reason: string;
}

function validHrOrNull(v: unknown): boolean {
  return v == null || (typeof v === 'number' && Number.isFinite(v) && v >= HR_MIN && v <= HR_MAX);
}

function validPaceOrNull(v: unknown): boolean {
  return v == null || (typeof v === 'number' && Number.isFinite(v) && v >= PACE_MIN_S && v <= PACE_MAX_S);
}

function validatePhase(p: WatchCompletionPhaseInput, i: number): ValidationError | null {
  if (!Number.isInteger(p.index) || p.index < 0) {
    return { reason: `phases[${i}].index must be a non-negative integer` };
  }
  if (typeof p.type !== 'string' || !PHASE_TYPES.includes(p.type as WatchPhaseType)) {
    return { reason: `phases[${i}].type "${p.type}" is not a valid phase type` };
  }
  if (typeof p.label !== 'string' || p.label.length === 0 || p.label.length > MAX_LABEL_LEN) {
    return { reason: `phases[${i}].label must be a non-empty string under ${MAX_LABEL_LEN} chars` };
  }
  if (typeof p.actualDurationSec !== 'number' || !Number.isFinite(p.actualDurationSec)
      || p.actualDurationSec < 0 || p.actualDurationSec > MAX_WORKOUT_SEC) {
    return { reason: `phases[${i}].actualDurationSec must be 0..${MAX_WORKOUT_SEC}` };
  }
  if (!validPaceOrNull(p.targetPaceSPerMi)) {
    return { reason: `phases[${i}].targetPaceSPerMi outside plausible range [${PACE_MIN_S}, ${PACE_MAX_S}]` };
  }
  if (!validPaceOrNull(p.actualPaceSPerMi)) {
    return { reason: `phases[${i}].actualPaceSPerMi outside plausible range [${PACE_MIN_S}, ${PACE_MAX_S}]` };
  }
  if (!validHrOrNull(p.avgHr)) {
    return { reason: `phases[${i}].avgHr outside plausible range [${HR_MIN}, ${HR_MAX}]` };
  }
  if (typeof p.completed !== 'boolean') {
    return { reason: `phases[${i}].completed must be a boolean` };
  }
  return null;
}

/**
 * Validate a completion payload.  Returns null when valid, otherwise
 * the first reason it failed.  Unlike the HealthKit batch ingest, a
 * completion is one atomic record — partial acceptance makes no sense,
 * so a single bad field rejects the whole payload.
 */
export function validateCompletion(c: WatchCompletionInput): ValidationError | null {
  if (!c.workoutId || typeof c.workoutId !== 'string' || c.workoutId.length > MAX_LABEL_LEN) {
    return { reason: 'workoutId must be a non-empty string' };
  }
  if (typeof c.status !== 'string' || !STATUSES.includes(c.status as WatchCompletionStatus)) {
    return { reason: `status must be one of ${STATUSES.join(', ')}` };
  }

  const started = Date.parse(c.startedAt);
  const completed = Date.parse(c.completedAt);
  if (!Number.isFinite(started)) return { reason: 'startedAt is not a valid ISO datetime' };
  if (!Number.isFinite(completed)) return { reason: 'completedAt is not a valid ISO datetime' };
  if (completed < started) return { reason: 'completedAt is before startedAt' };

  const now = Date.now();
  if (completed > now + FUTURE_SLACK_MS) return { reason: 'completedAt is in the future' };
  if (started < now - MAX_AGE_MS) return { reason: 'startedAt is > 365 days old' };

  if (typeof c.totalDurationSec !== 'number' || !Number.isFinite(c.totalDurationSec)
      || c.totalDurationSec <= 0 || c.totalDurationSec > MAX_WORKOUT_SEC) {
    return { reason: `totalDurationSec must be > 0 and <= ${MAX_WORKOUT_SEC}` };
  }
  if (c.totalDistanceMi != null
      && (typeof c.totalDistanceMi !== 'number' || !Number.isFinite(c.totalDistanceMi)
          || c.totalDistanceMi < 0 || c.totalDistanceMi > MAX_DISTANCE_MI)) {
    return { reason: `totalDistanceMi must be 0..${MAX_DISTANCE_MI}` };
  }
  if (!validHrOrNull(c.avgHr)) {
    return { reason: `avgHr outside plausible range [${HR_MIN}, ${HR_MAX}]` };
  }
  if (!validHrOrNull(c.maxHr)) {
    return { reason: `maxHr outside plausible range [${HR_MIN}, ${HR_MAX}]` };
  }

  if (!Array.isArray(c.phases) || c.phases.length === 0) {
    return { reason: 'phases must be a non-empty array' };
  }
  if (c.phases.length > MAX_PHASES) {
    return { reason: `phases array too large (>${MAX_PHASES})` };
  }
  for (let i = 0; i < c.phases.length; i++) {
    const err = validatePhase(c.phases[i], i);
    if (err) return err;
  }

  return null;
}

// ── Storage ──────────────────────────────────────────────────────

/**
 * Store (or overwrite) a single workout completion for a user.
 * Idempotent on (user_id, workout_id).
 */
export async function storeCompletion(
  userId: string,
  completion: WatchCompletionInput,
): Promise<StoreCompletionResult> {
  const validation = validateCompletion(completion);
  if (validation) {
    return { ok: false, error: validation.reason };
  }

  const source = completion.source && typeof completion.source === 'string'
    ? completion.source
    : 'apple_watch';

  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO workout_completions
         (user_id, workout_id, status, started_at, completed_at,
          total_distance_mi, total_duration_sec, avg_hr, max_hr, phases, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id, workout_id)
       DO UPDATE SET status             = EXCLUDED.status,
                     started_at         = EXCLUDED.started_at,
                     completed_at       = EXCLUDED.completed_at,
                     total_distance_mi  = EXCLUDED.total_distance_mi,
                     total_duration_sec = EXCLUDED.total_duration_sec,
                     avg_hr             = EXCLUDED.avg_hr,
                     max_hr             = EXCLUDED.max_hr,
                     phases             = EXCLUDED.phases,
                     source             = EXCLUDED.source,
                     recorded_at        = NOW()
       RETURNING id`,
      [
        userId,
        completion.workoutId,
        completion.status,
        new Date(completion.startedAt).toISOString(),
        new Date(completion.completedAt).toISOString(),
        completion.totalDistanceMi ?? null,
        Math.round(completion.totalDurationSec),
        completion.avgHr != null ? Math.round(completion.avgHr) : null,
        completion.maxHr != null ? Math.round(completion.maxHr) : null,
        JSON.stringify(completion.phases),
        source,
      ],
    );

    // Also surface the run as a FIRST-CLASS activity so it shows everywhere
    // the app lists runs (overview recap, log, week strip, mileage, recap) —
    // not just in "done" detection. A faff-watch run never reaches Strava,
    // so without this it's invisible. Non-fatal: a failure here must never
    // break the completion store above.
    try {
      await upsertWatchRunActivity(userId, completion);
    } catch { /* best-effort — completion is already saved */ }

    return {
      ok: true,
      completionId: rows[0]?.id,
      workoutId: completion.workoutId,
      phaseCount: completion.phases.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'database error',
    };
  }
}

/** Stable, deterministic negative BIGINT from a string. Strava activity ids
 *  are positive, so a negative id can never collide with a real Strava row.
 *  Keyed on userId:workoutId so it's unique per user + idempotent on re-POST. */
function syntheticRunId(userId: string, workoutId: string): number {
  const s = `${userId}:${workoutId}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return -(Math.abs(h) + 1); // negative → outside Strava's positive id space
}

/** Minimal shape needed to surface a completion as a run — satisfied by both
 *  WatchCompletionInput (live POST) and a workout_completions DB row (backfill). */
interface WatchRunFields {
  workoutId: string;
  status: string;
  startedAt: string;
  totalDistanceMi?: number | null;
  totalDurationSec: number;
  avgHr?: number | null;
  maxHr?: number | null;
}

/** Write (or refresh) a strava_activities row representing a watch-recorded
 *  run, so the canonical runs table the whole app reads includes it. Only
 *  for real runs (completed/partial with a positive distance). */
async function upsertWatchRunActivity(userId: string, c: WatchRunFields): Promise<void> {
  if (c.status !== 'completed' && c.status !== 'partial') return;
  const distanceMi = c.totalDistanceMi ?? 0;
  if (!(distanceMi > 0)) return; // no distance → not a meaningful run card

  const datePrefix = /^(\d{4}-\d{2}-\d{2})/.exec(c.workoutId)?.[1];
  const date = datePrefix ?? new Date(c.startedAt).toISOString().slice(0, 10);
  const durationS = Math.round(c.totalDurationSec);
  const paceSPerMi = distanceMi > 0 && durationS > 0 ? Math.round(durationS / distanceMi) : null;
  // Type hint from the workoutId slug (e.g. "2026-05-20-threshold") so a
  // recorded quality session isn't mislabeled easy; default easy otherwise.
  const slug = /^\d{4}-\d{2}-\d{2}-(.+)$/.exec(c.workoutId)?.[1]?.toLowerCase() ?? '';
  const type = /thresh|tempo|interval|vo2|quality|speed|rep/.test(slug) ? 'threshold'
    : /long/.test(slug) ? 'long'
    : /race/.test(slug) ? 'race'
    : 'easy';

  const data = {
    date,
    startLocal: new Date(c.startedAt).toISOString(),
    name: 'Watch run',
    distanceMi: Math.round(distanceMi * 100) / 100,
    movingTimeS: durationS,
    paceSPerMi,
    avgHr: c.avgHr != null ? Math.round(c.avgHr) : null,
    maxHr: c.maxHr != null ? Math.round(c.maxHr) : null,
    workoutType: 0,
    type,
    source: 'watch',
  };

  await query(
    `INSERT INTO strava_activities (id, user_uuid, data)
       VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [syntheticRunId(userId, c.workoutId), userId, JSON.stringify(data)],
  );
}

/**
 * Backfill: surface any already-stored watch completions as run rows. Runs
 * are idempotent upserts, so this is safe to call on a normal page/API load —
 * it catches completions that synced BEFORE the surfacing logic existed (or
 * before it deployed). Scoped to the recent window to stay cheap.
 */
export async function backfillWatchRunsAsActivities(userId: string, sinceDays = 60): Promise<void> {
  try {
    const sinceIso = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
    const rows = await query<{
      workout_id: string; status: string; started_at: string;
      total_distance_mi: string | null; total_duration_sec: string | number;
      avg_hr: string | number | null; max_hr: string | number | null;
    }>(
      `SELECT workout_id, status, started_at::text AS started_at,
              total_distance_mi, total_duration_sec, avg_hr, max_hr
         FROM workout_completions
        WHERE user_id = $1
          AND status IN ('completed','partial')
          AND total_distance_mi IS NOT NULL AND total_distance_mi > 0
          AND completed_at >= $2`,
      [userId, sinceIso + 'T00:00:00Z'],
    );
    for (const r of rows) {
      await upsertWatchRunActivity(userId, {
        workoutId: r.workout_id,
        status: r.status,
        startedAt: r.started_at,
        totalDistanceMi: r.total_distance_mi != null ? Number(r.total_distance_mi) : null,
        totalDurationSec: Number(r.total_duration_sec) || 0,
        avgHr: r.avg_hr != null ? Number(r.avg_hr) : null,
        maxHr: r.max_hr != null ? Number(r.max_hr) : null,
      });
    }
  } catch { /* best-effort — never block the caller */ }
}
