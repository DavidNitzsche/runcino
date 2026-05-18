/**
 * /api/strava/connect — kicks off Strava OAuth.
 *
 * Requires a logged-in faff.run session. The user's UUID is encoded
 * into the OAuth `state` param + verified on the callback so we know
 * which faff user just connected (multi-tenant safe).
 */

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getCurrentUser } from '../../../../lib/auth';
import { query } from '../../../../lib/db';

/** Resolve the public origin for the Strava redirect_uri.
 *
 *  Inside a Railway container req.url is something like
 *  http://0.0.0.0:8080/... — that's not what Strava is configured to
 *  accept. Falls through:
 *    1. RAILWAY_PUBLIC_DOMAIN env var
 *    2. X-Forwarded-Host + X-Forwarded-Proto headers (Railway proxy)
 *    3. Host header
 *    4. req.url origin (localhost dev fallback)
 */
function publicOrigin(req: Request): string {
  const fromEnv = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (fromEnv) return `https://${fromEnv}`;
  const fwdHost = req.headers.get('x-forwarded-host');
  const fwdProto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  const host = req.headers.get('host');
  if (host && !host.startsWith('0.0.0.0') && !host.startsWith('127.0.0.1')) {
    const proto = host.startsWith('localhost') ? 'http' : 'https';
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

// Short-lived state cookie name — set during /connect, verified during
// callback. Prevents CSRF + threads user_id through the OAuth handoff.
const STATE_COOKIE = 'faff_strava_oauth_state';

export async function GET(req: Request) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return new Response('Missing STRAVA_CLIENT_ID — set it in Railway Variables', { status: 500 });
  }

  // Resolve the public origin first — we use it for both the OAuth
  // redirect_uri and the "not logged in → /login" bounce. Using raw
  // req.url here gave us `http://0.0.0.0:8080/login` on Railway.
  const origin = publicOrigin(req);
  const redirectUri = `${origin}/api/strava/callback`;

  // Require login
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?next=/profile`);
  }

  // Debug hatch
  const url = new URL(req.url);
  if (url.searchParams.get('debug') === '1') {
    return new Response(JSON.stringify({
      redirectUri,
      detectedOrigin: origin,
      user: { id: user.id, email: user.email },
    }, null, 2), { headers: { 'content-type': 'application/json' } });
  }

  // Generate state — random + user_id, persisted in a short-lived cookie
  // and to the DB so the callback can verify + look up the user.
  const stateNonce = randomBytes(16).toString('base64url');
  const stateValue = `${stateNonce}:${user.id}`;

  // Stash in a connector_sync_log row so callback can verify.
  // (Lightweight; rows are short-lived. Could use Redis but pg is fine.)
  await query(
    `INSERT INTO connector_sync_log (user_id, provider, trigger, status, started_at)
     VALUES ($1, 'strava', 'connect', 'in_progress', NOW())
     RETURNING id;`,
    [user.id],
  ).catch(() => { /* table may not exist on older deploys — non-fatal */ });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // activity:write lets us push workout name + description back to
    // Strava when a planned workout completes (faff.run names the run
    // for you). Required for the writeback feature; existing connections
    // need to re-auth once after this scope is added.
    scope: 'read,activity:read_all,profile:read_all,activity:write',
    approval_prompt: 'auto',
    state: stateValue,
  });

  const res = NextResponse.redirect(`https://www.strava.com/oauth/authorize?${params}`);
  // 10-min state cookie — callback verifies against this
  res.cookies.set({
    name: STATE_COOKIE,
    value: stateValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
