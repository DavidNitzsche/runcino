/**
 * lib/plan/_duration_offer_anchor.test.ts · DURATIONOFFER-3 (2026-09-12),
 * FOUND BY THE SECOND INDEPENDENT REVIEW OF `lane-c/adaptation-vertical-slice`.
 *
 * ── THE BUG ──────────────────────────────────────────────────────────────
 *
 * `runActionProposalLane`'s DURATION_PROGRESS_OFFER section called
 * `raise(userUuid, todayISO, anchor, accelerated.action, accelerated.why)`,
 * where `anchor` is `nextSessionFor(userUuid, todayISO)` — the chronologically
 * NEXT non-rest session in the runner's whole plan, computed once at the top
 * of the function for the WHOLE-RUNNER decisions (SAFETY_STOP, HOLD) that
 * legitimately want it (see `firstHold`'s own comment: "the card is anchored
 * to `nextSessionFor`'s row, not to this one").
 *
 * `firstDurationAccelerate`, unlike those two, already KNOWS the specific
 * session the progression gate accelerated — `a.workoutIds[0]`, the same id
 * `actionFromAdaptation` was translated against. But the caller discarded
 * that identity and re-anchored to whatever `nextSessionFor` happened to
 * return. When the accelerated session is NOT the next chronological one —
 * a Thursday interval session accelerated while a Monday easy run sits in
 * between, the ordinary case for any runner training more than once a
 * week — the runner sees a DURATION_PROGRESS_OFFER card dated, typed and
 * distanced as Monday's easy run while the sentence and the pace math
 * describe Thursday's intervals. A wrong day, a wrong session type, and a
 * wrong distance, all on one card.
 *
 * This is exactly the LONG_RUN_STRUCTURE section's own reasoning, one
 * paragraph below in the same file: "a card about the long run that hangs on
 * Tuesday's tempo would be the wrong fact attached to the right sentence
 * (Rule 16)." That section already re-reads its own row rather than reusing
 * `anchor`; DURATION_PROGRESS_OFFER did not, and this proves the fix that
 * makes it match.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * The wiring only — same posture as
 * `_competing_proposal_arbitration.test.ts` beside it: the pool is mocked so
 * the query ROUTING can be observed with no live database, and
 * `writeActionProposal` is mocked so the anchor it was actually CALLED WITH
 * can be inspected directly, rather than inferred from a written row. This
 * cannot fail on whether the progression gate's ACCELERATE verdict was the
 * right coaching call — `_duration_accelerate_discriminator.test.ts` beside
 * it owns that question — only on which session the resulting card names.
 *
 * ── FALSIFIED PER RULE 18 ────────────────────────────────────────────────
 *
 * Run against the pre-fix `runActionProposalLane` (the `anchor` variable
 * passed to `raise(...)` at the DURATION_PROGRESS_OFFER call site instead of
 * a re-read of `accelerated.workoutId`), this test's first assertion fails:
 * `anchorWorkoutId` comes back as the seeded Monday easy run's id
 * (`pw_mon_easy`) instead of the accelerated Thursday interval session's
 * (`pw_thu_intervals`). Confirmed by hand during this fix; see the round-3
 * implementer handback for the captured failure output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

const writeActionProposal = vi.fn();
vi.mock('@/lib/brain/proposal/write', () => ({
  writeActionProposal: (...a: unknown[]) => writeActionProposal(...a),
  // Not exercised by this test (no HOLD/SAFETY_STOP action is constructed),
  // but the real module exports it and other code in the same import graph
  // may reference the type-only export; vitest's module mock only needs the
  // runtime members `action-proposal-lane.ts` actually calls.
}));

const resolveSafety = vi.fn();
vi.mock('@/lib/safety/load-safety', () => ({
  resolveSafety: (...a: unknown[]) => resolveSafety(...a),
}));

const loadLongRunStructureEvidence = vi.fn();
vi.mock('@/lib/brain/proposal/evidence/long-run-structure', () => ({
  loadLongRunStructureEvidence: (...a: unknown[]) => loadLongRunStructureEvidence(...a),
}));

import { runActionProposalLane } from './action-proposal-lane';
import type { AdaptationAction } from './adapt';
import type { ProgressionResolution } from './progression-pass';
import type { WorkShape } from '@/lib/prescription/levers';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-09-12';

/** The chronologically-next session — an easy run, three days BEFORE the
 * session actually being accelerated. This is the row a pre-fix
 * `runActionProposalLane` would have anchored the offer to. */
const NEXT_CHRONOLOGICAL = {
  id: 'pw_mon_easy', date_iso: '2026-09-15', type: 'easy', distance_mi: 6,
};

