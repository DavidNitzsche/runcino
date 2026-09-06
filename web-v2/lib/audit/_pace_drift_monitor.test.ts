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
import { describe, it, expect } from 'vitest';
import { explainPaceDrift, type PaceDriftFinding, type PendingRepriceRow } from './pace-drift-monitor';
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
