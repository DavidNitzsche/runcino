/**
 * Strava Push API — subscription management.
 *
 * Strava enforces ONE subscription per app (client_id). We POST our
 * callback URL + a random verify_token; Strava GETs the callback with
 * hub.mode=subscribe + hub.verify_token + hub.challenge; our route
 * echoes the challenge back; Strava confirms and returns the
 * subscription id. From then on Strava POSTs events to the callback.
 *
 * This module wraps the subscription operations:
 *   - subscribeWebhook(callbackUrl, verifyToken) — POST /push_subscriptions
 *   - unsubscribeWebhook() — DELETE /push_subscriptions/{id}
 *   - getActiveSubscription() — read our stored row
 *   - listStravaSubscriptions() — GET /push_subscriptions (Strava's truth)
 *   - planSubscriptionReconcile() / reconcileSubscription() — heal drift
 *     between Strava's truth and our local mirror
 *
 * ── 2026-08-17 · why reconcile exists ────────────────────────────────
 * Real-time sync was dead from 2026-05-29 to 2026-08-17. Strava had (and
 * still has) a healthy subscription — id 347351, callback
 * https://www.faff.run/api/strava/webhook, created 2026-05-18 — and was
 * delivering events the whole time. Our LOCAL mirror row was gone, so the
 * webhook route's Layer-1 check ("subscription_id must match a stored
 * row", added 2026-06-05 as the P0-3 anti-forgery fix) rejected every
 * real event: 68 webhook_failure alerts, zero runs ingested in real time.
 *
 * Before this module gained a reconcile path that state was UNRECOVERABLE
 * in code, because both admin actions read the local table first:
 *   - subscribe   → POST /push_subscriptions, which Strava rejects with
 *                   "already exists" (one subscription per app).
 *   - unsubscribe → getActiveSubscription() returns null → early return,
 *                   so it could not even tear the Strava side down.
 * Losing the local row therefore bricked webhooks permanently, and the
 * only repair was a hand-written DB INSERT. Adoption closes that hole:
 * Strava is the source of truth for what exists, our table is a mirror,
 * and a mirror must be rebuildable from the thing it mirrors.
 *
 * The actual event delivery lands in /api/strava/webhook (route.ts).
 * The admin endpoint /api/admin/strava-webhook drives subscribe /
 * unsubscribe via human action.
 *
 * Docs: https://developers.strava.com/docs/webhooks/
 */
import { randomBytes } from 'crypto';
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
 * Sentinel subscription_id for the row that exists only for the duration
 * of the handshake. Negative so it can never collide with a real Strava
 * id, and so the webhook route's Layer-1 lookup (which matches the
 * positive id off an inbound payload) can never resolve to it.
 */
export const PENDING_SUBSCRIPTION_ID = -1;

