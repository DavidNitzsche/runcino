/**
 * POST /api/coach/calibration/start
 *
 * Start a calibration session. Idempotent · returns the existing
 * in_progress session if one exists.
 *
 * Body: { wasStartTapped?: boolean }   default: true
 *   (false path is for the run-write auto-fire · not exposed to
 *    client tap callers, but accepted for completeness)
 *
 * Response: 201 { sessionId, alreadyActive: boolean }
 *
 * Pairs with:
 *   · designs/briefs/calibration-session.md § Surface contracts
 *   · lib/coach/calibration.ts · startCalibrationSession
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { startCalibrationSession } from '@/lib/coach/calibration';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  let body: { wasStartTapped?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const wasStartTapped = body.wasStartTapped !== false;  // default true

  try {
    const result = await startCalibrationSession(userId, wasStartTapped);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    console.error('[api/coach/calibration/start] failed:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'start failed' }, { status: 500 });
  }
}
