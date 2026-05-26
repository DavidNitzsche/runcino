/**
 * GET /api/watch/today
 *
 * Wire-format endpoint for the (frozen) watch app. The phone fetches this
 * and forwards via WatchConnectivity applicationContext. Response shape is
 * { workout: WatchWorkout, ...glance } | { message: string }
 *
 * Contract: docs/coach/WATCH_CONTRACT.md
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildWatchToday } from '@/lib/watch/build-workout';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id') ?? DAVID_USER_ID;
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
