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
  if (action) {
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
