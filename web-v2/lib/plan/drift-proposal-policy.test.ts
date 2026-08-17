/**
 * PROPOSAL-SPAM KILLER INVARIANTS (2026-08-17 · truth-bug fix).
 *
 * Locks the verified prod failure chain shut:
 *   1. writer stamps the TRUE drift kind (no synthetic 'goal_time_changed')
 *   2. the dedupe guard iterates the exact kind set the writer produces
 *   3. staleness/drift proposals are suppressed inside 14 days of the
 *      race (generatePlan refuses there · 'target < 2 weeks away')
 *   4. hasPendingProposal '' planId means any-plan (the goal-gap dedupe
 *      passed '' and could never match a real row)
 *   5. expireStalePendingProposals expires the historical mislabeled
 *      'goal_time_changed' spam (reasons.drift_kind in the drift set)
 *      regardless of age — and never touches a real goal edit or the
 *      renegotiation accept path (drift_kind 'goal_renegotiated').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-08-17'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import {
  SOFT_DRIFT_PROPOSAL_KINDS,
  driftProposalKind,
  suppressDriftNearRace,
  daysToRace,
} from './drift-proposal-policy';
import { hasPendingProposal, type DriftKind } from './drift-monitor';
import { expireStalePendingProposals } from './goal-renegotiation';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('driftProposalKind · the writer stamps the TRUE kind', () => {
  it('is the identity for every drift kind (never a synthetic goal_time_changed)', () => {
    const kinds: DriftKind[] = [
      'volume_drift', 'vdot_drift', 'staleness',
      'easy_drift', 'long_drift', 'quality_drift', 'goal_gap_widening',
    ];
    for (const k of kinds) {
      expect(driftProposalKind(k)).toBe(k);
      expect(driftProposalKind(k)).not.toBe('goal_time_changed');
    }
  });
});

describe('SOFT_DRIFT_PROPOSAL_KINDS · guard and writer agree', () => {
  it('covers every kind detectDrift can emit except goal_gap_widening (own dedupe)', () => {
    expect([...SOFT_DRIFT_PROPOSAL_KINDS].sort()).toEqual([
      'easy_drift', 'long_drift', 'quality_drift',
      'staleness', 'vdot_drift', 'volume_drift',
    ].sort());
  });
  it('never contains a hard-drift kind', () => {
    for (const k of SOFT_DRIFT_PROPOSAL_KINDS) {
      expect(['goal_time_changed', 'race_date_changed', 'a_race_added', 'a_race_removed'])
        .not.toContain(k);
    }
  });
});

describe('suppressDriftNearRace · race week must not ask what the engine refuses', () => {
  it('suppresses from race day through 13 days out (generatePlan refusal window)', () => {
    expect(suppressDriftNearRace('2026-08-17', '2026-08-17')).toBe(true);  // race day
    expect(suppressDriftNearRace('2026-08-20', '2026-08-17')).toBe(true);  // 3 days
    expect(suppressDriftNearRace('2026-08-30', '2026-08-17')).toBe(true);  // 13 days
  });
  it('does not suppress at 14+ days (the generator will build)', () => {
    expect(suppressDriftNearRace('2026-08-31', '2026-08-17')).toBe(false); // 14 days
    expect(suppressDriftNearRace('2026-12-06', '2026-08-17')).toBe(false);
  });
  it('does not suppress for a past race or missing date (graduate path owns that)', () => {
    expect(suppressDriftNearRace('2026-08-16', '2026-08-17')).toBe(false);
    expect(suppressDriftNearRace(null, '2026-08-17')).toBe(false);
    expect(suppressDriftNearRace(undefined, '2026-08-17')).toBe(false);
  });
  it('daysToRace is calendar-exact', () => {
    expect(daysToRace('2026-08-31', '2026-08-17')).toBe(14);
    expect(daysToRace('2026-08-16', '2026-08-17')).toBe(-1);
  });
});

describe('hasPendingProposal · plan scoping', () => {
  it('empty planId matches ANY plan (passes NULL to the plan filter)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 7 }] });
    const hit = await hasPendingProposal('user-1', '', 'goal_gap_widening');
    expect(hit).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('plan_id::text = $3::text');
    expect(params).toEqual(['user-1', 'goal_gap_widening', null]);
  });
  it('a real planId still scopes the match to that plan', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const hit = await hasPendingProposal('user-1', 'plan-9', 'staleness');
    expect(hit).toBe(false);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['user-1', 'staleness', 'plan-9']);
  });
});

describe('expireStalePendingProposals · historical mislabeled spam', () => {
  it('runs the age pass AND the mislabeled goal_time_changed pass, summing counts', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 3 })   // >14d pending, any kind
      .mockResolvedValueOnce({ rowCount: 19 }); // mislabeled drift spam, any age
    const n = await expireStalePendingProposals('user-1');
    expect(n).toBe(22);
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [sqlAge] = mockQuery.mock.calls[0];
    expect(sqlAge).toContain("interval '14 days'");

    const [sqlMislabeled] = mockQuery.mock.calls[1];
    expect(sqlMislabeled).toContain("proposal_kind = 'goal_time_changed'");
    expect(sqlMislabeled).toContain("reasons->>'drift_kind'");
    // No age filter on the mislabeled pass · the spam predates 14d windows.
    expect(sqlMislabeled).not.toContain('created_at');
    // The drift-signal set · covers the two audit-confirmed spam kinds.
    expect(sqlMislabeled).toContain("'staleness'");
    expect(sqlMislabeled).toContain("'volume_drift'");
    expect(sqlMislabeled).toContain("'goal_gap_widening'");
    // The renegotiation accept path stamps drift_kind 'goal_renegotiated'
    // on a REAL goal edit · must never be expired by this pass.
    expect(sqlMislabeled).not.toContain('goal_renegotiated');
  });
});