/**
 * Register our callback with Strava's Push API. Stores the returned
 * subscription_id + the verify_token used so the GET handshake can
 * validate. Throws when Strava rejects (typically 400 if a sub already
 * exists for this app — call unsubscribeWebhook first).
 *
 * ── Ordering (2026-08-17 fix) ────────────────────────────────────────
 * The verify_token row MUST be written BEFORE the POST. Strava validates
 * synchronously: it GETs our callback with hub.challenge while holding
 * the POST open, and only answers once we echo the challenge back. Our
 * GET handler resolves the token via findSubscriptionByVerifyToken and
 * 403s when no row matches.
 *
 * The previous shape wrote the row from Strava's POST response — i.e.
 * after a handshake that could only ever have failed. Subscribing was
 * therefore impossible from the moment token validation shipped, which
 * is why the sole surviving subscription (347351) predates it and was
 * created by hand. A repair path that cannot run is not a repair path.
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

  // Pending row first — this is what the inbound handshake reads.
  await pool.query(
    `INSERT INTO strava_webhook_subscriptions
       (subscription_id, callback_url, verify_token)
     VALUES ($1, $2, $3)
     ON CONFLICT (subscription_id) DO UPDATE
       SET callback_url = EXCLUDED.callback_url,
           verify_token = EXCLUDED.verify_token`,
    [PENDING_SUBSCRIPTION_ID, callbackUrl, verifyToken]
  );

  let resp: Response;
  try {
    resp = await fetch(STRAVA_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000), // Strava performs a callback handshake before responding
    });
  } catch (e) {
    await clearPendingSubscription();
    throw e;
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    await clearPendingSubscription();
    // NEVER include client_secret in error text — scrub by only
    // re-emitting the status + Strava's text (which doesn't echo it).
    throw new Error(`STRAVA_SUBSCRIBE_FAILED: ${resp.status} ${txt.slice(0, 300)}`);
  }
  const json: any = await resp.json();
  const subId = Number(json?.id);
  if (!Number.isFinite(subId) || subId <= 0) {
    await clearPendingSubscription();
    throw new Error(`STRAVA_SUBSCRIBE_BAD_RESPONSE: ${JSON.stringify(json).slice(0, 200)}`);
  }

  // Promote the pending row to the real id. Keeps the verify_token that
  // Strava actually validated against, rather than re-minting one.
  await pool.query(
    `UPDATE strava_webhook_subscriptions
        SET subscription_id = $1, callback_url = $2
      WHERE subscription_id = $3`,
    [subId, callbackUrl, PENDING_SUBSCRIPTION_ID]
  );
  // Belt and braces: if the pending row was swept between POST and here,
  // the subscription still needs a mirror row.
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

/** Remove the handshake-only row after a failed subscribe. */
async function clearPendingSubscription(): Promise<void> {
  await pool.query(
    `DELETE FROM strava_webhook_subscriptions WHERE subscription_id = $1`,
    [PENDING_SUBSCRIPTION_ID]
  ).catch(() => {});
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
  // Local row first, but Strava's list is the fallback: when the mirror
  // row is missing, the old early-return made teardown impossible even
  // though Strava still held a live subscription (the 2026-05-29 outage
  // state). Strava is the authority on what exists.
  const local = await getActiveSubscription();
  const active = local
    ?? (await listStravaSubscriptions().catch(() => []))
      .map((s) => ({ subscription_id: s.id }))[0]
    ?? null;
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
      WHERE subscription_id > 0
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

// ─────────────────────────────────────────────────────────────────
// Reconcile — Strava is the truth, our table is a rebuildable mirror
// ─────────────────────────────────────────────────────────────────

/** A subscription as Strava reports it from GET /push_subscriptions. */
export interface StravaSideSubscription {
  id: number;
  callback_url: string;
  created_at?: string;
  updated_at?: string;
}

export type ReconcileAction =
  /** Both sides agree on id and callback URL. Nothing to do. */
  | 'in_sync'
  /** Strava has a subscription we have no row for → write the mirror row. */
  | 'adopt'
  /** Neither side has one → the integrator must create it (external call). */
  | 'create'
  /** Our row names a subscription Strava no longer has → drop it, then create. */
  | 'drop_stale_local'
  /** Both exist but the callback URL drifted → tear down and re-create. */
  | 'recreate_callback_drift';

export interface ReconcilePlan {
  action: ReconcileAction;
  /** The Strava-side subscription this plan refers to, when there is one. */
  stravaSubscriptionId: number | null;
  callbackUrl: string | null;
  /** Plain-English reason, surfaced verbatim by the admin route + script. */
  reason: string;
  /** True when carrying the plan out requires a call that mutates Strava. */
  mutatesStrava: boolean;
}

/**
 * Pure decision function: given what Strava reports and what our mirror
 * holds, decide what should happen. Split out from the I/O so the drift
 * matrix is testable without touching the network or the database — the
 * outage this exists to prevent was a state nobody had enumerated.
 *
 * `expectedCallbackUrl` is the URL we intend to be subscribed at. When a
 * live subscription points somewhere else, adoption is not enough: the
 * events are being delivered to the wrong host, so the subscription has
 * to be rebuilt (Strava allows no callback URL update in place).
 */
export function planSubscriptionReconcile(input: {
  strava: StravaSideSubscription[];
  local: { subscription_id: number; callback_url: string } | null;
  expectedCallbackUrl?: string | null;
}): ReconcilePlan {
  const live = input.strava[0] ?? null;
  const local = input.local;
  const expected = input.expectedCallbackUrl ?? null;

  if (!live) {
    if (local) {
      return {
        action: 'drop_stale_local',
        stravaSubscriptionId: null,
        callbackUrl: local.callback_url,
        reason:
          `local row names subscription ${local.subscription_id} but Strava reports none · ` +
          `the mirror is stale; drop it, then create a fresh subscription`,
        mutatesStrava: false,
      };
    }
    return {
      action: 'create',
      stravaSubscriptionId: null,
      callbackUrl: expected,
      reason: 'no subscription on either side · one must be created with Strava',
      mutatesStrava: true,
    };
  }

  // A live subscription pointing at the wrong callback cannot be adopted:
  // deliveries are landing somewhere that is not this app.
  if (expected && !sameCallback(live.callback_url, expected)) {
    return {
      action: 'recreate_callback_drift',
      stravaSubscriptionId: live.id,
      callbackUrl: live.callback_url,
      reason:
        `Strava subscription ${live.id} points at ${live.callback_url}, expected ${expected} · ` +
        `Strava cannot update a callback in place; delete and re-create`,
      mutatesStrava: true,
    };
  }

  if (!local) {
    return {
      action: 'adopt',
      stravaSubscriptionId: live.id,
      callbackUrl: live.callback_url,
      reason:
        `Strava is delivering to subscription ${live.id} but no local row exists · ` +
        `every event is being rejected by the subscription_id check; write the mirror row`,
      mutatesStrava: false,
    };
  }

  if (local.subscription_id !== live.id) {
    return {
      action: 'adopt',
      stravaSubscriptionId: live.id,
      callbackUrl: live.callback_url,
      reason:
        `local row names subscription ${local.subscription_id}, Strava is delivering ${live.id} · ` +
        `re-point the mirror at the live subscription`,
      mutatesStrava: false,
    };
  }

  return {
    action: 'in_sync',
    stravaSubscriptionId: live.id,
    callbackUrl: live.callback_url,
    reason: `subscription ${live.id} present on both sides`,
    mutatesStrava: false,
  };
}

/** Callback URLs compare on origin+path; a trailing slash is not drift. */
function sameCallback(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`.toLowerCase();
    } catch {
      return u.trim().replace(/\/+$/, '').toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

/**
 * Read Strava's own list of subscriptions for this app. This is the only
 * question Strava will answer about state, and it is read-only — it
 * registers nothing.
 */
export async function listStravaSubscriptions(): Promise<StravaSideSubscription[]> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('STRAVA_CLIENT_ID/SECRET not configured');
  }
  const url = new URL(STRAVA_PUSH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`STRAVA_LIST_FAILED: ${resp.status} ${txt.slice(0, 300)}`);
  }
  const json: any = await resp.json();
  if (!Array.isArray(json)) return [];
  return json
    .filter((s) => Number.isFinite(Number(s?.id)))
    .map((s) => ({
      id: Number(s.id),
      callback_url: String(s.callback_url ?? ''),
      created_at: s.created_at ? String(s.created_at) : undefined,
      updated_at: s.updated_at ? String(s.updated_at) : undefined,
    }));
}

/**
 * Write the mirror row for a subscription that already exists at Strava.
 *
 * On the verify_token: Strava runs the GET handshake ONCE, at creation.
 * An adopted subscription is past that point, so the stored token is not
 * what Strava validated against — it exists so a later rotate/re-create
 * has a row to work from, and so the handshake path has something to
 * compare. We prefer STRAVA_WEBHOOK_VERIFY_TOKEN when it is set (on this
 * app it is, and it is most likely the token the 2026-05-18 subscription
 * was created with); otherwise we mint a fresh one. Either way the value
 * does not affect event delivery, which validates on subscription_id.
 */
export async function adoptSubscription(
  subscriptionId: number,
  callbackUrl: string,
  verifyToken: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO strava_webhook_subscriptions
       (subscription_id, callback_url, verify_token)
     VALUES ($1, $2, $3)
     ON CONFLICT (subscription_id) DO UPDATE
       SET callback_url = EXCLUDED.callback_url,
           verify_token = EXCLUDED.verify_token`,
    [subscriptionId, callbackUrl, verifyToken],
  );
}

