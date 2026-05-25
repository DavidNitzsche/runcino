/**
 * GET /api/admin/l7-signal4-view
 *
 * Diagnostic for L7 Signal 4 (PR trajectory). Returns PRs in window,
 * distinct distances, fire state, suspension status.
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { computeSignal4 } from '@/lib/adaptive-vdot-signal4';

function fmtTime(s: number): string {
  if (!s || s <= 0) return ', ';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const result = await computeSignal4(admin.id, new Date());
  return NextResponse.json({
    lookbackDays: result.lookbackDays,
    prCount: result.prsInWindow.length,
    distinctDistances: result.distinctDistances,
    firesUp: result.firesUp,
    softPositive: result.softPositive,
    suspended: result.suspended,
    prs: result.prsInWindow.map((p) => ({
      date: p.date,
      canonicalLabel: p.canonicalLabel,
      distanceMi: p.distanceMi,
      name: p.name,
      finish: fmtTime(p.finishS),
      finishS: p.finishS,
    })),
    summary: {
      hint: result.suspended
        ? 'Suspended (injury mark active).'
        : result.firesUp
          ? `Signal 4 FIRES UP · ${result.prsInWindow.length} fresh PRs across ${result.distinctDistances} distance(s) in last 8 weeks.`
          : result.softPositive
            ? `Soft positive · ${result.prsInWindow.length} PRs (below 3-PR strong threshold).`
            : `No PRs in last 8 weeks (need 2+ for soft, 3+ for strong).`,
    },
  });
}
