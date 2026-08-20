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
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import {
  loadActiveInjuryForReturn, protocolForInjury, loadReturnCheckins, recordReturnCheckin,
} from '@/lib/plan/return-checkin-store';
import { computeReturnLadderState, applyCheckin, advancementGateLine, type ReturnCheckinOutcome } from '@/lib/plan/return-ladder';
import { MAX_WALK_RUN_STAGE } from '@/lib/plan/injury-protocols';

export const dynamic = 'force-dynamic';

const OUTCOMES = ['silent', 'something_off'] as const;

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const outcome = typeof body?.outcome === 'string' ? (body.outcome as ReturnCheckinOutcome) : null;
  if (!outcome || !OUTCOMES.includes(outcome)) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', reason: `outcome must be one of ${OUTCOMES.join(', ')}` },
      { status: 400 },
    );
  }

  const injury = await loadActiveInjuryForReturn(userId);
  if (!injury) {
    return NextResponse.json({ ok: false, error: 'no_active_injury', reason: 'no injury currently tracked' }, { status: 404 });
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

  return NextResponse.json({
    ok: true,
    outcome,
    stage: after.stage,
    stageCount: MAX_WALK_RUN_STAGE,
    advanced: after.stage > before.stage,
    coachLine: advancementGateLine(after),
  });
}
