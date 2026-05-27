/**
 * Strava token helpers.
 *
 * `getStravaToken(userId)` returns a valid access token, refreshing on
 * expiry. Used by every server route that hits Strava's API.
 *
 * 2026-05-27 fix: token storage drifted to two locations:
 *   - `connector_tokens` (newer, normalized, multi-provider) — populated
 *     by the active OAuth flow.
 *   - `profile.strava_*` (legacy, single-provider columns) — older flow.
 *
 * David's connector_tokens row had valid access+refresh; his profile
 * row had NULLs. The reader was hitting profile.* and throwing
 * STRAVA_NOT_CONNECTED — that's why GPX finder said "Strava not
 * connected to enable GPX search."
 *
 * Now: read connector_tokens first, fall back to profile.* for any
 * legacy users not yet migrated. Refresh writes BOTH so they stay in
 * sync. Long-term: drop profile.strava_* columns once we're sure all
 * users have connector_tokens rows.
 */
import { pool } from '@/lib/db/pool';

interface TokenTriple {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
}

/**
 * Return a valid access token for the user. Refreshes if within 5 minutes
 * of expiry. Throws when the user has never connected or the refresh
 * fails (token revoked, app deauthorized, etc.) — caller should treat as
 * "Strava not connected" and surface a connect prompt.
 */
export async function getStravaToken(userId: string): Promise<string> {
  // Source of truth: connector_tokens table. Read that first.
  let triple: TokenTriple | null = (await pool.query<TokenTriple>(
    `SELECT access_token, refresh_token, expires_at::text AS expires_at
       FROM connector_tokens
      WHERE user_id = $1 AND provider = 'strava' AND disconnected_at IS NULL
      ORDER BY connected_at DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] as TokenTriple[] }))).rows[0] ?? null;

  // Legacy fallback for any user whose tokens still live on profile.*
  if (!triple?.access_token || !triple.refresh_token) {
    const legacy = (await pool.query(
      `SELECT strava_access_token AS access_token,
              strava_refresh_token AS refresh_token,
              strava_expires_at::text AS expires_at
         FROM profile WHERE user_uuid = $1`,
      [userId]
    ).catch(() => ({ rows: [] }))).rows[0];
    if (legacy?.access_token && legacy?.refresh_token) triple = legacy;
  }

  if (!triple?.access_token || !triple.refresh_token) {
    throw new Error('STRAVA_NOT_CONNECTED');
  }

  const now = Date.now();
  const expiresAt = triple.expires_at ? new Date(triple.expires_at).getTime() : 0;
  // Refresh if expired OR within 5 minutes of expiry. Avoids races where
  // a token expires mid-request.
  if (now < expiresAt - 5 * 60 * 1000) {
    return triple.access_token;
  }

  return refreshStravaToken(userId, triple.refresh_token);
}

/**
 * Force-refresh a user's token using their stored refresh_token.
 * Persists the new triplet (access, refresh, expires_at) before returning.
 */
async function refreshStravaToken(userId: string, refreshToken: string): Promise<string> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('STRAVA_CLIENT_ID/SECRET not configured');
  }
  const resp = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`STRAVA_REFRESH_FAILED: ${resp.status} ${txt.slice(0, 200)}`);
  }
  const tokens: any = await resp.json();
  const newAccess = tokens.access_token as string;
  const newRefresh = (tokens.refresh_token as string) ?? refreshToken;
  const newExpires = tokens.expires_at
    ? new Date(tokens.expires_at * 1000).toISOString()
    : null;

  // Write to BOTH stores so connector_tokens (source of truth) and the
  // legacy profile.* columns stay in sync until the legacy columns are
  // dropped. UPDATE-only on connector_tokens — INSERT happens via the
  // OAuth callback when the user first connects.
  await Promise.all([
    pool.query(
      `UPDATE connector_tokens
          SET access_token  = $1,
              refresh_token = $2,
              expires_at    = $3::timestamptz,
              updated_at    = NOW()
        WHERE user_id = $4 AND provider = 'strava'`,
      [newAccess, newRefresh, newExpires, userId]
    ),
    pool.query(
      `UPDATE profile
          SET strava_access_token  = $1,
              strava_refresh_token = $2,
              strava_expires_at    = $3
        WHERE user_uuid = $4`,
      [newAccess, newRefresh, newExpires, userId]
    ),
  ]);
  return newAccess;
}

/** True if the user has a Strava connection (token row present). Cheap check. */
export async function hasStravaConnection(userId: string): Promise<boolean> {
  // Mirror getStravaToken's read order: connector_tokens first, fall
  // back to legacy profile.* columns.
  const conn = (await pool.query(
    `SELECT 1 FROM connector_tokens
      WHERE user_id = $1 AND provider = 'strava'
        AND access_token IS NOT NULL AND disconnected_at IS NULL LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  if (conn) return true;
  const legacy = (await pool.query(
    `SELECT 1 FROM profile WHERE user_uuid = $1 AND strava_refresh_token IS NOT NULL`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  return Boolean(legacy);
}
