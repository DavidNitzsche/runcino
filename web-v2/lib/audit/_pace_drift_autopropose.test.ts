/**
 * lib/audit/_pace_drift_autopropose.test.ts · DECISION 2 (2026-09-07).
 *
 * Two questions, and this file answers both without a live database:
 *
 *   1 · `isRunnerVisibleDrift` — the pure rounding rule. 429 vs 430 s/mi is
 *       the exact pair `_pace_drift_monitor.test.ts`'s own fixture already
 *       uses (7:09 vs 7:10), so this suite starts from a case already proven
 *       to be a real UNEXPLAINED finding rather than an invented one.
 *   2 · `autoProposeForUnexplainedDrift` — given a set of unexplained
 *       findings for one plan, does it call `writeReanchorProposal` (the
 *       EXISTING writer) only when at least one is runner-visible, and never
 *       otherwise? `writeReanchorProposal` itself is exercised for real here
 *       (not mocked away) so this suite also proves the second call in one
 *       run does not duplicate the card — the idempotency the ruling asked
 *       to be proven.
 *
 * `pool` and `resolveDateRangeExecutions` are mocked the same way
 * `_reanchor_proposes.test.ts` mocks them for the same writer; every other
 * import (`pricedAnchorsOf`, `anchorVdotFromState`, `fmtPace`,
 * `describesEvidence`, `actionFromReprice`, `serializeAction`) is real and
 * pure, so this suite is proving the actual writer's behaviour, not a mock of
 * it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/execution/day-resolver', () => ({
  resolveDateRangeExecutions: vi.fn(async () => new Map()),
}));

const mockResolveAnchors = vi.fn();
vi.mock('@/lib/training/load-prescription-anchors', () => ({
  resolvePrescribedPaceAnchors: (...args: unknown[]) => mockResolveAnchors(...args),
}));

import { pool } from '@/lib/db/pool';
import { autoProposeForUnexplainedDrift, isRunnerVisibleDrift } from './pace-drift-autopropose';
import type { PaceDriftFinding } from './pace-drift-monitor';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const PLAN = 'pln_active';
const TODAY = '2026-09-07';

/** A liveAnchors set with a threshold that reads 429 s/mi ("7:09"), while the
 *  plan's own stamp (below) is priced at 430 ("7:10") — the exact boundary
 *  pair `_pace_drift_monitor.test.ts` already treats as a real finding. */
function liveAnchors() {
  return {
    thresholdSecPerMi: 429,
    intervalSecPerMi: 380,
    repetitionSecPerMi: 350,
    easyCeilingSecPerMi: 560,
    shakeoutCeilingSecPerMi: 600,
    marathonSecPerMi: 480,
    basis: {
      threshold: { sourceMode: 'direct' as const, confidence: 0.9, vdot: 48.2 },
      highIntensity: { sourceMode: 'direct' as const, confidence: 0.9 },
      easyCeiling: { sourceMode: 'direct' as const, confidence: 0.9 },
      marathon: {
        sourceMode: 'direct' as const, confidence: 0.9, enduranceExponent: 1.06,
        personallyEvidenced: true,
      },
    },
  };
}

function planRow(overrides: Partial<{ mode: string | null; race_id: string | null; authored_state: Record<string, unknown> | null }> = {}) {
  return {
    mode: 'maintenance',
    race_id: null,
    authored_state: {
      pace_recompute: { anchors: { threshold_s_per_mi: 430, marathon_s_per_mi: 480 } },
    },
    ...overrides,
  };
}

const VISIBLE_FINDING: PaceDriftFinding = {
  anchorKey: 'threshold_s_per_mi',
  persistedSecPerMi: 430,
  liveSecPerMi: 429,
  activePlanId: PLAN,
};

/** Two values whose formatted display is IDENTICAL despite a real internal
 *  gap: 429.2 and 429.4 both round to "7:09" (Math.round rounds .5 up, so the
 *  pair must sit strictly inside one whole-second bucket, not straddle it). */
const INVISIBLE_FINDING: PaceDriftFinding = {
  anchorKey: 'marathon_s_per_mi',
  persistedSecPerMi: 429.2,
  liveSecPerMi: 429.4,
  activePlanId: PLAN,
};

beforeEach(() => {
  mockedQuery.mockReset();
  mockResolveAnchors.mockReset();
});

describe('isRunnerVisibleDrift · the exact fmtPace boundary the ruling names', () => {
  it('429 -> 430 crosses a displayed second (7:09 vs 7:10) — visible', () => {
    expect(isRunnerVisibleDrift(430, 429)).toBe(true);
  });

  it('429.2 -> 429.4 both round to 7:09 — not visible', () => {
    expect(isRunnerVisibleDrift(429.2, 429.4)).toBe(false);
  });

  it('identical values are never visible', () => {
    expect(isRunnerVisibleDrift(430, 430)).toBe(false);
  });
});