/**
 * Diagnose (and, for the non-mutating cases, heal) drift between Strava
 * and our mirror. Never calls a Strava-mutating endpoint: when the plan
 * needs one, it is returned for a human to run deliberately.
 */
export async function reconcileSubscription(opts?: {
  expectedCallbackUrl?: string | null;
  /** Default true. False → report the plan without writing anything. */
  apply?: boolean;
}): Promise<ReconcilePlan & { applied: boolean }> {
  const strava = await listStravaSubscriptions();
  const localRow = await getActiveSubscription();
  const local = localRow
    ? { subscription_id: localRow.subscription_id, callback_url: localRow.callback_url }
    : null;

  const plan = planSubscriptionReconcile({
    strava,
    local,
    expectedCallbackUrl: opts?.expectedCallbackUrl ?? process.env.STRAVA_WEBHOOK_CALLBACK ?? null,
  });

  const apply = opts?.apply !== false;
  if (!apply || plan.mutatesStrava) return { ...plan, applied: false };

  if (plan.action === 'adopt' && plan.stravaSubscriptionId != null && plan.callbackUrl) {
    const token =
      process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || randomBytes(32).toString('hex');
    await adoptSubscription(plan.stravaSubscriptionId, plan.callbackUrl, token);
    return { ...plan, applied: true };
  }
  if (plan.action === 'drop_stale_local' && local) {
    await pool.query(
      `DELETE FROM strava_webhook_subscriptions WHERE subscription_id = $1`,
      [local.subscription_id],
    );
    return { ...plan, applied: true };
  }
  return { ...plan, applied: false };
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
    `SELECT COALESCE(user_uuid, user_id)::text AS user_uuid
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
