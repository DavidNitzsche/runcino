/**
 * skip-store · Postgres reader + writer for the `skipped_workouts`
 * table.
 *
 * A "skip" is the runner explicitly marking that today's planned
 * workout didn't happen. It's not the same thing as Strava simply
 * having no run on that date — it's the runner's intentional
 * acknowledgement, which is what the coach engine needs to react.
 *
 * Read paths:
 *   • gatherCoachState → state.flags.recentSkips (last 14 days)
 *   • /log page renders skip rows alongside Strava activities
 *   • coach.adaptPlan reads recent skips to decide whether to mutate
 *
 * Write paths:
 *   • POST /api/plan/skip (saveSkip)
 *   • POST /api/plan/skip with `undo: true` (deleteSkip)
 */

import { query } from './db';

export interface SkippedWorkout {
  id: number;
  dateISO: string;
  plannedWorkoutType: string | null;
  plannedMi: number | null;
  reason: string | null;
  loggedAtISO: string;
}

interface SkipRow {
  id: number;
  date: string;
  planned_workout_type: string | null;
  planned_mi: string | null; // pg NUMERIC returns string
  reason: string | null;
  ts: string;
}

function toIso(d: { date: string }): string {
  // pg DATE returns YYYY-MM-DD already; keep as-is.
  return d.date;
}

function rowToSkip(r: SkipRow): SkippedWorkout {
  return {
    id: r.id,
    dateISO: toIso({ date: r.date }),
    plannedWorkoutType: r.planned_workout_type,
    plannedMi: r.planned_mi != null ? Number(r.planned_mi) : null,
    reason: r.reason,
    loggedAtISO: r.ts,
  };
}

/** Save (upsert) a skip for `dateISO`. Re-saving on the same day
 *  overwrites — keeps only the latest plan snapshot + reason. */
export async function saveSkip(input: {
  userId?: string;
  dateISO: string;
  plannedWorkoutType?: string | null;
  plannedMi?: number | null;
  reason?: string | null;
}): Promise<SkippedWorkout> {
  const userId = input.userId ?? 'me';
  const rows = await query<SkipRow>(
    `INSERT INTO skipped_workouts (user_id, date, planned_workout_type, planned_mi, reason)
     VALUES ($1, $2::date, $3, $4, $5)
     ON CONFLICT (user_id, date) DO UPDATE
       SET planned_workout_type = EXCLUDED.planned_workout_type,
           planned_mi = EXCLUDED.planned_mi,
           reason = EXCLUDED.reason,
           ts = NOW()
     RETURNING id, date::text, planned_workout_type, planned_mi::text, reason, ts::text`,
    [
      userId,
      input.dateISO,
      input.plannedWorkoutType ?? null,
      input.plannedMi ?? null,
      input.reason ?? null,
    ],
  );
  if (rows.length === 0) throw new Error('saveSkip insert returned no row');
  return rowToSkip(rows[0]);
}

/** Delete a skip for `dateISO` (used when the runner clicks Undo). */
export async function deleteSkip(input: {
  userId?: string;
  dateISO: string;
}): Promise<boolean> {
  const userId = input.userId ?? 'me';
  const rows = await query<{ id: number }>(
    `DELETE FROM skipped_workouts WHERE user_id = $1 AND date = $2::date RETURNING id`,
    [userId, input.dateISO],
  );
  return rows.length > 0;
}

/** Get one skip if it exists. Used by the hero card to render its
 *  initial skipped/unskipped state on page load. */
export async function getSkipForDate(input: {
  userId?: string;
  dateISO: string;
}): Promise<SkippedWorkout | null> {
  const userId = input.userId ?? 'me';
  const rows = await query<SkipRow>(
    `SELECT id, date::text, planned_workout_type, planned_mi::text, reason, ts::text
     FROM skipped_workouts WHERE user_id = $1 AND date = $2::date LIMIT 1`,
    [userId, input.dateISO],
  );
  return rows[0] ? rowToSkip(rows[0]) : null;
}

/** List recent skips within a date range. Used by gatherCoachState +
 *  /log page. Default window is last 28 days. */
export async function listRecentSkips(input: {
  userId?: string;
  sinceISO?: string;
  untilISO?: string;
} = {}): Promise<SkippedWorkout[]> {
  const userId = input.userId ?? 'me';
  const sinceISO = input.sinceISO ?? defaultSinceISO();
  const untilISO = input.untilISO ?? new Date().toISOString().slice(0, 10);
  const rows = await query<SkipRow>(
    `SELECT id, date::text, planned_workout_type, planned_mi::text, reason, ts::text
     FROM skipped_workouts
     WHERE user_id = $1 AND date >= $2::date AND date <= $3::date
     ORDER BY date DESC`,
    [userId, sinceISO, untilISO],
  );
  return rows.map(rowToSkip);
}

function defaultSinceISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 28);
  return d.toISOString().slice(0, 10);
}
