/**
 * POST /api/plan/workout-proposals/:id/accept · the two MODERN lanes must
 * reopen a proposal when accept succeeds but Apply fails.
 *
 * ── THE DEFECT (Brain v2.1 §11.2, P1 — confirmed still live before this fix) ─
 *
 * `acceptProposal()` stamps `status='accepted'` before either the
 * `ACTIONCOMPLETE-1` (`applyBrainAction`) or `REANCHORPROPOSES-1` (`reprice`)
 * branch runs. The LEGACY lane (bottom of the route) already calls
 * `sayIfTheCardCouldNotBePutBack()` on every failure path — on a thrown
 * apply AND on a zero-rows apply. The two modern lanes did not: on
 * `!outcome.ok` or a null/thrown reprice apply, they returned the error
 * without ever reopening the card, leaving the row permanently `accepted`
 * with nothing recording that the plan never moved.
 *
 * Reachable in production: `option-lane.ts` writes real `mark_upgrade`
 * proposals from the `run-adaptations` cron (`source:'cron_evening'`), which
 * a runner can tap Accept on and hit this exact path.
 *
 * This test proves the fix: both modern lanes now call `reopenProposal`
 * (via the route's own `sayIfTheCardCouldNotBePutBack` helper) on every
 * failure, mirroring the legacy lane's already-correct behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ requireUserId: vi.fn() }));
vi.mock('@/lib/plan/workout-proposals', () => ({
  acceptProposal: vi.fn(),
  reopenProposal: vi.fn(),
  resolveProposalExpirationPromise: vi.fn().mockResolvedValue(undefined),
  loadPendingProposalById: vi.fn(),
}));
vi.mock('@/lib/plan/reprice-payload', () => ({ asRepricePayload: vi.fn() }));
vi.mock('@/lib/plan/adapt', () => ({ applyAdaptations: vi.fn() }));
vi.mock('@/lib/coach/cache', () => ({ bustBriefingCacheForEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/brain/proposal/staleness', () => ({
  readLiveRows: vi.fn().mockResolvedValue([]),
  actionFromPending: vi.fn(),
  LEGACY_MUTATING_ACTION_KINDS: new Set(['downgrade', 'shave', 'reschedule', 'field_test', 'mark_upgrade']),
}));
vi.mock('@/lib/brain/proposal/execute', () => ({
  prepareAction: vi.fn().mockReturnValue({ ok: true, plan: { nonMutating: false } }),
}));
vi.mock('@/lib/brain/proposal/accept', () => ({ applyBrainAction: vi.fn() }));
vi.mock('@/lib/runtime/runner-tz', () => ({ runnerToday: vi.fn().mockResolvedValue('2026-09-12') }));
vi.mock('@/lib/plan/reanchor-plan', () => ({ applyReanchorProposal: vi.fn() }));

import { requireUserId } from '@/lib/auth/session';
import { acceptProposal, reopenProposal, loadPendingProposalById } from '@/lib/plan/workout-proposals';
import { asRepricePayload } from '@/lib/plan/reprice-payload';
import { actionFromPending } from '@/lib/brain/proposal/staleness';
import { applyBrainAction } from '@/lib/brain/proposal/accept';
import { applyReanchorProposal } from '@/lib/plan/reanchor-plan';
import { POST } from '../../app/api/plan/workout-proposals/[id]/accept/route';

const USER = 'user-1234';
const PROPOSAL_ID = 42;

function acceptRequest(): { req: any; ctx: { params: Promise<{ id: string }> } } {
  return {
    req: new Request(`http://localhost/api/plan/workout-proposals/${PROPOSAL_ID}/accept`, { method: 'POST' }),
    ctx: { params: Promise.resolve({ id: String(PROPOSAL_ID) }) },
  };
}

describe('workout-proposals accept · reopen on Apply failure (modern lanes)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // clear call history between tests; mock implementations set below are per-test
    vi.mocked(requireUserId).mockResolvedValue(USER as any);
    vi.mocked(loadPendingProposalById).mockResolvedValue({
      ok: true,
      proposal: { planWorkoutId: 'w1', actionKind: 'mark_upgrade' },
    } as any);
    vi.mocked(actionFromPending).mockReturnValue({ kind: 'mark_upgrade' } as any);
    vi.mocked(reopenProposal).mockResolvedValue({ ok: true, reopened: true } as any);
  });

  it('ACTIONCOMPLETE-1 lane: reopens the card when applyBrainAction reports !ok', async () => {
    vi.mocked(acceptProposal).mockResolvedValue({
      actionKind: 'mark_upgrade',
      actionPayload: { action: { kind: 'mark_upgrade' }, why: 'evidence' },
      reason: 'evidence',
    } as any);
    vi.mocked(applyBrainAction).mockResolvedValue({
      ok: false, error: 'apply_failed', detail: 'the adaptation pipeline refused the write',
    } as any);

    const { req, ctx } = acceptRequest();
    const res = await POST(req, ctx);

    expect(reopenProposal).toHaveBeenCalledWith(USER, PROPOSAL_ID);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'apply_failed', detail: 'the adaptation pipeline refused the write' });
  });

  it('ACTIONCOMPLETE-1 lane: reopens on EVERY AcceptOutcome error kind, not just apply_failed', async () => {
    vi.mocked(acceptProposal).mockResolvedValue({
      actionKind: 'mark_upgrade',
      actionPayload: { action: { kind: 'mark_upgrade' }, why: 'evidence' },
      reason: 'evidence',
    } as any);
    for (const error of ['invalid', 'unsupported', 'missing_context', 'rejected'] as const) {
      vi.mocked(reopenProposal).mockClear();
      vi.mocked(applyBrainAction).mockResolvedValue({ ok: false, error, detail: 'x' } as any);
      const { req, ctx } = acceptRequest();
      await POST(req, ctx);
      expect(reopenProposal, `error kind '${error}' must still reopen the card`).toHaveBeenCalledWith(USER, PROPOSAL_ID);
    }
  });

  it('ACTIONCOMPLETE-1 lane: does NOT reopen on success (positive control)', async () => {
    vi.mocked(acceptProposal).mockResolvedValue({
      actionKind: 'mark_upgrade',
      actionPayload: { action: { kind: 'mark_upgrade' }, why: 'evidence' },
      reason: 'evidence',
    } as any);
    vi.mocked(applyBrainAction).mockResolvedValue({
      ok: true, applied: 1, recordedOnly: false, watch: { kind: 'NO_WATCH_EFFECT' }, undo: { can: true },
    } as any);

    const { req, ctx } = acceptRequest();
    const res = await POST(req, ctx);

    expect(reopenProposal).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('REANCHORPROPOSES-1 (reprice) lane: reopens the card when applyReanchorProposal resolves null', async () => {
    vi.mocked(loadPendingProposalById).mockResolvedValue({
      ok: true,
      proposal: { planWorkoutId: 'w1', actionKind: 'reprice' },
    } as any);
    vi.mocked(acceptProposal).mockResolvedValue({
      actionKind: 'reprice',
      actionPayload: { reprice: { planId: 'p1', arm: 'canonical-prior', toVdot: 50 } },
    } as any);
    vi.mocked(asRepricePayload).mockReturnValue({ planId: 'p1', arm: 'canonical-prior', toVdot: 50 } as any);
    vi.mocked(applyReanchorProposal).mockResolvedValue(null as any);

    const { req, ctx } = acceptRequest();
    const res = await POST(req, ctx);

    expect(reopenProposal).toHaveBeenCalledWith(USER, PROPOSAL_ID);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'apply_refused' });
  });

  it('REANCHORPROPOSES-1 (reprice) lane: reopens the card when applyReanchorProposal throws', async () => {
    vi.mocked(loadPendingProposalById).mockResolvedValue({
      ok: true,
      proposal: { planWorkoutId: 'w1', actionKind: 'reprice' },
    } as any);
    vi.mocked(acceptProposal).mockResolvedValue({
      actionKind: 'reprice',
      actionPayload: { reprice: { planId: 'p1', arm: 'canonical-prior', toVdot: 50 } },
    } as any);
    vi.mocked(asRepricePayload).mockReturnValue({ planId: 'p1', arm: 'canonical-prior', toVdot: 50 } as any);
    vi.mocked(applyReanchorProposal).mockRejectedValue(new Error('db exploded'));

    const { req, ctx } = acceptRequest();
    const res = await POST(req, ctx);

    expect(reopenProposal).toHaveBeenCalledWith(USER, PROPOSAL_ID);
    expect(res.status).toBe(409);
  });

  it('REANCHORPROPOSES-1 (reprice) lane: reopens the card when the payload is unreadable (found by independent review)', async () => {
    vi.mocked(loadPendingProposalById).mockResolvedValue({
      ok: true,
      proposal: { planWorkoutId: 'w1', actionKind: 'reprice' },
    } as any);
    vi.mocked(acceptProposal).mockResolvedValue({
      actionKind: 'reprice',
      actionPayload: { reprice: { garbage: true } },
    } as any);
    vi.mocked(asRepricePayload).mockReturnValue(null); // unreadable payload

    const { req, ctx } = acceptRequest();
    const res = await POST(req, ctx);

    expect(reopenProposal, 'an unreadable reprice payload leaves the plan untouched and owes the same reopen as apply_refused/apply_failed').toHaveBeenCalledWith(USER, PROPOSAL_ID);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'invalid_payload' });
  });

  it('REANCHORPROPOSES-1 (reprice) lane: does NOT reopen on success (positive control)', async () => {
    vi.mocked(loadPendingProposalById).mockResolvedValue({
      ok: true,
      proposal: { planWorkoutId: 'w1', actionKind: 'reprice' },
    } as any);
    vi.mocked(acceptProposal).mockResolvedValue({
      actionKind: 'reprice',
      actionPayload: { reprice: { planId: 'p1', arm: 'canonical-prior', toVdot: 50 } },
    } as any);
    vi.mocked(asRepricePayload).mockReturnValue({ planId: 'p1', arm: 'canonical-prior', toVdot: 50 } as any);
    vi.mocked(applyReanchorProposal).mockResolvedValue({ workoutsUpdated: 5, workoutsSealed: 0, toVdot: 51 } as any);

    const { req, ctx } = acceptRequest();
    const res = await POST(req, ctx);

    expect(reopenProposal).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});
