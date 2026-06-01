/**
 * GET /api/streak
 *
 * Current consecutive-days-with-a-run streak for the signed-in runner,
 * plus the next milestone target so the StreakPill on Log / Today can
 * render "12 day streak" or "30 days · milestone" against the same
 * 7/14/30/100-day thresholds the notification system uses.
 *
 * The compute is the same shape as lib/notifications/streak-check.ts ·
 * if today doesn't have a run yet, the streak still counts from
 * yesterday's run (active streak, not broken-yet).
 *
 * Response:
 *   { ok: true, current: number, longestPrior: number, nextMilestone: number | null,
 *     daysToMilestone: number | null, isMilestoneToday: boolean }
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const MILESTONES = [7, 14, 30, 100] as const;

async function computeRunStreak(userId: string): Promise<number> {
  try {
    const r = await pool.query(
      `SELECT DISTINCT (data->>'date')::date AS d
         FROM runs
        WHERE user_uuid = $1
          AND data->>'date' IS NOT NULL
          AND (data->>'date')::date > now() - interval '200 days'
        ORDER BY d DESC`,
      [userId],
    );
    if (r.rows.length === 0) return 0;
    const dates = new Set(r.rows.map((row: any) => new Date(row.d).toISOString().slice(0, 10)));
    let cursor = new Date();
    const todayIso = cursor.toISOString().slice(0, 10);
    if (!dates.has(todayIso)) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    let count = 0;
    for (;;) {
      const iso = cursor.toISOString().slice(0, 10);
      if (!dates.has(iso)) break;
      count++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return count;
  } catch {
    return 0;
  }
}

async function longestPriorStreak(userId: string): Promise<number> {
  // Cheap approximation · the same forward-walk on all known dates,
  // remembering the longest gap-free run. Good enough for the "longest
  // ever" comparison the pill cares about.
  try {
    const r = await pool.query(
      `SELECT DISTINCT (data->>'date')::date AS d
         FROM runs
        WHERE user_uuid = $1
          AND data->>'date' IS NOT NULL
        ORDER BY d ASC`,
      [userId],
    );
    if (r.rows.length === 0) return 0;
    const dates = r.rows.map((row: any) => new Date(row.d).toISOString().slice(0, 10));
    let longest = 1;
    let cur = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + 'T12:00:00Z');
      const here = new Date(dates[i] + 'T12:00:00Z');
      const gap = Math.round((here.getTime() - prev.getTime()) / 86400000);
      if (gap === 1) cur++;
      else cur = 1;
      if (cur > longest) longest = cur;
    }
    return longest;
  } catch {
    return 0;
  }
}

function nextMilestoneAfter(current: number): number | null {
  for (const m of MILESTONES) if (m > current) return m;
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const [current, longestPrior] = await Promise.all([
    computeRunStreak(userId),
    longestPriorStreak(userId),
  ]);

  const isMilestoneToday = (MILESTONES as readonly number[]).includes(current);
  const nextMs = nextMilestoneAfter(current);

  return NextResponse.json({
    ok: true,
    current,
    longestPrior,
    nextMilestone: nextMs,
    daysToMilestone: nextMs == null ? null : nextMs - current,
    isMilestoneToday,
  });
}
