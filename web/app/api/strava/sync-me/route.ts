/**
 * POST /api/strava/sync-me — refresh THIS user's Strava activities now.
 *
 * Thin wrapper around lib/sync-strava-user.ts. Used by the "Sync now"
 * button on /profile.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { syncStravaForUser } from '@/lib/sync-strava-user';

export async function POST() {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await syncStravaForUser(user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, needsReconnect: result.needsReconnect ?? false },
      { status: result.needsReconnect ? 401 : 502 },
    );
  }
  return NextResponse.json(result);
}
