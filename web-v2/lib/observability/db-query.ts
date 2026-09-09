/**
 * lib/observability/db-query.ts · opt-in wrapper for a Postgres call a route
 * wants explicitly attributed to DATABASE_POOL rather than left to
 * `classify.ts`'s heuristic tier.
 *
 * The heuristic tier already recognizes real Postgres SQLSTATEs and
 * `pg-pool`'s own fixed timeout/idle-death messages without any call site
 * changing anything (see `classify.ts`'s header) — so most `pool.query(...)`
 * call sites need NOT be migrated to this wrapper for baseline DATABASE_POOL
 * classification to work. `observedQuery` exists for the narrower case: a
 * route that catches a DB error itself (to add its own context) and wants
 * the class to survive that re-wrap with certainty rather than heuristic.
 *
 * BOUNDED SCOPE, same posture as `upstream-fetch.ts`: not retrofitted across
 * the codebase's existing `pool.query` call sites.
 */
import type { Pool, QueryResultRow } from 'pg';
import { tagDatabaseError } from './classify';

export async function observedQuery<T extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  try {
    return await pool.query<T>(text, params);
  } catch (err) {
    throw tagDatabaseError(err);
  }
}
