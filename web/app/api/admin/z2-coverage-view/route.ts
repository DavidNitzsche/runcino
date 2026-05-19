/**
 * GET /api/admin/z2-coverage-view
 *
 * Diagnostic for the V5 Z2 stimulus check surface. Shows whether the
 * surface would fire, the suppress reason if not, and all the
 * computed stats (last 7d / last 28d Z2 share, threshold under-reach).
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { computeZ2CoverageFinding } from '@/lib/z2-coverage';
import { resolveEffectiveMaxHr } from '@/lib/compute-max-hr';
import { computeAggregateVdot } from '@/lib/compute-vdot';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const todayIso = new Date().toISOString().slice(0, 10);

  const maxHrResolved = await resolveEffectiveMaxHr(admin.id);
  const maxHr = maxHrResolved.value ?? null;
  const userRows = await query<{ resting_hr: number | null }>(
    `SELECT resting_hr FROM users WHERE id = $1 LIMIT 1`,
    [admin.id],
  );
  const restingHr = userRows[0]?.resting_hr ?? null;
  const aggVdot = await computeAggregateVdot(admin.id);
  const vdot = aggVdot?.value ?? 45;

  const finding = await computeZ2CoverageFinding(admin.id, todayIso, maxHr, restingHr, vdot);

  return NextResponse.json({
    inputs: { todayIso, maxHr, restingHr, vdot },
    finding,
    summary: {
      hint: finding.shouldRender
        ? `Z2 stimulus check FIRES · last 7d ${finding.last7d.z2SharePct}% Z2 share across ${finding.last7d.easyRunCount} easy runs (below 40% threshold).`
        : finding.suppressReason === 'no-hrr-framework'
          ? 'Suppressed · HRR framework not active (max HR or resting HR missing).'
          : finding.suppressReason === 'race-week'
            ? 'Suppressed · race-week (within 7 days of a race).'
            : finding.suppressReason === 'too-few-runs'
              ? `Suppressed · need ${3}+ easy runs in last 7 days, have ${finding.last7d.easyRunCount}.`
              : finding.suppressReason === 'z2-share-ok'
                ? `Z2 share OK · ${finding.last7d.z2SharePct}% in last 7d (above 40% threshold).`
                : `Suppressed · ${finding.suppressReason}.`,
    },
  });
}
