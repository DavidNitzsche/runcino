/**
 * lib/faff/_v5_decisions.test.ts · V5PROPOSALSURFACE-1 · the outcome vocabulary
 * is TOTAL, and no status silently becomes "still open".
 *
 * ── WHY THIS GATE ──────────────────────────────────────────────────────────
 *
 * Two status vocabularies feed one runner-facing word. `PlanProposalStatus`
 * has eight members and `plan_workout_proposals` has four, and the mapping is
 * the kind of switch that grows a hole the day somebody adds a ninth. A hole
 * here is not cosmetic: an unmapped status defaulting to `pending` would show
 * a settled decision as one the runner still owes an answer to.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * It cannot fail on the history being RENDERED, or on the merge order, or on
 * either table's rows being read correctly — it never touches a database. It
 * tests the two pure status maps and the vocabulary's reachability.
 *
 * It cannot fail on a status being mapped to the WRONG outcome where both are
 * plausible (`accepted` versus `applied`, say). It can only fail on a status
 * being unmapped, on the default being wrong, and on a member of the
 * vocabulary that nothing can ever produce.
 *
 * ── AND THE BALANCE CHECK RULE 22 ASKS FOR ─────────────────────────────────
 *
 * The outcome vocabulary is deliberately not symmetric and should not be made
 * so: there is one way to say yes (`accepted`) and one to say no (`declined`),
 * and the remaining five describe things that happened WITHOUT the runner
 * answering. That asymmetry is about the engine's autonomy, not its
 * disposition, so it is argued rather than corrected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// UNDOTRACK-1 · `loadV5Decisions` batches a ledger read alongside its two
// existing loaders. Mocked here so the wiring tests below drive `loadV5Decisions`
// itself without a database, the same shape `_proposal_expiry.test.ts` uses for
// `pool`. The pure `outcomeOfWorkoutRow`/`outcomeOfPlanRow` tests further down
// never call these and are unaffected by the mock.
vi.mock('@/lib/plan/workout-proposals', () => ({ loadProposalHistory: vi.fn() }));
vi.mock('@/lib/plan/proposals-state', () => ({ loadAllPlanProposals: vi.fn() }));
vi.mock('@/lib/brain/ledger/decision-ledger', () => ({
  findUndoneProposalIds: vi.fn(),
  // `v5-proposals.ts` (real, unmocked) imports `isLedgerAvailable` at module
  // scope for its own pending-cards path, which this test never exercises —
  // stubbed here purely so the mocked module still has every export the rest
  // of the real import graph expects.
  isLedgerAvailable: vi.fn().mockResolvedValue(true),
}));

import { loadProposalHistory } from '@/lib/plan/workout-proposals';
import { loadAllPlanProposals } from '@/lib/plan/proposals-state';
import { findUndoneProposalIds } from '@/lib/brain/ledger/decision-ledger';
import {
  DECISION_OUTCOMES, _internals, loadV5Decisions, type V5DecisionOutcome,
} from '@/lib/faff/v5-decisions';

const { outcomeOfWorkoutRow, outcomeOfPlanRow } = _internals;
const loadProposalHistoryMock = loadProposalHistory as unknown as ReturnType<typeof vi.fn>;
const loadAllPlanProposalsMock = loadAllPlanProposals as unknown as ReturnType<typeof vi.fn>;
const findUndoneProposalIdsMock = findUndoneProposalIds as unknown as ReturnType<typeof vi.fn>;

const USER = '11111111-2222-3333-4444-555555555555';
const TODAY = '2026-09-09';

/** A minimal `plan_workout_proposals` row, shaped as `loadProposalHistory` returns it. */
function workoutRow(over: {
  id: number;
  workoutDateISO: string;
  storedStatus: string;
  resolvedAtISO?: string | null;
}) {
  return {
    id: over.id,
    userUuid: USER,
    planWorkoutId: `pw-${over.id}`,
    workoutDateISO: over.workoutDateISO,
    actionKind: 'unrecognized_kind_for_this_fixture',
    actionPayload: {},
    reason: 'a synthetic fixture row',
    evidence: {},
    status: 'pending' as const,
    createdAt: `${over.workoutDateISO}T00:00:00.000Z`,
    storedStatus: over.storedStatus,
    resolvedAtISO: over.resolvedAtISO ?? null,
  };
}

/** Every status `plan_proposals` can hold. Mirrors `PlanProposalStatus`. */
const PLAN_STATUSES = [
  'pending', 'auto_applied', 'accepted', 'dismissed',
  'superseded', 'expired', 'no_change', 'undone',
] as const;

