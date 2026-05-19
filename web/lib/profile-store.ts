/**
 * profile-store · Postgres reader + writer for the `profile` table.
 *
 * Pure shapes + validation live in profile-types.ts so the
 * EditProfileModal client component can import them without
 * pulling pg into the browser bundle. Writes go through
 * profile-write.ts. This module remains the read-path entry
 * point and re-exports the types for convenience.
 *
 * Read-only here. Write API lives at /api/profile/edit (POST).
 */

import { query } from './db';
import type { ProfileRow } from './profile-types';

export type { ProfileRow, ProfileInput } from './profile-types';
export { VALID_SEX, validateProfileInput } from './profile-types';
export type { Sex, ValidatedProfile } from './profile-types';

const COLS = `user_id, full_name, sex, age, city, runner_id, since_year, hrmax, rhr, accent_color, vo2max_apple, vo2max_apple_updated_at`;

export async function getProfile(userId = 'me'): Promise<ProfileRow | null> {
  const rows = await query<ProfileRow>(
    `SELECT ${COLS} FROM profile WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}
