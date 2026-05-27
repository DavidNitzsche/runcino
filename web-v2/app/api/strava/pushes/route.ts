/**
 * GET /api/strava/pushes — recent push history for the connection card.
 *
 * Returns the most recent 10 strava_pushes rows for the authenticated user.
 * Used by /profile to render "Last 3 pushes" widget + retry buttons.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const userId = await userIdFromRequest(req);

  const rows = (await pool.query(
    `SELECT id, run_id, status, strava_activity_id, title, privacy,
            error_message, pushed_at, completed_at
       FROM strava_pushes
      WHERE user_uuid = $1
      ORDER BY pushed_at DESC
      LIMIT 10`,
    [userId]
  )).rows;

  return NextResponse.json({ pushes: rows });
}
