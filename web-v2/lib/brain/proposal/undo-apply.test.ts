/**
 * lib/brain/proposal/undo-apply.test.ts · UNDOTRACK-1
 *
 * `markUndoneInTransaction` (lib/brain/ledger/decision-ledger.ts) stamps
 * `undone_at` on a ledger row and has been fully built and unit-tested (see
 * `_decision_ledger.db.test.ts`) since migration 166 landed — but nothing in
 * production ever called it. `mutate.ts`'s `landDecisionInTransaction` only
 * invokes it when `opts.ledger.undoes` is populated, and grepping the whole
 * codebase for `undoes:` turns up exactly one hit outside `mutate.ts` itself:
 * the type declaration. `applyUndo` (this file's subject, and the ONLY
 * production per-workout undo path — confirmed by tracing `POST
 * /api/plan/workout-proposals/[id]/undo` → `applyUndo` → `mutatePlan`) built
 * its `ledger` option WITHOUT `undoes`, so the reversal always landed but the
 * original ACCEPTED row never got marked reversed. That is what let
 * `directionCensus()` (Rule 21's push-count metric) keep counting a decision
 * the runner had already taken back.
 *
 * This suite proves the WIRING, not the SQL `markUndoneInTransaction` issues
 * (that is `_decision_ledger.db.test.ts`'s job) — that `applyUndo` looks up
 * the live accepted ledger row and hands it to `mutatePlan` as `ledger.undoes`
 * so `mutate.ts` actually calls `markUndoneInTransaction` on the right row.
 *
 * FAIL-BEFORE/PASS-AFTER: before this fix, `ledger.undoes` was never present
 * on the options `applyUndo` built, regardless of whether an accepted ledger
 * row existed. The assertion below on `mutatePlan`'s captured call args is
 * exactly the one that would have failed against the pre-fix code — `undoes`
 * would have been `undefined` there in every case, including this one.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 * · Whether `markUndoneInTransaction`'s SQL is correct — `mutatePlan` is
 *   mocked here entirely.
 * · Whether the plan reversal itself is correct — `writeBack`'s SQL is not
 *   exercised (the `apply` callback is never invoked against a real tx).
 * · The `stale` / `not_undoable` / `nothing_to_undo` branches, which do not
 *   reach the ledger lookup at all and are `undo.ts`'s own territory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/plan/mutate', () => ({ mutatePlan: vi.fn() }));
vi.mock('@/lib/brain/ledger/decision-ledger', () => ({
  findLiveAcceptedLedgerRow: vi.fn(),
}));
vi.mock('./undo', () => ({ undoWritesFor: vi.fn() }));
vi.mock('./staleness', () => ({ readLiveRows: vi.fn() }));
vi.mock('./ledger-facet', () => ({ ledgerFacetsOf: vi.fn(() => ({})) }));

import { mutatePlan } from '@/lib/plan/mutate';
import { findLiveAcceptedLedgerRow } from '@/lib/brain/ledger/decision-ledger';
import { undoWritesFor } from './undo';
import { readLiveRows } from './staleness';
import { applyUndo, type UndoContext } from './undo-apply';
import type { BrainAction, LiveRow } from './action';

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const WORKOUT_ID = 'w1';

const ACTION: BrainAction = {
  schemaVersion: 1 as any,
  direction: 'push' as any,
  kind: 'PACE_CHANGE',
  to: { value: 400, unit: 'sec_per_mi' } as any,
  lever: 'THRESHOLD',
  before: [{ planWorkoutId: WORKOUT_ID }],
};

const CTX: UndoContext = {
  userUuid: USER,
  todayISO: '2026-09-09',
  proposalId: 42,
  reason: 'the runner reversed this decision',
};

const LIVE_ROW: LiveRow = {
  planWorkoutId: WORKOUT_ID,
  dateISO: '2026-09-10',
  type: 'quality',
  distanceMi: 6,
  paceTargetSecPerMi: 400,
  planVersion: 'v1',
};

function successfulBoundary() {
  return {
    ok: true, outcome: 'applied', value: 1, violations: [], preExisting: [], resolved: [], planId: 'plan-1',
  } as any;
}

describe('applyUndo · wires markUndoneInTransaction via ledger.undoes (UNDOTRACK-1)', () => {
  beforeEach(() => {
    vi.mocked(mutatePlan).mockReset();
    vi.mocked(findLiveAcceptedLedgerRow).mockReset();
    vi.mocked(undoWritesFor).mockReset();
    vi.mocked(readLiveRows).mockReset();

    vi.mocked(undoWritesFor).mockReturnValue({
      kind: 'reverse',
      writes: [{ op: 'update', planWorkoutId: WORKOUT_ID, set: { pace_target_s_per_mi: 390 } }],
    } as any);
    vi.mocked(readLiveRows).mockResolvedValue(new Map([[WORKOUT_ID, LIVE_ROW]]));
    vi.mocked(mutatePlan).mockResolvedValue(successfulBoundary());
  });

  it('FAIL-BEFORE/PASS-AFTER · a live accepted ledger row is passed to mutatePlan as ledger.undoes', async () => {
    vi.mocked(findLiveAcceptedLedgerRow).mockResolvedValue({ id: 'ledger-row-1' });

    const outcome = await applyUndo(ACTION, CTX);

    expect(outcome.ok).toBe(true);
    expect(findLiveAcceptedLedgerRow).toHaveBeenCalledWith(USER, String(CTX.proposalId));
    expect(mutatePlan).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mutatePlan).mock.calls[0][0] as any;
    // This is the exact field `mutate.ts`'s `landDecisionInTransaction` reads
    // to decide whether to call `markUndoneInTransaction`. Pre-fix, this key
    // was never present on `ledger` at all.
    expect(call.ledger.undoes).toEqual({ id: 'ledger-row-1', reason: CTX.reason });
  });

  it('no live accepted ledger row (pre-migration-166 accept, or none found) → undoes omitted, reversal still proceeds', async () => {
    vi.mocked(findLiveAcceptedLedgerRow).mockResolvedValue(undefined);

    const outcome = await applyUndo(ACTION, CTX);

    expect(outcome.ok).toBe(true);
    const call = vi.mocked(mutatePlan).mock.calls[0][0] as any;
    expect(call.ledger.undoes).toBeUndefined();
    // The reversal is not held hostage to the ledger lookup — Rule 11: absent
    // is not the same fact as failed, and neither should block a runner-
    // requested reversal on a row this file cannot conjure.
  });

  it('a failed ledger lookup (null) also omits undoes rather than blocking the reversal', async () => {
    vi.mocked(findLiveAcceptedLedgerRow).mockResolvedValue(null);

    const outcome = await applyUndo(ACTION, CTX);

    expect(outcome.ok).toBe(true);
    const call = vi.mocked(mutatePlan).mock.calls[0][0] as any;
    expect(call.ledger.undoes).toBeUndefined();
  });

  it('the reason handed to undoes is the SAME reason recorded on the reversal (Rule 16)', async () => {
    vi.mocked(findLiveAcceptedLedgerRow).mockResolvedValue({ id: 'ledger-row-9' });

    await applyUndo(ACTION, CTX);

    const call = vi.mocked(mutatePlan).mock.calls[0][0] as any;
    expect(call.ledger.undoes.reason).toBe(call.ledger.explanation);
  });
});
