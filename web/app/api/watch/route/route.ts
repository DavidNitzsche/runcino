/**
 * POST /api/watch/route
 *
 * GPS-route + per-mile-splits writeback for watch-only runs. The iPhone
 * reads an Apple Health HKWorkoutRoute (a run recorded by the watch that
 * never reached Strava), encodes the path as a polyline + computes splits
 * on-device, and POSTs here. /api/runs/by-date serves it so the recap
 * shows a map + splits without Strava.
 *
 * Request shape: see lib/watch-route.ts (WatchRouteInput).
 * Auth: Bearer access token (cookie also accepted, mirroring complete).
 * Idempotent on (user_id, started_at).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storeRoute, type WatchRouteInput } from '@/lib/watch-route';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') {
    return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });
  }

  let body: WatchRouteInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = await storeRoute(user.id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
