/**
 * lib/runs/twins.ts · the absorbed rows a surface has to see before it can
 * print a number.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A SURFACE CANNOT READ THE CANONICAL ROW ALONE
 *
 * A merged run is not one row. Every ingest that saw the session wrote its
 * own — the watch, HealthKit, Strava — and the dedup picked one to be
 * canonical and stamped `mergedIntoId` on the rest. The canonical row is the
 * best row OVERALL. It is not the best row for every FIELD, and for two
 * fields it is routinely the worse one:
 *
 *   ELEVATION  2026-08-24 · canonical 128 ft `gps_derived`, absorbed twin
 *              13 ft `raw` (barometer). The runner: "I have a hard time
 *              believing my elevation on today's run was 128 feet. I can
 *              promise you it was not."
 *   SPLITS     2026-08-24 · canonical 3 splits covering 3.00 of 4.02 miles,
 *              absorbed twin 5 covering 4.11 with cadence and per-mile
 *              elevation. True of 26 of the 71 merged runs here.
 *
 * `pickElevationGain` and `pickSplits` already know how to choose. What did
 * not exist was a way for a surface OTHER than the poster to see the
 * candidates — the twin query lived inline inside `app/api/v5/today/route.ts`,
 * so run detail, the log and the recap each fell back to reading the canonical
 * row raw and each printed a different climb for the same run:
 *
 *     2026-08-23 · one run, 11.01 miles
 *       row            3195 ft  (source `watch`, an untrusted instrument)
 *       log            3195 ft  (read the row raw)
 *       run detail       57 ft  (its own 250 ft/mi drift heuristic)
 *       poster           57 ft  (pickElevationGain, over the twins)
 *
 * Three numbers, one hill. This module is the seam that ends that: one query,
 * one shape, called by every surface that prints either field.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A FAILED READ IS NOT AN EMPTY LIST
 *
 * `loadRunTwins` returns null when the query FAILS and an empty array when the
 * run genuinely has no twins. Collapsing the two would let a `gps_derived`
 * figure win by default the moment the database hiccuped, which is exactly how
 * the wrong number reached the phone the first time. Callers must treat null
 * as "a better instrument may exist and I could not see it" and refuse, not as
 * "there is nothing better".
 */
import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import {
  runElevGainFtSql, runElevGainSourceSql, runSourceSql, runSplitsSql,
  runMergedIntoIdSql, runAvgHrSql, runMaxHrSql,
} from '@/lib/runs/run-shape';
import { pickElevationGain, type ElevationReading } from '@/lib/runs/elevation';
import { pickSplits, type SplitChoice, type SplitLike } from '@/lib/runs/splits-pick';

/** One absorbed row, reduced to the fields a surface may prefer over the canonical's. */
export interface RunTwin {
  elevGainFt: number | null;
  elevGainSource: string | null;
  source: string | null;
  splits: SplitLike[] | null;
  avgHr: number | null;
  maxHr: number | null;
}

/**
 * Every row absorbed into this canonical row.
 *
 * @param canonicalRowId the `runs.id` PRIMARY KEY of the canonical row — NOT
 *        `data.id`. `mergedIntoId` stores the numeric PK, and passing the
 *        string activity id silently matches nothing, which reads as "no
 *        twins" and is the failure this module exists to prevent.
 * @returns the twins, or null when the read failed.
 */
export async function loadRunTwins(canonicalRowId: string | number): Promise<RunTwin[] | null> {
  const rows = await rowsOrNull<{
    ft: string | null; src: string | null; ingest: string | null;
    splits: unknown; avghr: string | null; maxhr: string | null;
  }>(
    'runs/twins · absorbed rows',
    pool.query(
      `SELECT ${runElevGainFtSql()} AS ft, ${runElevGainSourceSql()} AS src,
              ${runSourceSql()} AS ingest, ${runSplitsSql()} AS splits,
              ${runAvgHrSql()} AS avghr, ${runMaxHrSql()} AS maxhr
         FROM runs
        WHERE ${runMergedIntoIdSql()} = $1`,
      [String(canonicalRowId)],
    ),
  );
  if (rows === null) return null;
  return rows.map((t) => ({
    elevGainFt: t.ft == null ? null : Number(t.ft),
    elevGainSource: t.src,
    source: t.ingest,
    splits: Array.isArray(t.splits) ? (t.splits as SplitLike[]) : null,
    avgHr: t.avghr == null ? null : Number(t.avghr),
    maxHr: t.maxhr == null ? null : Number(t.maxhr),
  }));
}

/** The canonical row's own contribution, in the same shape as a twin. */
export interface CanonicalFigures {
  elevGainFt: number | null;
  elevGainSource: string | null;
  source: string | null;
  splits: SplitLike[] | null;
  distanceMi: number | null;
}

/**
 * THE CLIMB, resolved across the canonical row and every twin.
 *
 * Null means REFUSE — either the twin read failed, or no candidate came from
 * an instrument worth printing. Both are correct answers. An invented 3195 ft
 * is worse than no figure, because the runner cannot tell it is invented.
 *
 * `measured` is false when the surviving figure came from `gps_derived` or
 * `recomputed`. A surface that prints it must carry the modelled mark; see
 * rule one.
 */
export function resolveElevationGain(
  canonical: CanonicalFigures,
  twins: RunTwin[] | null,
): ElevationReading | null {
  if (twins === null) return null;
  return pickElevationGain([
    { ft: canonical.elevGainFt, source: canonical.elevGainSource, ingest: canonical.source },
    ...twins.map((t) => ({ ft: t.elevGainFt, source: t.elevGainSource, ingest: t.source })),
  ]);
}

/**
 * THE SPLIT ARRAY that actually decomposes this run.
 *
 * A failed twin read falls back to the canonical's own splits rather than
 * refusing. That asymmetry with elevation is deliberate and worth stating: a
 * wrong CLIMB is a fact the runner cannot check, while a short split list is
 * visibly short — the miles are numbered. Showing three of four miles is a
 * lesser harm than showing no breakdown at all, and the coverage figure on the
 * returned choice lets a surface say so.
 */
export function resolveSplits(
  canonical: CanonicalFigures,
  twins: RunTwin[] | null,
): SplitChoice | null {
  return pickSplits(canonical.distanceMi, [
    { splits: canonical.splits, source: 'canonical' },
    ...(twins ?? []).map((t) => ({ splits: t.splits, source: t.source })),
  ]);
}
