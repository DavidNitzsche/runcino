/**
 * GET /api/health/z2-sparkline
 *
 * Tier-2-to-tier-1 lift · 8-week Z2 pace trend at fixed HR.  Powers
 * the iPhone bridge's Coach Reads equivalent without needing the
 * /profile SSR envelope.
 *
 * Response: Z2SparklineResult · { z2Band, points, paceRange, hasSignal,
 *   crossRef?, recalibrationHedge? }
 *
 * Auth: Bearer (cookie also accepted).
 * Tier 1 stable public.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { computeZ2Sparkline } from '@/lib/z2-sparkline';
import { resolveFitness } from '@/lib/fitness-resolver';
import { query } from '@/lib/db';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });

  const today = todayISO(userTimezone(user.location));
  const fitness = await resolveFitness(user.id, today);

  // V7 recalibration cross-reference needs max_hr_updated_at to
  // detect whether the sparkline window spans a zone recalibration.
  const maxHrUpdatedAt = await query<{ at: string | null }>(
    `SELECT max_hr_updated_at AS at FROM users WHERE id = $1 LIMIT 1`,
    [user.id],
  ).then((rows) => rows[0]?.at ? new Date(rows[0].at) : null).catch(() => null);

  const result = await computeZ2Sparkline(
    user.id, new Date(), fitness.maxHr.value, fitness.restingHr.value, maxHrUpdatedAt,
  );
  return NextResponse.json(result);
}
