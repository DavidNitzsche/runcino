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
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';

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

async function connectURL(req: NextRequest) {
  const userId = await userIdFromRequest(req);
  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirect = process.env.STRAVA_OAUTH_REDIRECT
    ?? `${req.nextUrl.origin}/api/auth/strava?action=callback`;
  if (!clientId) {
    return NextResponse.json({ error: 'STRAVA_CLIENT_ID not set' }, { status: 503 });
  }
  // We pass the user_uuid in `state` so the callback knows which profile
  // row to update. Server-side session cookies would be cleaner; this is
  // good enough for beta.
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', 'read,activity:read_all,activity:write');
  url.searchParams.set('state', userId);
  return NextResponse.json({ url: url.toString() });
}

async function callback(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) {
    return NextResponse.json({ error: 'missing code or state' }, { status: 400 });
  }
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

  try {
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
  } catch (e: any) {
    return NextResponse.json({ error: `persist failed: ${e?.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, athlete_id: athleteId, expires_at: expiresAt });
}

async function disconnect(req: NextRequest) {
  const userId = await userIdFromRequest(req);
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
