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
import { acceptProposal, reopenProposal, resolveProposalExpirationPromise } from '@/lib/plan/workout-proposals';
import { asRepricePayload } from '@/lib/plan/reprice-payload';
import { applyAdaptations } from '@/lib/plan/adapt';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { loadPendingProposalById } from '@/lib/plan/workout-proposals';
import { readLiveRows, actionFromPending, LEGACY_MUTATING_ACTION_KINDS } from '@/lib/brain/proposal/staleness';
import { prepareAction } from '@/lib/brain/proposal/execute';
import { httpStatusForRefusal, refusalFor } from '@/lib/plan/mutation-refusal';

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
    /* ── ACTIONCOMPLETE-2 · RECORD_ONLY IS NOT "NOT ACTIONABLE" ────────────
     *
     * This refused EVERY non-mutating action, which was right for the kinds it
     * could see and wrong for the three it could not. `applyBrainAction` has
     * always treated RECORD_ONLY as the correct outcome — "the decision is the
     * record; HOLD, REFUSAL and SAFETY_STOP exist so a judgement is visible" —
     * so with those kinds now reachable the route and the applier gave OPPOSITE
     * answers to the same tap (Rule 16). The applier is right; it owns the
     * question.
     *
     * The guard itself stays, because it catches the thing it was written for:
     * a kind routed to a real apply path that resolves to no write is a routing
     * bug, and consuming the card while reporting success is the "applied: 0,
     * ok: true" lie in a different costume. */
    if (prepared.plan.nonMutating) {
      const { executorFor } = await import('@/lib/brain/proposal/executor-map');
      if (executorFor(action).path !== 'RECORD_ONLY') {
        return NextResponse.json(
          { ok: false, error: 'not_actionable', detail: prepared.plan.because },
          { status: 422 },
        );
      }
    }
  }

  const proposal = await acceptProposal(userId, proposalId);
  if (!proposal) {
    return NextResponse.json({ ok: false, error: 'not_pending' }, { status: 404 });
  }

  /* PROPOSALEXPIRE-1 · this card was answered, so its standing
   * `PROPOSAL_EXPIRATION` promise (if `writeWorkoutProposals` scheduled one)
   * is resolved now rather than left to auto-expire later with a false
   * "not applied" verdict. */
  await resolveProposalExpirationPromise(
    userId, proposalId, 'ACCEPTED',
    `the runner accepted this proposal on ${new Date().toISOString().slice(0, 10)}`,
  );

  /* ── ACTIONCOMPLETE-1 (2026-09-05) · ONE DOOR, DISPATCHED ON THE ACTION ───
   *
   * Below this, the route used to switch on the ROW's `action_kind` and rebuild
   * an `AdaptationAction` from three payload fields — so it could apply exactly
   * what the legacy payload could describe, and the twenty-one-kind schema was
   * a reader with no writer.
   *
   * A row that STATES its action now goes through `applyBrainAction`, which
   * dispatches on `executor-map.ts`'s named path. The legacy path underneath is
   * unchanged and still serves every row written before 2026-09-05, which have
   * no stored action at all.
   *
   * The write is `RUNNER_ACCEPTED` either way. Nothing about the seam moves.
   *
   * `reprice` is EXCLUDED and keeps the branch below. Not because that branch
   * would be wrong — `applyBrainAction` routes COORDINATED to the same
   * `applyReanchorProposal` — but because it answers with `sealed`,
   * `proposed_to_vdot` and `applied_to_vdot`, which is how a reader can see
   * that the arms re-resolved the anchors at accept time. Rerouting it would
   * quietly shrink a response the client already reads.
   */
  const storedAction = actionFromPending(proposal);
  if (storedAction != null
    && proposal.actionPayload?.action != null
    && proposal.actionKind !== 'reprice') {
    const { applyBrainAction } = await import('@/lib/brain/proposal/accept');
    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const outcome = await applyBrainAction(storedAction, {
      userUuid: userId,
      todayISO: await runnerToday(userId),
      proposalId,
      why: proposal.actionPayload.why ?? proposal.reason,
    });
    if (!outcome.ok) {
      console.error('[proposal/accept] applyBrainAction refused', { proposalId, outcome });
      /* ── ZEROACCEPT-1, extended to this lane · MERGED WITH ACCEPTTWIN-1 ──────
       * `acceptProposal` above already stamped this row 'accepted'. Every
       * failure here is a change that did not land, so the card goes back —
       * same as every other failure branch in this route — on top of
       * ACCEPTTWIN-1's status/reason/retryable fix below, which is a
       * different, non-overlapping defect on this same limb. */
      await sayIfTheCardCouldNotBePutBack(userId, proposalId);
      /* ── ACCEPTTWIN-1 (2026-09-13) · THE UNTOUCHED TWIN OF THE UNDO ROUTE ──
       *
       * This ladder was the last hand-derived status left on a route that
       * answers a `mutatePlan` refusal, and it was WRONG in exactly the way
       * `STATUSCARRY-1` fixed everywhere else. The `: 409` tail caught
       * `unverified`, which is what `applyBrainAction` reports for BOTH
       * `plan_verification_failed` (a read inside the boundary threw) and
       * `ledger_unwritten` (the decision could not be recorded, so it was
       * rolled back). Both are 503 and `retryable: true`, and `refusalFor`
       * had already said so one hop back.
       *
       * The measured consequence, live while migration 166 is unapplied to
       * production and `landDecisionInTransaction` therefore refuses every
       * structural mutation: the runner taps LET IT HAPPEN, the boundary
       * refuses with `ledger_unwritten`, and this route answered a bare 409
       * carrying `{ error, detail }`. `APIV5.answerProposal` decodes a
       * `V5Refusal` off any 4xx, finds neither `refusal` nor `reason` (it is
       * forbidden from reading `detail`, which is machine text naming a row
       * id), and falls into its `statusCode == 409` branch — which prints a
       * sentence the phone wrote itself:
       *
       *     "This session has changed since the coach proposed it, so the
       *      decision no longer fits. It will be raised again against the
       *      session as it stands."
       *
       * Nothing about the session had changed. The database could not write a
       * ledger row. The runner is told his card is stale, so he will not retry,
       * and retrying is the only thing that would have worked. That is the
       * `refusalFor` bug — an honest backend refusal turned into a false
       * runner-facing sentence — surviving on the one route nobody re-read.
       *
       * Three things move, and all three are needed:
       *   `status`    — 503 now reaches the phone, which does not fabricate
       *                 outside 4xx, so the false sentence is unreachable.
       *   `reason`    — the coach sentence under the key the phone READS, so a
       *                 refusal that IS a 409 (a doctrine rejection) also stops
       *                 borrowing the stale-session sentence.
       *   `retryable` — Rule 11 on the wire: "do not retry" and "ask again" are
       *                 different facts and the client must be able to tell.
       *
       * The ladder stays as the FALLBACK for the errors this route's own
       * applier raises, which carry no status of their own. */
      const status = httpStatusForRefusal(
        { code: outcome.error, status: outcome.status, retryable: outcome.retryable },
        { unsupported: 422, apply_failed: 500 },
        409,
      );
      return NextResponse.json(
        {
          ok: false,
          error: outcome.error,
          detail: outcome.detail,
          ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
          ...(outcome.retryable === undefined ? {} : { retryable: outcome.retryable }),
        },
        { status },
      );
    }
    /* The wrist is asked to look again only when what it CARRIES moved. A
     * change three weeks out has no business invalidating a workout the runner
     * may be standing on the start line of (Rule 16). */
    if (outcome.watch.kind !== 'NO_WATCH_EFFECT') {
      await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});
    }
    return NextResponse.json({
      ok: true,
      applied: outcome.applied,
      recorded_only: outcome.recordedOnly,
      /* "Approval is not the control mechanism; reversibility is" — so the
       * response says whether this one can be put back, rather than leaving the
       * runner to find out by trying. */
      undoable: outcome.undo.can,
      ...(outcome.undo.can ? {} : { undo_blocked_because: outcome.undo.because }),
      ...(outcome.because ? { because: outcome.because } : {}),
    });
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
      // Found by independent review, 2026-09-12: `acceptProposal` above already
      // stamped this row 'accepted' before this branch runs, same as every
      // other failure path in this route — an unreadable payload leaves the
      // plan untouched exactly like `apply_refused`/`apply_failed` below, and
      // owes the runner the same reopen.
      await sayIfTheCardCouldNotBePutBack(userId, proposalId);
      return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
    }
    const [{ applyReanchorProposal }, { runnerToday }] = await Promise.all([
      import('@/lib/plan/reanchor-plan'),
      import('@/lib/runtime/runner-tz'),
    ]);
    const today = await runnerToday(userId);
    const outcome = await applyReanchorProposal(
      userId,
      { planId: reprice.planId, arm: reprice.arm, toVdot: reprice.toVdot },
      today,
    ).catch((e: unknown) => {
      console.error('[workout-proposals/accept] reprice apply threw:', e);
      /* Rule 11 · a THROW is its own fact and is not one of the four the
       * applier characterises. `refusalFor`'s default limb is exactly the
       * sentence for it — "could not be applied, nothing was changed", 503,
       * retryable — so nothing new is written here either. */
      const r = refusalFor({ outcome: 'not_attempted', violations: [] }, { thing: 'That repricing' });
      return { ok: false as const, code: 'apply_threw' as const, because: 'the reprice apply path threw',
        reason: r.reason, status: r.status, retryable: r.retryable };
    });
    if (!outcome.ok) {
      /* ── ZEROACCEPT-1, extended to this lane · MERGED WITH REPRICEREASON-1 ──
       * `acceptProposal` already stamped this row 'accepted' before the
       * reprice apply ran (or threw). A refused or thrown reprice is a
       * change that did not land, on a card the runner has no way to retry
       * without this — same reopen every other failure branch in this route
       * performs, orthogonal to REPRICEREASON-1's status/reason fix below. */
      await sayIfTheCardCouldNotBePutBack(userId, proposalId);
      /* ── REPRICEREASON-1 (2026-09-13) · THE LIMB THAT WAS DEFERRED TWICE ───
       *
       * This answered `{ ok: false, error: 'apply_refused' }` with HTTP 409 and
       * no `reason`, which is precisely the shape ACCEPTTWIN-1 fixed on the
       * action limb thirty lines up and UNDOTWIN-1 fixed on the undo twin. The
       * phone decodes a `V5Refusal` off a 4xx, finds no `refusal` and no
       * `reason`, and falls into its own 409 branch, which prints:
       *
       *     "This session has changed since the coach proposed it, so the
       *      decision no longer fits. It will be raised again against the
       *      session as it stands."
       *
       * A repricing is not about a session at all. It is one decision over the
       * whole block, and the four things that actually refuse it are a rebuilt
       * plan, an unreadable card, a deferral and a write that touched nothing.
       * The sentence names none of them, and "it will be raised again" is a
       * promise this route cannot keep for a card that is already stale.
       *
       * A prior round left it here believing the refusal was uncharacterised.
       * It was not; see `ReanchorApplyOutcome`. Nothing new is invented below —
       * the applier carries the reason it already had. */
      const status = httpStatusForRefusal(
        { code: outcome.code, status: outcome.status, retryable: outcome.retryable },
        {},
        409,
      );
      return NextResponse.json(
        {
          ok: false,
          error: outcome.code,
          // The coach sentence, under the key the phone reads.
          reason: outcome.reason,
          // Machine text. Never printed to a runner; kept for the log.
          detail: outcome.because,
          retryable: outcome.retryable,
        },
        { status },
      );
    }
    const res = outcome.result;
    await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});
    return NextResponse.json({
      ok: true,
      applied: res.workoutsUpdated,
      sealed: res.workoutsSealed,
      proposed_to_vdot: reprice.toVdot,
      applied_to_vdot: res.toVdot,
    });
  }

  /* ── ACTIONCOMPLETE-2 (2026-09-05) · THE LEGACY LANE IS LEGACY-ONLY ───────
   *
   * Below here is the path for rows written before the action was stated on
   * the row: it rebuilds an `AdaptationAction` from `newType` / `newDate` /
   * `shaveFraction`, which only the five ORIGINAL engine words ever populated.
   *
   * The `action_kind` column can now also hold a `BrainAction` kind, written by
   * `lib/brain/proposal/write.ts`. Such a row ALWAYS carries a stored action
   * and is answered above; one that reaches here has a kind this lane has no
   * fields for, and pumping it into `applyAdaptations` would hand the pipeline
   * a kind it does not implement, which lands as `applied: 0`. Rule 11: that is
   * a refusal the runner is owed, not a silent nothing — and the card goes back
   * so he can try again rather than being spent.
   */
  if (!LEGACY_MUTATING_ACTION_KINDS.has(proposal.actionKind)) {
    console.error(
      `[proposal/accept] ${proposalId} carries kind ${proposal.actionKind} and no readable stored `
      + 'action; the legacy lane has no fields for it',
    );
    await sayIfTheCardCouldNotBePutBack(userId, proposalId);
    return NextResponse.json({
      ok: false,
      error: 'unsupported',
      detail: `this decision states no action and ${proposal.actionKind} is not a legacy kind`,
    }, { status: 422 });
  }

  // Reconstruct the AdaptationAction shape from the stored payload
  // and pump it through applyAdaptations. The existing path handles
  // sealed-day guards, original_* tracking, coach_intents audit, and
  // workout_spec re-derivation.
  const adaptation = {
    kind: proposal.actionKind as 'downgrade' | 'shave' | 'reschedule' | 'field_test' | 'mark_upgrade',
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
    // LEDGERANSWER-1 · the legacy lane records the runner's answer too. These
    // are the pre-2026-09-05 rows that carry no stored action; the tap that
    // accepts one is exactly as much a consent as any other.
    applied = await applyAdaptations(userId, [adaptation], 'RUNNER_ACCEPTED', {
      proposalId: String(proposalId),
      runnerResponse: 'ACCEPTED',
      explanation: adaptation.why,
    });
  } catch (err) {
    console.error('[proposal/accept] apply failed', { proposalId, err });
    // ZEROACCEPT-1 · the card is not consumed by a write that did not happen.
    // `acceptProposal` stamped it accepted BEFORE the apply ran, so a throw
    // here left a decision marked answered whose change never landed, and the
    // runner had no way to ask for it again.
    await sayIfTheCardCouldNotBePutBack(userId, proposalId);
    return NextResponse.json({ ok: false, error: 'apply_failed' }, { status: 500 });
  }

  /* ── ZEROACCEPT-1 (2026-09-05) · ZERO ROWS IS A FAILURE ON THIS LANE TOO ──
   *
   * `applyBrainAction` has had `zeroIsNotSuccess` since it was written, and
   * this lane — the one every row from before 2026-09-05 still takes — did
   * not. So the two lanes gave opposite answers to the same event.
   *
   * Measured on a scratch database, by writing a proposal whose `action_kind`
   * is a word nothing has been taught (`teleport_workout`) and accepting it:
   *
   *   POST /api/plan/workout-proposals/12/accept   200  {"ok":true,"applied":0}
   *   proposal 12 → accepted
   *   plan row    → unchanged
   *
   * The runner taps a button, the plan does not move, the card disappears, and
   * the response says it worked — which is the exact lie this route's own
   * header two paragraphs up says it had removed for FAILED applies, surviving
   * in the case where the apply does not fail but does nothing.
   *
   * A kind this engine cannot apply is also a kind nobody should be able to
   * consume, so the row goes back to pending rather than being spent.
   */
  if (applied === 0) {
    console.error(
      `[proposal/accept] ${proposal.actionKind} on proposal ${proposalId} touched no row; `
      + 'the plan did not move and the card has been put back',
    );
    await sayIfTheCardCouldNotBePutBack(userId, proposalId);
    return NextResponse.json({
      ok: false,
      error: 'apply_failed',
      detail: `the ${proposal.actionKind} was accepted and touched no row; the plan did not move`,
    }, { status: 500 });
  }

  await bustBriefingCacheForEvent(userId, 'plan_swap').catch(() => {});

  return NextResponse.json({ ok: true, applied });
}

/**
 * Put the card back, and SAY SO when that itself fails.
 *
 * Rule 11 on the recovery path. A reopen that fails leaves a decision marked
 * accepted whose change never landed — the worst state this route can produce,
 * because the runner has no card to try again with and nothing anywhere says
 * why. It is logged rather than surfaced: the response is already a failure and
 * the runner does not need two.
 */
async function sayIfTheCardCouldNotBePutBack(userId: string, proposalId: number): Promise<void> {
  const back = await reopenProposal(userId, proposalId);
  if (!back.ok) {
    console.error(
      `[proposal/accept] proposal ${proposalId} is marked accepted, its change did not land, `
      + 'and the reopen ALSO failed. The runner has no card to retry with.',
    );
  } else if (!back.reopened) {
    console.error(
      `[proposal/accept] proposal ${proposalId} was not in the accepted state to reopen`,
    );
  }
}
