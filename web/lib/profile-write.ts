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

const COLS = `user_id, full_name, sex, age, city, runner_id, since_year, hrmax, rhr, accent_color, vo2max_apple, vo2max_apple_updated_at`;

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

/** Update only the Apple Health VO2max for a user. Mirrors
 *  saveAccentColor — bypasses the full identity validator so the
 *  VO2max island works before name/age are set.
 *
 *  Accepts an integer 25-90 or null (to clear). Throws on bad input
 *  so the API route can surface a 400 with a precise message.
 *  Stamps vo2max_apple_updated_at to NOW() when value is non-null;
 *  to NULL when value is being cleared. */
export async function saveVo2MaxApple(
  raw: number | string | null | undefined,
  userId = 'me',
): Promise<{ value: number | null; updatedAt: string | null }> {
  let value: number | null = null;
  if (raw != null && raw !== '') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) {
      throw new Error('VO2max must be a number between 25 and 90.');
    }
    const intN = Math.trunc(n);
    if (intN < 25 || intN > 90) {
      throw new Error('VO2max must be between 25 and 90.');
    }
    value = intN;
  }

  const rows = await query<{ vo2max_apple: number | null; vo2max_apple_updated_at: string | null }>(
    `INSERT INTO profile (user_id, vo2max_apple, vo2max_apple_updated_at, updated_at)
     VALUES ($1, $2, CASE WHEN $2::int IS NULL THEN NULL ELSE NOW() END, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       vo2max_apple = EXCLUDED.vo2max_apple,
       vo2max_apple_updated_at = CASE WHEN EXCLUDED.vo2max_apple IS NULL THEN NULL ELSE NOW() END,
       updated_at = NOW()
     RETURNING vo2max_apple, vo2max_apple_updated_at`,
    [userId, value],
  );
  const row = rows[0];
  return {
    value: row?.vo2max_apple ?? null,
    updatedAt: row?.vo2max_apple_updated_at ?? null,
  };
}
