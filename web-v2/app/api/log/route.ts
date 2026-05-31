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
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '60');
  try {
    const state = await loadLogState(userId, { limit });
    return NextResponse.json(state);
  } catch (err: any) {
    console.error('[api/log] failed:', err);
    return NextResponse.json({ error: err.message ?? 'log load failed' }, { status: 500 });
  }
}
