/**
 * Strava push — upload a Faff run TO Strava.
 *
 * Flow:
 *   1. Read the run row from strava_activities (data jsonb).
 *   2. Build a TCX file (lap-aware when phases exist).
 *   3. POST to Strava /api/v3/uploads (multipart).
 *   4. Persist a strava_pushes row with status='pending' + upload_id.
 *   5. Optionally poll /api/v3/uploads/{id} for terminal state.
 *
 * Auto-push hook: /api/ingest/workout calls pushRunToStrava() at the end
 * when profile.strava_auto_push = TRUE.
 *
 * Manual push: /api/strava/push/[runId] calls this on user click.
 */
import { pool } from '@/lib/db/pool';
import { getStravaToken } from './auth';
import { buildTcx } from './build-tcx';
import { deriveRecap, type RecapPayload } from '@/lib/coach/run-recap';
import type { WorkoutType, Phase } from '@/lib/coach/run-purpose';
import { toUtcIso as resolveStartUtc } from '@/lib/runs/normalize-time';
import { enqueueNotification } from '@/lib/notifications/enqueue';
import { renderStravaReconnect } from '@/lib/notifications/templates';

interface PushOptions {
  /** When true, mark the activity as a race on Strava. */
  isRace?: boolean;
  /** Per-push privacy override; falls back to profile.strava_push_privacy. */
  privacy?: 'private' | 'followers' | 'public';
  /** Per-push title override; falls back to template from profile.strava_push_title_format. */
  title?: string;
  /** Description text. We always append "via Faff" footer. */
  description?: string;
}

export interface PushResult {
  pushId: number;
  status: 'uploaded' | 'pending' | 'failed' | 'duplicate';
  stravaActivityId?: number;
  stravaUploadId?: number;
  error?: string;
}

/**
 * Push a single run to Strava. Idempotent on run_id: if a prior push
 * for this run succeeded, returns the prior result without re-uploading.
 */
