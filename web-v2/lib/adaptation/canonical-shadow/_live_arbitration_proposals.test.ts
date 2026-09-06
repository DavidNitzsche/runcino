/**
 * lib/adaptation/canonical-shadow/_live_arbitration_proposals.test.ts · PROOF
 * 6 OF THE OVERNIGHT PRIORITY 7 REQUIREMENT — THE PERSISTENCE HALF.
 *
 * `_arbitration_six_proofs.test.ts` (in `lib/adaptation/canonical/`) proves
 * the ORDERING half of all six claims against `resolveArbitrationPriority`
 * directly. This file proves the other half of proof 6 specifically — "a
 * losing SUPPORTED proposal PERSISTS and returns later" — against
 * `persistArbitratedProposals`, which is what actually reaches
 * `plan_decision_ledger` and `reassessment_schedule`. It also proves the two
 * claims that only make sense once there is a real writer to check: that the
 * WINNER reaches the decision ledger, and that a safety-defeated push is
 * ledgered but never queued for automatic reconsideration.
 *
 * The pool is mocked, in the same pattern `_migration_probe.test.ts` already
 * uses for these exact two writers: a `query` spy keyed on the SQL text,
 * `to_regclass` answering "the table exists", and the real INSERT captured
 * for inspection. This proves ROUTING — which record goes to which writer,
 * with what payload — not that Postgres accepts the statement.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER THE UNDERLYING SQL IS CORRECT. That is `decision-ledger.ts`'s and
 *   `reassessment-scheduler.ts`'s own gates, and this file mocks the query
 *   layer beneath both.
 * · WHETHER migration 166 OR 167 IS APPLIED TO PRODUCTION. Both are mocked as
 *   present here specifically so the routing can be observed; the
 *   `table_absent` posture of both writers is proven by their own suites.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

import { persistArbitratedProposals } from './live-arbitration-proposals';
import { _resetLedgerTableProbeForTests } from '@/lib/brain/ledger/decision-ledger';
import { _resetScheduleTableProbeForTests } from '@/lib/ops/reassessment-scheduler';
import type {
  CanonicalDecisionRecord, PlanDiff, SuppressionNote,
} from '@/lib/adaptation/canonical/decision-record';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/**
 * The empty diff, restated rather than imported as a VALUE from
 * `canonical/decision-record` — a type-only import needs no seal grant, and a
 * value import (even of an inert constant) would, per `_cannot_mutate.test.ts`
 * guard 4. Cheaper to restate three fields than to open a door for a test's
 * convenience (see that file's own header on why the allowlist is narrow).
 */
const EMPTY_DIFF: PlanDiff = {
  entries: [], reachEndsISO: null, reachRule: 'no change proposed', touchesCompletedHistory: false,
};

function record(overrides: Partial<CanonicalDecisionRecord> = {}): CanonicalDecisionRecord {
  return {
    // Literal, not imported: importing `CANONICAL_ADAPTATION_CONTRACT_VERSION`
    // would be a VALUE import from `canonical/` from outside it, which needs a
    // seal grant this test has no reason to open. See the note on `EMPTY_DIFF`
    // above for the same reasoning.
    contractVersion: '1.0.0' as CanonicalDecisionRecord['contractVersion'],
    athleteId: USER,
    planVersion: 'pln_x:2026-09-01T00:00:00.000Z',
    evidenceVersion: 'ev_1',
    evaluatedAtISO: '2026-09-05T03:00:00.000Z',
    boundary: 'WEEKLY_BOUNDARY',
    idempotencyKey: `${USER}::pln_x::ev_1::WEEKLY_VOLUME::WEEKLY_BOUNDARY`,
    lever: 'WEEKLY_VOLUME',
    belief: {
      thresholdPaceSecPerMi: 420, weeklyVolumeMi: 44, longRunMi: 16,
      supportingSessionCount: 12, oldestSupportingDateISO: '2026-07-01',
    },
    race: { raceDateISO: '2026-12-06', raceDistance: 'MARATHON' },
    goal: { goalFinishSeconds: 10800, goalPaceSecPerMi: 412 },
    gap: 'volume gap',
    evidenceIncluded: [
      { activityId: 'act_1', dateISO: '2026-09-01', what: 'long run', grade: 'FULL', weight: 1 },
    ],
    evidenceExcluded: [],
    contradictory: [],
    windowDays: 21,
    confidence: {
      supportingCount: 12, contradictingCount: 0, windowDays: 21,
      sentence: 'well supported', limitation: null, rawConfidence: 0.9,
    },
    decision: 'PROGRESS',
    beforeValue: 44,
    proposedAfterValue: 47,
    magnitude: { unit: 'weekly_mi', value: 3, limit: 5, limitConstant: 'VOLUME_MAX_STEP_FRAC', limitCitation: 'x' },
    affectedWorkoutIds: ['pw_1', 'pw_2'],
    planDiff: {
      entries: [{ workoutId: 'pw_1', dateISO: '2026-09-08', field: 'distance_mi', before: 6, after: 7 }],
      reachEndsISO: '2026-09-14', reachRule: 'next boundary', touchesCompletedHistory: false,
    },
    invariants: [],
    reason: 'evidence supports a step to 47 mi',
    whatWouldChangeIt: ['a missed long run'],
    rollback: null,
    ledger: {
      options: [],
      selected: 'PUSH',
      selectedBecause: 'supported',
      reassessmentTrigger: { whenISO: null, what: 'n/a' },
      priority: {
        phase: 'BASE', posture: 'ADVANCE', order: ['WEEKLY_VOLUME', 'LONG_RUN', 'THRESHOLD_PACE'],
        citations: ['Research/00a'], why: 'base phase leads with load',
      },
    },
    suppressedBy: null,
    ...overrides,
  };
}

