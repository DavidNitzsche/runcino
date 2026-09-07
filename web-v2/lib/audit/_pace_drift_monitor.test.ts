/**
 * lib/audit/_pace_drift_monitor.test.ts · DECISION 1's six-field check,
 * falsified field by field.
 *
 * `explainPaceDrift` is pure — every fact it needs is passed in — so this
 * suite proves the logic with no database, and `_cross_surface_contract.
 * test.ts` (live production) is where the real wiring gets exercised end to
 * end. The two are not duplicates: this proves the RULE, that file proves the
 * PRODUCTION STATE the rule is applied to.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  explainPaceDrift, readPendingRepriceProposal, type PaceDriftFinding, type PendingRepriceRow,
} from './pace-drift-monitor';
import { REPRICE_DISMISSAL_QUIET_DAYS } from '@/lib/plan/reanchor-proposal';

const NOW = '2026-09-06T12:00:00.000Z';

const finding: PaceDriftFinding = {
  anchorKey: 'threshold_s_per_mi',
  persistedSecPerMi: 430,
  liveSecPerMi: 429,
  activePlanId: 'pln_active',
};

function goodProposal(overrides: Partial<PendingRepriceRow> = {}): PendingRepriceRow {
  return {
    id: 1,
    planId: 'pln_active',
    anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 429 }],
    evidence: { hrv: 42, note: 'threshold trend' },
    createdAtISO: '2026-09-05T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  };
}

describe('DECISION-1 · explainPaceDrift · the six fields', () => {
  it('EXPLAINED · every field matches, a fresh pending proposal', () => {
    const v = explainPaceDrift(finding, goodProposal(), NOW);
    expect(v.explained).toBe(true);
  });

  it('no proposal at all is UNEXPLAINED', () => {
    const v = explainPaceDrift(finding, null, NOW);
    expect(v.explained).toBe(false);
  });

  it('FIELD · proposal status must be pending', () => {
    const v = explainPaceDrift(finding, goodProposal({ status: 'dismissed' }), NOW);
    expect(v.explained).toBe(false);
    expect(!v.explained && v.reason).toContain("status 'dismissed'");
  });

  it('FIELD · plan version — a proposal against a different (e.g. rebuilt) plan explains nothing', () => {
    const v = explainPaceDrift(finding, goodProposal({ planId: 'pln_old_rebuilt_away' }), NOW);
    expect(v.explained).toBe(false);
    expect(!v.explained && v.reason).toContain('active plan is now');
  });

  it('FIELD · evidence must be non-empty', () => {
    const v = explainPaceDrift(finding, goodProposal({ evidence: {} }), NOW);
    expect(v.explained).toBe(false);
    expect(!v.explained && v.reason).toContain('no evidence');
  });

  it('FIELD · evidence null is also empty', () => {
    const v = explainPaceDrift(finding, goodProposal({ evidence: null }), NOW);
    expect(v.explained).toBe(false);
  });

  it('FIELD · the after value must be the SAME drift, not merely a proposal in the same direction', () => {
    const v = explainPaceDrift(
      finding,
      goodProposal({ anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 428 }] }),
      NOW,
    );
    expect(v.explained).toBe(false);
    expect(!v.explained && v.reason).toContain('not the same drift');
  });

  it('FIELD · no anchor move for this key at all', () => {
    const v = explainPaceDrift(
      finding,
      goodProposal({ anchorMoves: [{ key: 'marathon_s_per_mi', fromSecPerMi: 472, toSecPerMi: 471 }] }),
      NOW,
    );
    expect(v.explained).toBe(false);
    expect(!v.explained && v.reason).toContain('names no anchor move');
  });

  it('EXPIRATION (before-value drift) · the proposal\'s recorded before no longer matches the persisted row', () => {
    // Something else already changed the row since this proposal was raised
    // — its own "before" claim is now false, so it explains nothing about
    // TODAY's drift even though its status column still says pending.
    const v = explainPaceDrift(
      finding,
      goodProposal({ anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 431, toSecPerMi: 429 }] }),
      NOW,
    );
    expect(v.explained).toBe(false);
    expect(!v.explained && v.reason).toContain('stale against its own claim');
  });

  it(`EXPIRATION (age) · older than the ${REPRICE_DISMISSAL_QUIET_DAYS}-day reprice quiet window is no longer a live question`, () => {
    const old = new Date(Date.parse(NOW) - (REPRICE_DISMISSAL_QUIET_DAYS + 1) * 86_400_000).toISOString();
    const v = explainPaceDrift(finding, goodProposal({ createdAtISO: old }), NOW);
    expect(v.explained).toBe(false);
    expect(!v.explained && v.reason).toContain('days old');
  });

  it(`exactly at the ${REPRICE_DISMISSAL_QUIET_DAYS}-day boundary is still explained (not yet over)`, () => {
    const atEdge = new Date(Date.parse(NOW) - REPRICE_DISMISSAL_QUIET_DAYS * 86_400_000).toISOString();
    const v = explainPaceDrift(finding, goodProposal({ createdAtISO: atEdge }), NOW);
    expect(v.explained).toBe(true);
  });

  it('DECISION-1\'S OWN WORDS · this is not a generic tolerance — a proposal for a DIFFERENT anchor never explains this one', () => {
    // If this suite only asserted the happy path, a caller could satisfy it
    // by raising ANY pending proposal, regardless of whether it says
    // anything about the anchor actually drifting. This is the test that
    // would catch that regression.
    const v = explainPaceDrift(
      { ...finding, anchorKey: 'marathon_s_per_mi', persistedSecPerMi: 472, liveSecPerMi: 471 },
      goodProposal(), // only carries threshold_s_per_mi
      NOW,
    );
    expect(v.explained).toBe(false);
  });
});

/**
 * `readPendingRepriceProposal` · a real row, parsed the way it is actually
 * stored, not the way `explainPaceDrift`'s own fixtures assume.
 *
 * Found rendering DECISION-2 against a real scratch copy of production data
 * (Rule 13): `action_payload` is written as `{ why, reprice, action }`
 * (`writeReanchorProposal`'s own INSERT, lib/plan/reanchor-proposal.ts) —
 * this function was passing that WHOLE object to `asRepricePayload`, which
 * checks for `kind === 'reprice'` at the object's own top level and found
 * none, so it returned null for every real reprice row ever written. Every
 * one of `explainPaceDrift`'s tests above is falsifiable with a
 * hand-built `PendingRepriceRow` and could not have caught this — it lives
 * entirely in the DB round trip this function performs.
 */
