/**
 * GET /api/connectors — list the current user's connectors.
 *
 * Returns { connectors: [{ provider, connected_at, last_sync_at,
 *   activities_count, disconnected_at }] } — never the actual tokens.
 *
 * Used by /profile Connectors card + the day-1 Connect banner to
 * decide whether to show its prompt.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../lib/auth';
import { query } from '../../../lib/db';

interface ConnectorPublic {
  provider: string;
  provider_user_id: string | null;
  connected_at: Date;
  disconnected_at: Date | null;
  last_sync_at: Date | null;
  last_sync_status: string | null;
  activities_count: number;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Active connectors — what the banner check reads
  const rows = await query<ConnectorPublic>(
    `SELECT provider, provider_user_id, connected_at, disconnected_at,
            last_sync_at, last_sync_status, activities_count
     FROM connector_tokens
     WHERE user_id = $1 AND disconnected_at IS NULL
     ORDER BY connected_at DESC;`,
    [user.id],
  );

  // Debug mode: ?debug=1 returns extra context so a user can see WHY
  // the banner is or isn't showing — common cause is being signed in
  // as a different account than the one that connected Strava.
  if (req.nextUrl.searchParams.get('debug') === '1') {
    // Include disconnected rows + count to spot stale records
    const allRows = await query<ConnectorPublic>(
      `SELECT provider, provider_user_id, connected_at, disconnected_at,
              last_sync_at, last_sync_status, activities_count
       FROM connector_tokens
       WHERE user_id = $1
       ORDER BY connected_at DESC;`,
      [user.id],
    );
    return NextResponse.json({
      connectors: rows,
      debug: {
        currentUser: { id: user.id, email: user.email },
        activeCount: rows.length,
        allCount: allRows.length,
        allRows,
        note: rows.length === 0 && allRows.length > 0
          ? 'You have disconnected rows but no active connectors. Reconnect Strava to write a fresh row.'
          : rows.length === 0 && allRows.length === 0
          ? 'No connector rows for this user. Either Strava callback failed to persist, or you may be signed in as a different account than the one that connected.'
          : 'Active connectors present — banner should hide.',
      },
    });
  }

  return NextResponse.json({ connectors: rows });
}
