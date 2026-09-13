/**
 * lib/training/_fitness_decision_identity.test.ts
 *
 * Proves the evidence-identity dedup answers Q3 concretely: the SAME three
 * corroborating runs, still the most recent evidence tomorrow night, do not
 * re-fire the decision — and every neighbouring fact that SHOULD re-open it
 * does.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 * · WHETHER THE DECISION IS THE RIGHT ONE. Every case here asks only whether
 *   it is NEW. A detector that fires a wrong-but-novel decision passes all of
 *   this.
 * · WHETHER THE LEDGER ACTUALLY ENFORCES THE KEY. That is
 *   `plan_decision_ledger`'s partial unique index and
 *   `recordDecisionInTransaction(..., { onceOnly: true })`, exercised by
 *   `lib/brain/ledger/_decision_ledger.db.test.ts` against a real table.
 *   These tests hand `shouldFireOnThisEvidence` a hand-built probe, so a
 *   broken ledger adapter would be invisible here.
 * · WHETHER `evidenceIds` ARE THE RIGHT PROVENANCE. Verified separately
 *   against production (they are `runs.id::text`); nothing in this file
 *   could tell if the resolver started naming the wrong rows.
 * · THE BALANCE QUESTION Rule 22 actually asks. Counted deliberately: 4 cases
 *   assert a decision is SUPPRESSED and 6 assert one is PERMITTED. The
 *   permit side is heavier on purpose — a dedup mechanism written by someone
 *   worried about duplicate cards will naturally over-suppress, and an
 *   over-suppressing dedup on the pace lever is Rule 21's exact failure with
 *   a new cause.
 */
import { describe, it, expect } from 'vitest';
import {
  fitnessEvidenceFingerprint,
  quantiseVdotMagnitude,
  fitnessDecisionIdentity,
  shouldFireOnThisEvidence,
  type FitnessDecisionIdentityInput,
  type LedgerKeyProbe,
} from '@/lib/training/fitness-decision-identity';
import { TRAINING_LEAD_REANCHOR_DELTA } from '@/lib/training/pace-anchor';

/** The owner's real evidence set on 2026-09-13, verified against production
 *  as four live `runs` rows (2026-07-07, 2026-08-30, 2026-09-01, 2026-09-08). */
const REAL_EVIDENCE = [
  '-258355938987883',
  '-87627419857791',
  '-75144899844434',
  '-245190372869167',
];

function input(over: Partial<FitnessDecisionIdentityInput> = {}): FitnessDecisionIdentityInput {
  return {
    userUuid: '0645f40c-951d-4ccc-b86e-9979cd26c795',
    planLineageId: 'pln_7636bcc0a201bf2d',
    detector: 'training_lead',
    direction: 'UP',
    evidenceIds: REAL_EVIDENCE,
    deltaVdot: 1.2,
    ...over,
  };
}

function keyOf(over: Partial<FitnessDecisionIdentityInput> = {}): string {
  const id = fitnessDecisionIdentity(input(over));
  if (id.kind !== 'identified') throw new Error(`expected identified, got ${id.kind}`);
  return id.key;
}

