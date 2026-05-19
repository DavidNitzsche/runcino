/**
 * GET /api/races/[slug]/projection
 *
 * Tier-2-to-tier-1 lift · C9 race result projection chart data.
 * Returns two trajectories (maintain at current VDOT, plan trending
 * toward goal) over weeks-to-race · iPhone bridge renders these as
 * a chart on its race-detail screen.
 *
 * Response: RaceProjection · { weeksToRace, currentVdot, goalVdot,
 *   goalFinishS, distanceMi, points, hasMeaningfulPlanTrajectory }
 *
 * 404 when the race isn't found · 400 when the race lacks goal time
 * (projection needs a finish-time target).
 *
 * Auth: Bearer (cookie also accepted).
 * Tier 1 stable public.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getRaceDB } from '@/lib/race-store';
import { computeRaceProjection } from '@/lib/race-projection';
import { resolveFitness } from '@/lib/fitness-resolver';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

function parseGoalSeconds(goalDisplay: string | null | undefined): number {
  if (!goalDisplay) return 0;
  const hhmmss = goalDisplay.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hhmmss) return Number(hhmmss[1]) * 3600 + Number(hhmmss[2]) * 60 + Number(hhmmss[3]);
  const mmss = goalDisplay.match(/^(\d{1,2}):(\d{2})$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  return 0;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.status !== 'active') return NextResponse.json({ error: 'Account not active', status: user.status }, { status: 403 });

  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  const race = await getRaceDB(slug, user.id);
  if (!race) return NextResponse.json({ error: 'Race not found', slug }, { status: 404 });

  const goalFinishS = parseGoalSeconds(race.meta.goalDisplay);
  if (goalFinishS <= 0) {
    return NextResponse.json({
      error: 'Race has no parseable goal time',
      goalDisplay: race.meta.goalDisplay,
    }, { status: 400 });
  }

  const today = todayISO(userTimezone(user.location));
  const fitness = await resolveFitness(user.id, today);

  const todayMs = Date.parse(today + 'T12:00:00Z');
  const raceMs = Date.parse(race.meta.date + 'T12:00:00Z');
  const weeksToRace = Math.max(1, Math.ceil((raceMs - todayMs) / (7 * 86_400_000)));

  const result = computeRaceProjection(
    fitness.vdot.value,
    race.meta.distanceMi,
    goalFinishS,
    weeksToRace,
  );
  return NextResponse.json({ slug, raceName: race.meta.name, ...result });
}
