/**
 * /api/goals/[id] — update or delete a personal_goals row.
 *
 * 2026-08-24 · `personal_goals` does not exist in production — see the header
 * of `app/api/goals/route.ts` for the check and the DDL proposal. Both
 * statements below threw `relation "personal_goals" does not exist`, and
 * `.catch(() => ({ rows: [] }))` turned that into `rows.length === 0`, which is
 * this file's test for "goal not found". So the runner got a clean 404 telling
 * them their goal is not there, on a table that is not there.
 *
 * A read that failed is not a 404. It is an outage, and it says so.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { outage } from '@/lib/route/failure';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

type Params = { params: Promise<{ id: string }> };

const ALLOWED_PATCH = new Set([
  'target', 'current', 'deadline', 'tolerance', 'rationale',
]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

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
      [Number(id), userId, ...values],
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
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

  const gone = await rowsOrNull<{ id: number }>(
    'api/goals/[id] · delete',
    pool.query<{ id: number }>(
      `DELETE FROM personal_goals WHERE id = $1 AND user_uuid = $2 RETURNING id`,
      [Number(id), userId],
    ),
  );
  if (gone === null) return outage('api/goals/[id]', new Error('personal_goals delete failed'));

  if (gone.length === 0) {
    return NextResponse.json({ ok: false, error: 'goal not found' }, { status: 404 });
  }
  await bustBriefingCacheForEvent(userId, 'profile_edit').catch(() => {});
  return NextResponse.json({ ok: true, deleted: gone[0].id });
}
