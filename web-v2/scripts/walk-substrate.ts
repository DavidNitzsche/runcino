/**
 * scripts/walk-substrate.ts · a signed-in local copy of the runner, so the
 * phone can be WALKED against real data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Rule 13: a fix to something the runner sees is verified by RENDERING it, with
 * real data. Never a sample fixture, because a fixture skips the exact code
 * paths that break. The iPhone app talks to `http://localhost:3111`, and every
 * surface behind that is behind `requireUserId`, so a walk needs a session.
 *
 * There were only three ways to get one and two of them are forbidden:
 *
 *   1. Sign in as the owner. Needs his password. Never.
 *   2. Add a dev auth bypass to the app. A permanent security hole in the real
 *      product so that a verification run can be convenient. Never. Nothing in
 *      this file touches `lib/auth/session.ts`'s decision path; the session it
 *      creates is an ORDINARY ROW that the app's own resolver accepts on its
 *      own terms, and this script asserts that by calling that resolver.
 *   3. Copy the runner's rows into a local scratch database and mint a session
 *      THERE. That is this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REUSES RATHER THAN REBUILDS
 *
 * `scripts/adapt-harness-substrate.sh` already copies this runner's rows out of
 * production into a local scratch database, table by table, scoped by uuid,
 * with the CHECK-constraint and sequence handling that copy needs. It is
 * parameterised by `FAFF_HARNESS_DB`, so the walk points it at a database of
 * its own and calls it. There is ONE copier in this repo and this is not a
 * second one (Rule 16, and the Constitution's one-question-one-owner).
 *
 * The local-target predicate is `lib/adaptation-harness/fence.ts`'s
 * `inspectConnectionString`, for the same reason: "may I truncate and rewrite
 * the database this string names" already had an owner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW PRODUCTION IS PROTECTED. Four fences, any one sufficient, failing in
 * different ways so one mistake cannot take out more than one.
 *
 *   1 · PRIVILEGE. The only production connection this script opens is
 *       `DATABASE_URL_RO`, whose role is `faff_readonly`. The script asserts
 *       the role's name AND asks production itself whether that role holds
 *       INSERT/UPDATE/DELETE on the tables it reads. It refuses on any yes.
 *       This is proof from the server, not a claim from the client.
 *   2 · STATEMENT CLASSIFICATION AT THE CALL SITE. Every statement this script
 *       sends to production goes through `productionRead`, which runs
 *       `classifyStatement` — the write barrier's own allow-list — and throws
 *       before the driver sees anything that is not recognisably a read. The
 *       run reports how many statements it issued and how many were mutating,
 *       so "no write reached production" is a MEASUREMENT rather than a claim
 *       (Rule 20). The guard is falsified on every run against a statement that
 *       must be refused, so it has demonstrably said no (Rule 18).
 *
 *       This is here because the GLOBAL barrier does not cover it, and that is
 *       worth stating precisely rather than assuming. `installProductionWriteBarrier`
 *       patches `pg`'s prototypes, but the patched `query` calls `judge(text)`
 *       with no url, so the target it judges against is `process.env.DATABASE_URL`
 *       — which in this process is the LOOPBACK scratch database, because that
 *       is what the walk writes. A process holding two connections is fenced
 *       only for the one the environment names. So the global barrier protects
 *       the scratch write path and says nothing about the production read path.
 *       Fences 1 and 2 are what protect that one.
 *   3 · THE FENCE. `inspectConnectionString` refuses any `DATABASE_URL` that is
 *       not loopback and named `faff_visual_walk`. Checked before the first
 *       query, and falsifiable without a database.
 *   4 · THE COPIER'S OWN CHECK. `adapt-harness-substrate.sh` independently
 *       refuses to run if `DATABASE_URL_RO` connects as a role whose name does
 *       not look read-only. Its production traffic is a second channel this
 *       process does not classify: `psql` issuing `SELECT` and
 *       `\copy (SELECT …) TO STDOUT`. Both are reads by construction, and both
 *       run as `faff_readonly`, so fence 1 is what covers them. Said out loud
 *       because "no write reached production" has to account for every channel
 *       or it is a sentence about one of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT PROVE (Rule 22 · say what the gate cannot fail on)
 *
 *   · It is a SNAPSHOT. Anything written to production after the copy is
 *     invisible here, and anything the walk writes stays local. A screenshot
 *     off this substrate is evidence about the code, not about production's
 *     current row values.
 *   · No cron has run against it. `run-adaptations`, `plan-drift` and the
 *     notification jobs are not fired by standing the substrate up, so
 *     anything whose state is produced by a scheduled job is frozen at
 *     whatever production held when the copy was taken.
 *   · Third-party calls are not stubbed and not configured. Strava, Apple push
 *     and the weather provider have no credentials in a walk shell, so a
 *     surface that depends on a live external fetch will show its failure
 *     path, which is a real path but not the one under test.
 *   · It says nothing about the phone BINARY. It stands up the server half.
 *     Which build of the app points at port 3111 is a separate question, and
 *     the one that has burned this project before.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   bash scripts/walk-substrate.sh              # build it, print the token
 *   bash scripts/walk-server.sh                 # serve it on :3111
 *
 * Tear-down is in `docs/VISUAL_WALK_SUBSTRATE.md`.
 */

