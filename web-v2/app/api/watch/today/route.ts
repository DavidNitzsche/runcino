/**
 * GET /api/watch/today
 *
 * Wire-format endpoint for the (frozen) watch app. The phone fetches this
 * and forwards via WatchConnectivity applicationContext. Response shape is
 * { workout: WatchWorkout, ...glance } | { message: string }
 *
 * Contract: docs/coach/WATCH_CONTRACT.md
 *
 * Auth (2026-05-30 user-isolation fix): the iPhone MUST send
 * `Authorization: Bearer <token>` on every call. The legacy `?user_id=`
 * query parameter is REJECTED — accepting it let any caller scrape any
 * runner's plan/workout by guessing UUIDs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildWatchToday } from '@/lib/watch/build-workout';
import { requireUserId } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  // Hard-reject the legacy ?user_id= scrape vector. The iPhone client
  // never needs to identify a user by query — it has a Bearer token.
  if (req.nextUrl.searchParams.has('user_id')) {
    return NextResponse.json(
      { error: 'user_id query parameter is no longer accepted; send Authorization: Bearer <token>' },
      { status: 400 },
    );
  }
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  // Optional ?date=YYYY-MM-DD lets the iPhone WorkoutDetailModal fetch the
  // structured payload for ANY day's tile, not just today's. The watch
  // never sends this param — it always wants today.
  const date = req.nextUrl.searchParams.get('date') || undefined;
  try {
    const payload = await buildWatchToday(userId, date);
    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json({
      error: err.message ?? String(err),
    }, { status: 500 });
  }
}
