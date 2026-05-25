/**
 * GET /api/races/[slug]/trajectory
 *
 * Tier-2-to-tier-1 lift · V3 race trajectory state.  Powers the
 * iPhone bridge's race-hero equivalent without the /races SSR
 * envelope.
 *
 * The trajectory function reads L7 signal state to classify the
 * race as AHEAD / ON-TRACK / BEHIND / COLLECTING-EVIDENCE per V3.
 * NOTE: the underlying computeRaceTrajectory derives state from the
 * user's overall signals (not slug-specific), the slug is here for
 * future race-specific extensions and to match the canonical URL
 * shape iPhone clients use to navigate.
 *
 * Response: RaceTrajectory · { state, signals, headline, falsifier }
 *
 * Auth: Bearer (cookie also accepted).
 * Tier 1 stable public.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { computeRaceTrajectory } from '@/lib/race-trajectory';

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });

  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  const result = await computeRaceTrajectory(user.id, new Date());
  return NextResponse.json({ slug, ...result });
}
