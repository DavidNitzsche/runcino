/**
 * GET /api/plan/week?date=YYYY-MM-DD
 *
 * Returns the 7-day training-week window of plan_workouts containing the given
 * date. The week ENDS on the runner's long-run day (their last training day of
 * the cycle) and starts the day after — derived from user_settings.long_run_day.
 * David runs long on Sunday → Mon–Sun. A Saturday-long runner → Sun–Sat.
 * Used by the iPhone WeekStrip and the training calendar.
 *
 * Response shape:
 *   {
 *     plan_id: string,
 *     week_start_iso: string,     // ISO day after the long-run day (week start)
 *     week_end_iso:   string,     // ISO long-run day (week end, 6 days later)
 *     today_iso:      string,     // server "today" (PT-adjusted)
 *     days: Array<{
 *       date_iso: string, dow: number, type: string,
 *       distance_mi: number, sub_label: string | null,
 *       is_today: boolean, is_past: boolean,
 *       completedRunId: string | null,  // Phase 17 — real strava id when day has a logged run
 *       done_mi: number | null          // Phase 17 — canonical completed mileage for the day
 *     }>
 *   }
 *
 * 2026-05-28 Phase 17 — `completedRunId` + `done_mi` added so the iPhone
 * WeekStrip can retire its `is_past && type != "rest"` heuristic. We mirror
 * the canonicalMileageByDay → strava_id resolution from glance-state.ts
 * (see lines 138-170) so the strip agrees with /log on dedupe.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { canonicalMileageByDay } from '@/lib/runs/merge';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadSettings } from '@/lib/coach/settings';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  // 2026-06-06 · Audit C C6 · runner timezone, not the -7h Pacific hack.
  // Keeps the iPhone week-strip's "today" consistent with /api/watch/today.
  const today = await runnerToday(userId);
  const dateParam = req.nextUrl.searchParams.get('date') ?? today;

  // 2026-06-16 · Week boundary derives from the runner's long-run day so the
  // week ENDS on it (their last training day of the cycle). David runs long on
  // Sunday → Mon–Sun; a Saturday-long runner → Sun–Sat. Was hardcoded Sat–Fri,
  // which mislabeled the calendar for anyone whose long run isn't Saturday.
  const DOW_OF: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const settings = await loadSettings(userId);
  const longRunDow = DOW_OF[settings.long_run_day] ?? 0;       // default Sunday
  const weekStartDow = (longRunDow + 1) % 7;                   // day after the long run
  const dow = new Date(dateParam + 'T12:00:00Z').getUTCDay();  // 0=Sun..6=Sat
  const daysSinceWeekStart = (dow - weekStartDow + 7) % 7;

  // Active plan
  const plan = (await pool.query(
    `SELECT id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];

  if (!plan) {
    return NextResponse.json({
      plan_id: null,
      week_start_iso: null,
      week_end_iso: null,
      today_iso: today,
      days: [],
      message: 'No active plan.',
    });
  }

  const rows = (await pool.query(
    `SELECT date_iso, dow, type, distance_mi, sub_label
       FROM plan_workouts
      WHERE plan_id = $1
        AND date_iso::date BETWEEN ($2::date - $3::int) AND ($2::date - $3::int + 6)
      ORDER BY date_iso ASC`,
    [plan.id, dateParam, daysSinceWeekStart]
  )).rows;

  const weekStart = (await pool.query(
    `SELECT ($1::date - $2::int)::text AS d`,
    [dateParam, daysSinceWeekStart]
  )).rows[0].d;
  const weekEnd = (await pool.query(
    `SELECT ($1::date - $2::int + 6)::text AS d`,
    [dateParam, daysSinceWeekStart]
  )).rows[0].d;

  // 2026-05-28 Phase 17 — Resolve completed strava activity per day so the
  // iPhone WeekStrip can show real DONE checkmarks instead of the
  // `is_past && type != "rest"` heuristic. Mirrors glance-state.ts so the
  // strip agrees with /log on dedupe.
  //
  // Best-effort: if the strava table is empty or the helper fails, we still
  // emit a valid response with completedRunId=null + done_mi=null per day.
  let actualByDate = new Map<string, { mi: number; id: string | null }>();
  try {
    const canonicalByDay = await canonicalMileageByDay(userId, weekStart, weekEnd);
    const allCanonicalIds = Array.from(canonicalByDay.values()).flatMap((v) => v.canonicalIds);
    const idLookup = allCanonicalIds.length > 0
      ? (await pool.query(
          `SELECT id::text AS row_id, data->>'id' AS strava_id,
                  COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day
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
    // Swallow — leaves actualByDate empty so the response falls back to
    // null/null per day. The WeekStrip just won't show DONE marks.
    actualByDate = new Map();
  }

  // 2026-05-31 · expose skipped days. day_actions writes action='skip'
  // when the runner taps Skip Today (POST /api/today/skip). Web /today
  // already renders SKIPPED for that day; iPhone WeekStrip was getting
  // completedRunId=null with no signal to distinguish "skipped" from
  // "didn't run yet." Now both clients can render the skip glyph.
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

  // 2026-06-20 · The strip is ONE pill per calendar day. A day can carry more
  // than one plan_workouts row (e.g. an easy run + a strength session), so a
  // naive rows.map() emitted a duplicate pill for that date ("21 21"), and a
  // sparse plan left gaps (a rest day with no row, or only one authored row,
  // produced a 1-day / non-contiguous strip — Lilley, 2026-06-20). Collapse to
  // the primary RUNNING workout per day (strength/cross fold out), then emit
  // EXACTLY 7 contiguous days from weekStart so the strip is always 7 pills,
  // in order, no dupes, no gaps.
  const TYPE_PRIORITY: Record<string, number> = {
    race: 6, long: 5,
    intervals: 4, tempo: 4, threshold: 4, quality: 4, repetition: 4, fartlek: 4,
    easy: 3, recovery: 3,
    cross: 2, xt: 2,
    strength: 1,
    rest: 0,
  };
  const prioOf = (t: string) => TYPE_PRIORITY[t] ?? 2;
  const bestByDate = new Map<string, any>();
  let anyStrengthByDate = new Map<string, boolean>();
  for (const r of rows) {
    if (r.type === 'strength') anyStrengthByDate.set(r.date_iso, true);
    const prev = bestByDate.get(r.date_iso);
    if (!prev
        || prioOf(r.type) > prioOf(prev.type)
        || (prioOf(r.type) === prioOf(prev.type) && Number(r.distance_mi) > Number(prev.distance_mi))) {
      bestByDate.set(r.date_iso, r);
    }
  }

  const addDaysISO = (iso: string, n: number): string => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const days = Array.from({ length: 7 }, (_, i) => {
    const dISO = addDaysISO(weekStart, i);
    const r = bestByDate.get(dISO);
    const actual = actualByDate.get(dISO);
    const dow = new Date(dISO + 'T12:00:00Z').getUTCDay();
    return {
      date_iso: dISO,
      dow,
      type: r?.type ?? 'rest',
      distance_mi: r ? Number(r.distance_mi) || 0 : 0,
      sub_label: r?.sub_label ?? (r ? null : 'REST'),
      is_today: dISO === today,
      is_past: dISO < today,
      // Phase 17 — real signal, retires the iOS `is_past && type != "rest"`
      // heuristic in FaffAdapter.buildWeekStrip. Emit even for rest days
      // (recovery jogs can be logged on rest days).
      completedRunId: actual?.id ?? null,
      done_mi: actual ? actual.mi : null,
      // 2026-05-31 · runner tapped Skip Today (day_actions row).
      skipped: skippedDates.has(dISO),
      // 2026-06-20 · a run day that also carries a strength session, so the
      // strip can mark it without a second pill.
      hasStrength: anyStrengthByDate.get(dISO) === true && (r?.type !== 'strength'),
    };
  });

  return NextResponse.json({
    plan_id: plan.id,
    week_start_iso: weekStart,
    week_end_iso: weekEnd,
    today_iso: today,
    days,
  });
}