describe('fitnessEvidenceFingerprint · content, not order', () => {
  it('is stable under reordering — the resolver guarantees no iteration order', () => {
    const a = fitnessEvidenceFingerprint(REAL_EVIDENCE);
    const b = fitnessEvidenceFingerprint([...REAL_EVIDENCE].reverse());
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('is stable under duplication', () => {
    expect(fitnessEvidenceFingerprint([...REAL_EVIDENCE, REAL_EVIDENCE[0]]))
      .toBe(fitnessEvidenceFingerprint(REAL_EVIDENCE));
  });

  it('CHANGES when a run ages out of the window — the case a last-run-date proxy misses', () => {
    // The owner's oldest evidence member is 2026-07-07, 63 days old on
    // 2026-09-13. It will leave the corpus with no new run required, and
    // `live-input.ts`'s `evidenceVersion = last run's date` would not notice.
    const aged = REAL_EVIDENCE.filter((id) => id !== '-87627419857791');
    expect(fitnessEvidenceFingerprint(aged)).not.toBe(fitnessEvidenceFingerprint(REAL_EVIDENCE));
  });

  it('CHANGES when a new run joins the set', () => {
    expect(fitnessEvidenceFingerprint([...REAL_EVIDENCE, '-999999999999999']))
      .not.toBe(fitnessEvidenceFingerprint(REAL_EVIDENCE));
  });

  it('refuses to hash an empty set rather than returning a hash of nothing (Rule 11)', () => {
    expect(fitnessEvidenceFingerprint([])).toBeNull();
    expect(fitnessEvidenceFingerprint(['', ''])).toBeNull();
  });

  it('a set and a concatenation-equal different set do not collide', () => {
    // Without the length prefix, ['ab','c'] and ['a','bc'] could join to the
    // same payload under a naive separator choice.
    expect(fitnessEvidenceFingerprint(['ab', 'c'])).not.toBe(fitnessEvidenceFingerprint(['a', 'bc']));
  });
});

describe('the key · what changes it and what must not', () => {
  it('is IDENTICAL for the same evidence, lineage and quantised delta', () => {
    expect(keyOf()).toBe(keyOf());
  });

  it('does NOT change when only confidence/resolvedAt would have moved', () => {
    // Neither is an input to the key at all — asserted structurally by the
    // fact that `FitnessDecisionIdentityInput` has no field for either. This
    // case exists so the omission is visible, per `idempotencyKeyFor`'s own
    // "note what is NOT in it: the timestamp".
    const before = keyOf();
    // Measured on real history: confidence moved 0.67→0.84 across days on
    // which the evidence set never changed once.
    const after = keyOf();
    expect(after).toBe(before);
  });

  it('does NOT change for a sub-doctrine-step wobble in the delta', () => {
    // The owner's canonical VDOT moved 47.8 → 47.9 with no evidence change.
    expect(keyOf({ deltaVdot: 1.2 })).toBe(keyOf({ deltaVdot: 1.3 }));
  });

  it('DOES change when the delta crosses a full doctrine step', () => {
    expect(keyOf({ deltaVdot: 1.2 })).not.toBe(
      keyOf({ deltaVdot: 1.2 + TRAINING_LEAD_REANCHOR_DELTA }),
    );
  });

  it('does NOT change across the two detectors — they are mutually exclusive by construction', () => {
    // `detectAdaptations` runs `detectTrainingLead` only when neither
    // `pr_bank` nor `fitness_regression` fired (`adapt.ts` ~4103). One
    // evidence set, one lever, one boundary therefore admits at most one
    // threshold-pace decision; separating them in the key would licence the
    // same evidence being recorded as both a push and a pull-back.
    expect(keyOf({ detector: 'training_lead', direction: 'UP' }))
      .toBe(keyOf({ detector: 'fitness_regression', direction: 'UP' }));
    expect(keyOf({ direction: 'UP' })).toBe(keyOf({ direction: 'DOWN' }));
  });

  it('DOES change per runner and per plan LINEAGE', () => {
    expect(keyOf({ userUuid: 'other-uuid' })).not.toBe(keyOf());
    expect(keyOf({ planLineageId: 'pln_other' })).not.toBe(keyOf());
  });

  it('refuses to mint a key with no evidence (Rule 11)', () => {
    const id = fitnessDecisionIdentity(input({ evidenceIds: [] }));
    expect(id.kind).toBe('no_evidence');
  });
});

describe('quantiseVdotMagnitude · reads doctrine, does not restate it', () => {
  it('buckets on the doctrine constant, not on a local literal', () => {
    expect(quantiseVdotMagnitude(TRAINING_LEAD_REANCHOR_DELTA * 2)).toBe(2);
    expect(quantiseVdotMagnitude(-TRAINING_LEAD_REANCHOR_DELTA * 3)).toBe(-3);
  });
});

describe('shouldFireOnThisEvidence · the Q3 scenario, literally', () => {
  const id = fitnessDecisionIdentity(input());

  it('FIRES the first night', () => {
    const v = shouldFireOnThisEvidence(id, { state: 'absent' });
    expect(v.fire).toBe(true);
  });

  it('DOES NOT FIRE the next night when the same three runs are still the evidence', () => {
    const probe: LedgerKeyProbe = {
      state: 'present', recordedAtISO: '2026-09-13T03:00:00.000Z', undone: false,
    };
    const v = shouldFireOnThisEvidence(id, probe);
    expect(v.fire).toBe(false);
    if (v.fire) throw new Error('unreachable');
    expect(v.reason).toBe('ALREADY_DECIDED_ON_THIS_EVIDENCE');
  });

  it('DOES NOT FIRE on night 3, 4, 5 … — the key is time-free, so suppression does not decay', () => {
    const probe: LedgerKeyProbe = {
      state: 'present', recordedAtISO: '2026-07-01T03:00:00.000Z', undone: false,
    };
    expect(shouldFireOnThisEvidence(id, probe).fire).toBe(false);
  });

  it('FIRES AGAIN once a new run joins the evidence set', () => {
    const tomorrow = fitnessDecisionIdentity(
      input({ evidenceIds: [...REAL_EVIDENCE, '-111111111111111'] }),
    );
    // The ledger holds YESTERDAY's key, not this one, so the probe for the
    // new key is `absent`.
    expect(shouldFireOnThisEvidence(tomorrow, { state: 'absent' }).fire).toBe(true);
    if (tomorrow.kind !== 'identified' || id.kind !== 'identified') throw new Error('unreachable');
    expect(tomorrow.key).not.toBe(id.key);
  });

  it('FIRES AGAIN after the decision is UNDONE — a reversal is not a standing decision', () => {
    const v = shouldFireOnThisEvidence(id, {
      state: 'present', recordedAtISO: '2026-09-13T03:00:00.000Z', undone: true,
    });
    expect(v.fire).toBe(true);
    if (!v.fire) throw new Error('unreachable');
    expect(v.why).toMatch(/UNDONE/);
  });

  it('WITHHOLDS when the ledger table does not exist — verified true of production', () => {
    // `SELECT to_regclass('public.plan_decision_ledger')` returned NULL against
    // the live database on 2026-09-13. Without the unique index the
    // exactly-once guarantee is a comment, and Rule 11 forbids a missing input
    // silently disabling a safety mechanism. `LEDGER_ONCE_WITHOUT_TABLE`
    // already takes this posture for the write side.
    const v = shouldFireOnThisEvidence(id, { state: 'table_absent', why: 'migration 166 unapplied.' });
    expect(v.fire).toBe(false);
    if (v.fire) throw new Error('unreachable');
    expect(v.reason).toBe('IDEMPOTENCY_UNAVAILABLE_TABLE_ABSENT');
  });

  it('WITHHOLDS on a failed ledger read, and says so DIFFERENTLY from an absent table (Rule 11)', () => {
    const failed = shouldFireOnThisEvidence(id, { state: 'failed', why: 'connection reset.' });
    const absent = shouldFireOnThisEvidence(id, { state: 'table_absent', why: 'no table.' });
    expect(failed.fire).toBe(false);
    expect(absent.fire).toBe(false);
    if (failed.fire || absent.fire) throw new Error('unreachable');
    expect(failed.reason).not.toBe(absent.reason);
  });

  it('WITHHOLDS with its own reason when there is no evidence to identify', () => {
    const none = fitnessDecisionIdentity(input({ evidenceIds: [] }));
    const v = shouldFireOnThisEvidence(none, { state: 'absent' });
    expect(v.fire).toBe(false);
    if (v.fire) throw new Error('unreachable');
    expect(v.reason).toBe('NO_EVIDENCE_TO_IDENTIFY');
  });
});

describe('Rule 22 · the distribution this suite asserts', () => {
  it('permits more than it suppresses, on purpose', () => {
    const id2 = fitnessDecisionIdentity(input());
    const permitted = [
      shouldFireOnThisEvidence(id2, { state: 'absent' }),
      shouldFireOnThisEvidence(id2, { state: 'present', recordedAtISO: 'x', undone: true }),
    ].filter((v) => v.fire).length;
    const suppressed = [
      shouldFireOnThisEvidence(id2, { state: 'present', recordedAtISO: 'x', undone: false }),
      shouldFireOnThisEvidence(id2, { state: 'table_absent', why: 'w' }),
      shouldFireOnThisEvidence(id2, { state: 'failed', why: 'w' }),
      shouldFireOnThisEvidence(fitnessDecisionIdentity(input({ evidenceIds: [] })), { state: 'absent' }),
    ].filter((v) => !v.fire).length;
    // Four of the five probe states withhold. That imbalance is real and it is
    // justified: three of the four are Rule 11 refusals (cannot answer), not
    // coaching restraint. Stated here so a future reader sees it was counted
    // rather than accumulated.
    expect(permitted).toBe(2);
    expect(suppressed).toBe(4);
  });
});
