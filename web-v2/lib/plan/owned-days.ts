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
 *
 * ── 2026-08-25 · THE ACTIVE PLAN BREAKS THE TIE FIRST ────────────────────
 *
 * The ordering is `(tp.archived_iso IS NULL) DESC, tp.authored_iso DESC`, and
 * the first clause is new. It exists because `authored_iso DESC` alone
 * silently assumes the newest-authored plan is the live one — which held for
 * every write path this app had, because a rebuild archives the old plan and
 * authors the new one in the same transaction.
 *
 * `POST /api/plan/undo` breaks that assumption on purpose. It archives the
 * block the cron authored and un-archives the older one the runner asked for.
 * Under the old ordering the undone block would have kept winning every shared
 * date here — so the week strip (which filters `archived_iso IS NULL`) would
 * show the restored block while execution scoring, adaptation and the goal
 * projection (which read through this) went on grading him against the block
 * he had just rejected. Two surfaces, two answers, no error anywhere. That is
 * the split-brain the undo route's whole design is trying not to create.
 *
 * It changes NOTHING for existing data. For a date covered by both an active
 * and an archived plan, the active plan is always the more recently authored
 * one, so the new clause and the old one agree; and for a date covered only by
 * archived plans — every date before the last rebuild, which is most of the
 * runner's history — the clause is constant across all candidates and
 * `authored_iso DESC` decides exactly as before. Post-race history still
 * survives the rollover, which is the property the section above exists to
 * protect. `_owned_days_active_first.test.ts` states both halves.
 *
 * ── 2026-09-01 · "MOST RECENTLY AUTHORED" IS NOT "MOST AUTHORITATIVE" ────────
 *
 * The tiebreak above still had a hole: once BOTH candidates for a date are
 * archived, `authored_iso DESC` alone decides — and "authored later" is not
 * "was actually the runner's plan." Found on real data
 * (`docs/reports/taper-tempo-comparison-basis-2026-09-01.md`): a plan authored
 * 2026-06-07 and archived 21 MINUTES later (an aborted `POST /api/plan/undo`
 * round-trip that never served a single day to the runner) carried a later
 * `authored_iso` than the runner's real plan — authored 2026-06-03, adapted in
 * place four times, live for two and a half months, archived only when the
 * race it was built for completed. Once the race archived the real plan too,
 * the 21-minute ghost outranked it for every date they both covered — the
 * entire 42-day scoring window this account's adaptation model reads, not just
 * one date.
 *
 * The question this file answers was never "which plan was authored most
 * recently" — it was always "which plan was actually the account's live plan
 * WHEN date D would have been executed." Every plan has a reign as the active
 * plan: `[authored_iso, archived_iso)` if it has since been superseded, or
 * `[authored_iso, +∞)` while it is still the live one. A plan only owns date D
 * if D falls inside that reign — the 21-minute ghost's reign is a 21-minute
 * window in June that contains no July or August date at all, no matter how
 * its `authored_iso` compares to anyone else's.
 *
 * The active plan's reign is deliberately left OPEN rather than truncated at
 * `now()` — a first draft of this fix truncated it and broke every
 * currently-scheduled FUTURE day: a plan authored today owns next Tuesday's
 * workout even though "now" is earlier than next Tuesday. `now()` only enters
 * the SQL as a tiebreak value (case 2 below), never as the reign's own bound.
 *
 * `REIGN_CONTAINS_DATE` below tests calendar-day overlap against that
 * timestamptz interval, computed explicitly against UTC (`AT TIME ZONE 'UTC'`)
 * rather than casting through the session timezone, so the answer does not
 * depend on which timezone the connection happens to be in. Three cases, in
 * ORDER BY priority:
 *
 *   1 · Exactly one candidate's reign contains D → it wins outright; nothing
 *       downstream of the containment clause is ever consulted for it.
 *   2 · More than one candidate's reign contains D (plausible only in a brief
 *       undo/re-archive overlap — `training_plans_active_uq` forbids two
 *       simultaneously-active plans, but a transaction can pass through a
 *       moment where two ARCHIVED plans' reigns both cover D) → prefer the one
 *       with the latest `COALESCE(archived_iso, now())`, i.e. whichever was
 *       active most recently. An always-active plan's `now()` sorts above any
 *       past `archived_iso`, so this also reproduces "prefer the active plan"
 *       for the ordinary case, without needing a separate first clause.
 *   3 · NO candidate's reign contains D — a genuine gap in plan-ownership
 *       history, which should not happen. Falls back to the pre-2026-09-01
 *       ordering (`archived_iso IS NULL DESC, authored_iso DESC`) rather than
 *       guessing at a new answer; `_owned_days_reign.test.ts` treats a real
 *       account tripping this branch as a data-integrity finding to
 *       investigate, not a silent default to trust.
 *
 * `_owned_days_reign.test.ts` encodes the reverted-plan scenario above as a
 * fixture-shaped regression: a later-authored, short-lived, reverted plan must
 * not outrank a longer-lived earlier one for a date only the latter's reign
 * contains.
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
/**
 * True when plan `tp`'s reign as the account's active plan —
 * `[authored_iso, archived_iso)`, or `[authored_iso, +∞)` while still active
 * (`archived_iso IS NULL`) — overlaps the UTC calendar day named by
 * `pw.date_iso`. Computed against explicit UTC boundaries (`AT TIME ZONE
 * 'UTC'`) so the answer does not depend on the connection's session timezone.
 *
 * The active plan's upper bound is left unbounded rather than `now()` on
 * purpose — see the "FUTURE DAY" note in this file's header comment. A plan
 * authored today owns every day it has written a `plan_workouts` row for,
 * including next week's, not just days up to the current instant.
 */
const REIGN_CONTAINS_DATE = `(
  tp.authored_iso < ((pw.date_iso::date + interval '1 day') AT TIME ZONE 'UTC')
  AND (tp.archived_iso IS NULL OR tp.archived_iso > ((pw.date_iso::date) AT TIME ZONE 'UTC'))
)`;

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
     ORDER BY pw.date_iso,
              ${REIGN_CONTAINS_DATE} DESC,
              CASE WHEN ${REIGN_CONTAINS_DATE} THEN COALESCE(tp.archived_iso, now()) END DESC NULLS LAST,
              (tp.archived_iso IS NULL) DESC,
              tp.authored_iso DESC`;
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
