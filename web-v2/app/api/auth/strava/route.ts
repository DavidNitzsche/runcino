/**
 * Strava OAuth (P39 / P27.11)
 *
 * Three sub-endpoints in one handler:
 *
 *   GET  /api/auth/strava?action=connect    → returns the OAuth URL
 *                                              to redirect the user to.
 *   GET  /api/auth/strava?action=callback&code=... &state=...
 *                                            → exchanges code for tokens,
 *                                              persists to profile, sets
 *                                              connected_at.
 *   POST /api/auth/strava?action=disconnect → revokes + clears tokens.
 *
 * Env (per deploy):
 *   STRAVA_CLIENT_ID      — public app id
 *   STRAVA_CLIENT_SECRET  — server secret
 *   STRAVA_OAUTH_REDIRECT — full URL to the callback action
 *
 * Per-user tokens land in:
 *   profile.strava_athlete_id
 *   profile.strava_access_token
 *   profile.strava_refresh_token
 *   profile.strava_expires_at
 *   profile.strava_connected_at
 *
 * Replaces the env-var-shared refresh-token scheme (single-user beta).
 * Existing endpoints can still fall back to env tokens until every user
 * has gone through the OAuth flow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

// ── HMAC-signed OAuth state · 2026-06-05 backend audit P0-2 fix ────
//
// Was: state was the raw user_uuid (or "uuid:ios"). The callback
// trusted it verbatim and wrote the attacker's Strava tokens into
// whatever profile row the state pointed at. Anyone who saw a
// victim's user_uuid in a URL, log, or the connect-action JSON
// response could hijack their Strava link.
//
// Now: state is `<payload>.<nonce>.<hmac>` where:
//   · payload = the original "<uuid>" or "<uuid>:ios" string
//   · nonce   = 8 random bytes (base64url · replay defense per request)
//   · hmac    = SHA-256 of "<payload>.<nonce>" keyed by a server secret
//
// On callback we verify the HMAC (timing-safe compare). Failed
// verification → 401, no token write. The secret comes from
// STRAVA_STATE_SECRET; if that's unset we fall back to CRON_SECRET
// (which is already configured in prod for the cron auth). Throws
// at signing time if neither is set, so misconfiguration surfaces
// loudly instead of silently disabling the security gate.
//
// In-flight OAuth flows started before this lands will fail
// verification on return · runner just clicks Connect Strava again.
// Cite docs/2026-06-05-backend-audit.html § P0-2.

function getStateSecret(): string {
  const s = process.env.STRAVA_STATE_SECRET || process.env.CRON_SECRET;
  if (!s) {
    throw new Error('STRAVA_STATE_SECRET (or CRON_SECRET) must be set · OAuth state signing requires a server secret');
  }
  return s;
}

function signState(payload: string): string {
  const nonce = randomBytes(8).toString('base64url');
  const data = `${payload}.${nonce}`;
  const hmac = createHmac('sha256', getStateSecret()).update(data).digest('base64url');
  return `${data}.${hmac}`;
}

function verifyState(signedState: string): { userId: string; platform: 'web' | 'ios' } | null {
  const parts = signedState.split('.');
  if (parts.length !== 3) return null;
  const [payload, nonce, providedHmacB64] = parts;
  let secret: string;
  try { secret = getStateSecret(); } catch { return null; }
  const expected = createHmac('sha256', secret).update(`${payload}.${nonce}`).digest();
  let provided: Buffer;
  try { provided = Buffer.from(providedHmacB64, 'base64url'); } catch { return null; }
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  // payload shape: "<user_uuid>" or "<user_uuid>:ios"
  const [userId, platTag] = payload.split(':');
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return null;
  }
  return { userId, platform: platTag === 'ios' ? 'ios' : 'web' };
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') ?? 'connect';
  if (action === 'connect') return connectURL(req);
  if (action === 'callback') return callback(req);
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') ?? 'disconnect';
  if (action === 'disconnect') return disconnect(req);
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

/**
 * Public origin of the request, computed from the proxy headers Railway
 * sets. `req.nextUrl.origin` resolves to Railway's INTERNAL binding
 * (https://0.0.0.0:8080) which is what was breaking Strava OAuth · the
 * redirect_uri sent to Strava was literally `https://0.0.0.0:8080/...`,
 * Strava obediently redirected the browser there, the browser couldn't
 * resolve 0.0.0.0, and the runner saw a 404. This reads x-forwarded-host
 * / host headers so the URL is the real public faff.run domain.
 */
