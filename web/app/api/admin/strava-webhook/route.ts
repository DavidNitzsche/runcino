/**
 * /api/admin/strava-webhook — manage the Strava webhook subscription.
 *
 * Strava only allows ONE active webhook subscription per app. This
 * endpoint lets an admin (you) check, create, or delete it without
 * curling Strava manually.
 *
 *   GET   → list current subscriptions
 *   POST  → create a subscription pointing at /api/strava/webhook
 *   DELETE → tear down the existing subscription
 *
 * All require admin (requireAdmin). The Strava client_id + secret +
 * webhook verify token come from env vars.
 *
 * Reference: https://developers.strava.com/docs/webhooks/
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

interface Subscription {
  id: number;
  application_id?: number;
  callback_url: string;
  created_at?: string;
  updated_at?: string;
}

function clientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function verifyToken(): string {
  return process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || 'faff-run-strava-webhook';
}

function callbackUrl(req: NextRequest): string {
  // Prefer RAILWAY_PUBLIC_DOMAIN, fall back to forwarded host headers
  const env = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (env) return `https://${env}/api/strava/webhook`;
  const fwd = req.headers.get('x-forwarded-host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (fwd) return `${proto}://${fwd}/api/strava/webhook`;
  return `${req.nextUrl.origin}/api/strava/webhook`;
}

async function listSubscriptions(): Promise<Subscription[]> {
  const creds = clientCreds();
  if (!creds) throw new Error('STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET not configured');
  const url = new URL('https://www.strava.com/api/v3/push_subscriptions');
  url.searchParams.set('client_id', creds.clientId);
  url.searchParams.set('client_secret', creds.clientSecret);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Strava list failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Subscription[];
}

// ── GET — show current state ────────────────────────────────────────
export async function GET(req: NextRequest) {
  await requireAdmin();
  try {
    const subs = await listSubscriptions();
    return NextResponse.json({
      ok: true,
      callbackUrl: callbackUrl(req),
      verifyToken: verifyToken(),
      subscriptions: subs,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}

// ── POST — create the subscription ──────────────────────────────────
export async function POST(req: NextRequest) {
  await requireAdmin();
  const creds = clientCreds();
  if (!creds) return NextResponse.json({ ok: false, error: 'STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET not set' }, { status: 500 });

  // Strava only allows one — tear down existing first so the new one wins.
  try {
    const existing = await listSubscriptions();
    for (const sub of existing) {
      const url = new URL(`https://www.strava.com/api/v3/push_subscriptions/${sub.id}`);
      url.searchParams.set('client_id', creds.clientId);
      url.searchParams.set('client_secret', creds.clientSecret);
      await fetch(url, { method: 'DELETE' });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: `failed to clear existing subs: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 });
  }

  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    callback_url: callbackUrl(req),
    verify_token: verifyToken(),
  });
  const res = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: 'Strava subscribe failed', status: res.status, response: data }, { status: 502 });
  }
  return NextResponse.json({ ok: true, subscription: data, callbackUrl: callbackUrl(req) });
}

// ── DELETE — tear it down ───────────────────────────────────────────
export async function DELETE() {
  await requireAdmin();
  const creds = clientCreds();
  if (!creds) return NextResponse.json({ ok: false, error: 'STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET not set' }, { status: 500 });
  try {
    const subs = await listSubscriptions();
    const removed: number[] = [];
    for (const sub of subs) {
      const url = new URL(`https://www.strava.com/api/v3/push_subscriptions/${sub.id}`);
      url.searchParams.set('client_id', creds.clientId);
      url.searchParams.set('client_secret', creds.clientSecret);
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok || res.status === 204) removed.push(sub.id);
    }
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
