/**
 * prefs-store · Postgres reader for the `user_prefs` table.
 *
 * Single-row-per-user (user_id PK, defaults to 'me'). All preference
 * fields are nullable. When a row doesn't exist the API returns
 * defaults explicitly tagged via `isDefault`, so the UI can show
 * "Using defaults, set yours".
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
  /** Runner level for plan-template selection. null = auto-detect.
   *  Optional in legacy callers (DB column added in Wave V). */
  level?: 'beginner' | 'intermediate' | 'advanced' | null;
  /** Long-run day as JS getDay() int (0=Sun..6=Sat). null = not set. */
  long_run_dow?: number | null;
  /** Quality days as comma-separated JS getDay() ints. null = not set. */
  quality_dows?: string | null;
  /** Rest day as JS getDay() int. null = not set. */
  rest_dow?: number | null;
}

const COLS = `user_id, long_run_day, quality_days, rest_day, rest_cadence, units, level, long_run_dow, quality_dows, rest_dow`;

/** Fetch the prefs row for the current user. Returns null when no
 *  row exists. Caller surfaces app-wide defaults when null. */
export async function getUserPrefs(userId = 'me'): Promise<PrefsRow | null> {
  const rows = await query<PrefsRow>(
    `SELECT ${COLS} FROM user_prefs WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export interface UserPrefsInput {
  level?: 'beginner' | 'intermediate' | 'advanced' | null;
  long_run_dow?: number | null;
  quality_dows?: number[] | null;
  rest_dow?: number | null;
  /** Optional human-readable mirrors. */
  long_run_day?: string | null;
  quality_days?: string | null;
  rest_day?: string | null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Upsert the prefs row for the current user. */
export async function saveUserPrefs(input: UserPrefsInput, userId = 'me'): Promise<PrefsRow> {
  // Mirror the int columns into the legacy text columns so any code
  // still reading day_name strings continues to work.
  const longRunDay = input.long_run_day
    ?? (input.long_run_dow != null && input.long_run_dow >= 0 && input.long_run_dow < 7
      ? DAY_NAMES[input.long_run_dow]
      : null);
  const qualityDays = input.quality_days
    ?? (input.quality_dows && input.quality_dows.length > 0
      ? input.quality_dows.map(d => DAY_NAMES[d] ?? '').filter(Boolean).join(' / ')
      : null);
  const restDay = input.rest_day
    ?? (input.rest_dow != null && input.rest_dow >= 0 && input.rest_dow < 7
      ? DAY_NAMES[input.rest_dow]
      : null);
  const qualityDowsStr = input.quality_dows && input.quality_dows.length > 0
    ? input.quality_dows.join(',')
    : null;

  const rows = await query<PrefsRow>(
    `INSERT INTO user_prefs
       (user_id, long_run_day, quality_days, rest_day, rest_cadence, units,
        level, long_run_dow, quality_dows, rest_dow, updated_at)
     VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       long_run_day = EXCLUDED.long_run_day,
       quality_days = EXCLUDED.quality_days,
       rest_day     = EXCLUDED.rest_day,
       level        = COALESCE(EXCLUDED.level, user_prefs.level),
       long_run_dow = EXCLUDED.long_run_dow,
       quality_dows = EXCLUDED.quality_dows,
       rest_dow     = EXCLUDED.rest_dow,
       updated_at   = NOW()
     RETURNING ${COLS}`,
    [
      userId, longRunDay, qualityDays, restDay,
      input.level ?? null, input.long_run_dow ?? null, qualityDowsStr, input.rest_dow ?? null,
    ],
  );
  if (!rows[0]) throw new Error('User prefs save did not return a row.');
  return rows[0];
}
