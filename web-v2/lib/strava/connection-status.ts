/**
 * Strava connection status resolver (2026-05-28, P-STRAVA-401-UX).
 *
 * Detects when a user's Strava token is "alive on file but dead on the wire" —
 * the most common failure mode after the `activity:write` scope was added
 * (older tokens still hold the OAuth grant but 401 forever on push).
 *
 * Three states surfaced app-wide:
 *
 *   - connected:     row exists in connector_tokens (or legacy profile.*),
 *                    AND no recent strava_pushes row failed with 401, AND
 *                    last_sync_error isn't PUSH_401_REAUTH_REQUIRED.
 *   - needs_reauth:  row exists BUT either:
 *                       a) connector_tokens.last_sync_error = 'PUSH_401_REAUTH_REQUIRED'
 *                          (set by push.ts when /uploads returns 401), OR
 *                       b) the most-recent strava_pushes row is status='failed'
 *                          AND error_message contains '401' (defensive — the
 *                          connector_tokens column may not yet be populated for
 *                          users whose 401 happened before the upgrade landed).
 *   - disconnected:  no token row at all, or disconnected_at is set.
 *
 * No new columns. Reads the same tables push.ts already writes to. The
 * detection is on-the-fly so a successful re-OAuth (which clears
 * last_sync_error in the callback) flips the state back to "connected" the
 * next time this loader runs.
 */
import { pool } from '@/lib/db/pool';

export type StravaConnectionState = 'connected' | 'needs_reauth' | 'disconnected';

export interface StravaConnectionStatus {
  state: StravaConnectionState;
  /** ISO timestamp of the last successful push (status='uploaded'). null when none. */
  last_push_at: string | null;
  /** Short human-readable reason. Only set when state !== 'connected'. */
  reason?: string;
}

/**
 * Resolve the user's current Strava connection state for surfacing in the UI.
 *
 * Cheap: three small indexed queries. Safe to call from every server-rendered
 * surface (today, log, profile). All catch internally and degrade to
 * 'disconnected' on DB error so the page still renders.
 */
export async function loadStravaConnectionStatus(
  userId: string
): Promise<StravaConnectionStatus> {
  // 1. Is there a token on file at all? Mirror getStravaToken's read order:
  //    connector_tokens (source of truth) first, then legacy profile.*.
  const connector = (await pool.query(
    `SELECT access_token, disconnected_at, connected_at,
            last_sync_status, last_sync_error
       FROM connector_tokens
      WHERE COALESCE(user_uuid, user_id) = $1 AND provider = 'strava'
      ORDER BY connected_at DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] as any[] }))).rows[0] ?? null;

  const legacyToken = !connector
    ? (await pool.query(
        `SELECT strava_refresh_token FROM profile WHERE user_uuid = $1`,
        [userId]
      ).catch(() => ({ rows: [] as any[] }))).rows[0]?.strava_refresh_token ?? null
    : null;

  const hasToken =
    (connector?.access_token && !connector?.disconnected_at) ||
    Boolean(legacyToken);

  if (!hasToken) {
    return { state: 'disconnected', last_push_at: null, reason: 'No Strava token on file.' };
  }

  // 2. Last successful push (for the "Last sync N ago" display).
  const lastOk = (await pool.query(
    `SELECT pushed_at::text AS pushed_at
       FROM strava_pushes
      WHERE user_uuid = $1 AND status = 'uploaded'
      ORDER BY pushed_at DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] as any[] }))).rows[0] ?? null;
  const last_push_at: string | null = lastOk?.pushed_at ?? null;

  // 3. Is the token effectively dead? Two checks combine:
  //    a) connector_tokens.last_sync_error = 'PUSH_401_REAUTH_REQUIRED'
  //       (written by push.ts on a 401)
  //    b) most-recent strava_pushes row is 'failed' AND mentions 401.
  //       This is the fallback for users whose tokens predate the
  //       last_sync_error column being wired up.
  const connectorSaysReauth =
    connector?.last_sync_status === 'error' &&
    typeof connector?.last_sync_error === 'string' &&
    /401|REAUTH/i.test(connector.last_sync_error);

  let pushSaysReauth = false;
  if (!connectorSaysReauth) {
    // 2026-06-01 fix · only consider push failures AFTER the most recent
    // connected_at. A failed push from BEFORE the last reconnect tells
    // us nothing about the current token's scope · the runner already
    // re-authorized to fix that. Without this guard, David's banner
    // kept showing "needs reauth" because his 5/28 failed pushes
    // (predating the activity:write reconnect) sat as the most recent
    // strava_pushes row and matched the /401/ regex forever.
    const recent = (await pool.query(
      `SELECT status, error_message
         FROM strava_pushes
        WHERE user_uuid = $1
          AND ($2::timestamptz IS NULL OR pushed_at > $2::timestamptz)
        ORDER BY pushed_at DESC LIMIT 1`,
      [userId, connector?.connected_at ?? null]
    ).catch(() => ({ rows: [] as any[] }))).rows[0] ?? null;
    if (recent?.status === 'failed') {
      const msg = String(recent.error_message ?? '');
      if (/\b401\b|REAUTH/i.test(msg)) pushSaysReauth = true;
    }
  }

  if (connectorSaysReauth || pushSaysReauth) {
    return {
      state: 'needs_reauth',
      last_push_at,
      reason: 'Most recent Strava push failed with 401 — token likely missing activity:write scope.',
    };
  }

  return { state: 'connected', last_push_at };
}

/**
 * Returns the run ids (data->>'id' / activityId) for runs whose most-recent
 * push failed with a 401-flavored error. Used by /log to render per-row
 * "needs reauth" chips next to those runs.
 *
 * Bounded by the supplied run-id allowlist so it's cheap even on long logs.
 */
export async function loadReauthFailedRunIds(
  userId: string,
  runIds: string[]
): Promise<Set<string>> {
  if (runIds.length === 0) return new Set();
  // Only consider runs whose LATEST push attempt was the failed-401. A later
  // successful retry clears the chip. DISTINCT ON (run_id) on the descending
  // order gives the most-recent row per run.
  const rows = (await pool.query(
    `SELECT DISTINCT ON (run_id) run_id, status, error_message
       FROM strava_pushes
      WHERE user_uuid = $1 AND run_id = ANY($2::text[])
      ORDER BY run_id, pushed_at DESC`,
    [userId, runIds]
  ).catch(() => ({ rows: [] as any[] }))).rows;
  const out = new Set<string>();
  for (const r of rows) {
    if (r.status !== 'failed') continue;
    const msg = String(r.error_message ?? '');
    if (/\b401\b|REAUTH/i.test(msg)) out.add(String(r.run_id));
  }
  return out;
}
