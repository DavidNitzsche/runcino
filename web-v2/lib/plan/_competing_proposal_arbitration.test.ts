/**
 * lib/plan/_competing_proposal_arbitration.test.ts · COMPETINGPROPOSAL-1 ·
 * ARBITRATION, NOT SILENCE.
 *
 * David, verbatim: "'Silently skipped by dedup' is not arbitration. Competing
 * proposals need a durable winner, loser, reason and reassessment date."
 *
 * Before `arbitrateCompetingWorkoutProposal` existed, `writeWorkoutProposals`
 * answered a second action targeting a workout that already had a pending
 * proposal with a bare `if (dup) continue` — no record of what was skipped,
 * why, or when it would be looked at again. This proves the replacement
 * against both branches:
 *
 *   · DEFER_INCOMING — the ordinary case. `reassessment_schedule` gets a real
 *     row (kind 'DEFERRAL'), naming which proposal it lost to and when to ask
 *     again. No plan_workout_proposals row is touched.
 *   · SUPERSEDE_EXISTING — an evidenced safety decline against a workout
 *     currently holding a pending `mark_upgrade` (a push) retires the push
 *     (`status='superseded'`) and ledgers it (`decision:'HOLD'`), per the
 *     standing "SAFETY defeats every PUSH" rule.
 *
 * The pool is mocked, in the same pattern
 * `lib/adaptation/canonical-shadow/_live_arbitration_proposals.test.ts`
 * already uses for these exact two writers: `to_regclass` answers "the table
 * exists" so routing can be observed without a live database, and the real
 * statements are captured for inspection. This proves ROUTING — which write
 * happens, with what payload — not that Postgres accepts the statement; that
 * is `decision-ledger.ts`'s and `reassessment-scheduler.ts`'s own gates.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER THE SUPERSEDE PRECEDENCE RULE ITSELF IS THE RIGHT COACHING CALL.
 *   That is CLAUDE.md's own "SAFETY defeats every PUSH, no exception, ever" —
 *   this file trusts it and tests the WIRING of it at workout granularity.
 * · WHETHER migration 166 OR 167 IS APPLIED TO PRODUCTION. Neither is; both
 *   writers' own suites prove the `table_absent` posture separately, and this
 *   file mocks both as present so the routing itself is what is on trial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

import { arbitrateCompetingWorkoutProposal } from './workout-proposals';
import { _resetLedgerTableProbeForTests } from '@/lib/brain/ledger/decision-ledger';
import { _resetScheduleTableProbeForTests } from '@/lib/ops/reassessment-scheduler';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const WORKOUT = 'wko_test0000000000000';

function existing(overrides: Partial<{ id: number; action_kind: string; created_at: Date }> = {}) {
  return { id: 42, action_kind: 'downgrade', created_at: new Date('2026-09-01T00:00:00Z'), ...overrides };
}

beforeEach(() => {
  query.mockReset();
  _resetLedgerTableProbeForTests();
  _resetScheduleTableProbeForTests();
  query.mockImplementation(async (sql: string, params?: unknown[]) => {
    const s = String(sql);
    if (s.includes('to_regclass')) return { rows: [{ reg: 'present' }] };
    if (s.startsWith('UPDATE plan_workout_proposals')) {
      // Simulate the row being found and updated, unless the test overrides
      // the mock to simulate a race (see the race-fallback test below).
      return { rows: [{ id: (params as unknown[])[0] }] };
    }
    if (s.startsWith('INSERT INTO plan_decision_ledger')) {
      return { rows: [{ id: 'ledger-row-1' }] };
    }
    if (s.startsWith('INSERT INTO reassessment_schedule')) {
      return { rows: [{ id: 'reassess-row-1' }] };
    }
    throw new Error(`unexpected query in test: ${s.slice(0, 80)}`);
  });
});

describe('arbitrateCompetingWorkoutProposal · DEFER_INCOMING (the ordinary case)', () => {
  it('never touches plan_workout_proposals, and schedules a real, reasoned reassessment', async () => {
    const outcome = await arbitrateCompetingWorkoutProposal({
      userUuid: USER,
      workoutId: WORKOUT,
      dateISO: '2026-09-10',
      todayISO: '2026-09-07',
      incomingKind: 'downgrade',
      incomingWhy: 'sleep duration down 90 minutes for 4 consecutive nights',
      incomingIsEvidencedSafetyDecline: true,
      existing: existing({ action_kind: 'downgrade' }), // NOT a push · no override applies
    });

    expect(outcome.outcome).toBe('DEFER_INCOMING');
    expect(outcome.ledgerWrite).toBeNull();
    expect(outcome.reassessmentWrite).toBe('ok');

    const insertCall = query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO reassessment_schedule'));
    expect(insertCall, 'no INSERT INTO reassessment_schedule was ever issued').toBeDefined();
    const params = insertCall![1] as unknown[];
    // kind, reason_code, reason_detail are params 2, 3, 4 (1-indexed $2 $3 $4)
    expect(params[1]).toBe('DEFERRAL');
    expect(params[2]).toBe('competing_workout_proposal');
    const reasonDetail = String(params[3]);
    expect(reasonDetail).toContain('#42');
    expect(reasonDetail).toContain('downgrade');

    // No plan_workout_proposals write of any kind for this branch.
    const proposalsTouch = query.mock.calls.find((c) => String(c[0]).includes('plan_workout_proposals'));
    expect(proposalsTouch, 'DEFER_INCOMING must never touch plan_workout_proposals').toBeUndefined();
  });

  it('carries a real reassessment date, not a null promise', async () => {
    const outcome = await arbitrateCompetingWorkoutProposal({
      userUuid: USER,
      workoutId: WORKOUT,
      dateISO: '2026-09-10',
      todayISO: '2026-09-07',
      incomingKind: 'shave',
      incomingWhy: 'ACWR crossed 1.3 three times in the past 30 days',
      incomingIsEvidencedSafetyDecline: false, // 'shave' still reduces load, but this flag names it
      existing: existing(),
    });
    expect(outcome.outcome).toBe('DEFER_INCOMING');
    const insertCall = query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO reassessment_schedule'));
    const params = insertCall![1] as unknown[];
    // assess_on_iso is param 5 ($5)
    expect(params[4]).toBe('2026-09-21'); // today + PROPOSAL_UNANSWERED_EXPIRY_DAYS (14)
  });
});

describe('arbitrateCompetingWorkoutProposal · SUPERSEDE_EXISTING (safety defeats a pending push)', () => {
  it('retires the pending push and ledgers it as HELD, never as a scheduled reassessment', async () => {
    const outcome = await arbitrateCompetingWorkoutProposal({
      userUuid: USER,
      workoutId: WORKOUT,
      dateISO: '2026-09-10',
      todayISO: '2026-09-07',
      incomingKind: 'downgrade',
      incomingWhy: 'HRV down 5 days running and resting heart rate elevated 8bpm above baseline',
      incomingIsEvidencedSafetyDecline: true,
      existing: existing({ id: 7, action_kind: 'mark_upgrade' }),
    });

    expect(outcome.outcome).toBe('SUPERSEDE_EXISTING');
    expect(outcome.ledgerWrite).toBe('written');
    expect(outcome.reassessmentWrite).toBeNull(); // safety lifts it, never a scheduled date

    const updateCall = query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE plan_workout_proposals'));
    expect(updateCall, 'the pending push was never retired').toBeDefined();
    expect(String(updateCall![0])).toContain("status = 'superseded'");
    expect(String(updateCall![0])).toContain("AND status = 'pending'"); // guarded, never blind

    const ledgerCall = query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO plan_decision_ledger'));
    expect(ledgerCall, 'the retired push was never ledgered').toBeDefined();

    // No reassessment write for this branch — it is exempt by construction:
    // safety lifts it, not a date (mirrors SAFETY_HELD_NOT_QUEUED).
    const reassessCall = query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO reassessment_schedule'));
    expect(reassessCall).toBeUndefined();
  });

  it('does NOT override a non-push (two declines competing stay DEFER_INCOMING)', async () => {
    const outcome = await arbitrateCompetingWorkoutProposal({
      userUuid: USER,
      workoutId: WORKOUT,
      dateISO: '2026-09-10',
      todayISO: '2026-09-07',
      incomingKind: 'downgrade',
      incomingWhy: 'HRV down 5 days running',
      incomingIsEvidencedSafetyDecline: true,
      existing: existing({ action_kind: 'downgrade' }), // not a push
    });
    expect(outcome.outcome).toBe('DEFER_INCOMING');
  });

  it('does NOT override a push with an UNEVIDENCED decline', async () => {
    const outcome = await arbitrateCompetingWorkoutProposal({
      userUuid: USER,
      workoutId: WORKOUT,
      dateISO: '2026-09-10',
      todayISO: '2026-09-07',
      incomingKind: 'downgrade',
      incomingWhy: 'feels aggressive',
      incomingIsEvidencedSafetyDecline: false, // caller already ran describesEvidence and it failed
      existing: existing({ action_kind: 'mark_upgrade' }),
    });
    expect(outcome.outcome).toBe('DEFER_INCOMING');
  });

  it('falls through to a real DEFER, never a silent no-op, when the push was already resolved by a race', async () => {
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('to_regclass')) return { rows: [{ reg: 'present' }] };
      if (s.startsWith('UPDATE plan_workout_proposals')) return { rows: [] }; // raced · nothing to retire
      if (s.startsWith('INSERT INTO reassessment_schedule')) return { rows: [{ id: 'reassess-row-1' }] };
      throw new Error(`unexpected query in test: ${s.slice(0, 80)}`);
    });

    const outcome = await arbitrateCompetingWorkoutProposal({
      userUuid: USER,
      workoutId: WORKOUT,
      dateISO: '2026-09-10',
      todayISO: '2026-09-07',
      incomingKind: 'downgrade',
      incomingWhy: 'HRV down 5 days running and resting heart rate elevated 8bpm above baseline',
      incomingIsEvidencedSafetyDecline: true,
      existing: existing({ id: 7, action_kind: 'mark_upgrade' }),
    });

    // The old shape (a bare early return with nulls) would have made this
    // indistinguishable from "nothing happened". It must still be a real,
    // durable, reasoned record — this is the assertion that falsifies that
    // regression if it comes back.
    expect(outcome.outcome).toBe('DEFER_INCOMING');
    expect(outcome.reassessmentWrite).toBe('ok');
    expect(outcome.detail).toContain('no longer pending');

    // And the fact of the race is itself recorded, not swallowed — it rides
    // along in the reassessment row so a reader can tell this apart from an
    // ordinary defer.
    const insertCall = query.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO reassessment_schedule'));
    const params = insertCall![1] as unknown[];
    expect(String(params[3])).toContain('no longer pending'); // reason_detail
  });
});
