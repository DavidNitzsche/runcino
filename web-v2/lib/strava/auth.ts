/**
 * Strava token helpers.
 *
 * `getStravaToken(userId)` returns a valid access token, refreshing on
 * expiry. Used by every server route that hits Strava's API.
 *
 * Tokens live in profile.strava_access_token / strava_refresh_token /
 * strava_expires_at (epoch-aware ISO timestamp). The OAuth flow at
 * /api/auth/strava persists them on initial connect.
 */
import { pool } from '@/lib/db/pool';

interface StravaTokenRow {
  strava_access_token: string | null;
  strava_refresh_token: string | null;
  strava_expires_at: string | null;
}

/**
 * Return a valid access token for the user. Refreshes if within 5 minutes
 * of expiry. Throws when the user has never connected or the refresh
 * fails (token revoked, app deauthorized, etc.) — caller should treat as
 * "Strava not connected" and surface a connect prompt.
 */
export async function getStravaToken(userId: string): Promise<string> {
  const row = (await pool.query<StravaTokenRow>(
    `SELECT strava_access_token, strava_refresh_token, strava_expires_at
       FROM profile WHERE user_uuid = $1`,
    [userId]
  )).rows[0];
  if (!row?.strava_access_token || !row.strava_refresh_token) {
    throw new Error('STRAVA_NOT_CONNECTED');
  }

  const now = Date.now();
  const expiresAt = row.strava_expires_at ? new Date(row.strava_expires_at).getTime() : 0;
  // Refresh if expired OR within 5 minutes of expiry. Avoids races where
  // a token expires mid-request.
  if (now < expiresAt - 5 * 60 * 1000) {
    return row.strava_access_token;
  }

  return refreshStravaToken(userId, row.strava_refresh_token);
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

  await pool.query(
    `UPDATE profile
        SET strava_access_token  = $1,
            strava_refresh_token = $2,
            strava_expires_at    = $3
      WHERE user_uuid = $4`,
    [newAccess, newRefresh, newExpires, userId]
  );
  return newAccess;
}

/** True if the user has a Strava connection (token row present). Cheap check. */
export async function hasStravaConnection(userId: string): Promise<boolean> {
  const row = (await pool.query(
    `SELECT 1 FROM profile WHERE user_uuid = $1 AND strava_refresh_token IS NOT NULL`,
    [userId]
  )).rows[0];
  return Boolean(row);
}
