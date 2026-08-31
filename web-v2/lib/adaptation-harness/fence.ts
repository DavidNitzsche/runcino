/**
 * lib/adaptation-harness/fence.ts · the harness may not touch production.
 *
 * The owner's live plan is authored and adapted by the real cron against the
 * real database. This harness drives those same functions — `detectAdaptations`,
 * `applyAdaptations`, `tryAdaptiveBump`, `applyProgressionReshape` — and every
 * one of them writes. So the single most important property of the harness is
 * not what it asserts; it is that it CANNOT run anywhere except its own local
 * scratch database.
 *
 * Three independent fences stand between this code and production. Any one of
 * them is sufficient, and they fail in different ways so a single mistake
 * cannot take out more than one:
 *
 *   1. PRIVILEGE. The only production connection the harness opens at all is
 *      `DATABASE_URL_RO` in `scripts/adapt-harness-substrate.sh`, whose role is
 *      `faff_readonly`. The substrate script refuses to run if `current_user`
 *      does not look read-only. A write through that role is refused by
 *      Postgres, not by our care.
 *   2. ENVIRONMENT. `scripts/adapt-harness.sh` exports `DATABASE_URL` pointing
 *      at localhost before vitest starts. `vitest.setup.ts` never overrides an
 *      already-set variable (see its header), so a `.env.local` holding the
 *      production URL cannot win the race.
 *   3. THIS FILE. Checked at run time, before the first query, on every entry
 *      point. It parses the live `DATABASE_URL` and throws unless the host is
 *      loopback AND the database name is the harness's own. A URL that merely
 *      "looks local" is not enough — the name has to match, so pointing the
 *      harness at the sandbox or at `faffperf` also aborts.
 *
 * Rule 18 · this fence has been falsified. `_fence.test.ts` runs it against a
 * production-shaped URL and asserts it throws, and against the harness URL and
 * asserts it does not. A fence that has never refused anything is a hypothesis.
 */

/** The database the harness owns. Nothing else is an acceptable target. */
export const HARNESS_DB_NAME = process.env.FAFF_HARNESS_DB || 'faff_adapt_harness';

/** The owner. Rule 14: this is the uuid, never the shared `'me'` sentinel. */
export const OWNER_UUID =
  process.env.FAFF_HARNESS_OWNER_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

export interface FenceVerdict {
  ok: boolean;
  /** Why it refused. Present exactly when `ok` is false — Rule 11: a refusal
   *  is its own state and it carries its reason. */
  refusal?: string;
  host?: string;
  database?: string;
}

/**
 * Pure predicate over a connection string, so the fence can be falsified
 * without a database and without mutating `process.env`.
 */
export function inspectConnectionString(url: string | undefined | null): FenceVerdict {
  if (!url) {
    return { ok: false, refusal: 'DATABASE_URL is not set. The harness will not fall back to a default — a default is how a harness ends up on production.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, refusal: 'DATABASE_URL is not a parseable URL, so the fence cannot prove it is local.' };
  }
  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, '');
  if (!LOOPBACK.has(host)) {
    return { ok: false, refusal: `DATABASE_URL points at host '${host}', which is not loopback. The harness only runs against its own local scratch database.`, host, database };
  }
  if (database !== HARNESS_DB_NAME) {
    return { ok: false, refusal: `DATABASE_URL names database '${database}', not '${HARNESS_DB_NAME}'. Being local is not enough — the harness truncates and rewrites every table it touches, so it must own the database it is pointed at.`, host, database };
  }
  return { ok: true, host, database };
}

/**
 * Assert the fence, or throw. Call this before anything imports the pool.
 *
 * Throwing rather than skipping is deliberate. A harness that quietly skips
 * when it is misconfigured reports "0 failures", and Rule 18 guard 2 is that
 * reporting clean because you looked at nothing is the worst outcome available.
 */
export function assertHarnessDatabase(url: string | undefined = process.env.DATABASE_URL): void {
  const v = inspectConnectionString(url);
  if (!v.ok) {
    throw new Error(
      `[adaptation-harness] REFUSING TO RUN · ${v.refusal}\n`
      + `Run it through scripts/adapt-harness.sh, which sets DATABASE_URL for you.`,
    );
  }
}
