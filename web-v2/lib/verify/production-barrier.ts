/**
 * lib/verify/production-barrier.ts · verification tooling must be INCAPABLE of
 * writing production, not merely instructed against it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INCIDENT
 *
 * An agent ran a live iOS-simulator session signed in as the owner's real
 * account. It wrote TWO junk activity rows into his actual training history —
 * `sim-recovery-live`, 0.27 mi each, `status=partial`. They were found,
 * measured (only two such rows existed in the entire database) and removed only
 * after he approved the delete. His ruling:
 *
 *   "The production simulator write was a serious process failure. Prevent
 *    recurrence technically: production-derived verification must be genuinely
 *    read-only. Simulator and automated test clients must be unable to post
 *    activities, complete workouts, or mutate my production account.
 *    ENVIRONMENT LABELLING OR CONNECTION-STRING POLICY ALONE IS INSUFFICIENT.
 *    Add a hard mutation barrier with a test proving production writes are
 *    refused during verification."
 *
 * The third sentence is the load-bearing one. The instruction that failed —
 * "production is read-only" — was a CONVENTION, and a convention that can be
 * satisfied to the letter while violated in substance is not a control. Note
 * also that the simulator never touched the database directly: it wrote through
 * the app's own ingest endpoint. A barrier that guarded only SQL would not have
 * stopped it, which is why `lib/verify/client-attestation.ts` is this file's
 * sibling and covers the HTTP half.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MADE THIS POSSIBLE, MEASURED RATHER THAN ASSERTED
 *
 * `vitest.setup.ts` loads `web-v2/.env.local` into every test process, and on a
 * developer machine that file's `DATABASE_URL` is the PRODUCTION READ-WRITE
 * url. 78 test files under `lib/**` reach `lib/db/pool`. Until this module
 * landed, the only things standing between any of them and the owner's live
 * training history were (a) `vitest.config.ts` excluding one directory by hand
 * and (b) `lib/adaptation-harness/fence.ts`, which protects that one directory.
 * Every other test file was one `pool.query('UPDATE …')` away from the
 * incident, and nothing would have reported it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THE BARRIER
 *
 *   1 · WHO IS FENCED — `classifyProcess()`. A verification process is
 *       identified STRUCTURALLY, by signals the runner itself sets: `VITEST`,
 *       `VITEST_WORKER_ID`, `NODE_ENV=test`, an argv that names vitest. Scripts
 *       may additionally opt IN with `FAFF_VERIFICATION=1`. There is
 *       deliberately NO WAY TO OPT OUT. A test cannot argue its way past this;
 *       removing it is a source edit, and `_production_write_barrier.test.ts`
 *       fails when it is removed.
 *
 *   2 · WHAT IS FENCED — `classifyStatement()`. An ALLOW-LIST, not a
 *       deny-list. A statement is permitted only if it is recognisably a read
 *       (SELECT / WITH-without-DML / SHOW / EXPLAIN / transaction control /
 *       SET / DISCARD). Everything else — including anything unparseable — is
 *       refused. A deny-list of INSERT|UPDATE|DELETE is exactly the check a
 *       `WITH x AS (…) INSERT` slips past.
 *
 *   3 · WHERE IT IS POINTED — `classifyDatabaseTarget()`. THREE outcomes, per
 *       Rule 11: production, local, and INDETERMINATE. Indeterminate refuses.
 *       A barrier that cannot tell where it is pointed and proceeds anyway is
 *       worse than no barrier, because it also reports confidence.
 *
 *       There is no environment variable that can mark a REMOTE database
 *       writable from a verification process. `FAFF_DB_TARGET=local` is honored
 *       only when the host is already loopback, so it can narrow the barrier's
 *       uncertainty and never its reach. That is the structural property this
 *       whole file exists to have: from inside a verification process, no
 *       remote database is writable, and no amount of configuration makes one.
 *
 *   4 · HOW IT REFUSES — loudly. `[write-barrier] REFUSED` on stderr, a
 *       counted ledger (`productionWriteLedger()` answers "N attempted, 0
 *       issued"), and a thrown `ProductionWriteRefused`. Never a silent no-op:
 *       a swallowed refusal and a successful write look identical to a caller
 *       that ignores the result, and this repo has shipped that mistake before
 *       (`lib/db/read.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE CANNOT DO (Rule 22 · state what the gate cannot fail on)
 *
 *   · It cannot stop a human, or the real application, writing production.
 *     That is deliberate — the app must keep working for the runner. The
 *     barrier engages only for processes `classifyProcess()` calls
 *     verification.
 *   · It cannot stop a process that never loads it. A standalone
 *     `scripts/*.mjs` that builds `new pg.Pool` and is run as plain `node`
 *     is outside this module's reach unless it imports `install-barrier` or is
 *     launched with the `--import` preload. 70 such scripts exist;
 *     `scripts/check-write-barrier.sh` is what keeps that set enumerated
 *     rather than invisible.
 *   · It cannot stop a write issued through a channel that is not this
 *     process's `pg` — a psql session, a Railway console, an HTTP call to the
 *     live app from a test (that is the sibling's job, and only for stamped
 *     clients).
 *   · It classifies STATEMENTS, not intent. A function volume-named
 *     `SELECT do_the_write()` would pass. Nothing in this repo has that shape,
 *     and `classifyStatement` refuses `CALL`/`DO` outright, but the limit is
 *     real and stated rather than glossed.
 */

