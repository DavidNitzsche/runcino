/**
 * prefs-store · Postgres reader for the `user_prefs` table.
 *
 * Single-row-per-user (user_id PK, defaults to 'me'). All preference
 * fields are nullable. When a row doesn't exist the API returns
 * defaults explicitly tagged via `isDefault`, so the UI can show
 * "Using defaults — set yours".
 */

import { query } from './db';

export interface PrefsRow {
  user_id: string;
  /** Day name ("Sunday"). null = not set. */
  long_run_day: string | null;
  /** Quality day combo ("Tue / Thu"). null = not set. */
  quality_days: string | null;
  /** Typical rest day ("Mon"). null = not set. */
  rest_day: string | null;
  /** Rest cadence ("1-2/wk"). null = not set. */
  rest_cadence: string | null;
  /** Units string ("Imperial · °F"). null = not set. */
  units: string | null;
}

const COLS = `user_id, long_run_day, quality_days, rest_day, rest_cadence, units`;

/** Fetch the prefs row for the current user. Returns null when no
 *  row exists. Caller surfaces app-wide defaults when null. */
export async function getUserPrefs(userId = 'me'): Promise<PrefsRow | null> {
  const rows = await query<PrefsRow>(
    `SELECT ${COLS} FROM user_prefs WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}
