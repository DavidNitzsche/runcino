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

export async function GET(req: Request) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return new Response('Missing STRAVA_CLIENT_ID — set it in web/.env.local + Railway Variables', { status: 500 });
  }
  // Use the request's own origin for the redirect URI so the same
  // route works from localhost (dev) and the Railway URL (prod).
  // The host needs to be on Strava's "Authorization Callback Domain"
  // list (registered at strava.com/settings/api).
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/strava/callback`;
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