// Arms the production write barrier for THIS process before anything can
// query. `lib/db/pool` imports it too; installing twice is a no-op.
import '@/lib/verify/install-barrier';
import {
  barrierIsInstalled,
  classifyStatement,
  productionWriteLedger,
} from '@/lib/verify/production-barrier';
import { inspectConnectionString } from '@/lib/adaptation-harness/fence';
import { pool } from '@/lib/db/pool';
import { createSession, userIdFromRequest } from '@/lib/auth/session';
import { Client } from 'pg';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ config */

/** The runner whose rows are copied. Rule 14: the uuid, never `'me'`. */
const OWNER_UUID =
  process.env.FAFF_WALK_OWNER_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** The database the walk owns. Nothing else is an acceptable target. */
const WALK_DB = process.env.FAFF_WALK_DB || 'faff_visual_walk';

const WALK_PORT = process.env.FAFF_WALK_PORT || '3111';

const EXPECTED_URL = `postgresql://localhost:5432/${WALK_DB}`;

/**
 * `web-v2/`, resolved from this file rather than from the working directory,
 * so the script behaves the same however it was invoked. The bundler that runs
 * this (`scripts/_bundle-script.mjs`) emits into a `.script-bundle-` directory
 * one level down, so climb until `package.json` is found rather than counting
 * directories.
 */
function webV2Root(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))
      && fs.existsSync(path.join(dir, 'scripts', 'adapt-harness-substrate.sh'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('[walk] could not locate web-v2 from this script. Run it through scripts/walk-substrate.sh.');
}

const ROOT = webV2Root();

/* -------------------------------------------------------------- reporting */

function say(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s);
}

function refuse(why: string, ...detail: string[]): never {
  // eslint-disable-next-line no-console
  console.error(`\n[walk] REFUSING TO RUN\n  ${why}`);
  for (const d of detail) console.error(`  ${d}`);
  console.error('');
  process.exit(2);
}

/* ------------------------------------------------- fence 3 · the target */

/**
 * Checked FIRST, before a single query, and before the production credential is
 * even read. Falsify it with:
 *
 *   DATABASE_URL=postgresql://u:p@crossover.proxy.rlwy.net:20769/railway \
 *     bash scripts/walk-substrate.sh
 */
function assertWalkTarget(): void {
  const url = process.env.DATABASE_URL;
  const v = inspectConnectionString(url, WALK_DB);
  if (!v.ok) {
    refuse(
      v.refusal ?? 'the target connection string could not be proven local',
      `DATABASE_URL must be exactly ${EXPECTED_URL}`,
      'This script TRUNCATES and rewrites every table in the database it is pointed at.',
      'Run it through scripts/walk-substrate.sh, which sets DATABASE_URL for you.',
    );
  }
  say(`fence · target ${v.host}/${v.database} is loopback and is the walk's own database`);
}

/* ------------------------------------ fence 1 · production is read-only */

/** Tables the walk copies out of production. Used for the privilege proof. */
const PRIVILEGE_PROBE_TABLES = [
  'runs', 'plan_workouts', 'training_plans', 'races', 'users',
  'profile', 'user_prefs', 'coach_intents', 'shoes', 'sessions',
];

interface ReadOnlyProof {
  role: string;
  database: string;
  /** `table -> the privileges the role actually holds`. Empty is the pass. */
  writePrivileges: Record<string, string[]>;
  canCreate: boolean;
}

/** Every statement this run sent to production, in order. The measurement. */
const productionStatements: string[] = [];

/**
 * The ONLY way this script talks to production.
 *
 * `classifyStatement` is the write barrier's own allow-list: a statement passes
 * only if it is recognisably a read, and anything it fails to parse is refused.
 * Running it HERE rather than trusting the global barrier is deliberate — see
 * fence 2 in the header for why the global one does not cover this connection.
 *
 * Nothing is sent until the classifier has said "read", so a refusal is a
 * refusal before the wire, not an error message from production.
 */
