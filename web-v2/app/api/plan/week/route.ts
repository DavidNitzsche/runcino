/**
 * GET /api/plan/week?date=YYYY-MM-DD
 *
 * Returns the Mon–Sun week of plan_workouts containing the given date.
 * Used by the iPhone WeekStripView (and any other surface that wants the
 * structured plan for a week without hauling the briefing wrapper).
 *
 * Response shape:
 *   {
 *     plan_id: string,
 *     week_start_iso: string,     // ISO Monday
 *     week_end_iso:   string,     // ISO Sunday
 *     today_iso:      string,     // server "today" (PT-adjusted)
 *     days: Array<{
 *       date_iso: string, dow: number, type: string,
 *       distance_mi: number, sub_label: string | null,
 *       is_today: boolean, is_past: boolean
 *     }>
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

function todayPT(): string {
  // PT-adjusted "today" — matches buildWatchToday + briefing engine.
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date') ?? todayPT();
  const userId = req.nextUrl.searchParams.get('user_id') ?? DAVID_USER_ID;

  // Mon-Sun week containing date.
  const dow = new Date(dateParam + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;

  // Active plan
  const plan = (await pool.query(
    `SELECT id FROM training_plans
      WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];

  if (!plan) {
    return NextResponse.json({
      plan_id: null,
      week_start_iso: null,
      week_end_iso: null,
      today_iso: todayPT(),
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
    [plan.id, dateParam, daysSinceMonday]
  )).rows;

  const today = todayPT();
  const weekStart = (await pool.query(
    `SELECT ($1::date - $2::int)::text AS d`,
    [dateParam, daysSinceMonday]
  )).rows[0].d;
  const weekEnd = (await pool.query(
    `SELECT ($1::date - $2::int + 6)::text AS d`,
    [dateParam, daysSinceMonday]
  )).rows[0].d;

  return NextResponse.json({
    plan_id: plan.id,
    week_start_iso: weekStart,
    week_end_iso: weekEnd,
    today_iso: today,
    days: rows.map((r: any) => ({
      date_iso: r.date_iso,
      dow: r.dow,
      type: r.type,
      distance_mi: Number(r.distance_mi) || 0,
      sub_label: r.sub_label,
      is_today: r.date_iso === today,
      is_past: r.date_iso < today,
    })),
  });
}
