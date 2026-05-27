/**
 * PATCH /api/plan/workout
 *   { plan_id, date_iso, type?, distance_mi?, sub_label?, new_date_iso? }
 *
 * Updates one plan_workouts row in place. If new_date_iso is given,
 * date_iso + dow + week_id are updated to match the new date (workout
 * "moves" to that calendar slot).
 *
 * Coach picks up the change on next briefing — no separate write needed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.plan_id || !body?.date_iso) {
    return NextResponse.json({ error: 'plan_id + date_iso required' }, { status: 400 });
  }
  const userId = body.user_id ?? DAVID_USER_ID;

  // Resolve plan + auth (the row must belong to the user)
  const plan = (await pool.query(
    `SELECT id FROM training_plans WHERE id = $1 AND (user_uuid = $2 OR user_id = 'me')`,
    [body.plan_id, userId]
  )).rows[0];
  if (!plan) return NextResponse.json({ error: 'plan not found' }, { status: 404 });

  const updates: Record<string, any> = {};
  if (body.type != null)         updates.type = body.type;
  if (body.distance_mi != null)  updates.distance_mi = Number(body.distance_mi) || 0;
  if (body.sub_label !== undefined) updates.sub_label = body.sub_label;

  // Handling a move (date change)
  let newDate: string | null = null;
  if (body.new_date_iso && body.new_date_iso !== body.date_iso) {
    newDate = body.new_date_iso;
    // Resolve new week_id for the target date
    const w = (await pool.query(
      `SELECT id::text AS id FROM plan_weeks
        WHERE plan_id = $1
          AND week_start_iso <= $2::text
          AND to_char((week_start_iso::date + interval '7 days'), 'YYYY-MM-DD') > $2::text
        LIMIT 1`,
      [body.plan_id, newDate]
    )).rows[0];
    if (!w) return NextResponse.json({ error: 'no plan_week covers new_date_iso' }, { status: 400 });
    updates.date_iso = newDate;
    updates.week_id = w.id;
    // dow: 0=Sun..6=Sat
    updates.dow = new Date(newDate + 'T12:00:00Z').getUTCDay();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no changes' }, { status: 400 });
  }

  const cols = Object.keys(updates);
  const setSql = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const values = cols.map((c) => updates[c]);

  try {
    const r = await pool.query(
      `UPDATE plan_workouts SET ${setSql}
        WHERE plan_id = $1 AND date_iso = $2::text
        RETURNING date_iso, dow, type, distance_mi, sub_label`,
      [body.plan_id, body.date_iso, ...values]
    );
    if (r.rowCount === 0) return NextResponse.json({ error: 'workout not found' }, { status: 404 });

    // Log intent so coach acknowledges the swap once
    await pool.query(
      `INSERT INTO coach_intents (user_id, reason, field, value)
       VALUES ($1, 'workout_swapped', $2, $3)`,
      [userId, body.date_iso, JSON.stringify({ from: body.date_iso, to: newDate ?? body.date_iso, ...updates })]
    ).catch(() => {});

    await bustBriefingCacheForEvent(DAVID_USER_ID, 'plan_swap');

    return NextResponse.json({ ok: true, updated: r.rows[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
