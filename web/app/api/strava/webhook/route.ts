/**
 * /api/strava/webhook, Strava Webhooks Push Subscription endpoint.
 *
 * Two purposes:
 *
 * 1. GET, Strava subscription handshake.
 *    When we register a webhook subscription, Strava immediately hits
 *    this endpoint with `hub.mode=subscribe&hub.verify_token=<token>&
 *    hub.challenge=<random>`. We must echo back the challenge as JSON
 *    `{"hub.challenge": "..."}`. Done once on subscription create.
 *
 * 2. POST, Strava event delivery.
 *    Body shape (per Strava docs):
 *      {
 *        aspect_type: 'create' | 'update' | 'delete',
 *        object_type: 'activity' | 'athlete',
 *        object_id:   <id of activity OR athlete>,
 *        owner_id:    <athlete id who owns the object>,
 *        subscription_id: <our subscription>,
 *        event_time:  <unix sec>,
 *        updates: {...}              // present on athlete deauth + on activity updates
 *      }
 *
 *    We resolve owner_id → faff user_id via connector_tokens, then:
 *      - activity / create | update → sync that single activity
 *      - activity / delete           → drop the row from strava_activities
 *      - athlete / update + authorized:false → mark connector disconnected
 *
 * MUST return 200 within 2 seconds or Strava treats it as a failed
 * delivery and retries (then disables the subscription after enough
 * failures). All heavy lifting is fire-and-forget.
 *
 * Verify token: STRAVA_WEBHOOK_VERIFY_TOKEN env var. Pick anything
 * random and consistent, it's just a shared secret Strava echoes
 * back during subscription create to confirm it's hitting our app.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  findUserByStravaAthleteId,
  syncSingleActivity,
  deleteActivityForUser,
  markDeauthorized,
} from '@/lib/sync-strava-user';
import { query } from '@/lib/db';
import { getActivePlanWeeks } from '@/lib/plan-weeks';
import { pushWorkoutNameToStrava } from '@/lib/strava-writeback';

function verifyToken(): string {
  return process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || 'faff-run-strava-webhook';
}

// ── GET: subscription handshake ─────────────────────────────────────
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === verifyToken() && challenge) {
    return NextResponse.json({ 'hub.challenge': challenge });
  }
  return NextResponse.json({ error: 'invalid handshake' }, { status: 403 });
}

// ── POST: event delivery ────────────────────────────────────────────
interface StravaEvent {
  aspect_type: 'create' | 'update' | 'delete';
  object_type: 'activity' | 'athlete';
  object_id:   number;
  owner_id:    number;
  subscription_id?: number;
  event_time?: number;
  updates?: Record<string, unknown> & { authorized?: 'true' | 'false' | boolean };
}

export async function POST(req: NextRequest) {
  let event: StravaEvent;
  try {
    event = (await req.json()) as StravaEvent;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // ACK immediately so Strava doesn't retry / disable the subscription.
  // Heavy lifting runs in the background.
  void handleEvent(event).catch((e) => {
    console.error('[strava webhook] handler failed for', event, ':', e);
  });

  return NextResponse.json({ ok: true });
}

async function handleEvent(event: StravaEvent): Promise<void> {
  const userId = await findUserByStravaAthleteId(event.owner_id);
  if (!userId) {
    console.warn('[strava webhook] no faff user for athlete', event.owner_id);
    return;
  }

  if (event.object_type === 'activity') {
    if (event.aspect_type === 'create' || event.aspect_type === 'update') {
      const result = await syncSingleActivity(userId, event.object_id);
      if (!result.ok) {
        console.error('[strava webhook] syncSingleActivity failed', userId, event.object_id, result.error);
        return;
      }
      console.log('[strava webhook] activity', event.aspect_type, event.object_id, 'for user', userId);

      // Writeback: only on CREATE (never on update, manual edits stick).
      // Pull the just-synced activity from our DB to know its date +
      // current name/description + actual stats, then push the planned
      // workout name + description back to Strava if all guards pass.
      if (event.aspect_type === 'create') {
        await tryWriteback(userId, event.object_id);
      }
    } else if (event.aspect_type === 'delete') {
      await deleteActivityForUser(userId, event.object_id);
      console.log('[strava webhook] activity deleted', event.object_id, 'for user', userId);
    }
    return;
  }

  if (event.object_type === 'athlete') {
    // Strava sends athlete updates with `updates: { authorized: 'false' }`
    // when the user revokes our access from their settings page.
    const authorized = event.updates?.authorized;
    if (authorized === 'false' || authorized === false) {
      await markDeauthorized(userId);
      console.log('[strava webhook] athlete', event.owner_id, 'deauthorized faff');
    }
    return;
  }
}

/**
 * Look up the just-synced activity, match it to a planned workout,
 * and push the planned name + description back to Strava. Caller is
 * the webhook create handler; this is fire-and-forget after the
 * activity row is already in strava_activities.
 */
async function tryWriteback(userId: string, activityId: number): Promise<void> {
  interface ActRow {
    data: {
      name?: string;
      description?: string | null;
      startLocal?: string;
      date?: string;
      distanceMi?: number;
      movingTimeS?: number;
      avgHr?: number;
    };
  }
  const rows = await query<ActRow>(
    `SELECT data FROM strava_activities WHERE id = $1 LIMIT 1`,
    [activityId],
  );
  const row = rows[0];
  if (!row?.data) return;

  const dateISO = row.data.date || (row.data.startLocal || '').slice(0, 10);
  if (!dateISO) return;

  // Find the planned day in the runner's REAL plan that matches this
  // activity's date. No plan / no match → skip the writeback (no fake plan).
  const weeks = await getActivePlanWeeks();
  let matchedDay = null;
  let matchedWeek = null;
  for (const w of weeks) {
    const d = w.days.find((d) => d.date === dateISO);
    if (d) { matchedDay = d; matchedWeek = w; break; }
  }
  if (!matchedDay || !matchedWeek) {
    console.log('[strava-writeback] no plan match for', dateISO, ', skip');
    return;
  }

  // Phase week index = position of this week among its phase peers
  const phaseWeeks = weeks.filter((w) => w.phase === matchedWeek!.phase);
  const phaseWeekIdx = phaseWeeks.findIndex((w) => w === matchedWeek) + 1;

  const distanceMi = Number(row.data.distanceMi) || 0;
  const movingS = Number(row.data.movingTimeS) || 0;
  const paceSPerMi = distanceMi > 0 ? Math.round(movingS / distanceMi) : 0;
  const avgHr = row.data.avgHr ? Number(row.data.avgHr) : null;

  const result = await pushWorkoutNameToStrava({
    userId,
    activityId,
    currentName: row.data.name || null,
    currentDescription: row.data.description ?? null,
    day: matchedDay,
    phase: matchedWeek.phase,
    phaseWeek: phaseWeekIdx,
    actual: { distanceMi, paceSPerMi, avgHr },
  });
  console.log('[strava-writeback]', activityId, result.pushed ? 'PUSHED' : `skipped: ${result.reason}`);
}
