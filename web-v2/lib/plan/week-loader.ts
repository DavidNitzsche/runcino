/**
 * lib/plan/week-loader.ts — the 7-day training-week window loader.
 *
 * Extracted 2026-08-19 from `app/api/plan/week/route.ts` (byte-identical
 * logic, zero behavior change) so `GET /api/v5/today`'s week strip can call
 * the SAME loader instead of re-deriving it or doing an internal HTTP
 * round-trip. Per the v5 design contract: "week strip: /api/plan/week's own
 * loader." The route itself now delegates here — see that file's header for
 * the response-shape docs, which still apply verbatim.
 */
import { pool } from '@/lib/db/pool';
import { planVersionOf } from '@/lib/plan/plan-version';
import { rowsOrNull } from '@/lib/db/read';
import { canonicalMileageByDay } from '@/lib/runs/merge';
import { loadSettings } from '@/lib/coach/settings';
import { trainingWeekWindow } from '@/lib/notifications/week-window';
import { runDaySql } from '@/lib/runs/run-shape';
import { stripResearchCitations } from './strip-citations';
import { renderRunnerInstruction } from './runner-instruction';

export interface PlanWeekDay {
  /** A plan day's IDENTITY is its row id, not its date. Null on a
   *  synthesised rest day — the 7-day window emits every date whether or
   *  not a row exists for it. */
  plan_workout_id: string | null;
  date_iso: string;
  dow: number;
  type: string;
  distance_mi: number;
  sub_label: string | null;
  /** The generator's own sentence for THIS day — "Building back · easy
   *  effort.", "Off. Still recovering." Authored on every row and, until
   *  2026-08-21, selected by nothing at all.
   *
   *  Optional so a caller building a fixture does not have to invent one. */
  notes?: string | null;
  is_today: boolean;
  is_past: boolean;
  completedRunId: string | null;
  done_mi: number | null;
  skipped: boolean;
  secondaryRun: {
    plan_workout_id: string | null;
    type: string;
    sub_label: string | null;
    distance_mi: number;
  } | null;
}

export interface PlanWeekResult {
  plan_id: string | null;
  /** PLANVERSION-1 · `${training_plans.id}:${last_adapted_at}` — see
   *  `app/api/v5/today/route.ts`'s doc comment on the field of the same
   *  name for why `plan_id` alone does not catch an in-place re-anchor.
   *  Optional — existing fixture-shaped results across this codebase's
   *  test suite predate it. */
  plan_version?: string | null;
  week_start_iso: string | null;
  week_end_iso: string | null;
  /** BOUNDARY-1 (2026-09-04) · the plan's own first and last authored day
   *  — MIN/MAX(date_iso) over this plan's `plan_workouts`, not a schema
   *  column, because none exists and this is what "authored boundary"
   *  actually means: the plan generator's own reverse-taper-from-race-day
   *  construction guarantees the last row IS race day (or the block's
   *  final day for a goal with no set race), and the first row is the
   *  block's opening day. Lets the phone clamp week-paging to where a
   *  real week actually exists instead of generating ghost weeks forever
   *  in either direction off pure date arithmetic. Null only when the
   *  runner has no active plan at all. */
  plan_start_iso: string | null;
  plan_end_iso: string | null;
  today_iso: string;
  days: PlanWeekDay[];
  message?: string;
  /**
   * True when the skip read FAILED rather than came back empty.
   *
   * `PlanWeekDay.skipped` is a plain boolean on the wire and has to stay one,
   * so this is the flag that lets a caller tell "no day was skipped" apart from
   * "we could not find out". Absent means the read succeeded. A surface that
   * draws a skip marker should say nothing rather than assert an unskipped week
   * when this is set — a refusal is a correct answer, an empty state is not.
   */
  skipStateUnknown?: true;
}