/** Thrown instead of issuing a write. Named so a catch site can be specific. */
export class ProductionWriteRefused extends Error {
  readonly statement: string;
  readonly target: string;
  readonly why: string;
  constructor(args: { statement: string; target: string; why: string }) {
    super(
      `[write-barrier] REFUSED a write from a verification process · ${args.why}\n`
      + `  target:    ${args.target}\n`
      + `  statement: ${args.statement}\n`
      + `  This process is verification tooling (see lib/verify/production-barrier.ts).\n`
      + `  It cannot write a production or unidentified database. If you need a\n`
      + `  writable database, point DATABASE_URL at a LOOPBACK one you own —\n`
      + `  lib/adaptation-harness/fence.ts is the worked example.`,
    );
    this.name = 'ProductionWriteRefused';
    this.statement = args.statement;
    this.target = args.target;
    this.why = args.why;
  }
}

// ─── 1 · who is fenced ───────────────────────────────────────────────────────

export type ProcessClass = {
  /** True when this process is verification tooling and must not write. */
  readonly verification: boolean;
  /** The signal that decided it, for the log line and the report. */
  readonly reason: string;
};

/**
 * Is this process verification tooling?
 *
 * Every positive signal is set by the RUNNER, not by the code under test:
 * vitest exports `VITEST` and `VITEST_WORKER_ID` into every worker it spawns,
 * and `argv` names the binary. `FAFF_VERIFICATION=1` is the opt-in for a
 * hand-run script. The absence of an opt-OUT is the point.
 */
export function classifyProcess(
  env: Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv,
): ProcessClass {
  if (env.VITEST || env.VITEST_WORKER_ID) {
    return { verification: true, reason: 'vitest (VITEST / VITEST_WORKER_ID set by the runner)' };
  }
  if (env.FAFF_VERIFICATION === '1') {
    return { verification: true, reason: 'FAFF_VERIFICATION=1 (explicit opt-in)' };
  }
  if (env.NODE_ENV === 'test') {
    return { verification: true, reason: 'NODE_ENV=test' };
  }
  if (argv.some((a) => /(^|[\\/])vitest(\.[cm]?js)?$/.test(a) || /[\\/]vitest[\\/]/.test(a))) {
    return { verification: true, reason: 'argv names the vitest binary' };
  }
  return { verification: false, reason: 'not a verification process' };
}

// ─── 2 · what is fenced ──────────────────────────────────────────────────────

export type StatementClass = {
  readonly mutating: boolean;
  /** Why it was judged that way — quoted in the refusal. */
  readonly reason: string;
  /** The first ~120 chars, comments stripped, for logs. */
  readonly head: string;
};

/**
 * Strip leading SQL comments and whitespace so the first KEYWORD is what gets
 * judged. A statement that opens with `-- Rule 8 · …` is extremely common in
 * this repo and must not be classified on its comment.
 */
function stripLeadingNoise(sql: string): string {
  let s = sql;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, '');
    s = s.replace(/^--[^\n]*\n?/, '');
    s = s.replace(/^\/\*[\s\S]*?\*\//, '');
    if (s === before) return s;
  }
}

/**
 * Blank out single-quoted string literals before the deny-list runs.
 *
 * Without this, a perfectly good read whose WHERE clause mentions the word
 * "create" or "drop" in prose gets refused. The barrier fails closed by
 * design, but a false refusal is still a bug: it makes verification runs red
 * for a reason that has nothing to do with safety, and a suite that is red for
 * safety reasons is a suite people learn to ignore — which is the exact
 * argument `vitest.config.ts` already makes about the adaptation harness.
 *
 * Quoted IDENTIFIERS ("plan_workouts") are deliberately left alone: a table
 * name is part of the statement's meaning, not prose.
 */
