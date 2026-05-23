/**
 * GET /api/adaptive/vdot-verdict
 *
 * Tier-2-to-tier-1 lift · the L7 adaptive VDOT verdict (the most
 * adaptive-state-laden surface in the system).  The iPhone bridge
 * renders the AdaptiveVdotBanner equivalent from this response.
 *
 * Response: AdaptiveVdotVerdict · {
 *   currentVdot, dismissed, manualOverride, signals, signal2, signal3,
 *   signal4, hasFinding,
 *   recommendation: { kind, ... } discriminated union per kind:
 *     'no-finding' | 'insufficient-data' | 'race-week-suspended'
 *     | 'vdot-bump-suggested' (includes V7 crossRef for Signal 4 PR)
 *     | 'vdot-downgrade-investigate'
 * }
 *
 * The `recommendation.kind` discriminator is the iPhone client's
 * type-narrow signal · branch on it to render the correct UI state.
 *
 * Auth: Bearer (cookie also accepted).
 * Tier 1 stable public.
 *
 * RULE 2 NOTE: bump-suggested and downgrade-investigate verdicts
 * carry a falsifier field per CLAUDE.md.  iPhone client renders
 * the falsifier with the canonical lead-in "What would change our
 * mind:" (the same one the web AdaptiveVdotBanner uses, sourced
 * from lib/coach-voice.ts).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { buildAdaptiveVdotVerdict } from '@/lib/adaptive-vdot-verdict';
import { resolveFitness } from '@/lib/fitness-resolver';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });

  const today = todayISO(user.timezone || userTimezone(user.location));
  const fitness = await resolveFitness(user.id, today);

  const verdict = await buildAdaptiveVdotVerdict(
    user.id,
    fitness.vdot.value,
    fitness.maxHr.value,
    new Date(today + 'T12:00:00Z'),
  );
  return NextResponse.json(verdict);
}
