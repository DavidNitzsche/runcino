/**
 * DELETE /api/coach/calibration
 *
 * "Skip calibration" path · marks the active session skipped_at,
 * suppresses the Today banner + watch prompt for 7 days.
 *
 * No body · operates on the active session for the authenticated
 * runner. If no active session exists, returns ok: false (idempotent
 * · safe to call repeatedly).
 *
 * Response · 200 { ok: boolean }
 *
 * Pairs with:
 *   · designs/briefs/calibration-session.md § Skip path
 *   · lib/coach/calibration.ts · skipCalibrationSession
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { skipCalibrationSession } from '@/lib/coach/calibration';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    const result = await skipCalibrationSession(userId);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[api/coach/calibration/DELETE] failed:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
