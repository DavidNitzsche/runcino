/**
 * POST /api/today/reschedule
 *   { from_date: "YYYY-MM-DD", to_date: "YYYY-MM-DD", replace?: boolean }
 *
 * Moves the runner's RUNNING workout from one calendar day to another within
 * the active plan. This is the "I have to do my Sunday long run on Saturday
 * this week" verb — a per-occurrence move, NOT a settings change (long_run_day
 * stays put) and NOT a recurring reschedule (next week's rows are untouched).
 *
 * Semantics (David's spec, 2026-06-26):
 *   - Only the primary RUNNING workout moves. Strength / cross / rest rows on
 *     the source day stay where they are — you don't drag your strength session
 *     when you pull a long run forward a day.
 *   - Target day empty (rest / no run) → the run just lands there.
 *   - Target day already has a run → caller must pass replace:true. Without it
 *     we return { conflict: true, existing } so the client can prompt
 *     "Replace the easy 5?". On replace, the displaced run is removed for that
 *     day (it's regenerable plan data, logged in the coach intent).
 *
 * Reversibility: the moved row stamps original_date_iso (COALESCE — first move
 * wins, so a move-then-move-back still points at the true origin). The coach
 * acknowledges the change once via a 'workout_swapped' intent (same reason the
 * /api/plan/workout swap path uses, so the cache-bust + briefing voice already
 * handle it).
 *
 * Auth: requireUserId. Same-week moves (the common case) need nothing special —
 * the training week ENDS on long_run_day, so Sat is still inside this week and
 * the volume rollup / week boundary don't shift. Cross-week moves re-home the
 * row's week_id from plan_weeks, same as /api/plan/workout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireUserId } from '@/lib/auth/session';

interface Body {
  from_date?: string;
  to_date?: string;
  replace?: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Types that count as a "run" you'd reschedule. Strength / cross / rest are
// excluded — they're not the thing being moved. Mirrors the running set the
// week-strip priority map treats as primary (route plan/week TYPE_PRIORITY).
const RUNNING_TYPES = new Set([
  'race', 'long', 'intervals', 'tempo', 'threshold', 'quality', 'repetition',
  'fartlek', 'progression', 'easy', 'recovery', 'shakeout',
]);

// Higher = more "primary" when a day carries more than one running row.
const RUN_PRIORITY: Record<string, number> = {
  race: 6, long: 5,
  intervals: 4, tempo: 4, threshold: 4, quality: 4, repetition: 4, fartlek: 4, progression: 4,
  easy: 3, recovery: 3, shakeout: 3,
};

interface RunRow {
  id: string;
  type: string;
  distance_mi: number;
  sub_label: string | null;
  original_date_iso: string | null;
}

/** The primary running workout on a given date for a plan, or null. */
async function primaryRun(planId: string, dateIso: string): Promise<RunRow | null> {
  const rows = (await pool.query(
    `SELECT id::text AS id, type, distance_mi, sub_label, original_date_iso
       FROM plan_workouts
      WHERE plan_id = $1 AND date_iso = $2::text`,
    [planId, dateIso],
  )).rows as RunRow[];
  const runs = rows.filter((r) => RUNNING_TYPES.has(r.type));
  if (runs.length === 0) return null;
  runs.sort((a, b) =>
    (RUN_PRIORITY[b.type] ?? 0) - (RUN_PRIORITY[a.type] ?? 0)
    || Number(b.distance_mi) - Number(a.distance_mi));
  return runs[0];
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = (await req.json().catch(() => null)) as Body | null;
  const fromDate = body?.from_date;
  const toDate = body?.to_date;
  if (!fromDate || !toDate || !ISO.test(fromDate) || !ISO.test(toDate)) {
    return NextResponse.json({ error: 'from_date + to_date (YYYY-MM-DD) required' }, { status: 400 });
  }
  if (fromDate === toDate) {
    return NextResponse.json({ error: 'same_day' }, { status: 400 });
  }

  // Active plan (latest authored, not archived) — same resolution as /plan/week.
  const plan = (await pool.query(
    `SELECT id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!plan) return NextResponse.json({ error: 'no_active_plan' }, { status: 404 });

  const source = await primaryRun(plan.id, fromDate);
  if (!source) return NextResponse.json({ error: 'no_run_on_source' }, { status: 404 });

  // Race day is the plan's anchor row — it must never move and must never
  // be displaced by a reschedule (P2-17, audit 2026-07-06). Losing this row
  // drops race-day mode, the race-day watch payload, and the plan's race
  // anchor two days before the goal race.
  if (source.type === 'race') {
    return NextResponse.json({ error: 'race_day_immovable' }, { status: 400 });
  }

  // Target conflict check.
  const target = await primaryRun(plan.id, toDate);
  if (target && target.type === 'race') {
    return NextResponse.json({ error: 'race_day_protected' }, { status: 400 });
  }
  if (target && !body?.replace) {
    return NextResponse.json({
      conflict: true,
      existing: {
        type: target.type,
        distance_mi: Number(target.distance_mi) || 0,
        sub_label: target.sub_label,
      },
    });
  }

  // Resolve the week_id that owns a date (the plan's weeks aren't the same
  // boundary as the runner's long-run week — they're the authored plan_weeks).
  const weekFor = async (dateIso: string): Promise<string | null> => (await pool.query(
    `SELECT id::text AS id FROM plan_weeks
      WHERE plan_id = $1
        AND week_start_iso <= $2::text
        AND to_char((week_start_iso::date + interval '7 days'), 'YYYY-MM-DD') > $2::text
      LIMIT 1`,
    [plan.id, dateIso],
  )).rows[0]?.id ?? null;

  const toWeek = await weekFor(toDate);
  if (!toWeek) return NextResponse.json({ error: 'no_plan_week_covers_target' }, { status: 400 });
  const fromWeek = await weekFor(fromDate);
  const dowOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rowsOn = async (dateIso: string): Promise<Array<{ id: string; type: string }>> =>
      (await client.query(
        `SELECT id::text AS id, type FROM plan_workouts WHERE plan_id = $1 AND date_iso = $2::text`,
        [plan.id, dateIso],
      )).rows;

    // Replace: remove the displaced run on the target day. Only the running
    // row — strength/cross on that day stay put.
    let replaced: { type: string; distance_mi: number } | null = null;
    if (target && body?.replace) {
      await client.query(`DELETE FROM plan_workouts WHERE id = $1`, [target.id]);
      replaced = { type: target.type, distance_mi: Number(target.distance_mi) || 0 };
    }

    // Move the source run onto the target day. Stamp original_date_iso the
    // first time so a later restore/move-back knows the true origin.
    const moved = (await client.query(
      `UPDATE plan_workouts
          SET date_iso = $2,
              week_id = $3,
              dow = $4,
              original_date_iso = COALESCE(original_date_iso, $5)
        WHERE id = $1
        RETURNING date_iso, type, distance_mi, sub_label`,
      [source.id, toDate, toWeek, dowOf(toDate), fromDate],
    )).rows[0];

    // Reconcile rest placeholders so the plan stays exactly one row per day:
    //   - a run must not share its day with a leftover 'rest' row, and
    //   - the day the run LEFT must not become a gap (it should read as rest).
    // The clean move is a swap: relocate the target's rest row onto the
    // vacated source day. Falls back to an insert only if the target had no
    // rest to relocate and the source is now empty (rare — plans carry
    // explicit rest rows, so the swap path normally fires).
    const restOnTarget = (await rowsOn(toDate)).filter((r) => r.type === 'rest');
    const sourceRows = await rowsOn(fromDate);

    if (sourceRows.length === 0) {
      if (restOnTarget.length > 0 && fromWeek) {
        await client.query(
          `UPDATE plan_workouts SET date_iso = $2, week_id = $3, dow = $4 WHERE id = $1`,
          [restOnTarget[0].id, fromDate, fromWeek, dowOf(fromDate)],
        );
        for (const extra of restOnTarget.slice(1)) {
          await client.query(`DELETE FROM plan_workouts WHERE id = $1`, [extra.id]);
        }
      } else if (fromWeek) {
        await client.query(
          `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi, notes, original_date_iso)
           VALUES ($1, $2, $3, $4, $5, 'rest', 0, '', $4)`,
          [`wko_${randomBytes(8).toString('hex')}`, plan.id, fromWeek, fromDate, dowOf(fromDate)],
        );
      }
    } else {
      // Source still has rows (e.g. a strength session) — just drop any rest
      // dup on the target so the moved run owns the day cleanly.
      for (const r of restOnTarget) {
        await client.query(`DELETE FROM plan_workouts WHERE id = $1`, [r.id]);
      }
    }

    // Acknowledge once via the coach. Reuse 'workout_swapped' so the existing
    // cache-bust + briefing-voice handling picks it up with no new wiring.
    await client.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, 'workout_swapped', $2, $3)`,
      [userId, fromDate, JSON.stringify({
        kind: 'reschedule', from: fromDate, to: toDate,
        type: source.type, replaced,
      })],
    ).catch(() => {});

    await client.query('COMMIT');

    await bustBriefingCacheForEvent(userId, 'plan_swap');

    return NextResponse.json({ ok: true, moved, replaced });
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

export const dynamic = 'force-dynamic';
