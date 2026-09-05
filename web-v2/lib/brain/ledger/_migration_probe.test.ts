/**
 * MIGRATIONPROBE-1 · THE TABLE-EXISTENCE PROBE, WHICH GATES THE ROLLOUT.
 *
 * Three modules probe whether a migration has been applied before they write:
 * the decision ledger, the reassessment scheduler and the shadow deferral
 * store. All three had the same eight-line function and the same two defects,
 * and both defects only bite DURING A MIGRATION — which is exactly when nobody
 * is watching a log line about a table probe.
 *
 * 1 · a failed probe cached as "absent", permanently (Rule 11: the read failed
 *     and the table is not there are different facts, on the one function whose
 *     job is to tell them apart);
 * 2 · a definite "absent" cached across the migration, so a process started
 *     before the DDL keeps answering absent after the table exists.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *   · Whether the migration itself is correct. It checks the code's reaction to
 *     the table appearing, not the table.
 *   · Whether anything CALLS these writers. That is the ledger gate's question.
 *   · Real connection behaviour. The pool is mocked, so this proves the caching
 *     policy and not that `to_regclass` works.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

import {
  recordDecision, _resetLedgerTableProbeForTests,
} from './decision-ledger';

const ENTRY = {
  userUuid: '0645f40c-951d-4ccc-b86e-9979cd26c795',
  planId: 'pln_x', planLineageId: 'pln_x', replacedPlanId: null, planVersion: 'pln_x:none',
  scope: 'WORKOUT' as const, workoutIds: ['pw_1'], fromISO: '2026-09-22', toISO: '2026-09-22',
  lever: 'THRESHOLD_PACE', direction: 'HOLD' as const,
  evidence: {}, provenance: 'CALCULATED_PHYSIOLOGY', sourceMode: 'DIRECT',
  beforeState: {}, afterState: {},
  authority: 'RUNNER_ACCEPTED', authorityVerdict: 'permitted', hold: null,
  decision: 'HOLD', proposalId: null, proposal: null,
  runnerResponse: null, respondedAt: null,
  mutationOutcome: 'applied', mutationViolations: [],
  explanation: 'x', modelVersion: '1', idempotencyKey: 'k1',
};

const absent = () => ({ rows: [{ reg: null }] });
const present = () => ({ rows: [{ reg: 'plan_decision_ledger' }] });

beforeEach(() => { query.mockReset(); _resetLedgerTableProbeForTests(); vi.useRealTimers(); });

describe('MIGRATIONPROBE-1 · a failed probe is not an answer', () => {
  it('does not cache a thrown probe as "table absent"', async () => {
    // The defect: one connection blip and this process reports `table_absent`
    // for its whole life — a clean, confident, wrong answer, on the day the
    // migration lands.
    query.mockRejectedValueOnce(new Error('connection terminated'));
    const first = await recordDecision(ENTRY as never);
    // Rule 11 all the way through: a probe that could not run reports FAILED,
    // not `table_absent`. Reporting "the migration has not been applied"
    // because the connection blinked is the same collapse one level up, and it
    // is the sentence an operator would act on during a rollout.
    expect(first.state).toBe('failed');
    if (first.state === 'failed') expect(first.why).toContain('UNKNOWN');

    query.mockResolvedValueOnce(present());
    query.mockResolvedValueOnce({ rows: [{ id: 'led_1' }] });
    const second = await recordDecision(ENTRY as never);
    expect(second.state, 'a failed probe was cached and the ledger stayed dark')
      .toBe('written');
  });
});

describe('MIGRATIONPROBE-1 · a definite absence is re-probed', () => {
  it('notices the table appearing under a running process', async () => {
    vi.useFakeTimers();
    query.mockResolvedValueOnce(absent());
    expect((await recordDecision(ENTRY as never)).state).toBe('table_absent');

    // The migration is applied. The process is NOT restarted — which is the
    // whole point, because the packet permits deploying the code first.
    vi.advanceTimersByTime(61_000);
    query.mockResolvedValueOnce(present());
    query.mockResolvedValueOnce({ rows: [{ id: 'led_1' }] });
    const after = await recordDecision(ENTRY as never);
    expect(after.state, 'the table exists and this process still says it does not')
      .toBe('written');
    vi.useRealTimers();
  });

  it('does not re-probe on every write while it is genuinely absent', async () => {
    // The cooldown is the reason caching existed at all. Removing it would ask
    // the database twice per decision forever.
    query.mockResolvedValue(absent());
    await recordDecision(ENTRY as never);
    await recordDecision(ENTRY as never);
    await recordDecision(ENTRY as never);
    expect(query.mock.calls.length).toBe(1);
  });

  it('records a PUSH through the same path it records a HOLD', async () => {
    /* Rule 22, applied to this file by its own gate. My fixtures were all
     * `direction: 'HOLD'`, and the verdict-coverage scanner counted them —
     * correctly. A test suite whose every ledger entry declines is an instance
     * of the disposition Rule 21 measured at "309 intents, zero upward", and I
     * had reproduced it while writing the gate for the ledger that exists to
     * make that measurable.
     *
     * So the probe is exercised on a PUSH too, which is the case that actually
     * matters: an upward decision lost to a cached probe is the one nobody
     * would notice was missing. */
    query.mockResolvedValueOnce(present());
    query.mockResolvedValueOnce({ rows: [{ id: 'led_push' }] });
    const push = await recordDecision({ ...ENTRY, direction: 'UP', decision: 'PUSH' } as never);
    expect(push.state).toBe('written');
  });

  it('caches a present table permanently and stops probing', async () => {
    query.mockResolvedValueOnce(present());
    query.mockResolvedValue({ rows: [{ id: 'led_1' }] });
    await recordDecision(ENTRY as never);
    await recordDecision(ENTRY as never);
    const probes = query.mock.calls.filter((c) => String(c[0]).includes('to_regclass'));
    expect(probes.length).toBe(1);
  });
});
