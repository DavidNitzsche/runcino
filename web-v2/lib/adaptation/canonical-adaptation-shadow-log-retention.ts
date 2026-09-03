/**
 * lib/adaptation/canonical-adaptation-shadow-log-retention.ts · bounded
 * growth for `canonical_adaptation_shadow_log`
 * (`db/migrations/164_canonical_adaptation_shadow_log.sql`).
 *
 * The exact sibling of `lib/adaptation/shadow-log-retention.ts` (the older
 * PACE-only table's retention), scaled for THREE rows per cycle instead of
 * one — every `evaluateAdaptation()` call emits one record per lever
 * (THRESHOLD_PACE, WEEKLY_VOLUME, LONG_RUN), so this table accumulates
 * roughly 3x as fast per eligible cycle. The per-user cap is scaled by the
 * same factor (1200 = 400 × 3) so it binds at the same CYCLE COUNT as the
 * pace table's cap does, not at a different point in the runner's history.
 *
 * Deliberately OUTSIDE `lib/adaptation/canonical-shadow/` — that directory's
 * own gate (`_never_mutates_plan.test.ts`) allow-lists exactly one write
 * shape (a single INSERT against this table, via `shadow-log-writer.ts`),
 * and a DELETE-based retention job is a genuinely different write with a
 * different authorization story. Keeping it here, alongside the pace
 * table's own retention file, is Rule 16: one kind of write, one home.
 *
 * Both bounds below are DELETE-only, scoped to this table alone, and
 * idempotent.
 */
import { pool } from '@/lib/db/pool';
import { logReadFailure } from '@/lib/db/read';

export const CANONICAL_ADAPTATION_SHADOW_LOG_RETENTION_DAYS = 180;
export const CANONICAL_ADAPTATION_SHADOW_LOG_MAX_ROWS_PER_USER = 1200;

export interface CanonicalShadowLogPruneResult {
  deletedByAge: number;
  deletedByCap: number;
  /** `false` when the table does not exist yet (migration 164 not applied)
   *  — a probe, not an error, matching the persistence code's own posture. */
  ran: boolean;
}

async function tableExists(): Promise<boolean> {
  try {
    const r = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.canonical_adaptation_shadow_log')::text AS reg`,
    );
    return r.rows[0]?.reg != null;
  } catch (e) {
    // Rule 11 · logged rather than silently folded into the same `false` a
    // genuinely absent table returns. The consequence for THIS caller is
    // identical either way (skip pruning, report ran:false) and that is the
    // argued simplification — but the failure itself must stay visible in
    // the logs rather than reading as an ordinary pre-migration state.
    logReadFailure('canonical-adaptation-shadow-log-retention/tableExists', e);
    return false;
  }
}

/** Never throws — the caller treats a failure here as non-fatal, matching
 *  every other best-effort step in this codebase's cron loops. */
export async function pruneCanonicalAdaptationShadowLog(): Promise<CanonicalShadowLogPruneResult> {
  if (!(await tableExists())) {
    return { deletedByAge: 0, deletedByCap: 0, ran: false };
  }

  const byAge = await pool.query(
    `DELETE FROM canonical_adaptation_shadow_log
      WHERE resolved_at < now() - ($1 || ' days')::interval`,
    [CANONICAL_ADAPTATION_SHADOW_LOG_RETENTION_DAYS],
  );

  const byCap = await pool.query(
    `DELETE FROM canonical_adaptation_shadow_log a
      USING (
        SELECT id, row_number() OVER (PARTITION BY user_uuid ORDER BY resolved_at DESC) AS rn
          FROM canonical_adaptation_shadow_log
      ) ranked
     WHERE a.id = ranked.id AND ranked.rn > $1`,
    [CANONICAL_ADAPTATION_SHADOW_LOG_MAX_ROWS_PER_USER],
  );

  return { deletedByAge: byAge.rowCount ?? 0, deletedByCap: byCap.rowCount ?? 0, ran: true };
}
