/**
 * POST /api/plan/workout-proposals/:id/dismiss
 *
 * Runner declines a pending plan_workout_proposals row · plan stays
 * unchanged. Banner disappears on next page load.
 *
 * → 200 { ok: true }
 * → 400 { ok: false, error: 'invalid_body' }
 * → 404 { ok: false, error: 'not_pending' }
 *
 * David 2026-06-04 · this is the "KEEP ORIGINAL" button on the banner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { dismissProposal } from '@/lib/plan/workout-proposals';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { id: idParam } = await ctx.params;
  const proposalId = Number(idParam);
  if (!Number.isFinite(proposalId)) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const ok = await dismissProposal(userId, proposalId);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'not_pending' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
