/**
 * GET /api/admin/vdot-shift-view
 *
 * Diagnostic for the ongoing-large-shift guard. Shows current
 * aggregate VDOT, last-reviewed baseline, shift in points + direction,
 * whether the surface would fire, and the suppress reason if not.
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { computeVdotShiftFinding } from '@/lib/vdot-shift';
import { computeAggregateVdot } from '@/lib/compute-vdot';

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const todayIso = new Date().toISOString().slice(0, 10);
  const agg = await computeAggregateVdot(admin.id);
  const currentVdot = agg?.value ?? null;
  const finding = await computeVdotShiftFinding(admin.id, currentVdot, todayIso);

  return NextResponse.json({
    inputs: { todayIso, currentVdot },
    finding,
    summary: {
      hint: finding.shouldRender
        ? `Shift guard FIRES · VDOT moved ${finding.shiftPoints} pts (${finding.direction}) since last review.`
        : finding.suppressReason === 'no-baseline'
          ? 'Suppressed · no baseline yet (next /profile load will set one).'
          : finding.suppressReason === 'within-threshold'
            ? `Within ±2.0 pt threshold · shift ${finding.shiftPoints} pts.`
            : finding.suppressReason === 'dismissed'
              ? 'Suppressed · user dismissed (30-day suppress active).'
              : finding.suppressReason === 'snoozed'
                ? 'Suppressed · user clicked Investigate (24-hour snooze active).'
                : finding.suppressReason === 'race-week'
                  ? 'Suppressed · within 7 days of a race.'
                  : 'Suppressed · unknown reason.',
    },
  });
}
