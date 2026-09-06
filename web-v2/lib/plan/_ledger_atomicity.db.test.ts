/**
 * lib/plan/_ledger_atomicity.db.test.ts · LEDGERATOMIC-1 · A PLAN MUTATION AND
 * ITS LEDGER RECORD ARE ONE ATOMIC OUTCOME, PROVEN AGAINST A REAL DATABASE.
 *
 * The owner's rule, verbatim:
 *
 *     "A plan mutation and its ledger record must be one atomic outcome. The
 *      system may not: (1) mutate the plan, (2) fail to write the ledger,
 *      (3) log an error, (4) return success."
 *
 * That was the literal shipped behaviour. `mutatePlan` ran `COMMIT`, then
 * called `recordDecision` on a SECOND CONNECTION, then `console.error`d the
 * failure and returned `{ ok: true }`. Every step of the four.
 *
 * `_decision_ledger_gate.test.ts` GUARD 3 proves the CALL SITES are on the
 * right side of every commit — a source scan, because a behavioural test can
 * only prove the commits it happens to drive. This file proves the OUTCOME:
 * that when the ledger refuses, the runner's plan is actually still where it
 * was. Only a real transaction can show that, so this suite writes, breaks
 * things on purpose, and reads back.
 *
 * ── IT NEVER TOUCHES PRODUCTION, AND IT SAYS SO WHEN IT SKIPS ──────────────
 *
 * `DATABASE_URL` must parse, name a LOOPBACK host, and name the database
 * `faff_roundtrip_scratch` — the full-schema local scratch built by
 * `web-v2/scripts/_build_roundtrip_scratch.sh`, which dumps production's SCHEMA
 * over the read-only role and applies migrations 166 and 167 locally. The
 * production write barrier installed by `vitest.setup.ts` is NOT disabled here;
 * it is the backstop, not the gate.
 *
 * When the check fails the suite SKIPS AND PRINTS WHY. Reporting clean because
 * it looked at nothing is the worst available outcome, since it also reports
 * confidence (Rule 18). Run it with:
 *
 *     bash web-v2/scripts/_build_roundtrip_scratch.sh
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/plan/_ledger_atomicity.db.test.ts
 *
 * ── HOW A LEDGER FAILURE IS PRODUCED ───────────────────────────────────────
 *
 * A BEFORE INSERT trigger on `plan_decision_ledger` that raises. Deliberately
 * not a bad parameter value: a constraint violation would prove only that ONE
 * shape of bad row rolls the mutation back, and the claim is about ANY ledger
 * failure. A trigger fails every insert regardless of its contents, which is
 * what a broken table, a full disk or a lost connection look like from here.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · A MUTATION THAT DOES NOT GO THROUGH `mutatePlan`. It drives the boundary.
 *   `_mutation_boundary.test.ts` is what keeps raw `plan_workouts` writes from
 *   appearing outside that door, and this file inherits its scope entirely.
 * · WHETHER PRODUCTION HAS MIGRATION 166. It does not, deliberately. A green
 *   run here says the boundary and a LOCAL COPY of that schema agree, and
 *   nothing whatsoever about the live database (Rule 19: green is not
 *   deployed). LEDGERREQUIRED-1 (2026-09-06) changed what "on production
 *   today" means, though: every structural/derivations mutation now REFUSES
 *   rather than commits when the table is absent — asserted directly below
 *   (test 0b), not assumed. Plan authorship is a separate exit and is
 *   unaffected.
 * · A FAILURE MODE POSTGRES DOES NOT ROLL BACK. Everything here rests on
 *   transactional DDL-free rollback semantics. A write outside the transaction
 *   — a file, an HTTP call, a second pool connection inside `apply` — is not
 *   covered by any of this and never can be.
 * · WHETHER THE DECISION WAS RIGHT. It measures whether the record and the
 *   change share a fate, not whether either was good coaching.
 * · CRASH RECOVERY OF A COMMITTED TRANSACTION. Test 4 kills a backend BEFORE
 *   the commit, which is the window the old code had. A crash after `COMMIT`
 *   returns is Postgres's durability guarantee and is not re-proven here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import { mutatePlan } from './mutate';
import { _resetLedgerTableProbeForTests } from '@/lib/brain/ledger/decision-ledger';

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
const when = REACHABLE ? it : it.skip;

const TODAY = '2026-09-07';

/**
 * A FRESH RUNNER AND A FRESH PLAN PER TEST.
 *
 * `training_plans_active_uq` allows one unarchived plan per runner, which is
 * the right constraint and makes a shared fixture wrong here: a leftover plan
 * from the previous test would make the next one's seed fail, and a shared
 * ledger history would make the row counts below meaningless. Rule 14 — every
 * query in this file states its population, and the population is one runner
 * who exists only for one test.
 */
