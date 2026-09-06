/**
 * POST /api/v5/return/checkin · "How did today go".
 *
 * Body: `{ outcome }` where `outcome` is `silent | something_off`.
 *
 * `silent` advances, subject to the protocol's own limits: max one stage
 * advance per week, minimum two sessions at each stage
 * (`lib/plan/return-ladder.ts`). `something_off` repeats the stage. Never
 * scolds — the copy for a repeat states what happens next and nothing about
 * the runner (coach voice).
 *
 * Bone stress injuries are clinician-gated; a niggle is not. When the
 * protocol will not advance on a self-report alone, this refuses (422,
 * `refusal` set) rather than silently recording a check-in that could never
 * move anything.
 *
 * ── RETURNSTAGE-1 (2026-09-06) · THE NEXT RUNG IS NOW A DURABLE PROMISE ────
 *
 * `RETURN_TO_TRAINING_STAGE` has been a real member of `ReassessmentKind`
 * since migration 167 was drafted and had no production caller: the ladder
 * lived entirely in `return-ladder.ts`'s pure replay, re-derived from
 * `coach_intents` on every read and never durable in its own right. That is
 * fine for "what stage is he on" (a cheap, correct replay) and wrong for "when
 * does the next rung open" — the one-advance-per-week cap makes a concrete,
 * dated promise ("silent again on or after this date and the stage moves")
 * and nothing recorded that promise anywhere a process restart could find it.
 *
 * The mapping onto the scheduler's DATE-based due-ness: `applyCheckin` already
 * computes `advanceQueued` — the runner has cleared the two-session minimum at
 * this stage and is waiting only on the calendar. That date
 * (`lastAdvanceAt + MIN_DAYS_BETWEEN_ADVANCES`) is exactly the reassessment's
 * `assessOnISO`. When the stage actually advances, any standing promise for
 * this injury is resolved rather than left to expire on its own overdue date.
 *
 * Best-effort and never blocking, per this route's own `outage()` contract —
 * a scheduler outage must not turn a real check-in into a failed request.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { requireUserId } from '@/lib/auth/session';
import {
  loadActiveInjuryForReturn, protocolForInjury, loadReturnCheckins, recordReturnCheckin,
} from '@/lib/plan/return-checkin-store';
import {
  computeReturnLadderState, applyCheckin, advancementGateLine, MIN_DAYS_BETWEEN_ADVANCES,
  type ReturnCheckinOutcome,
} from '@/lib/plan/return-ladder';
import { MAX_WALK_RUN_STAGE } from '@/lib/plan/injury-protocols';
import { outage } from '@/lib/route/failure';
import { planVersionOf } from '@/lib/plan/plan-version';
import { scheduleReassessment, loadLiveQueue, resolveReassessment } from '@/lib/ops/reassessment-scheduler';
import { addDaysToDayKey } from '@/lib/runtime/day-key';

export const dynamic = 'force-dynamic';

const OUTCOMES = ['silent', 'something_off'] as const;

/**
 * RULE THREE, at the transport edge. This handler had no `try` around it, so
 * any read that threw left it as an unhandled route error. `outage()` is a
 * 503 with no `reason` key, which is what the phone maps to its data-outage
 * screen; the deliberate refusals inside keep their own 4xx and their own
 * sentence, and stay refusals.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await submitReturnCheckin(req);
  } catch (err) {
    return outage('v5/return/checkin', err);
  }
}

async function submitReturnCheckin(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const outcome = typeof body?.outcome === 'string' ? (body.outcome as ReturnCheckinOutcome) : null;
  if (!outcome || !OUTCOMES.includes(outcome)) {
    return NextResponse.json(
      // RULE FOUR · `v5Write` prints `reason` at the runner. A field name and
      // a list of enum values is a message to a client, not to a person.
      { ok: false, error: 'bad_request', reason: 'That is not one of the answers this check-in takes.' },
      { status: 400 },
    );
  }

  const injury = await loadActiveInjuryForReturn(userId);
  if (!injury) {
    // The GET on this same ladder already says this as a sentence
    // ("Nothing is flagged right now, so there is no ladder to climb.");
    // this one was still a log line, and it renders as an `Alert`.
    return NextResponse.json({ ok: false, error: 'no_active_injury', reason: 'Nothing is flagged right now, so there is no stage to check in on.' }, { status: 404 });
  }

  const resolved = protocolForInjury(injury);
  if (resolved.clearanceRequired) {
    // RULE THREE · a refusal, not a disabled control and not an error.
    return NextResponse.json({
      ok: false,
      error: 'clinician_gated',
      refusal: resolved.protocol.clearanceGate ?? 'This return is clinician-gated. A self-report cannot advance it.',
    }, { status: 422 });
  }

  const before = computeReturnLadderState(await loadReturnCheckins(userId, injury.id), resolved.protocol.startStage);
  const event = await recordReturnCheckin(userId, injury.id, outcome);
  const after = applyCheckin(before, event);

  /* RETURNSTAGE-1 · the durable promise. Contained in its own try — a
   * scheduler outage must not turn a recorded check-in into a failed
   * response, per this route's own `outage()` contract for the request as a
   * whole. */
  try {
    const activePlan = await rowOrNull<{ id: string; last_adapted_at: string | null }>(
      'v5/return/checkin · plan version',
      pool.query<{ id: string; last_adapted_at: string | null }>(
        `SELECT id::text AS id, last_adapted_at::text AS last_adapted_at FROM training_plans
          WHERE user_uuid = $1::uuid AND archived_iso IS NULL
          ORDER BY authored_iso DESC LIMIT 1`,
        [userId],
      ),
    );
    // A runner mid-return does not always carry an active `training_plans`
    // row (the return ladder is driven off `coach_intents`, not a plan), so
    // this falls back to the same "no version yet" convention
    // `planVersionOf` itself uses for a plan that has never been adapted,
    // rather than inventing a second spelling for the same fact (Rule 16).
    const planVersion = activePlan ? planVersionOf(activePlan) : `injury:${injury.id}:none`;
    const todayISO = event.at.slice(0, 10);

    if (after.stage > before.stage) {
      // The ladder answered its own question this check-in. Any standing
      // promise for the prior stage is resolved rather than left to expire
      // on its own — an item that quietly goes stale reads as a defect to
      // the sweep's overdue alert, and this was not one.
      const live = await loadLiveQueue(userId, 'RETURN_TO_TRAINING_STAGE');
      if (live.state === 'ok') {
        for (const item of live.value) {
          if (item.payload?.injuryId !== injury.id) continue;
          await resolveReassessment({
            id: item.id,
            status: 'RESOLVED',
            decision: 'STAGE_ADVANCED',
            detail: `the runner advanced to stage ${after.stage} via a ${outcome} check-in on `
              + `${todayISO}`,
          });
        }
      } else {
        console.log(`[v5/return/checkin] could not resolve prior stage promises · ${live.why}`);
      }
    }

    if (after.advanceQueued && after.lastAdvanceAt) {
      const dueISO = addDaysToDayKey(after.lastAdvanceAt.slice(0, 10), MIN_DAYS_BETWEEN_ADVANCES);
      const res = await scheduleReassessment({
        userUuid: userId,
        kind: 'RETURN_TO_TRAINING_STAGE',
        reasonCode: 'return_ladder_advance_queued',
        reasonDetail: `stage ${after.stage} has cleared its two-session minimum and is waiting `
          + `on the one-advance-per-week cap; a silent check-in on or after ${dueISO} advances it `
          + `to the next rung`,
        assessOnISO: dueISO,
        overdueAfterISO: addDaysToDayKey(dueISO, 7),
        planId: activePlan?.id ?? null,
        planVersion,
        lever: 'PLAN_STRUCTURE',
        payload: { injuryId: injury.id, stage: after.stage },
        idempotencyKey: `return:${injury.id}:stage:${after.stage}`,
        queuedAtISO: todayISO,
      });
      if (res.state !== 'ok') {
        console.log(`[v5/return/checkin] promise not scheduled · ${res.state} · ${res.why}`);
      }
    }
  } catch (e) {
    console.error(
      '[v5/return/checkin] scheduler write threw and was contained ·',
      e instanceof Error ? e.message : e,
    );
  }

  return NextResponse.json({
    ok: true,
    outcome,
    stage: after.stage,
    stageCount: MAX_WALK_RUN_STAGE,
    advanced: after.stage > before.stage,
    coachLine: advancementGateLine(after),
  });
}
