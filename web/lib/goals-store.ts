/**
 * goals-store · Postgres reader for the `personal_goals` table.
 *
 * Write path is in /api/goals/route.ts (POST). This module surfaces
 * the same rows for server-side composition (the profile route uses
 * it to build the Personal Goals card).
 */

import { query } from './db';

export type GoalType = 'volume' | 'speed' | 'distance' | 'habit' | 'strength' | 'health';

export interface GoalRow {
  id: number;
  user_id: string;
  goal_type: GoalType;
  target: string;
  current: string | null;
  deadline: string | null;
  tolerance: string | null;
  rationale: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = `id, user_id, goal_type, target, current, deadline::text AS deadline,
  tolerance, rationale, created_at::text AS created_at, updated_at::text AS updated_at`;

/** List active personal goals for a user, newest first. Returns []
 *  when nothing has been added, caller renders the empty CTA. */
export async function listPersonalGoals(userId = 'me'): Promise<GoalRow[]> {
  return query<GoalRow>(
    `SELECT ${COLS} FROM personal_goals
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
}
