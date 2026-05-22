/**
 * GET /api/admin/z2-sparkline-view
 *
 * Diagnostic for the C2 Z2 pace sparkline. Returns the 8-week
 * weighted-mean Z2 pace data the Coach Reads sparkline renders.
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { computeZ2Sparkline } from '@/lib/z2-sparkline';
import { resolveEffectiveMaxHr } from '@/lib/compute-max-hr';
import { query } from '@/lib/db';

function fmtPace(s: number | null): string {
  if (s == null || s <= 0) return ', ';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}/mi`;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const maxHrResolved = await resolveEffectiveMaxHr(admin.id);
  const maxHr = maxHrResolved.value ?? null;
  const userRows = await query<{ resting_hr: number | null }>(
    `SELECT resting_hr FROM users WHERE id = $1 LIMIT 1`,
    [admin.id],
  );
  const restingHr = userRows[0]?.resting_hr ?? null;

  const result = await computeZ2Sparkline(admin.id, new Date(), maxHr, restingHr);

  return NextResponse.json({
    inputs: { maxHr, restingHr },
    z2Band: result.z2Band,
    paceRange: result.paceRange ? {
      min: fmtPace(result.paceRange.min),
      max: fmtPace(result.paceRange.max),
    } : null,
    hasSignal: result.hasSignal,
    points: result.points.map((p) => ({
      weekStart: p.weekStartIso,
      pace: fmtPace(p.paceSPerMi),
      paceSPerMi: p.paceSPerMi,
      z2Miles: p.z2Miles,
      workoutCount: p.workoutCount,
    })),
  });
}
