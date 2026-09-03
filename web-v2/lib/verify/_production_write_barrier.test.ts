/**
 * lib/verify/_production_write_barrier.test.ts · THE PROOF THE OWNER ASKED FOR.
 *
 * His words, after two junk activity rows written into his real training
 * history by a live simulator session:
 *
 *   "Add a hard mutation barrier with a test proving production writes are
 *    refused during verification."
 *
 * This is that test. It runs inside `npm test`, which means it runs inside a
 * verification process, which means the barrier it is testing is ALREADY ARMED
 * around it — the assertions below are made from inside the fence, not about it
 * from outside.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS TEST CANNOT FAIL ON · Rule 22 requires this sentence, so here it is.
 *
 *   · It cannot catch a write issued by a process that never loads the barrier
 *     — a standalone `scripts/*.mjs` run as plain `node`. 70 such files build
 *     their own `pg.Pool`. `scripts/check-write-barrier.sh` is what keeps that
 *     set enumerated; this file cannot see it.
 *   · It cannot catch a write issued outside this process entirely: psql, the
 *     Railway console, a `gh workflow run` against the live app.
 *   · It cannot catch an HTTP write from a client that does not stamp itself.
 *     The stamp is trusted, not verified, and `client-attestation.ts` says so
 *     in its own header. This barrier stops tooling from doing the wrong thing
 *     by accident; it is not an authentication control.
 *   · Its HTTP half is driven through the pure classifier, not through a live
 *     Next server. It proves the DECISION, not the deployment — Rule 19's
 *     distinction, stated rather than blurred.
 *   · The live section proves a refusal against the REAL production connection
 *     string when one is present, and SKIPS when there is none. A skip is not a
 *     pass. The run output says which happened.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HAS_DATABASE, NO_DATABASE_REASON } from '@/lib/db/_test-db';
import {
  ProductionWriteRefused,
  barrierIsInstalled,
  classifyDatabaseTarget,
  classifyProcess,
  classifyStatement,
  judge,
  productionWriteLedger,
  resetProductionWriteLedger,
  targetPermitsWrites,
} from './production-barrier';
import { judgeRequest, classifyServerPosture, CLIENT_ENV_HEADER, VERIFICATION_HEADER } from './client-attestation';

/** The owner's production uuid. Every assertion about "his account" names it. */
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** A production-shaped URL with credentials that are deliberately nonsense. */
const PROD_SHAPED = 'postgresql://nobody:nothing@crossover.proxy.rlwy.net:20769/railway';
const LOOPBACK = 'postgresql://dev:dev@localhost:5432/faff_adapt_harness';
const WEIRD = 'postgresql://dev:dev@db.example.invalid:5432/whatever';

const WEB_ROOT = path.resolve(__dirname, '../..');

