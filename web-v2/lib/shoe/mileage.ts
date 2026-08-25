/**
 * lib/shoe/mileage.ts · single-source shoe mileage, computed ON READ
 * from canonical runs. Replaces the stored `shoes.mileage` column,
 * which only updated on the run-detail PATCH path and was therefore
 * stale/fictional everywhere else (Overnight Item 16 · 0 of 7 stored
 * values matched the run sum).
 *
 * Same dedupe as the old recompute: MAX-distance row per (day, shoe)
 * defends against absorber gaps / duplicate source rows, and
 * mergedIntoId losers are excluded so a merged dupe never double-counts.
 *
 * Mirrors the doctrine the audit blessed for volume.ts / training-form.ts:
 * compute from the canonical ids on read, never store a value a second
 * writer can stale.
 *
 * v1 scope (David, baseline decision): app-tracked miles only. Pre-app
 * starting mileage is NOT seeded — 0 is honest, and the fictional seeds
 * are discarded. A manual "starting mileage" field is a logged
 * fast-follow (AUDIT-FIXES.md).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-08-24 · MOST OF THIS MILEAGE WAS NEVER OBSERVED
 *
 * A run's shoe reaches `runs.shoe_id` two ways. The runner picks one, or
 * `lib/shoe/auto-assign.ts` GUESSES from the preferred shoe and the run type
 * and stamps `shoe_auto_assigned_at`. The column exists precisely to tell the
 * two apart and, until now, nothing read it.
 *
 * Measured on production, 2026-08-24, by running THIS function against
 * `faff_readonly` — 55 of the runner's 149 canonical rows carry a shoe and 38
 * of those 55 were auto-assigned:
 *
 *     Asics Novablast 5        61.51 mi   61.51 inferred   100%
 *     NB SC Trainer v3 (red)   12.36 mi   12.36 inferred   100%
 *     Nike Zoom Fly 6           8.02 mi    8.02 inferred   100%   (RETIRED)
 *     NB SC Trainer v3        101.05 mi   94.15 inferred    93%   (RETIRED)
 *     Asics Superblast 3      114.38 mi   50.51 inferred    44%
 *     Nike Vomero Premium      62.73 mi   26.61 inferred    42%
 *     Asics Megablast          40.68 mi    5.97 inferred    15%
 *                             ─────────  ─────────────
 *                             400.73 mi  259.13 inferred    65%
 *
 * A shoe retires when its mileage reaches a cap. The SC Trainer v3 is retired
 * on a figure that is 93% guessed. That is rule one — a modelled number must
 * never look measured — and the fix is not to stop inferring, which is a
 * useful default, but to stop the inference being invisible.
 *
 * `computeShoeMileage` keeps its shape so no caller has to change. The new
 * `computeShoeMileageBreakdown` returns the same total ALONGSIDE the inferred
 * share, so a surface can mark the number or a retirement prompt can say what
 * it is standing on. `_shoe_mileage_provenance.test.ts` holds the rule.
 */
import { pool } from '@/lib/db/pool';
import { runDaySql, runDistanceMiSql, runNotMergedSql } from '@/lib/runs/run-shape';

/** One shoe's tracked miles, and how many of them were never observed. */
export interface ShoeMileage {
  /** Total tracked miles. Unchanged from what `computeShoeMileage` returns. */
  totalMi: number;
  /**
   * Of `totalMi`, the miles that reached this shoe by AUTO-ASSIGNMENT — a
   * guess from the preferred shoe and the run type, not a choice the runner
   * made. Zero when every assignment was manual.
   */
  inferredMi: number;
  /** Runs contributing, and how many of those were auto-assigned. */
  runs: number;
  inferredRuns: number;
}

/**
 * Per-shoe mileage with its provenance split out.
 *
 * The day-dedupe is unchanged: MAX distance per (day, shoe). The inferred
 * total takes the same picked row's distance when that row was auto-assigned,
 * so the two figures are drawn from ONE set of rows and `inferredMi` can never
 * exceed `totalMi`.
 */
export async function computeShoeMileageBreakdown(userId: string): Promise<Map<number, ShoeMileage>> {
  const rows = (await pool.query<{
    shoe_id: number; total_mi: string; inferred_mi: string; runs: string; inferred_runs: string;
  }>(
    `WITH per_day_shoe AS (
       SELECT shoe_id,
              ${runDaySql()}::date AS d,
              MAX(${runDistanceMiSql()}) AS mi,
              -- The picked row is the longest of the day for this shoe.
              -- DISTINCT ON would be a second ordering to keep in step with
              -- the MAX above; this asks the same question of the same rows.
              MAX(${runDistanceMiSql()}) FILTER (WHERE shoe_auto_assigned_at IS NOT NULL) AS inferred_mi
         FROM runs
        WHERE user_uuid = $1
          AND shoe_id IS NOT NULL
          AND ${runNotMergedSql()}
        GROUP BY shoe_id, 2
     )
     SELECT shoe_id,
            SUM(mi) AS total_mi,
            -- LEAST IGNORES NULLS. LEAST(NULL, 5.95) is 5.95, not NULL, so a
            -- bare LEAST here counted every manual day as inferred and this
            -- query reported 100% inferred for all seven shoes on its first
            -- run against prod. The CASE is what makes the null a zero.
            COALESCE(SUM(CASE WHEN inferred_mi IS NULL THEN 0
                              ELSE LEAST(inferred_mi, mi) END), 0) AS inferred_mi,
            COUNT(*)                                        AS runs,
            COUNT(*) FILTER (WHERE inferred_mi IS NOT NULL) AS inferred_runs
       FROM per_day_shoe
      GROUP BY shoe_id`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ shoe_id: number; total_mi: string; inferred_mi: string; runs: string; inferred_runs: string }> }))).rows;

  const round2 = (v: unknown) => Math.round(Number(v) * 100) / 100;
  const out = new Map<number, ShoeMileage>();
  for (const r of rows) {
    const totalMi = round2(r.total_mi);
    out.set(Number(r.shoe_id), {
      totalMi,
      // Clamped, not trusted: a day whose longest run was manual and whose
      // shorter one was inferred must not report more inferred than total.
      inferredMi: Math.min(totalMi, round2(r.inferred_mi)),
      runs: Number(r.runs) || 0,
      inferredRuns: Number(r.inferred_runs) || 0,
    });
  }
  return out;
}

/**
 * Map of shoe_id → tracked miles for one runner. Shoes with no assigned
 * runs are simply absent from the map (caller treats missing as 0).
 *
 * Thin façade over `computeShoeMileageBreakdown` so the two can never
 * disagree about a total.
 */
export async function computeShoeMileage(userId: string): Promise<Map<number, number>> {
  const detail = await computeShoeMileageBreakdown(userId);
  const out = new Map<number, number>();
  for (const [id, m] of detail) out.set(id, m.totalMi);
  return out;
}
