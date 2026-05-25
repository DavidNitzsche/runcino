/**
 * /api/goals, personal goal CRUD.
 *
 * POST → create a new goal row in personal_goals.
 *   Body: { goal_type, target, current?, deadline?, tolerance?, rationale? }
 *   Returns: { id, ...row }
 *
 * GET → list rows for the current user (default 'me').
 *   Returns: { goals: Array<{...}> }
 *
 * The personal_goals table is created on first query via lib/db.ts
 * bootstrap. No auth yet, user_id is hard-coded to 'me' until auth
 * lands; matches the same pattern as other user-scoped tables.
 */

import { query } from '../../../lib/db';

interface GoalRow {
  id: number;
  user_id: string;
  goal_type: 'volume' | 'speed' | 'distance' | 'habit' | 'strength' | 'health';
  target: string;
  current: string | null;
  deadline: string | null;
  tolerance: string | null;
  rationale: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_TYPES = ['volume', 'speed', 'distance', 'habit', 'strength', 'health'] as const;
type GoalType = typeof VALID_TYPES[number];

export async function GET() {
  try {
    const rows = await query<GoalRow>(
      `SELECT id, user_id, goal_type, target, current, deadline::text, tolerance, rationale,
              created_at::text, updated_at::text
       FROM personal_goals
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      ['me'],
    );
    return Response.json({ ok: true, goals: rows });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: Partial<{
    goal_type: GoalType;
    target: string;
    current: string;
    deadline: string;
    tolerance: string;
    rationale: string;
  }>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.goal_type || !VALID_TYPES.includes(body.goal_type)) {
    return Response.json(
      { ok: false, error: `goal_type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  if (!body.target || typeof body.target !== 'string' || body.target.trim().length === 0) {
    return Response.json({ ok: false, error: 'target is required' }, { status: 400 });
  }

  try {
    const rows = await query<GoalRow>(
      `INSERT INTO personal_goals (user_id, goal_type, target, current, deadline, tolerance, rationale)
       VALUES ('me', $1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, goal_type, target, current, deadline::text, tolerance, rationale,
                 created_at::text, updated_at::text`,
      [
        body.goal_type,
        body.target.trim(),
        body.current?.trim() || null,
        body.deadline || null,
        body.tolerance?.trim() || null,
        body.rationale?.trim() || null,
      ],
    );
    return Response.json({ ok: true, goal: rows[0] });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