/**
 * CITESCRUB-1 (2026-08-30) · the runner never reads a Research/ reference.
 *
 * `plan_workouts.notes` is the generator's own per-day sentence, and it is
 * written with the engine's citation attached — "Sub-threshold / Norwegian
 * intervals · Research/04 §5.4.", "Dress rehearsal · Research/04 §4.6.
 * Steady 8mi, then 3mi at marathon pace." 626 rows in prod carry one.
 *
 * That was harmless for as long as the column was, in this file's own words,
 * "selected by nothing at all". It stopped being harmless on 2026-08-21, when
 * the field started being read — it is `dayNote` on GET /api/v5/today. So the
 * most-read sentence in the app has been shipping internal references to the
 * runner for nine days.
 *
 * The voice doctrine already forbids this ("no citations on the payload ·
 * rooted in research is for the engine, not the runner") and
 * `stripResearchCitations` already exists for exactly this job — it is applied
 * to adapt's whys, the coach log, the morning brief, workout proposals and
 * moved-session notes. The plan's own notes were simply never added to that
 * list, because when the scrub was written nothing read them.
 *
 * Scrubbed at the READ, deliberately, not backfilled into the table: the
 * citation is real provenance and the engine is entitled to keep it on the
 * row. This also fixes all 626 existing rows with no data write, and no
 * re-authoring, which matters because a marathon block is about to be
 * authored off this same generator.
 *
 * Idempotent and a no-op on a string with no citation, so a note that never
 * had one is byte-identical.
 */
/*
 * RUNNERLANG-1 (2026-09-02) · AND THE RUNNER READS AN INSTRUCTION.
 *
 * The second pass is `renderRunnerInstruction`, applied here for the same
 * reason and by the same argument as the scrub above: it repairs every row
 * already in `plan_workouts` with no data write and no re-authoring, which
 * matters because the owner's fourteen-week CIM block is composed and live.
 * The authoring sites were fixed in the same change, so on a plan composed
 * from today forward this pass is a byte-identical no-op.
 *
 * ORDER IS DELIBERATE: scrub, then rewrite. The scrub can drop a whole
 * citation-led sentence, and the rewrite should see the prose the runner
 * will actually read rather than a sentence that is about to disappear.
 * Both passes are idempotent, so a double application is harmless.
 */
/** Exported for `lib/plan/plan-snapshot.ts` (PLANSNAPSHOT-1) — the ONE
 *  scrub-and-render pass a day's note gets, reused rather than re-composed,
 *  per this file's own header on why the two calls are ordered as they are. */
export function dayNoteFor(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const scrubbed = renderRunnerInstruction(stripResearchCitations(raw))?.trim() ?? '';
  return scrubbed.length > 0 ? scrubbed : null;
}

export interface SkippedDatesRead {
  skippedDates: Set<string>;
  /** True when the read FAILED rather than legitimately came back empty
   *  (Rule 11) — see the call site below for why this must not collapse
   *  into an empty set. */
  failed: boolean;
}

/**
 * PLANSNAPSHOT-SKIP-1 (2026-09-07) · THE canonical "which dates did this
 * runner deliberately skip" resolver — `day_actions action='skip'`, the
 * exact table `POST/DELETE /api/today/skip` writes.
 *
 * Extracted, byte-identical, from this file's own `loadPlanWeek` (below),
 * so `/api/v5/today`'s week strip and `/api/v5/plan-snapshot`'s per-date
 * browsing read ONE definition of "skipped" rather than each carrying its
 * own query — Rule 16. `lib/plan/plan-snapshot.ts` had ZERO reference to
 * `day_actions` before this: a runner who skipped a future day via
 * `POST /api/today/skip` (confirmed correct in isolation) saw the DB record
 * the skip correctly while the app — which renders from plan-snapshot, not
 * from a per-date `/api/plan/week` call, once a sync has landed — kept
 * showing the day as fully prescribed. This is the one resolver both now
 * call; do not add a second inline query for this question.
 *
 * `startIso`/`endIsoInclusive` are both inclusive, matching the `BETWEEN`
 * below.
 *
 * ── SKIPOWNER-1 (2026-09-07) · IT IS NOW ACTUALLY THE ONLY ONE ──────────────
 *
 * The paragraph above said "do not add a second inline query for this
 * question" while FOUR were already live, each with its own predicate, none of
 * them this one:
 *
 *   app/api/today/skip/route.ts    GET, `COALESCE(user_uuid, user_id) = $1`
 *   app/api/v5/today/route.ts      `alreadySkipped`, same shape
 *   lib/coach/glance-state.ts      same shape, AND `.catch(() => ({rows:[]}))`
 *   lib/plan/adapt.ts              7-day lookback, `$1::uuid` + COALESCE
 *
 * All four now call this function (the first three through `isDaySkipped`
 * below). That was checked against the data before it was done, not assumed:
 * `day_actions` holds 20 production rows, ZERO with a null `user_uuid`, zero
 * where `user_uuid <> user_id`, and all three INSERT sites
 * (`today/skip`, `today/shoe`, `notifications/ack`) write
 * `(user_id, user_uuid) VALUES ($1, $1)` with an
 * `ON CONFLICT … SET user_uuid = COALESCE(day_actions.user_uuid, EXCLUDED.user_uuid)`
 * backfill. So `user_uuid = $1` and `COALESCE(user_uuid, user_id) = $1` select
 * the identical rows, and the fold changes no result.
 */
