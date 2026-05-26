/**
 * GET /api/log
 *
 * P28 — JSON wrapper for the run log so the iPhone can render the
 * chronological list. Web has /log as a server component reading
 * loadLogState directly; iPhone needs the same data over HTTP.
 *
 * Query params:
 *   limit  — max runs to return (default 60)
 *
 * Response:
 *   { weeks: [...], runs: [...] }  // mirrors loadLogState
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadLogState } from '@/lib/coach/log-state';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id') ?? DAVID_USER_ID;
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '60');
  try {
    const state = await loadLogState(userId, { limit });
    return NextResponse.json(state);
  } catch (err: any) {
    console.error('[api/log] failed:', err);
    return NextResponse.json({ error: err.message ?? 'log load failed' }, { status: 500 });
  }
}
