/**
 * GET /api/v5/return · design 19a "Return to running".
 *
 * Serves the eight-stage walk-run ladder (`WALK_RUN_LADDER` in
 * `lib/plan/injury-protocols.ts` — doctrine-bound, never hardcoded here)
 * check-in-gated by `lib/plan/return-ladder.ts`: all eight stages with
 * `status` done/today/upcoming, the current stage's prescription, and the
 * advancement gate in one sentence.
 *
 * Bone stress injuries are clinician-gated; a niggle is not
 * (`resolveInjuryProtocol().clearanceRequired`). When the protocol will not
 * license running on a self-report at all, this responds with `refusal` set
 * and the stage held at 1 — a refusal, not a disabled control and not an
 * error (rule 3).
 *
 * 404 (`no_active_injury`) when there is nothing to serve at all — a real
 * empty state, not a refusal.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import {
  loadActiveInjuryForReturn, protocolForInjury, loadReturnCheckins,
} from '@/lib/plan/return-checkin-store';
import {
  computeReturnLadderState, currentStageRow, advancementGateLine,
} from '@/lib/plan/return-ladder';
import { MAX_WALK_RUN_STAGE, stageSessionLabel, stageSessionNotes } from '@/lib/plan/injury-protocols';

export const dynamic = 'force-dynamic';

function dateLine(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const injury = await loadActiveInjuryForReturn(userId);
  if (!injury) {
    // Runner-facing: the phone renders this as the whole screen.
    return NextResponse.json({ error: 'no_active_injury', reason: 'Nothing is flagged right now, so there is no ladder to climb.' }, { status: 404 });
  }

  const resolved = protocolForInjury(injury);
  const today = await runnerToday(userId);

  const panelBase = {
    dayState: 'easy',
    quiet: false,
    place: 'Return to running',
    dateLine: dateLine(today),
    kicker: injury.site,
  };

  // ── clinician-gated · a refusal, not a disabled control ────────────────
  if (resolved.clearanceRequired) {
    return NextResponse.json({
      panel: {
        ...panelBase,
        weekLine: null,
        type: 'HOLDING PATTERN',
        dose: null,
        stats: [],
      },
      stage: 1,
      stageCount: MAX_WALK_RUN_STAGE,
      prescription: 'No running yet.',
      coachLine: resolved.protocol.clearanceGate ?? 'This one is clinician-gated, not a self-report.',
      stages: buildStages(1),
      checkIn: [],
      refusal: resolved.protocol.clearanceGate ?? 'This return is clinician-gated. A self-report cannot advance it.',
    });
  }

  const events = await loadReturnCheckins(userId, injury.id);
  const state = computeReturnLadderState(events, resolved.protocol.startStage);
  const row = currentStageRow(state);

  return NextResponse.json({
    panel: {
      ...panelBase,
      weekLine: `Stage ${state.stage} of ${MAX_WALK_RUN_STAGE}`,
      type: stageSessionLabel(row),
      dose: { text: `${row.totalRunMin} min running`, modelled: false },
      stats: [
        { label: 'Stage', value: { text: String(state.stage), modelled: false }, tone: null },
        { label: 'Sessions here', value: { text: String(state.sessionsAtStage), modelled: false }, tone: null },
        { label: 'Sessions / wk', value: { text: String(row.sessionsPerWk), modelled: false }, tone: null },
      ],
    },
    stage: state.stage,
    stageCount: MAX_WALK_RUN_STAGE,
    prescription: stageSessionLabel(row),
    coachLine: advancementGateLine(state),
    stages: buildStages(state.stage),
    checkIn: [
      { id: 'silent', label: `${cap(injury.site)} stayed silent`, sub: 'During and the next morning', value: null, action: 'silent' },
      { id: 'something_off', label: 'Something felt off', sub: null, value: null, action: 'something_off' },
    ],
    refusal: null,
    // Extra, additive — the full prescription notes for the current stage,
    // for a client that wants more than the one-line label.
    prescriptionNotes: stageSessionNotes(row, resolved.protocol.riskClass),
  });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildStages(currentStage: number): Array<{ id: string; number: number; label: string; status: 'done' | 'today' | 'upcoming' }> {
  const out: Array<{ id: string; number: number; label: string; status: 'done' | 'today' | 'upcoming' }> = [];
  for (let n = 1; n <= MAX_WALK_RUN_STAGE; n++) {
    const status: 'done' | 'today' | 'upcoming' = n < currentStage ? 'done' : n === currentStage ? 'today' : 'upcoming';
    out.push({ id: `stage_${n}`, number: n, label: `Stage ${n}`, status });
  }
  return out;
}
