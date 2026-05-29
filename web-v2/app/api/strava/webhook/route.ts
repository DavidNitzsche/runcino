/**
 * Strava Push API webhook callback.
 *
 *   GET  → verification handshake. Strava sends ?hub.mode=subscribe
 *          &hub.verify_token=...&hub.challenge=... when we POST to
 *          /push_subscriptions. We must echo { "hub.challenge": "..." }
 *          ONLY when verify_token matches a stored subscription row.
 *          Without a matching row → 403 (rejects spoofed handshakes).
 *
 *   POST → event delivery. Strava sends JSON for activity.create /
 *          activity.update / activity.delete / athlete.update. We:
 *            1. Insert into strava_webhook_events (audit log).
 *            2. Respond 200 ASAP — Strava expects < 2s or it retries.
 *            3. Kick off the processor (fire-and-forget). The processor
 *               fetches the activity via /api/v3/activities/{id} using
 *               the owner's token, upserts into strava_activities, then
 *               marks the event row processed_at = now() with status.
 *
 * Coexistence: the existing poll-based sync (Strava-side and HKWorkout
 * ingest) is unchanged. Webhooks are additive — for runners using the
 * Faff watch app, HKWorkout will usually beat the webhook by seconds;
 * the upsert path dedupes via the Strava activity id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { findSubscriptionByVerifyToken, userIdForAthlete } from '@/lib/strava/webhook';
import { getStravaToken } from '@/lib/strava/auth';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

export const dynamic = 'force-dynamic';
// Node runtime — we hit pg + Strava fetch with timeouts; the Edge
// runtime doesn't get us anything here and complicates pg.
export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────────
// GET — Strava verification handshake
// ─────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('hub.mode');
  const token = sp.get('hub.verify_token') ?? '';
  const challenge = sp.get('hub.challenge') ?? '';

  if (mode !== 'subscribe' || !token || !challenge) {
    return NextResponse.json({ error: 'invalid handshake params' }, { status: 400 });
  }

  const sub = await findSubscriptionByVerifyToken(token);
  if (!sub) {
    // 403 = the verify_token doesn't match any stored subscription.
    // Strava will treat this as a failed subscription attempt and not
    // confirm — exactly what we want for spoofed/stale handshakes.
    return NextResponse.json({ error: 'unknown verify_token' }, { status: 403 });
  }

  // Echo per spec: { "hub.challenge": "<value>" }
  return NextResponse.json({ 'hub.challenge': challenge }, { status: 200 });
}

// ─────────────────────────────────────────────────────────────────
// POST — event delivery
// ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Strava body shape (per https://developers.strava.com/docs/webhooks/):
  // {
  //   aspect_type: 'create' | 'update' | 'delete',
  //   event_time: 1577836800,           // unix seconds
  //   object_id: 1234567890,            // activity_id or athlete_id
  //   object_type: 'activity' | 'athlete',
  //   owner_id: 11111111,               // athlete_id
  //   subscription_id: 999,
  //   updates: { title?: string, type?: string, private?: 'true'|'false',
  //              authorized?: 'false' }    // present on update/athlete deauth
  // }
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // Malformed JSON — still ACK 200 so Strava doesn't retry forever.
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 200 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const aspectType = String(body.aspect_type ?? '');
  const objectType = String(body.object_type ?? '');
  const objectId = Number(body.object_id);
  const ownerId = Number(body.owner_id);
  const subscriptionId = Number(body.subscription_id);
  const eventTime = Number(body.event_time);
  const updates = body.updates ?? null;

  if (!aspectType || !objectType || !Number.isFinite(objectId) || !Number.isFinite(ownerId)) {
    // ACK regardless (don't make Strava retry a bad shape).
    return NextResponse.json({ ok: false, error: 'bad payload' }, { status: 200 });
  }

  // 1. Insert audit row first so even if processing crashes we have
  //    a record. Bump events_received on the subscription row.
  let eventRowId: number | null = null;
  try {
    const r = (await pool.query(
      `INSERT INTO strava_webhook_events
         (subscription_id, aspect_type, object_type, object_id,
          owner_id, updates, event_time, process_status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'pending')
       RETURNING id`,
      [
        subscriptionId,
        aspectType,
        objectType,
        objectId,
        ownerId,
        updates ? JSON.stringify(updates) : null,
        Number.isFinite(eventTime) ? eventTime : Math.floor(Date.now() / 1000),
      ]
    )).rows[0];
    eventRowId = Number(r?.id);

    await pool.query(
      `UPDATE strava_webhook_subscriptions
          SET last_event_at   = NOW(),
              events_received = events_received + 1
        WHERE subscription_id = $1`,
      [subscriptionId]
    );
  } catch (e: any) {
    console.error('[strava/webhook] audit insert failed:', e?.message);
    // Still ACK so Strava doesn't retry; we'll lose this event but
    // a future poll will pick it up.
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // 2. Kick off processing in the background. Strava expects 200 in <2s
  //    so we do NOT await this — the route returns immediately.
  if (eventRowId != null) {
    void processWebhookEvent({
      eventRowId,
      aspectType,
      objectType,
      objectId,
      ownerId,
      updates,
    }).catch((e) => {
      console.error('[strava/webhook] processor failed:', e?.message);
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// ─────────────────────────────────────────────────────────────────
// Processor — runs after we've ACKed Strava
// ─────────────────────────────────────────────────────────────────
interface ProcessArgs {
  eventRowId: number;
  aspectType: string;
  objectType: string;
  objectId: number;
  ownerId: number;
  updates: any;
}

async function processWebhookEvent(args: ProcessArgs): Promise<void> {
  const { eventRowId, aspectType, objectType, objectId, ownerId, updates } = args;

  // Map owner_id → user_uuid. If we don't have this athlete linked, skip.
  const userId = await userIdForAthlete(ownerId);
  if (!userId) {
    await markProcessed(eventRowId, 'skipped');
    return;
  }

  // ── athlete:update events (deauthorize) ──────────────────────
  // Strava sends object_type=athlete, aspect_type=update,
  //   updates: { authorized: 'false' } when the user revokes the app in
  //   Strava settings. Mark connector_tokens disconnected so the
  //   "Reconnect Strava" UI fires.
  if (objectType === 'athlete') {
    if (aspectType === 'update' && updates?.authorized === 'false') {
      try {
        await pool.query(
          `UPDATE connector_tokens
              SET disconnected_at = NOW(),
                  last_sync_status = 'error',
                  last_sync_error = 'STRAVA_DEAUTHORIZED_VIA_WEBHOOK',
                  updated_at = NOW()
            WHERE user_id = $1 AND provider = 'strava'`,
          [userId]
        );
        // Bust the cache so the connection card re-reads state.
        await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});
        await markProcessed(eventRowId, 'ok');
      } catch (e: any) {
        await markProcessed(eventRowId, 'error', e?.message);
      }
      return;
    }
    // Other athlete updates (rare; e.g. profile edits) — nothing to do.
    await markProcessed(eventRowId, 'skipped');
    return;
  }

  // ── activity events ──────────────────────────────────────────
  if (objectType !== 'activity') {
    await markProcessed(eventRowId, 'skipped');
    return;
  }

  // DELETE — drop the activity from strava_activities. Hard-delete is
  // the conservative path here: the existing /api/admin/recompute-runs
  // doesn't have a "deleted" flag in the data jsonb, and downstream
  // aggregation queries already tolerate row absence. Pushed-mirror
  // rows in strava_pushes are untouched (auditable history).
  if (aspectType === 'delete') {
    try {
      await pool.query(
        `DELETE FROM strava_activities
          WHERE (user_uuid = $1 OR user_uuid IS NULL)
            AND id = $2::bigint`,
        [userId, String(objectId)]
      );
      await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});
      await markProcessed(eventRowId, 'ok');
    } catch (e: any) {
      await markProcessed(eventRowId, 'error', e?.message);
    }
    return;
  }

  // CREATE / UPDATE — fetch the activity and upsert. Strava can fire
  // create + update for the same activity in quick succession; the
  // upsert (DELETE then INSERT on id) dedupes naturally.
  if (aspectType === 'create' || aspectType === 'update') {
    try {
      const activity = await fetchStravaActivity(userId, objectId);
      if (!activity) {
        // Could be 404 (deleted before we fetched) or auth issue. Mark
        // skipped — next webhook/poll will heal.
        await markProcessed(eventRowId, 'skipped', 'fetch returned null');
        return;
      }
      await upsertStravaActivity(userId, activity);
      await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});
      await markProcessed(eventRowId, 'ok');
    } catch (e: any) {
      await markProcessed(eventRowId, 'error', e?.message?.slice(0, 400));
    }
    return;
  }

  await markProcessed(eventRowId, 'skipped');
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
async function markProcessed(
  eventRowId: number,
  status: 'ok' | 'skipped' | 'error',
  note?: string
): Promise<void> {
  await pool.query(
    `UPDATE strava_webhook_events
        SET processed_at  = NOW(),
            process_status = $1,
            updates = CASE
              WHEN $2::text IS NULL THEN updates
              ELSE COALESCE(updates, '{}'::jsonb) || jsonb_build_object('_note', $2::text)
            END
      WHERE id = $3`,
    [status, note ?? null, eventRowId]
  ).catch((e: any) => {
    console.error('[strava/webhook] markProcessed failed:', e?.message);
  });
}

/**
 * Fetch a single activity from Strava using the user's OAuth token.
 * Returns the parsed JSON or null on auth/404 failure.
 */
