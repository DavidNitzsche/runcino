/**
 * GET /api/coach/calibration/status
 *
 * Current calibration state for the authenticated runner. Drives
 * the Today banner + iPhone watch prompt visibility gating.
 *
 * Response:
 *   {
 *     status: 'pending' | 'in_progress' | 'completed' | 'skipped',
 *     band: { lowSPerMi, highSPerMi } | null,
 *     confidence: number | null,
 *     completedAt: string | null,
 *     sessionId: number | null
 *   }
 *
 * Always returns 200 · 'pending' is the cold-start default.
 *
 * Pairs with:
 *   · designs/briefs/calibration-session.md § Surface contracts
 *   · lib/coach/calibration.ts · calibrationStatus
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { calibrationStatus } from '@/lib/coach/calibration';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    const result = await calibrationStatus(userId);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[api/coach/calibration/status] failed:', e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { status: 'pending', band: null, confidence: null, completedAt: null, sessionId: null },
    );
  }
}
