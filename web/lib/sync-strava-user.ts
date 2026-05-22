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
   *  likely stale, the user needs to reconnect Strava. */
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
/**
 * Resolve the faff.run user_id for a Strava athlete_id (the `owner_id`
 * field on webhook events). Returns null if we don't have a connected
 * Strava account for that athlete.
 */
export async function findUserByStravaAthleteId(athleteId: number | string): Promise<string | null> {
  const rows = await query<{ user_id: string }>(
    `SELECT user_id::text AS user_id
       FROM connector_tokens
      WHERE provider = 'strava'
        AND provider_user_id = $1
        AND disconnected_at IS NULL
      LIMIT 1`,
    [String(athleteId)],
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Refresh a single activity for a user (used by webhook create/update
 * events). Refreshes the token if needed, fetches just the one activity,
 * upserts it, and updates connector_tokens.last_sync_at. Avoids
 * re-pulling 200+ activities for a single new run.
 */
export async function syncSingleActivity(userId: string, activityId: number): Promise<{ ok: boolean; error?: string }> {
  const rows = await query<TokenRow>(
    `SELECT access_token, refresh_token, expires_at
       FROM connector_tokens
      WHERE user_id = $1 AND provider = 'strava' AND disconnected_at IS NULL
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row?.refresh_token) return { ok: false, error: 'no token' };

  let accessToken: string;
  try {
    const t = await refreshAccessToken(row.refresh_token);
    accessToken = t.accessToken;
    await query(
      `UPDATE connector_tokens
          SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = NOW()
        WHERE user_id = $1 AND provider = 'strava'`,
      [userId, t.accessToken, t.refreshToken, new Date(t.expiresAt * 1000)],
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'token refresh failed' };
  }

  let activity: StravaActivity | null;
  try {
    activity = await fetchActivityById(accessToken, activityId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'activity fetch failed' };
  }
  if (!activity) return { ok: false, error: 'activity not found (404)' };

  const norm = normalizeActivity(activity);
  // SPLITS PRESERVATION (locked 2026-05-19 round 4): the YTD list
  // endpoint doesn't return splits_standard, so list-source normalized
  // activities have no `splits` key. If we full-replace data on every
  // sync, we wipe the per-mile splits backfilled from detail. Use
  // jsonb_set with a guard to copy existing splits forward when the
  // new payload doesn't carry them. Symmetric in both sync paths +
  // single-activity webhook updates.
  await query(
    `INSERT INTO strava_activities (id, data, fetched_at, user_uuid)
          VALUES ($1, $2::jsonb, NOW(), $3)
     ON CONFLICT (id) DO UPDATE
        SET data = CASE
              WHEN strava_activities.data ? 'splits' AND NOT (EXCLUDED.data ? 'splits')
              THEN jsonb_set(EXCLUDED.data, '{splits}', strava_activities.data->'splits')
              ELSE EXCLUDED.data
            END,
            fetched_at = EXCLUDED.fetched_at,
            user_uuid  = COALESCE(strava_activities.user_uuid, EXCLUDED.user_uuid)`,
    [activity.id, JSON.stringify(norm), userId],
  );

  // Bump connector stats
  const [{ cnt }] = await query<{ cnt: string }>(
    `SELECT COUNT(*)::int AS cnt FROM strava_activities WHERE user_uuid = $1`,
    [userId],
  );
  await query(
    `UPDATE connector_tokens
        SET last_sync_at = NOW(), last_sync_status = 'success', activities_count = $2, updated_at = NOW()
      WHERE user_id = $1 AND provider = 'strava'`,
    [userId, parseInt(cnt, 10)],
  );

  // Writeback: rename the Strava activity to match the planned
  // workout. Previously this only fired from the webhook handler, 
  // if Strava's webhook had latency or dropped, the rename never
  // happened. Now syncSingleActivity ALSO triggers writeback as a
  // belt-and-suspenders path. The writeback function itself is
  // idempotent, re-fire safety is handled inside pushWorkoutNameToStrava
  // (skips when the name already looks like a runcino-set name).
  try {
    const { pushWorkoutNameToStrava } = await import('./strava-writeback');
    const { getActivePlanWeeks } = await import('./plan-weeks');
    const dateISO = norm.date || (norm.startLocal || '').slice(0, 10);
    if (dateISO) {
      const weeks = await getActivePlanWeeks();
      let matchedDay = null;
      let matchedWeek = null;
      for (const w of weeks) {
        const d = w.days.find((dd) => dd.date === dateISO);
        if (d) { matchedDay = d; matchedWeek = w; break; }
      }
      if (matchedDay && matchedWeek) {
        const phaseWeeks = weeks.filter((w) => w.phase === matchedWeek!.phase);
        const phaseWeekIdx = phaseWeeks.findIndex((w) => w === matchedWeek) + 1;
        const distanceMi = Number(norm.distanceMi) || 0;
        const movingS = Number(norm.movingTimeS) || 0;
        const paceSPerMi = distanceMi > 0 ? Math.round(movingS / distanceMi) : 0;
        const avgHr = norm.avgHr ? Number(norm.avgHr) : null;
        const result = await pushWorkoutNameToStrava({
          userId,
          activityId: Number(activity.id),
          currentName: norm.name || null,
          currentDescription: (norm as { description?: string | null }).description ?? null,
          day: matchedDay,
          phase: matchedWeek.phase,
          phaseWeek: phaseWeekIdx,
          actual: { distanceMi, paceSPerMi, avgHr },
        });
        console.log('[sync-strava-user] writeback', activity.id,
          result.pushed ? 'PUSHED' : `skipped: ${result.reason}`);
      }
    }
  } catch (e) {
    // Writeback is best-effort, never block the sync on its failure.
    console.warn('[sync-strava-user] writeback failed', activity.id, e);
  }

  // Shoe auto-assign, ported from dev branch commit 29887d6
  // ("feat(sync): shoe-picker with preferred-wins + ambiguity
  // bailout"). Pick a shoe IF the planned workout type maps to
  // a single clear choice in the rotation; bail out otherwise.
  //
  // Gated on the row's CURRENT shoe_id being NULL, never overwrite
  // a manual pick. Re-fire safety: the COALESCE check inside the
  // UPDATE handles concurrent writes from the manual /shoe endpoint.
  try {
    const { pickShoeForWorkout } = await import('./shoe-picker');
    const { getActivePlanWeeks } = await import('./plan-weeks');
    const dateISO = norm.date || (norm.startLocal || '').slice(0, 10);
    if (dateISO) {
      const weeks = await getActivePlanWeeks();
      let matchedDay = null;
      for (const w of weeks) {
        const d = w.days.find((dd) => dd.date === dateISO);
        if (d) { matchedDay = d; break; }
      }
      if (matchedDay && !matchedDay.isRest) {
        const shoeId = await pickShoeForWorkout(userId, matchedDay.type);
        if (shoeId != null) {
          const result = await query<{ assigned: boolean }>(
            `UPDATE strava_activities
                SET shoe_id = $2,
                    shoe_auto_assigned_at = NOW()
              WHERE id = $1
                AND shoe_id IS NULL
              RETURNING TRUE AS assigned`,
            [activity.id, shoeId],
          );
          console.log('[sync-strava-user] shoe',
            result.length > 0 ? `auto-assigned ${shoeId}` : 'skipped (already set)');
        } else {
          console.log('[sync-strava-user] shoe skipped (ambiguous or no match)');
        }
      }
    }
  } catch (e) {
    // Auto-assign is best-effort, never block the sync.
    console.warn('[sync-strava-user] shoe auto-assign failed', activity.id, e);
  }

  return { ok: true };
}

/**
 * Lazy-fetch + cache the FULL Strava activity detail (laps, splits,
 * best_efforts, polyline geometry) for a single activity.
 *
 * The summary sync stores a normalized snapshot via /athlete/activities,
 * which doesn't include per-mile splits. For the run-detail modal we
 * want the splits_standard array. This helper:
 *
 *   1. Looks up the cached detail in strava_activities.detail
 *   2. If missing OR older than 30 days, refreshes the access token
 *      and fetches /activities/{id} fresh
 *   3. Writes the new detail + detail_at back to the row
 *   4. Returns the raw Strava activity object
 *
 * Throws on token failure or Strava 4xx/5xx.
 */
export async function getActivityDetail(userId: string, activityId: number | string): Promise<StravaActivity | null> {
  // 1. Cached?
  const cached = await query<{ detail: StravaActivity | null; detail_at: Date | null }>(
    `SELECT detail, detail_at FROM strava_activities WHERE id = $1 LIMIT 1`,
    [activityId],
  );
  const row = cached[0];
  const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
  const fresh = row?.detail && row.detail_at && (Date.now() - new Date(row.detail_at).getTime()) < THIRTY_DAYS_MS;
  if (fresh && row?.detail) return row.detail;

  // 2. Refresh token + fetch
  const tokenRows = await query<TokenRow>(
    `SELECT access_token, refresh_token, expires_at
       FROM connector_tokens
      WHERE user_id = $1 AND provider = 'strava' AND disconnected_at IS NULL
      LIMIT 1`,
    [userId],
  );
  const t = tokenRows[0];
  if (!t?.refresh_token) return null;

  let accessToken: string;
  try {
    const fresh = await refreshAccessToken(t.refresh_token);
    accessToken = fresh.accessToken;
    await query(
      `UPDATE connector_tokens
          SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = NOW()
        WHERE user_id = $1 AND provider = 'strava'`,
      [userId, fresh.accessToken, fresh.refreshToken, new Date(fresh.expiresAt * 1000)],
    );
  } catch (e) {
    console.error('[strava-detail] refresh failed:', e);
    return row?.detail ?? null; // fall back to stale cache if available
  }

  const detail = await fetchActivityById(accessToken, Number(activityId));
  if (!detail) return null;

  // 3. Cache it back
  await query(
    `UPDATE strava_activities SET detail = $2::jsonb, detail_at = NOW() WHERE id = $1`,
    [activityId, JSON.stringify(detail)],
  );
  return detail;
}

/**
 * Webhook delete event, remove the activity from strava_activities.
 * Idempotent: missing row is a no-op.
 */
export async function deleteActivityForUser(userId: string, activityId: number): Promise<void> {
  await query(
    `DELETE FROM strava_activities WHERE id = $1 AND (user_uuid = $2 OR user_uuid IS NULL)`,
    [activityId, userId],
  );
  const [{ cnt }] = await query<{ cnt: string }>(
    `SELECT COUNT(*)::int AS cnt FROM strava_activities WHERE user_uuid = $1`,
    [userId],
  );
  await query(
    `UPDATE connector_tokens SET activities_count = $2, updated_at = NOW()
      WHERE user_id = $1 AND provider = 'strava'`,
    [userId, parseInt(cnt, 10)],
  );
}

/**
 * Webhook deauth, Strava sends an athlete update with
 * `authorized: false` when the user revokes access from their Strava
 * settings page. Mark the connector disconnected so the app stops
 * trying to use a dead token.
 */
export async function markDeauthorized(userId: string): Promise<void> {
  await query(
    `UPDATE connector_tokens
        SET disconnected_at = NOW(),
            last_sync_status = 'error',
            last_sync_error  = 'Athlete deauthorized via Strava settings'
      WHERE user_id = $1 AND provider = 'strava' AND disconnected_at IS NULL`,
    [userId],
  );
}

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

async function fetchActivityById(accessToken: string, activityId: number): Promise<StravaActivity | null> {
  const url = `https://www.strava.com/api/v3/activities/${activityId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava activity ${activityId} fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as StravaActivity;
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
 * the caller can branch on. Never throws, failures come back as
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
    return { ok: false, error: 'No refresh token on file, reconnect Strava.', needsReconnect: true };
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

  // 4. Upsert into strava_activities, keyed by user_uuid so multi-tenant
  //    queries can scope by user. One transaction so partial failure
  //    rolls back cleanly.
  const fetchedAt = new Date();
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const a of activities) {
        const norm = normalizeActivity(a);
        // SPLITS PRESERVATION: see syncSingleActivity for rationale.
        // YTD sync hits the list endpoint which never returns
        // splits_standard, so naive full-replace nukes the detail-
        // sourced splits we backfilled. Copy existing splits forward
        // when the new (list-source) data doesn't carry them.
        await client.query(
          `INSERT INTO strava_activities (id, data, fetched_at, user_uuid)
                VALUES ($1, $2::jsonb, $3, $4)
           ON CONFLICT (id) DO UPDATE
              SET data = CASE
                    WHEN strava_activities.data ? 'splits' AND NOT (EXCLUDED.data ? 'splits')
                    THEN jsonb_set(EXCLUDED.data, '{splits}', strava_activities.data->'splits')
                    ELSE EXCLUDED.data
                  END,
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
