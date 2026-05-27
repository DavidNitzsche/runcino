/**
 * GET /api/health/state — full HEALTH surface data for iPhone /health.
 *
 * Mirrors web /health's loadHealthState: 30-day series + summary +
 * watch-mode for sleep / RHR / HRV / weight + VO2 + cadence. The
 * iPhone HealthView renders these as glanceable metric cards with mini
 * sparklines.
 *
 * 2026-05-27: shipped after David said the iPhone /health was just a
 * readiness ring + slow coach brief — wanted glanceable cards instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadHealthState } from '@/lib/coach/health-state';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id') ?? DAVID_USER_ID;
  try {
    const state = await loadHealthState(userId);
    return NextResponse.json(state);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
