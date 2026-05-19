/**
 * POST /api/profile/vdot-shift/action
 *
 * Handles the three actions on the ongoing-large-shift guard banner:
 *
 *   { action: 'apply' }       · accept the new VDOT as the reviewed
 *                                 baseline. Banner stops firing until
 *                                 next >2pt drift.
 *   { action: 'dismiss' }     · 30-day suppress.
 *   { action: 'investigate' } · 24-hour snooze.
 *
 * Body for apply may include { currentVdot: number } so the client
 * passes the value it saw on screen; the server clamps and rounds.
 * If absent, the server computes aggregate VDOT and uses that.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { recordVdotReview, dismissVdotShift, snoozeVdotShift } from '@/lib/vdot-shift';
import { computeAggregateVdot } from '@/lib/compute-vdot';

interface Body {
  action?: 'apply' | 'dismiss' | 'investigate';
  currentVdot?: number;
}

export async function POST(req: Request) {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const action = body.action;
  if (action === 'apply') {
    let target = typeof body.currentVdot === 'number' && Number.isFinite(body.currentVdot)
      ? body.currentVdot
      : null;
    if (target == null) {
      const agg = await computeAggregateVdot(user.id);
      target = agg?.value ?? null;
    }
    if (target == null || target < 20 || target > 90) {
      return NextResponse.json({ error: 'No valid VDOT to record' }, { status: 400 });
    }
    await recordVdotReview(user.id, target);
    return NextResponse.json({ ok: true, recordedVdot: target });
  }
  if (action === 'dismiss') {
    await dismissVdotShift(user.id);
    return NextResponse.json({ ok: true });
  }
  if (action === 'investigate') {
    await snoozeVdotShift(user.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