describe('readPendingRepriceProposal · the real row shape writeReanchorProposal writes', () => {
  const USER = 'abcdef12-3456-7890-abcd-ef1234567890';

  /** Exactly the shape `lib/plan/reanchor-proposal.ts`'s INSERT stores:
   *  `JSON.stringify({ why, reprice: payload, action: serializeAction(...) })`. */
  function realRow(overrides: Partial<{ status: string }> = {}) {
    return {
      id: 42,
      action_payload: {
        why: 'The canonical pace resolvers put threshold at 7:09 per mile today.',
        reprice: {
          kind: 'reprice',
          planId: 'pln_active',
          arm: 'race-prep',
          fromVdot: 47.7,
          toVdot: 47.9,
          toSource: 'direct',
          measured: true,
          anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 429 }],
          meanAnchorDeltaSecPerMi: -1,
          workoutsAffected: 76,
          workoutsSealed: 0,
          computedAt: '2026-09-07T16:34:38.673Z',
        },
        action: { v: 1, action: { kind: 'COORDINATED' } },
      },
      evidence: { detector: 'pace-drift-monitor' },
      created_at: '2026-09-07T16:34:38.673Z',
      status: 'pending',
      ...overrides,
    };
  }

  it('parses a REAL row and returns a usable PendingRepriceRow (was: always null)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [realRow()] });
    const proposal = await readPendingRepriceProposal({ query }, USER);
    expect(proposal).not.toBeNull();
    expect(proposal?.id).toBe(42);
    expect(proposal?.planId).toBe('pln_active');
    expect(proposal?.anchorMoves).toEqual([{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 429 }]);
    expect(proposal?.status).toBe('pending');
  });

  it('the parsed row EXPLAINS the matching drift end to end (the whole point of DECISION-1)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [realRow()] });
    const proposal = await readPendingRepriceProposal({ query }, USER);
    const finding: PaceDriftFinding = {
      anchorKey: 'threshold_s_per_mi', persistedSecPerMi: 430, liveSecPerMi: 429, activePlanId: 'pln_active',
    };
    const v = explainPaceDrift(finding, proposal, '2026-09-07T18:00:00.000Z');
    expect(v.explained).toBe(true);
  });

  it('no row at all still returns null (unchanged behaviour)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const proposal = await readPendingRepriceProposal({ query }, USER);
    expect(proposal).toBeNull();
  });

  it('a row whose payload cannot be parsed as a reprice still returns null, not a throw', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ...realRow(), action_payload: { why: 'no reprice key' } }] });
    const proposal = await readPendingRepriceProposal({ query }, USER);
    expect(proposal).toBeNull();
  });
});
