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
import { createHmac, timingSafeEqual } from 'crypto';
import { pool } from '@/lib/db/pool';
import { pullSyncOneUser } from '@/lib/strava/pullSync';

export const dynamic = 'force-dynamic';

// 2026-06-05 · backend audit P0-2 fix · HMAC-signed OAuth state.
//
// Was: state was the cleartext user_uuid (or "uuid:ios"). The callback
// trusted it verbatim and wrote the attacker's Strava tokens into
// whatever profile.user_uuid matched. Anyone who saw a victim's uuid
// in a URL or log could hijack the victim's Strava link by crafting
// a callback request with code=attacker_code & state=victim_uuid.
//
// Now: state = `<payload>.<nonce>.<hmac>` signed at /api/auth/strava
// connect time. Verification here uses timing-safe compare against
// a SHA-256 HMAC keyed by STRAVA_STATE_SECRET (falls back to
// CRON_SECRET). Mismatch → fail redirect, no token write.
//
// Cite docs/2026-06-05-backend-audit.html § P0-2.
function getStateSecret(): string | null {
  return process.env.STRAVA_STATE_SECRET || process.env.CRON_SECRET || null;
}

function verifyState(signedState: string): { userId: string; platform: 'web' | 'ios' } | null {
  const parts = signedState.split('.');
  if (parts.length !== 3) return null;
  const [payload, nonce, providedHmacB64] = parts;
  const secret = getStateSecret();
  if (!secret) return null;
  const expected = createHmac('sha256', secret).update(`${payload}.${nonce}`).digest();
  let provided: Buffer;
  try { provided = Buffer.from(providedHmacB64, 'base64url'); } catch { return null; }
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  const [userId, platTag] = payload.split(':');
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return null;
  }
  return { userId, platform: platTag === 'ios' ? 'ios' : 'web' };
}

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

/**
 * Strip the platform suffix off the `state` value · returns
 * `{ userId, platform }`. Web flow encoded `state = <uuid>`, iPhone
 * flow encoded `state = <uuid>:ios`.
 */
function decodeState(state: string): { userId: string; platform: 'web' | 'ios' } {
  if (state.endsWith(':ios')) {
    return { userId: state.slice(0, -':ios'.length), platform: 'ios' };
  }
  return { userId: state, platform: 'web' };
}

/**
 * Build the post-OAuth redirect.
 *   · web · /today?strava=connected|failed&...
 *   · ios · faff://strava/callback?status=connected|failed&...
 *     ASWebAuthenticationSession on the iPhone catches the faff://
 *     URL and hands control back to the SwiftUI caller.
 */
function appRedirect(
  req: NextRequest,
  platform: 'web' | 'ios',
  status: 'connected' | 'failed',
  extra: Record<string, string> = {},
): NextResponse {
  if (platform === 'ios') {
    const url = new URL('faff://strava/callback');
    url.searchParams.set('status', status);
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    return NextResponse.redirect(url.toString());
  }
  const url = new URL('/today', publicOrigin(req));
  url.searchParams.set('strava', status);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return NextResponse.redirect(url.toString());
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateRaw = req.nextUrl.searchParams.get('state');
  const stravaErr = req.nextUrl.searchParams.get('error');

  // 2026-06-05 · backend audit P0-2 · verify signed state. Reject
  // the entire flow if it's not properly HMAC-signed · this stops
  // the cross-user Strava-link-hijack attack the audit named.
  // Failure UX: bounce to the web redirect with a clear msg (we
  // can't infer platform from an unverified state, so we default
  // to web · the iPhone OAuth flow surfaces the same failure via
  // its catch-all redirect handler).
  let stateVerified: { userId: string; platform: 'web' | 'ios' } | null = null;
  if (stateRaw) {
    stateVerified = verifyState(stateRaw);
    // Backward-compat for legacy unsigned state · accept ONLY when
    // the secret isn't configured (dev/local), then log the warning.
    if (!stateVerified && !getStateSecret()) {
      console.warn(`[strava/callback] state secret not configured · falling back to legacy unsigned decode (dev only)`);
      stateVerified = (() => {
        const decoded = decodeState(stateRaw);
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.userId)) {
          return decoded;
        }
        return null;
      })();
    }
    if (!stateVerified) {
      console.warn(`[strava/callback] invalid state · rejecting OAuth flow · state=${stateRaw.slice(0, 16)}…`);
      return appRedirect(req, 'web', 'failed', { msg: 'state verification failed · please try Connect Strava again' });
    }
  }
  const state = stateVerified?.userId ?? '';
  const platform = stateVerified?.platform ?? 'web';

  // User canceled the consent screen, or Strava returned an error.
  if (stravaErr) {
    return appRedirect(req, platform, 'failed', { msg: stravaErr.slice(0, 200) });
  }
  if (!code || !state) {
    return appRedirect(req, platform, 'failed', { msg: 'missing code or state' });
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return appRedirect(req, platform, 'failed', { msg: 'server not configured' });
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
      return appRedirect(req, platform, 'failed', {
        msg: `token exchange ${tokenResp.status}: ${txt.slice(0, 160)}`,
      });
    }
    tokens = await tokenResp.json();
  } catch (err: any) {
    return appRedirect(req, platform, 'failed', { msg: `network: ${err?.message ?? 'unknown'}` });
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
    return appRedirect(req, platform, 'failed', { msg: `db: ${e?.message?.slice(0, 160)}` });
  }

  // Connect-time backfill — pull a full year of history right now so the
  // runner's volume / VDOT / training-state are alive from minute one, the way
  // Apple Health's 365-day import already is. Previously connecting Strava only
  // stored a token and nothing reached `runs` until the nightly cron (up to
  // ~24h later).
  //
  // Fire-and-forget: do NOT block the OAuth redirect on a paginated, rate-
  // limited fetch (the runner is staring at the auth sheet). Railway runs a
  // persistent Node process, so the promise resolves in the background after
  // the redirect; the nightly cron is the safety net if the process restarts
  // mid-pull. pullSyncOneUser is idempotent (matched, not double-inserted), so
  // a 365-day pull on every connect / reconnect is safe.
  void pullSyncOneUser({ userUuid: state, windowDays: 365 })
    .then((r) => console.log(
      `[strava/callback] connect-time backfill ${state}:`,
      JSON.stringify({ fetched: r.fetched, inserted: r.inserted, matched: r.matched, errors: r.errors.slice(0, 3) }),
    ))
    .catch((e) => console.error(
      `[strava/callback] connect-time backfill failed ${state}:`, e?.message ?? e,
    ));

  return appRedirect(req, platform, 'connected', { scope: grantedScope });
}
