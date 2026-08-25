/**
 * /api/goals/[id] — update or delete a personal_goals row.
 *
 * 2026-08-24 · `personal_goals` did not exist in production — see the header of
 * `app/api/goals/route.ts`. Both statements below threw `relation
 * "personal_goals" does not exist`, and `.catch(() => ({ rows: [] }))` turned
 * that into `rows.length === 0`, which is this file's test for "goal not
 * found". So the runner got a clean 404 telling them their goal is not there,
 * on a table that was not there.
 *
 * The table now exists (db/migrations/152_personal_goals.sql, applied to prod
 * 2026-08-24), so the 404 below is once again a fact about the goal.
 *
 * The `outage()` branches STAY. A read that failed is not a 404, whether or not
 * the table happens to exist today — that distinction is the point, and it
 * outlives the outage that exposed it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2026-08-24 · CLIENTS. DELETE is reached from Targets · STANDING GOALS
 * (`components/faff-app/views/TargetsView.tsx`), which is also where the list
 * that these ids come from is rendered. PATCH still has no client: there is no
 * edit form, and a goal is one free-text line, so "remove it and set the one
 * you mean" is the whole edit story today. It is left mounted rather than
 * removed because the column set it updates is the shape any later edit sheet
 * needs, and because it is reachable and correct — but it is NOT wired, and
 * saying so here is cheaper than the next audit rediscovering it.
 *
 * `id` is validated as an integer BEFORE it reaches the query. It used to go
 * through `Number(id)` unchecked, so `/api/goals/banana` sent `NaN` to a
 * bigint column, Postgres refused the statement, and the runner got a 5xx
 * outage — "we could not read" — for a request that was simply malformed. A
 * bad id is a 400, and only a real failure gets to claim an outage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { outage } from '@/lib/route/failure';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

type Params = { params: Promise<{ id: string }> };

/** `personal_goals.id` is a bigserial. Anything that is not a positive integer
 *  is a malformed request, not a database failure — see the header. */
function parseGoalId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const ALLOWED_PATCH = new Set([
  'target', 'current', 'deadline', 'tolerance', 'rationale',
]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  const goalId = parseGoalId(id);
  if (goalId === null) {
    return NextResponse.json({ ok: false, error: 'id must be a positive integer' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  const updates: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (!ALLOWED_PATCH.has(k)) continue;
    if (k === 'deadline' && typeof body.deadline === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(body.deadline)) continue;
    updates[k] = body[k];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: 'no allowed fields' }, { status: 400 });
  }

  const cols = Object.keys(updates);
  const setClauses = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const values = cols.map((c) => updates[c]);

  const rows = await rowsOrNull(
    'api/goals/[id] · patch',
    pool.query(
      `UPDATE personal_goals SET ${setClauses}, updated_at = NOW()
      WHERE id = $1 AND user_uuid = $2
      RETURNING id, goal_type, target, current, deadline::text AS deadline,
                tolerance, rationale, updated_at::text AS updated_at`,
      [goalId, userId, ...values],
    ),
  );
  if (rows === null) return outage('api/goals/[id]', new Error('personal_goals update failed'));

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'goal not found' }, { status: 404 });
  }
  await bustBriefingCacheForEvent(userId, 'profile_edit').catch(() => {});
  return NextResponse.json({ ok: true, goal: rows[0] });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  const goalId = parseGoalId(id);
  if (goalId === null) {
    return NextResponse.json({ ok: false, error: 'id must be a positive integer' }, { status: 400 });
  }

  const gone = await rowsOrNull<{ id: number }>(
    'api/goals/[id] · delete',
    pool.query<{ id: number }>(
      `DELETE FROM personal_goals WHERE id = $1 AND user_uuid = $2 RETURNING id`,
      [goalId, userId],
    ),
  );
  if (gone === null) return outage('api/goals/[id]', new Error('personal_goals delete failed'));

  if (gone.length === 0) {
    return NextResponse.json({ ok: false, error: 'goal not found' }, { status: 404 });
  }
  await bustBriefingCacheForEvent(userId, 'profile_edit').catch(() => {});
  return NextResponse.json({ ok: true, deleted: gone[0].id });
}