let RUNNER = '';
let planId = '';
let workoutIds: string[] = [];

async function seedRunner(): Promise<void> {
  RUNNER = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1::uuid, $2, 'not-a-real-hash')
     ON CONFLICT (id) DO NOTHING`,
    [RUNNER, `ledger-atomicity+${RUNNER.slice(0, 8)}@scratch.local`],
  );
}

async function seedPlan(): Promise<void> {
  await seedRunner();
  planId = `pln_atomic_${randomUUID().slice(0, 8)}`;
  const phaseId = `phs_${randomUUID().slice(0, 8)}`;
  const weekId = `wk_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state)
     VALUES ($1, $2::text, $3::uuid, 'race-prep', $4, '{}'::jsonb)`,
    [planId, RUNNER, RUNNER, TODAY],
  );
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the atomicity suite', 'test')`,
    [phaseId, planId],
  );
  await pool.query(
    `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
     VALUES ($1, $2, 0, $3, $4, 'seeded for the atomicity suite')`,
    [weekId, planId, TODAY, phaseId],
  );
  workoutIds = [];
  for (let i = 0; i < 3; i += 1) {
    const id = `pw_${randomUUID().slice(0, 8)}`;
    workoutIds.push(id);
    await pool.query(
      `INSERT INTO plan_workouts
         (id, plan_id, week_id, date_iso, dow, type, distance_mi,
          is_quality, is_long, notes, pace_target_s_per_mi, workout_spec)
       VALUES ($1, $2, $3, $4, $5, 'easy', 6, false, false, '', 500,
               '{"kind":"easy"}'::jsonb)`,
      [id, planId, weekId, `2026-09-0${7 + i}`, i + 1],
    );
  }
}

/** The prescribed pace on every seeded workout, in order. The counter. */
async function paces(): Promise<number[]> {
  const r = await pool.query<{ pace_target_s_per_mi: string | null }>(
    `SELECT pace_target_s_per_mi::text AS pace_target_s_per_mi
       FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`,
    [planId],
  );
  return r.rows.map((row) => Number(row.pace_target_s_per_mi));
}

async function ledgerRows(provenance?: string): Promise<Array<Record<string, unknown>>> {
  const r = await pool.query(
    `SELECT * FROM plan_decision_ledger
      WHERE user_uuid = $1::uuid ${provenance ? 'AND provenance = $2' : ''}
      ORDER BY at ASC, created_at ASC`,
    provenance ? [RUNNER, provenance] : [RUNNER],
  );
  return r.rows as Array<Record<string, unknown>>;
}

/** Make every ledger insert fail, for any row, from any connection. */
async function breakTheLedger(): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION faff_test_break_ledger() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'ledger is unavailable (planted by _ledger_atomicity.db.test.ts)';
    END; $$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS faff_test_break_ledger ON plan_decision_ledger`);
  await pool.query(`
    CREATE TRIGGER faff_test_break_ledger BEFORE INSERT ON plan_decision_ledger
    FOR EACH ROW EXECUTE FUNCTION faff_test_break_ledger()`);
}

async function fixTheLedger(): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS faff_test_break_ledger ON plan_decision_ledger`);
}

