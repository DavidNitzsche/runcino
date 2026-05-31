/**
 * GET /api/strava/status — connection state for client surfaces.
 *
 * Drives the ReconnectBanner (rendered on /today and /log) and the upgraded
 * StravaConnectionCard on /profile. Three states:
 *
 *   { state: 'connected',     last_push_at: ISO|null }
 *   { state: 'needs_reauth',  last_push_at: ISO|null, reason: string }
 *   { state: 'disconnected',  last_push_at: null,      reason: string }
 *
 * See lib/strava/connection-status.ts for the detection rules.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { loadStravaConnectionStatus } from '@/lib/strava/connection-status';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const status = await loadStravaConnectionStatus(userId);
  return NextResponse.json(status);
}
