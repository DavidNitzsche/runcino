/**
 * Connector helpers — server-side checks used by every protected
 * page to decide whether to render the Connect Strava banner.
 *
 * Source: connector_tokens table (per-user OAuth credentials).
 */

import { query } from './db';

interface ConnectorRow {
  provider: string;
  last_sync_at: Date | null;
  activities_count: number;
}

/**
 * Returns the list of active (non-disconnected) connectors for a user.
 * If the table doesn't exist yet (older deploy mid-bootstrap), returns []
 * gracefully instead of throwing.
 */
export async function listUserConnectors(userId: string): Promise<ConnectorRow[]> {
  try {
    return await query<ConnectorRow>(
      `SELECT provider, last_sync_at, activities_count
       FROM connector_tokens
       WHERE user_id = $1 AND disconnected_at IS NULL`,
      [userId],
    );
  } catch {
    return [];
  }
}

/**
 * Has the user connected at least one activity source? Pages use this
 * to decide whether to render the Connect Strava banner.
 *
 * "Activity sources" are providers that actually feed runs into the
 * runs table — Strava, Garmin, etc. (Whoop/Oura don't count.)
 */
export async function userHasActivitySource(userId: string): Promise<boolean> {
  const ACTIVITY_PROVIDERS = new Set([
    'strava', 'garmin', 'apple_health', 'coros',
    'polar', 'suunto', 'wahoo', 'google_fit',
  ]);
  const conns = await listUserConnectors(userId);
  return conns.some((c) => ACTIVITY_PROVIDERS.has(c.provider));
}
