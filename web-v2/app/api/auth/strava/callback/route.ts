/**
 * GET /api/auth/strava/callback?code=...&state=...
 *
 * Dedicated path for the Strava OAuth callback. Replaces the legacy
 * `/api/auth/strava?action=callback` query-param route · Strava's OAuth
 * handler doesn't reliably preserve query params in the redirect_uri,
 * so the legacy URL would land on a malformed path and 404. This route
 * is a clean path with no query params on the redirect_uri itself.
 *
 * On success: redirects to /today?strava=connected so the page can
 * show a confirmation. On failure: redirects to /today?strava=failed&msg=...
 * with the error body. NEVER returns raw JSON · the runner is in a
 * browser, not an API client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

/**
 * Build a redirect back to the public app URL. `req.nextUrl.origin`
 * resolves to Railway's internal 0.0.0.0:8080 binding · using it
 * would tell the browser to navigate to 0.0.0.0 which can't be
 * reached. Read the proxy headers instead.
 */
function publicOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_ORIGIN
    || process.env.APP_ORIGIN
    || process.env.PUBLIC_URL;
  if (env) return env.replace(/\/+$/, '');

  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host')
    ?? req.headers.get('host')
    ?? 'www.faff.run';
  // Defensively skip the container-internal binding.
  if (/^(0\.0\.0\.0|127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    return 'https://www.faff.run';
  }
  return `${proto}://${host}`;
}

function appRedirect(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/today', publicOrigin(req));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url.toString());
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const stravaErr = req.nextUrl.searchParams.get('error');

  // User canceled the consent screen, or Strava returned an error.
  if (stravaErr) {
    return appRedirect(req, { strava: 'failed', msg: stravaErr.slice(0, 200) });
  }
  if (!code || !state) {
    return appRedirect(req, { strava: 'failed', msg: 'missing code or state' });
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return appRedirect(req, { strava: 'failed', msg: 'server not configured' });
  }

  let tokens: any;
  try {
    const tokenResp = await fetch('https://www.strava.com/api/v3/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenResp.ok) {
      const txt = await tokenResp.text().catch(() => '');
      return appRedirect(req, {
        strava: 'failed',
        msg: `token exchange ${tokenResp.status}: ${txt.slice(0, 160)}`,
      });
    }
    tokens = await tokenResp.json();
  } catch (err: any) {
    return appRedirect(req, { strava: 'failed', msg: `network: ${err?.message ?? 'unknown'}` });
  }

  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token;
  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at * 1000).toISOString() : null;
  const athleteId = String(tokens.athlete?.id ?? '');
  const grantedScope = (typeof tokens.scope === 'string' && tokens.scope.length > 0)
    ? tokens.scope
    : 'read,activity:read_all,activity:write';

  try {
    // Legacy profile.* columns (kept in sync until they're dropped).
    await pool.query(
      `UPDATE profile
          SET strava_athlete_id    = $1,
              strava_access_token  = $2,
              strava_refresh_token = $3,
              strava_expires_at    = $4,
              strava_connected_at  = NOW()
        WHERE user_uuid = $5`,
      [athleteId, accessToken, refreshToken, expiresAt, state],
    );
    // connector_tokens · source of truth for getStravaToken. Without
    // the UPSERT, a user re-OAuthing to pick up a new scope would see
    // no change · stale row keeps coming back.
    await pool.query(
      `INSERT INTO connector_tokens (
          user_id, user_uuid, provider, provider_user_id, scope,
          access_token, refresh_token, expires_at,
          connected_at, disconnected_at, updated_at
        )
        VALUES ($1, $1, 'strava', $2, $3, $4, $5, $6::timestamptz, NOW(), NULL, NOW())
        ON CONFLICT (user_id, provider) DO UPDATE
          SET provider_user_id  = EXCLUDED.provider_user_id,
              scope             = EXCLUDED.scope,
              access_token      = EXCLUDED.access_token,
              refresh_token     = EXCLUDED.refresh_token,
              expires_at        = EXCLUDED.expires_at,
              user_uuid         = COALESCE(connector_tokens.user_uuid, EXCLUDED.user_uuid),
              connected_at      = NOW(),
              disconnected_at   = NULL,
              -- 2026-06-01: clear stale sync-error markers from before
              -- the reconnect. The status detector reads these to flip
              -- the "needs_reauth" banner; without clearing them the
              -- banner stays up even after a clean re-auth because
              -- 'STRAVA_DEAUTHORIZED_VIA_WEBHOOK' / 'PUSH_401_...' from
              -- before still match the detector's /401|REAUTH/i regex.
              last_sync_status  = NULL,
              last_sync_error   = NULL,
              updated_at        = NOW()`,
      [state, athleteId, grantedScope, accessToken, refreshToken, expiresAt],
    );
  } catch (e: any) {
    return appRedirect(req, { strava: 'failed', msg: `db: ${e?.message?.slice(0, 160)}` });
  }

  return appRedirect(req, { strava: 'connected', scope: grantedScope });
}
