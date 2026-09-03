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
 *   ok · via 'synthetic_day_distance'
 *                                no row carries this id string; it is a
 *                                "YYYY-MM-DD-mi" synthetic, and exactly one
 *                                canonical run that day is that long.
 *   ok · via 'trailing_date'     no row carries this id string; it ends in a
 *                                date, and the runner has exactly ONE canonical
 *                                run that day.
 *   not ok · 'ambiguous_day'     the id only names a DAY, and that day holds
 *                                more than one canonical run. A refusal, not a
 *                                guess (Rule 11).
 *   not ok · 'no_such_run'       no row of this runner's answers to that id
 *
 * `via` is on the success branch on purpose: a caller that wants to log or
 * label the redirect can, and a caller that does not care reads `rowId` and is
 * correct by default. That is the posture Rule 11 asks for — distinguishable
 * facts, and the safe one as the default.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY RUNGS 4 AND 5 ARE HERE AND NOT IN A ROUTE (2026-09-03 · Rule 16)
 *
 * They already existed — three times, in three verbs, and no two agreed:
 *
 *   `PATCH /api/runs/[id]`   resolver → "YYYY-MM-DD-mi" → trailing date
 *   `loadRunDetail`          resolver → "YYYY-MM-DD-mi"
 *   `/api/runs/[id]/recap`   resolver
 *
 * So the SAME id string assigned a shoe and 404'd the run it assigned it to.
 * Measured on production the same day, `faff_readonly`, reference runner
 * `0645f40c-951d-4ccc-b86e-9979cd26c795` — three ids of the form
 * `<uuid>-YYYY-MM-DD` (the spelling `/api/log` and the coach-intent `field`
 * column both carry, while the run row itself carries `<uuid>-YYYY-MM-DD#HHMM`):
 *
 *     id                                   rung1  rung2  trailing-date
 *     …-2026-09-01                             0      0              1
 *     …-2026-08-30                             0      0              1
 *     …-2026-09-02                             0      0              1
 *
 * Zero on the identity rungs is a 404 from GET and from the recap; one on the
 * trailing-date rung is a successful write from PATCH. One id, two answers,
 * chosen by HTTP verb. The previous agent correctly declined to add a fourth
 * rung inside the route — that would have been the second resolver the route's
 * own comments complain about — so the rungs move here and the routes lose
 * their copies.
 *
 * THE DAY RUNGS REFUSE WHEN THE DAY IS AMBIGUOUS, which the route's copy did
 * not. Its comment conceded the over-match ("the worst case is shoe tagged on
 * the wrong same-day run") and that was tolerable for a shoe; it is not
 * tolerable for GET, which would draw a different run than the one asked for.
 * Measured on the same account: 144 of 149 run days hold exactly one canonical
 * run and 5 hold more, so the refusal costs 3% of days and buys the guarantee
 * that a resolved day is an unambiguous one. Rule 11 — "the day is ambiguous"
 * and "there is no such run" are two facts and the caller can tell them apart.
 */
import { pool } from '@/lib/db/pool';
import {
  runIdentityMatchSql,
  runMergedIntoIdSql,
  runDaySql,
  runDistanceMiSql,
  CANONICAL_ROW_SQL,
} from '@/lib/runs/run-shape';

export type CanonicalRunRef =
  | {
      ok: true;
      rowId: string;
      via:
        | 'canonical'
        | 'absorbed_pointer'
        | 'dangling_pointer'
        | 'synthetic_day_distance'
        | 'trailing_date';
    }
  | { ok: false; reason: 'no_such_run' | 'ambiguous_day' };

/** `YYYY-MM-DD-mi` · the state loader's synthetic id for a run with no
 *  first-party activity id. Anchored at both ends: this is the WHOLE id. */
const SYNTHETIC_DAY_DISTANCE_ID = /^(\d{4}-\d{2}-\d{2})-([\d.]+)$/;

/** `…-YYYY-MM-DD` · the `<uuid>-YYYY-MM-DD` and `wko_<uuid>-YYYY-MM-DD`
 *  spellings `/api/log` returns for a manually-logged run. Only the trailing
 *  date is load-bearing, so only it is matched. */
const TRAILING_DATE_ID = /(\d{4}-\d{2}-\d{2})$/;

/** How near a synthetic id's stated distance must be to the row's, in miles.
 *  The synthetic is minted from the same `distanceMi` it is compared against,
 *  so this is a rounding tolerance and not a fuzzy match. */
const SYNTHETIC_DISTANCE_TOLERANCE_MI = 0.05;

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
  // NO ROW ANSWERS TO THIS STRING. That is not yet "no such run" — the id may
  // be one of the two synthetic spellings, which name a run by day rather than
  // by identity. Rungs 4 and 5 below.
  if (!loser) return resolveByDay(userUuid, runId);

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

/**
 * Rungs 4 and 5 · the id names a DAY, because nothing carries it as identity.
 *
 * Both spellings are minted by this app, not by a device, and both were already
 * being resolved — in the routes, differently. See the header.
 *
 * Every query here states `CANONICAL_ROW_SQL` (Rule 14): resolving a synthetic
 * id onto a merge loser is the same defect the identity rungs above exist to
 * stop, and a day is exactly where a merge pair both live.
 */
async function resolveByDay(userUuid: string, runId: string): Promise<CanonicalRunRef> {
  /* BOTH RUNGS RESOLVE ONLY AN UNAMBIGUOUS DAY. `LIMIT 2` and a count, never
   * `LIMIT 1` off an unordered set — which is what the route copy did, and its
   * own comment conceded it could "tag the wrong same-day run". That was
   * tolerable for a shoe; it is not tolerable for a GET, which would draw a
   * different run than the one asked for and say nothing.
   *
   * Rule 11: the refusal is its own fact. "This day holds two runs" is
   * something the caller can explain and the runner can act on; "there is no
   * such run" is not the same sentence and is not true.
   *
   * Measured on production 2026-09-03, reference runner: 144 of 149 run days
   * hold exactly one canonical run and 5 hold more, so this costs ~3% of days
   * and buys the guarantee that a resolved day is an unambiguous one. */
  const resolveDay = async (
    day: string,
    extraSql: string,
    extraParams: unknown[],
  ): Promise<string | null | 'ambiguous'> => {
    const hits = (await pool.query<{ id: string }>(
      `SELECT id::text AS id FROM runs
        WHERE user_uuid = $1
          AND ${CANONICAL_ROW_SQL}
          AND ${runDaySql()} = $2
          ${extraSql}
        LIMIT 2`,
      [userUuid, day, ...extraParams],
    )).rows;
    if (hits.length === 1) return hits[0].id;
    if (hits.length > 1) {
      console.warn(
        `[canonical-ref] run id names the day ${day}, which holds more than one matching ` +
        `canonical run. Refusing rather than picking one.`,
      );
      return 'ambiguous';
    }
    return null;
  };

  // Rung 4 · "YYYY-MM-DD-mi". The distance is part of the id, so a day holding
  // two runs of different lengths is still unambiguous here — which is why this
  // rung is tried before the date-only one.
  const synthetic = SYNTHETIC_DAY_DISTANCE_ID.exec(runId);
  if (synthetic) {
    const [, day, mi] = synthetic;
    const hit = await resolveDay(
      day,
      `AND ABS(${runDistanceMiSql()} - $3::numeric) < $4::numeric`,
      [mi, SYNTHETIC_DISTANCE_TOLERANCE_MI],
    );
    if (hit === 'ambiguous') return { ok: false, reason: 'ambiguous_day' };
    if (hit) return { ok: true, rowId: hit, via: 'synthetic_day_distance' };
  }

  // Rung 5 · "…-YYYY-MM-DD". The date is ALL this id says.
  const trailing = TRAILING_DATE_ID.exec(runId);
  if (trailing) {
    const hit = await resolveDay(trailing[1], '', []);
    if (hit === 'ambiguous') return { ok: false, reason: 'ambiguous_day' };
    if (hit) return { ok: true, rowId: hit, via: 'trailing_date' };
  }

  return { ok: false, reason: 'no_such_run' };
}