export async function pushRunToStrava(
  userId: string,
  runId: string,
  opts: PushOptions = {}
): Promise<PushResult> {
  // 1. Idempotency: skip if already uploaded successfully.
  const prior = (await pool.query(
    `SELECT id, status, strava_activity_id
       FROM strava_pushes
      WHERE user_uuid = $1 AND run_id = $2 AND status = 'uploaded'
      ORDER BY pushed_at DESC LIMIT 1`,
    [userId, runId]
  )).rows[0];
  if (prior) {
    return {
      pushId: prior.id,
      status: 'uploaded',
      stravaActivityId: prior.strava_activity_id,
    };
  }

  // 2. Load run + profile prefs.
  let runRow = (await pool.query(
    `SELECT data FROM runs
      WHERE user_uuid = $1
        AND (data->>'id' = $2 OR data->>'activityId' = $2)
      LIMIT 1`,
    [userId, runId]
  )).rows[0];
  // Fallback: legacy strava_pushes rows used a user_uuid-YYYY-MM-DD format
  // that doesn't match the run's actual data->>'id'. Look up by date so
  // Sweep-3 retries can resolve these without a DB migration.
  if (!runRow?.data && runId.startsWith(userId + '-')) {
    const dateSuffix = runId.slice(userId.length + 1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateSuffix)) {
      runRow = (await pool.query(
        `SELECT data FROM runs
          WHERE user_uuid = $1
            AND data->>'date' = $2
            AND (data->>'mergedIntoId') IS NULL
            AND absorbed_into_canonical_at IS NULL
          LIMIT 1`,
        [userId, dateSuffix],
      )).rows[0];
    }
  }
  if (!runRow?.data) {
    return { pushId: -1, status: 'failed', error: 'run not found' };
  }
  const run = runRow.data;

  // P21 — if this run was merged into another, skip; the canonical one
  // is what should push.
  if (run.mergedIntoId) {
    return { pushId: -1, status: 'failed', error: 'merged run, skip push' };
  }

  const prefs = (await pool.query(
    `SELECT strava_push_privacy, strava_push_title_format
       FROM profile WHERE user_uuid = $1`,
    [userId]
  )).rows[0];

  // Resolve workout type + the prescribed spec (target pace + rep count) for
  // the title and the recap-voice description. Watch ingest doesn't stamp
  // data.type, so fall back to the planned workout for this date.
  let runType: string | null = run.type ?? null;
  let planSpec: any = null;
  if (run.date) {
    const planRow = (await pool.query(
      `SELECT pw.type, pw.workout_spec FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL AND pw.date_iso = $2 LIMIT 1`,
      [userId, run.date],
    )).rows[0];
    runType = runType ?? planRow?.type ?? null;
    planSpec = planRow?.workout_spec ?? null;
  }

  // 3. Build title + description. Description reuses the in-app recap engine
  //    so Strava gets the same coach-voice read ("All 4 in range, 6:45 avg.
  //    Went out a touch fast, then settled.") instead of a bare distance line.
  const recap = buildRunRecap(run, runType, planSpec);
  const title = opts.title ?? titleFor({ ...run, type: runType ?? run.type }, prefs?.strava_push_title_format ?? 'type_phases');
  const description = opts.description ?? stravaDescription(recap, run);
  const privacy = opts.privacy ?? prefs?.strava_push_privacy ?? 'private';

  // 4. Build TCX.
  const tcx = buildTcx({
    runId,
    // tz-correct UTC via the canonical normalize-time helper (watch rows
    // store startLocal as local wall time without an offset). build-tcx's
    // own toUtcIso then round-trips this Z-marked string unchanged.
    startLocalIso: resolveStartUtc(run.startLocal, run.source, run.timezone)
      ?? run.startLocal ?? `${run.date}T08:00:00`,
    durationSec: Number(run.durationSec ?? run.movingSec ?? 0),
    distanceMi: Number(run.distanceMi ?? 0),
    avgHr: run.avgHr ?? null,
    maxHr: run.maxHr ?? null,
    avgCadenceSpm: run.avgCadence ?? null,
    routePolyline: run.routePolyline ?? null,
    elevGainFt: run.elevGainFt ?? null,
    splits: normalizeSplits(run.splits),
    phases: extractPhasesForTcx(run),
  });

  // 5. Insert pending push row before the network call so failure modes
  //    are observable in /usage and the connection card.
  const inserted = (await pool.query(
    `INSERT INTO strava_pushes (user_uuid, run_id, status, title, privacy)
     VALUES ($1, $2, 'pending', $3, $4)
     RETURNING id`,
    [userId, runId, title, privacy]
  )).rows[0];
  const pushId: number = inserted.id;

  // 6. POST to Strava /uploads (multipart).
  let token: string;
  try {
    token = await getStravaToken(userId);
  } catch (e: any) {
    await markFailed(pushId, e?.message ?? 'auth failed');
    return { pushId, status: 'failed', error: e?.message };
  }

  let uploadId: number;
  try {
    const form = new FormData();
    form.append('file', new Blob([tcx], { type: 'application/xml' }), `faff-${runId}.tcx`);
    form.append('data_type', 'tcx');
    form.append('name', title);
    form.append('description', description);
    form.append('trainer', 'false');
    form.append('commute', 'false');
    form.append('sport_type', opts.isRace ? 'Run' : 'Run');
    // private/visibility — Strava maps "private" → activity_visibility=only_me etc.
    // For now we leave default and set via PUT after upload (cheaper than embedding here).

    const resp = await fetch('https://www.strava.com/api/v3/uploads', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      // 409 = duplicate — Strava already has this activity from a different
      // source (manual entry or another app). Mark accordingly so we don't
      // retry.
      if (resp.status === 409 || txt.toLowerCase().includes('duplicate')) {
        await pool.query(
          `UPDATE strava_pushes SET status = 'duplicate', completed_at = NOW(), error_message = $1
            WHERE id = $2`,
          [txt.slice(0, 500), pushId]
        );
        return { pushId, status: 'duplicate' };
      }
      // 2026-05-27 P-STRAVA-401: 401 from Strava /uploads almost always
      // means the OAuth grant lacks `activity:write` (legacy grant from
      // before that scope was added) OR the user has revoked the app.
      // Either way, the fix is the same: re-OAuth. Surface a typed
      // error code so the UI can render "Reconnect Strava" instead of
      // an opaque "401". Also mark the connector_tokens row as needing
      // reconnect so the connection card on /settings reflects truth.
      if (resp.status === 401) {
        await markFailed(pushId, `401 (likely missing activity:write scope): ${txt.slice(0, 400)}`);
        await flagReauth(userId);
        return { pushId, status: 'failed', error: 'REAUTH_REQUIRED' };
      }
      await markFailed(pushId, `${resp.status}: ${txt.slice(0, 500)}`);
      return { pushId, status: 'failed', error: `${resp.status}` };
    }
    const upload: any = await resp.json();
    uploadId = upload.id;

    await pool.query(
      `UPDATE strava_pushes SET strava_upload_id = $1 WHERE id = $2`,
      [uploadId, pushId]
    );
  } catch (e: any) {
    await markFailed(pushId, e?.message ?? 'upload failed');
    return { pushId, status: 'failed', error: e?.message };
  }

  // 7. Resolve once now. Strava processes async; it's usually still
  //    pending 2s after upload. If so, the GET /api/strava/push/[runId]
  //    re-poll and the strava-push-poll cron finish it. resolvePendingPush
  //    writes the terminal row + applies RPE on success — one shared path
  //    for the inline poll, the GET re-poll, and the cron backstop.
  await new Promise((r) => setTimeout(r, 2000));
  const resolved = await resolvePendingPush(userId, { id: pushId, run_id: runId, strava_upload_id: uploadId });
  return resolved.status === 'pending'
    ? { pushId, status: 'pending', stravaUploadId: uploadId }
    : resolved;
}

