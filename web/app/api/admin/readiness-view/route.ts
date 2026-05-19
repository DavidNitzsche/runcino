/**
 * GET /api/admin/readiness-view
 *
 * Diagnostic for C6 daily readiness score. Returns score + state +
 * recommendation + per-input scoring breakdown + missing inputs.
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { computeReadinessScore } from '@/lib/readiness-score';
import { resolveEffectiveMaxHr } from '@/lib/compute-max-hr';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const todayIso = new Date().toISOString().slice(0, 10);
  const maxHr = (await resolveEffectiveMaxHr(admin.id)).value ?? null;
  const userRows = await query<{ resting_hr: number | null }>(
    `SELECT resting_hr FROM users WHERE id = $1 LIMIT 1`,
    [admin.id],
  );
  const restingHr = userRows[0]?.resting_hr ?? null;

  const finding = await computeReadinessScore(admin.id, todayIso, maxHr, restingHr);
  return NextResponse.json({
    inputs: { todayIso, maxHr, restingHr },
    finding,
    summary: {
      hint: finding.score == null
        ? `Suppressed · ${finding.suppressReason ?? 'unknown'}`
        : `Score ${finding.score} · ${finding.state.toUpperCase()} · ${finding.recommendation}`,
    },
  });
}
