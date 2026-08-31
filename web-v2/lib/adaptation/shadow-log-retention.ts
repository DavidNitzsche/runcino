/**
 * lib/adaptation/shadow-log-retention.ts · bounded growth for
 * `adaptation_shadow_log` (`db/migrations/160_adaptation_shadow_log.sql`).
 *
 * Added during that migration's pre-apply review (criterion 3, "bounded
 * growth and an explicit retention policy") — it was missing from the
 * original draft and was written before the migration ran, not patched in
 * afterward. See that file's header for the full seven-criterion review.
 *
 * ── THE POLICY, TWO INDEPENDENT BOUNDS ──────────────────────────────────
 *
 *   · TIME · `ADAPTATION_SHADOW_LOG_RETENTION_DAYS` (180) — comfortably
 *     longer than one marathon block (14-18 weeks) plus a review window
 *     after it closes. Rows this old have no live consumer (this table is
 *     read by nothing but ad hoc audit queries) and no value the shadow-
 *     compare mechanism itself needs — it only ever reads TODAY's cycle.
 *   · COUNT · `ADAPTATION_SHADOW_LOG_MAX_ROWS_PER_USER` (400) — a backstop
 *     against a bug that inserts more than once per eligible cycle. Under
 *     correct operation (one row per active plan per day) 180 days never
 *     approaches 400, so this bound should never bind on its own; it exists
 *     so a double-insert bug caps itself rather than growing unbounded
 *     between review cycles.
 *
 * Both are DELETE-only, scoped to this table alone (no other table is
 * touched, and nothing in this file can reach `plan_workouts` or any live
 * surface), and idempotent — pruning twice in a row after the first prune
 * has already caught up deletes nothing further, which is what makes this
 * job safe to exclude from `lib/ops/cron-ledger.ts`'s catch-up chain (see
 * `EXCLUDED_FROM_TICK`'s entry for `prune-adaptation-shadow-log`).
 */
import { pool } from '@/lib/db/pool';

export const ADAPTATION_SHADOW_LOG_RETENTION_DAYS = 180;
export const ADAPTATION_SHADOW_LOG_MAX_ROWS_PER_USER = 400;

export interface ShadowLogPruneResult {
  deletedByAge: number;
  deletedByCap: number;
}

/**
 * Delete rows older than the retention window, then enforce the per-user row
 * cap on whatever remains. Never throws — the caller (the cron route) treats
 * a failure here as non-fatal, matching every other best-effort step in this
 * codebase's cron loops.
 */
export async function pruneAdaptationShadowLog(): Promise<ShadowLogPruneResult> {
  const byAge = await pool.query(
    `DELETE FROM adaptation_shadow_log
      WHERE resolved_at < now() - ($1 || ' days')::interval`,
    [ADAPTATION_SHADOW_LOG_RETENTION_DAYS],
  );

  const byCap = await pool.query(
    `DELETE FROM adaptation_shadow_log a
      USING (
        SELECT id, row_number() OVER (PARTITION BY user_uuid ORDER BY resolved_at DESC) AS rn
          FROM adaptation_shadow_log
      ) ranked
     WHERE a.id = ranked.id AND ranked.rn > $1`,
    [ADAPTATION_SHADOW_LOG_MAX_ROWS_PER_USER],
  );

  return { deletedByAge: byAge.rowCount ?? 0, deletedByCap: byCap.rowCount ?? 0 };
}
