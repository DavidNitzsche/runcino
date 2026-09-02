/**
 * lib/runs/canonical-ref.ts · ONE answer to "which ROW does this run id mean".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (Rule 14 · a query names the population it reads)
 *
 * `runIdentityMatchSql` answers "which run" across the three spellings of a
 * run id — the row's bigint primary key, `data.activityId` (Strava's) and
 * `data.id` (the watch's). Its own doc comment then says, correctly, that
 * "callers add their own `user_uuid` and canonical-row predicates". That
 * sentence is documentation, not enforcement, and on 2026-09-02 three of its
 * four callers had not added the canonical predicate.
 *
 * Measured on production the same day, `faff_readonly`, reference runner
 * `0645f40c-951d-4ccc-b86e-9979cd26c795`:
 *
 *     274 rows · 156 canonical · 118 MERGED LOSERS (43% of the table)
 *     0 of those 118 loser id strings also match a canonical row
 *     0 dangling pointers · 0 pointer chains needing a second hop
 *
 * Because no loser id collides with a canonical one, every one of those 118
 * ids resolved to the LOSER, deterministically, on every surface that looked a
 * run up by id. Against the canonical survivor the losers differ on splits
 * (44 of 118 — most carrying ZERO splits against 5-13 on the survivor),
 * average heart rate (54), shoe (66) and elevation gain (58).
 *
 * Three surfaces were reading the discarded half of a merge:
 *
 *   · `loadRunDetail` — `/api/runs/[id]` and `/runs/[id]`. Opening the
 *     2026-08-30 13.49 mi long run by its Strava id drew 0 splits, no average
 *     HR, 124 ft of climb and no weather; the canonical row for that same
 *     physical run carries 13 splits, 159 bpm, 230 ft and weather.
 *   · `/api/runs/[id]/recap` — whose own comment reads "Load the canonical
 *     run" while the query did not say so. It then called `loadRunTwins` with
 *     the loser's row id, and a loser has no twins, so the ranked-instrument
 *     elevation read degraded to the weaker number as well.
 *   · `PATCH /api/runs/[id]` — the shoe assignment. It wrote `shoe_id` onto
 *     the loser. `lib/shoe/mileage.ts` computes shoe mileage from CANONICAL
 *     runs, so those miles never accrued and the pick never came back.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE PREDICATE ALONE IS THE WRONG FIX
 *
 * Adding `AND ${CANONICAL_ROW_SQL}` and stopping there 404s all 118: the
 * Strava id lives ONLY on the loser, and it is the id the log, the recap link
 * and any saved URL carry. So the id is followed to the row it was absorbed
 * into and the CANONICAL row is returned. A stale link keeps working and never
 * shows the discarded numbers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE 11 · THREE FACTS, KEPT APART
 *
 *   ok · via 'canonical'         the id names a canonical row
 *   ok · via 'absorbed_pointer'  the id names a loser; this is its survivor
 *   ok · via 'dangling_pointer'  the id names a loser whose pointer resolves
 *                                to nothing. Corruption — the caller gets the
 *                                loser and a warning, because returning null
 *                                would erase a run the runner really did.
 *   not ok · 'no_such_run'       no row of this runner's answers to that id
 *
 * `via` is on the success branch on purpose: a caller that wants to log or
 * label the redirect can, and a caller that does not care reads `rowId` and is
 * correct by default. That is the posture Rule 11 asks for — three
 * distinguishable facts, and the safe one as the default.
 */
import { pool } from '@/lib/db/pool';
import { runIdentityMatchSql, runMergedIntoIdSql, CANONICAL_ROW_SQL } from '@/lib/runs/run-shape';

export type CanonicalRunRef =
  | { ok: true; rowId: string; via: 'canonical' | 'absorbed_pointer' | 'dangling_pointer' }
  | { ok: false; reason: 'no_such_run' };

/**
 * Resolve any spelling of a run id to the PRIMARY KEY of the canonical row.
 *
 * The caller then selects whatever columns it needs by `id`, which is why
 * this returns an id rather than a row: the three call sites want different
 * projections and a shared row shape would be a second contract to keep.
 *
 * `userUuid` is Rule 14's other half and is stated on every rung — a run id is
 * not a capability, and the absorbed rung must not become a way to read
 * another account's row.
 */
export async function resolveCanonicalRunRowId(
  userUuid: string,
  runId: string,
): Promise<CanonicalRunRef> {
  // Rung 1 · the id names a canonical row.
  const direct = (await pool.query<{ id: string }>(
    `SELECT id::text AS id FROM runs
      WHERE user_uuid = $1
        AND ${runIdentityMatchSql('$2')}
        AND ${CANONICAL_ROW_SQL}
      LIMIT 1`,
    [userUuid, runId],
  )).rows[0];
  if (direct) return { ok: true, rowId: direct.id, via: 'canonical' };

  // Rung 2 · the id names a row that was absorbed. Follow the pointer.
  const loser = (await pool.query<{ id: string; merged_into_id: string | null }>(
    `SELECT id::text AS id, ${runMergedIntoIdSql()} AS merged_into_id
       FROM runs
      WHERE user_uuid = $1
        AND ${runIdentityMatchSql('$2')}
      LIMIT 1`,
    [userUuid, runId],
  )).rows[0];
  if (!loser) return { ok: false, reason: 'no_such_run' };

  const survivor = loser.merged_into_id == null ? null : (await pool.query<{ id: string }>(
    `SELECT id::text AS id FROM runs
      WHERE user_uuid = $1
        AND id::text = $2
        AND ${CANONICAL_ROW_SQL}
      LIMIT 1`,
    [userUuid, String(loser.merged_into_id)],
  )).rows[0] ?? null;
  if (survivor) return { ok: true, rowId: survivor.id, via: 'absorbed_pointer' };

  // Rung 3 · dangling pointer. Not a normal state — say so rather than 404
  // the only record of a run that happened.
  console.warn(
    `[canonical-ref] run id ${runId} names absorbed row ${loser.id}, whose mergedIntoId ` +
    `(${String(loser.merged_into_id)}) resolves to no canonical row. Serving the absorbed ` +
    `row; its splits, HR, shoe and elevation may be the discarded half of a merge.`,
  );
  return { ok: true, rowId: loser.id, via: 'dangling_pointer' };
}
