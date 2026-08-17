/**
 * Admin endpoint for managing the Strava Push API subscription.
 *
 *   POST { action: 'subscribe' }    — mints a verify_token, registers our
 *                                     callback with Strava, stores the
 *                                     returned subscription_id. ONE-TIME
 *                                     post-deploy action (per app, per
 *                                     callback URL).
 *   POST { action: 'unsubscribe' }  — DELETEs the subscription from Strava
 *                                     and our local row. Use before re-subscribing
 *                                     with a rotated verify_token.
 *   GET                             — returns current subscription state
 *                                     + event counts (admin dashboard).
 *
 * Auth: requireAdmin — session auth + users.is_admin (2026-06-10).
 *
 * The callback URL defaults to `${origin}/api/strava/webhook` — works for
 * both prod (https://www.faff.run) and local dev (http://localhost:3000)
 * BUT Strava REQUIRES https in production. Local dev requires a public
 * tunnel (ngrok / cloudflared) — see OPERATIONS.md §4.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireAdmin } from '@/lib/auth/session';
import { pool } from '@/lib/db/pool';
import {
  subscribeWebhook,
  unsubscribeWebhook,
  getActiveSubscription,
  listStravaSubscriptions,
  planSubscriptionReconcile,
  reconcileSubscription,
} from '@/lib/strava/webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const sub = await getActiveSubscription();

  // Always ask Strava what IT thinks exists. "state: none" from the local
  // table alone is the exact reading that hid the 2026-05-29 outage: our
  // mirror was empty while Strava was happily delivering to subscription
  // 347351 and the route rejected every event. Report both sides, plus
  // the reconcile plan, so the drift is visible rather than inferred.
  let stravaSide: Awaited<ReturnType<typeof listStravaSubscriptions>> = [];
  let stravaError: string | null = null;
  try {
    stravaSide = await listStravaSubscriptions();
  } catch (e: any) {
    stravaError = e?.message ?? 'strava list failed';
  }
  const plan = planSubscriptionReconcile({
    strava: stravaSide,
    local: sub ? { subscription_id: sub.subscription_id, callback_url: sub.callback_url } : null,
    expectedCallbackUrl: process.env.STRAVA_WEBHOOK_CALLBACK ?? null,
  });

  if (!sub) {
    return NextResponse.json({
      state: 'none',
      strava_side: stravaSide,
      strava_error: stravaError,
      reconcile: plan,
    });
  }
  // Count pending + by-status from the events log for visibility.
  const stats = (await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE processed_at IS NULL)         AS pending,
        COUNT(*) FILTER (WHERE process_status = 'ok')        AS ok,
        COUNT(*) FILTER (WHERE process_status = 'skipped')   AS skipped,
        COUNT(*) FILTER (WHERE process_status = 'error')     AS error,
        COUNT(*)                                             AS total
       FROM strava_webhook_events
      WHERE subscription_id = $1`,
    [sub.subscription_id]
  )).rows[0];

  return NextResponse.json({
    state: 'active',
    strava_side: stravaSide,
    strava_error: stravaError,
    reconcile: plan,
    subscription_id: sub.subscription_id,
    callback_url: sub.callback_url,
    created_at: sub.created_at,
    last_event_at: sub.last_event_at,
    events_received: sub.events_received,
    event_stats: {
      pending: Number(stats?.pending ?? 0),
      ok:      Number(stats?.ok ?? 0),
      skipped: Number(stats?.skipped ?? 0),
      error:   Number(stats?.error ?? 0),
      total:   Number(stats?.total ?? 0),
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== 'subscribe' && action !== 'unsubscribe' && action !== 'reconcile') {
    return NextResponse.json(
      { error: 'action must be "subscribe", "unsubscribe" or "reconcile"' },
      { status: 400 }
    );
  }

  // reconcile · rebuild the local mirror from Strava's truth. Never calls
  // a Strava-mutating endpoint: if the plan needs one, it comes back
  // unapplied with the reason, and a human runs it deliberately.
  if (action === 'reconcile') {
    try {
      const result = await reconcileSubscription({
        expectedCallbackUrl: body?.callback_url ?? process.env.STRAVA_WEBHOOK_CALLBACK ?? null,
        apply: body?.dry_run !== true,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'reconcile failed' }, { status: 502 });
    }
  }

  if (action === 'subscribe') {
    // Strava only allows one subscription per app. Tear down any
    // stale local row first — but DON'T call Strava DELETE if the
    // row's stale and Strava has already moved on; subscribeWebhook
    // will return Strava's error if there's a conflict.
    const existing = await getActiveSubscription();
    if (existing) {
      return NextResponse.json(
        {
          error: 'subscription already exists; call unsubscribe first or use POST /api/admin/strava-webhook with action=unsubscribe',
          subscription_id: existing.subscription_id,
        },
        { status: 409 }
      );
    }

    // Strava-side pre-check. Without it this path POSTs a subscription
    // Strava will reject ("already exists"), which reads as a Strava
    // fault rather than what it is: our mirror row went missing and the
    // right move is reconcile, not subscribe.
    const live = await listStravaSubscriptions().catch(() => null);
    if (live && live.length > 0) {
      return NextResponse.json(
        {
          error:
            'Strava already holds a subscription for this app; the local mirror row is what is missing. ' +
            'POST { action: "reconcile" } to adopt it.',
          strava_side: live,
        },
        { status: 409 }
      );
    }

    // 32 bytes = 64 hex chars of cryptographic randomness. Exceeds the
    // task constraint (32+ chars of random data).
    const verifyToken = randomBytes(32).toString('hex');

    // Callback URL: explicit override (body.callback_url) → env → origin.
    // env STRAVA_WEBHOOK_CALLBACK is preferred in prod because the
    // request origin during admin call could be something local-tunnel.
    const callbackUrl = body?.callback_url
      ?? process.env.STRAVA_WEBHOOK_CALLBACK
      ?? `${req.nextUrl.origin}/api/strava/webhook`;

    try {
      const result = await subscribeWebhook(callbackUrl, verifyToken);
      return NextResponse.json({
        ok: true,
        subscription_id: result.subscription_id,
        callback_url: callbackUrl,
        // Don't echo the verify_token in the response — it's stored
        // server-side only. If admin needs to inspect it later, query
        // the DB directly.
      });
    } catch (e: any) {
      // Never leak STRAVA_CLIENT_SECRET — the lib already scrubs, just
      // forward Strava's message.
      return NextResponse.json(
        { error: e?.message ?? 'subscribe failed' },
        { status: 502 }
      );
    }
  }

  // action === 'unsubscribe'
  try {
    await unsubscribeWebhook();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'unsubscribe failed' },
      { status: 502 }
    );
  }
}
