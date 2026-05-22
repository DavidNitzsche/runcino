/**
 * GET /api/health/readiness
 *
 * Tier-2-to-tier-1 lift · exposes computeReadinessScore() so the
 * iPhone bridge can render today's readiness without the /overview
 * SSR envelope.
 *
 * Response: ReadinessFinding · { score, state, recommendation,
 *   inputs, missingInputs, suppressReason?, crossRef? }
 *
 * Auth: Bearer (cookie also accepted).
 * Tier 1 stable public.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { computeReadinessScore } from '@/lib/readiness-score';
import { computeZ2CoverageFinding } from '@/lib/z2-coverage';
import { resolveFitness } from '@/lib/fitness-resolver';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });

  const today = todayISO(user.timezone || userTimezone(user.location));
  const fitness = await resolveFitness(user.id, today);

  // V5 → C6 cross-ref needs the z2Finding · pull in parallel since
  // both are cheap reads.
  const z2Finding = await computeZ2CoverageFinding(
    user.id, today, fitness.maxHr.value, fitness.restingHr.value, fitness.vdot.value,
  ).catch(() => null);

  const result = await computeReadinessScore(
    user.id, today, fitness.maxHr.value, fitness.restingHr.value, z2Finding,
  );
  return NextResponse.json(result);
}
