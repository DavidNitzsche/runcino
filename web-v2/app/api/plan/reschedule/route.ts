/**
 * /api/plan/reschedule · "I cannot run this day."  (RS-2, RS-3, RS-5, RS-6)
 *
 * Three verbs, and only one of them writes.
 *
 *   GET  ?date=YYYY-MM-DD | ?workout_id=…            → RECOMMEND. Reads only.
 *        &unavailable=a,b,c   he named days he CANNOT run
 *        &available=a,b,c     he named the days he CAN run
 *        (neither)            availability UNKNOWN. The phone must ask.
 *        &adjacent_week=1     Q31 · widen past the in-week search boundary
 *
 *   POST { date | workout_id, option_id, token, unavailable? | available? }
 *        → APPLY. The only write. Requires the token the runner actually read.
 *
 *   POST { action: 'undo', decision_id }             → UNDO.  (RS-6)
 *
 * NOTHING WRITES UNTIL HE APPROVES. The GET opens no transaction and issues
 * only SELECTs; `lib/plan/reschedule.ts`'s `recommendReschedule` is a pure
 * read by construction, and `_reschedule_contract.test.ts` proves it by
 * running the whole recommendation against a query recorder and asserting no
 * statement outside SELECT was ever issued.
 *
 * AVAILABILITY IS NEVER GUESSED (RS-2). When neither `unavailable` nor
 * `available` is supplied the response carries `availability_unknown: true`
 * and a refusal saying so, and the phone asks him to mark days rather than the
 * server assuming a weekend is free.
 *
 * This route does NOT bust the briefing cache and does NOT fire an auto
 * rebuild. A reschedule changes placement, not training, and calling
 * `fireAutoRebuild` here would hand the block to the generator, which is the
 * one thing the contract's "do not rewrite the entire block when a local move
 * suffices" forbids.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import {
  recommendReschedule,
  applyReschedule,
  undoReschedule,
  isISODate,
  resolveConstraint,
} from '@/lib/plan/reschedule';

const STATUS: Record<string, number> = {
  no_plan: 404,
  not_found: 404,
  bad_request: 400,
  immovable: 422,
  sealed: 422,
  plan_moved: 409,
  rejected: 409,
  no_record_table: 503,
  already_undone: 409,
  read_failed: 503,
};

/** Dates arrive as a comma-separated list. Anything that is not an ISO day is
 *  dropped rather than silently reinterpreted. */
function parseDates(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(isISODate);
}

// The "never assume availability" rule is a coaching rule, so it lives in the
// module and is tested there. This route only parses.

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userUuid = auth;

  const q = req.nextUrl.searchParams;
  const dateISO = q.get('date') ?? undefined;
  const planWorkoutId = q.get('workout_id') ?? undefined;
  if (!planWorkoutId && !isISODate(dateISO)) {
    return NextResponse.json({ error: 'date_or_workout_id_required' }, { status: 400 });
  }

  const todayISO = await runnerToday(userUuid);
  const out = await recommendReschedule({
    userUuid,
    todayISO,
    dateISO: isISODate(dateISO) ? dateISO : undefined,
    planWorkoutId,
    constraint: resolveConstraint(
      parseDates(q.get('unavailable')),
      parseDates(q.get('available')),
      q.get('note') ?? undefined,
    ),
    allowAdjacentWeek: q.get('adjacent_week') === '1',
  });

  if (!out.ok) {
    return NextResponse.json(
      { error: out.code, reason: out.reason },
      { status: STATUS[out.code] ?? 400 },
    );
  }
  return NextResponse.json(out.recommendation);
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userUuid = auth;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const todayISO = await runnerToday(userUuid);

  // ── RS-6 · undo ────────────────────────────────────────────────────────────
  if (body.action === 'undo') {
    const decisionId = typeof body.decision_id === 'string' ? body.decision_id : '';
    if (!decisionId) return NextResponse.json({ error: 'decision_id_required' }, { status: 400 });
    const out = await undoReschedule({ userUuid, todayISO, decisionId });
    if (!out.ok) {
      return NextResponse.json(
        { error: out.code, reason: out.reason, violations: out.violations },
        { status: STATUS[out.code] ?? 400 },
      );
    }
    return NextResponse.json(out);
  }

  // ── RS-5 · apply ───────────────────────────────────────────────────────────
  const dateISO = typeof body.date === 'string' ? body.date : undefined;
  const planWorkoutId = typeof body.workout_id === 'string' ? body.workout_id : undefined;
  const optionId = typeof body.option_id === 'string' ? body.option_id : '';
  const token = typeof body.token === 'string' ? body.token : '';

  if (!planWorkoutId && !isISODate(dateISO)) {
    return NextResponse.json({ error: 'date_or_workout_id_required' }, { status: 400 });
  }
  if (!optionId || !token) {
    // The token is not optional. Applying without one would mean applying a
    // change to a plan the runner may never have read.
    return NextResponse.json({ error: 'option_id_and_token_required' }, { status: 400 });
  }

  const out = await applyReschedule({
    userUuid,
    todayISO,
    dateISO: isISODate(dateISO) ? dateISO : undefined,
    planWorkoutId,
    constraint: resolveConstraint(
      Array.isArray(body.unavailable) ? (body.unavailable as unknown[]).filter(isISODate) : [],
      Array.isArray(body.available) ? (body.available as unknown[]).filter(isISODate) : [],
      typeof body.note === 'string' ? body.note : undefined,
    ),
    optionId,
    token,
    allowAdjacentWeek: body.adjacent_week === true,
  });

  if (!out.ok) {
    return NextResponse.json(
      { error: out.code, reason: out.reason, violations: out.violations },
      { status: STATUS[out.code] ?? 400 },
    );
  }
  return NextResponse.json(out);
}

export const dynamic = 'force-dynamic';
