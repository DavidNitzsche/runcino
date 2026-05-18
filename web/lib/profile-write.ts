/**
 * profile-write · DB write path for the profile table.
 *
 * Lives next to profile-store.ts (read-only) so that the API route
 * can import the writer without dragging the writer into anything
 * that imports the reader.
 */

import { query } from './db';
import {
  validateAccentColor,
  validateProfileInput,
  type ProfileInput,
  type ProfileRow,
} from './profile-types';

const COLS = `user_id, full_name, sex, age, city, runner_id, since_year, hrmax, rhr, accent_color`;

export async function saveProfile(
  input: ProfileInput,
  userId = 'me',
): Promise<ProfileRow> {
  const v = validateProfileInput(input);

  const rows = await query<ProfileRow>(
    `INSERT INTO profile
       (user_id, full_name, sex, age, city, runner_id, since_year, hrmax, rhr, accent_color, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       full_name    = EXCLUDED.full_name,
       sex          = EXCLUDED.sex,
       age          = EXCLUDED.age,
       city         = EXCLUDED.city,
       runner_id    = EXCLUDED.runner_id,
       since_year   = EXCLUDED.since_year,
       hrmax        = EXCLUDED.hrmax,
       rhr          = EXCLUDED.rhr,
       accent_color = EXCLUDED.accent_color,
       updated_at   = NOW()
     RETURNING ${COLS}`,
    [
      userId,
      v.full_name,
      v.sex,
      v.age,
      v.city,
      v.runner_id,
      v.since_year,
      v.hrmax,
      v.rhr,
      v.accent_color,
    ],
  );
  if (!rows[0]) throw new Error('Profile save did not return a row.');
  return rows[0];
}

/** Update only the accent color for a user. Used by the accent picker
 *  on /profile — avoids re-running the full profile validator (which
 *  would 400 when name/age aren't set yet). */
export async function saveAccentColor(
  rawColor: string | null,
  userId = 'me',
): Promise<string | null> {
  const color = validateAccentColor(rawColor);
  const rows = await query<{ accent_color: string | null }>(
    `INSERT INTO profile (user_id, accent_color, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       accent_color = EXCLUDED.accent_color,
       updated_at   = NOW()
     RETURNING accent_color`,
    [userId, color],
  );
  return rows[0]?.accent_color ?? null;
}
