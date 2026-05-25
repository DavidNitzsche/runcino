/**
 * GET /api/admin/post-race-view
 *
 * Diagnostic for E2 post-race awareness. Shows which race (if any)
 * is within the recovery window and what stage / guidance the user
 * would see today.
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { computePostRaceFinding } from '@/lib/post-race-awareness';

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const todayIso = new Date().toISOString().slice(0, 10);
  const finding = await computePostRaceFinding(admin.id, todayIso);
  return NextResponse.json({
    inputs: { todayIso },
    finding,
    summary: {
      hint: finding.shouldRender && finding.race
        ? `E2 fires · ${finding.race.name} (${finding.race.daysAgo}d ago) · stage=${finding.stage}`
        : 'E2 suppressed · no race within recovery window of today.',
    },
  });
}