describe('autoProposeForUnexplainedDrift · the decision to call the existing writer', () => {
  it('no finding is runner-visible -> writes nothing, calls no query', async () => {
    const out = await autoProposeForUnexplainedDrift(USER, PLAN, TODAY, [INVISIBLE_FINDING]);
    expect(out.status).toBe('not_visible');
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockResolveAnchors).not.toHaveBeenCalled();
  });

  it('at least one visible finding -> raises the coordinated card via writeReanchorProposal', async () => {
    mockResolveAnchors.mockResolvedValue({ ok: true, anchors: liveAnchors() });
    // 1 · this file's own plan-row read
    mockedQuery.mockResolvedValueOnce({ rows: [planRow()] });
    // 2 · writeReanchorProposal's future-pace-bearing-days read
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'wko_1', date_iso: '2026-09-08' }] });
    // 3 · writeReanchorProposal's prior-proposals read (none pending/dismissed)
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    // 4 · the supersede+insert CTE
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 501 }] });

    const out = await autoProposeForUnexplainedDrift(USER, PLAN, TODAY, [VISIBLE_FINDING, INVISIBLE_FINDING]);
    expect(out.status).toBe('proposed');
    if (out.status === 'proposed') {
      expect(out.outcome.status).toBe('written');
      expect(out.visibleAnchorKeys).toEqual(['threshold_s_per_mi']);
      if (out.outcome.status === 'written') {
        expect(out.outcome.proposalId).toBe(501);
        // Never laundered to 'measured_vdot' — this is a monitored read, not
        // a fresh measurement (see the module header).
        expect(out.outcome.payload.toSource).toBe('direct');
        expect(out.outcome.payload.measured).toBe(true);
        expect(out.outcome.payload.planId).toBe(PLAN);
        expect(out.outcome.payload.arm).toBe('maintenance');
      }
    }
  });

  it('race-prep plan (race_id set) proposes on the race-prep arm, never canonical-prior', async () => {
    mockResolveAnchors.mockResolvedValue({ ok: true, anchors: liveAnchors() });
    mockedQuery.mockResolvedValueOnce({ rows: [planRow({ mode: 'race-prep', race_id: 'race_123' })] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'wko_1', date_iso: '2026-09-08' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 502 }] });

    const out = await autoProposeForUnexplainedDrift(USER, PLAN, TODAY, [VISIBLE_FINDING]);
    expect(out.status).toBe('proposed');
    if (out.status === 'proposed' && out.outcome.status === 'written') {
      expect(out.outcome.payload.arm).toBe('race-prep');
    }
  });

  it('IDEMPOTENT · calling twice in a row does not raise a second card for the same drift', async () => {
    mockResolveAnchors.mockResolvedValue({ ok: true, anchors: liveAnchors() });

    // First pass: plan row, future days, no prior proposals, insert #501.
    mockedQuery.mockResolvedValueOnce({ rows: [planRow()] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'wko_1', date_iso: '2026-09-08' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 501 }] });

    const first = await autoProposeForUnexplainedDrift(USER, PLAN, TODAY, [VISIBLE_FINDING]);
    expect(first.status).toBe('proposed');
    if (first.status !== 'proposed' || first.outcome.status !== 'written') {
      throw new Error('expected first pass to write a card');
    }
    const firstPayload = first.outcome.payload;

    // Second pass, same inputs: plan row, future days, and THIS TIME the
    // prior-proposals read returns the card #501 just written, still pending,
    // with the same anchor moves. `isSameRepricing` (reanchor-proposal.ts)
    // must recognise it as the same question and write nothing new.
    mockedQuery.mockResolvedValueOnce({ rows: [planRow()] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'wko_1', date_iso: '2026-09-08' }] });
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 501, status: 'pending', action_payload: { reprice: firstPayload }, resolved_at: null }],
    });

    const second = await autoProposeForUnexplainedDrift(USER, PLAN, TODAY, [VISIBLE_FINDING]);
    expect(second.status).toBe('proposed');
    if (second.status === 'proposed') {
      expect(second.outcome.status).toBe('unchanged');
      if (second.outcome.status === 'unchanged') {
        expect(second.outcome.existingProposalId).toBe(501);
      }
    }
    // No INSERT on the second pass — exactly 3 queries (plan row, future
    // days, prior proposals), never a 4th (the supersede+insert CTE).
    // 4 from pass one (plan row, future days, prior proposals, insert) + 3
    // from pass two (plan row, future days, prior proposals) = 7.
    expect(mockedQuery).toHaveBeenCalledTimes(7);
  });

  it('no active plan row -> reports no_active_plan and calls no anchor resolver', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const out = await autoProposeForUnexplainedDrift(USER, PLAN, TODAY, [VISIBLE_FINDING]);
    expect(out.status).toBe('no_active_plan');
    expect(mockResolveAnchors).not.toHaveBeenCalled();
  });

  it('anchors refused -> reports anchors_unavailable, writes nothing', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [planRow()] });
    mockResolveAnchors.mockResolvedValue({ ok: false, reason: 'ANCHOR_NOT_FINITE', detail: 'no finite threshold' });
    const out = await autoProposeForUnexplainedDrift(USER, PLAN, TODAY, [VISIBLE_FINDING]);
    expect(out.status).toBe('anchors_unavailable');
    // Only the plan-row read ran; no future-days / prior-proposals / insert query.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });
});
