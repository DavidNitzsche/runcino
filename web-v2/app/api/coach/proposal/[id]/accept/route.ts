/**
 * POST /api/coach/proposal/[id]/accept
 *
 * Accept a coach_proposals DB row (NOT the inline workout-swap proposal
 * at /api/coach/proposal — different shape).
 *
 * ── 2026-09-02 · READ THIS BEFORE TRUSTING THE ROUTE ────────────────────────
 *
 * These rows USED TO BE written by the adaptation engine in lib/plan/adapt.ts,
 * from the illness (Q-03) and injury (Q-08) triggers. Both triggers were
 * deleted when the owner ruled that he decides how ready he is and that
 * illness and injury are out of the engine for now. So:
 *
 *   · `illness_adjust`  — HANDLER DELETED. Nothing writes the type, and the
 *     handler only ever marked the row accepted and logged an intent. There
 *     was nothing to keep.
 *
 *   · `injury_adjust`   — HANDLER KEPT, AND CURRENTLY UNREACHABLE. This is the
 *     door into `buildInjuryPlan` and the walk-run ladder, which the removal
 *     brief explicitly preserved as "a plan type he can choose, not an
 *     inference the app draws about him", and which is doctrine-bound in CI by
 *     `INJURY.walk-run-ladder-is-encoded-verbatim`. But its only writer was the
 *     deleted detector, so today NO CODE PATH CAN PRODUCE A ROW OF THIS TYPE,
 *     and the ladder is reachable only by inserting one by hand.
 *
 *     That is a real gap and it is stated here rather than hidden, because a
 *     route whose header describes a working feature that cannot be reached is
 *     the exact shape CLAUDE.md Rule 20's corollary warns about. Closing it
 *     means giving the runner a way to START an injury plan himself — a
 *     feature, and one the owner said to add later ("its a feature we can add
 *     in later"). Whoever adds it should write the runner-initiated writer and
 *     delete this paragraph, not re-add a detector.
 *
 * Handles:
 *   - injury_adjust   → calls buildInjuryPlan(userId, injuryId); archives
 *                       the active race-prep plan and lands a fresh
 *                       training_plans row with mode_label='injury-return'
 *                       (walk-run scaffold per Research/05).
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
import { requireUserId } from '@/lib/auth/session';
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
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) {
    // 2026-08-21 · backend audit · this used to discard `auth` and answer a
    // hardcoded 401. `requireUserId` returns 503 when the sessions table was
    // UNREADABLE rather than empty (see lib/auth/session.ts) precisely so a
    // database blip is not reported as an expired session — and the phone
    // acts on the difference: `API.authedSend` treats 401 as
    // .faffSessionExpired, which clears the Keychain token and bounces to the
    // sign-in gate, from which the runner cannot get back in because signing
    // in reads the same database. Returning the response as built preserves
    // 401-for-401 and 503-for-outage. These two routes were the only two of
    // 139 that overwrote it.
    // Cast, not a re-wrap: `requireUserId` returns NextResponse<unknown>
    // because the body differs by outcome (401 {error} vs the 503 envelope
    // from lib/route/failure). Re-wrapping it to satisfy the declared union
    // is what produced the hardcoded 401 in the first place — the status has
    // to travel with the response.
    return auth as NextResponse<AcceptErr>;
  }
  const userId = auth;

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
  if (proposal.status === 'rejected' || proposal.status === 'expired') {
    // status='rejected' is the DB constraint's value; user-facing copy
    // calls this "declined" (see /decline route).
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

  /* 2026-09-02 · the `illness_adjust` limb stood here. It marked the row
   * accepted and wrote an `illness_acknowledged` intent — no plan rebuild, by
   * design. Deleted with the detector that wrote the type: an accept handler
   * for a proposal nothing can produce is dead weight, and an unknown type
   * already falls through to the 501 below, which is the honest answer if a
   * historical row is ever replayed. */

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