async function fetchStravaActivity(userId: string, activityId: number): Promise<any | null> {
  let token: string;
  try {
    token = await getStravaToken(userId);
  } catch (e: any) {
    console.error('[strava/webhook] no token for user', userId, e?.message);
    return null;
  }
  const resp = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=false`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!resp.ok) {
    // 404 = activity gone (e.g. user deleted between create + our fetch).
    // 401 = token revoked; the next poll/webhook + connector_tokens flag will catch up.
    return null;
  }
  return resp.json();
}

/**
 * Upsert a Strava activity into strava_activities. Matches the shape
 * stored by the existing sync code so all downstream readers (coach,
 * /log, /today, merge writers) work unchanged.
 *
 * Dedupe key: the Strava activity id (the table's BIGINT `id` column).
 * If a hollow HKWorkout/manual row exists for the same start time, the
 * autoMergeForDate writer in /lib/runs/merge will flag dupes on next
 * read — same as the HKWorkout ingest path.
 */
async function upsertStravaActivity(userId: string, activity: any): Promise<void> {
  const id = activity?.id;
  if (!Number.isFinite(Number(id))) return;

  // Only running types — Strava can fire for rides/walks/swims/etc.
  // The existing strava_activities row set has historically been runs only.
  const sport = String(activity?.sport_type ?? activity?.type ?? '').toLowerCase();
  if (!sport.includes('run')) return;

  const startLocal = String(activity?.start_date_local ?? activity?.start_date ?? '');
  const date = startLocal.slice(0, 10);
  const meters = Number(activity?.distance ?? 0);
  const distanceMi = meters / 1609.34;
  const movingSec = Number(activity?.moving_time ?? 0);
  const elapsedSec = Number(activity?.elapsed_time ?? movingSec);
  const sPerMi = distanceMi > 0 ? Math.round(movingSec / distanceMi) : 0;
  const paceMm = sPerMi > 0 ? `${Math.floor(sPerMi / 60)}:${String(sPerMi % 60).padStart(2, '0')}` : null;

  const data: any = {
    id: String(id),
    activityId: String(id),
    source: 'strava_webhook',
    name: activity?.name ?? 'Run',
    date,
    startLocal: startLocal.replace('Z', ''),
    distanceMi: Number(distanceMi.toFixed(3)),
    durationSec: elapsedSec,
    movingSec,
    timeMoving: paceMm ? `${Math.floor(movingSec / 60)}:${String(movingSec % 60).padStart(2, '0')}` : null,
    avgPaceMinPerMi: paceMm,
    avgHr: activity?.average_heartrate ?? null,
    maxHr: activity?.max_heartrate ?? null,
    avgCadence: activity?.average_cadence != null ? Number(activity.average_cadence) * 2 : null, // Strava reports halved
    elevGainFt: activity?.total_elevation_gain != null ? Number(activity.total_elevation_gain) * 3.28084 : null,
    routePolyline: activity?.map?.summary_polyline ?? null,
    type: stravaTypeToFaff(activity),
    ingestedAt: new Date().toISOString(),
    stravaRaw: activity, // keep the original for downstream enrichment
  };

  // DELETE-then-INSERT on the BIGINT id is the idempotent path used
  // everywhere else in this codebase. Both create and update collapse
  // to the same upsert — dedupe handled.
  await pool.query(
    `DELETE FROM strava_activities
      WHERE id = $1::bigint`,
    [String(id)]
  );
  await pool.query(
    `INSERT INTO strava_activities (id, user_uuid, data)
     VALUES ($1::bigint, $2, $3)`,
    [String(id), userId, data]
  );
}

function stravaTypeToFaff(activity: any): string {
  const w = activity?.workout_type;
  // Strava workout_type for runs: 0=default, 1=race, 2=long, 3=workout
  if (w === 1) return 'race';
  if (w === 2) return 'long';
  if (w === 3) return 'workout';
  return 'easy';
}