export async function loadSkippedDates(
  userId: string,
  startIso: string,
  endIsoInclusive: string,
): Promise<SkippedDatesRead> {
  // 2026-08-24 · swallowed-failure sweep · `day_actions.date_iso` is a TEXT
  // day key, exactly like `plan_workouts.date_iso` — cast BOTH sides, per
  // `lib/runs/_plan_date_join_lint.test.ts`.
  const skipRows = await rowsOrNull<{ date_iso: string }>(
    'plan/week-loader · day_actions skip',
    pool.query<{ date_iso: string }>(
      `SELECT date_iso::text AS date_iso
         FROM day_actions
        WHERE user_uuid = $1 AND action = 'skip'
          AND date_iso::date BETWEEN $2::date AND $3::date`,
      [userId, startIso, endIsoInclusive],
    ),
  );
  // null = the read failed. Distinguish it from "nothing was skipped" so a
  // caller can stay quiet rather than assert an unskipped range it never saw.
  const skippedDates = new Set<string>();
  for (const row of skipRows ?? []) skippedDates.add(row.date_iso);
  return { skippedDates, failed: skipRows === null };
}

/** One date's answer, with the read's own outcome kept separate from it. */
export interface SkippedDayRead {
  /** Best-effort. Meaningless unless `failed` is false — branch on `failed`
   *  first, exactly as `SkippedDatesRead`'s callers do. */
  skipped: boolean;
  /** True when the read FAILED rather than found no row (Rule 11). */
  failed: boolean;
}

/**
 * SKIPOWNER-1 · "did this runner skip THIS date". The single-date shape three
 * point-read call sites needed, expressed as a one-day window over the same
 * query above rather than as a fourth `SELECT 1 … LIMIT 1` with a fourth
 * hand-typed predicate.
 *
 * There is deliberately no second query here. A one-row-per-user-per-day table
 * that holds 20 rows in production does not need its own index-optimised point
 * read badly enough to justify a second definition of what "skipped" means —
 * and a second definition is exactly how the three call sites this replaces
 * drifted onto a predicate the canonical resolver did not share.
 */
export async function isDaySkipped(userId: string, dateIso: string): Promise<SkippedDayRead> {
  const { skippedDates, failed } = await loadSkippedDates(userId, dateIso, dateIso);
  return { skipped: skippedDates.has(dateIso), failed };
}

/**
 * Returns the 7-day training-week window of plan_workouts containing
 * `dateParam` (defaults to the runner's today). The week ENDS on the
 * runner's long-run day and starts the day after — see
 * `lib/notifications/week-window.ts:trainingWeekWindow`.
 */
