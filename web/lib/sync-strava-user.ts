/**
 * Multi-tenant Strava sync.
 *
 * The single canonical sync path for faff.run: takes a user UUID,
 * reads that user's refresh_token from connector_tokens, refreshes it
 * against Strava, pulls every activity from Jan 1 of the current year
 * to today, upserts into strava_activities (keyed by user_uuid), and
 * updates the connector row's last_sync_at + activities_count.
 *
 * Called from:
 *   - /api/strava/callback (right after OAuth completes, fire-and-forget)
 *   - /api/strava/sync-me  (manual "Sync now" button on /profile)
 *
 * Replaces the legacy STRAVA_REFRESH_TOKEN env-var path in lib/strava.ts +
 * lib/strava-cache.ts for everything user-scoped. Keep this as the only
 * place that fetches activities; never let two sync paths drift again.
 */

import { query, withClient } from './db';
import { normalizeActivity } from '../app/api/strava/activities/route-shared';
import type { StravaActivity } from './strava';

export interface SyncResult {
  ok: true;
  fetched: number;
  totalAfter: number;
  lastSyncAt: string;
}

export interface SyncError {
  ok: false;
  error: string;
  /** When the failure was the refresh-token swap, the connector row is
   *  likely stale — the user needs to reconnect Strava. */
  needsReconnect?: boolean;
}

/**
 * Returns `null` if the user isn't connected, the existing sync stats
 * are still fresh (within ttlSeconds), or sync would otherwise no-op.
 * Otherwise calls syncStravaForUser() and returns its result.
 *
 * Page loaders call this awaited at the top so the user sees current
 * data without needing to hit the "Sync now" button. The 5-min TTL
 * means a typical session never triggers more than one sync per page,
 * and a refresh inside that window is free.
 */
export async function syncStravaIfStale(userId: string, ttlSeconds = 300): Promise<SyncResult | SyncError | null> {
  const rows = await query<{ last_sync_at: Date | null }>(
    `SELECT last_sync_at
       FROM connector_tokens
      WHERE user_id = $1 AND provider = 'strava' AND disconnected_at IS NULL
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  const lastSyncMs = row.last_sync_at ? new Date(row.last_sync_at).getTime() : 0;
  if (lastSyncMs > 0) {
    const ageSec = (Date.now() - lastSyncMs) / 1000;
    if (ageSec < ttlSeconds) return null;
  }
  try {
    return await syncStravaForUser(userId);
  } catch (e) {
    console.error('[sync-strava-user] stale-sync threw for', userId, ':', e);
    return { ok: false, error: e instanceof Error ? e.message : 'sync threw' };
  }
}

interface TokenRow {
  access_token: string;
  refresh_token: string | null;
  expires_at: Date | null;
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Strava client credentials not configured in env');

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token refresh failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_at: number };
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_at };
}

async function fetchYtdActivities(accessToken: string): Promise<StravaActivity[]> {
  const yearStart = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
  const all: StravaActivity[] = [];
  let page = 1;
  while (true) {
    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    url.searchParams.set('after', String(yearStart));
    url.searchParams.set('per_page', '200');
    url.searchParams.set('page', String(page));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Strava activities fetch failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const batch = (await res.json()) as StravaActivity[];
    all.push(...batch);
    if (batch.length < 200) break;
    page++;
    if (page > 20) break; // safety cap: 4000 activities
  }
  return all;
}

/**
 * Sync Strava activities for a single user. Returns a tagged result
 * the caller can branch on. Never throws — failures come back as
 * { ok: false, error }.
 */
export async function syncStravaForUser(userId: string): Promise<SyncResult | SyncError> {
  // 1. Look up the user's Strava token row.
  const rows = await query<TokenRow>(
    `SELECT access_token, refresh_token, expires_at
       FROM connector_tokens
      WHERE user_id = $1 AND provider = 'strava' AND disconnected_at IS NULL
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: 'Strava is not connected for this user.' };
  if (!row.refresh_token) {
    return { ok: false, error: 'No refresh token on file — reconnect Strava.', needsReconnect: true };
  }

  // 2. Refresh the access token. Strava rotates refresh tokens on each
  //    use, so we have to persist the new one before doing anything else
  //    or we'll be locked out.
  let accessToken: string;
  let newRefreshToken: string;
  let newExpiresAt: number;
  try {
    const t = await refreshAccessToken(row.refresh_token);
    accessToken = t.accessToken;
    newRefreshToken = t.refreshToken;
    newExpiresAt = t.expiresAt;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'token refresh failed';
    console.error('[sync-strava-user] refresh failed for', userId, ':', msg);
    await query(
      `UPDATE connector_tokens
          SET last_sync_at = NOW(), last_sync_status = 'error', last_sync_error = $2
        WHERE user_id = $1 AND provider = 'strava'`,
      [userId, msg],
    );
    // 400 from Strava on a stale refresh means the token's been revoked;
    // most clean way out is to have the user reconnect.
    const needsReconnect = /400|invalid|revoked/i.test(msg);
    return { ok: false, error: msg, needsReconnect };
  }

  await query(
    `UPDATE connector_tokens
        SET access_token = $2,
            refresh_token = $3,
            expires_at = $4,
            last_sync_status = 'in_progress',
            updated_at = NOW()
      WHERE user_id = $1 AND provider = 'strava'`,
    [userId, accessToken, newRefreshToken, new Date(newExpiresAt * 1000)],
  );

  // 3. Pull YTD activities from Strava.
  let activities: StravaActivity[];
  try {
    activities = await fetchYtdActivities(accessToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'activity fetch failed';
    console.error('[sync-strava-user] fetch failed for', userId, ':', msg);
    await query(
      `UPDATE connector_tokens
          SET last_sync_at = NOW(), last_sync_status = 'error', last_sync_error = $2
        WHERE user_id = $1 AND provider = 'strava'`,
      [userId, msg],
    );
    return { ok: false, error: msg };
  }

  // 4. Upsert into strava_activities — keyed by user_uuid so multi-tenant
  //    queries can scope by user. One transaction so partial failure
  //    rolls back cleanly.
  const fetchedAt = new Date();
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const a of activities) {
        const norm = normalizeActivity(a);
        await client.query(
          `INSERT INTO strava_activities (id, data, fetched_at, user_uuid)
                VALUES ($1, $2::jsonb, $3, $4)
           ON CONFLICT (id) DO UPDATE
              SET data       = EXCLUDED.data,
                  fetched_at = EXCLUDED.fetched_at,
                  user_uuid  = COALESCE(strava_activities.user_uuid, EXCLUDED.user_uuid)`,
          [a.id, JSON.stringify(norm), fetchedAt.toISOString(), userId],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });

  // 5. Update connector row stats.
  const [{ cnt }] = await query<{ cnt: string }>(
    `SELECT COUNT(*)::int AS cnt FROM strava_activities WHERE user_uuid = $1`,
    [userId],
  );
  await query(
    `UPDATE connector_tokens
        SET last_sync_at      = NOW(),
            last_sync_status  = 'success',
            last_sync_error   = NULL,
            activities_count  = $2,
            updated_at        = NOW()
      WHERE user_id = $1 AND provider = 'strava'`,
    [userId, parseInt(cnt, 10)],
  );

  return {
    ok: true,
    fetched: activities.length,
    totalAfter: parseInt(cnt, 10),
    lastSyncAt: fetchedAt.toISOString(),
  };
}
