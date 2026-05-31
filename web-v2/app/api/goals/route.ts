/**
 * /api/goals — personal_goals CRUD (non-race goals).
 *
 * Per docs/2026-05-30.html §12 + the input-tiers doctrine, runners can
 * set non-race goals (volume / speed / distance / habit / strength /
 * health) OR the coach can surface them when the runner is close to a
 * milestone (e.g., "1 min from your 5K PR — want to take a shot?").
 *
 * GET    /api/goals               → list active (deadline >= today or deadline IS NULL)
 * POST   /api/goals { goal_type, target, deadline?, current?, tolerance?, rationale? }
 * PATCH  /api/goals/[id]          → update current/target/deadline/rationale
 * DELETE /api/goals/[id]          → hard delete (no soft-delete column)
 *
 * Cite: docs/SYSTEM_DOCTRINE.md §3 input tiers (T6 pro features).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const VALID_GOAL_TYPES = new Set([
  'volume', 'speed', 'distance', 'habit', 'strength', 'health',
]);

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const r = await pool.query(
    `SELECT id, goal_type, target, current, deadline::text AS deadline,
            tolerance, rationale, created_at::text AS created_at,
            updated_at::text AS updated_at
       FROM personal_goals
      WHERE user_uuid = $1
        AND (deadline IS NULL OR deadline >= CURRENT_DATE)
      ORDER BY deadline ASC NULLS LAST, created_at DESC`,
    [userId],
  ).catch(() => ({ rows: [] }));
  return NextResponse.json({ ok: true, goals: r.rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  const goalType = String(body.goal_type ?? '').toLowerCase();
  if (!VALID_GOAL_TYPES.has(goalType)) {
    return NextResponse.json({
      ok: false,
      error: `goal_type must be one of: ${[...VALID_GOAL_TYPES].join(', ')}`,
    }, { status: 400 });
  }
  const target = typeof body.target === 'string' ? body.target.trim() : '';
  if (!target) return NextResponse.json({ ok: false, error: 'target required' }, { status: 400 });

  const r = await pool.query(
    `INSERT INTO personal_goals (user_uuid, goal_type, target, current, deadline, tolerance, rationale)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, goal_type, target, current, deadline::text AS deadline,
               tolerance, rationale, created_at::text AS created_at`,
    [
      userId,
      goalType,
      target,
      typeof body.current === 'string' ? body.current : null,
      typeof body.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.deadline) ? body.deadline : null,
      typeof body.tolerance === 'string' ? body.tolerance : null,
      typeof body.rationale === 'string' ? body.rationale : null,
    ],
  );

  // Coach picks goals up via state-loader; bust cache so the next
  // briefing render sees the new goal.
  await bustBriefingCacheForEvent(userId, 'profile_edit').catch(() => {});

  return NextResponse.json({ ok: true, goal: r.rows[0] });
}
