/**
 * GET /api/plan/workout-proposals
 *
 * Pending per-workout adapter proposals (plan_workout_proposals rows,
 * status='pending') for the signed-in runner. Read-side for the iPhone
 * Today banner + NudgeSheet proposal surface — until now the only reader
 * was the web seed envelope (components/faff-app/seed.ts), so propose-
 * first adaptations were invisible to phone-only runners and expired
 * silently (audit 2026-07-06 P2-63).
 *
 * Respond endpoints already exist:
 *   POST /api/plan/workout-proposals/:id/accept   ("LET IT HAPPEN")
 *   POST /api/plan/workout-proposals/:id/dismiss  ("KEEP ORIGINAL")
 *
 * Response shape (lenient on client):
 *   { ok, proposals: [{ id, planWorkoutId, workoutDateISO, actionKind,
 *                       actionPayload: { newType, newDate, shaveFraction, why },
 *                       reason, evidence, createdAt }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadPendingProposals } from '@/lib/plan/workout-proposals';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    const proposals = await loadPendingProposals(userId);
    return NextResponse.json({ ok: true, proposals });
  } catch (err: any) {
    console.error('[api/plan/workout-proposals] failed:', err);
    return NextResponse.json(
      { ok: false, proposals: [], error: err?.message ?? 'lookup failed' },
      { status: 500 },
    );
  }
}