async function productionRead<T extends Record<string, unknown>>(
  client: Client, sql: string, params?: unknown[],
): Promise<T[]> {
  const stmt = classifyStatement(sql);
  if (stmt.mutating) {
    refuse(
      'a statement aimed at PRODUCTION was not a read, and was refused before it was sent.',
      `  ${stmt.reason}`,
      `  ${stmt.head}`,
    );
  }
  productionStatements.push(stmt.head);
  const r = await client.query(sql, params);
  return r.rows as T[];
}

/**
 * Rule 18 · falsify the guard on every run, so it has demonstrably refused
 * something rather than merely never having been asked.
 *
 * Cheap, pure, and sends nothing anywhere. If `classifyStatement` ever stopped
 * recognising a plain UPDATE, `productionRead` would be decoration and this run
 * stops instead of proceeding on a guard it cannot show works.
 */
function falsifyTheReadGuard(): string {
  const mustRefuse = `UPDATE users SET tz = 'X' WHERE id = '${OWNER_UUID}'`;
  const verdict = classifyStatement(mustRefuse);
  if (!verdict.mutating) {
    refuse(
      'the read guard did not refuse a plain UPDATE.',
      '  classifyStatement called it a read, so productionRead would let a write through.',
      '  Nothing about this run can be trusted; it stops here.',
    );
  }
  const readVerdict = classifyStatement('SELECT current_user');
  if (readVerdict.mutating) {
    refuse(
      'the read guard refused a plain SELECT.',
      '  A guard that says no to everything is not a guard, it is an outage.',
    );
  }
  return verdict.reason;
}

/**
 * Ask PRODUCTION whether this role can write, rather than asserting that it
 * cannot. `has_table_privilege` is the server's own answer, so a mistyped
 * `.env.local` that handed us the read-write URL fails here even though every
 * comment in this file says "read only".
 */
async function proveProductionReadOnly(roUrl: string): Promise<ReadOnlyProof> {
  const client = new Client({
    connectionString: roUrl,
    ssl: /(localhost|127\.0\.0\.1)/.test(roUrl) ? undefined : { rejectUnauthorized: false },
    statement_timeout: 20_000,
  });
  await client.connect();
  try {
    const who = (await productionRead<{ role: string; db: string }>(
      client, 'SELECT current_user AS role, current_database() AS db',
    ))[0];

    const priv = await productionRead<{ tbl: string; privs: string[] }>(
      client,
      `SELECT t.tbl,
              ARRAY_REMOVE(ARRAY[
                CASE WHEN has_table_privilege(t.tbl, 'INSERT')   THEN 'INSERT'   END,
                CASE WHEN has_table_privilege(t.tbl, 'UPDATE')   THEN 'UPDATE'   END,
                CASE WHEN has_table_privilege(t.tbl, 'DELETE')   THEN 'DELETE'   END,
                CASE WHEN has_table_privilege(t.tbl, 'TRUNCATE') THEN 'TRUNCATE' END
              ], NULL) AS privs
         FROM unnest($1::text[]) AS t(tbl)
        WHERE to_regclass('public.' || t.tbl) IS NOT NULL`,
      [PRIVILEGE_PROBE_TABLES],
    );

    const canCreate = (await productionRead<{ ok: boolean }>(
      client, `SELECT has_database_privilege(current_database(), 'CREATE') AS ok`,
    ))[0]?.ok === true;

    const writePrivileges: Record<string, string[]> = {};
    for (const r of priv) {
      if (r.privs && r.privs.length > 0) writePrivileges[r.tbl] = r.privs;
    }
    return { role: who.role, database: who.db, writePrivileges, canCreate };
  } finally {
    await client.end().catch(() => {
      // The proof is already taken; a failure to hang up cannot change it, and
      // there is nothing downstream that a refusal here would protect.
    });
  }
}


/* ------------------------------------------------------ the RO credential */

function readEnvLocal(key: string): string | null {
  const f = path.join(ROOT, '.env.local');
  if (!fs.existsSync(f)) return null;
  const line = fs.readFileSync(f, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  if (!line) return null;
  const v = line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  return v === '' ? null : v;
}

/* ---------------------------------------------------------- the substrate */

function copyProductionRows(roUrl: string): void {
  say(`\ncopier · scripts/adapt-harness-substrate.sh --refresh  →  ${WALK_DB}`);
  execFileSync('bash', [path.join(ROOT, 'scripts', 'adapt-harness-substrate.sh'), '--refresh'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      FAFF_HARNESS_DB: WALK_DB,
      FAFF_HARNESS_OWNER_UUID: OWNER_UUID,
      DATABASE_URL_RO: roUrl,
    },
  });
}

