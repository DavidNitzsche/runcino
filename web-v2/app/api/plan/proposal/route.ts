/**
 * /api/plan/proposal · the plan-drift proposal surface.
 *
 * ── GET · read the caller's proposals ─────────────────────────────────────
 *
 * Added 2026-08-17. Until then this route was POST-only: the runner could
 * ACCEPT or DISMISS a proposal but had no way to ASK whether one existed. Web
 * never noticed because it reads `planProposals` off its own server-rendered
 * seed (`components/faff-app/seed.ts` → `loadPlanProposals`); native has no
 * seed, so on the phone a pending rebuild proposal was unreachable — the plan
 * could be drifting and the surface that says so could not be reached.
 *
 *   GET /api/plan/proposal            → pending + recently auto-applied
 *   GET /api/plan/proposal?all=1      → the full recent history, resolved rows
 *                                       included, for a debug/audit view
 *
 * Response:
 *
 *   {
 *     "proposals": [
 *       {
 *         "id": 41,
 *         "planId": "…", "previousPlanId": "…", "newPlanId": null,
 *         "kind": "volume_drift",           // PlanProposalKind
 *         "status": "pending",              // PlanProposalStatus
 *         "source": "drift_cron",
 *         "reasons": { … },                 // raw blob, includes `message`
 *         "message": "…",                   // plain language, always present
 *         "severity": 0.62,                 // null for hard-drift kinds
 *         "createdAt": "…", "resolvedAt": null
 *       }
 *     ],
 *     "pendingCount": 1
 *   }
 *
 * The element shape is `PlanProposal` from `lib/plan/proposals-state.ts`, byte
 * for byte what the web seed puts in `planProposals` — same loader, same
 * ordering (pending first, then severity, then recency), same cap of five.
 * That is deliberate: two surfaces reading the same rows through two different
 * shapes is how they drift apart.
 *
 * Scoped to the authenticated caller by `requireUserId`; the loader takes the
 * user id and every query filters on it, so there is no way to read another
 * runner's proposals through this route.
 *
 * NATIVE WIRING IS NOT DONE. This route is the contract only. A later pass
 * needs to: poll or fetch this on the phone's Today surface, render the
 * accept/dismiss pair against the POST below (`{ id, action }`), and handle
 * the 409 the POST returns when the proposal was already resolved somewhere
 * else — likely on the web, in another session, minutes earlier.
 *
 * ── POST · accept or dismiss ──────────────────────────────────────────────
 *
 * Both lifecycle terminals end in plan_proposals.status set,
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
import { outage } from '@/lib/route/failure';
import { requireUserId } from '@/lib/auth/session';
import { generatePlan } from '@/lib/plan/generate';
import { resolveGoalTarget } from '@/lib/plan/auto-rebuild';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { logReadFailure } from '@/lib/db/read';

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
  // A FAILED READ IS NOT "NOT FOUND". Swallowing the error made a dropped
  // connection indistinguishable from a proposal that does not exist, and
  // 404 is a statement about the runner's data.
  let proposal: {
    id: number; plan_id: string | null; proposal_kind: string; status: string;
    reasons: Record<string, unknown> | null;
  } | undefined;
  try {
    proposal = (await pool.query<{
      id: number;
      plan_id: string | null;
      proposal_kind: string;
      status: string;
      reasons: Record<string, unknown> | null;
    }>(
      `SELECT id, plan_id, proposal_kind, status, reasons
         FROM plan_proposals
        WHERE id = $1 AND user_uuid = $2`,
      [proposalId, userId],
    )).rows[0];
  } catch (e) {
    return outage('api/plan/proposal', e);
  }

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
        WHERE id = $1 AND user_uuid = $2`,
      [proposalId, userId],
    );
    return NextResponse.json({ ok: true, status: 'dismissed' });
  }

  // 2026-08-28 · RACEROLE-1 · accepting a race_role card is NOT a rebuild.
  // The card is the coach's recommendation for how to run a tune-up race
  // (Research/REVIEW_NOTES.md A2); accepting it persists the answered role on
  // the race row (meta.plannedRole · field-level jsonb_set, Rule 6) and
  // patches the surrounding plan week through the mutation boundary
  // (lib/race/race-role-apply.ts). The role survives any later rebuild:
  // embedMidBlockRaces reads meta.plannedRole and shapes the race week
  // accordingly. Runner-initiated by construction — this branch only runs on
  // the runner's accept tap.
  if (proposal.proposal_kind === 'race_role') {
    const reasons = proposal.reasons ?? {};
    const raceSlug = typeof reasons.race_slug === 'string' ? reasons.race_slug : null;
    const role = typeof reasons.recommended_role === 'string' ? reasons.recommended_role : null;
    const category = typeof reasons.race_category === 'string' ? reasons.race_category : 'hm';
    if (!raceSlug || !role) {
      return NextResponse.json({
        error: 'race_role proposal is missing race_slug or recommended_role',
      }, { status: 500 });
    }
    let applied: Awaited<ReturnType<typeof import('@/lib/race/race-role-apply')['applyRaceRole']>>;
    try {
      const { applyRaceRole } = await import('@/lib/race/race-role-apply');
      applied = await applyRaceRole({ userId, raceSlug, role, category });
    } catch (e) {
      return outage('api/plan/proposal · race_role', e);
    }
    if (!applied.ok) {
      await pool.query(
        `UPDATE plan_proposals
            SET reasons = reasons || jsonb_build_object('accept_attempt_failed', $2::text)
          WHERE id = $1`,
        [proposalId, `${applied.outcome}${applied.reason ? ` · ${applied.reason}` : ''}`],
        // Best-effort marker on a path already returning 500 — but logged,
        // never silent (2026-08-24 swallow sweep).
      ).catch((e) => logReadFailure('api/plan/proposal · race_role attempt marker write', e));
      return NextResponse.json({
        ok: false, status: 'pending', reason: applied.outcome,
      }, { status: 500 });
    }
    await pool.query(
      `UPDATE plan_proposals
          SET status = 'accepted', resolved_at = NOW(),
              reasons = reasons || jsonb_build_object(
                'accept_reason', 'race_role_applied',
                'applied_role', $2::text,
                'changed_rows', $3::int)
        WHERE id = $1`,
      [proposalId, role, applied.changedRows],
    );
    return NextResponse.json({
      ok: true, status: 'accepted', role, changedRows: applied.changedRows,
    });
  }

  // 2b. Accept path · resolve the underlying race, rebuild
  // AND THIS ONE IS DESTRUCTIVE. Below, a missing race_id permanently
  // dismisses the proposal — so swallowing the error meant a thirty-second
  // Postgres blip threw away a live proposal the runner never saw, with no
  // way back. "We could not read it" and "the plan is gone" are different
  // answers and only one of them may destroy anything.
  let planRow: { race_id: string | null } | undefined;
  try {
    planRow = (await pool.query<{ race_id: string | null }>(
      `SELECT race_id FROM training_plans
        WHERE id = $1 AND user_uuid = $2`,
      [proposal.plan_id, userId],
    )).rows[0];
  } catch (e) {
    return outage('api/plan/proposal', e);
  }

  // 2026-08-28 · a no-race plan is no longer an automatic dead-end. The
  // plan_elapsed pending path writes cards against plans with race_id NULL
  // (goal-mode, and injury-return blocks the compromised guard refuses to
  // auto-build over), so accepting one resolves the runner's goal the same
  // way the cron's own rebuild would (resolveGoalTarget: the plan's recorded
  // goal, then the profile goal). Only when NEITHER a race nor a goal
  // resolves is the card dismissed — there is genuinely nothing to build.
  let goalTarget: Awaited<ReturnType<typeof resolveGoalTarget>> = null;
  if (!planRow?.race_id) {
    const todayISO = await runnerToday(userId)
      .catch(() => new Date().toISOString().slice(0, 10));
    goalTarget = await resolveGoalTarget(userId, todayISO).catch(() => null);
  }
  if (!planRow?.race_id && !goalTarget) {
    // The plan referenced by the proposal is gone and no goal resolves · we
    // can't rebuild. Mark dismissed with a reason.
    await pool.query(
      `UPDATE plan_proposals
          SET status = 'dismissed', resolved_at = NOW(),
              reasons = reasons || jsonb_build_object('dismiss_reason', 'plan_missing_or_no_race')
        WHERE id = $1 AND user_uuid = $2`,
      [proposalId, userId],
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
    // COACHED-GATE-1 (2026-08-19) · this branch runs only on ACCEPT — the
    // runner read a proposal and tapped yes. The automatic half of this loop,
    // the code that RAISES proposals, is gated (fireAutoRebuild), so a coached
    // runner should see none; a standing one is a row from before they told us
    // about their coach, and accepting it is still their decision to make.
    const result = planRow?.race_id
      ? await generatePlan({
          userId, raceSlug: planRow.race_id, allowCoached: true,
          // 2026-08-25 · the runner ACCEPTED a proposal, as against the cron
          // applying one unasked.
          archiveReason: 'proposal_accepted',
        })
      : await generatePlan({
          userId, goalTarget: goalTarget!, allowCoached: true,
          archiveReason: 'proposal_accepted',
        });
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

/**
 * GET · the caller's plan proposals. See the route header for the contract.
 *
 * Delegates to the SAME loader the web seed uses rather than issuing its own
 * query. A hand-rolled query here would be a second definition of "which
 * proposals should a runner see", and the two would answer differently the
 * first time either changed — the fork class this codebase keeps paying for.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const all = req.nextUrl.searchParams.get('all') === '1';
  try {
    const { loadPlanProposals, loadAllPlanProposals } = await import('@/lib/plan/proposals-state');
    const proposals = all
      ? await loadAllPlanProposals(userId)
      : await loadPlanProposals(userId);
    return NextResponse.json({
      proposals,
      pendingCount: proposals.filter((p) => p.status === 'pending').length,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: 'failed to load proposals', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
