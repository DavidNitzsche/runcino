/**
 * lib/observability/harness/fence.ts · the observability falsifier may not
 * touch production. Same shape as `lib/adaptation-harness/fence.ts` (Rule 16
 * — one predicate shape for "may I point a writing test at this database",
 * reused rather than re-derived).
 *
 * Two independent fences:
 *
 *   1. ENVIRONMENT. `scripts/observability-falsifier.sh` exports
 *      `DATABASE_URL` pointing at the local scratch database before vitest
 *      starts, and `vitest.observability.config.ts` loads no `setupFiles`,
 *      so `.env.local` is never read on this path.
 *   2. THIS FILE. Checked at run time, before the first query, in the
 *      falsifier's own `beforeAll`. Parses the live `DATABASE_URL` and
 *      throws unless the host is loopback AND the database name is this
 *      harness's own.
 *
 * Rule 18 · falsified in `_fence.test.ts` (not itself a `.harness.test.ts`,
 * since falsifying the fence needs no database at all — it's a pure string
 * predicate) against both a production-shaped URL (must throw) and the
 * harness's own URL (must not).
 */

export const OBSERVABILITY_SCRATCH_DB_NAME =
  process.env.FAFF_OBSERVABILITY_SCRATCH_DB || 'faff_observability_scratch';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

export interface FenceVerdict {
  ok: boolean;
  refusal?: string;
  host?: string;
  database?: string;
}

export function inspectConnectionString(url: string | undefined | null): FenceVerdict {
  if (!url) {
    return { ok: false, refusal: 'DATABASE_URL is not set. This tooling will not fall back to a default — a default is how a falsifier ends up on production.' };
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
    return { ok: false, refusal: `DATABASE_URL points at host '${host}', which is not loopback.`, host, database };
  }
  if (database !== OBSERVABILITY_SCRATCH_DB_NAME) {
    return { ok: false, refusal: `DATABASE_URL names database '${database}', not '${OBSERVABILITY_SCRATCH_DB_NAME}'.`, host, database };
  }
  return { ok: true, host, database };
}

export function assertObservabilityScratchDatabase(url: string | undefined = process.env.DATABASE_URL): void {
  const v = inspectConnectionString(url);
  if (!v.ok) {
    throw new Error(
      `[observability-harness] REFUSING TO RUN · ${v.refusal}\n`
      + `Run it through scripts/observability-falsifier.sh, which sets DATABASE_URL for you.`,
    );
  }
}
