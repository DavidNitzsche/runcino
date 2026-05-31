/**
 * POST /api/plan/generate
 *
 * Body: { raceSlug: string }
 * Generates (or regenerates) a training plan anchored to the given race.
 * Archives any existing active plan, then writes a fresh one.
 *
 * Algorithmic — see lib/plan/generate.ts for block model + citations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { generatePlan } from '@/lib/plan/generate';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireUserId } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  const raceSlug: string | undefined = body?.raceSlug;
  if (!raceSlug) {
    return NextResponse.json({ error: 'raceSlug required' }, { status: 400 });
  }

  try {
    const result = await generatePlan({ userId, raceSlug });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason ?? 'generation failed' }, { status: 400 });
    }
    await bustBriefingCacheForEvent(userId, 'plan_swap');
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[plan/generate] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