/**
 * Every status `plan_workout_proposals` can hold.
 *
 * CA-13 (2026-09-13) · this list itself was missing `'superseded'` until
 * this pass — the same omission `outcomeOfWorkoutRow` had, found by an
 * independent Coach-audit implementation-status verification. A real,
 * currently-live row (`plan_workout_proposals.id=8`, `action_kind='hold'`)
 * carries this status. `web-v2/lib/plan/workout-proposals.ts:221`'s write
 * site is the source of truth for this value's existence.
 */
const WORKOUT_STATUSES = ['pending', 'accepted', 'dismissed', 'expired', 'superseded'] as const;

describe('V5PROPOSALSURFACE-1 · the two status maps are total', () => {
  it('maps every plan_proposals status, and only no_change is dropped', () => {
    const dropped = PLAN_STATUSES.filter((s) => outcomeOfPlanRow(s) == null);
    // `no_change` is the cron saying it composed the same block. Its own doc
    // comment: "there is nothing to tell anyone." Everything else is news.
    expect(dropped).toEqual(['no_change']);
  });

  it('maps every plan_workout_proposals status', () => {
    for (const s of WORKOUT_STATUSES) {
      expect(outcomeOfWorkoutRow(s, false, false)).toBeTruthy();
    }
  });

  it('CA-13 · a superseded workout row reads the same outcome a superseded plan row does (Rule 16)', () => {
    // Before this fix, a per-workout 'superseded' status fell through to the
    // `default` branch and read as 'expired' — implying the runner simply
    // never answered, when a newer decision actually intervened first. Both
    // tables now use the identical vocabulary value for the identical fact.
    expect(outcomeOfWorkoutRow('superseded', false, false)).toBe('superseded');
    expect(outcomeOfWorkoutRow('superseded', false, false))
      .toBe(outcomeOfPlanRow('superseded'));
  });

  it('an UNKNOWN status is never reported as still open', () => {
    // Rule 11 pointed at a surface: the safe reading of a status we have not
    // been taught is the one that promises the runner nothing to answer.
    expect(outcomeOfWorkoutRow('some_future_status', false, false)).toBe('expired');
    expect(outcomeOfPlanRow('some_future_status')).toBeNull();
  });
});

describe('V5PROPOSALSURFACE-1 · a stored status is not the authority on a date', () => {
  it('a PAST-DATED pending row reads as expired, whatever the column says', () => {
    // Production row 6 has been `pending` since 2026-08-23 for a session on
    // 2026-08-25, because expiry only ran when a phone opened a screen. A
    // history that shows that as OPEN is lying about the runner's plan.
    expect(outcomeOfWorkoutRow('pending', true, false)).toBe('expired');
    // And the deferral reading does not rescue it: the day has gone either way.
    expect(outcomeOfWorkoutRow('pending', true, true)).toBe('expired');
  });

  it('a future-dated pending row is open, and a deferred one says so', () => {
    expect(outcomeOfWorkoutRow('pending', false, false)).toBe('pending');
    expect(outcomeOfWorkoutRow('pending', false, true)).toBe('deferred');
  });
});

describe('UNDOTRACK-1 · the ledger overrides status, never the other way around', () => {
  it('undone wins over every status the row could otherwise carry', () => {
    // `reopenProposal` deliberately resets a per-workout row to `pending`
    // after an undo, so the status switch alone would print this as a still-
    // open question. `undone=true` is checked first and wins regardless.
    expect(outcomeOfWorkoutRow('pending', false, false, true)).toBe('undone');
    // And it wins even against a row whose day has since passed, or one that
    // was somehow re-marked expired before the ledger read landed.
    expect(outcomeOfWorkoutRow('pending', true, false, true)).toBe('undone');
    expect(outcomeOfWorkoutRow('expired', false, false, true)).toBe('undone');
    expect(outcomeOfWorkoutRow('accepted', false, false, true)).toBe('undone');
    expect(outcomeOfWorkoutRow('dismissed', false, false, true)).toBe('undone');
  });

  it('omitting the fourth argument is the same fact as undone=false', () => {
    // Rule 11's fallback posture, at the call-site default: a caller that
    // could not consult the ledger (or has not been taught about it) gets
    // exactly the pre-UNDOTRACK-1 behaviour, not a silent new default.
    for (const s of WORKOUT_STATUSES) {
      expect(outcomeOfWorkoutRow(s, false, false)).toBe(outcomeOfWorkoutRow(s, false, false, false));
    }
  });
});