async function markFailed(pushId: number, message: string) {
  await pool.query(
    `UPDATE strava_pushes SET status = 'failed', error_message = $1, completed_at = NOW()
      WHERE id = $2`,
    [message.slice(0, 500), pushId]
  ).catch(() => {});
}

/**
 * Resolve a pending push: poll Strava /uploads/{id} once and write the
 * terminal state. Shared by (a) the inline poll right after upload,
 * (b) the GET /api/strava/push/[runId] re-poll, (c) the strava-push-poll
 * cron backstop.
 *
 * Terminal transitions:
 *   activity_id present        → 'uploaded' (+ apply RPE via PUT)
 *   error mentions 'duplicate' → 'duplicate'
 *   error present              → 'failed'   (Strava's actual message)
 *   still processing           → stays 'pending' (caller re-polls later)
 *
 * Transient conditions (token blip, network, non-terminal HTTP) leave the
 * row 'pending' so the next pass retries; only a real Strava verdict (or a
 * 401 / 404-expired) writes a terminal row.
 */
export async function resolvePendingPush(
  userId: string,
  push: { id: number; run_id: string; strava_upload_id: number | string | null },
): Promise<PushResult> {
  const pushId = push.id;
  if (!push.strava_upload_id) return { pushId, status: 'pending' };

  let token: string;
  try {
    token = await getStravaToken(userId);
  } catch (e: any) {
    // Transient token error — leave pending for the next pass.
    return { pushId, status: 'pending', error: e?.message };
  }

  let j: any;
  try {
    const resp = await fetch(`https://www.strava.com/api/v3/uploads/${push.strava_upload_id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.status === 401) {
      await markFailed(pushId, '401 on upload status (missing activity:write or revoked)');
      await flagReauth(userId);
      return { pushId, status: 'failed', error: 'REAUTH_REQUIRED' };
    }
    if (resp.status === 404) {
      // Strava no longer retains this upload id (expired before it
      // resolved). Terminal — stop polling a dead id.
      await markFailed(pushId, 'upload id no longer found on Strava (expired before it resolved)');
      return { pushId, status: 'failed', error: 'upload expired' };
    }
    if (!resp.ok) return { pushId, status: 'pending' }; // transient — retry next pass
    j = await resp.json();
  } catch {
    return { pushId, status: 'pending' }; // network blip — retry next pass
  }

  if (j.activity_id) {
    await pool.query(
      `UPDATE strava_pushes SET status = 'uploaded', strava_activity_id = $1, completed_at = NOW(), error_message = NULL
        WHERE id = $2`,
      [j.activity_id, pushId]
    );
    // RPE rides up on success — best-effort, never fails the push.
    await applyRpeToStrava(userId, push.run_id, j.activity_id, token).catch(() => {});
    return { pushId, status: 'uploaded', stravaActivityId: j.activity_id };
  }

  const err: string = typeof j.error === 'string' ? j.error : '';
  if (err) {
    if (/duplicate/i.test(err)) {
      await pool.query(
        `UPDATE strava_pushes SET status = 'duplicate', completed_at = NOW(), error_message = $1 WHERE id = $2`,
        [err.slice(0, 500), pushId]
      );
      return { pushId, status: 'duplicate' };
    }
    await markFailed(pushId, err);
    return { pushId, status: 'failed', error: err };
  }

  return { pushId, status: 'pending' }; // still processing
}

/**
 * After a push resolves to an activity, push the runner's logged RPE up to
 * Strava (perceived_exertion 1-10, Borg CR10). Best-effort — a failed PUT
 * never fails the push. Only fires when an RPE row exists for the run.
 */
async function applyRpeToStrava(
  userId: string,
  runId: string,
  stravaActivityId: number,
  token: string,
): Promise<void> {
  const row = (await pool.query(
    `SELECT rpe FROM post_run_rpe
      WHERE (user_uuid = $1 OR user_id::text = $1::text) AND activity_id = $2
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId, runId],
  )).rows[0];
  const rpe = row?.rpe == null ? null : Number(row.rpe);
  if (!rpe || rpe < 1 || rpe > 10) return;
  await fetch(`https://www.strava.com/api/v3/activities/${stravaActivityId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ perceived_exertion: rpe, prefer_perceived_exertion: true }),
    signal: AbortSignal.timeout(8000),
  });
}

/**
 * Mark the connector_tokens row as needing reconnect (so the connection
 * card on /profile reflects truth) and fire the gated reconnect push.
 * Shared by the upload-time 401 and the resolve-time 401.
 */
async function flagReauth(userId: string): Promise<void> {
  await pool.query(
    `UPDATE connector_tokens
        SET last_sync_status = 'error',
            last_sync_error  = 'PUSH_401_REAUTH_REQUIRED',
            user_uuid        = COALESCE(user_uuid, $1),
            updated_at       = NOW()
      WHERE COALESCE(user_uuid, user_id) = $1 AND provider = 'strava'`,
    [userId]
  ).catch(() => {});
  // Notifications v1 §G — fire the reconnect push on the 3rd consecutive
  // 401. Counted off the latest failed strava_pushes rows. Anything less
  // than 3 avoids a transient-flake notification. The dedup key is per-day
  // so the runner gets at most one per 24h (deck §G RATE LIMIT).
  await maybeFireStravaReconnect(userId);
}

/**
 * Generate a Strava-style title from the run + the user's preferred template.
 * Templates:
 *   type_phases   → "Threshold · 4×1mi @ 6:48"
 *   tod_type_dist → "Morning easy · 5.2 mi"
 *   custom        → reserved for future user-provided string
 */
function titleFor(run: any, _template: string): string {
  const type = (run.type ?? 'run').toLowerCase();
  const phases: any[] = Array.isArray(run.phases) ? run.phases : [];
  const work = phases.filter((p) => String(p.type) === 'work');
  const dist = Number(run.distanceMi ?? 0);
  const distStr = dist > 0 ? (dist % 1 === 0 ? dist.toFixed(0) : dist.toFixed(1)) : null;

  if (type === 'race') return 'Race';
  if (type === 'intervals' || type === 'threshold' || type === 'quality') {
    if (work.length >= 2) {
      const repMi = Number(work[0]?.actualDistanceMi ?? 0);
      const repStr = repMi <= 0 ? null
        : repMi < 1 ? `${Math.round((repMi * 1609) / 100) * 100}m`
        : `${repMi % 1 === 0 ? repMi.toFixed(0) : repMi.toFixed(1)}mi`;
      return repStr ? `Intervals · ${work.length}×${repStr}` : `Intervals · ${work.length} reps`;
    }
    return 'Intervals';
  }
  if (type === 'tempo') {
    const wMi = work.reduce((s, p) => s + (Number(p.actualDistanceMi) || 0), 0);
    return wMi > 0 ? `Tempo · ${wMi % 1 === 0 ? wMi.toFixed(0) : wMi.toFixed(1)}mi` : 'Tempo';
  }
  if (type === 'long') return distStr ? `Long run · ${distStr}mi` : 'Long run';
  if (type === 'recovery') return distStr ? `Recovery · ${distStr}mi` : 'Recovery';

  // Easy / generic
  const hour = run.startLocal ? new Date(run.startLocal).getHours() : 9;
  if (type === 'easy' || type === 'run') {
    return distStr ? `Easy · ${distStr}mi` : (hour < 11 ? 'Easy morning run' : 'Easy run');
  }
  return distStr ? `${cap(type)} · ${distStr}mi` : cap(type);
}

/**
 * Build the run's recap (verdict + facts) by feeding the run + plan spec
 * into the SAME deriveRecap engine the in-app HOW IT WENT uses — so Strava
 * speaks the same voice. Rep paces are derived from the run's work phases
 * (duration ÷ distance); the target + rep count come from the plan spec.
 */
function buildRunRecap(run: any, runType: string | null, planSpec: any): RecapPayload {
  const phases: any[] = Array.isArray(run.phases) ? run.phases : [];
  const workPhases = phases.filter((p) => String(p.type) === 'work');
  const repPaces = workPhases
    .map((p) => {
      const d = Number(p.actualDistanceMi);
      const t = Number(p.actualDurationSec);
      return d > 0 && t > 0 ? Math.round(t / d) : 0;
    })
    .filter((n) => n > 0);
  const workPaceSPerMi = repPaces.length
    ? Math.round(repPaces.reduce((a, b) => a + b, 0) / repPaces.length)
    : null;
  const target = planSpec
    ? Number(planSpec.rep_pace_s_per_mi) || Number(planSpec.tempo_pace_s_per_mi) || Number(planSpec.pace_target_s_per_mi) || null
    : null;
  const prescribedRepCount = planSpec ? Number(planSpec.rep_count) || null : null;
  const w = run.weather;
  const weather = w
    ? {
        tempF: Number(w.temp_f) || Number(run.tempF) || null,
        tempF_start: Number(w.temp_f_start) || null,
        tempF_end: Number(w.temp_f_end) || null,
        tempF_peak: Number(w.temp_f_peak) || null,
        humidityPct: Number(w.humidity_pct) || null,
        windMph: Number(w.wind_mph) || null,
        conditions: typeof w.conditions === 'string' ? w.conditions : null,
        cloudCoverPct: Number(w.cloud_cover_pct) || null,
        durationS: Number(run.durationSec) || null,
      }
    : null;
  const dMi = Number(run.distanceMi) || 0;
  const actualPaceSPerMi = Number(run.paceSPerMi)
    || (dMi > 0 && Number(run.durationSec) > 0 ? Math.round(Number(run.durationSec) / dMi) : null);
  // Light type normalize · quality → intervals; everything else passes through.
  const t = (runType ?? 'unplanned').toLowerCase();
  const normType = (t === 'quality' ? 'intervals' : t) as WorkoutType;
  return deriveRecap({
    type: normType,
    phase: null as Phase | null,
    plannedMi: dMi,
    plannedPaceSPerMi: target,
    plannedHrCap: null,
    actualMi: dMi,
    actualPaceSPerMi,
    workPaceSPerMi,
    repCount: workPhases.length || null,
    repPaces,
    prescribedRepCount,
    actualAvgHr: Number(run.avgHr) || null,
    actualMaxHr: Number(run.maxHr) || null,
    splits: Array.isArray(run.splits) ? run.splits : undefined,
    weather: weather as any,
  });
}

/**
 * Compose the Strava description from the recap · the result + the read,
 * tightened for a public caption: take the lead + pattern facts and drop
 * the in-app "HR N says the effort was right" coda (it duplicates HR and
 * reads as a private nudge). Falls back to the verdict, then the old line.
 */
function stravaDescription(recap: RecapPayload, run: any): string {
  const facts = (recap.facts ?? [])
    .slice(0, 2)
    .map((f) => f.replace(/\s*HR \d+ says the effort was right\.?/i, '').trim())
    .filter(Boolean);
  const body = facts.join(' ').replace(/\s+/g, ' ').trim();
  return body || recap.verdict || autoDescription(run);
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function autoDescription(run: any): string {
  const type = (run.type ?? 'run').toLowerCase();
  const dist = Number(run.distanceMi ?? 0);
  const distStr = dist > 0 ? `${dist % 1 === 0 ? dist.toFixed(0) : dist.toFixed(1)} miles` : null;

  if (type === 'race') {
    return distStr ?? 'Race.';
  }

  if (type === 'long') {
    return distStr ? `${distStr}.` : 'Long run.';
  }

  if (type === 'tempo' || type === 'threshold' || type === 'intervals') {
    const phases = Array.isArray(run.phases) ? run.phases : [];
    const work = phases.filter((p: any) =>
      !['warmup','cooldown','recovery','rest'].includes(p.type)
    );
    if (work.length > 1) {
      const repDist = Number(work[0]?.actualDistanceMi ?? work[0]?.distanceMi ?? 0);
      const repStr = repDist > 0
        ? `${work.length}×${repDist < 1 ? Math.round(repDist * 5280) + 'm' : repDist.toFixed(0) + ' mile'} repeats`
        : `${work.length} reps`;
      const total = distStr ? ` — ${distStr} total` : '';
      return `${repStr}${total}.`;
    }
    if (work.length === 1) {
      const workDist = Number(work[0]?.actualDistanceMi ?? 0);
      if (workDist > 0 && dist > workDist + 0.5) {
        return `${distStr} with ${workDist.toFixed(0)} at ${type}.`;
      }
      return workDist > 0 ? `${workDist.toFixed(0)} miles at ${type}.` : `${cap(type)} workout.`;
    }
    return distStr ? `${cap(type)}, ${distStr}.` : `${cap(type)} workout.`;
  }

  // Easy / recovery
  return distStr ? `${distStr}.` : 'Easy run.';
}

/**
 * Normalize a run's per-mile splits to { mile, durationSec } for the TCX
 * per-mile time grid. durationSec for a 1-mile split is its pace in seconds
 * — read paceSecPerMi (watch) or pace_s_per_mi (RunSplit type) or a
 * Strava-style moving_time. Returns null when there's nothing usable, so
 * build-tcx falls back to even distribution.
 */
function normalizeSplits(splits: any): Array<{ mile: number; durationSec: number }> | null {
  if (!Array.isArray(splits) || splits.length === 0) return null;
  const out = splits
    .map((s: any) => ({
      mile: Number(s.mile ?? s.split ?? s.index ?? 0),
      durationSec: Number(s.paceSecPerMi ?? s.pace_s_per_mi ?? s.moving_time ?? s.elapsed_time ?? 0),
    }))
    .filter((s) => s.mile > 0 && s.durationSec > 0)
    .sort((a, b) => a.mile - b.mile);
  return out.length > 0 ? out : null;
}

/** Pull phases array from the run row in the shape buildTcx expects. */
function extractPhasesForTcx(run: any): BuildOpts['phases'] {
  if (!Array.isArray(run.phases)) return undefined;
  return run.phases.map((p: any) => ({
    type: String(p.type ?? 'work'),
    label: p.label ?? null,
    actualDurationSec: Number(p.actualDurationSec) || 0,
    actualDistanceMi: Number(p.actualDistanceMi) || 0,
    avgHr: typeof p.avgHr === 'number' ? p.avgHr : null,
    maxHr: typeof p.maxHr === 'number' ? p.maxHr : null,
    avgCadence: typeof p.avgCadence === 'number' ? p.avgCadence : null,
  }));
}

type BuildOpts = Parameters<typeof buildTcx>[0];

/**
 * Strava 401 → reconnect push, gated on 3 consecutive 401 failures
 * (deck §G TRIGGER). Soft-fails if the notifications system isn't wired
 * yet — the push.ts behavior is unaffected.
 *
 * The dedup key inside the rendered template is per-day, so even if the
 * runner has many failed pushes in a row, we only land one push per day.
 */
async function maybeFireStravaReconnect(userId: string): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT status, error_message
         FROM strava_pushes
        WHERE user_uuid = $1
        ORDER BY pushed_at DESC
        LIMIT 3`,
      [userId],
    );
    if (r.rows.length < 3) return;
    const all401 = r.rows.every((row: any) =>
      row.status === 'failed' && /\b401\b|REAUTH/i.test(row.error_message ?? '')
    );
    if (!all401) return;
    // 2026-06-03 · runner TZ for the date_iso label in the notification.
    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const dateIso = await runnerToday(userId);
    const tpl = renderStravaReconnect({ user_id: userId, date_iso: dateIso });
    await enqueueNotification(userId, tpl, new Date());
  } catch {
    // Notifications system not ready, or table missing — non-blocking.
  }
}
