/**
 * /api/strava/connect — kicks off the OAuth one-shot.
 *
 * Redirects the browser to Strava's authorize page with the right
 * scopes. Strava redirects back to /api/strava/callback?code=... once
 * the user clicks "Authorize" — that's where we exchange the code
 * for tokens.
 *
 * Single-user tool, so we don't bother with state/CSRF — there's no
 * second user to confuse. If we ever multi-tenant, add a state param
 * and verify on callback.
 */

import { NextResponse } from 'next/server';

/** Resolve the public origin for the Strava redirect_uri.
 *
 *  Inside a Railway container, req.url is something like
 *  http://0.0.0.0:8080/... — using its origin would send Strava a
 *  redirect_uri it can't validate (Strava's "Authorization Callback
 *  Domain" is set to __KEEP_FAFF.RUN_PROD__.up.railway.app).
 *
 *  Fall through, in priority order:
 *   1. RAILWAY_PUBLIC_DOMAIN env var (Railway injects this for the
 *      service's primary public hostname)
 *   2. X-Forwarded-Host + X-Forwarded-Proto headers (the proxy
 *      sets these to the real public hostname)
 *   3. Host header
 *   4. req.url origin (dev fallback for localhost)
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

export async function GET(req: Request) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return new Response('Missing STRAVA_CLIENT_ID — set it in web/.env.local + Railway Variables', { status: 500 });
  }
  const origin = publicOrigin(req);
  const redirectUri = `${origin}/api/strava/callback`;
  // Debug: hitting /api/strava/connect?debug=1 shows the redirect_uri
  // the app would send, instead of redirecting to Strava. Useful for
  // diagnosing "redirect_uri invalid" errors without round-tripping
  // through Strava.
  const url = new URL(req.url);
  if (url.searchParams.get('debug') === '1') {
    return new Response(JSON.stringify({
      redirectUri,
      detectedOrigin: origin,
      reqUrl: req.url,
      headers: {
        host: req.headers.get('host'),
        'x-forwarded-host': req.headers.get('x-forwarded-host'),
        'x-forwarded-proto': req.headers.get('x-forwarded-proto'),
      },
      env: { RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN ?? null },
    }, null, 2), { headers: { 'content-type': 'application/json' } });
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'read,activity:read_all',
    approval_prompt: 'auto',
  });
  const authorizeUrl = `https://www.strava.com/oauth/authorize?${params}`;
  return NextResponse.redirect(authorizeUrl);
}
