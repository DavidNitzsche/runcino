/**
 * Strava Push API — subscription management.
 *
 * Strava enforces ONE subscription per app (client_id). We POST our
 * callback URL + a random verify_token; Strava GETs the callback with
 * hub.mode=subscribe + hub.verify_token + hub.challenge; our route
 * echoes the challenge back; Strava confirms and returns the
 * subscription id. From then on Strava POSTs events to the callback.
 *
 * This module wraps the three subscription operations:
 *   - subscribeWebhook(callbackUrl, verifyToken) — POST /push_subscriptions
 *   - unsubscribeWebhook() — DELETE /push_subscriptions/{id}
 *   - getActiveSubscription() — read our stored row
 *
 * The actual event delivery lands in /api/strava/webhook (route.ts).
 * The admin endpoint /api/admin/strava-webhook drives subscribe /
 * unsubscribe via human action.
 *
 * Docs: https://developers.strava.com/docs/webhooks/
 */
import { pool } from '@/lib/db/pool';

const STRAVA_PUSH_URL = 'https://www.strava.com/api/v3/push_subscriptions';

export interface ActiveSubscription {
  subscription_id: number;
  callback_url: string;
  created_at: string;
  last_event_at: string | null;
  events_received: number;
}

/**
 * Register our callback with Strava's Push API. Stores the returned
 * subscription_id + the verify_token used so the GET handshake can
 * validate. Throws when Strava rejects (typically 400 if a sub already
 * exists for this app — call unsubscribeWebhook first).
 *
 * Returns the Strava subscription id.
 */
export async function subscribeWebhook(
  callbackUrl: string,
  verifyToken: string
): Promise<{ subscription_id: number }> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('STRAVA_CLIENT_ID/SECRET not configured');
  }

  // Strava's docs call for application/x-www-form-urlencoded here.
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    callback_url: callbackUrl,
    verify_token: verifyToken,
  });

  const resp = await fetch(STRAVA_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000), // Strava performs a callback handshake before responding
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    // NEVER include client_secret in error text — scrub by only
    // re-emitting the status + Strava's text (which doesn't echo it).
    throw new Error(`STRAVA_SUBSCRIBE_FAILED: ${resp.status} ${txt.slice(0, 300)}`);
  }
  const json: any = await resp.json();
  const subId = Number(json?.id);
  if (!Number.isFinite(subId) || subId <= 0) {
    throw new Error(`STRAVA_SUBSCRIBE_BAD_RESPONSE: ${JSON.stringify(json).slice(0, 200)}`);
  }

  await pool.query(
    `INSERT INTO strava_webhook_subscriptions
       (subscription_id, callback_url, verify_token)
     VALUES ($1, $2, $3)
     ON CONFLICT (subscription_id) DO UPDATE
       SET callback_url = EXCLUDED.callback_url,
           verify_token = EXCLUDED.verify_token`,
    [subId, callbackUrl, verifyToken]
  );

  return { subscription_id: subId };
}

/**
 * Delete the active subscription from Strava (DELETE /push_subscriptions/{id}
 * with client_id + client_secret as query params per Strava docs).
 * Removes the local row too so a re-subscribe starts clean.
 *
 * No-op if there's no active subscription.
 */
export async function unsubscribeWebhook(): Promise<void> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('STRAVA_CLIENT_ID/SECRET not configured');
  }
  const active = await getActiveSubscription();
  if (!active) return;

  const url = new URL(`${STRAVA_PUSH_URL}/${active.subscription_id}`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);

  const resp = await fetch(url.toString(), {
    method: 'DELETE',
    signal: AbortSignal.timeout(8000),
  });
  // 204 No Content = success. 404 = already gone (Strava housekeeping).
  if (!resp.ok && resp.status !== 404) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`STRAVA_UNSUBSCRIBE_FAILED: ${resp.status} ${txt.slice(0, 300)}`);
  }
  // Drop our row regardless — if Strava 404d we want our state to agree.
  await pool.query(
    `DELETE FROM strava_webhook_subscriptions WHERE subscription_id = $1`,
    [active.subscription_id]
  );
}

/**
 * Read the active subscription row. Returns null if we never subscribed
 * (or if we just unsubscribed). Caller decides whether to refresh from
 * Strava's GET /push_subscriptions for drift detection.
 */
export async function getActiveSubscription(): Promise<ActiveSubscription | null> {
  const r = (await pool.query(
    `SELECT subscription_id, callback_url,
            created_at::text   AS created_at,
            last_event_at::text AS last_event_at,
            events_received
       FROM strava_webhook_subscriptions
      ORDER BY created_at DESC
      LIMIT 1`
  )).rows[0];
  if (!r) return null;
  return {
    subscription_id: Number(r.subscription_id),
    callback_url: r.callback_url,
    created_at: r.created_at,
    last_event_at: r.last_event_at,
    events_received: Number(r.events_received ?? 0),
  };
}

/**
 * Look up the verify_token for the subscription identified by the
 * incoming GET handshake. Strava ALSO sends the subscription's
 * callback URL match implicitly (it called the callback we registered),
 * so we just need to confirm the verify_token matches a stored row.
 *
 * Returns the matching subscription, or null if no row's verify_token
 * matches — the route should respond 403 in that case.
 */
export async function findSubscriptionByVerifyToken(
  verifyToken: string
): Promise<{ subscription_id: number; verify_token: string } | null> {
  if (!verifyToken) return null;
  const r = (await pool.query(
    `SELECT subscription_id, verify_token
       FROM strava_webhook_subscriptions
      WHERE verify_token = $1
      LIMIT 1`,
    [verifyToken]
  )).rows[0];
  if (!r) return null;
  return {
    subscription_id: Number(r.subscription_id),
    verify_token: r.verify_token,
  };
}

/**
 * Look up a user_uuid from a Strava athlete_id (the webhook's owner_id).
 * Reads connector_tokens first (source of truth), falls back to legacy
 * profile.strava_athlete_id. Returns null if the athlete isn't a Faff
 * user — webhook handler should mark the event status='skipped'.
 */
export async function userIdForAthlete(athleteId: number): Promise<string | null> {
  const athleteStr = String(athleteId);
  const fromConnectors = (await pool.query(
    `SELECT user_id::text AS user_uuid
       FROM connector_tokens
      WHERE provider = 'strava'
        AND provider_user_id = $1
        AND disconnected_at IS NULL
      ORDER BY connected_at DESC LIMIT 1`,
    [athleteStr]
  ).catch(() => ({ rows: [] }))).rows[0];
  if (fromConnectors?.user_uuid) return fromConnectors.user_uuid;

  const fromProfile = (await pool.query(
    `SELECT user_uuid::text AS user_uuid
       FROM profile
      WHERE strava_athlete_id = $1
      LIMIT 1`,
    [athleteStr]
  ).catch(() => ({ rows: [] }))).rows[0];
  return fromProfile?.user_uuid ?? null;
}
