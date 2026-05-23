/**
 * GET /api/health/z2-coverage
 *
 * Tier-2-to-tier-1 lift · V5 Z2 stimulus check as a standalone endpoint.
 * Native clients render the same Z2 coverage observation iPhone bridge
 * can show before/after a run.
 *
 * Response: Z2CoverageFinding · { shouldRender, suppressReason?,
 *   z2CeilingBpm, ePaceRangeDisplay, last7d, last28d, thresholdUnderReach }
 *
 * Auth: Bearer (cookie also accepted).
 * Tier 1 stable public.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { computeZ2CoverageFinding } from '@/lib/z2-coverage';
import { resolveFitness } from '@/lib/fitness-resolver';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });

  const today = todayISO(user.timezone || userTimezone(user.location));
  const fitness = await resolveFitness(user.id, today);

  const result = await computeZ2CoverageFinding(
    user.id, today, fitness.maxHr.value, fitness.restingHr.value, fitness.vdot.value,
  );
  return NextResponse.json(result);
}
