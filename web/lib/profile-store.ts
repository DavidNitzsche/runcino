/**
 * profile-store · Postgres reader for the `profile` table.
 *
 * The table is single-row-per-user (user_id PK, defaults to 'me'
 * until auth lands). All fields are nullable — when a runner has not
 * filled in their profile, the row may not exist OR may exist with
 * mostly null columns.
 *
 * Read-only for now. Write API lands when /profile gets an edit modal.
 */

import { query } from './db';

export interface ProfileRow {
  user_id: string;
  full_name: string | null;
  sex: string | null;
  age: number | null;
  city: string | null;
  runner_id: string | null;
  since_year: number | null;
  /** Measured HRmax in bpm. null when not entered (Tanaka estimate
   *  derived from age is the fallback). */
  hrmax: number | null;
  /** Resting HR — requires HealthKit or manual entry. null today. */
  rhr: number | null;
}

const COLS = `user_id, full_name, sex, age, city, runner_id, since_year, hrmax, rhr`;

/** Fetch the profile row for the current user (always 'me' today).
 *  Returns null when no row exists — caller renders NO DATA YET. */
export async function getProfile(userId = 'me'): Promise<ProfileRow | null> {
  const rows = await query<ProfileRow>(
    `SELECT ${COLS} FROM profile WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}
