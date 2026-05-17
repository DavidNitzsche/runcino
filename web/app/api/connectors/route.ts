/**
 * GET /api/connectors — list the current user's connectors.
 *
 * Returns { connectors: [{ provider, connected_at, last_sync_at,
 *   activities_count, disconnected_at }] } — never the actual tokens.
 *
 * Used by /profile Connectors card + the day-1 Connect banner to
 * decide whether to show its prompt.
 */

import { NextResponse } from 'next/server';
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

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await query<ConnectorPublic>(
    `SELECT provider, provider_user_id, connected_at, disconnected_at,
            last_sync_at, last_sync_status, activities_count
     FROM connector_tokens
     WHERE user_id = $1 AND disconnected_at IS NULL
     ORDER BY connected_at DESC;`,
    [user.id],
  );

  return NextResponse.json({ connectors: rows });
}
