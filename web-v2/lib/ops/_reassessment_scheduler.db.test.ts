/**
 * lib/ops/_reassessment_scheduler.db.test.ts · A PROMISE SURVIVES THE PROCESS
 * THAT MADE IT, PROVEN AGAINST A REAL TABLE.
 *
 * `_reassessment_scheduler.test.ts` proves the vocabulary, the retry policy and
 * the Rule 23 posture with no database. It cannot prove the one thing the
 * scheduler exists for: that a deferred progression, an earning gate or an
 * unanswered proposal is still there tomorrow. Only a real table can.
 *
 * ── IT NEVER TOUCHES PRODUCTION, AND IT SAYS SO WHEN IT SKIPS ──────────────
 *
 * `DATABASE_URL` must parse, name a LOOPBACK host, and name the database
 * `faff_ledger_scratch`. The production write barrier from `vitest.setup.ts` is
 * NOT disabled; it is the backstop, not the gate. When the check fails the
 * suite SKIPS AND PRINTS WHY, because reporting clean while looking at nothing
 * also reports confidence (Rule 18). Run it with:
 *
 *     createdb faff_ledger_scratch
 *     psql -d faff_ledger_scratch -f web-v2/db/migrations/167_reassessment_schedule.sql
 *     DATABASE_URL=postgresql://localhost/faff_ledger_scratch \
 *       npx vitest run lib/ops/_reassessment_scheduler.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER ANYTHING EVER SCHEDULES AN ITEM. It exercises the store directly.
 *   `scripts/check-decision-ledger.sh` guard 2 is the half that fails when a
 *   deferred action is produced with no durable row behind it.
 * · WHETHER THE SWEEP RUNS ON A SCHEDULE. It calls `sweepReassessments`
 *   directly. Whether GitHub Actions fires the cron that calls it is exactly
 *   what Rule 23 says never to assume, and `cron_stale` is that half.
 * · WHETHER THE OVERDUE ALERT REACHES A HUMAN. `raiseAlert` writes `ops_alerts`,
 *   which does not exist on the scratch database, so the alert path here is
 *   exercised only to the point of failing soft — deliberately, since a
 *   scheduler that dies because its alert table is missing would be worse than
 *   the miss it was reporting.
 * · WHETHER THE EVALUATOR RE-ASKS THE QUESTION. Promotion to DUE is where this
 *   file's responsibility ends.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  scheduleReassessment,
  loadLiveQueue,
  loadDueItems,
  markDue,
  resolveReassessment,
  recordAssessmentFailure,
  sweepReassessments,
  MAX_ATTEMPTS,
  REASSESSMENT_KINDS,
  _resetScheduleTableProbeForTests,
  type ScheduleRequest,
} from './reassessment-scheduler';

const SCRATCH_DB = 'faff_ledger_scratch';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function scratchVerdict(url: string | undefined, label: string): string | null {
  if (!url) return `${label} is not set`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return `${label} is not a parseable URL`; }
  if (!LOOPBACK.has(parsed.hostname)) {
    return `${label} points at host '${parsed.hostname}', which is not loopback`;
  }
  const db = parsed.pathname.replace(/^\//, '');
  if (db !== SCRATCH_DB) return `${label} names database '${db}', not '${SCRATCH_DB}'`;
  return null;
}

const refusals = [scratchVerdict(process.env.DATABASE_URL, 'DATABASE_URL')]
  .filter((x): x is string => x !== null);
const REACHABLE = refusals.length === 0;

const RUNNER = randomUUID();
const TODAY = '2026-09-20';

const req = (over: Partial<ScheduleRequest> = {}): ScheduleRequest => ({
  userUuid: RUNNER,
  kind: 'DEFERRAL',
  reasonCode: 'WEEK_AT_DEMAND_CEILING',
  reasonDetail:
    'The threshold evidence supports this change, but this week already contains enough total '
    + 'demand, so the change is deferred until the next appropriate boundary.',
  assessOnISO: '2026-09-21',
  overdueAfterISO: null,
  requiredEvidence: [{ need: 'one completed threshold session inside the evidence window' }],
  evidence: [{ activityId: 'run-1' }],
  newestEvidenceISO: '2026-09-14',
  planId: 'pln_a',
  planLineageId: 'pln_a',
  planVersion: 'pln_a:2026-09-14',
  evidenceVersion: 'ev-1',
  modelVersion: 'canonical/1',
  lever: 'THRESHOLD_PACE',
  beforeValue: 442,
  proposedAfterValue: 439,
  magnitude: { unit: 'sec_per_mi', value: -3 },
  payload: {},
  idempotencyKey: `key-${randomUUID()}`,
  queuedAtISO: '2026-09-14',
  ...over,
});

describe('liveness · the scratch database was reachable, or the reason is printed', () => {
  it('says which it is, out loud', () => {
    if (!REACHABLE) {
      // eslint-disable-next-line no-console
      console.warn(
        '[reassessment-scheduler.db] SKIPPED · this suite proved NOTHING about durability. '
        + refusals.join('; ')
        + ". See this file's header for how to run it against a local scratch database.",
      );
    }
    expect(REACHABLE || refusals.length > 0).toBe(true);
  });
});

describe.skipIf(!REACHABLE)('a promise survives the process that made it', () => {
  beforeAll(() => { _resetScheduleTableProbeForTests(); });

  it('the table is there and the queue starts MEASURED EMPTY, not absent', async () => {
    const q = await loadLiveQueue(RUNNER);
    expect(q.state, q.state === 'ok' ? '' : JSON.stringify(q)).toBe('ok');
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(q.value).toEqual([]);
  });

  it('ALL SEVEN KINDS persist, so no promise is second class', async () => {
    // Rule 22 · check the distribution, not just the count. A store that only
    // ever holds deferrals is the third-queue problem wearing a new name.
    for (const kind of REASSESSMENT_KINDS) {
      const r = await scheduleReassessment(req({
        kind, idempotencyKey: `all-kinds-${kind}`, reasonCode: `${kind}_QUEUED`,
      }));
      expect(r.state, `${kind} did not persist: ${JSON.stringify(r)}`).toBe('ok');
    }
    const q = await loadLiveQueue(RUNNER);
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(new Set(q.value.map((i) => i.kind))).toEqual(new Set(REASSESSMENT_KINDS));
  });

  it('an item reads back with its reason, its required evidence and its plan version', async () => {
    const q = await loadLiveQueue(RUNNER, 'DEFERRAL');
    if (q.state !== 'ok') throw new Error('unreachable');
    const item = q.value.find((i) => i.idempotencyKey === 'all-kinds-DEFERRAL');
    expect(item).toBeDefined();
    expect(item!.reasonDetail).toContain('enough total demand');
    expect(item!.requiredEvidence).toEqual([
      { need: 'one completed threshold session inside the evidence window' },
    ]);
    expect(item!.planVersion).toBe('pln_a:2026-09-14');
    expect(item!.beforeValue).toBe(442);
    expect(item!.attempts).toBe(0);
    expect(item!.lastError).toBeNull();
  });

  it('re-queueing the same identity REFRESHES the row rather than growing the queue', async () => {
    const before = await loadLiveQueue(RUNNER);
    if (before.state !== 'ok') throw new Error('unreachable');
    await scheduleReassessment(req({
      kind: 'DEFERRAL', idempotencyKey: 'all-kinds-DEFERRAL',
      reasonDetail: 'refreshed on a later boundary', assessOnISO: '2026-09-25',
    }));
    const after = await loadLiveQueue(RUNNER);
    if (after.state !== 'ok') throw new Error('unreachable');
    expect(after.value.length).toBe(before.value.length);
    const item = after.value.find((i) => i.idempotencyKey === 'all-kinds-DEFERRAL');
    expect(item!.reasonDetail).toBe('refreshed on a later boundary');
    expect(item!.assessOnISO).toBe('2026-09-25');
  });
});

describe.skipIf(!REACHABLE)('RULE 23 clause 2 · lateness is harmless', () => {
  const lateRunner = randomUUID();

  beforeAll(async () => {
    await scheduleReassessment(req({
      userUuid: lateRunner, kind: 'POST_RACE_RECOVERY_CHECK',
      idempotencyKey: 'late-1', assessOnISO: '2026-09-10',
    }));
  });

  it('a sweep run TEN DAYS LATE finds the same item and does the same thing', async () => {
    const due = await loadDueItems(TODAY);
    if (due.state !== 'ok') throw new Error('unreachable');
    expect(due.value.some((i) => i.idempotencyKey === 'late-1')).toBe(true);

    const first = await sweepReassessments(TODAY);
    expect(first.refusal).toBeNull();
    expect(first.examined).toBeGreaterThan(0);
  });

  it('a SECOND sweep does the work once — every transition is guarded', async () => {
    const second = await sweepReassessments(TODAY);
    expect(second.refusal).toBeNull();
    // Everything due is already DUE, so nothing is promoted a second time.
    expect(second.promoted).toBe(0);
  });

  it('an item not yet due is NOT swept, however late the sweep is', async () => {
    const future = randomUUID();
    await scheduleReassessment(req({
      userUuid: future, kind: 'EARNING_GATE', idempotencyKey: 'future-1',
      assessOnISO: '2027-01-01',
    }));
    const due = await loadDueItems(TODAY);
    if (due.state !== 'ok') throw new Error('unreachable');
    expect(due.value.some((i) => i.idempotencyKey === 'future-1')).toBe(false);
    const q = await loadLiveQueue(future);
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(q.value[0].status).toBe('PENDING');
  });

  it('markDue is idempotent · promoting an already-DUE item changes nothing', async () => {
    const q = await loadLiveQueue(lateRunner);
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(q.value[0].status).toBe('DUE');
    const again = await markDue(q.value[0].id);
    expect(again.state).toBe('ok');
    if (again.state !== 'ok') throw new Error('unreachable');
    expect(again.value).toBe(false);
  });
});

describe.skipIf(!REACHABLE)('an unanswered proposal does not stand forever', () => {
  const proposalRunner = randomUUID();

  it('a PROPOSAL_EXPIRATION past its deadline is expired WITH ITS REASON', async () => {
    // The "forced goal decision" failure in slow motion: a proposal the runner
    // never answered being treated as one he did.
    await scheduleReassessment(req({
      userUuid: proposalRunner, kind: 'PROPOSAL_EXPIRATION',
      idempotencyKey: 'prop-1', assessOnISO: '2026-09-12',
      overdueAfterISO: '2026-09-19',
      reasonCode: 'AWAITING_RUNNER',
      reasonDetail: 'a volume proposal raised on 2026-09-12 and not yet answered',
    }));
    const sweep = await sweepReassessments(TODAY);
    expect(sweep.refusal).toBeNull();
    expect(sweep.expired).toBeGreaterThan(0);

    const q = await loadLiveQueue(proposalRunner);
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(q.value, 'the expired proposal is still live').toEqual([]);
  });

  it('the expired row is KEPT, with what came of it', async () => {
    // Rows are never deleted: "retired because nobody answered" and "silently
    // vanished" are different facts and only one survives a DELETE.
    const { pool } = await import('@/lib/db/pool');
    const r = await pool.query<{
      status: string; resulting_decision: string; resulting_decision_detail: string;
    }>(
      `SELECT status, resulting_decision, resulting_decision_detail
         FROM reassessment_schedule WHERE user_uuid = $1::uuid`,
      [proposalRunner],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].status).toBe('EXPIRED');
    expect(r.rows[0].resulting_decision).toBe('PROPOSAL_EXPIRED_UNANSWERED');
    expect(r.rows[0].resulting_decision_detail).toContain('It was not applied.');
  });

  it('a NON-proposal past its deadline is NOT auto-dropped — it is a defect to raise', async () => {
    // Only the proposal kind is auto-expired. Everything else past its date is
    // something to alert on, never a promise to quietly retire.
    const stuck = randomUUID();
    await scheduleReassessment(req({
      userUuid: stuck, kind: 'RETURN_TO_TRAINING_STAGE', idempotencyKey: 'stuck-1',
      assessOnISO: '2026-09-01', overdueAfterISO: '2026-09-05',
    }));
    const sweep = await sweepReassessments(TODAY);
    expect(sweep.overdue).toBeGreaterThan(0);
    const q = await loadLiveQueue(stuck);
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(q.value, 'an overdue return-to-training stage was silently dropped').toHaveLength(1);
  });

  it('re-queueing an identity that was RESOLVED opens a NEW live row, history intact', async () => {
    await scheduleReassessment(req({
      userUuid: proposalRunner, kind: 'PROPOSAL_EXPIRATION', idempotencyKey: 'prop-1',
      assessOnISO: '2026-10-01',
    }));
    const { pool } = await import('@/lib/db/pool');
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM reassessment_schedule WHERE user_uuid = $1::uuid ORDER BY created_at`,
      [proposalRunner],
    );
    expect(r.rows.map((x) => x.status)).toEqual(['EXPIRED', 'PENDING']);
  });
});

describe.skipIf(!REACHABLE)('RULE 11 · a failed assessment is a state, not an absence', () => {
  const failRunner = randomUUID();
  let itemId = '';

  beforeAll(async () => {
    const r = await scheduleReassessment(req({
      userUuid: failRunner, kind: 'FAILED_EVALUATION', idempotencyKey: 'fail-1',
      assessOnISO: '2026-09-15',
    }));
    if (r.state !== 'ok') throw new Error('could not queue the failure fixture');
    itemId = r.value;
  });

  it('a failure records the error and schedules a retry, and the item stays LIVE', async () => {
    const out = await recordAssessmentFailure(itemId, 'the evidence loader threw ECONNRESET');
    expect(out.state).toBe('ok');
    if (out.state !== 'ok') throw new Error('unreachable');
    expect(out.value).toBe('retrying');

    const q = await loadLiveQueue(failRunner);
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(q.value[0].attempts).toBe(1);
    expect(q.value[0].lastError).toContain('ECONNRESET');
    expect(q.value[0].nextRetryAt).toBeTruthy();
  });

  it('an item inside its backoff is NOT in the due set, but is still in the live queue', async () => {
    // Three states, kept apart: due, waiting to retry, and gone.
    const due = await loadDueItems(TODAY);
    if (due.state !== 'ok') throw new Error('unreachable');
    expect(due.value.some((i) => i.id === itemId)).toBe(false);
    const q = await loadLiveQueue(failRunner);
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(q.value.some((i) => i.id === itemId)).toBe(true);
  });

  it('past the retry budget the item becomes FAILED — loud, terminal, and not invisible', async () => {
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      await recordAssessmentFailure(itemId, `attempt ${i + 1} broke the same way`);
    }
    const q = await loadLiveQueue(failRunner);
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(q.value, 'a permanently failing item is still being retried').toEqual([]);

    const { pool } = await import('@/lib/db/pool');
    const r = await pool.query<{
      status: string; attempts: number; last_error: string; resulting_decision_detail: string;
    }>(
      `SELECT status, attempts, last_error, resulting_decision_detail
         FROM reassessment_schedule WHERE id = $1::uuid`,
      [itemId],
    );
    expect(r.rows[0].status).toBe('FAILED');
    expect(Number(r.rows[0].attempts)).toBe(MAX_ATTEMPTS);
    expect(r.rows[0].last_error).toContain('broke the same way');
    expect(r.rows[0].resulting_decision_detail).toContain('retry budget');
  });

  it('recording a failure against a terminal item is a NO-OP, distinguishable from a retry', async () => {
    const out = await recordAssessmentFailure(itemId, 'too late');
    expect(out.state).toBe('ok');
    if (out.state !== 'ok') throw new Error('unreachable');
    expect(out.value).toBe('not_live');
  });
});

describe.skipIf(!REACHABLE)('the DATABASE ITSELF refuses an item that cannot explain itself', () => {
  const raw = async (sql: string, params: unknown[]) => {
    const { pool } = await import('@/lib/db/pool');
    return pool.query(sql, params);
  };
  const constraintRunner = randomUUID();
  let id = '';

  beforeAll(async () => {
    const r = await scheduleReassessment(req({
      userUuid: constraintRunner, kind: 'CONDITIONAL_DOSE', idempotencyKey: 'con-1',
    }));
    if (r.state !== 'ok') throw new Error('could not queue the constraint fixture');
    id = r.value;
  });

  it('a terminal status with no stated outcome is refused by the CHECK', async () => {
    await expect(raw(
      `UPDATE reassessment_schedule SET status = 'EXPIRED', resolved_at = now()
        WHERE id = $1::uuid`,
      [id],
    )).rejects.toThrow(/reassessment_schedule_terminal_is_explained/);
  });

  it('a FAILED status with no error is refused', async () => {
    await expect(raw(
      `UPDATE reassessment_schedule
          SET status = 'FAILED', resolved_at = now(),
              resulting_decision = 'x', resulting_decision_detail = 'y'
        WHERE id = $1::uuid`,
      [id],
    )).rejects.toThrow(/reassessment_schedule_failure_names_its_error/);
  });

  it('an attempt count with no attempt time is refused', async () => {
    await expect(raw(
      `UPDATE reassessment_schedule SET attempts = 3 WHERE id = $1::uuid`,
      [id],
    )).rejects.toThrow(/reassessment_schedule_attempts_are_timed/);
  });

  it('resolveReassessment refuses an EMPTY detail before it reaches the wire', async () => {
    const r = await resolveReassessment({
      id, status: 'RESOLVED', decision: 'TAKEN', detail: '  ',
    });
    expect(r.state).toBe('failed');
    if (r.state !== 'failed') throw new Error('unreachable');
    expect(r.why).toContain('states why');
  });

  it('ORACLE · a well-formed resolution IS accepted, so the constraints are not simply closed', async () => {
    const r = await resolveReassessment({
      id, status: 'RESOLVED', decision: 'TAKEN',
      detail: 'the condition held at the assessment date and the dose was offered',
    });
    expect(r.state).toBe('ok');
    if (r.state !== 'ok') throw new Error('unreachable');
    expect(r.value).toBe(true);
  });

  it('resolving an already-resolved item is a NO-OP, never a rewrite of the first answer', async () => {
    const again = await resolveReassessment({
      id, status: 'EXPIRED', decision: 'SOMETHING_ELSE',
      detail: 'a later pass trying to overwrite the first resolution',
    });
    expect(again.state).toBe('ok');
    if (again.state !== 'ok') throw new Error('unreachable');
    expect(again.value, 'a later pass rewrote the first resolution').toBe(false);

    const { pool } = await import('@/lib/db/pool');
    const r = await pool.query<{ resulting_decision: string }>(
      `SELECT resulting_decision FROM reassessment_schedule WHERE id = $1::uuid`, [id],
    );
    expect(r.rows[0].resulting_decision).toBe('TAKEN');
  });
});
