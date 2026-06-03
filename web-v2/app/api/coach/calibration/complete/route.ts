/**
 * POST /api/coach/calibration/complete
 *
 * Complete a calibration session from a specified run.
 * Manual fallback path · the run-write pipeline auto-fires
 * completeCalibrationSession when an in_progress session exists.
 *
 * Body: { runId: string }
 *
 * Response · 200 { result: CalibrationResult }
 *           · 202 { reason: 'unqualified', message }  · run completed
 *               but didn't meet thresholds; session stays in_progress
 *           · 404 when no in_progress session AND auto-fire path
 *               couldn't create one (run not found / too short)
 *
 * Pairs with:
 *   · designs/briefs/calibration-session.md § API surface
 *   · lib/coach/calibration.ts · completeCalibrationSession
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { completeCalibrationSession } from '@/lib/coach/calibration';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  let body: { runId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body?.runId || typeof body.runId !== 'string') {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }

  try {
    const result = await completeCalibrationSession(userId, body.runId);
    if (!result) {
      // No usable run · session stays in_progress for next qualifying run.
      return NextResponse.json(
        { reason: 'unqualified', message: 'Run not usable for calibration · session stays in_progress' },
        { status: 202 },
      );
    }
    return NextResponse.json({ result });
  } catch (e) {
    console.error('[api/coach/calibration/complete] failed:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'complete failed' }, { status: 500 });
  }
}