describe('UNDOTRACK-1 · loadV5Decisions consults the ledger, batched, per Rule 11', () => {
  beforeEach(() => {
    loadProposalHistoryMock.mockReset();
    loadAllPlanProposalsMock.mockReset();
    findUndoneProposalIdsMock.mockReset();
    loadAllPlanProposalsMock.mockResolvedValue([]);
  });

  it('a per-workout accept-then-undo renders "undone", not "pending" or "expired"', async () => {
    // The exact production shape: `applyUndo` reversed the plan and stamped
    // `plan_decision_ledger.undone_at` on the original ACCEPTED row (the first
    // half of UNDOTRACK-1), and `reopenProposal` then reset THIS row's own
    // `status` back to `pending` so the decision is answerable again. Before
    // this fix, that `pending` status is all `loadV5Decisions` had to go on.
    loadProposalHistoryMock.mockResolvedValue({
      ok: true,
      rows: [workoutRow({ id: 42, workoutDateISO: '2026-09-15', storedStatus: 'pending' })],
    });
    findUndoneProposalIdsMock.mockResolvedValue({ state: 'read', ids: new Set(['42']) });

    const read = await loadV5Decisions(USER, TODAY);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.decisions).toHaveLength(1);
    expect(read.decisions[0].outcome).toBe('undone');

    // The batched shape: one call, carrying every per-workout id in the page,
    // not one probe per row.
    expect(findUndoneProposalIdsMock).toHaveBeenCalledTimes(1);
    expect(findUndoneProposalIdsMock).toHaveBeenCalledWith(USER, ['42']);
  });

  it('a genuinely pending row with no ledger entry still renders "pending"', async () => {
    loadProposalHistoryMock.mockResolvedValue({
      ok: true,
      rows: [workoutRow({ id: 7, workoutDateISO: '2026-09-20', storedStatus: 'pending' })],
    });
    // The ledger answered and this proposal id is not in the undone set —
    // most pending rows are just pending, never accepted at all.
    findUndoneProposalIdsMock.mockResolvedValue({ state: 'read', ids: new Set() });

    const read = await loadV5Decisions(USER, TODAY);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.decisions[0].outcome).toBe('pending');
  });

  it('a genuinely expired row with no ledger entry still renders "expired"', async () => {
    loadProposalHistoryMock.mockResolvedValue({
      ok: true,
      rows: [workoutRow({ id: 8, workoutDateISO: '2026-08-01', storedStatus: 'expired' })],
    });
    findUndoneProposalIdsMock.mockResolvedValue({ state: 'read', ids: new Set() });

    const read = await loadV5Decisions(USER, TODAY);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.decisions[0].outcome).toBe('expired');
  });

  it('a table-absent ledger falls back to status logic, never crashes, never a false "undone"', async () => {
    // Migration 166 not applied on this database — Rule 11's third fact, not
    // "nothing was undone". The row's own status (reset to pending by a real
    // undo, or genuinely pending — this mechanism cannot tell them apart right
    // now) is what carries it, exactly as it did before this fix existed.
    loadProposalHistoryMock.mockResolvedValue({
      ok: true,
      rows: [workoutRow({ id: 42, workoutDateISO: '2026-09-15', storedStatus: 'pending' })],
    });
    findUndoneProposalIdsMock.mockResolvedValue({
      state: 'table_absent',
      why: 'plan_decision_ledger does not exist on this database',
    });

    const read = await loadV5Decisions(USER, TODAY);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.decisions[0].outcome).toBe('pending');
  });

  it('a failed ledger read falls back to status logic, never crashes', async () => {
    loadProposalHistoryMock.mockResolvedValue({
      ok: true,
      rows: [workoutRow({ id: 9, workoutDateISO: '2026-08-01', storedStatus: 'expired' })],
    });
    findUndoneProposalIdsMock.mockResolvedValue({
      state: 'failed',
      why: 'the probe could not run',
    });

    const read = await loadV5Decisions(USER, TODAY);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.decisions[0].outcome).toBe('expired');
  });
});

describe('V5PROPOSALSURFACE-1 · every outcome is reachable', () => {
  it('no member of the vocabulary is decoration', () => {
    // Rule 15: a value no case can produce is untested by construction, and a
    // word the runner can never read has no business in the type.
    const reachable = new Set<V5DecisionOutcome>();
    for (const s of WORKOUT_STATUSES) {
      reachable.add(outcomeOfWorkoutRow(s, false, false));
      reachable.add(outcomeOfWorkoutRow(s, true, false));
      reachable.add(outcomeOfWorkoutRow(s, false, true));
    }
    for (const s of PLAN_STATUSES) {
      const o = outcomeOfPlanRow(s);
      if (o != null) reachable.add(o);
    }
    const unreachable = DECISION_OUTCOMES.filter((o) => !reachable.has(o));
    expect(unreachable).toEqual([]);
  });

  it('the vocabulary carries every outcome the maps can produce', () => {
    // The other direction, so the exported list cannot fall behind the maps.
    for (const s of WORKOUT_STATUSES) {
      expect(DECISION_OUTCOMES).toContain(outcomeOfWorkoutRow(s, false, false));
    }
    for (const s of PLAN_STATUSES) {
      const o = outcomeOfPlanRow(s);
      if (o != null) expect(DECISION_OUTCOMES).toContain(o);
    }
  });
});
