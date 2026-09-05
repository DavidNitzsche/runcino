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
import { loadPendingProposalById } from '@/lib/plan/workout-proposals';
import { readLiveRows, actionFromPending } from '@/lib/brain/proposal/staleness';
import { prepareAction } from '@/lib/brain/proposal/execute';

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

  /**
   * STALENESS FIRST, ACCEPTANCE SECOND.
   *
   * The old order marked the row accepted and then applied. A proposal raised
   * on Tuesday about a plan rebuilt on Wednesday was therefore consumed —
   * status 'accepted', resolved_at stamped — while writing a change reasoned
   * about a session that no longer existed. Checking before accepting leaves
   * the proposal pending so it can be re-raised against the plan that is
   * actually there.
   */
  const lookup = await loadPendingProposalById(userId, proposalId);
  if (!lookup.ok) {
    // The read failed. That is not "no such proposal" — telling the runner his
    // card does not exist because the database blinked is a lie he would act on.
    return NextResponse.json({ ok: false, error: 'read_failed' }, { status: 503 });
  }
  const pending = lookup.proposal;
  if (!pending) {
    return NextResponse.json({ ok: false, error: 'not_pending' }, { status: 404 });
  }

  const live = await readLiveRows(userId, [pending.planWorkoutId]);
  const action = actionFromPending(pending);
  /**
   * A repricing is checked by its OWN apply path, not by this one.
   *
   * It is hung on an anchor day for display, but the decision is about the
   * whole block and `applyReanchorProposal` validates the plan it names.
   * Running the per-row check here would refuse the card because the anchor
   * day happened to move — and a false stale on this kind is the worst
   * outcome available: his prescribed paces silently stop updating with a
   * 409 he never sees. The generic check is for per-row proposals.
   */
  if (action && pending.actionKind !== 'reprice') {
    /**
     * The proposal's `before` is reconstructed from its evidence blob, which
     * records what the session was WHEN THE DECISION WAS MADE. Comparing that
     * to the live row is the whole check: if the session has since been moved,
     * resized or retyped, this card was reasoned about something else.
     */
    const prepared = prepareAction(action, live);
    if (!prepared.ok) {
      return NextResponse.json(
        { ok: false, error: 'stale', detail: prepared.refusedBecause },
        { status: 409 },
      );
    }
    if (prepared.plan.nonMutating) {
      // The action resolves to no write. Accepting it would consume the card
      // and change nothing, which is the "applied: 0, ok: true" lie in a
      // different costume.
      return NextResponse.json(
        { ok: false, error: 'not_actionable', detail: prepared.plan.because },
        { status: 422 },
      );
    }
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
  const adaptation = {
    kind: proposal.actionKind,
    workoutIds: [proposal.planWorkoutId],
    newType: proposal.actionPayload.newType ?? undefined,
    newDate: proposal.actionPayload.newDate ?? undefined,
    shaveFraction: proposal.actionPayload.shaveFraction ?? undefined,
    why: proposal.actionPayload.why ?? proposal.reason,
  };

  /**
   * Rule 11 · this was `.catch(() => 0)`, so a failed apply returned
   * `{ ok: true, applied: 0 }`. The runner tapped a button, the plan did not
   * move, and the response said it worked. A failure is a third fact and it
   * gets its own status code.
   */
  let applied: number;
  try {
    applied = await applyAdaptations(userId, [adaptation], 'RUNNER_ACCEPTED');
  } catch (err) {
    console.error('[proposal/accept] apply failed', { proposalId, err });
    return NextResponse.json({ ok: false, error: 'apply_failed' }, { status: 500 });
  }

  if (applied > 0) {
    await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});
  }

  return NextResponse.json({ ok: true, applied });
}
