/**
 * POST /api/coach/proposal/[id]/accept
 *
 * Accept a coach_proposals DB row (NOT the inline workout-swap proposal
 * at /api/coach/proposal — different shape). These rows are written by
 * the adaptation engine in lib/plan/adapt.ts when a trigger demands a
 * propose-only response (Q-03 illness, Q-08 injury). Until this route
 * existed, the propose-only triggers wrote rows that nothing consumed.
 *
 * Handles every proposal_type that requires an action on accept:
 *   - injury_adjust   → calls buildInjuryPlan(userId, injuryId); archives
 *                       the active race-prep plan and lands a fresh
 *                       training_plans row with mode_label='injury-return'
 *                       (walk-run scaffold per Research/05).
 *   - illness_adjust  → no plan rebuild; just marks accepted + writes a
 *                       coach_intents row so the next briefing voice can
 *                       acknowledge. (Drop-quality is already implied; the
 *                       runner takes the recovery week themselves.)
 *
 * Auth: opaque session token via userIdFromRequest. The proposal row's
 * user_uuid must match the caller — no cross-user accept.
 *
 * Idempotency: status='accepted' on second call returns 409 with the
 * existing applied result. No double-archive of the race-prep plan.
 *
 * Returns: { ok, action: 'accept', proposal_id, plan_id?, weeks_generated?,
 *            reason? }
 *
 * Cite: Research/05-injury-return-protocols.md §General-Principles (injury
 *       scaffold); audit/SYSTEM_AUDIT_2026-05-30 P0 #1 (dead-code rescue).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { buildInjuryPlan } from '@/lib/plan/injury-builder';

type Params = { params: Promise<{ id: string }> };

interface AcceptOk {
  ok: true;
  action: 'accept';
  proposal_id: number;
  proposal_type: string;
  plan_id?: string;
  weeks_generated?: number;
}

interface AcceptErr {
  ok: false;
  error: string;
  proposal_id?: number;
  reason?: string;
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse<AcceptOk | AcceptErr>> {
  const { id } = await params;
  const proposalId = Number(id);
  if (!Number.isFinite(proposalId) || proposalId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid proposal id' }, { status: 400 });
  }
  const userId = await userIdFromRequest(req);

  // 1. Load proposal. Verify owner + still-pending.
  const proposal = (await pool.query(
    `SELECT id, user_uuid, proposal_type, payload, status
       FROM coach_proposals
      WHERE id = $1 AND user_uuid = $2
      LIMIT 1`,
    [proposalId, userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!proposal) {
    return NextResponse.json({ ok: false, error: 'proposal not found', proposal_id: proposalId }, { status: 404 });
  }
  if (proposal.status === 'accepted') {
    return NextResponse.json(
      { ok: false, error: 'proposal already accepted', proposal_id: proposalId, reason: 'idempotency: status already accepted' },
      { status: 409 },
    );
  }
  if (proposal.status === 'declined' || proposal.status === 'expired') {
    return NextResponse.json(
      { ok: false, error: `proposal status=${proposal.status}; cannot accept`, proposal_id: proposalId },
      { status: 409 },
    );
  }

  // 2. Dispatch on proposal_type.
  const payload = (proposal.payload ?? {}) as Record<string, unknown>;
  const evidence = (payload.evidence ?? {}) as Record<string, unknown>;

  if (proposal.proposal_type === 'injury_adjust') {
    const injuryId = Number(evidence.injury_id);
    if (!Number.isFinite(injuryId) || injuryId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'proposal payload missing evidence.injury_id', proposal_id: proposalId },
        { status: 400 },
      );
    }

    // buildInjuryPlan does its own archive of the previous active plan
    // and writes plan/phase/weeks/workouts. It's idempotent enough for
    // a synthetic retry but we mark the proposal accepted FIRST so a
    // concurrent call short-circuits at the status check above.
    await pool.query(
      `UPDATE coach_proposals SET status = 'accepted', responded_at = NOW() WHERE id = $1`,
      [proposalId],
    );

    const result = await buildInjuryPlan({ userId, injuryId });
    if (!result.ok) {
      // Roll the proposal status back to 'pending' so the runner can
      // retry once the underlying cause is fixed.
      await pool.query(
        `UPDATE coach_proposals SET status = 'pending', responded_at = NULL WHERE id = $1`,
        [proposalId],
      ).catch(() => {});
      console.error('[proposal-accept] buildInjuryPlan failed:', result.reason);
      return NextResponse.json(
        { ok: false, error: 'buildInjuryPlan failed', proposal_id: proposalId, reason: result.reason ?? 'unknown' },
        { status: 500 },
      );
    }

    // Closed loop: write a coach_intents row so the next briefing voice
    // can acknowledge the swap into INJURY-mode once.
    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, 'injury_plan_built', $2, $3)`,
      [userId, String(proposalId), JSON.stringify({
        injury_id: injuryId,
        plan_id: result.plan_id,
        weeks_generated: result.weeks_generated,
        proposal_id: proposalId,
      })],
    ).catch(() => {});

    await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});

    return NextResponse.json({
      ok: true,
      action: 'accept',
      proposal_id: proposalId,
      proposal_type: proposal.proposal_type,
      plan_id: result.plan_id,
      weeks_generated: result.weeks_generated,
    });
  }

  if (proposal.proposal_type === 'illness_adjust') {
    // No plan rebuild; the runner self-manages an easy week.
    await pool.query(
      `UPDATE coach_proposals SET status = 'accepted', responded_at = NOW() WHERE id = $1`,
      [proposalId],
    );
    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, 'illness_acknowledged', $2, $3)`,
      [userId, String(proposalId), JSON.stringify({ proposal_id: proposalId, payload })],
    ).catch(() => {});
    await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});
    return NextResponse.json({
      ok: true,
      action: 'accept',
      proposal_id: proposalId,
      proposal_type: proposal.proposal_type,
    });
  }

  // Unknown proposal_type — accept the row but flag it.
  await pool.query(
    `UPDATE coach_proposals SET status = 'accepted', responded_at = NOW() WHERE id = $1`,
    [proposalId],
  );
  return NextResponse.json(
    { ok: false, error: `proposal_type '${proposal.proposal_type}' has no handler`, proposal_id: proposalId },
    { status: 501 },
  );
}
