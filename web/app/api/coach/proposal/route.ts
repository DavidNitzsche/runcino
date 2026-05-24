/**
 * /api/coach/proposal — pending coach proposals (goal time changes,
 * race priority shifts, plan rewrites, etc).
 *
 * GET                       → { ok, pending: CoachProposal[] }
 * POST { id, decision: 'accept' | 'reject' } → { ok }
 *
 * Per autonomy contract §10.2: coach proposes, runner decides.
 * Acceptance triggers downstream cache invalidation (the proposed
 * change has consequences for prescription, projection, etc).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listPendingProposals, respondToProposal } from '@/lib/proposal-store';
import { logCoachAction } from '@/lib/coach-actions-store';
import { invalidate, type InvalidationTrigger } from '@/lib/coach-reads-cache';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });
  const pending = await listPendingProposals(user.id);
  return NextResponse.json({ ok: true, pending });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });

  let body: { id?: number; decision?: 'accept' | 'reject' };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (!body.id || (body.decision !== 'accept' && body.decision !== 'reject')) {
    return NextResponse.json({ ok: false, error: 'id and decision required' }, { status: 400 });
  }

  const status = body.decision === 'accept' ? 'accepted' : 'rejected';
  await respondToProposal(body.id, user.id, status);

  // Audit log the response.
  await logCoachAction(
    user.id,
    `proposal_${status}`,
    'notify',
    { proposalId: body.id, decision: body.decision },
    'runner_response',
    body.decision === 'accept' ? 'Runner accepted the proposal' : 'Runner declined the proposal',
  );

  // Acceptance invalidates downstream caches — the change has effects.
  if (body.decision === 'accept') {
    // Conservative wide invalidation; the spec's per-trigger map is
    // narrower but until we have per-proposal-type metadata we drop
    // everything goal-anchored + prescription-chain.
    for (const t of ['goal-anchored', 'prescription-chain'] as InvalidationTrigger[]) {
      await invalidate(user.id, t);
    }
  }
  return NextResponse.json({ ok: true });
}
