/**
 * lib/plan/owned-days.ts · "which plan owned this day?", answered once.
 *
 * `plan_workouts` carries EVERY plan the runner has ever had. In the live
 * database that is 47 plans over 4130 rows, and for one runner 3904 rows
 * covering just 112 distinct dates — a 35× multiplier. Plans are rebuilt often
 * (a race moves, a week is missed, the adapter re-authors), and every rebuild
 * writes a fresh full set of rows over the SAME dates. Nothing marks the old
 * ones as superseded.
 *
 * So an unscoped `SELECT … FROM plan_workouts WHERE date_iso BETWEEN …` does
 * not return the runner's plan. It returns every version of it at once. That
 * read counted 431 quality sessions in a 42-day window, which is roughly 30×
 * the truth and reads as a runner who has been doing nothing but intervals.
 *
 * ── WHY NOT JUST SCOPE TO THE ACTIVE PLAN ────────────────────────────────
 *
 * Because it is wrong in the one situation that matters most, and wrong
 * silently. `training_plans.archived_iso IS NULL` picks the plan that is live
 * RIGHT NOW. The day after a goal race the live plan is a brand-new recovery
 * block with no history in it, and the entire block the runner just spent four
 * months executing is sitting in an archived row. Scope to the active plan and
 * the runner reads as having done nothing, on the exact morning he most wants
 * to see what he did.
 *
 * The runner's body does not know his plan was archived.
 *
 * ── THE ANSWER ───────────────────────────────────────────────────────────
 *
 * Per DATE, take the workout from the most recently AUTHORED plan that covered
 * that date. `DISTINCT ON (pw.date_iso) … ORDER BY pw.date_iso,
 * tp.authored_iso DESC`. Rebuilds collapse to one row per day because the
 * newest authoring wins, and executed history survives the rollover because
 * archived plans are still in scope for the dates they covered.
 *
 * Lifted verbatim from `lib/adaptation/load.ts`, where it was written and
 * where its two failure modes were found by running it against real data
 * rather than by a test. It lives here now so the next surface that needs to
 * ask this question does not re-derive it — and get it wrong the same two ways.
 */

import { pool } from '@/lib/db/pool';

/** The columns `ownedDaysSql` selects unless the caller asks for others. */
export const OWNED_DAYS_DEFAULT_COLUMNS = 'pw.date_iso, pw.is_quality, pw.distance_mi';

export interface OwnedDaysSqlOptions {
  /**
   * Which columns to project. Must be `pw.`-qualified (or `tp.`-qualified) —
   * this is a `DISTINCT ON` query and unqualified names are ambiguous.
   */
  columns?: string;
  /** Placeholder index for the runner's uuid. Default `$1`. */
  userParam?: number;
  /** Placeholder index for the inclusive start date. Default `$2`. */
  fromParam?: number;
  /** Placeholder index for the EXCLUSIVE end date. Default `$3`. */
  toParam?: number;
}

/**
 * The SQL for "one row per planned day — the version that was live for that
 * date". Usable as a CTE body or a subquery.
 *
 * The date window is `>= from` and `< to` — the upper bound is EXCLUSIVE,
 * matching every existing caller. Passing today as `to` therefore excludes
 * today, which is usually what a "what has happened" read wants.
 *
 * @example
 *   const sql = `WITH owned AS (${ownedDaysSql()})
 *                SELECT COUNT(*) FROM owned WHERE owned.is_quality`;
 *   pool.query(sql, [userUuid, fromISO, toISO]);
 */
export function ownedDaysSql(opts: OwnedDaysSqlOptions = {}): string {
  const {
    columns = OWNED_DAYS_DEFAULT_COLUMNS,
    userParam = 1,
    fromParam = 2,
    toParam = 3,
  } = opts;
  return `
    SELECT DISTINCT ON (pw.date_iso)
           ${columns}
      FROM plan_workouts pw
      JOIN training_plans tp ON tp.id = pw.plan_id
     WHERE pw.user_uuid = $${userParam} AND pw.date_iso >= $${fromParam} AND pw.date_iso < $${toParam}
     ORDER BY pw.date_iso, tp.authored_iso DESC`;
}

/** One planned day, as the plan that owned it described it. */
export interface OwnedDay {
  dateISO: string;
  isQuality: boolean;
  distanceMi: number | null;
  type: string | null;
  isLong: boolean;
}

/**
 * Read the runner's owned plan days over `[fromISO, toISO)`.
 *
 * Every field is nullable where the plan row allows it, and `distanceMi` is
 * null rather than 0 when the plan day carried no distance — a rest day and a
 * day whose distance was never set are different things.
 */
export async function loadOwnedDays(
  userUuid: string,
  fromISO: string,
  toISO: string,
): Promise<OwnedDay[]> {
  const sql = ownedDaysSql({
    columns: 'pw.date_iso, pw.is_quality, pw.distance_mi, pw.type, pw.is_long',
  });
  const r = await pool.query<{
    date_iso: string;
    is_quality: boolean | null;
    distance_mi: string | null;
    type: string | null;
    is_long: boolean | null;
  }>(sql, [userUuid, fromISO, toISO]);
  return r.rows.map((row) => ({
    dateISO: row.date_iso,
    isQuality: row.is_quality === true,
    distanceMi: row.distance_mi == null ? null : Number(row.distance_mi),
    type: row.type,
    isLong: row.is_long === true,
  }));
}
