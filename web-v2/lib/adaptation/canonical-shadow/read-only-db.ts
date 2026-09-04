/**
 * lib/adaptation/canonical-shadow/read-only-db.ts · THE EVIDENCE CONNECTION,
 * STRUCTURALLY INCAPABLE OF A WRITE.
 *
 * Every piece of evidence the live canonical shadow-evaluation loader reads —
 * runs, plan_workouts, plan_weeks, training_plans, races, profile — comes
 * through `roQuery()` in this file, never through the app's shared `pool`
 * (lib/db/pool.ts). Two independent fences, matching the posture
 * `lib/adaptation-harness/fence.ts` already takes for the replay harness and
 * the ALLOW-LIST classifier `lib/verify/production-barrier.ts` already
 * proved out for verification tooling — reused here rather than
 * re-invented, because a second, slightly different SQL classifier is
 * exactly the kind of drift Rule 16 exists to catch:
 *
 *   1. PRIVILEGE · a SEPARATE `pg.Pool`, opened with `DATABASE_URL_RO`
 *      (never `DATABASE_URL`), whose Postgres role (`faff_readonly`) cannot
 *      write at the permission level. If `DATABASE_URL_RO` is not set, this
 *      module refuses to construct a pool at all — Rule 23: ensure the
 *      precondition or refuse loudly, never proceed on a silent fallback to
 *      the writable pool.
 *   2. STATEMENT · `classifyStatement()`, imported from
 *      `lib/verify/production-barrier.ts` (the exact allow-list already
 *      proven against the incident that motivated it — SELECT / WITH /
 *      SHOW / EXPLAIN / transaction control only, everything else,
 *      including anything unparseable, refused). Applied to every
 *      statement BEFORE it reaches the wire, so a role mis-grant is not
 *      the only thing standing between this loader and a write.
 *
 * Either fence alone is sufficient; both together mean one misconfiguration
 * cannot take out the whole guarantee. `_never_mutates_plan.test.ts` proves
 * both are live rather than decorative.
 *
 * ── WHY A SEPARATE POOL, NOT `DATABASE_URL` OVERRIDDEN ON THE SHARED ONE ───
 *
 * The existing test-only pattern (`_shadow_compare.audit.test.ts`) overrides
 * `process.env.DATABASE_URL` before `lib/db/pool`'s module-level `new
 * Pool(...)` runs, so the WHOLE test process only ever holds the RO
 * connection. That works for a standalone vitest worker. It cannot work
 * here: this loader runs inside the same long-lived Next.js process as
 * every other request the app serves, which needs its normal writable
 * pool for everything else happening at the same time. A second, distinct
 * `Pool` — this file's `roPool` — is the only way to hold a strictly
 * read-only connection ALONGSIDE the app's normal one without narrowing
 * what the rest of the app can do.
 */
import { Pool } from 'pg';
import { classifyStatement } from '@/lib/verify/production-barrier';

/** Thrown instead of ever issuing a non-read statement over this connection. */
export class CanonicalShadowWriteRefused extends Error {
  constructor(reason: string, head: string) {
    super(
      `[canonical-shadow/read-only-db] REFUSED a non-read statement · ${reason}\n`
      + `  statement: ${head}\n`
      + `  This connection exists only to gather evidence for the canonical `
      + `Adaptation Engine's shadow evaluation. It is not permitted to write, `
      + `by design, not by convention.`,
    );
    this.name = 'CanonicalShadowWriteRefused';
  }
}

let roPool: Pool | null | undefined;

function buildRoPool(): Pool | null {
  const url = process.env.DATABASE_URL_RO;
  if (!url || url.trim() === '') {
    // Rule 23 · refuse loudly rather than silently falling back to the
    // writable pool. A caller that ignores this must not be able to reach
    // production data through this module at all.
    console.error(
      '[canonical-shadow/read-only-db] DATABASE_URL_RO is not set · the live '
      + 'canonical shadow evaluation cannot run without a dedicated read-only '
      + 'connection, and will not fall back to the writable pool.',
    );
    return null;
  }
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]|^postgres(ql)?:\/\/(localhost|127\.0\.0\.1)[:/]/
    .test(url);
  const p = new Pool({
    connectionString: url,
    ssl: isLocalDb ? undefined : { rejectUnauthorized: false },
    // Deliberately small and short-lived: this loader runs once per athlete
    // per cron cycle, never holds a connection across a request, and must
    // never compete with the app's own pool for Railway's connection cap.
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
  });
  p.on('error', (err) => {
    console.error('[canonical-shadow/read-only-db] idle client error (recovered):', err.message);
  });
  return p;
}

/** Lazily constructed, once per process. `null` means "refused to build" —
 *  a distinguishable state from "not yet built", per Rule 11, so a caller
 *  can tell "no RO connection is configured" apart from "not asked for
 *  yet". Reset for tests only. */
function pool(): Pool | null {
  if (roPool === undefined) roPool = buildRoPool();
  return roPool;
}

/** Test-only: forget the cached pool so a test can rebuild it under a
 *  different `DATABASE_URL_RO`. Never called from application code. */
export function _resetReadOnlyPoolForTests(): void {
  roPool = undefined;
}

export interface RoQueryResult<R> {
  readonly rows: R[];
}

/**
 * The ONLY way this directory's loader is permitted to touch the database.
 * Every statement is classified before it is issued; anything not
 * recognisably a read is refused with a thrown error rather than silently
 * skipped, matching `production-barrier.ts`'s own "never a silent no-op"
 * rule — a swallowed refusal and a successful write look identical to a
 * caller that does not check.
 */
export async function roQuery<R = unknown>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<RoQueryResult<R>> {
  const cls = classifyStatement(sql);
  if (cls.mutating) {
    throw new CanonicalShadowWriteRefused(cls.reason, cls.head);
  }
  const p = pool();
  if (!p) {
    throw new Error(
      '[canonical-shadow/read-only-db] no read-only connection is configured '
      + '(DATABASE_URL_RO unset) · refusing rather than reading through the '
      + 'writable pool.',
    );
  }
  return p.query<any>(sql, params as any[]);
}

/** Whether a read-only connection is even configured, for a caller that
 *  wants to report "shadow evaluation skipped: no RO connection" rather
 *  than let the first query throw. */
export function readOnlyConnectionConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_RO && process.env.DATABASE_URL_RO.trim() !== '');
}
