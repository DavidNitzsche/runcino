/**
 * POST /api/plan/workout-proposals/:id/undo · PUT ONE ACCEPTED DECISION BACK.
 *
 * ── WHY THIS ROUTE DID NOT EXIST ───────────────────────────────────────────
 *
 * `POST .../accept` has answered `undoable: true` on every successful accept
 * since `applyBrainAction` was written. Nothing could act on it: `undo.ts`
 * computed the inverse and the only callers were that report and its own test.
 * So the response made a promise the product could not keep, on the clause the
 * owner said the whole lane rests on — "approval is not the control mechanism;
 * reversibility is".
 *
 * ── WHY IT IS NOT `/api/plan/undo` ─────────────────────────────────────────
 *
 * That route undoes a REBUILD, wholesale, by un-archiving the previous block,
 * and its own header explains why wholesale is right there: the runner noticed
 * because his week counter reset. An accepted proposal is the opposite case —
 * one session moved — and un-archiving the block would throw away everything
 * else that has happened since. Two different questions, two routes, and
 * neither one is a softer version of the other.
 *
 * → 200 { ok: true, reverted, nothing_to_undo? }
 * → 400 { ok: false, error: 'invalid_body' }
 * → 404 { ok: false, error: 'not_accepted' }   nothing accepted under that id
 * → 409 { ok: false, error: 'stale' | 'rejected' }
 * → 422 { ok: false, error: 'not_undoable' }   with the field that was not recorded
 * → 500 { ok: false, error: 'apply_failed' }
 * → 503 { ok: false, error: 'read_failed' }    the read failed; that is not "no such row"
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { loadAcceptedProposalById, reopenProposal } from '@/lib/plan/workout-proposals';
import { actionFromPending } from '@/lib/brain/proposal/staleness';
import { applyUndo } from '@/lib/brain/proposal/undo-apply';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { runnerToday } from '@/lib/runtime/runner-tz';

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

  const lookup = await loadAcceptedProposalById(userId, proposalId);
  if (!lookup.ok) {
    // Rule 11 · the read failed. Telling the runner he never accepted this
    // because the database blinked is a lie he would act on.
    return NextResponse.json({ ok: false, error: 'read_failed' }, { status: 503 });
  }
  const accepted = lookup.proposal;
  if (!accepted) {
    return NextResponse.json({ ok: false, error: 'not_accepted' }, { status: 404 });
  }

  const action = actionFromPending(accepted);
  if (action == null) {
    return NextResponse.json({
      ok: false,
      error: 'not_undoable',
      detail: 'this decision predates the recorded-action format, so there is nothing to invert',
    }, { status: 422 });
  }

  /* A repricing is excluded for the same reason the accept path excludes it:
   * it is one decision over the whole block, applied against canonical anchors
   * rather than replayed row by row, and its inverse is a re-anchor rather than
   * a column restore. Refusing by name beats writing back seventy-seven rows
   * this route does not own. */
  if (accepted.actionKind === 'reprice') {
    return NextResponse.json({
      ok: false,
      error: 'not_undoable',
      detail: 'a whole-block repricing is reversed by re-anchoring, not by putting one session back',
    }, { status: 422 });
  }

  const outcome = await applyUndo(action, {
    userUuid: userId,
    todayISO: await runnerToday(userId),
    proposalId,
    reason: `the runner reversed this decision · ${accepted.reason}`,
  });

  if (!outcome.ok) {
    const status = outcome.error === 'not_undoable' ? 422
      : outcome.error === 'apply_failed' ? 500 : 409;
    return NextResponse.json({ ok: false, error: outcome.error, detail: outcome.because }, { status });
  }

  /* The proposal goes back to PENDING, not to dismissed. He accepted, saw it,
   * and took it back — the decision is open again rather than answered no, and
   * the decision history has to be able to tell those apart. */
  const back = await reopenProposal(userId, proposalId);
  if (!back.ok) {
    console.error('[proposal/undo] the plan was reverted and the reopen FAILED', { proposalId });
  } else if (!back.reopened) {
    console.error('[proposal/undo] the plan was reverted and no accepted row was there to reopen',
      { proposalId });
  }

  await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});

  return NextResponse.json({
    ok: true,
    reverted: outcome.reverted,
    ...('nothingToUndo' in outcome ? { nothing_to_undo: true, because: outcome.because } : {}),
    reopened: back.ok && back.reopened,
  });
}
