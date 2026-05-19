/**
 * /api/fitness — returns the user's resolved fitness bundle.
 *
 * Single source of truth for every client island that needs to render
 * paces/zones tuned to the runner: the workout modal, training cells,
 * any future per-run cards. Hits resolveFitness(userId) and returns
 * the subset clients need.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { resolveFitness } from '@/lib/fitness-resolver';

export async function GET() {
  const user = await requireActiveUser();
  const today = new Date().toISOString().slice(0, 10);
  const fitness = await resolveFitness(user.id, today);
  return NextResponse.json({
    ok: true,
    paces: fitness.paces,
    racePaceBand: fitness.racePaceBand,
    activeRace: fitness.activeRace ? {
      name: fitness.activeRace.name,
      slug: fitness.activeRace.slug,
      date: fitness.activeRace.date,
      daysAway: fitness.activeRace.daysAway,
      distanceMi: fitness.activeRace.distanceMi,
      goalDisplay: fitness.activeRace.goalDisplay,
      goalFinishS: fitness.activeRace.goalFinishS,
      goalPaceSPerMi: fitness.activeRace.goalPaceSPerMi,
    } : null,
    vdot: { value: fitness.vdot.value, source: fitness.vdot.source },
    maxHr: { value: fitness.maxHr.value, source: fitness.maxHr.source },
    hrZones: fitness.hrZones,
  });
}
