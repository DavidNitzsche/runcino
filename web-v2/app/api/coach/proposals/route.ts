/**
 * GET /api/coach/proposals
 *
 * Plural list of pending coach proposals (injury / illness adjusts, plan
 * swaps) for the signed-in runner. Wraps lib/coach/proposals-state.ts so
 * the iPhone can render a stack of proposal cards instead of guessing
 * which proposal the singular POST /api/coach/proposal targets.
 *
 * Closes the iPhone gap that previously had no read-side surface for the
 * coach_proposals table · proposals would write but never appear.
 *
 * Response shape (lenient on client):
 *   { ok, proposals: [{ id, proposal_type, reason, suggested, evidence, created_at }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadPendingProposals } from '@/lib/coach/proposals-state';
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
    console.error('[api/coach/proposals] failed:', err);
    return NextResponse.json({ ok: false, proposals: [], error: err?.message ?? 'lookup failed' }, { status: 500 });
  }
}
