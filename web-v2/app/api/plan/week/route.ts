/**
 * GET /api/plan/week?date=YYYY-MM-DD
 *
 * Returns the Sat–Fri (7-day) window of plan_workouts containing the given date.
 * Week starts on Saturday (long-run anchor day) and runs through the following
 * Friday, so the strip spans one complete training cycle.
 * Used by the iPhone WeekStrip.
 *
 * Response shape:
 *   {
 *     plan_id: string,
 *     week_start_iso: string,     // ISO Saturday (start of training week)
 *     week_end_iso:   string,     // ISO Friday (end of training week, 6 days later)
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

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  // 2026-06-06 · Audit C C6 · runner timezone, not the -7h Pacific hack.
  // Keeps the iPhone week-strip's "today" consistent with /api/watch/today.
  const today = await runnerToday(userId);
  const dateParam = req.nextUrl.searchParams.get('date') ?? today;

  // Sat–Sun (9-day) training week containing date.
  // Week starts on Saturday (long-run anchor) and ends the following Sunday.
  // daysSinceSaturday: Sat=0, Sun=1, Mon=2 … Fri=6 → formula (dow+1)%7
  const dow = new Date(dateParam + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const daysSinceSaturday = (dow + 1) % 7;

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
    [plan.id, dateParam, daysSinceSaturday]
  )).rows;

  const weekStart = (await pool.query(
    `SELECT ($1::date - $2::int)::text AS d`,
    [dateParam, daysSinceSaturday]
  )).rows[0].d;
  const weekEnd = (await pool.query(
    `SELECT ($1::date - $2::int + 6)::text AS d`,
    [dateParam, daysSinceSaturday]
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

  return NextResponse.json({
    plan_id: plan.id,
    week_start_iso: weekStart,
    week_end_iso: weekEnd,
    today_iso: today,
    days: rows.map((r: any) => {
      const actual = actualByDate.get(r.date_iso);
      return {
        date_iso: r.date_iso,
        dow: r.dow,
        type: r.type,
        distance_mi: Number(r.distance_mi) || 0,
        sub_label: r.sub_label,
        is_today: r.date_iso === today,
        is_past: r.date_iso < today,
        // Phase 17 — real signal, retires the iOS `is_past && type != "rest"`
        // heuristic in FaffAdapter.buildWeekStrip. Emit even for rest days
        // (recovery jogs can be logged on rest days).
        completedRunId: actual?.id ?? null,
        done_mi: actual ? actual.mi : null,
        // 2026-05-31 · runner tapped Skip Today (day_actions row).
        skipped: skippedDates.has(r.date_iso),
      };
    }),
  });
}
