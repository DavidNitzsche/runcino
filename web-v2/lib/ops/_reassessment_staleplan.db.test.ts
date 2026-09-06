/**
 * lib/ops/_reassessment_staleplan.db.test.ts · STALEPLAN-1, PROVEN AGAINST A
 * REAL `training_plans` ROW — NOT JUST THE CALL-SITE SCAN.
 *
 * `_reassessment_scheduler.test.ts`'s STALEPLAN-1 gate proves both
 * `clearActivePlansFor` implementations CALL
 * `supersedeReassessmentsForArchivedPlans`. It cannot prove the SQL that call
 * runs is actually correct — a source scan sees a call site, not a join
 * predicate. This file does the second half: a live PENDING item scheduled
 * against a real plan, that plan archived, `supersedeReassessmentsForArchivedPlans`
 * called directly (the same function both rebuild paths call), and the item
 * read back ABANDONED with its reason.
 *
 * ── WHY `faff_roundtrip_scratch`, NOT `faff_ledger_scratch` ────────────────
 *
 * `faff_ledger_scratch` (used by `_reassessment_scheduler.db.test.ts` and the
 * seven-kinds restart proof) carries only `reassessment_schedule` and
 * `plan_decision_ledger` — enough to prove the scheduler's own vocabulary, not
 * enough to prove a join against a real `training_plans` row, which needs
 * `users` too (the FK `training_plans_user_uuid_fkey`). `faff_roundtrip_scratch`
 * is the full production schema, read-only-dumped and never data-populated —
 * see `scripts/_build_roundtrip_scratch.sh`'s own header for the guarantee
 * that it never touches production.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER EITHER REBUILD PATH ACTUALLY CALLS THE FUNCTION THIS FILE TESTS
 *   DIRECTLY. That is the structural gate in `_reassessment_scheduler.test.ts`.
 *   This file could pass while both call sites were deleted, which is exactly
 *   why the two gates are separate and both required.
 * · A PLAN ARCHIVED BY SOME OTHER CODE PATH THIS SUITE DID NOT WRITE. It
 *   inserts and archives the row itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  scheduleReassessment,
  loadLiveQueue,
  supersedeReassessmentsForArchivedPlans,
  _resetScheduleTableProbeForTests,
  type ScheduleRequest,
} from './reassessment-scheduler';

const SCRATCH_DB = 'faff_roundtrip_scratch';
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

describe('liveness · the scratch database was reachable, or the reason is printed', () => {
  it('says which it is, out loud', () => {
    if (!REACHABLE) {
      // eslint-disable-next-line no-console
      console.warn(
        '[reassessment-staleplan.db] SKIPPED · this suite proved NOTHING about STALEPLAN-1. '
        + refusals.join('; ')
        + `. Run with: DATABASE_URL=postgresql://localhost/${SCRATCH_DB} `
        + 'npx vitest run lib/ops/_reassessment_staleplan.db.test.ts (build the scratch DB first '
        + 'with bash web-v2/scripts/_build_roundtrip_scratch.sh if it does not already exist).',
      );
    }
    expect(REACHABLE || refusals.length > 0).toBe(true);
  });
});

describe.skipIf(!REACHABLE)('STALEPLAN-1 · an item against an archived plan is ABANDONED, not silently kept', () => {
  // A private pool against the scratch DB, separate from lib/db/pool's own
  // (which reads DATABASE_URL at import time — same value here, but this
  // suite owns its setup/teardown rows independently of the module under test).
  const setupPool = new Pool({ connectionString: process.env.DATABASE_URL });

  const RUNNER = randomUUID();
  const LIVE_PLAN_ID = `staleplan-live-${randomUUID()}`;
  const DEAD_PLAN_ID = `staleplan-dead-${randomUUID()}`;

  const req = (planId: string, idempotencyKey: string): ScheduleRequest => ({
    userUuid: RUNNER,
    kind: 'EARNING_GATE',
    reasonCode: 'STALEPLAN_TEST',
    reasonDetail: 'a fixture row for STALEPLAN-1',
    assessOnISO: '2026-10-01',
    overdueAfterISO: null,
    requiredEvidence: [],
    evidence: [],
    newestEvidenceISO: null,
    planId,
    planLineageId: planId,
    planVersion: `${planId}:none`,
    evidenceVersion: null,
    modelVersion: null,
    lever: null,
    beforeValue: null,
    proposedAfterValue: null,
    magnitude: null,
    payload: {},
    idempotencyKey,
    queuedAtISO: '2026-09-06',
  });

  beforeAll(async () => {
    _resetScheduleTableProbeForTests();
    await setupPool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`,
      [RUNNER, `staleplan-${RUNNER}@example.invalid`],
    );
    // `training_plans_active_uq` allows only ONE active (archived_iso IS NULL)
    // row per user_uuid, and this fixture needs two plans live for the same
    // runner at once (one that stays active, one about to be archived) — so
    // these rows are created with user_uuid left NULL. That is safe for what
    // this suite tests: `supersedeReassessmentsForArchivedPlans` no longer
    // reads `training_plans` at all (STALEPLAN-1's redesign — see this
    // file's own header and the scheduler's own "decides nothing about a
    // plan table" gate), so the plan row's owner is not consulted; only
    // `reassessment_schedule.plan_id` and the caller-supplied archived-id
    // list matter. `user_id` (text, no such constraint) still carries the
    // runner for readability.
    for (const planId of [LIVE_PLAN_ID, DEAD_PLAN_ID]) {
      await setupPool.query(
        `INSERT INTO training_plans (id, user_id, mode, goal_iso, authored_state)
         VALUES ($1, $2, 'maintenance', '2026-12-31', '{}'::jsonb)`,
        [planId, RUNNER],
      );
    }
  });

  afterAll(async () => {
    // Delete in FK-safe order; training_plans row deletion cascades to
    // nothing this suite created elsewhere, and the reassessment rows have no
    // FK to clean up (the table is deliberately un-FK'd to its plan, per this
    // file's own header — "No FK: the ledger outlives everything by design").
    await setupPool.query(`DELETE FROM reassessment_schedule WHERE user_uuid = $1`, [RUNNER]);
    await setupPool.query(`DELETE FROM training_plans WHERE id = ANY($1)`, [[LIVE_PLAN_ID, DEAD_PLAN_ID]]);
    await setupPool.query(`DELETE FROM users WHERE id = $1`, [RUNNER]);
    await setupPool.end();
  });

  it('an item against a plan that stays active is untouched', async () => {
    const sched = await scheduleReassessment(req(LIVE_PLAN_ID, 'staleplan-live'));
    expect(sched.state, JSON.stringify(sched)).toBe('ok');

    // Nothing has been archived, so the caller passes an empty id list — the
    // same shape `clearActivePlansFor` would pass when its own archive
    // statement's RETURNING found no rows.
    const r = await supersedeReassessmentsForArchivedPlans(setupPool, RUNNER, []);
    expect(r.state, JSON.stringify(r)).toBe('ok');
    if (r.state !== 'ok') throw new Error('unreachable');
    expect(r.value).toBe(0);

    const q = await loadLiveQueue(RUNNER, 'EARNING_GATE');
    if (q.state !== 'ok') throw new Error('unreachable');
    const item = q.value.find((i) => i.idempotencyKey === 'staleplan-live');
    expect(item?.status).toBe('PENDING');
  });

  it('an item against a plan that gets archived is ABANDONED with PLAN_ARCHIVED, once', async () => {
    const sched = await scheduleReassessment(req(DEAD_PLAN_ID, 'staleplan-dead'));
    expect(sched.state, JSON.stringify(sched)).toBe('ok');

    // The live item is there before the archive.
    const before = await loadLiveQueue(RUNNER, 'EARNING_GATE');
    if (before.state !== 'ok') throw new Error('unreachable');
    expect(before.value.some((i) => i.idempotencyKey === 'staleplan-dead')).toBe(true);

    // Archive the plan exactly as clearActivePlansFor's first statement does,
    // capturing the id the same way (RETURNING id) rather than assuming it.
    const archived = await setupPool.query<{ id: string }>(
      `UPDATE training_plans SET archived_iso = NOW() WHERE id = $1 RETURNING id`,
      [DEAD_PLAN_ID],
    );
    expect(archived.rows.map((row) => row.id)).toEqual([DEAD_PLAN_ID]);

    const r1 = await supersedeReassessmentsForArchivedPlans(
      setupPool, RUNNER, archived.rows.map((row) => row.id),
    );
    expect(r1.state, JSON.stringify(r1)).toBe('ok');
    if (r1.state !== 'ok') throw new Error('unreachable');
    // Exactly the dead-plan item, not the still-live one from the prior test.
    expect(r1.value).toBe(1);

    const after = await loadLiveQueue(RUNNER, 'EARNING_GATE');
    if (after.state !== 'ok') throw new Error('unreachable');
    expect(after.value.some((i) => i.idempotencyKey === 'staleplan-dead')).toBe(false);

    const raw = await setupPool.query(
      `SELECT status, resulting_decision, resulting_decision_detail, resolved_at
         FROM reassessment_schedule
        WHERE user_uuid = $1 AND idempotency_key = 'staleplan-dead'
        ORDER BY created_at DESC LIMIT 1`,
      [RUNNER],
    );
    expect(raw.rows[0]?.status).toBe('ABANDONED');
    expect(raw.rows[0]?.resulting_decision).toBe('PLAN_ARCHIVED');
    expect(raw.rows[0]?.resolved_at).toBeTruthy();
    expect(String(raw.rows[0]?.resulting_decision_detail).length).toBeGreaterThan(0);

    // IDEMPOTENT · running it again over the same already-terminal row finds
    // nothing to do rather than re-stamping resolved_at or double-counting,
    // even passed the SAME archived-id list a second time (the shape a
    // re-run of a half-failed archive would produce).
    const r2 = await supersedeReassessmentsForArchivedPlans(setupPool, RUNNER, [DEAD_PLAN_ID]);
    expect(r2.state, JSON.stringify(r2)).toBe('ok');
    if (r2.state !== 'ok') throw new Error('unreachable');
    expect(r2.value).toBe(0);
  });

  it('a kind with no real plan_id (a synthetic planVersion) is never matched', async () => {
    const noPlan = req(DEAD_PLAN_ID, 'staleplan-noplan');
    const sched = await scheduleReassessment({ ...noPlan, planId: null, planLineageId: null });
    expect(sched.state, JSON.stringify(sched)).toBe('ok');

    // Even against an ALREADY-archived plan id (the dead plan from the prior
    // test) passed in the very list this call is scoped to, a null plan_id
    // must never match — `plan_id = ANY($2)` cannot match NULL in SQL, and
    // this proves that holds rather than assuming it.
    const r = await supersedeReassessmentsForArchivedPlans(setupPool, RUNNER, [DEAD_PLAN_ID]);
    expect(r.state, JSON.stringify(r)).toBe('ok');
    if (r.state !== 'ok') throw new Error('unreachable');
    expect(r.value).toBe(0);

    const q = await loadLiveQueue(RUNNER, 'EARNING_GATE');
    if (q.state !== 'ok') throw new Error('unreachable');
    expect(q.value.find((i) => i.idempotencyKey === 'staleplan-noplan')?.status).toBe('PENDING');
  });
});
