/**
 * POST /api/plan/proposal · runner accepts or dismisses a plan-drift
 * proposal. Both lifecycle terminals end in plan_proposals.status set,
 * resolved_at stamped.
 *
 * accept · runs generatePlan against the goal race · returns the new
 *          plan_id (the Today view can re-fetch the seed and the new
 *          plan renders).
 * dismiss · marks the proposal dismissed · drift-cron won't re-propose
 *           the SAME kind for 14 days (handled by the cron's
 *           hasPendingProposal check + a 14d window we add here).
 *
 * Auto-applied proposals (race_date_changed, etc.) don't go through
 * this route · they were resolved at insert.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { generatePlan } from '@/lib/plan/generate';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null);
  const proposalId = Number(body?.id);
  const action = String(body?.action ?? '');
  if (!Number.isFinite(proposalId) || proposalId <= 0) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  if (action !== 'accept' && action !== 'dismiss') {
    return NextResponse.json({ error: "action must be 'accept' or 'dismiss'" }, { status: 400 });
  }

  // 1. Pull the proposal · verify ownership
  const proposal = (await pool.query<{
    id: number;
    plan_id: string | null;
    proposal_kind: string;
    status: string;
  }>(
    `SELECT id, plan_id, proposal_kind, status
       FROM plan_proposals
      WHERE id = $1 AND user_uuid = $2`,
    [proposalId, userId],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (!proposal) {
    return NextResponse.json({ error: 'proposal not found' }, { status: 404 });
  }
  if (proposal.status !== 'pending') {
    return NextResponse.json({
      error: `proposal already ${proposal.status}`,
      status: proposal.status,
    }, { status: 409 });
  }

  // 2a. Dismiss path · simple status update
  if (action === 'dismiss') {
    await pool.query(
      `UPDATE plan_proposals
          SET status = 'dismissed', resolved_at = NOW()
        WHERE id = $1`,
      [proposalId],
    );
    return NextResponse.json({ ok: true, status: 'dismissed' });
  }

  // 2b. Accept path · resolve the underlying race, rebuild
  const planRow = (await pool.query<{ race_id: string | null }>(
    `SELECT race_id FROM training_plans
      WHERE id = $1 AND user_uuid = $2`,
    [proposal.plan_id, userId],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (!planRow?.race_id) {
    // The plan referenced by the proposal is gone or has no race · we
    // can't rebuild. Mark dismissed with a reason.
    await pool.query(
      `UPDATE plan_proposals
          SET status = 'dismissed', resolved_at = NOW(),
              reasons = reasons || jsonb_build_object('dismiss_reason', 'plan_missing_or_no_race')
        WHERE id = $1`,
      [proposalId],
    );
    return NextResponse.json({
      ok: false,
      status: 'dismissed',
      reason: 'plan_missing_or_no_race',
    });
  }

  // Run the rebuild
  let newPlanId: string | undefined;
  let rebuildOk = false;
  let rebuildReason: string | undefined;
  try {
    const result = await generatePlan({ userId, raceSlug: planRow.race_id });
    rebuildOk = result.ok;
    newPlanId = result.plan_id;
    rebuildReason = result.reason;
  } catch (e: unknown) {
    rebuildReason = e instanceof Error ? e.message : String(e);
  }

  // 3. Update the proposal · accepted on success, leave pending on failure
  if (rebuildOk) {
    await pool.query(
      `UPDATE plan_proposals
          SET status = 'accepted', resolved_at = NOW(), new_plan_id = $2,
              reasons = reasons || jsonb_build_object('accept_reason', 'rebuild_ok')
        WHERE id = $1`,
      [proposalId, newPlanId ?? null],
    );
    return NextResponse.json({ ok: true, status: 'accepted', newPlanId });
  } else {
    await pool.query(
      `UPDATE plan_proposals
          SET reasons = reasons || jsonb_build_object('accept_attempt_failed', $2::text)
        WHERE id = $1`,
      [proposalId, rebuildReason ?? 'unknown'],
    );
    return NextResponse.json({
      ok: false,
      status: 'pending',
      reason: rebuildReason,
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/plan/proposal',
    body: { id: 'number (proposal id)', action: "'accept' | 'dismiss'" },
    note: 'Accept runs generatePlan for the plan\'s race. Dismiss just closes the proposal · drift-cron will not re-propose the same kind for 14 days.',
  });
}