beforeEach(() => {
  query.mockReset();
  _resetLedgerTableProbeForTests();
  _resetScheduleTableProbeForTests();
  // Every `to_regclass` probe answers "present". Both tables, one behaviour.
  query.mockImplementation(async (sql: string) => {
    if (String(sql).includes('to_regclass')) {
      return { rows: [{ reg: 'present' }] };
    }
    if (String(sql).includes('INSERT INTO plan_decision_ledger')) {
      return { rows: [{ id: 'ledger_row_1' }] };
    }
    if (String(sql).includes('INSERT INTO reassessment_schedule')) {
      return { rows: [{ id: 'reassess_row_1' }] };
    }
    return { rows: [] };
  });
});

describe('ARBITRATION-6PROOF-6 · a losing SUPPORTED proposal persists and returns later', () => {
  it('a PROGRESS decision suppressed with a real reconsiderAtISO is queued as a DEFERRAL, '
    + 'not dropped', async () => {
    const suppressed: SuppressionNote = {
      by: 'PLAN_LOAD',
      rule: 'ONE_MATERIAL_LEVER_PER_CYCLE',
      detail: 'another lever already moved this cycle',
      reconsiderAtISO: '2026-09-12',
    };
    const r = record({ suppressedBy: suppressed, planDiff: EMPTY_DIFF, affectedWorkoutIds: [] });
    const out = await persistArbitratedProposals(USER, [r]);

    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('DEFERRED_SUPPORTED_LOSER');
    expect(out[0]!.reassessmentWrite).toBe('ok');
    expect(out[0]!.ledgerWrite).toBeNull();

    const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO reassessment_schedule'));
    expect(insertCall, 'no INSERT INTO reassessment_schedule was ever issued').toBeDefined();
    const params = insertCall![1] as unknown[];
    // user_uuid, kind, reason_code, reason_detail, assess_on_iso, ...
    expect(params[0]).toBe(USER);
    expect(params[1]).toBe('DEFERRAL');
    expect(params[2]).toBe('ONE_MATERIAL_LEVER_PER_CYCLE');
    expect(params[4]).toBe('2026-09-12');
  });

  it('the WINNER of this cycle — PROGRESS, not suppressed — is recorded on the decision '
    + 'ledger, HELD, never a plan mutation', async () => {
    const r = record({ suppressedBy: null });
    const out = await persistArbitratedProposals(USER, [r]);

    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('ARBITRATED_WINNER');
    expect(out[0]!.ledgerWrite).toBe('written');
    expect(out[0]!.reassessmentWrite).toBeNull();

    const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO plan_decision_ledger'));
    expect(insertCall, 'no INSERT INTO plan_decision_ledger was ever issued').toBeDefined();
    // authority_verdict is column 12 in ledgerInsertSql's own column order;
    // asserted by VALUE search instead of position, so this survives that
    // file reordering its own columns.
    expect(insertCall![1]).toContain('HELD');
    expect(insertCall![1]).not.toContain('PERMITTED');
  });

  it('SAFETY defeats the push — ledgered as a HOLD, but NEVER queued for automatic '
    + 'reconsideration, because reconsiderAtISO is null by construction for every safety basis', async () => {
    const suppressed: SuppressionNote = {
      by: 'PLAN_LOAD',
      rule: 'SAFETY_HARD_STOP',
      detail: 'the Safety owner has raised a hard stop',
      reconsiderAtISO: null,
    };
    const r = record({ suppressedBy: suppressed, planDiff: EMPTY_DIFF });
    const out = await persistArbitratedProposals(USER, [r]);

    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('SAFETY_HELD_NOT_QUEUED');
    expect(out[0]!.ledgerWrite).toBe('written');
    expect(out[0]!.reassessmentWrite).toBeNull();

    const scheduleCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO reassessment_schedule'));
    expect(scheduleCall, 'a safety-defeated push must never be scheduled for automatic reconsideration')
      .toBeUndefined();
  });

  it('a HOLD/REGRESS/REFUSE decision is NOT_APPLICABLE and touches neither writer — '
    + 'arbitration only has an opinion about competing PROGRESS decisions', async () => {
    const r = record({ decision: 'HOLD', suppressedBy: null });
    const out = await persistArbitratedProposals(USER, [r]);
    expect(out[0]!.kind).toBe('NOT_APPLICABLE');
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT'))).toBe(false);
  });
});