/**
 * How much one mutation moves the prescribed pace, in seconds per mile.
 *
 * NOT 1. `ledger-entry.ts` sets `DEMAND_NOISE_SEC_PER_MI = 0.5` and measures
 * direction across the whole plan, so a one-second move on one of three
 * workouts averages 0.33 s/mi and is correctly read as NEUTRAL. The first run
 * of this suite asserted DOWN and got NEUTRAL, which was the noise floor doing
 * its job — the fixture was wrong, not the engine. Sized to clear it with room,
 * and still an exact integer so a double-apply is unmistakable.
 */
const STEP = 30;

/** One ordinary derivations-only mutation: bump the prescribed pace by a step. */
function bumpPace(opts: {
  source: string;
  applyOnce?: boolean;
  idempotencyKey?: string;
  undoes?: { id: string; reason: string };
  ids?: string[];
  onApply?: () => Promise<void>;
}) {
  return mutatePlan<number>({
    userUuid: RUNNER,
    authority: 'RUNNER_INITIATED',
    source: opts.source,
    todayISO: TODAY,
    planId,
    touches: 'derivations',
    ledger: {
      explanation: 'the runner asked for a slower prescribed pace',
      idempotencyKey: opts.idempotencyKey,
      applyOnce: opts.applyOnce,
      undoes: opts.undoes,
    },
    apply: async (tx) => {
      const target = opts.ids ?? [workoutIds[0]];
      let n = 0;
      for (const id of target) {
        const r = await tx.query(
          `UPDATE plan_workouts SET pace_target_s_per_mi = pace_target_s_per_mi + $3
            WHERE id = $1 AND plan_id = $2`,
          [id, planId, STEP],
        );
        n += r.rowCount ?? 0;
      }
      if (opts.onApply) await opts.onApply();
      return n;
    },
  });
}

/**
 * THE SKIP HAS TO BE VISIBLE, AND `console.warn` IS NOT.
 *
 * The first version of this block warned through `console.warn` inside a
 * PASSING test, copying `_decision_ledger.db.test.ts` next door. Falsified by
 * running it against a database with no fixture: vitest printed
 *
 *     Tests  1 passed | 13 skipped (14)
 *
 * and NOT ONE WORD of the reason. A suite that proves nothing while reporting
 * clean is the exact failure Rule 18 point 2 names, and the warning it relied
 * on was swallowed by the reporter.
 *
 * Two changes, so it cannot happen quietly again:
 *   · the reason goes to `process.stderr` directly, which no reporter buffers;
 *   · the TEST NAME itself carries the verdict, so the run summary says it
 *     even when stderr is discarded.
 *
 * `lib/brain/ledger/_decision_ledger.db.test.ts` still has the console.warn
 * shape and the same hole. Named here rather than fixed silently, because it
 * is a different suite's liveness and deserves its own change.
 */
const LIVENESS_TITLE = REACHABLE
  ? 'the scratch database was reachable · every assertion below actually ran'
  : `SKIPPED · THIS SUITE PROVED NOTHING · ${refusals.join('; ')}`;

describe('liveness · did this suite look at anything', () => {
  it(LIVENESS_TITLE, () => {
    if (!REACHABLE) {
      process.stderr.write(
        `\n[ledger-atomicity] SKIPPED · THIS SUITE PROVED NOTHING ABOUT ATOMICITY.\n`
        + `  ${refusals.join('; ')}\n`
        + `  Build the fixture: bash web-v2/scripts/_build_roundtrip_scratch.sh\n`
        + `  Then run with: DATABASE_URL=postgresql://localhost/${SCRATCH_DB}\n\n`,
      );
    }
    expect(typeof REACHABLE).toBe('boolean');
  });
});