/**
 * Liveness, per Rule 18 guard 2. A walk substrate that copied nothing and
 * reported success is the worst outcome available, because the screenshots
 * would then be of an empty account under a confident headline.
 *
 * The floors are deliberately crude — they are asserting "this is a real
 * runner's history", not a particular number that would rot every week.
 */
const LIVENESS_FLOORS: Array<{ table: string; min: number; why: string }> = [
  { table: 'runs', min: 200, why: 'the executed history every recap and trend reads' },
  { table: 'plan_workouts', min: 200, why: 'the prescription Today and Block render' },
  { table: 'training_plans', min: 1, why: 'without one, every plan surface refuses' },
  { table: 'races', min: 1, why: 'v5 is race-mode; no race means notOnPhoneYet everywhere' },
  { table: 'users', min: 1, why: 'the account the session points at' },
  { table: 'profile', min: 1, why: 'LTHR, VDOT and the anchors every pace is priced from' },
  { table: 'user_prefs', min: 1, why: 'long-run day, which is where the training week ends' },
];

async function countRows(table: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${table}`);
  return Number(rows[0].n);
}

async function assertSubstrateIsReal(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const short: string[] = [];
  for (const f of LIVENESS_FLOORS) {
    const n = await countRows(f.table);
    counts[f.table] = n;
    say(`  ${f.table.padEnd(16)} ${String(n).padStart(6)}${n < f.min ? `   under ${f.min}` : ''}`);
    if (n < f.min) short.push(`${f.table}: ${n} rows, expected at least ${f.min} (${f.why})`);
  }
  // Tables with no floor but worth showing, because a walk that finds them
  // empty should know that BEFORE someone reads a screenshot as a defect.
  for (const t of ['coach_intents', 'shoes', 'health_samples', 'readiness_snapshots', 'plan_weeks']) {
    const n = await countRows(t).catch(() => -1);
    counts[t] = n;
    say(`  ${t.padEnd(16)} ${n < 0 ? '     ?' : String(n).padStart(6)}`);
  }
  if (short.length > 0) {
    refuse('the substrate is not a real runner.', ...short);
  }
  return counts;
}

/* -------------------------------------------------------------- the session */

/**
 * Mint the walk's session THROUGH the app's own `createSession`, and then prove
 * it by asking the app's own `userIdFromRequest` to resolve it.
 *
 * Both halves matter. Writing the row by hand would make this file a second
 * owner of the token contract — the hash, the column, the expiry, the
 * `user_id`/`user_uuid` pair — and a second owner drifts. Resolving it through
 * the reader is what turns "I inserted a row" into "the app accepts this
 * token", which is the only claim worth printing.
 *
 * Every copied production session is deleted first, so the token printed below
 * is the ONLY key to this database. That also makes the curl proof airtight:
 * a 200 cannot have come from some other credential.
 */
async function mintWalkSession(): Promise<string> {
  const cleared = await pool.query('DELETE FROM sessions');
  say(`\nsession · cleared ${cleared.rowCount ?? 0} copied session rows from the scratch database`);

  const { token, expiresAt } = await createSession(OWNER_UUID, { kind: 'visual-walk' });

  const resolved = await userIdFromRequest({
    headers: new Headers({ authorization: `Bearer ${token}` }),
  });
  if (resolved !== OWNER_UUID) {
    refuse(
      'the app\'s own session resolver did not accept the token this script just minted.',
      `  userIdFromRequest returned ${resolved === null ? 'null' : resolved}`,
      `  expected ${OWNER_UUID}`,
      'Something about the session contract changed. The walk will not print a token it',
      'cannot demonstrate works.',
    );
  }
  say(`session · minted and RESOLVED through lib/auth/session · expires ${expiresAt.slice(0, 10)}`);
  return token;
}

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  say('faff · visual walk substrate\n');

  // Fence 3, before anything else touches a database.
  assertWalkTarget();

  const roUrl = process.env.DATABASE_URL_RO ?? readEnvLocal('DATABASE_URL_RO');
  if (!roUrl) {
    refuse(
      'DATABASE_URL_RO is not set and web-v2/.env.local does not carry it.',
      'The walk reads production through the read-only role and through nothing else.',
      'It will not fall back to DATABASE_URL. A fallback is how a copier ends up writing production.',
    );
  }
  if (roUrl === process.env.DATABASE_URL) {
    refuse('DATABASE_URL_RO is the same string as DATABASE_URL. That is not a read-only connection to production, it is the scratch database wearing the wrong name.');
  }

  // Fence 2, falsified before it is relied on.
  if (!barrierIsInstalled()) {
    refuse(
      'the production write barrier is not armed in this process.',
      'Run this through scripts/walk-substrate.sh, which sets FAFF_VERIFICATION=1.',
      'It fences the SCRATCH write path; the read guard below fences the production one.',
    );
  }
  const guardReason = falsifyTheReadGuard();
  say(`read guard · refused a plain UPDATE before sending · ${guardReason}`);

  // Fence 1, proved by production rather than claimed by us.
  const proof = await proveProductionReadOnly(roUrl);
  const looksReadOnly = /readonly|read_only|_ro$/i.test(proof.role);
  const heldPrivileges = Object.entries(proof.writePrivileges);
  if (!looksReadOnly || heldPrivileges.length > 0 || proof.canCreate) {
    refuse(
      `the production connection is not read-only. Role '${proof.role}' on '${proof.database}'.`,
      ...heldPrivileges.map(([t, p]) => `  holds ${p.join('/')} on ${t}`),
      ...(proof.canCreate ? ['  holds CREATE on the database'] : []),
      ...(looksReadOnly ? [] : ['  and the role name does not look read-only']),
    );
  }
  say(
    `privilege · production role '${proof.role}' on '${proof.database}' holds no INSERT/UPDATE/DELETE/TRUNCATE\n`
    + `            on any of the ${PRIVILEGE_PROBE_TABLES.length} tables this walk reads, and no CREATE on the database.`,
  );

  copyProductionRows(roUrl);

  say('\nliveness · rows in the scratch database');
  await assertSubstrateIsReal();

  const token = await mintWalkSession();

  // The FILE is what every later command reads, so the file is what has to be
  // proved — not the string that was in memory a moment ago. Found the hard
  // way: a run that died between clearing the sessions table and minting left
  // `.walk-session-token` holding a token for a database that had since been
  // dropped and rebuilt, and every request 401'd while the file looked fine.
  // Rule 11 — a stale credential and a wrong one are different facts, and a
  // file nothing re-reads can be neither.
  const tokenFile = path.join(ROOT, '.walk-session-token');
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  const fromDisk = fs.readFileSync(tokenFile, 'utf8').trim();
  const resolvedFromDisk = await userIdFromRequest({
    headers: new Headers({ authorization: `Bearer ${fromDisk}` }),
  });
  if (resolvedFromDisk !== OWNER_UUID) {
    refuse(
      'the token written to .walk-session-token does not resolve against this database.',
      `  the file holds ${fromDisk.slice(0, 12)}…`,
      '  Every command printed below reads that file, so a substrate that cannot',
      '  prove the file works has not been stood up.',
    );
  }
  say('session · the token ON DISK resolves to the runner through the app\'s own reader');

  const ledger = productionWriteLedger();

  say('\n' + '='.repeat(74));
  say('SUBSTRATE READY');
  say('='.repeat(74));
  say(`  database   ${EXPECTED_URL}`);
  say(`  runner     ${OWNER_UUID}`);
  say(
    `  production ${productionStatements.length} statements issued by this process, `
    + '0 mutating (each was classified before it was sent)',
  );
  say(`             pg-prototype barrier ledger: ${ledger.sentence}`);
  say('');
  say('  session token');
  say(`    ${token}`);
  say(`    also written to web-v2/.walk-session-token (gitignored, mode 600)`);
  say('');
  say(`  1 · serve it on :${WALK_PORT}`);
  say('        bash web-v2/scripts/walk-server.sh');
  say('      or, spelled out:');
  say(`        cd web-v2 && DATABASE_URL='${EXPECTED_URL}' \\`);
  say(`          DATABASE_URL_RO='${EXPECTED_URL}' FAFF_DB_TARGET=local \\`);
  say(`          npx next dev -p ${WALK_PORT}`);
  say('');
  say('  2 · prove the session works');
  say(`        curl -sS -o /dev/null -w '%{http_code}\\n' \\`);
  say(`          -H "Authorization: Bearer $(cat web-v2/.walk-session-token)" \\`);
  say(`          http://localhost:${WALK_PORT}/api/v5/today`);
  say('');
  say('  3 · point the phone at it · native-v2 already targets http://localhost:3111');
  say('');
  say('  tear-down   dropdb -h localhost ' + WALK_DB + ' && rm -f web-v2/.walk-session-token');
  say('='.repeat(74));
}

await main();
await pool.end().catch(() => {
  // Nothing left to do with the pool; the work is committed and reported.
});