function publicOrigin(req: NextRequest): string {
  // Env-var override wins · most reliable on Railway where the proxy
  // doesn't reliably set x-forwarded-host.
  const env = process.env.NEXT_PUBLIC_APP_ORIGIN
    || process.env.APP_ORIGIN
    || process.env.PUBLIC_URL;
  if (env) return env.replace(/\/+$/, '');

  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host')
    ?? req.headers.get('host')
    ?? 'www.faff.run';
  // Defensively skip the container-internal binding · if Host came
  // through as the bind address we'd loop right back into the bug.
  if (/^(0\.0\.0\.0|127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    return 'https://www.faff.run';
  }
  return `${proto}://${host}`;
}

async function connectURL(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const clientId = process.env.STRAVA_CLIENT_ID;
  // 2026-06-01 fix #2: build redirect_uri from the PUBLIC origin (via
  // x-forwarded-host), not req.nextUrl.origin which Railway sets to
  // the internal 0.0.0.0:8080 binding. Strava was being told to
  // redirect users to https://0.0.0.0:8080/... and the browser
  // (correctly) couldn't reach that · that's the 404 David saw.
  const redirect = process.env.STRAVA_OAUTH_REDIRECT
    ?? `${publicOrigin(req)}/api/auth/strava/callback`;
  if (!clientId) {
    return NextResponse.json({ error: 'STRAVA_CLIENT_ID not set' }, { status: 503 });
  }
  // We pass the user_uuid in `state` so the callback knows which profile
  // row to update. Server-side session cookies would be cleaner; this is
  // good enough for beta.
  //
  // 2026-06-01 fix: approval_prompt MUST be 'force'. With 'auto' Strava
  // skips the consent screen for any already-authorized app and returns
  // to the EXISTING token with the EXISTING scope · which is exactly
  // what we're trying to expand on. David's account authorized in May
  // before activity:write was on the request; clicking RECONNECT with
  // approval_prompt=auto silently re-granted the same read-only scope
  // and the banner came right back. Force the dialog every time so the
  // scope expansion actually lands.
  // Encode the originating platform in `state` so the callback knows
  // where to send the user back to after the token exchange:
  //   · `<uuid>` · web · callback 302s to /today
  //   · `<uuid>:ios` · iPhone · callback 302s to faff://strava/callback
  //     which the app catches via ASWebAuthenticationSession
  const platform = req.nextUrl.searchParams.get('platform') === 'ios' ? 'ios' : 'web';
  // 2026-06-05 · backend audit P0-2 · sign state with HMAC so the
  // callback can verify it wasn't forged. Was: raw user_uuid · any
  // observer could replay the callback with a different access code
  // to hijack the runner's Strava link.
  const payload = platform === 'ios' ? `${userId}:ios` : userId;
  let stateValue: string;
  try {
    stateValue = signState(payload);
  } catch (e: unknown) {
    return NextResponse.json({ error: `state-signing misconfigured: ${e instanceof Error ? e.message : String(e)}` }, { status: 503 });
  }

  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'force');
  url.searchParams.set('scope', 'read,activity:read_all,activity:write');
  url.searchParams.set('state', stateValue);

  // Two callers, two response shapes:
  //   · `?redirect=1` · the toolkit banner uses <a href> for direct
  //     browser navigation · we 302 straight to Strava so the runner
  //     never sees JSON in their address bar (which is what was
  //     causing the 404 · banners.tsx used to point at the bogus
  //     /api/strava/connect path and got a real 404 instead).
  //   · default · the legacy components/strava/ReconnectBanner.tsx
  //     fetches this via XHR and reads {url}, then sets
  //     window.location.href itself.
  if (req.nextUrl.searchParams.get('redirect') === '1') {
    return NextResponse.redirect(url.toString());
  }
  return NextResponse.json({ url: url.toString() });
}

