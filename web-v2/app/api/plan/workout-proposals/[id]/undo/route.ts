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
 * → 409 { ok: false, error: 'stale' | 'rejected', reason?, retryable? }
 * → 422 { ok: false, error: 'not_undoable' }   with the field that was not recorded
 * → 500 { ok: false, error: 'apply_failed' }
 * → 503 { ok: false, error: 'unverified' | 'read_failed', reason?, retryable? }
 *
 * UNDOTWIN-1 (2026-09-13) · `reason` is the coach sentence and is the key the
 * phone reads. It is present on every refusal `refusalFor` resolved, and its
 * absence is what let the phone fabricate a stale-session sentence over a
 * doctrine rejection. `detail` is machine text and must never be printed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { loadAcceptedProposalById, reopenProposal } from '@/lib/plan/workout-proposals';
import { actionFromPending } from '@/lib/brain/proposal/staleness';
import { applyUndo } from '@/lib/brain/proposal/undo-apply';
import { httpStatusForRefusal } from '@/lib/plan/mutation-refusal';
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
    /* STATUSCARRY-1 (2026-09-13) · the `: 409` tail answered every `unverified`
     * — a failed read inside the boundary, an unwritable ledger — with "your
     * request conflicts with the state of things". Those are 503 and retryable,
     * and `refusalFor` already said so; `applyUndo` now carries it through.
     * The ladder below is the fallback for the errors it raises itself.
     *
     * ── UNDOTWIN-1 (2026-09-13) · THE REASON HALF, WHICH ROUND 6 DID NOT CARRY
     *
     * STATUSCARRY-1 fixed the STATUS half here and ACCEPTTWIN-1 later proved,
     * on the sibling accept route, that the status half alone is not enough. A
     * DOCTRINE rejection is a genuine 409, so the status carry changes nothing
     * for it — and this route answered it with `{ error, detail }` and no
     * `reason`. `APIV5` decodes a `V5Refusal` off a 4xx, finds neither
     * `refusal` nor `reason`, and the phone prints a sentence it wrote itself:
     *
     *     "Something else has moved this session since. Taking it back now
     *      would write over that change."          HostsV5.swift
     *
     * Nothing had moved the session. `movedSinceAccept` ran first and passed;
     * the boundary refused the reversal on the plan's own rules. The runner is
     * told a false fact about his own plan, in the coach's voice, on the one
     * control the whole proposal lane rests on ("approval is not the control
     * mechanism; reversibility is"). Same lie, same cause and same fix as
     * ACCEPTTWIN-1, on the twin nobody re-read.
     *
     * `reason` carries `refusalFor`'s sentence and nothing else. `detail` stays
     * as it was — it interleaves the violation strings, which name plan row ids
     * and must never reach a runner. */
    const status = httpStatusForRefusal(
      { code: outcome.error, status: outcome.status, retryable: outcome.retryable },
      { not_undoable: 422, apply_failed: 500 },
      409,
    );
    return NextResponse.json(
      {
        ok: false, error: outcome.error, detail: outcome.because,
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
        // Rule 11 on the wire: the client must be able to tell "do not retry"
        // from "ask again". Absent when the boundary had no opinion.
        ...(outcome.retryable === undefined ? {} : { retryable: outcome.retryable }),
      },
      { status },
    );
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