function stripStringLiterals(sql: string): string {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Blank out SQL comments ANYWHERE in the statement, not just at the front.
 *
 * Found by running the whole suite against the armed barrier, which is the only
 * way this would ever have surfaced: `lib/training/vdot-inputs.ts` carries a
 * four-line `--` comment mid-query explaining a `::text::date` cast, and one of
 * its sentences is "which THIS CALL SITE swallows". `\bcall\s+` matched, the
 * deny-list called a read a procedure invocation, and a live pace-anchor read
 * was refused in four tests. Prose in a comment is not a statement.
 *
 * Literals are blanked BEFORE this runs, so a `--` inside a string cannot eat
 * the rest of the query.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Leading keywords that can only read. Anything not on this list is refused,
 * including anything this function fails to recognise.
 *
 * `BEGIN` / `COMMIT` / `ROLLBACK` / `SET` / `DISCARD` / `DEALLOCATE` are here
 * because the pg driver and the pool issue them on their own; refusing them
 * would break reads without protecting anything, since none of them can change
 * a row on its own. A transaction that opens and then attempts DML still has
 * every DML statement refused individually.
 */
const READ_ONLY_LEAD = /^(select|with|show|explain|values|table|begin|start\s+transaction|commit|rollback|end|savepoint|release|set|reset|discard|deallocate|prepare|close|fetch|listen|unlisten)\b/i;

/** DML/DDL keywords that disqualify a statement wherever they appear in it. */
const DML_ANYWHERE = /\b(insert\s+into|update\s+[a-z_"][\w".]*\s+set|delete\s+from|merge\s+into|truncate|drop\s+|alter\s+|create\s+|grant\s+|revoke\s+|refresh\s+materialized|copy\s+[a-z_"][\w".]*\s+from|do\s+\$|call\s+|vacuum|reindex|cluster\s+|comment\s+on|nextval\s*\(|setval\s*\()/i;

/**
 * Is this statement capable of changing the database?
 *
 * ALLOW-LIST. The default answer is "yes, refuse it" — for an unparseable
 * statement, an empty one, a non-string one, and anything whose leading keyword
 * is not recognisably a read.
 */
export function classifyStatement(sql: unknown): StatementClass {
  if (typeof sql !== 'string' || sql.trim() === '') {
    return { mutating: true, reason: 'statement is not a readable string', head: String(sql).slice(0, 120) };
  }
  const body = stripLeadingNoise(sql);
  const head = body.replace(/\s+/g, ' ').slice(0, 120);
  if (!READ_ONLY_LEAD.test(body)) {
    const lead = (body.match(/^[a-z_]+/i)?.[0] ?? '(none)').toUpperCase();
    return { mutating: true, reason: `leading keyword ${lead} is not on the read-only allow-list`, head };
  }
  // A `WITH … INSERT`, a `SELECT … INTO`, or DML smuggled past a read-shaped
  // opener. The deny-list is the SECOND check, never the only one.
  const bare = stripComments(stripStringLiterals(body));
  if (DML_ANYWHERE.test(bare)) {
    const m = bare.match(DML_ANYWHERE)?.[0]?.trim().toUpperCase() ?? 'DML';
    return { mutating: true, reason: `read-shaped statement contains ${m}`, head };
  }
  if (/^select\b[\s\S]*?\binto\s+[a-z_"]/i.test(bare)) {
    return { mutating: true, reason: 'SELECT … INTO creates a table', head };
  }
  if (/^explain\b[\s\S]*\banalyze\b/i.test(bare)) {
    return { mutating: true, reason: 'EXPLAIN ANALYZE executes the statement it explains', head };
  }
  if (/\bfor\s+(update|no\s+key\s+update|share)\b/i.test(bare) && /^select\b/i.test(bare)) {
    // Row locks do not change a row, but they block the real app mid-write.
    // A verification read has no business taking them.
    return { mutating: true, reason: 'SELECT … FOR UPDATE/SHARE locks production rows', head };
  }
  return { mutating: false, reason: 'read', head };
}

// ─── 3 · where it is pointed ─────────────────────────────────────────────────

export type TargetKind = 'production' | 'local' | 'indeterminate';

export type TargetClass = {
  readonly kind: TargetKind;
  readonly host: string | null;
  readonly database: string | null;
  /** Safe to log — never contains credentials. */
  readonly describe: string;
  readonly reason: string;
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/**
 * Hosts this project's production database has been served from. Matching one
 * is sufficient to call a target production; NOT matching one is never
 * sufficient to call it safe — that is what `indeterminate` is for.
 */
const KNOWN_PRODUCTION_HOST = /(^|\.)(rlwy\.net|railway\.app|railway\.internal|faff\.run)$/i;

/**
 * Where is this connection string pointed? Three answers, never two.
 *
 * Rule 11 is the whole design here. "I could not tell" is a fact, and it is a
 * different fact from "it is local". The barrier spends the first one as a
 * refusal, because the alternative is a barrier that fails OPEN — which is
 * worse than none, since it also reports confidence.
 */
export function classifyDatabaseTarget(
  urlArg?: string | undefined,
  env: Record<string, string | undefined> = process.env,
): TargetClass {
  // Resolved from `env`, not from a default parameter value. A default of
  // `process.env.DATABASE_URL` looks equivalent and is not: passing an explicit
  // `undefined` — which is exactly what a caller asking "what if it is unset?"
  // does — falls back to the default and silently reads the REAL environment.
  // The proof test caught that: `classifyDatabaseTarget(undefined, {})`
  // answered "production" on a machine with credentials, which is the classifier
  // agreeing with the environment instead of with its argument.
  const url = urlArg ?? env.DATABASE_URL;
  if (!url || url.trim() === '') {
    return {
      kind: 'indeterminate', host: null, database: null,
      describe: 'DATABASE_URL is not set',
      reason: 'no connection string · lib/db/pool.ts falls back to a libpq default, so unset is indistinguishable from wrong',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      kind: 'indeterminate', host: null, database: null,
      describe: 'DATABASE_URL is not a parseable URL',
      reason: 'unparseable connection string · the barrier cannot prove where this points',
    };
  }
  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, '') || null;
  const describe = `${host}:${parsed.port || '5432'}/${database ?? '(none)'}`;

  if (LOOPBACK.has(host) || host === 'host.docker.internal') {
    // `FAFF_DB_TARGET` may only ever CONFIRM loopback. It cannot promote a
    // remote host, which is why there is no way to configure this barrier off.
    return {
      kind: 'local', host, database, describe,
      reason: env.FAFF_DB_TARGET === 'local'
        ? 'loopback host, confirmed by FAFF_DB_TARGET=local'
        : 'loopback host',
    };
  }
  if (KNOWN_PRODUCTION_HOST.test(host)) {
    return { kind: 'production', host, database, describe, reason: `host ${host} is a known production host` };
  }
  return {
    kind: 'indeterminate', host, database, describe,
    reason: `host ${host} is neither loopback nor a known production host · refusing rather than guessing`,
  };
}

/** Writes are permitted only against a database the barrier can PROVE is local. */
export function targetPermitsWrites(t: TargetClass): boolean {
  return t.kind === 'local';
}

// ─── 4 · the ledger and the refusal ──────────────────────────────────────────

let attempted = 0;
let issued = 0;
const attempts: Array<{ head: string; reason: string; target: string; at: string }> = [];

/** "N writes attempted, 0 issued" — the sentence the harness precedent reports. */
export function productionWriteLedger(): {
  attempted: number;
  issued: number;
  attempts: ReadonlyArray<{ head: string; reason: string; target: string; at: string }>;
  sentence: string;
} {
  return {
    attempted, issued, attempts: attempts.slice(),
    sentence: `${attempted} write${attempted === 1 ? '' : 's'} attempted, ${issued} issued`,
  };
}

/** Test-only: forget what has been recorded. Never resets the barrier itself. */
export function resetProductionWriteLedger(): void {
  attempted = 0; issued = 0; attempts.length = 0;
}

/**
 * The decision, in one pure function, so the gate and the proof test can drive
 * it without a database and without a pg module.
 *
 * Returns `null` when the statement may proceed, or the refusal to throw.
 */
export function judge(
  sql: unknown,
  opts?: {
    env?: Record<string, string | undefined>;
    argv?: readonly string[];
    url?: string | undefined;
  },
): ProductionWriteRefused | null {
  const env = opts?.env ?? process.env;
  const proc = classifyProcess(env, opts?.argv ?? process.argv);
  if (!proc.verification) return null;

  const stmt = classifyStatement(sql);
  if (!stmt.mutating) return null;

  const target = classifyDatabaseTarget(opts?.url ?? env.DATABASE_URL, env);
  if (targetPermitsWrites(target)) return null;

  return new ProductionWriteRefused({
    statement: stmt.head,
    target: `${target.describe} · ${target.kind} · ${target.reason}`,
    why: `${proc.reason} · ${stmt.reason}`,
  });
}

/**
 * Record and shout. Separated from `judge` so the pure decision stays testable
 * without side effects, and so every enforcement point logs identically.
 */
export function recordRefusal(refusal: ProductionWriteRefused): void {
  attempted += 1;
  attempts.push({
    head: refusal.statement,
    reason: refusal.why,
    target: refusal.target,
    at: new Date().toISOString(),
  });
  // Loud, greppable, and on stderr. Parameters are NOT logged: they carry
  // session-token hashes and the runner's own data.
  console.error(
    `[write-barrier] REFUSED · ${refusal.why}\n`
    + `[write-barrier]   target: ${refusal.target}\n`
    + `[write-barrier]   statement: ${refusal.statement}\n`
    + `[write-barrier]   ledger: ${productionWriteLedger().sentence}`,
  );
}

/** Called by the install shim when a read is allowed through, for the ledger. */
export function recordIssuedWrite(): void {
  issued += 1;
}

// ─── the install shim ────────────────────────────────────────────────────────

const INSTALLED = Symbol.for('faff.production-write-barrier.installed');

export type InstallResult = {
  readonly installed: boolean;
  readonly alreadyInstalled: boolean;
  readonly process: ProcessClass;
  readonly target: TargetClass;
  /** One line, suitable for a startup log or a test assertion. */
  readonly summary: string;
};

type PgLike = {
  Client?: { prototype: Record<string, unknown> };
  Pool?: { prototype: Record<string, unknown> };
};

/**
 * Patch `pg`'s `Client.prototype.query` and `Pool.prototype.query` so a
 * mutating statement never reaches the wire.
 *
 * Patching the PROTOTYPE rather than one pool instance is what makes this
 * structural: it covers `lib/db/pool.ts`, a test that constructs its own
 * `new Pool(...)`, a client checked out of a pool for a transaction, and any
 * pool a future file adds. Nothing has to remember to route through a wrapper.
 *
 * Idempotent — the symbol guard means installing from both `vitest.setup.ts`
 * and `lib/db/pool.ts` patches once.
 */
export function installProductionWriteBarrier(pg: PgLike): InstallResult {
  const proc = classifyProcess();
  const target = classifyDatabaseTarget();

  const already = Boolean((globalThis as Record<PropertyKey, unknown>)[INSTALLED]);
  if (already) {
    return {
      installed: true, alreadyInstalled: true, process: proc, target,
      summary: `[write-barrier] already installed · ${proc.reason} · target ${target.describe} (${target.kind})`,
    };
  }

  if (!proc.verification) {
    // The real application must keep writing. Not installing here is the whole
    // reason the barrier can be absolute inside verification.
    return {
      installed: false, alreadyInstalled: false, process: proc, target,
      summary: '[write-barrier] not installed · this is not a verification process',
    };
  }

  const patch = (proto: Record<string, unknown> | undefined, label: string) => {
    if (!proto || typeof proto.query !== 'function') return;
    const original = proto.query as (...args: unknown[]) => unknown;
    proto.query = function patched(this: unknown, ...args: unknown[]) {
      const first = args[0];
      const text = typeof first === 'string'
        ? first
        : (first as { text?: unknown } | null)?.text;
      const refusal = judge(text);
      if (refusal) {
        recordRefusal(refusal);
        // A callback-style caller must also see the refusal, not a hang.
        const cb = args.find((a) => typeof a === 'function') as
          | ((e: Error) => void) | undefined;
        if (cb) { cb(refusal); return undefined; }
        return Promise.reject(refusal);
      }
      return original.apply(this, args);
    };
    (proto.query as { __faffBarrier?: string }).__faffBarrier = label;
  };

  patch(pg.Client?.prototype, 'Client');
  patch(pg.Pool?.prototype, 'Pool');
  (globalThis as Record<PropertyKey, unknown>)[INSTALLED] = true;

  const summary = `[write-barrier] ARMED · ${proc.reason} · target ${target.describe} (${target.kind}) · writes ${targetPermitsWrites(target) ? 'permitted (loopback)' : 'REFUSED'}`;
  console.error(summary);
  return { installed: true, alreadyInstalled: false, process: proc, target, summary };
}

/** Whether the prototype patch is in place in this process. */
export function barrierIsInstalled(): boolean {
  return Boolean((globalThis as Record<PropertyKey, unknown>)[INSTALLED]);
}
