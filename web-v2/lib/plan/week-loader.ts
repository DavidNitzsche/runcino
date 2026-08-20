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
import { canonicalMileageByDay } from '@/lib/runs/merge';
import { loadSettings } from '@/lib/coach/settings';
import { trainingWeekWindow } from '@/lib/notifications/week-window';
import { runDaySql } from '@/lib/runs/run-shape';

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
  week_start_iso: string | null;
  week_end_iso: string | null;
  today_iso: string;
  days: PlanWeekDay[];
  message?: string;
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
    `SELECT id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];

  if (!plan) {
    return {
      plan_id: null,
      week_start_iso: null,
      week_end_iso: null,
      today_iso: today,
      days: [],
      message: 'No active plan.',
    };
  }

  const rows = (await pool.query(
    `SELECT id::text AS id, date_iso, dow, type, distance_mi, sub_label
       FROM plan_workouts
      WHERE plan_id = $1
        AND date_iso::date BETWEEN $2::date AND $3::date
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
                  ${runDaySql()} AS day
             FROM runs
            WHERE id::text = ANY($1::text[])`,
          [allCanonicalIds],
        )).rows
      : [];
    const idByRow = new Map<string, { strava_id: string | null; day: string }>(
      idLookup.map((r: any) => [String(r.row_id), { strava_id: r.strava_id ?? null, day: r.day }]),
    );
    for (const [day, info] of canonicalByDay) {
      const firstRow = info.canonicalIds[0];
      const stravaId = firstRow ? (idByRow.get(firstRow)?.strava_id ?? firstRow) : null;
      actualByDate.set(day, { mi: info.mi, id: stravaId });
    }
  } catch {
    actualByDate = new Map();
  }

  const skippedDates = new Set<string>();
  try {
    const r = await pool.query<{ date_iso: string }>(
      `SELECT date_iso::text AS date_iso
         FROM day_actions
        WHERE user_uuid = $1 AND action = 'skip'
          AND date_iso BETWEEN $2::date AND $3::date`,
      [userId, weekStart, weekEnd],
    );
    for (const row of r.rows) skippedDates.add(row.date_iso);
  } catch {
    // Best-effort · skip indicator just won't show this week.
  }

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

  return {
    plan_id: plan.id,
    week_start_iso: weekStart,
    week_end_iso: weekEnd,
    today_iso: today,
    days,
  };
}
