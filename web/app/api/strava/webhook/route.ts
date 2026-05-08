/**
 * /api/strava/webhook — Strava push subscription receiver.
 *
 * Strava sends webhook events when activities are created / updated /
 * deleted on a subscribed athlete. We use this to eagerly regenerate
 * the coach_today_cache so the runner doesn't pay the LLM-brief
 * latency on the first dashboard visit after a run.
 *
 * Two HTTP methods:
 *   GET  — Strava's subscription verification handshake. Validates
 *          hub.verify_token against STRAVA_WEBHOOK_VERIFY_TOKEN env
 *          var, echoes back hub.challenge.
 *   POST — Activity event. We parse + filter to "Run created"
 *          events, sync Strava activities to our cache, then
 *          regenerate the coach today cache.
 *
 * Webhook subscription needs to be set up once via:
 *   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
 *     -F client_id=XXX -F client_secret=YYY \
 *     -F callback_url=https://runcino-production.up.railway.app/api/strava/webhook \
 *     -F verify_token=<STRAVA_WEBHOOK_VERIFY_TOKEN>
 *
 * Environment:
 *   STRAVA_WEBHOOK_VERIFY_TOKEN — random string. Set to anything
 *     stable; Strava echoes it back during verification.
 *
 * Idempotency: Strava can deliver the same event multiple times.
 * Regeneration is itself idempotent (UPSERT on cache key) so we
 * don't bother deduping events.
 */

import { regenerateCoachTodayCache } from '../../../../lib/coach-today-cache';
import { refreshActivities } from '../../../../lib/strava-cache';

interface StravaEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, string>;
}

// ── GET: subscription verification handshake ─────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode !== 'subscribe') {
    return new Response('Unexpected hub.mode', { status: 400 });
  }
  const expectedToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!expectedToken) {
    return new Response('STRAVA_WEBHOOK_VERIFY_TOKEN not configured', { status: 500 });
  }
  if (token !== expectedToken) {
    return new Response('verify_token mismatch', { status: 403 });
  }
  if (!challenge) {
    return new Response('hub.challenge missing', { status: 400 });
  }
  return Response.json({ 'hub.challenge': challenge });
}

// ── POST: activity event → regenerate cache ──────────────────────

export async function POST(req: Request) {
  let event: StravaEvent;
  try {
    event = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Quick-ack the webhook within 2 seconds (Strava's deadline) by
  // doing the slow work asynchronously. We respond 200 immediately
  // and fire-and-forget the regeneration.
  if (event.object_type === 'activity' && event.aspect_type === 'create') {
    // Pull the new activity into our Postgres cache, then
    // regenerate the coach today cache. Both are non-blocking
    // relative to the Strava webhook response.
    void (async () => {
      try {
        await refreshActivities().catch(() => undefined);
        const result = await regenerateCoachTodayCache();
        // eslint-disable-next-line no-console
        console.log('[strava webhook] coach cache regenerated', result.key, `${result.computedAtMs}ms`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[strava webhook] regen failed:', e instanceof Error ? e.message : e);
      }
    })();
  }

  // Always 200 — Strava retries on non-2xx responses, and we want
  // to absorb the event even if it wasn't an activity-create.
  return Response.json({ ok: true });
}
