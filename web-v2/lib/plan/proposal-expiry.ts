/**
 * lib/plan/proposal-expiry.ts · WHEN A PER-WORKOUT PROPOSAL STOPS BEING A
 * LIVE QUESTION, stated once.
 *
 * ── WHAT WAS WRONG (V5PROPOSALSURFACE-1, 2026-09-05) ───────────────────────
 *
 * Expiry lived inside `loadPendingProposals` as a fire-and-forget UPDATE with
 * `.catch(() => {})` on the end, and it was broken in three separate ways at
 * once. Production is the proof: `plan_workout_proposals` row 6 was raised on
 * 2026-08-23 for a workout on 2026-08-25 and was STILL `pending` eleven days
 * later, on a table with seven rows in the life of the product.
 *
 *   1 · IT ONLY RAN WHEN A PHONE ASKED. The single V5 caller of the read path
 *       shipped on 2026-09-05; before that the only reader was the v4 shell
 *       behind `-faffLegacy` and the web seed. So "keeps the table clean
 *       without a separate cleanup cron" was true only for a runner who opened
 *       a screen nobody could reach. Rule 23: a job that depends on something
 *       else happening first has an undeclared precondition, and here the
 *       precondition was A HUMAN OPENING AN APP.
 *
 *   2 · A FAILED EXPIRY WAS INDISTINGUISHABLE FROM A CLEAN ONE. `.catch(() =>
 *       {})` is Rule 11 exactly: the write either happened or it did not, and
 *       nothing downstream could tell. The audit that found row 6 could not
 *       separate "never called" from "called and failed" WITHOUT A LOG, and
 *       said so.
 *
 *   3 · IT ASKED THE SERVER WHAT DAY IT WAS. `workout_date_iso < CURRENT_DATE`
 *       is server-clock UTC. `lib/runtime/runner-tz.ts` exists because that is
 *       wrong for every runner west of Greenwich: for a Pacific runner the
 *       server rolls over at 5pm local, so a proposal for TODAY'S session
 *       expires while he is still deciding whether to run it.
 *
 * ── AND THE FOURTH THING, WHICH IS NOT A BUG BUT A GAP ─────────────────────
 *
 * The only expiry clause was "the workout date has passed". A proposal raised
 * for a session three weeks out and never answered stays `pending` for three
 * weeks, defeating the pending-row dedupe in `writeWorkoutProposals` for that
 * whole time — the identical failure `expireStalePendingProposals` was written
 * for on `plan_proposals`, where 19 duplicate rows accumulated on one runner
 * before anyone noticed. So this module carries the same 14-day unanswered
 * clause, reusing that module's number rather than inventing a second one
 * (Rule 16).
 *
 * ── WHAT THIS MODULE PROMISES ──────────────────────────────────────────────
 *
 * One definition of stale, one caller-visible result type that cannot be
 * mistaken for success, and a runner-timezone day. It is idempotent and cheap,
 * so per Rule 23 the read path ENSURES it rather than assuming a cron ran.
 */
import { pool } from '@/lib/db/pool';
import { attempt } from '@/lib/db/read';
import { runnerToday } from '@/lib/runtime/runner-tz';

/**
 * How long an unanswered proposal stays a live question.
 *
 * Reused from `plan_proposals`, which has expired pending rows at 14 days
 * since 2026-08-17 (`lib/plan/goal-outlook.ts::expireStalePendingProposals`).
 * Two tables holding one runner's open decisions must not age them at two
 * different rates: a history surface that lists both would show one kind of
 * decision going quiet at a fortnight and the other never.
 */
export const PROPOSAL_UNANSWERED_EXPIRY_DAYS = 14;

/**
 * What an expiry pass did, or why it could not.
 *
 * A discriminated union with NO `expired` field on the failure branch, so a
 * caller cannot read a count off a failed pass. Same enforcement posture as
 * `NormalReading<T>` in `lib/training/normal-window.ts`: the Rule 11
 * distinction is a type error rather than a discipline.
 */
export type ProposalExpiryResult =
  | { readonly ok: true; readonly expiredPastDated: number; readonly expiredUnanswered: number }
  | { readonly ok: false; readonly error: Error };

/** Total, for a caller that only wants the number. Never callable on a failure. */
export function expiredCount(r: Extract<ProposalExpiryResult, { ok: true }>): number {
  return r.expiredPastDated + r.expiredUnanswered;
}

/**
 * Expire every `plan_workout_proposals` row for this runner that has stopped
 * being a live question.
 *
 * Two clauses, deliberately reported separately, because they are different
 * facts about the runner and collapsing them would hide which one is firing:
 *
 *   PAST-DATED  the session it proposes to change has already happened. The
 *               runner either ran it or did not, and either way changing it is
 *               a no-op. Measured against the RUNNER'S today.
 *
 *   UNANSWERED  it has stood for `PROPOSAL_UNANSWERED_EXPIRY_DAYS` without an
 *               answer. Not a judgement about the runner: an open question
 *               nobody closed blocks the dedupe that stops the same card being
 *               raised again, so leaving it open costs the next proposal.
 *
 * Idempotent. Safe to call from a cron, from a read path, and from both in the
 * same minute.
 */
export async function expireStaleWorkoutProposals(
  userUuid: string,
): Promise<ProposalExpiryResult> {
  // The runner's day, not the server's. `runnerToday` falls back to UTC when
  // the profile carries no timezone, which is the same answer CURRENT_DATE
  // gave and is therefore never worse than what this replaces.
  const today = await runnerToday(userUuid);

  const pastDated = await attempt(
    'plan/proposal-expiry · past-dated',
    pool.query(
      `UPDATE plan_workout_proposals
          SET status = 'expired', resolved_at = NOW()
        WHERE user_uuid = $1::uuid
          AND status = 'pending'
          AND workout_date_iso < $2`,
      [userUuid, today],
    ),
  );
  if (!pastDated.ok) return { ok: false, error: pastDated.error };

  const unanswered = await attempt(
    'plan/proposal-expiry · unanswered',
    pool.query(
      `UPDATE plan_workout_proposals
          SET status = 'expired', resolved_at = NOW()
        WHERE user_uuid = $1::uuid
          AND status = 'pending'
          AND created_at < NOW() - ($2 || ' days')::interval`,
      [userUuid, String(PROPOSAL_UNANSWERED_EXPIRY_DAYS)],
    ),
  );
  if (!unanswered.ok) return { ok: false, error: unanswered.error };

  return {
    ok: true,
    expiredPastDated: pastDated.value.rowCount ?? 0,
    expiredUnanswered: unanswered.value.rowCount ?? 0,
  };
}