describe('LEDGERATOMIC-1 · a plan mutation and its ledger record share one fate', () => {
  beforeAll(async () => {
    if (!REACHABLE) return;
    // Test 4 kills a backend on purpose, and `pg` surfaces the dead socket as
    // an uncaught 'error' on the pool. Absorbed here rather than left to
    // become an unhandled rejection that vitest reports as a false positive
    // against whatever test happens to be running when it lands.
    pool.on('error', () => { /* expected: test 4 terminates its own backend */ });
    // `pool.on('error')` only covers IDLE clients. The one test 4 kills is
    // CHECKED OUT, and `pg` emits the dead socket on the client itself — with
    // no listener there it becomes an uncaught exception that vitest reports
    // against whichever test is running when it lands, which is a false
    // positive on a neighbouring test and exactly the kind of permanently-red
    // noise `vitest.setup.ts`'s own header is about.
    pool.on('connect', (c) => { c.on('error', () => { /* see above */ }); });
    await fixTheLedger();
  });

  afterAll(async () => {
    if (!REACHABLE) return;
    await fixTheLedger();
    await pool.query(`DROP FUNCTION IF EXISTS faff_test_break_ledger() CASCADE`);
  });

  beforeEach(async () => {
    if (!REACHABLE) return;
    _resetLedgerTableProbeForTests();
    await seedPlan();
  });

  when('0 · the fixture is real · the ledger table exists on this database', async () => {
    // Rule 18 · without this, every assertion below could pass vacuously —
    // every mutation would REFUSE (per LEDGERREQUIRED-1) rather than
    // exercising the atomicity paths tests 1-9 are actually about. The suite
    // would report atomicity while never reaching the code that provides it.
    const r = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.plan_decision_ledger')::text AS reg`,
    );
    expect(
      r.rows[0]?.reg,
      'plan_decision_ledger is absent on the scratch database, so every mutation below takes the '
      + 'pre-migration branch and this suite proves nothing. Apply db/migrations/166.',
    ).not.toBeNull();
    expect(await paces()).toEqual([500, 500, 500]);
  });

  when('0b · LEDGERREQUIRED-1 · an absent ledger REFUSES, before the plan moves', async () => {
    // The contract this test exists to prove, in the owner's own words:
    // "There may be no ambiguous or optional ledger behavior for a plan
    // mutation... When the ledger is required and unavailable, the mutation
    // refuses before changing the plan." Made genuinely absent by renaming
    // the real table for the duration of the test — the in-transaction probe
    // (`ledgerTableExistsInTransaction`) queries `tx`, the caller's own open
    // transaction, never `pool`, so a `pool.query` mock cannot reach it. This
    // is the honest simulation the file's own `breakTheLedger` already uses
    // the same philosophy for: change the real database, not a JS stub.
    const before = await paces();
    await pool.query(`ALTER TABLE plan_decision_ledger RENAME TO plan_decision_ledger_hidden`);
    _resetLedgerTableProbeForTests();

    let res: Awaited<ReturnType<typeof bumpPace>>;
    try {
      res = await bumpPace({ source: 'test/ledger-absent' });
    } finally {
      await pool.query(`ALTER TABLE plan_decision_ledger_hidden RENAME TO plan_decision_ledger`);
      _resetLedgerTableProbeForTests();
    }

    expect(res.ok, 'a mutation with no ledger table must not report success').toBe(false);
    expect(res.outcome).toBe('ledger_unwritten');
    expect(await paces(), 'the plan moved even though the ledger could not record it')
      .toEqual(before);
  });

  when('0c · LEDGERREQUIRED-1 · plan AUTHORSHIP is unaffected by the ledger requirement', async () => {
    // The refusal is scoped to structural/derivations mutations. A brand-new
    // plan being authored takes a different exit entirely and this test
    // proves that exit does not regress into refusing too, even with the
    // table genuinely absent.
    await pool.query(`ALTER TABLE plan_decision_ledger RENAME TO plan_decision_ledger_hidden`);
    _resetLedgerTableProbeForTests();

    let res: Awaited<ReturnType<typeof mutatePlan<number>>>;
    try {
      res = await mutatePlan<number>({
        userUuid: RUNNER,
        authority: 'AUTHORSHIP',
        source: 'test/authorship-unaffected',
        todayISO: TODAY,
        touches: 'authorship',
        planIdFromResult: () => `pln_test_${randomUUID().slice(0, 8)}`,
        apply: async () => 1,
      });
    } finally {
      await pool.query(`ALTER TABLE plan_decision_ledger_hidden RENAME TO plan_decision_ledger`);
      _resetLedgerTableProbeForTests();
    }

    expect(res.ok, 'plan authorship refused because of the ledger, and it must not').toBe(true);
  });

  when('1 · mutation succeeds and ledger succeeds', async () => {
    const src = 'test/atomic-happy';
    const res = await bumpPace({ source: src });

    expect(res.ok).toBe(true);
    expect(res.outcome).toBe('applied');
    expect(res.value).toBe(1);
    expect(await paces()).toEqual([500 + STEP, 500, 500]);

    const rows = await ledgerRows(src);
    expect(rows).toHaveLength(1);
    expect(rows[0].mutation_outcome).toBe('applied');
    expect(rows[0].plan_id).toBe(planId);
    // The version the mutation PRODUCED, not a separate query's guess at it.
    expect(String(rows[0].plan_version)).toContain(planId);
    // Direction is MEASURED: a slower prescribed pace is DOWN, and no caller
    // supplied it.
    expect(rows[0].direction).toBe('DOWN');
    expect(String(rows[0].explanation)).toContain('the runner asked for a slower prescribed pace');
  });

  when('2a · mutation fails on AUTHORITY · the refusal is recorded and the plan is untouched', async () => {
    const src = 'test/atomic-refused';
    await expect(mutatePlan<void>({
      userUuid: RUNNER,
      authority: 'COACHING_ADAPTATION',
      source: src,
      todayISO: TODAY,
      planId,
      touches: 'derivations',
      apply: async () => { throw new Error('apply must never run past a refusal'); },
    })).rejects.toThrow(/REFUSED/);

    expect(await paces()).toEqual([500, 500, 500]);
    const rows = await ledgerRows(src);
    expect(rows, 'a refusal that records nothing is the one row a reader most needs')
      .toHaveLength(1);
    expect(rows[0].authority_verdict).toBe('REFUSED');
    expect(rows[0].mutation_outcome).toBe('not_attempted');
    expect(rows[0].decision).toBe('REFUSE');
  });

  when('2b · mutation fails inside `apply` · the crash is recorded and the plan is untouched', async () => {
    const src = 'test/atomic-threw';
    await expect(mutatePlan<void>({
      userUuid: RUNNER,
      authority: 'RUNNER_INITIATED',
      source: src,
      todayISO: TODAY,
      planId,
      touches: 'derivations',
      apply: async (tx) => {
        await tx.query(
          `UPDATE plan_workouts SET pace_target_s_per_mi = 999 WHERE plan_id = $1`,
          [planId],
        );
        throw new Error('the statement after the write blew up');
      },
    })).rejects.toThrow('the statement after the write blew up');

    expect(
      await paces(),
      'the write inside `apply` must roll back with the throw',
    ).toEqual([500, 500, 500]);
    const rows = await ledgerRows(src);
    expect(rows).toHaveLength(1);
    expect(rows[0].mutation_outcome).toBe('not_attempted');
    // Rule 11 · a crash and a refusal are different facts and this file's own
    // `2a` above must not be confusable with this one.
    expect(String(rows[0].explanation)).toContain('the mutation threw');
  });

  when('3 · LEDGER INSERT FAILS AND THE PLAN MUTATION ROLLS BACK', async () => {
    // THE HEADLINE. Before LEDGERATOMIC-1 this returned `ok: true` with the
    // plan moved and no row anywhere.
    const src = 'test/atomic-ledger-down';
    await breakTheLedger();
    let res;
    try {
      res = await bumpPace({ source: src });
    } finally {
      await fixTheLedger();
    }

    expect(res.ok, 'a mutation whose record could not be written must not report success').toBe(false);
    expect(res.outcome).toBe('ledger_unwritten');
    expect(res.violations.join(' ')).toContain('ledger is unavailable');
    expect(
      await paces(),
      'THE PLAN MOVED WITHOUT A RECORD. This is the exact failure the rule forbids.',
    ).toEqual([500, 500, 500]);

    // AND WHAT THE FIRST RUN OF THIS TEST GOT WRONG, which is worth keeping:
    // it asserted that the refusal itself lands on lane B. It does not, here,
    // because the trigger is still armed while `mutatePlan` is running — the
    // whole table is refusing every insert from every connection. So the
    // honest state is ZERO rows, and the boundary says so at `console.error`
    // ("DECISION NOT RECORDED (failed)") rather than claiming one.
    //
    // That is the correct behaviour and the right thing to assert: when the
    // ledger is entirely unavailable, nothing is recorded and NOTHING MOVED.
    // A recorded refusal in that state would be a lie. Test 3b covers the
    // narrower and more common case — this row cannot be written, the table is
    // otherwise fine — where the refusal does land.
    expect(await ledgerRows(src)).toHaveLength(0);
  });

  when('3b · when only THIS row fails, the refusal still lands on the surviving lane', async () => {
    // The realistic shape: one row is rejected (a constraint, a bad value, a
    // serialization failure) and the table is otherwise healthy. The mutation
    // must still roll back, and the refusal must still be recorded — that
    // second half is what lane B exists for, and a blanket outage cannot show
    // it.
    const src = 'test/atomic-ledger-row-refused';
    await pool.query(`
      CREATE OR REPLACE FUNCTION faff_test_break_ledger() RETURNS trigger AS $$
      BEGIN
        IF NEW.mutation_outcome = 'applied' THEN
          RAISE EXCEPTION 'this row is unwritable (planted by _ledger_atomicity.db.test.ts)';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await pool.query(`DROP TRIGGER IF EXISTS faff_test_break_ledger ON plan_decision_ledger`);
    await pool.query(`
      CREATE TRIGGER faff_test_break_ledger BEFORE INSERT ON plan_decision_ledger
      FOR EACH ROW EXECUTE FUNCTION faff_test_break_ledger()`);
    let res;
    try {
      res = await bumpPace({ source: src });
    } finally {
      await fixTheLedger();
    }

    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('ledger_unwritten');
    expect(await paces()).toEqual([500, 500, 500]);
    const rows = await ledgerRows(src);
    expect(
      rows.map((r) => r.mutation_outcome),
      'a refusal that records nothing is the row a reader most needs',
    ).toEqual(['ledger_unwritten']);
    expect(String(rows[0].explanation)).toContain('The plan did not move.');
  });

  when('4 · the process dies between the mutation and the response', async () => {
    // The window the old code had: writes done, commit not yet returned. A
    // terminated backend is the closest faithful model of it, and it exercises
    // the same code path a crashed container would.
    const src = 'test/atomic-process-died';
    let killed = false;
    await expect(mutatePlan<void>({
      userUuid: RUNNER,
      authority: 'RUNNER_INITIATED',
      source: src,
      todayISO: TODAY,
      planId,
      touches: 'derivations',
      apply: async (tx) => {
        await tx.query(
          `UPDATE plan_workouts SET pace_target_s_per_mi = 777 WHERE plan_id = $1`,
          [planId],
        );
        const pid = (await tx.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
        // A SEPARATE connection kills the one running the mutation.
        await pool.query(`SELECT pg_terminate_backend($1)`, [pid]);
        killed = true;
      },
    })).rejects.toThrow();

    expect(killed).toBe(true);
    expect(
      await paces(),
      'a mutation interrupted before its commit must leave nothing behind',
    ).toEqual([500, 500, 500]);
    // AND THE CORRECTION THE FIRST RUN FORCED: this asserted zero rows and
    // found one. The one is right and the expectation was wrong — the
    // catch-all records the crash on a FRESH connection, because the client
    // that died cannot. That is lane B doing exactly its job.
    //
    // The invariant is not "both are written". It is NEVER ONE WITHOUT THE
    // OTHER, and specifically never a committed plan change with no row. So
    // what this asserts is that nothing claims to have applied.
    const rows = await ledgerRows(src);
    expect(rows.map((r) => r.mutation_outcome)).toEqual(['not_attempted']);
    expect(rows.filter((r) => r.mutation_outcome === 'applied')).toHaveLength(0);
  });

  when('5 · duplicate accept is idempotent', async () => {
    const src = 'test/atomic-accept';
    const key = `accept:${randomUUID()}`;

    const first = await bumpPace({ source: src, applyOnce: true, idempotencyKey: key });
    expect(first.ok).toBe(true);
    expect(first.outcome).toBe('applied');
    expect(await paces()).toEqual([500 + STEP, 500, 500]);

    const second = await bumpPace({ source: src, applyOnce: true, idempotencyKey: key });
    expect(second.ok, 'the second accept changed nothing, so it is not a success').toBe(false);
    expect(second.outcome).toBe('duplicate');
    expect(
      await paces(),
      'the runner tapped Accept twice and the plan moved twice',
    ).toEqual([500 + STEP, 500, 500]);

    const rows = await ledgerRows(src);
    expect(rows.filter((r) => r.mutation_outcome === 'applied')).toHaveLength(1);
    expect(rows.filter((r) => r.idempotency_key === key)).toHaveLength(1);
  });

  when('6 · a retry cannot double-apply, even racing itself', async () => {
    const src = 'test/atomic-retry';
    const key = `retry:${randomUUID()}`;

    // Two in flight at once. The second blocks on the partial unique index
    // until the first commits, then inserts nothing and rolls its plan writes
    // back. A `SELECT`-then-write check would have a race here; the index does
    // not, because the check and the write are the same statement.
    const [a, b] = await Promise.all([
      bumpPace({ source: src, applyOnce: true, idempotencyKey: key }),
      bumpPace({ source: src, applyOnce: true, idempotencyKey: key }),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['applied', 'duplicate']);
    expect(
      await paces(),
      'a concurrent retry applied the mutation twice',
    ).toEqual([500 + STEP, 500, 500]);
    expect((await ledgerRows(src)).filter((r) => r.idempotency_key === key)).toHaveLength(1);
  });

  when('6b · applyOnce with no key REFUSES rather than pretending to be once-only', async () => {
    const src = 'test/atomic-once-no-key';
    const res = await bumpPace({ source: src, applyOnce: true });
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('ledger_unwritten');
    expect(res.violations.join(' ')).toContain('no idempotency key');
    expect(await paces()).toEqual([500, 500, 500]);
  });

  when('7 · an undo is ledgered atomically with the reversal it performs', async () => {
    const src = 'test/atomic-undo';
    const key = `undo-target:${randomUUID()}`;
    await bumpPace({ source: src, applyOnce: true, idempotencyKey: key });
    expect(await paces()).toEqual([500 + STEP, 500, 500]);

    const target = (await ledgerRows(src)).find((r) => r.idempotency_key === key);
    expect(target, 'the row to be undone must exist before it can be undone').toBeDefined();
    const targetId = String(target!.id);

    // 7a · the negative FIRST, so a passing 7b cannot be an artefact of order.
    //      An undo pointing at a row that is not there must take the plan
    //      reversal down with it.
    const bogus = await mutatePlan<number>({
      userUuid: RUNNER,
      authority: 'RUNNER_INITIATED',
      source: `${src}-bogus`,
      todayISO: TODAY,
      planId,
      touches: 'derivations',
      ledger: { undoes: { id: randomUUID(), reason: 'reversing a decision that does not exist' } },
      apply: async (tx) => (await tx.query(
        `UPDATE plan_workouts SET pace_target_s_per_mi = pace_target_s_per_mi - $2 WHERE id = $1`,
        [workoutIds[0], STEP],
      )).rowCount ?? 0,
    });
    expect(bogus.ok).toBe(false);
    expect(bogus.outcome).toBe('ledger_unwritten');
    expect(
      await paces(),
      'the plan was reversed while the decision it reverses stayed live',
    ).toEqual([500 + STEP, 500, 500]);

    // 7b · the real undo. Plan back, and the original row stamped, together.
    const undone = await mutatePlan<number>({
      userUuid: RUNNER,
      authority: 'RUNNER_INITIATED',
      source: `${src}-reverse`,
      todayISO: TODAY,
      planId,
      touches: 'derivations',
      ledger: {
        explanation: 'the runner changed his mind',
        undoes: { id: targetId, reason: 'the runner reversed the pace change' },
      },
      apply: async (tx) => (await tx.query(
        `UPDATE plan_workouts SET pace_target_s_per_mi = pace_target_s_per_mi - $2 WHERE id = $1`,
        [workoutIds[0], STEP],
      )).rowCount ?? 0,
    });
    expect(undone.ok).toBe(true);
    expect(await paces()).toEqual([500, 500, 500]);

    const after = (await ledgerRows()).find((r) => String(r.id) === targetId);
    expect(after!.undone_at, 'the reversal committed and the decision still reads live').not.toBeNull();
    expect(after!.undo_reason).toBe('the runner reversed the pace change');
  });

  when('8 · coordinated multi-row changes are all-or-nothing, ledger included', async () => {
    const src = 'test/atomic-multirow';

    // The whole batch lands together with one row describing it.
    const ok = await bumpPace({ source: src, ids: workoutIds });
    expect(ok.ok).toBe(true);
    expect(ok.value).toBe(3);
    expect(await paces()).toEqual([500 + STEP, 500 + STEP, 500 + STEP]);
    const rows = await ledgerRows(src);
    expect(rows).toHaveLength(1);
    expect((rows[0].workout_ids as string[]).length).toBe(3);

    // And when the record refuses, NONE of the three survives — not the first
    // two with the third rolled back, which is what a per-row writer would
    // leave behind.
    await breakTheLedger();
    let broken;
    try {
      broken = await bumpPace({ source: `${src}-broken`, ids: workoutIds });
    } finally {
      await fixTheLedger();
    }
    expect(broken.ok).toBe(false);
    expect(broken.outcome).toBe('ledger_unwritten');
    expect(
      await paces(),
      'a partial batch survived a rolled-back mutation',
    ).toEqual([500 + STEP, 500 + STEP, 500 + STEP]);
  });

  when('9 · THE INVARIANT · no plan change is durable without its record', async () => {
    // Stated once, over everything above: for every mutation this suite ran,
    // the plan moved if and only if a row describing it exists. Checked as a
    // property rather than case by case, because the case nobody wrote is the
    // one that breaks.
    const src = 'test/atomic-invariant';
    const before = await paces();

    await breakTheLedger();
    try { await bumpPace({ source: src }); } finally { await fixTheLedger(); }
    const afterBroken = await paces();
    const appliedRows = (await ledgerRows(src)).filter((r) => r.mutation_outcome === 'applied');
    expect(afterBroken).toEqual(before);
    expect(appliedRows).toHaveLength(0);

    await bumpPace({ source: src });
    const afterOk = await paces();
    const appliedAfter = (await ledgerRows(src)).filter((r) => r.mutation_outcome === 'applied');
    expect(afterOk).not.toEqual(before);
    expect(appliedAfter).toHaveLength(1);
  });
});
