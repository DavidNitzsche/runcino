/**
 * GET /api/races/feasibility — returns the race feasibility verdict
 * for the user's nearest upcoming race.
 *
 * Consumed by the Coach Reads card on /profile and the race plan
 * hero on /races/[slug]. No mutations.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { validateRaceFeasibility } from '@/lib/validate-race-feasibility';

export async function GET() {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const today = new Date().toISOString().slice(0, 10);
  const verdict = await validateRaceFeasibility(user.id, today);
  return NextResponse.json(verdict);
}