/** The session the progression gate actually accelerated. Later in the week,
 * a different type, a different distance. */
const ACCELERATED_WORKOUT_ID = 'pw_thu_intervals';
const ACCELERATED_LIVE_ROW = {
  id: ACCELERATED_WORKOUT_ID, date_iso: '2026-09-18', type: 'intervals', distance_mi: 8,
  pace_target_s_per_mi: 400, duration_min: 34, is_quality: true, sub_label: null,
  notes: '', workout_spec: {}, plan_id: 'pln_test', last_adapted_at: null,
};

const BASE_SHAPE: WorkShape = {
  reps: 4, repMinutes: 7, recoveryMinutes: 2, paceSPerMi: 400, zone: 'ESTABLISHED',
};

function acceleratedAction(): AdaptationAction {
  const resolution: ProgressionResolution = {
    workoutId: ACCELERATED_WORKOUT_ID,
    dateISO: ACCELERATED_LIVE_ROW.date_iso,
    family: 'interval',
    action: 'ACCELERATE',
    shape: { ...BASE_SHAPE, repMinutes: 7 },
    authored: { ...BASE_SHAPE, repMinutes: 6 },
    authoredLever: 'interval_duration',
    lever: 'interval_duration',
    why: 'You are absorbing this block well, so this week asks for a little more '
      + 'than the plan had drawn up.',
    changed: true,
  };
  return {
    kind: 'reshape',
    workoutIds: [ACCELERATED_WORKOUT_ID],
    why: resolution.why,
    reshape: {
      resolution,
      row: { type: 'intervals', distanceMi: 8, subLabel: null },
      band: 'strong',
      lthr: 168,
      weekStartISO: '2026-09-15',
    },
  } as AdaptationAction;
}

beforeEach(() => {
  query.mockReset();
  writeActionProposal.mockReset();
  resolveSafety.mockReset();
  loadLongRunStructureEvidence.mockReset();

  // SAFETY: no stop. `safetyStopFrom` returns null for `known: false`.
  resolveSafety.mockResolvedValue({ known: false });
  // LONG RUN: no candidate this pass, so that section withholds harmlessly.
  loadLongRunStructureEvidence.mockResolvedValue(null);
  // Every write is accepted, so `raised` increments and the call args can be
  // inspected — this test is about WHICH anchor was sent, not whether the
  // insert itself succeeds.
  writeActionProposal.mockResolvedValue({ ok: true, written: true, proposalId: 1 });

  query.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes('ANY($1::text[])')) {
      // readLiveRows — the accelerated session's own current row.
      return { rows: [ACCELERATED_LIVE_ROW] };
    }
    if (s.includes('ORDER BY pw.date_iso ASC')) {
      // nextSessionFor — the chronologically-next session in the WHOLE plan,
      // which this scenario deliberately makes a DIFFERENT session than the
      // one being accelerated.
      return { rows: [NEXT_CHRONOLOGICAL] };
    }
    throw new Error(`unexpected query in test: ${s.slice(0, 120)}`);
  });
});

describe('runActionProposalLane · DURATION_PROGRESS_OFFER anchors to the ACCELERATED session', () => {
  it('anchors the card to the session the progression gate accelerated, not to nextSessionFor', async () => {
    const report = await runActionProposalLane(USER, TODAY, [acceleratedAction()]);

    expect(report.raised).toBe(1);
    expect(writeActionProposal).toHaveBeenCalledTimes(1);
    const req = writeActionProposal.mock.calls[0][0] as {
      anchorWorkoutId: string; anchorDateISO: string;
      evidence?: { planned_type?: string; planned_distance_mi?: number | null };
    };

    // THE ASSERTION THAT FAILS PRE-FIX: the pre-fix code passes `anchor`
    // (nextSessionFor's Monday easy run) to every `raise()` call in this
    // function, DURATION_PROGRESS_OFFER included.
    expect(req.anchorWorkoutId).toBe(ACCELERATED_WORKOUT_ID);
    expect(req.anchorDateISO).toBe(ACCELERATED_LIVE_ROW.date_iso);
    expect(req.anchorWorkoutId).not.toBe(NEXT_CHRONOLOGICAL.id);
    expect(req.anchorDateISO).not.toBe(NEXT_CHRONOLOGICAL.date_iso);

    // The evidence blob a runner-facing card renders from should describe the
    // ACTUAL session — intervals/8mi — never the easy run in between.
    expect(req.evidence?.planned_type).toBe('intervals');
    expect(req.evidence?.planned_distance_mi).toBe(8);
  });
});
