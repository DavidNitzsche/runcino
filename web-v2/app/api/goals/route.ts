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
 * 2026-08-24 · THE TABLE DID NOT EXIST. NOW IT DOES — db/migrations/152.
 *
 * `personal_goals` is named by these four statements and by nothing else in the
 * app, and no migration created it. GET therefore threw `relation
 * "personal_goals" does not exist` on every call, and `.catch(() => ({ rows: []
 * }))` turned that into `{ ok: true, goals: [] }` — a 200 saying the runner has
 * no goals. Not "this is not available". No goals, stated confidently, forever.
 *
 * Two things were wrong and both are fixed, in the order they had to be:
 *   1. the swallow — replaced with `outage()` (lib/route/failure.ts): 5xx,
 *      coach voice, no `reason` key, so the phone renders a retryable outage
 *      and never a refusal or an empty state;
 *   2. the absence — `152_personal_goals.sql`, applied to prod 2026-08-24.
 *
 * KEEP THE `outage()` BRANCHES. They are not scaffolding for a missing table;
 * they are what a failed read is supposed to look like, and the table existing
 * does not make a read incapable of failing. An empty `goals` array now means
 * what it says: we looked, and this runner has set no goals.
 *
 * 2026-08-24 (later the same day) · THE READ SIDE NOW EXISTS.
 *
 * The entry above used to end by noting that nothing in the app READ this
 * table: both clients POSTed, `GET` had no in-app caller, and the coach never
 * saw a goal. A create form whose output is invisible is worse than no form —
 * it asks the runner what they are chasing and then never mentions it again.
 *
 * The read side is `lib/coach/personal-goals.ts`, and it is the ONE query.
 * This route's GET calls it, `lib/coach/profile-state.ts` puts the same rows on
 * ProfileState, `reciteMe()` states them back on the coach's ME surface
 * (/api/coach/facts?surface=me + /api/briefing, which is what iPhone's
 * ProfileView renders), and Targets renders STANDING GOALS beside the pill that
 * creates them. `lib/coach/_personal_goals_wiring.test.ts` is the guard.
 *
 * ('strength' is in the table's CHECK because STRENGTH-3 kept existing rows
 * readable while gating new writes — see `VALID_GOAL_TYPES` below.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { outage } from '@/lib/route/failure';
import { loadPersonalGoals } from '@/lib/coach/personal-goals';
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
  // One query, shared with every other reader · lib/coach/personal-goals.ts.
  // It returns null on a failed read and [] on an honest nothing, and this
  // route is the reason that distinction has to survive the trip.
  const goals = await loadPersonalGoals(userId);
  // A failed read is not an empty goal list.
  if (goals === null) return outage('api/goals', new Error('personal_goals read failed'));
  return NextResponse.json({ ok: true, goals });
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

  // The coach reads goals through lib/coach/personal-goals.ts →
  // profile-state → reciteMe (NOT the state-loader · that claim stood here
  // for months and was never true). 'profile_edit' is the right event: the ME
  // surface is where the goal now shows up, so a cached briefing has to go.
  await bustBriefingCacheForEvent(userId, 'profile_edit').catch(() => {});

  return NextResponse.json({ ok: true, goal: r.rows[0] });
}
