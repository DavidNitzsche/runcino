/**
 * /api/goals — personal_goals CRUD (non-race goals).
 *
 * Per docs/2026-05-30.html §12 + the input-tiers doctrine, runners can
 * set non-race goals (volume / speed / distance / habit /
 * health) OR the coach can surface them when the runner is close to a
 * milestone (e.g., "1 min from your 5K PR — want to take a shot?").
 *
 * GET    /api/goals               → list active (deadline >= today or deadline IS NULL)
 * POST   /api/goals { goal_type, target, deadline?, current?, tolerance?, rationale? }
 * PATCH  /api/goals/[id]          → update current/target/deadline/rationale
 * DELETE /api/goals/[id]          → hard delete (no soft-delete column)
 *
 * Cite: docs/SYSTEM_DOCTRINE.md §3 input tiers (T6 pro features).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2026-08-24 · THE TABLE DOES NOT EXIST IN PRODUCTION.
 *
 * `personal_goals` is named by these four statements and by nothing else in the
 * app, and there is no migration that creates it — checked against prod with
 * `faff_readonly` on 2026-08-24, and against every file in `db/migrations`.
 *
 * So GET threw `relation "personal_goals" does not exist` on every call, and
 * `.catch(() => ({ rows: [] }))` turned that into `{ ok: true, goals: [] }`.
 * A 200 saying the runner has no goals. Not "this is not available" — no
 * goals, stated confidently, forever.
 *
 * Until the table exists this route cannot answer, and the honest answer to a
 * question you cannot answer is to say so. `outage()` is the one way a route
 * reports that it could not read (lib/route/failure.ts): 5xx, coach voice, no
 * `reason` key, so the phone renders it as a retryable outage and never as a
 * refusal or an empty state.
 *
 * The DDL to make this work is a PROPOSAL, not something this change runs:
 *
 *   CREATE TABLE personal_goals (
 *     id          bigserial PRIMARY KEY,
 *     user_uuid   uuid NOT NULL,
 *     goal_type   text NOT NULL CHECK (goal_type IN
 *                   ('volume','speed','distance','habit','health','strength')),
 *     target      text NOT NULL,
 *     current     text,
 *     deadline    date,
 *     tolerance   text,
 *     rationale   text,
 *     created_at  timestamptz NOT NULL DEFAULT now(),
 *     updated_at  timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX personal_goals_user_idx ON personal_goals (user_uuid, deadline);
 *
 * ('strength' is in the CHECK because STRENGTH-3 kept existing rows readable
 * while gating new writes — see `VALID_GOAL_TYPES` below.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { outage } from '@/lib/route/failure';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

// STRENGTH-3 (2026-08-17) · 'strength' removed. New strength goals are
// rejected; rows already carrying goal_type='strength' still GET fine
// (this set only gates writes).
const VALID_GOAL_TYPES = new Set([
  'volume', 'speed', 'distance', 'habit', 'health',
]);

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const rows = await rowsOrNull(
    'api/goals · list',
    pool.query(
      `SELECT id, goal_type, target, current, deadline::text AS deadline,
            tolerance, rationale, created_at::text AS created_at,
            updated_at::text AS updated_at
       FROM personal_goals
      WHERE user_uuid = $1
        AND (deadline IS NULL OR deadline >= CURRENT_DATE)
      ORDER BY deadline ASC NULLS LAST, created_at DESC`,
      [userId],
    ),
  );
  // A failed read is not an empty goal list. See the header for why this read
  // fails on every call today.
  if (rows === null) return outage('api/goals', new Error('personal_goals read failed'));
  return NextResponse.json({ ok: true, goals: rows });
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
