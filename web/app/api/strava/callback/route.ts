/**
 * /api/strava/callback — Strava OAuth callback handler.
 *
 * Multi-tenant flow:
 *   1. Verify the state cookie matches the state param (CSRF check).
 *   2. Extract user_id from state (set by /api/strava/connect).
 *   3. Exchange the code for tokens.
 *   4. UPSERT a row in connector_tokens for (user_id, 'strava').
 *   5. Redirect to /profile with success param.
 *
 * Background activity backfill runs separately — kicked off here as a
 * fire-and-forget but the user lands back in the app immediately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '../../../../lib/strava';
import { query } from '../../../../lib/db';
import { getCurrentUser } from '../../../../lib/auth';

const STATE_COOKIE = 'faff_strava_oauth_state';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Resolve the public origin for return-to-app redirects
  const origin = (() => {
    const env = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (env) return `https://${env}`;
    const fwd = req.headers.get('x-forwarded-host');
    if (fwd) return `${req.headers.get('x-forwarded-proto') ?? 'https'}://${fwd}`;
    return url.origin;
  })();

  if (error) {
    return NextResponse.redirect(`${origin}/profile?connect=denied`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${origin}/profile?connect=error&reason=missing_params`);
  }

  // Verify state cookie matches state param (CSRF + user_id thread).
  // Using NextRequest.cookies handles URL-encoded values cleanly,
  // unlike splitting the raw Cookie header on '=' (which breaks if the
  // cookie value contains '=' padding).
  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!stateCookie || stateCookie !== state) {
    console.error('[strava callback] state mismatch', {
      hasCookie: !!stateCookie,
      cookieLen: stateCookie?.length,
      stateLen: state.length,
      match: stateCookie === state,
    });
    return NextResponse.redirect(`${origin}/profile?connect=error&reason=state_mismatch`);
  }
  const [, userId] = state.split(':');
  if (!userId) {
    return NextResponse.redirect(`${origin}/profile?connect=error&reason=bad_state`);
  }

  // Sanity: ensure the currently-logged-in user matches the state user_id.
  // (If they signed out + signed in as someone else mid-flow, abort.)
  const current = await getCurrentUser();
  if (!current || current.id !== userId) {
    return NextResponse.redirect(`${origin}/profile?connect=error&reason=user_mismatch`);
  }

  // Exchange code → tokens
  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (e) {
    console.error('[strava callback] exchange failed:', e);
    return NextResponse.redirect(`${origin}/profile?connect=error&reason=exchange_failed`);
  }

  // UPSERT into connector_tokens
  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at * 1000) : null;
  const athleteId = tokens.athlete?.id ? String(tokens.athlete.id) : null;
  try {
    await query(
      `INSERT INTO connector_tokens
        (user_id, provider, provider_user_id, scope, access_token, refresh_token, expires_at, metadata, connected_at, disconnected_at)
       VALUES ($1, 'strava', $2, $3, $4, $5, $6, $7, NOW(), NULL)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         provider_user_id = EXCLUDED.provider_user_id,
         scope            = EXCLUDED.scope,
         access_token     = EXCLUDED.access_token,
         refresh_token    = EXCLUDED.refresh_token,
         expires_at       = EXCLUDED.expires_at,
         metadata         = EXCLUDED.metadata,
         disconnected_at  = NULL,
         connected_at     = COALESCE(connector_tokens.connected_at, NOW()),
         updated_at       = NOW();`,
      [
        userId,
        athleteId,
        'read,activity:read_all,profile:read_all',
        tokens.access_token,
        tokens.refresh_token,
        expiresAt,
        JSON.stringify({ athlete: tokens.athlete ?? null }),
      ],
    );
  } catch (e) {
    console.error('[strava callback] failed to persist tokens:', e);
    return NextResponse.redirect(`${origin}/profile?connect=error&reason=persist_failed`);
  }

  // Clear the state cookie + redirect home
  const res = NextResponse.redirect(`${origin}/profile?connect=success`);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
