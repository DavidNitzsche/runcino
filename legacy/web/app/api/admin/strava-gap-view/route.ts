/**
 * GET /api/admin/strava-gap-view
 *
 * Diagnostic for the E1 + E4 activity-gap state machine. Shows
 * days since last run, the state the card would render, any active
 * mark, and whether L7 signals are suspended.
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { computeStravaGap } from '@/lib/strava-gap';

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const todayIso = new Date().toISOString().slice(0, 10);
  const finding = await computeStravaGap(admin.id, todayIso);
  return NextResponse.json({
    inputs: { todayIso },
    finding,
    summary: {
      hint: finding.state === 'silent'
        ? `Silent · ${finding.daysSinceLastRun ?? '?'} days since last run (state machine inactive within first 3 days OR planned break active).`
        : `${finding.state} fires · ${finding.daysSinceLastRun} days since last run${finding.signalsSuspended ? ' · L7 signals + V5 suspended' : ''}.`,
    },
  });
}
