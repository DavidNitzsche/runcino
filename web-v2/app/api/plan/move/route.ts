/**
 * /api/plan/move · MOVE A RUN, RE-ADJUDICATED.  (MOVEREADJUDICATE-1)
 *
 * Three verbs, and only two of them write.
 *
 *   GET  ?workout_id=…&to=YYYY-MM-DD        → PROPOSE. Reads only.
 *        (or ?from=YYYY-MM-DD&to=…)           Returns the ranked options the
 *                                             mover produced, PLUS the nine
 *                                             re-adjudication checks against
 *                                             the date he actually wants, PLUS
 *                                             a better date when one costs less.
 *
 *   POST { workout_id | from, to, option_id, token, override_refusals? }
 *        → APPLY, under RUNNER_ACCEPTED and nothing else.
 *
 *   POST { action: 'undo', decision_id }    → UNDO, ledgered as its own decision.
 *
 * ── WHY A ROUTE OF ITS OWN, AND NOT MORE CODE IN /api/plan/reschedule ──────
 *
 * `/api/plan/reschedule` is an ENTRY POINT of `_reschedule_not_adaptation.test.ts`,
 * the gate that stops the rescheduling surface reaching the adaptation engine.
 * Re-adjudication has to reach it — that is the whole point — so putting the
 * orchestrator behind that route would mean removing an entry from that gate's
 * scope. Loosening a gate to get past it is the failure Rule 18 catalogues, and
 * it would trade a coaching hole for a safety hole.
 *
 * So the arrangement is the one the gate itself calls legitimate: this route
 * sits ABOVE both, `/api/plan/reschedule` stays exactly as it is and stays
 * unable to adapt training, and nothing about the separation is weakened.
 *
 * THIS IS NOT A FIFTH OPINION ABOUT WHERE A SESSION SHOULD GO. Every candidate,
 * every rank and every cost here comes from `recommendReschedule`, which remains
 * the decision owner. What this route adds is the re-adjudication that owner
 * structurally cannot perform, the authority classification, the ledger row and
 * the sync. The consolidation of the three OLDER movers is a separate question
 * and `lib/brain/orchestration/_move_readjudication.test.ts` counts it.
 *
 * NOTHING WRITES UNTIL HE APPROVES. The GET opens no transaction; both
 * `recommendReschedule` and `readjudicateMove` are pure reads.
 *
 * A REFUSED re-adjudication does not silently block him. It comes back as 409
 * with every refusing finding named, and he can send it again with
 * `override_refusals: true` once he has read them. It is his plan; the coach
 * states the cost rather than confiscating the decision.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { isISODate, recommendReschedule, resolveConstraint } from '@/lib/plan/reschedule';
import {
  readjudicateMove,
  applyMove,
  undoMove,
  verdictOf,
  allFindings,
} from '@/lib/brain/orchestration/move-orchestrator';
import { checksThatCouldNotRun } from '@/lib/coaching-contract/move-readjudication';

const STATUS: Record<string, number> = {
  no_plan: 404,
  not_found: 404,
  bad_request: 400,
  immovable: 422,
  sealed: 422,
  plan_moved: 409,
  rejected: 409,
  readjudication_refused: 409,
  authority_refused: 403,
  no_record_table: 503,
  already_undone: 409,
  read_failed: 503,
};

/** Dates arrive as a comma-separated list. Anything that is not an ISO day is
 *  dropped rather than silently reinterpreted — same convention as
 *  `/api/plan/reschedule`'s own `parseDates`, kept local rather than shared
 *  because it is four lines and a shared import would be the only coupling
 *  between these two routes. */
function parseDates(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(isISODate);
}

/** Rule 11 · the report is serialised WITH the checks that could not run. A
 *  surface that printed only the findings would show an incomplete
 *  re-adjudication as a clean one, which is the exact collapse the contract's
 *  `INCOMPLETE` verdict exists to prevent. */
