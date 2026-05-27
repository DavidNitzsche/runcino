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

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const raceSlug: string | undefined = body?.raceSlug;
  if (!raceSlug) {
    return NextResponse.json({ error: 'raceSlug required' }, { status: 400 });
  }

  const userId = body?.user_id ?? DAVID_USER_ID;
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
