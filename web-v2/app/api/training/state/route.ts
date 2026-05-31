/**
 * GET /api/training/state — full plan state for iPhone /training.
 *
 * Mirrors the web /training page's loadTrainingState() output: active
 * plan id, target race, phase boundaries, every week of the plan
 * (planned vs done mileage per day), current phase + week index, week
 * volume, next quality session. Same data the web PhaseStrip / PlanArc
 * / WeekAhead components consume.
 *
 * 2026-05-27: shipped after David said the iPhone /training was
 * "pointless — just a different version of TODAY." Web /training shows
 * the whole plan arc + phases + multi-week mileage; iPhone now reads
 * the same source to render those surfaces natively.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadTrainingState } from '@/lib/coach/training-state';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    const state = await loadTrainingState(userId);
    return NextResponse.json(state);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