export async function loadPlanWeek(userId: string, today: string, dateParam?: string): Promise<PlanWeekResult> {
  const dateArg = dateParam ?? today;

  const DOW_OF: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const settings = await loadSettings(userId);
  const longRunDow = DOW_OF[settings.long_run_day] ?? 0;       // default Sunday
  const dow = new Date(dateArg + 'T12:00:00Z').getUTCDay();    // 0=Sun..6=Sat
  const { week_start_iso: weekStart, week_end_iso: weekEnd } =
    trainingWeekWindow(dateArg, dow, longRunDow);

  // Active plan
  const plan = (await pool.query(
    `SELECT id, last_adapted_at FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];

  if (!plan) {
    return {
      plan_id: null,
      plan_version: null,
      week_start_iso: null,
      week_end_iso: null,
      plan_start_iso: null,
      plan_end_iso: null,
      today_iso: today,
      days: [],
      message: 'No active plan.',
    };
  }

  // BOUNDARY-1 · one cheap indexed aggregate, scoped to this plan_id
  // exactly like the day-rows query below it — MIN/MAX over an already
  // plan_id-scoped set is not the expensive kind of aggregate.
  const bounds = (await pool.query(
    `SELECT MIN(date_iso)::text AS start_iso, MAX(date_iso)::text AS end_iso
       FROM plan_workouts WHERE plan_id = $1`,
    [plan.id]
  )).rows[0];

  // PLANVERSION-1 · same construction as the Today route's own
  // `planVersion` — see that file's doc comment for why `id` alone is not
  // enough. Kept as one local computation here rather than importing the
  // route's, since this loader has no dependency on the `app/api` route
  // tree and shouldn't grow one for a two-field string join.
  const planVersion = planVersionOf(plan);

  const rows = (await pool.query(
    // `notes` is the generator's own per-day reason ("Recovery easy ·
    // conversational, no surges."). It has been written on every workout row
    // since the engine could author one and read by nothing — see the note on
    // `notes` in PlanWeekDay.
    // STRENGTH-3-READ-1 (2026-08-24) · legacy `strength` / `cross` rows written
    // before the 2026-08-17 removal are still in the table and nothing stopped
    // them reaching a screen. The strip has been getting away with it: every
    // one of the fourteen live rows shares its day with an easy run and loses
    // `shapePlanWeekDays`' priority pick. A row on an otherwise-rest day would
    // win it and render the day as a gym session. Filtered at the read, so the
    // rows stay in the table — the removal is reversible by design and the
    // data was deliberately kept.
    `SELECT id::text AS id, date_iso, dow, type, distance_mi, sub_label, notes
       FROM plan_workouts
      WHERE plan_id = $1
        AND date_iso::date BETWEEN $2::date AND $3::date
        AND type NOT IN ('strength', 'cross', 'xt')
      ORDER BY date_iso ASC`,
    [plan.id, weekStart, weekEnd]
  )).rows;

  let actualByDate = new Map<string, { mi: number; id: string | null }>();
  try {
    const canonicalByDay = await canonicalMileageByDay(userId, weekStart, weekEnd);
    const allCanonicalIds = Array.from(canonicalByDay.values()).flatMap((v) => v.canonicalIds);
    const idLookup = allCanonicalIds.length > 0
      ? (await pool.query(
          `SELECT id::text AS row_id, data->>'id' AS strava_id,
                  COALESCE((data->>'distanceMi')::numeric, 0)::float8 AS mi,
                  ${runDaySql()} AS day
             FROM runs
            WHERE id::text = ANY($1::text[])`,
          [allCanonicalIds],
        )).rows
      : [];
    const idByRow = new Map<string, { strava_id: string | null; day: string; mi: number }>(
      idLookup.map((r: any) => [
        String(r.row_id),
        { strava_id: r.strava_id ?? null, day: r.day, mi: Number(r.mi) || 0 },
      ]),
    );
    // 2026-08-23 · the day's PRIMARY run is its longest, not whichever row the
    // cluster happened to emit first.
    //
    // This read `info.canonicalIds[0]`, and that index is not ordered by
    // anything: mileageByDay builds the list from an unordered `SELECT … FROM
    // runs`, so on any day carrying two physical runs the strip's
    // `completedRunId` was an arbitrary pick. It broke in prod on 2026-08-21 —
    // a 9.14 mi just-run shared the day with a 2 mi phantom, the phantom won
    // the index, and the day's tap target resolved to the run the runner never
    // did while the real one was unreachable from the strip.
    //
    // Longest-wins is the same "which run was the session" rule the rest of
    // the coach layer uses, and it is deterministic; the row id breaks a tie so
    // two equal-distance runs can't flip between renders. `mi` stays the day's
    // SUM — a genuine double is two runs' worth of volume, and only the tap
    // target has to choose one.
    for (const [day, info] of canonicalByDay) {
      const primary = info.canonicalIds
        .slice()
        .sort((a, b) => {
          const dm = (idByRow.get(b)?.mi ?? 0) - (idByRow.get(a)?.mi ?? 0);
          return dm !== 0 ? dm : a.localeCompare(b);
        })[0];
      const stravaId = primary ? (idByRow.get(primary)?.strava_id ?? primary) : null;
      actualByDate.set(day, { mi: info.mi, id: stravaId });
    }
  } catch {
    actualByDate = new Map();
  }

  // PLANSNAPSHOT-SKIP-1 · the canonical resolver, extracted below —
  // byte-identical query, now shared with `lib/plan/plan-snapshot.ts`.
  // Prod on 2026-08-24 held 10 skip rows for the primary runner that a
  // pre-fix `text >= date` mismatch had made invisible; see that fix's own
  // history in this function's git blame if the query itself is in question.
  const { skippedDates, failed: skipReadFailed } = await loadSkippedDates(userId, weekStart, weekEnd);

  const days = shapePlanWeekDays(rows as PlanWorkoutRow[], {
    weekStart,
    today,
    actualByDate,
    skippedDates,
  });

  return {
    plan_id: plan.id,
    plan_version: planVersion,
    week_start_iso: weekStart,
    week_end_iso: weekEnd,
    plan_start_iso: bounds?.start_iso ?? null,
    plan_end_iso: bounds?.end_iso ?? null,
    today_iso: today,
    days,
    // Carried on the LOADER's return, not the shaper's: the shaper is pure and
    // never touched a database, so it has no read to have failed. A week whose
    // skip read errored must not assert an unskipped week it never saw.
    ...(skipReadFailed ? { skipStateUnknown: true as const } : {}),
  };
}

/** One `plan_workouts` row, as the week window selects it. */
export interface PlanWorkoutRow {
  id: string;
  date_iso: string;
  dow: number;
  type: string;
  distance_mi: number | string;
  sub_label: string | null;
  notes?: string | null;
}

/**
 * THE AUTHORED WEEK BECOMES THE WEEK THE RUNNER SEES, HERE.
 *
 * Extracted 2026-08-24 so it can be driven with no database. Byte-identical
 * logic; `loadPlanWeek` above is now its only production caller.
 *
 * It exists as a seam because two of its rules LOSE information, and losing
 * information is exactly the kind of step a conservation harness has to be
 * able to stand at:
 *
 *   · THE COLLAPSE. Two rows on one date become one day. The loser survives
 *     only as `secondaryRun`, carrying type, label and distance — its spec,
 *     its pace target and its quality flag do not come back. A day authored
 *     twice can be shown once.
 *   · THE SYNTHESIS. Seven days are emitted whether or not a row exists, and
 *     a missing one is rendered as REST. A rest day the engine never authored
 *     is indistinguishable on the strip from one it did.
 *
 * Both are deliberate and both are correct for the screen. Neither was
 * observable from outside this function until now.
 */
export function shapePlanWeekDays(
  rows: PlanWorkoutRow[],
  ctx: {
    weekStart: string;
    today: string;
    actualByDate: Map<string, { mi: number; id: string | null }>;
    skippedDates: Set<string>;
  },
): PlanWeekDay[] {
  const { weekStart, today, actualByDate, skippedDates } = ctx;
  const TYPE_PRIORITY: Record<string, number> = {
    race: 6, long: 5,
    intervals: 4, tempo: 4, threshold: 4, quality: 4, repetition: 4, fartlek: 4,
    race_week_tuneup: 4,
    easy: 3, recovery: 3,
    cross: 2, xt: 2,
    strength: 1,
    rest: 0,
  };
  const prioOf = (t: string) => TYPE_PRIORITY[t] ?? 2;
  const bestByDate = new Map<string, any>();
  const NON_RUN_TYPES = new Set(['strength', 'cross', 'xt', 'rest']);
  const runningRowsByDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const prev = bestByDate.get(r.date_iso);
    if (!prev
        || prioOf(r.type) > prioOf(prev.type)
        || (prioOf(r.type) === prioOf(prev.type) && Number(r.distance_mi) > Number(prev.distance_mi))) {
      bestByDate.set(r.date_iso, r);
    }
    if (!NON_RUN_TYPES.has(r.type)) {
      const arr = runningRowsByDate.get(r.date_iso) ?? [];
      arr.push(r);
      runningRowsByDate.set(r.date_iso, arr);
    }
  }

  const addDaysISO = (iso: string, n: number): string => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const days: PlanWeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const dISO = addDaysISO(weekStart, i);
    const r = bestByDate.get(dISO);
    const actual = actualByDate.get(dISO);
    const dowN = new Date(dISO + 'T12:00:00Z').getUTCDay();
    const runningRows = runningRowsByDate.get(dISO) ?? [];
    const secondary = runningRows.length > 1
      ? runningRows.find((row) => row !== r) ?? null
      : null;
    return {
      plan_workout_id: r?.id ?? null,
      date_iso: dISO,
      dow: dowN,
      type: r?.type ?? 'rest',
      distance_mi: r ? Number(r.distance_mi) || 0 : 0,
      sub_label: r?.sub_label ?? (r ? null : 'REST'),
      notes: dayNoteFor(r?.notes),
      is_today: dISO === today,
      is_past: dISO < today,
      completedRunId: actual?.id ?? null,
      done_mi: actual ? actual.mi : null,
      skipped: skippedDates.has(dISO),
      secondaryRun: secondary
        ? {
            plan_workout_id: secondary.id ?? null,
            type: secondary.type,
            sub_label: secondary.sub_label ?? null,
            distance_mi: Number(secondary.distance_mi) || 0,
          }
        : null,
    };
  });


  return days;
}
