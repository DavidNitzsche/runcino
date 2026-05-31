/**
 * POST /api/coach/proposal/[id]/decline
 *
 * Mirror of /accept for coach_proposals DB rows — lets the runner reject
 * a propose-only adaptation (Q-03 illness, Q-08 injury, etc.) instead of
 * being forced into the swap. Without this route the UI flow was one-way
 * (accept-only), which meant a runner had to ignore the chip forever.
 *
 * On decline we:
 *   - flip status to 'rejected' and stamp responded_at = NOW()
 *     (the table has no `declined_iso` column — we reuse responded_at to
 *     stay shape-compatible with the accept path)
 *   - write a coach_intents row (reason='proposal_declined') so the next
 *     briefing voice can acknowledge the rejection once and shut up
 *
 * No plan rebuild, no cache bust beyond what bustBriefingCacheForEvent
 * does for the proposal-status hint. The runner is staying on the active
 * plan; whatever trigger fired (injury, illness) is still tracked
 * elsewhere — declining a proposal doesn't erase the underlying signal.
 *
 * Auth: requireUserId, same opaque-session pattern as accept. The
 * proposal row's user_uuid must match the caller — no cross-user decline.
 *
 * Idempotency: status='rejected' on second call returns 409 with the
 * same response shape ({ok:false, error, proposal_id, reason}) so the
 * client can treat the re-call as already-handled.
 *
 * Cite: audit/SYSTEM_AUDIT_2026-05-30 P0 #1 (proposal flow completion);
 *       parity with accept/route.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

type Params = { params: Promise<{ id: string }> };

interface DeclineOk {
  ok: true;
  action: 'decline';
  proposal_id: number;
  proposal_type: string;
}

interface DeclineErr {
  ok: false;
  error: string;
  proposal_id?: number;
  proposal_type?: string;
  reason?: string;
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse<DeclineOk | DeclineErr>> {
  const { id } = await params;
  const proposalId = Number(id);
  if (!Number.isFinite(proposalId) || proposalId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid proposal id' }, { status: 400 });
  }
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const userId = auth;

  // 1. Load proposal. Verify owner + still-pending (or already-declined for
  //    idempotency).
  const proposal = (await pool.query(
    `SELECT id, user_uuid, proposal_type, status
       FROM coach_proposals
      WHERE id = $1 AND user_uuid = $2
      LIMIT 1`,
    [proposalId, userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!proposal) {
    return NextResponse.json({ ok: false, error: 'proposal not found', proposal_id: proposalId }, { status: 404 });
  }
  if (proposal.status === 'rejected') {
    // Idempotent re-decline. Same response shape, 409 to signal "already handled".
    return NextResponse.json(
      {
        ok: false,
        error: 'proposal already declined',
        proposal_id: proposalId,
        proposal_type: proposal.proposal_type,
        reason: 'idempotency: status already declined',
      },
      { status: 409 },
    );
  }
  if (proposal.status === 'accepted' || proposal.status === 'expired') {
    return NextResponse.json(
      {
        ok: false,
        error: `proposal status=${proposal.status}; cannot decline`,
        proposal_id: proposalId,
        proposal_type: proposal.proposal_type,
      },
      { status: 409 },
    );
  }

  // 2. Flip status. Stamp responded_at so we have a timestamp for audit.
  await pool.query(
    `UPDATE coach_proposals SET status = 'rejected', responded_at = NOW() WHERE id = $1`,
    [proposalId],
  );

  // 3. Closed loop: coach_intents row so the next briefing voice can
  //    acknowledge the decline once. field is the proposal id (text);
  //    value carries proposal_type so downstream filters can route
  //    voice-line variants per type without re-reading coach_proposals.
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
     VALUES ($1, $1, 'proposal_declined', $2, $3)`,
    [userId, String(proposalId), JSON.stringify({
      proposal_id: proposalId,
      proposal_type: proposal.proposal_type,
    })],
  ).catch(() => {});

  await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});

  return NextResponse.json({
    ok: true,
    action: 'decline',
    proposal_id: proposalId,
    proposal_type: proposal.proposal_type,
  });
}
