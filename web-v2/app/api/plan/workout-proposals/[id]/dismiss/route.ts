/**
 * POST /api/plan/workout-proposals/:id/dismiss
 *
 * Runner declines a pending plan_workout_proposals row · plan stays
 * unchanged. Banner disappears on next page load.
 *
 * → 200 { ok: true, decline: { kind, because } }
 * → 400 { ok: false, error: 'invalid_body' }
 * → 404 { ok: false, error: 'not_pending' }
 * → 422 { ok: false, error: 'not_declinable' }  a stop is not a question
 * → 503 { ok: false, error: 'read_failed' }
 *
 * David 2026-06-04 · this is the "KEEP ORIGINAL" button on the banner.
 *
 * ── ACTIONCOMPLETE-2 (2026-09-05) · THE RUNNER'S NO GETS A MODEL ───────────
 *
 * This route was one UPDATE for twenty-one kinds. Accept had a total executor
 * map, a ledger classification, a watch effect and an undo posture per kind;
 * decline had a status word. That is Rule 22's asymmetry pointed at the
 * runner's own answer, and it cost one specific thing: A SAFETY STOP COULD BE
 * DISMISSED. The route asked no question and no kind, so tapping "Leave it" on
 * a withhold marked it answered — an override of safety by a button, which is
 * the one thing the whole authority boundary exists to make impossible.
 *
 * `lib/brain/proposal/decline-facet.ts` is the classification and this asks it
 * BEFORE the write, so a NOT_DECLINABLE card is refused rather than consumed.
 * The refusal is not about the runner's judgement: a stop lifts when the signal
 * that raised it clears, and there is no answer he can give that changes that.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { dismissProposal, loadPendingProposalById } from '@/lib/plan/workout-proposals';
import { actionFromPending } from '@/lib/brain/proposal/staleness';
import { declineBehaviorOf } from '@/lib/brain/proposal/decline-facet';

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

  /* LOOK BEFORE WRITING. `dismissProposal` marks the row in the same statement
   * that finds it, which is correct for the write and useless for a decision
   * that has to be taken first. Same shape as the accept route's staleness
   * check, and for the same reason: a card consumed by a refusal is a decision
   * the runner can no longer reach. */
  const lookup = await loadPendingProposalById(userId, proposalId);
  if (!lookup.ok) {
    /* Rule 11 · the read failed. Telling the runner his card is gone because
     * the database blinked is a lie he would act on. */
    return NextResponse.json({ ok: false, error: 'read_failed' }, { status: 503 });
  }
  const pending = lookup.proposal;
  if (!pending) {
    return NextResponse.json({ ok: false, error: 'not_pending' }, { status: 404 });
  }

  /* A row whose action cannot be read is still dismissable, and deliberately
   * so. The seven rows that predate the stored-action format carry ordinary
   * per-workout changes, and refusing to let the runner clear one because this
   * build cannot parse it would strand a card on his phone forever. Only a
   * decision this build CAN read, and that reads as NOT_DECLINABLE, is
   * refused — the exemption is guarded by the violating condition rather than
   * bypassing the check (Rule 18 point 3). */
  const action = actionFromPending(pending);
  const decline = action == null ? null : declineBehaviorOf(action);
  if (decline != null && decline.kind === 'NOT_DECLINABLE') {
    return NextResponse.json({
      ok: false,
      error: 'not_declinable',
      detail: decline.because,
    }, { status: 422 });
  }

  const ok = await dismissProposal(userId, proposalId);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'not_pending' }, { status: 404 });
  }

  /* The runner's no, recorded where it can be counted.
   *
   * Rule 21's measurement — "309 intents, zero upward" — could not separate
   * "never proposed" from "proposed and declined", because nothing recorded the
   * second. A log line is the weakest form of recording it and it is what this
   * route can honestly do: the ledger row belongs to the mutation boundary, and
   * a decline mutates no plan, so there is no transaction to hang one on. Said
   * here rather than left unsaid, and named as the gap it is. */
  console.log(
    `[proposal/dismiss] ${userId} declined #${proposalId} (${pending.actionKind})`
    + `${decline == null ? '' : ` · ${decline.kind} · ${decline.because}`}`
    + `${decline?.reraise === false ? ' · will not be re-raised' : ''}`,
  );

  return NextResponse.json({
    ok: true,
    ...(decline == null ? {} : { decline: { kind: decline.kind, because: decline.because } }),
  });
}