function headers(map: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return (n: string) => lower[n.toLowerCase()] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('WRITE BARRIER · the wiring exists (Rule 20 · gate the wiring, not just the logic)', () => {
  it('is armed in THIS process', () => {
    // If `vitest.setup.ts`'s `await import('./lib/verify/install-barrier')` is
    // deleted, this is the assertion that names it. The rest of the file would
    // still pass on pure functions — which is exactly how a barrier ends up
    // present, correct, and not installed.
    expect(classifyProcess().verification, 'vitest should classify as a verification process').toBe(true);
    expect(barrierIsInstalled(), 'the pg prototype patch is NOT installed in this test process').toBe(true);
  });

  it('vitest.setup.ts arms it, and lib/db/pool.ts arms it too', () => {
    const setup = fs.readFileSync(path.join(WEB_ROOT, 'vitest.setup.ts'), 'utf8');
    expect(setup, 'vitest.setup.ts no longer imports the barrier').toMatch(/verify\/install-barrier/);

    const pool = fs.readFileSync(path.join(WEB_ROOT, 'lib/db/pool.ts'), 'utf8');
    expect(pool, 'lib/db/pool.ts no longer imports the barrier').toMatch(/verify\/install-barrier/);
  });

  it('the middleware still calls the classifier, and still matches /api', () => {
    const mw = fs.readFileSync(path.join(WEB_ROOT, 'middleware.ts'), 'utf8');
    expect(mw).toMatch(/judgeRequest/);
    expect(mw).toMatch(/'\/api\/:path\*'/);
  });

  it('the iOS client still stamps simulator builds at compile time', () => {
    // The stamp is the only thing that tells the server a simulator is calling.
    // Deleting it is a one-line edit with no other visible effect, so it gets
    // its own assertion rather than trusting a comment (Rule 20).
    const api = path.resolve(WEB_ROOT, '../native-v2/Faff/Faff/API.swift');
    if (!fs.existsSync(api)) {
      // A web-only checkout is a real configuration; say so rather than passing
      // silently on a file that was not read (Rule 18 · liveness).
      throw new Error(`native-v2/Faff/Faff/API.swift not found at ${api} · this assertion read nothing`);
    }
    const swift = fs.readFileSync(api, 'utf8');
    expect(swift).toMatch(/#if targetEnvironment\(simulator\)/);
    expect(swift).toMatch(/X-Faff-Client-Env/);
    expect(swift, 'authedSend no longer stamps the request').toMatch(/API\.stampClientEnvironment\(&req\)/);
  });
});

describe('WRITE BARRIER · who is fenced', () => {
  it('names vitest structurally, from a signal the runner sets', () => {
    expect(classifyProcess({ VITEST: 'true' }, []).verification).toBe(true);
    expect(classifyProcess({ VITEST_WORKER_ID: '3' }, []).verification).toBe(true);
    expect(classifyProcess({ NODE_ENV: 'test' }, []).verification).toBe(true);
    expect(classifyProcess({ FAFF_VERIFICATION: '1' }, []).verification).toBe(true);
    expect(classifyProcess({}, ['node', '/x/node_modules/.bin/vitest']).verification).toBe(true);
  });

  it('leaves the real application alone — the app must keep writing', () => {
    const app = classifyProcess({ NODE_ENV: 'production' }, ['node', 'server.js']);
    expect(app.verification).toBe(false);
    // And a mutating statement from that process is not judged at all.
    expect(judge('INSERT INTO runs (id) VALUES (1)', {
      env: { NODE_ENV: 'production', DATABASE_URL: PROD_SHAPED }, argv: ['node', 'server.js'],
    })).toBeNull();
  });

  it('has NO opt-out · a verification process cannot argue its way past this', () => {
    // Every plausible escape a caller might reach for, tried against a
    // production target from inside a verification process.
    for (const escape of [
      { FAFF_VERIFICATION: '0' },
      { FAFF_DB_TARGET: 'local' },
      { FAFF_DB_TARGET: 'scratch' },
      { ALLOW_PRODUCTION_WRITES: '1' },
      { NODE_ENV: 'production' },
    ]) {
      const refusal = judge('INSERT INTO runs (id) VALUES (1)', {
        env: { VITEST: 'true', DATABASE_URL: PROD_SHAPED, ...escape },
        argv: [],
      });
      expect(refusal, `escape hatch found: ${JSON.stringify(escape)}`).toBeInstanceOf(ProductionWriteRefused);
    }
  });
});

describe('WRITE BARRIER · what is fenced (allow-list, not deny-list)', () => {
  const mutating = [
    `INSERT INTO runs (user_uuid, data) VALUES ($1, $2)`,
    `UPDATE plan_workouts SET distance_mi = 3 WHERE id = $1`,
    `DELETE FROM coach_intents WHERE user_uuid = $1`,
    `TRUNCATE plan_workouts`,
    `DROP TABLE runs`,
    `ALTER TABLE runs ADD COLUMN x int`,
    `GRANT INSERT ON runs TO faff_readonly`,
    // The one a deny-list of leading keywords misses entirely.
    `WITH doomed AS (SELECT id FROM runs WHERE user_uuid = $1)
       DELETE FROM runs WHERE id IN (SELECT id FROM doomed)`,
    `WITH x AS (SELECT 1) INSERT INTO runs (id) SELECT 1 FROM x`,
    // Not a read even though it opens like one.
    `SELECT * INTO backup_runs FROM runs`,
    `EXPLAIN ANALYZE UPDATE runs SET data = '{}'::jsonb`,
    `SELECT id FROM runs WHERE user_uuid = $1 FOR UPDATE`,
    `DO $$ BEGIN PERFORM 1; END $$`,
    `CALL some_procedure()`,
    `SELECT nextval('runs_id_seq')`,
    // Unparseable / absent. The default answer is refuse.
    ``,
    ` garbage`,
  ];

  it.each(mutating)('refuses %s', (sql) => {
    expect(classifyStatement(sql).mutating, `classified as a read: ${sql}`).toBe(true);
  });

  it('refuses a statement that is not a string at all', () => {
    for (const junk of [undefined, null, 42, {}, []]) {
      expect(classifyStatement(junk).mutating).toBe(true);
    }
  });

  const reads = [
    `SELECT 1`,
    `select id, data from runs where user_uuid = $1 limit 10`,
    `-- Rule 8 · habit reader\nSELECT AVG(distance_mi) FROM runs WHERE user_uuid = $1`,
    `/* leading block comment */ SELECT current_user`,
    `WITH w AS (SELECT 1 AS n) SELECT n FROM w`,
    `SHOW statement_timeout`,
    `EXPLAIN SELECT 1`,
    `BEGIN`,
    `COMMIT`,
    `ROLLBACK`,
    `SET statement_timeout = 5000`,
    `DISCARD ALL`,
    // Prose that happens to contain a keyword. A false refusal is still a bug.
    `SELECT id FROM runs WHERE data->>'name' = 'drop the hammer' AND data->>'note' = 'create a gap'`,
    // REGRESSION · the real one, found by running the whole suite against the
    // armed barrier. `lib/training/vdot-inputs.ts` explains a cast in a mid-query
    // comment whose text is "which this call site swallows". `\bcall\s+` matched,
    // and a live pace-anchor read was refused in four tests. Comments are not
    // statements, and a comment is not only at the front of one.
    `WITH wc AS MATERIALIZED (
       SELECT DISTINCT ON (d) d, x FROM runs
        -- Cast through ::text first: a bare $2::date makes Postgres infer
        -- the PARAMETER as date, and the outer comparison then fails - which
        -- this call site swallows, returning an empty list instead of an error.
        WHERE d >= $2::text::date
     ) SELECT * FROM wc`,
    `SELECT 1 /* we used to CREATE a temp table here; we no longer DROP anything */`,
  ];

  it.each(reads)('allows %s', (sql) => {
    const c = classifyStatement(sql);
    expect(c.mutating, `false refusal (${c.reason}): ${sql}`).toBe(false);
  });
});

describe('WRITE BARRIER · where it is pointed · THREE answers, never two (Rule 11)', () => {
  it('names production', () => {
    const t = classifyDatabaseTarget(PROD_SHAPED, {});
    expect(t.kind).toBe('production');
    expect(targetPermitsWrites(t)).toBe(false);
    expect(t.describe, 'the description leaked a credential').not.toMatch(/nobody|nothing/);
  });

  it('names loopback, and permits writes there', () => {
    const t = classifyDatabaseTarget(LOOPBACK, {});
    expect(t.kind).toBe('local');
    expect(targetPermitsWrites(t)).toBe(true);
  });

  it('refuses rather than guessing when it cannot tell', () => {
    for (const url of [undefined, '', 'not-a-url', WEIRD]) {
      const t = classifyDatabaseTarget(url, {});
      expect(t.kind, `guessed about ${String(url)}`).toBe('indeterminate');
      expect(targetPermitsWrites(t)).toBe(false);
    }
    // And that refusal is the one that actually fires.
    const refusal = judge('DELETE FROM runs WHERE user_uuid = $1', {
      env: { VITEST: 'true', DATABASE_URL: WEIRD }, argv: [],
    });
    expect(refusal).toBeInstanceOf(ProductionWriteRefused);
    expect(refusal!.why + refusal!.target).toMatch(/neither loopback nor a known production host/);
  });

  it('cannot be told that a REMOTE database is safe', () => {
    // The structural property the whole module exists to have: no configuration
    // promotes a remote host. `FAFF_DB_TARGET` may only confirm loopback.
    const t = classifyDatabaseTarget(PROD_SHAPED, { FAFF_DB_TARGET: 'local' });
    expect(t.kind).toBe('production');
    expect(targetPermitsWrites(t)).toBe(false);
  });

  it('lets the local harnesses keep working', () => {
    // lib/adaptation-harness truncates and rewrites its own loopback database.
    // A barrier that broke it would be a barrier people route around.
    expect(judge('TRUNCATE plan_workouts', {
      env: { VITEST: 'true', DATABASE_URL: LOOPBACK }, argv: [],
    })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE HEADLINE. Not a pure function — the app's own pool, the real `pg`
// prototype, a real INSERT naming the owner's account.

describe('WRITE BARRIER · a production write is REFUSED during verification', () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.DATABASE_URL; resetProductionWriteLedger(); });
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  it('refuses the exact shape of the incident, through the app pool, and issues nothing', async () => {
    process.env.DATABASE_URL = PROD_SHAPED;
    const { pool } = await import('@/lib/db/pool');

    // The incident, reconstructed: the ingest route's own write, naming the
    // owner's uuid, with a `sim-…` client id and a 0.27 mi partial run.
    const INGEST = `INSERT INTO runs (user_uuid, data, provenance, fetched_at)
                    VALUES ($1::uuid, $2::jsonb, $3::jsonb, NOW())`;
    const payload = JSON.stringify({
      clientWorkoutId: 'sim-recovery-live', distanceMi: 0.27, status: 'partial', source: 'apple_watch',
    });

    await expect(
      pool.query(INGEST, [OWNER, payload, '{}']),
    ).rejects.toBeInstanceOf(ProductionWriteRefused);

    const ledger = productionWriteLedger();
    expect(ledger.sentence).toBe('1 write attempted, 0 issued');
    expect(ledger.issued).toBe(0);
    expect(ledger.attempts[0].target).toMatch(/production/);
    expect(ledger.attempts[0].head).toMatch(/INSERT INTO runs/);
  });

  it('refuses a client checked out of the pool, not just pool.query', async () => {
    process.env.DATABASE_URL = PROD_SHAPED;
    const pg = await import('pg');
    // Never connected — the prototype patch judges before any wire activity.
    const client = new pg.Client({ connectionString: PROD_SHAPED });
    await expect(
      client.query(`UPDATE plan_workouts SET distance_mi = 0 WHERE plan_id = $1`, ['x']),
    ).rejects.toBeInstanceOf(ProductionWriteRefused);
    expect(productionWriteLedger().issued).toBe(0);
  });

  it('refuses a pool a test constructs for itself', async () => {
    process.env.DATABASE_URL = PROD_SHAPED;
    const pg = await import('pg');
    const rogue = new pg.Pool({ connectionString: PROD_SHAPED });
    await expect(
      rogue.query(`DELETE FROM runs WHERE user_uuid = $1`, [OWNER]),
    ).rejects.toBeInstanceOf(ProductionWriteRefused);
    expect(productionWriteLedger().issued).toBe(0);
    await rogue.end().catch(() => {});
  });

  it('refuses a write on a SEPARATE client pointed at production, even while DATABASE_URL is loopback', async () => {
    // The walk-substrate incident (2026-09-03): a verification process held a
    // LOOPBACK scratch database as its own DATABASE_URL, plus a second,
    // independently-constructed connection pointed at production
    // (`new Client({ connectionString: process.env.DATABASE_URL_RO })`, the
    // exact shape `web-v2/scripts/walk-substrate.ts` used). `judge` resolved
    // its target from `env.DATABASE_URL` no matter which connection actually
    // issued the statement, so `classifyDatabaseTarget` answered `local`,
    // `targetPermitsWrites` returned true, and a mutating statement on the
    // PRODUCTION client would have passed straight through — while this very
    // process's barrier reported "writes permitted (loopback)" at startup.
    // The target must be resolved from the CLIENT/POOL issuing the query, not
    // from `process.env`.
    process.env.DATABASE_URL = LOOPBACK;
    const pg = await import('pg');

    const prodPool = new pg.Pool({ connectionString: PROD_SHAPED, connectionTimeoutMillis: 8000, max: 1 });
    try {
      await expect(
        prodPool.query(`DELETE FROM runs WHERE user_uuid = $1`, [OWNER]),
      ).rejects.toBeInstanceOf(ProductionWriteRefused);
    } finally {
      await prodPool.end().catch(() => {});
    }

    const ledger = productionWriteLedger();
    expect(ledger.issued).toBe(0);
    expect(ledger.attempts[0].target).toMatch(/production/);
    expect(ledger.attempts[0].head).toMatch(/DELETE FROM runs/);
  });

  it('does not break reads · the refusal is targeted, not a blanket outage', async () => {
    process.env.DATABASE_URL = PROD_SHAPED;
    const { pool } = await import('@/lib/db/pool');
    // A SELECT is allowed through the barrier and then fails on the network,
    // because the credentials are nonsense. That it is NOT a
    // ProductionWriteRefused is the assertion: the barrier let it past.
    await expect(pool.query('SELECT 1')).rejects.not.toBeInstanceOf(ProductionWriteRefused);
    expect(productionWriteLedger().attempted).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ENDPOINT HALF · the path the incident actually took.

describe('WRITE BARRIER · the endpoint the simulator wrote through', () => {
  const SIM = headers({ [CLIENT_ENV_HEADER]: 'simulator' });
  const PHONE = headers({ 'user-agent': 'Faff/250 CFNetwork' });
  const PROD_ENV = { DATABASE_URL: PROD_SHAPED };
  const LOCAL_ENV = { DATABASE_URL: LOOPBACK };

  it('refuses the ingest POST from a simulator build against production', () => {
    const v = judgeRequest({ method: 'POST', pathname: '/api/ingest/workout', header: SIM, env: PROD_ENV });
    expect(v.refuse).toBe(true);
    expect(v.reason).toMatch(/production/);
  });

  it('refuses the watch completion POST too, and a PATCH, and a DELETE', () => {
    for (const [method, p] of [
      ['POST', '/api/watch/workouts/complete'],
      ['POST', '/api/run/manual'],
      ['PATCH', '/api/race/cim'],
      ['DELETE', '/api/runs/12345'],
    ] as const) {
      expect(judgeRequest({ method, pathname: p, header: SIM, env: PROD_ENV }).refuse, `${method} ${p}`).toBe(true);
    }
  });

  it('refuses when the server CANNOT PROVE it is not production (Rule 11)', () => {
    const v = judgeRequest({ method: 'POST', pathname: '/api/ingest/workout', header: SIM, env: { DATABASE_URL: WEIRD } });
    expect(v.refuse).toBe(true);
    expect(v.reason).toMatch(/CANNOT PROVE/);
    expect(classifyServerPosture({ DATABASE_URL: WEIRD }).posture).toBe('indeterminate');
  });

  it('refuses a self-declared harness even without the simulator stamp', () => {
    const v = judgeRequest({
      method: 'POST', pathname: '/api/ingest/workout',
      header: headers({ [VERIFICATION_HEADER]: 'p0-proof' }), env: PROD_ENV,
    });
    expect(v.refuse).toBe(true);
  });

  it('NEVER touches the runner’s real phone', () => {
    for (const [method, p] of [
      ['POST', '/api/ingest/workout'],
      ['POST', '/api/watch/workouts/complete'],
      ['PATCH', '/api/profile'],
    ] as const) {
      const v = judgeRequest({ method, pathname: p, header: PHONE, env: PROD_ENV });
      expect(v.refuse, `blocked the real app: ${method} ${p}`).toBe(false);
      expect(v.client).toBe('unstamped');
    }
  });

  it('leaves reads alone, so Rule 13 verification still works', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      expect(judgeRequest({ method: m, pathname: '/api/v5/today', header: SIM, env: PROD_ENV }).refuse).toBe(false);
    }
  });

  it('lets a simulator sign in, and says so out loud', () => {
    const v = judgeRequest({ method: 'POST', pathname: '/api/auth/email', header: SIM, env: PROD_ENV });
    expect(v.refuse).toBe(false);
    expect(v.reason).toMatch(/auth path/);
  });

  it('lets a developer’s simulator write a LOCAL server', () => {
    const v = judgeRequest({ method: 'POST', pathname: '/api/ingest/workout', header: SIM, env: LOCAL_ENV });
    expect(v.refuse).toBe(false);
    expect(v.reason).toMatch(/non-production/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIVE · against the real production connection string, when one is present.
// Skips cleanly without credentials, exactly as `_postrun_live.audit.test.ts`
// and `_voice_live.audit.test.ts` do. A skip is not a pass.

describe.skipIf(!HAS_DATABASE)(`WRITE BARRIER · LIVE, against the real DATABASE_URL (${NO_DATABASE_REASON})`, () => {
  beforeEach(() => resetProductionWriteLedger());

  it('classifies the configured database and refuses a write to the owner’s account', async () => {
    const target = classifyDatabaseTarget();
    // Whatever it is, it must not be something the barrier will write.
    // On a developer machine and in CI this is `crossover.proxy.rlwy.net` and
    // resolves to `production`; a loopback URL here would legitimately permit.
    if (target.kind === 'local') {
      expect(targetPermitsWrites(target)).toBe(true);
      return; // a loopback database is not the case this section is about
    }

    expect(target.kind).toBe('production');

    // A pool of its own, not the app singleton. The headline section above
    // repoints `process.env.DATABASE_URL` at a production-SHAPED url with
    // nonsense credentials, and `lib/db/pool.ts` captures its connection string
    // once, at construction — so in a whole-file run the singleton is already
    // bound to those credentials by the time this test runs. That is a fact
    // about pg's pool, not about the barrier, and it is worth stating rather
    // than working around silently: the prototype patch applies to THIS pool
    // exactly as it does to the app's, which is the property being proven.
    const pgMod = await import('pg');
    const pool = new pgMod.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });

    // Read first — this is allowed, connects for real, and gives the after-check
    // something to compare against.
    const before = (await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM runs WHERE user_uuid = $1::uuid`, [OWNER],
    )).rows[0].n;

    await expect(pool.query(
      `INSERT INTO runs (user_uuid, data, provenance, fetched_at)
       VALUES ($1::uuid, $2::jsonb, '{}'::jsonb, NOW())`,
      [OWNER, JSON.stringify({ clientWorkoutId: 'barrier-proof', distanceMi: 0.01 })],
    )).rejects.toBeInstanceOf(ProductionWriteRefused);

    const after = (await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM runs WHERE user_uuid = $1::uuid`, [OWNER],
    )).rows[0].n;

    expect(after, 'a row reached production').toBe(before);
    expect(productionWriteLedger().sentence).toBe('1 write attempted, 0 issued');
    await pool.end().catch(() => {});
  });
});