async function callback(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  if (!code || !stateParam) {
    return NextResponse.json({ error: 'missing code or state' }, { status: 400 });
  }
  // 2026-06-05 · backend audit P0-2 · verify signed state. Was: state
  // was trusted as cleartext user_uuid, callback wrote tokens into
  // whatever profile.user_uuid = state. Anyone who saw a victim's
  // uuid in a URL or log could hijack their Strava link by crafting
  // a callback to /api/auth/strava?action=callback&code=THEIR_CODE
  // &state=VICTIM_UUID. HMAC verification closes that path · without
  // the secret an attacker can't construct a valid signed state.
  // Cite docs/2026-06-05-backend-audit.html § P0-2.
  const stateVerified = verifyState(stateParam);
  if (!stateVerified) {
    console.warn(`[strava/callback] invalid state · refusing token exchange · state=${stateParam.slice(0,16)}…`);
    return NextResponse.json({ error: 'invalid or unsigned state · oauth flow rejected' }, { status: 401 });
  }
  // From here on, ALL references to the user_uuid go through stateVerified.userId,
  // NEVER the raw `stateParam`. The legacy code referenced `state` directly · we
  // keep the var name for diff readability but the value is now the verified uuid.
  const state = stateVerified.userId;
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'STRAVA_CLIENT_ID/SECRET not configured' }, { status: 503 });
  }

  // Exchange code → tokens
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
    const txt = await tokenResp.text();
    return NextResponse.json({ error: `strava token exchange failed (${tokenResp.status}): ${txt.slice(0,200)}` }, { status: 502 });
  }
  const tokens: any = await tokenResp.json();
  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token;
  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at * 1000).toISOString() : null;
  const athleteId = String(tokens.athlete?.id ?? '');
  // 2026-05-27 P-STRAVA-401: capture scope string so we can detect when
  // a re-auth is needed for new permissions (e.g. older grants without
  // activity:write would 401 on push). Strava returns scope as either
  // a CSV string or, for some flows, undefined — fall back to the
  // scope we requested.
  const grantedScope = (typeof tokens.scope === 'string' && tokens.scope.length > 0)
    ? tokens.scope
    : 'read,activity:read_all,activity:write';

  try {
    // 1. Legacy profile.* columns (kept in sync until they're dropped).
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
    // 2. connector_tokens — THE source of truth getStravaToken reads
    //    first. Without this UPSERT, a user who re-OAuths to pick up
    //    a new scope (e.g. activity:write) would see no change because
    //    the stale connector_tokens row would keep being returned.
    //    David's 401 on push was exactly this: his connector_tokens row
    //    predated activity:write being added, refresh kept the original
    //    scopes, uploads kept 401-ing.
    await pool.query(
      `INSERT INTO connector_tokens (
          user_id, user_uuid, provider, provider_user_id, scope,
          access_token, refresh_token, expires_at,
          connected_at, disconnected_at, updated_at
        )
        VALUES ($1, $1, 'strava', $2, $3, $4, $5, $6::timestamptz, NOW(), NULL, NOW())
        ON CONFLICT (user_id, provider) DO UPDATE
          SET provider_user_id = EXCLUDED.provider_user_id,
              scope            = EXCLUDED.scope,
              access_token     = EXCLUDED.access_token,
              refresh_token    = EXCLUDED.refresh_token,
              expires_at       = EXCLUDED.expires_at,
              user_uuid        = COALESCE(connector_tokens.user_uuid, EXCLUDED.user_uuid),
              connected_at     = NOW(),
              disconnected_at  = NULL,
              updated_at       = NOW()`,
      [state, athleteId, grantedScope, accessToken, refreshToken, expiresAt],
    );
  } catch (e: any) {
    return NextResponse.json({ error: `persist failed: ${e?.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, athlete_id: athleteId, expires_at: expiresAt, scope: grantedScope });
}

async function disconnect(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  // Best-effort token revoke on Strava's side
  try {
    const r = await pool.query(`SELECT strava_access_token FROM profile WHERE user_uuid = $1`, [userId]);
    const token = r.rows[0]?.strava_access_token;
    if (token) {
      await fetch('https://www.strava.com/oauth/deauthorize', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
    }
  } catch { /* best-effort */ }

  await pool.query(
    `UPDATE profile
        SET strava_athlete_id    = NULL,
            strava_access_token  = NULL,
            strava_refresh_token = NULL,
            strava_expires_at    = NULL,
            strava_connected_at  = NULL
      WHERE user_uuid = $1`,
    [userId],
  );
  return NextResponse.json({ ok: true });
}
