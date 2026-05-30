/**
 * /api/goals/[id] — update or delete a personal_goals row.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

type Params = { params: Promise<{ id: string }> };

const ALLOWED_PATCH = new Set([
  'target', 'current', 'deadline', 'tolerance', 'rationale',
]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const userId = await userIdFromRequest(req);
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

  const r = await pool.query(
    `UPDATE personal_goals SET ${setClauses}, updated_at = NOW()
      WHERE id = $1 AND user_uuid = $2
      RETURNING id, goal_type, target, current, deadline::text AS deadline,
                tolerance, rationale, updated_at::text AS updated_at`,
    [Number(id), userId, ...values],
  ).catch(() => ({ rows: [] }));

  if (r.rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'goal not found' }, { status: 404 });
  }
  await bustBriefingCacheForEvent(userId, 'profile_edit').catch(() => {});
  return NextResponse.json({ ok: true, goal: r.rows[0] });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const userId = await userIdFromRequest(req);
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

  const r = await pool.query(
    `DELETE FROM personal_goals WHERE id = $1 AND user_uuid = $2 RETURNING id`,
    [Number(id), userId],
  ).catch(() => ({ rows: [] }));

  if (r.rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'goal not found' }, { status: 404 });
  }
  await bustBriefingCacheForEvent(userId, 'profile_edit').catch(() => {});
  return NextResponse.json({ ok: true, deleted: r.rows[0].id });
}
