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
import { runnerToday } from '@/lib/runtime/runner-tz';
import { addDaysToDayKey } from '@/lib/runtime/day-key';

export const dynamic = 'force-dynamic';

const MILESTONES = [7, 14, 30, 100] as const;

async function computeRunStreak(userId: string): Promise<number> {
  try {
    // to_char, not ::date · node-pg parses a pg `date` into a JS Date at
    // LOCAL midnight, and the day key was then read back off the UTC
    // instant. A string out of Postgres is already the calendar day and
    // needs no parsing at all (see project memory: node-pg timestamp TZ
    // trap).
    const r = await pool.query<{ d: string }>(
      `SELECT DISTINCT to_char((data->>'date')::date, 'YYYY-MM-DD') AS d
         FROM runs
        WHERE user_uuid = $1
          AND data->>'date' IS NOT NULL
          AND (data->>'date')::date > now() - interval '200 days'
        ORDER BY d DESC`,
      [userId],
    );
    if (r.rows.length === 0) return 0;
    const dates = new Set(r.rows.map((row) => row.d));
    // The streak walks the RUNNER's calendar. On server-UTC "today" a
    // Pacific runner's streak broke or extended seven hours early every
    // evening — the pill would read one day short from 5pm until midnight.
    let cursor = await runnerToday(userId);
    if (!dates.has(cursor)) {
      cursor = addDaysToDayKey(cursor, -1);
    }
    let count = 0;
    for (;;) {
      if (!dates.has(cursor)) break;
      count++;
      cursor = addDaysToDayKey(cursor, -1);
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
    const r = await pool.query<{ d: string }>(
      `SELECT DISTINCT to_char((data->>'date')::date, 'YYYY-MM-DD') AS d
         FROM runs
        WHERE user_uuid = $1
          AND data->>'date' IS NOT NULL
        ORDER BY d ASC`,
      [userId],
    );
    if (r.rows.length === 0) return 0;
    const dates = r.rows.map((row) => row.d);
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
