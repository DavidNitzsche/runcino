/**
 * POST /api/plan/workout-proposals/:id/accept
 *
 * Runner accepts a pending plan_workout_proposals row. The proposal
 * payload (action_kind + action_payload) is re-applied via the
 * existing applyAdaptations path · same provenance chip + same
 * coach_intents audit as if the cron had applied directly.
 *
 * → 200 { ok: true, applied: number }
 * → 400 { ok: false, error: 'invalid_body' | 'not_pending' }
 * → 404 { ok: false, error: 'not_found' }
 *
 * David 2026-06-04 · this is the "LET IT HAPPEN" button on the
 * banner. The runner gates the plan change instead of waking up to it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { acceptProposal } from '@/lib/plan/workout-proposals';
import { asRepricePayload } from '@/lib/plan/reprice-payload';
import { applyAdaptations } from '@/lib/plan/adapt';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

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

  const proposal = await acceptProposal(userId, proposalId);
  if (!proposal) {
    return NextResponse.json({ ok: false, error: 'not_pending' }, { status: 404 });
  }

  /* ── REANCHORPROPOSES-1 (2026-09-05) · THE COORDINATED REPRICING ──────────
   *
   * A `reprice` is not an `AdaptationAction` and cannot be turned into one:
   * it re-prices every future unsealed day in the block off one moved anchor,
   * and `applyAdaptations` is per-workout by construction. So it branches here,
   * BEFORE the action is built, and calls the re-anchor's own apply half — the
   * exact write the cron used to perform unattended, now performed on his tap
   * and declared `RUNNER_ACCEPTED`.
   *
   * The response says what actually landed, not what the card promised. The
   * arms re-resolve the canonical anchors at accept time (Rule 10's recompute
   * posture), so if evidence moved since the card was raised the applied answer
   * is the current one — and `proposed_to_vdot` beside `applied_to_vdot` is how
   * the runner's own client, and anyone reading the log, can see that.
   */
  if (proposal.actionKind === 'reprice') {
    const reprice = asRepricePayload(proposal.actionPayload?.reprice);
    if (reprice == null) {
      console.error(
        `[workout-proposals/accept] reprice ${proposalId} carries no readable payload · nothing applied`,
      );
      return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
    }
    const [{ applyReanchorProposal }, { runnerToday }] = await Promise.all([
      import('@/lib/plan/reanchor-plan'),
      import('@/lib/runtime/runner-tz'),
    ]);
    const today = await runnerToday(userId);
    const res = await applyReanchorProposal(
      userId,
      { planId: reprice.planId, arm: reprice.arm, toVdot: reprice.toVdot },
      today,
    ).catch((e: unknown) => {
      console.error('[workout-proposals/accept] reprice apply threw:', e);
      return null;
    });
    if (res == null) {
      return NextResponse.json({ ok: false, error: 'apply_refused' }, { status: 409 });
    }
    await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});
    return NextResponse.json({
      ok: true,
      applied: res.workoutsUpdated,
      sealed: res.workoutsSealed,
      proposed_to_vdot: reprice.toVdot,
      applied_to_vdot: res.toVdot,
    });
  }

  // Reconstruct the AdaptationAction shape from the stored payload
  // and pump it through applyAdaptations. The existing path handles
  // sealed-day guards, original_* tracking, coach_intents audit, and
  // workout_spec re-derivation.
  const action = {
    kind: proposal.actionKind,
    workoutIds: [proposal.planWorkoutId],
    newType: proposal.actionPayload.newType ?? undefined,
    newDate: proposal.actionPayload.newDate ?? undefined,
    shaveFraction: proposal.actionPayload.shaveFraction ?? undefined,
    why: proposal.actionPayload.why ?? proposal.reason,
  };

  const applied = await applyAdaptations(userId, [action], 'RUNNER_ACCEPTED').catch(() => 0);
  if (applied > 0) {
    await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});
  }

  return NextResponse.json({ ok: true, applied });
}
