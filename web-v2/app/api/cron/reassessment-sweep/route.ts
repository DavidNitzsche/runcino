// POST /api/cron/reassessment-sweep
//
// REASSESSEVAL-1 (2026-09-06) · THE CALL SITE `POST_RACE_RECOVERY_CHECK` AND
// `RETURN_TO_TRAINING_STAGE` NEVER HAD.
//
// Both kinds have had a real `scheduleReassessment` call site since before
// this change (`app/api/cron/plan-drift/route.ts`'s POSTRACE-1,
// `app/api/v5/return/checkin/route.ts`'s RETURNSTAGE-1) and, until this
// route, no consumer that ever read a DUE item of either kind back and
// re-asked its question. `lib/ops/reassessment-evaluators.ts` is that
// consumer; this route is its only caller.
//
// ── WHY A NEW CRON, WHEN `reassessment-scheduler.ts`'S OWN HEADER ARGUES
//    AGAINST ONE ──────────────────────────────────────────────────────────
//
// `sweepReassessments` (promotion + overdue alerting, kind-agnostic) already
// lives inside `run-adaptations`, and that route's own header quotes
// `cron-ledger.ts`'s reasoning against a second schedule: "another schedule
// is another thing that can silently stop firing." That argument is sound
// and is exactly why THIS route does not duplicate promotion or alerting —
// both already run, for these two kinds, with zero changes needed here,
// because `sweepReassessments` walks every kind the CHECK constraint allows.
//
// What is missing is EVALUATION, not scheduling infrastructure, and the two
// places that could plausibly have hosted it were both closed off:
//
//   · `run-adaptations/route.ts` is a live, actively-owned file tonight
//     (a parallel workstream wired `EARNING_GATE`/`CONDITIONAL_DOSE`'s own
//     evaluator into it hours before this route was written — see
//     `evaluateDueRollingBoundariesForUser` in `lib/plan/adjudication/
//     rolling-boundary-evaluator.ts`) and is out of scope for this change.
//   · `plan-drift/route.ts`'s per-user loop is a 1,400+ line, heavily
//     concurrent file (six dated features landed in it in the 48 hours
//     before this one was written). Both evaluators this route calls
//     operate over the GLOBAL due set (`loadDueItems`, not `loadLiveQueue`
//     scoped to one runner) precisely because their questions — a race
//     lineage check, an injury lineage check — do not need a per-runner
//     context assembled elsewhere in that file (planned weeks, live
//     sequence). Reshaping them to fit inside that loop would trade a
//     small, self-contained, independently testable route for a deeper,
//     riskier edit to a file already under heavy concurrent change, for no
//     behavioural benefit — the two crons already run every day regardless
//     of which one calls this.
//
// A new job IS a new thing that can go silently stale, so it is registered
// in `lib/ops/cron-ledger.ts` exactly like every other job in `CRON_JOBS`:
// due-gated, staleness-alerted, and driven by the tick as well as its own
// GitHub schedule. Rule 23 clause 3 ("a job that does not run must be
// NOTICED") is not satisfied by hoping this route gets called; it is
// satisfied by that registration.
//
// ── IDEMPOTENT AND LATENESS-SAFE, BY CONSTRUCTION ───────────────────────────
//
// `runReassessmentEvaluationSweep` reads `loadDueItems` (status IN
// PENDING/DUE, `assess_on_iso <= today`) and every evaluator resolves
// through `resolveReassessment`, whose own UPDATE is guarded on
// `status IN ('PENDING','DUE')`. An item already resolved by a prior pass —
// or by the runner's own action, for `RETURN_TO_TRAINING_STAGE` — is
// invisible to the next pass's read, not re-processed. Running this twice
// in a row, or twelve hours late, does the same work once.
//
// Schedule: any time, daily — this only reads and resolves scheduler rows,
// it does not depend on ordering against `plan-drift` or `run-adaptations`
// having already run today (Rule 23; `loadDueItems` does not require
// `markDue` to have promoted anything first).

import { NextRequest, NextResponse } from 'next/server';
import { recordCronSuccess } from '@/lib/ops/cron-ledger';
import { runReassessmentEvaluationSweep } from '@/lib/ops/reassessment-evaluators';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured.' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  let report: Awaited<ReturnType<typeof runReassessmentEvaluationSweep>>;
  try {
    report = await runReassessmentEvaluationSweep(todayISO);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[cron/reassessment-sweep] threw ·', e);
    return NextResponse.json({ ok: false, error: 'threw', detail: message }, { status: 500 });
  }

  // Rule 11 · a refusal (the table absent, or the read itself failing) is a
  // different fact from "nothing was due today", and both are different from
  // "some items failed mid-pass". All three are visible in the body rather
  // than collapsed into one boolean.
  await recordCronSuccess('reassessment-sweep', {
    today_iso: todayISO,
    examined: report.examined,
    resolved: report.resolved,
    abandoned: report.abandoned,
    still_waiting: report.stillWaiting,
    failed: report.failed,
    owned_elsewhere: report.ownedElsewhere,
    refusal: report.refusal,
  });

  return NextResponse.json({ ok: report.refusal === null, today_iso: todayISO, ...report });
}
