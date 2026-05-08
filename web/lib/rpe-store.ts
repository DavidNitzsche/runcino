/**
 * Server-side workout-RPE store. Single Postgres table
 * (`workout_rpe` in lib/db.ts), keyed by workout_date so re-saving
 * the same date overwrites — the runner can correct a mis-tap.
 *
 * RPE = Rating of Perceived Exertion (Borg CR-10 / 1-10 scale).
 * 1 = barely working, 10 = maximum effort. Doctrine: Research/00b
 * §INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS uses RPE drift between
 * sessions to flag fatigue accumulation.
 */

import { query } from './db';

export interface WorkoutRpe {
  /** ISO YYYY-MM-DD — one entry per workout day. */
  workoutDate: string;
  /** Borg CR-10 perceived effort, 1-10. */
  rpe: number;
  notes: string | null;
  recordedAt: string;
}

interface DbRow {
  workout_date: Date | string;
  rpe: number;
  notes: string | null;
  recorded_at: Date | string;
}

function toEntry(row: DbRow): WorkoutRpe {
  return {
    workoutDate: row.workout_date instanceof Date
      ? row.workout_date.toISOString().slice(0, 10)
      : String(row.workout_date).slice(0, 10),
    rpe: row.rpe,
    notes: row.notes,
    recordedAt: row.recorded_at instanceof Date
      ? row.recorded_at.toISOString()
      : String(row.recorded_at),
  };
}

/** Last N entries, most recent first. Default 14 days = ~2 weeks
 *  of training feedback, enough to spot a "trending hard" pattern. */
export async function getRecentRpe(days = 14): Promise<WorkoutRpe[]> {
  const rows = await query<DbRow>(
    `SELECT workout_date, rpe, notes, recorded_at
     FROM workout_rpe
     WHERE workout_date >= CURRENT_DATE - $1::INT
     ORDER BY workout_date DESC`,
    [days],
  );
  return rows.map(toEntry);
}

export async function getRpeForDate(workoutDate: string): Promise<WorkoutRpe | null> {
  const rows = await query<DbRow>(
    `SELECT workout_date, rpe, notes, recorded_at
     FROM workout_rpe WHERE workout_date = $1`,
    [workoutDate],
  );
  return rows.length === 0 ? null : toEntry(rows[0]);
}

export async function saveRpe(workoutDate: string, rpe: number, notes: string | null): Promise<WorkoutRpe> {
  // Validate inputs server-side too — the API route guards but the
  // store is also called from background flows where the inputs may
  // come from less-trusted sources (CSV import, retro-back-fill, etc).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
    throw new Error(`invalid workoutDate: ${workoutDate}`);
  }
  const r = Math.round(rpe);
  if (!Number.isFinite(r) || r < 1 || r > 10) {
    throw new Error(`invalid rpe: ${rpe} (must be 1-10)`);
  }
  await query(
    `INSERT INTO workout_rpe (workout_date, rpe, notes, recorded_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (workout_date) DO UPDATE SET
       rpe         = EXCLUDED.rpe,
       notes       = EXCLUDED.notes,
       recorded_at = NOW();`,
    [workoutDate, r, notes],
  );
  const saved = await getRpeForDate(workoutDate);
  if (!saved) throw new Error(`saveRpe failed: ${workoutDate}`);
  return saved;
}

export async function deleteRpe(workoutDate: string): Promise<void> {
  await query(`DELETE FROM workout_rpe WHERE workout_date = $1`, [workoutDate]);
}
