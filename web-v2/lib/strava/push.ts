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
  const runRow = (await pool.query(
    `SELECT data FROM runs
      WHERE user_uuid = $1
        AND (data->>'id' = $2 OR data->>'activityId' = $2)
      LIMIT 1`,
    [userId, runId]
  )).rows[0];
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

  // 3. Build title + description.
  const title = opts.title ?? titleFor(run, prefs?.strava_push_title_format ?? 'type_phases');
  const description = (opts.description ?? autoDescription(run))
    + '\n\nvia Faff';
  const privacy = opts.privacy ?? prefs?.strava_push_privacy ?? 'private';

  // 4. Build TCX.
  const tcx = buildTcx({
    runId,
    startLocalIso: run.startLocal ?? `${run.date}T08:00:00`,
    durationSec: Number(run.durationSec ?? run.movingSec ?? 0),
    distanceMi: Number(run.distanceMi ?? 0),
    avgHr: run.avgHr ?? null,
    maxHr: run.maxHr ?? null,
    avgCadenceSpm: run.avgCadence ?? null,
    routePolyline: run.routePolyline ?? null,
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
        // 401. Counted off the latest failed strava_pushes rows. Anything
        // less than 3 avoids a transient-flake notification. The dedup key
        // is per-day so the runner gets at most one per 24h (deck §G
        // RATE LIMIT).
        await maybeFireStravaReconnect(userId);
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

  // 7. Poll once for terminal state. Strava processes async; if not ready
  //    yet, we return 'pending' and rely on a follow-up poll (cron or
  //    user-triggered refresh) to update.
  try {
    await new Promise((r) => setTimeout(r, 2000));
    const statusResp = await fetch(`https://www.strava.com/api/v3/uploads/${uploadId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (statusResp.ok) {
      const j: any = await statusResp.json();
      if (j.activity_id) {
        await pool.query(
          `UPDATE strava_pushes SET status = 'uploaded', strava_activity_id = $1, completed_at = NOW()
            WHERE id = $2`,
          [j.activity_id, pushId]
        );
        return { pushId, status: 'uploaded', stravaActivityId: j.activity_id, stravaUploadId: uploadId };
      }
      if (j.error) {
        await markFailed(pushId, j.error);
        return { pushId, status: 'failed', error: j.error };
      }
    }
  } catch { /* pending stays pending */ }

  return { pushId, status: 'pending', stravaUploadId: uploadId };
}

async function markFailed(pushId: number, message: string) {
  await pool.query(
    `UPDATE strava_pushes SET status = 'failed', error_message = $1, completed_at = NOW()
      WHERE id = $2`,
    [message.slice(0, 500), pushId]
  ).catch(() => {});
}

/**
 * Generate a Strava-style title from the run + the user's preferred template.
 * Templates:
 *   type_phases   → "Threshold · 4×1mi @ 6:48"
 *   tod_type_dist → "Morning easy · 5.2 mi"
 *   custom        → reserved for future user-provided string
 */
function titleFor(run: any, template: string): string {
  const type = (run.type ?? 'run').toLowerCase();
  const dist = Number(run.distanceMi ?? 0).toFixed(1);

  if (template === 'tod_type_dist') {
    const hour = new Date(run.startLocal ?? Date.now()).getHours();
    const tod = hour < 11 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
    const typeWord = type === 'easy' ? 'easy'
      : type === 'long' ? 'long run'
      : type === 'threshold' ? 'threshold'
      : type === 'tempo' ? 'tempo'
      : type === 'intervals' ? 'intervals'
      : type === 'race' ? 'race'
      : 'run';
    return `${tod} ${typeWord} · ${dist} mi`;
  }

  // Default: type_phases
  if (type === 'threshold' || type === 'intervals' || type === 'tempo') {
    const phases = Array.isArray(run.phases) ? run.phases : [];
    const workPhases = phases.filter((p: any) =>
      p.type !== 'warmup' && p.type !== 'cooldown' && p.type !== 'recovery' && p.type !== 'rest'
    );
    if (workPhases.length > 0) {
      const target = workPhases[0]?.targetPaceSPerMi;
      const paceTxt = target ? ` @ ${Math.floor(target/60)}:${String(target%60).padStart(2,'0')}` : '';
      const repTxt = workPhases.length > 1
        ? `${workPhases.length}×${Number(workPhases[0]?.actualDistanceMi ?? 1).toFixed(0)}mi`
        : `${Number(workPhases[0]?.actualDistanceMi ?? 1).toFixed(1)}mi`;
      return `${cap(type)} · ${repTxt}${paceTxt}`;
    }
    return `${cap(type)} · ${dist} mi`;
  }
  if (type === 'race') return `Race · ${dist} mi`;
  if (type === 'long') return `Long run · ${dist} mi`;
  return `${cap(type)} · ${dist} mi`;
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function autoDescription(run: any): string {
  const parts: string[] = [];
  if (run.avgHr) parts.push(`Avg HR ${run.avgHr}`);
  if (run.maxHr) parts.push(`Max HR ${run.maxHr}`);
  if (run.avgCadence) parts.push(`Cadence ${run.avgCadence}`);
  if (Array.isArray(run.phases) && run.phases.length > 0) {
    const work = run.phases.filter((p: any) =>
      p.type !== 'warmup' && p.type !== 'cooldown' && p.type !== 'recovery' && p.type !== 'rest'
    );
    if (work.length > 0) {
      const target = work[0]?.targetPaceSPerMi;
      const allHit = work.every((p: any) => {
        const a = p.actualPaceSPerMi;
        return target != null && a != null && Math.abs(a - target) <= 5;
      });
      if (allHit) parts.push(`Hit pace on all ${work.length} reps`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : '';
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
