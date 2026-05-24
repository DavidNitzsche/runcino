/**
 * /api/activity/rpe — post-run subjective RPE + notes per activity.
 *
 * GET  ?activityId=...                          → { ok, rpe: PostRunRpe | null }
 * POST { activityId, rpe, notes? }              → { ok, rpe }
 *
 * Coach reads via runRead/formRead to enrich the FORM verdict.
 * When subjectiveRpe ≥ 7 on a planned-easy day, the coach reads it
 * as a fatigue signal and softens tomorrow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getRpe, upsertRpe } from '@/lib/rpe-store';
import { invalidate } from '@/lib/coach-reads-cache';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });
  const activityId = req.nextUrl.searchParams.get('activityId');
  if (!activityId) return NextResponse.json({ ok: false, error: 'activityId required' }, { status: 400 });
  const rpe = await getRpe(user.id, activityId);
  return NextResponse.json({ ok: true, rpe });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });

  let body: { activityId?: string; rpe?: number | null; notes?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (!body.activityId) return NextResponse.json({ ok: false, error: 'activityId required' }, { status: 400 });
  const rpe = body.rpe == null ? null : Math.min(10, Math.max(1, Number(body.rpe)));

  const saved = await upsertRpe(user.id, body.activityId, rpe, body.notes ?? null);

  // RPE updates the FORM read for this activity.
  await invalidate(user.id, 'activity-load');

  return NextResponse.json({ ok: true, rpe: saved });
}
