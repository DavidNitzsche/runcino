/**
 * lib/onboarding/initial-name.ts · Step 3 name pre-fill resolution.
 *
 * Resolution ladder (first non-null wins):
 *   1. URL ?name= param  (back-button workflow · caller passes state.name)
 *   2. profile.full_name OR users.name (returning runner)
 *   3. Strava athlete firstname (if Strava token present)
 *   4. null  (runner types it cold)
 *
 * Pairs with:
 *   · designs/briefs/onboarding-master.md § Step 3 · Name input
 *   · designs/briefs/onboarding-master-execution.md § TASK B3
 *   · components/onboarding/Step3Confirm.tsx · initialName prop
 */

import { pool } from '@/lib/db/pool';

interface ResolveInput {
  userUuid: string;
  /** Already-typed name from URL state · wins everything else. */
  urlName: string | null;
}

export async function resolveInitialName(input: ResolveInput): Promise<string | null> {
  // 1. URL param wins (back-button safe)
  if (input.urlName && input.urlName.length > 0) return input.urlName;

  // 2. Existing profile / users row (returning user)
  const dbRow = (await pool.query<{ full_name: string | null; users_name: string | null }>(
    `SELECT p.full_name AS full_name,
            u.name      AS users_name
       FROM profile p
       FULL OUTER JOIN users u ON u.id = p.user_uuid
      WHERE p.user_uuid = $1::uuid OR u.id = $1::uuid
      LIMIT 1`,
    [input.userUuid],
  ).catch(() => ({ rows: [] as Array<{ full_name: string | null; users_name: string | null }> }))).rows[0];

  if (dbRow?.full_name && dbRow.full_name.trim().length > 0) {
    return firstNameOnly(dbRow.full_name);
  }
  if (dbRow?.users_name && dbRow.users_name.trim().length > 0) {
    return firstNameOnly(dbRow.users_name);
  }

  // 3. Strava athlete · we pre-stamp users.name from Strava on OAuth,
  //    so step 2 typically catches this. Skipping a redundant Strava
  //    API call · the cached name is enough.

  // 4. null · runner types it
  return null;
}

function firstNameOnly(s: string): string {
  return s.trim().split(/\s+/)[0] ?? s.trim();
}
