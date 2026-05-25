/**
 * GET /api/profile/activity-gap
 *
 * Tier-2-to-tier-1 lift · exposes computeStravaGap() as a standalone
 * tier-1 endpoint so iPhone/watchOS can compose surfaces without
 * pulling the /overview SSR envelope.
 *
 * Response: StravaGapFinding · { state, daysSinceLastRun, lastRunDate,
 *   mark, markedAt, signalsSuspended, plannedBreakActive }
 *
 * Auth: Bearer (cookie also accepted for desktop testing).
 * Tier 1 stable public.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { computeStravaGap } from '@/lib/strava-gap';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });

  const today = todayISO(user.timezone || userTimezone(user.location));
  const result = await computeStravaGap(user.id, today);
  return NextResponse.json(result);
}
