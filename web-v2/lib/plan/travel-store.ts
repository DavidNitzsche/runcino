/**
 * lib/plan/travel-store.ts · the impure half of travel windows.
 *
 * The RULES live in ./travel-windows.ts and are pure; this module owns the
 * `travel_windows` table (migration 159) — per-user CRUD for the API route
 * and the three engine readers:
 *
 *   · loadGeneratorInputs (generate.ts) · windows overlapping the plan window
 *   · the adapter's reschedule search (adapt.ts) · dates near today
 *   · loadConvergenceContext (convergence-loader.ts) · days since travel
 *
 * Every read is catch-guarded at the CALLER with an explicit empty fallback:
 * the table may not exist yet (migration 159 is applied manually, per repo
 * convention), and a runner with no windows must compose byte-identically to
 * before this feature existed.
 */

import { pool } from '@/lib/db/pool';
import type { TravelWindow } from './travel-windows';

export interface TravelWindowRow extends TravelWindow {
  id: number;
  note: string | null;
  createdAtISO: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Guarded date read · a Date column comes back as a Date object from pg. */
function toISO(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function rowOf(r: {
  id: string | number;
  start_date: unknown;
  end_date: unknown;
  note: string | null;
  created_at: unknown;
}): TravelWindowRow {
  return {
    id: Number(r.id),
    startISO: toISO(r.start_date),
    endISO: toISO(r.end_date),
    note: r.note ?? null,
    createdAtISO: r.created_at instanceof Date
      ? r.created_at.toISOString()
      : String(r.created_at),
  };
}

/** All of a runner's windows, soonest first. */
export async function listTravelWindows(userId: string): Promise<TravelWindowRow[]> {
  const res = await pool.query(
    `SELECT id, start_date, end_date, note, created_at
       FROM travel_windows
      WHERE user_uuid = $1::uuid
      ORDER BY start_date ASC, id ASC`,
    [userId],
  );
  return res.rows.map(rowOf);
}

/** Windows overlapping [fromISO, toISO] inclusive · the plan engine's read. */
export async function travelWindowsOverlapping(
  userId: string,
  fromISO: string,
  toISO: string,
): Promise<TravelWindow[]> {
  const res = await pool.query(
    `SELECT id, start_date, end_date, note, created_at
       FROM travel_windows
      WHERE user_uuid = $1::uuid
        AND start_date <= $3::date
        AND end_date   >= $2::date
      ORDER BY start_date ASC, id ASC`,
    [userId, fromISO, toISO],
  );
  return res.rows.map(rowOf);
}

/**
 * Days since the runner's most recent travel ended, for the Research/15
 * confound window (CONVERGENCE.travelConfoundDays · "travel and altitude
 * >1500 m (elevates nocturnal HR 3–5 days)"). 0 while a window is open,
 * N days after its end, null when no window ended recently enough to matter
 * (the caller compares against the 5-day confound, so anything older than
 * 30 days is read as null here rather than fetched).
 */
export async function daysSinceTravelEnd(
  userId: string,
  todayISO: string,
): Promise<number | null> {
  const res = await pool.query<{ end_date: unknown }>(
    `SELECT end_date
       FROM travel_windows
      WHERE user_uuid = $1::uuid
        AND start_date <= $2::date
        AND end_date   >= $2::date - interval '30 days'
      ORDER BY end_date DESC
      LIMIT 1`,
    [userId, todayISO],
  );
  const row = res.rows[0];
  if (!row) return null;
  const end = toISO(row.end_date);
  const diff = Math.round(
    (Date.parse(`${todayISO}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`)) / 86_400_000,
  );
  // Inside the window · the confound is live now, not counting down yet.
  return diff <= 0 ? 0 : diff;
}

export interface TravelWindowInput {
  startISO: string;
  endISO: string;
  note?: string | null;
}

/** Validation shared by POST and PATCH · returns a reason or null. */
export function invalidWindowReason(w: TravelWindowInput): string | null {
  if (!ISO_RE.test(w.startISO ?? '')) return 'start_date must be YYYY-MM-DD';
  if (!ISO_RE.test(w.endISO ?? '')) return 'end_date must be YYYY-MM-DD';
  if (w.endISO < w.startISO) return 'end_date is before start_date';
  const days = (Date.parse(`${w.endISO}T00:00:00Z`) - Date.parse(`${w.startISO}T00:00:00Z`)) / 86_400_000 + 1;
  // A "travel window" measured in months is a relocation, and shaping a whole
  // block around it silently would be the wrong tool · the runner should
  // rebuild with their real availability instead.
  if (days > 60) return 'a window longer than 60 days is a move, not a trip · rebuild the plan instead';
  if (w.note != null && String(w.note).length > 280) return 'note is too long';
  return null;
}

export async function createTravelWindow(
  userId: string,
  w: TravelWindowInput,
): Promise<TravelWindowRow> {
  const res = await pool.query(
    `INSERT INTO travel_windows (user_uuid, start_date, end_date, note)
     VALUES ($1::uuid, $2::date, $3::date, $4)
     RETURNING id, start_date, end_date, note, created_at`,
    [userId, w.startISO, w.endISO, w.note ?? null],
  );
  return rowOf(res.rows[0]);
}

export async function updateTravelWindow(
  userId: string,
  id: number,
  w: TravelWindowInput,
): Promise<TravelWindowRow | null> {
  const res = await pool.query(
    `UPDATE travel_windows
        SET start_date = $3::date, end_date = $4::date, note = $5
      WHERE id = $2 AND user_uuid = $1::uuid
      RETURNING id, start_date, end_date, note, created_at`,
    [userId, id, w.startISO, w.endISO, w.note ?? null],
  );
  return res.rows[0] ? rowOf(res.rows[0]) : null;
}

export async function deleteTravelWindow(userId: string, id: number): Promise<boolean> {
  const res = await pool.query(
    `DELETE FROM travel_windows WHERE id = $2 AND user_uuid = $1::uuid`,
    [userId, id],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * True when [startISO, endISO] overlaps the active plan's window — the API
 * route's test for whether a save should fire the prefs-rebuild path so the
 * calendar reshapes immediately.
 */
export async function windowTouchesActivePlan(
  userId: string,
  startISO: string,
  endISO: string,
): Promise<boolean> {
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.date_iso::date BETWEEN $2::date AND $3::date`,
    [userId, startISO, endISO],
  );
  return Number(res.rows[0]?.n ?? 0) > 0;
}