function wire(report: Awaited<ReturnType<typeof readjudicateMove>>) {
  return {
    verdict: verdictOf(report),
    weeks: report.weeks,
    checks: report.checks,
    findings: allFindings(report),
    could_not_run: checksThatCouldNotRun(report),
    better_date: report.betterDate,
    plan_version: report.planVersion,
    as_of: report.asOfISO,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userUuid = auth;

  const q = req.nextUrl.searchParams;
  const toISO = q.get('to');
  const fromISO = q.get('from');
  const workoutId = q.get('workout_id') ?? undefined;
  if (!isISODate(toISO)) {
    return NextResponse.json({ error: 'to (YYYY-MM-DD) required' }, { status: 400 });
  }
  if (!workoutId && !isISODate(fromISO)) {
    return NextResponse.json({ error: 'workout_id or from (YYYY-MM-DD) required' }, { status: 400 });
  }

  const todayISO = await runnerToday(userUuid);

  // The mover's own ranked set, unchanged. The constraint is the real one:
  // he cannot run it on its own day. Availability elsewhere stays UNKNOWN
  // unless he says otherwise, which is RS-2 and is not this route's to assume.
  //
  // RS-2 FIX (2026-09-05) · this used to hardcode `[]` for `unavailable`,
  // meaning a runner who marked days he cannot run had that answer silently
  // dropped the moment RescheduleV5.swift was repointed at this route — the
  // exact "never assume availability" rule RS-2 exists to hold read back as
  // UNKNOWN regardless of what he said. `/api/plan/reschedule`'s own
  // `parseDates` is the model.
  const rec = await recommendReschedule({
    userUuid,
    todayISO,
    planWorkoutId: workoutId,
    dateISO: isISODate(fromISO) ? fromISO : undefined,
    constraint: resolveConstraint(
      parseDates(q.get('unavailable')), parseDates(q.get('available')), q.get('note') ?? undefined,
    ),
    allowAdjacentWeek: q.get('adjacent_week') !== '0',
  });
  if (!rec.ok) {
    return NextResponse.json(
      { error: rec.code, reason: rec.reason },
      { status: STATUS[rec.code] ?? 400 },
    );
  }

  // MOVEREADJUDICATE-2 · the SAME availability just asked above, not a second,
  // invented one. `readjudicateMove` used to hardcode its own constraint and
  // could refuse a date `rec.recommendation.options` had just ranked first,
  // for a reason that was never true — verified live against this exact route.
  const report = await readjudicateMove({
    userUuid,
    todayISO,
    move: {
      planWorkoutId: workoutId ?? rec.recommendation.target.planWorkoutId,
      fromISO: rec.recommendation.target.dateISO,
      toISO,
      optionId: rec.recommendation.options.find((o) => o.newDateISO === toISO)?.id ?? null,
    },
    unavailableDates: parseDates(q.get('unavailable')),
    availableDates: parseDates(q.get('available')),
  });

  return NextResponse.json({
    recommendation: rec.recommendation,
    readjudication: wire(report),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userUuid = auth;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const todayISO = await runnerToday(userUuid);

  if (body.action === 'undo') {
    const decisionId = typeof body.decision_id === 'string' ? body.decision_id : '';
    if (!decisionId) return NextResponse.json({ error: 'decision_id_required' }, { status: 400 });
    const out = await undoMove({ userUuid, todayISO, decisionId });
    if (!out.ok) {
      return NextResponse.json(
        { error: out.code, reason: out.reason, violations: out.violations },
        { status: STATUS[out.code] ?? 400 },
      );
    }
    return NextResponse.json({
      ok: true, decision_id: out.decisionId, restored: out.restored,
      plan_version: out.planVersion, ledger: out.ledger,
    });
  }

  const toISO = body.to;
  const fromISO = body.from;
  const workoutId = typeof body.workout_id === 'string' ? body.workout_id : undefined;
  const optionId = typeof body.option_id === 'string' ? body.option_id : '';
  const token = typeof body.token === 'string' ? body.token : '';
  if (!isISODate(toISO) || !optionId || !token) {
    return NextResponse.json({ error: 'to, option_id and token are required' }, { status: 400 });
  }
  if (!workoutId && !isISODate(fromISO)) {
    return NextResponse.json({ error: 'workout_id or from required' }, { status: 400 });
  }

  const out = await applyMove({
    userUuid,
    todayISO,
    move: {
      planWorkoutId: workoutId ?? '',
      fromISO: isISODate(fromISO) ? fromISO : '',
      toISO,
      optionId,
    },
    optionId,
    token,
    // RS-2 FIX (2026-09-05) · see the matching comment on GET above. Same
    // hardcoded-`[]` gap, same fix.
    constraint: resolveConstraint(
      Array.isArray(body.unavailable) ? (body.unavailable as string[]).filter(isISODate) : [],
      Array.isArray(body.available) ? (body.available as string[]).filter(isISODate) : [],
    ),
    allowAdjacentWeek: body.adjacent_week !== false,
    // AUTHORITY · he read the options and tapped one. `applyMove` refuses any
    // class but a runner class, and AUTOMATIC_ADAPTATION_AUTHORITY is untouched.
    authority: 'RUNNER_ACCEPTED',
    overrideRefusals: body.override_refusals === true,
  });

  if (!out.ok) {
    return NextResponse.json(
      {
        error: out.code,
        reason: out.reason,
        violations: out.violations,
        readjudication: out.report ? wire(out.report) : undefined,
      },
      { status: STATUS[out.code] ?? 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    decision_id: out.decisionId,
    summary: out.summary,
    plan_version: out.planVersion,
    ledger: out.ledger,
    readjudication: wire(out.report),
  });
}

export const dynamic = 'force-dynamic';
