/**
 * POST /api/coach/proposal/[id]/accept
 *
 * Accept a coach_proposals DB row (NOT the inline workout-swap proposal
 * at /api/coach/proposal — different shape).
 *
 * ── 2026-09-02 · THE ILLNESS AND INJURY HANDLERS ARE BOTH GONE ─────────────
 *
 * These rows used to be written by the adaptation engine in lib/plan/adapt.ts,
 * from the illness (Q-03) and injury (Q-08) triggers. `PLAN_SIMPLIFICATION_
 * DOCTRINE.md` (locked 2026-09-02) puts `illness`, `injury` and `automatic
 * return-to-training ladders` on the removal list, and is explicit that the
 * authority goes, not just the UI: "Delete unused proposal paths, triggers,
 * queues, and competing ownership where safe."
 *
 *   · `illness_adjust`  — deleted. Nothing wrote the type, and the handler
 *     only marked the row accepted and logged an intent.
 *
 *   · `injury_adjust`   — deleted. This was the door into `buildInjuryPlan`,
 *     which ARCHIVES the runner's active race-prep plan and lands a fresh
 *     `training_plans` row in walk-run mode. A second plan builder that can
 *     retire his marathon block is precisely the "competing ownership" the
 *     ruling names, and with its writer already removed it was unreachable
 *     authority sitting behind a handler that read as live.
 *
 * Neither is a secret switch away from returning. The walk-run ladder itself
 * survives as doctrine data in `lib/plan/injury-protocols.ts` (still bound in
 * CI by `INJURY.walk-run-ladder-is-encoded-verbatim`), so re-adding the mode
 * later means writing a RUNNER-INITIATED entry point — the owner's own framing
 * was "its a feature we can add in later" — not reviving a detector.
 *
 * Both types now fall through to the 501 at the bottom of this route, which is
 * the honest answer if a historical row is ever replayed.
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
