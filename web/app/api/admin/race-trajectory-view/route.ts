/**
 * GET /api/admin/race-trajectory-view
 *
 * Diagnostic for V3 race trajectory indicator. Returns the state,
 * per-signal direction, headline, and falsifier, same data the
 * /races A-race hero "Trajectory" tile renders.
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { computeRaceTrajectory } from '@/lib/race-trajectory';

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const trajectory = await computeRaceTrajectory(admin.id, new Date());
  return NextResponse.json({
    trajectory,
    summary: { hint: trajectory.headline },
  });
}
