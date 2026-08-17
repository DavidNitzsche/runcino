/**
 * streak-check.ts — fire Category F streak milestones (7/14/30/100 days).
 *
 * Called from the run-ingest path after a successful workout lands.
 * Computes the current consecutive-days-with-a-run streak, fires a
 * milestone notification on the exact magic numbers.
 *
 * Source: docs/2026-05-28-notifications.html §F TRIGGER.
 *
 * Idempotency: the dedup key (`milestone:streak:{N}:{user_id}`) is unique
 * per N per user — the 30-day milestone only ever fires once.
 *
 * Rate-limit per deck §F: max ONE milestone per calendar week. We let the
 * dedup key handle the streak-vs-race-countdown split — they share a week
 * but have distinct dedup keys, so both could fire on the same Sunday. The
 * cron scheduler is the one that enforces the rate-limit when the per-week
 * race-countdown also lands; if both fire we accept the v1 minor double-up
 * (deferred to v1.1+).
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { addDaysToDayKey } from '@/lib/runtime/day-key';
import { enqueueNotification } from './enqueue';
import { renderStreakMilestone } from './templates';

const MILESTONES = [7, 14, 30, 100] as const;

export async function maybeFireStreakMilestone(userId: string): Promise<void> {
  const streak = await computeRunStreak(userId);
  if (!MILESTONES.includes(streak as any)) return;

  // Is this the runner's longest-ever streak? Compare against prior records.
  const longest = await longestPriorStreak(userId);
  const isLongestEver = streak > longest;

  const tpl = renderStreakMilestone({
    user_id: userId,
    streak_days: streak,
    is_longest_ever: isLongestEver,
  });
  await enqueueNotification(userId, tpl, new Date());
}

/**
 * Consecutive-days-with-a-run streak ending today (or yesterday, if no
 * run today yet). Reads strava_activities — same source the rest of the
 * app uses.
 */
async function computeRunStreak(userId: string): Promise<number> {
  try {
    // to_char keeps the calendar day a string end to end; node-pg parses a
    // pg `date` to LOCAL midnight and the key was read back off the UTC
    // instant.
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
    // Walk backwards from the RUNNER's today; stop at the first gap. On
    // server-UTC this fired the streak-at-risk push against the wrong day
    // for anyone not living in UTC.
    let cursor = await runnerToday(userId);
    // Allow "today might not have a run yet" — start from today, but if the
    // most recent run is yesterday, that still counts as the active streak.
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

/**
 * Longest streak that was sent before this one — used to set
 * `is_longest_ever` on the rendered template. Reads the notifications_log
 * for previously-sent streak milestones. If we've never fired one before,
 * returns 0.
 */
async function longestPriorStreak(userId: string): Promise<number> {
  try {
    const r = await pool.query(
      `SELECT payload->'data'->>'streak_days' AS days
         FROM notifications_log
        WHERE COALESCE(user_uuid, user_id) = $1 AND category = 'streak' AND delivered = true
        ORDER BY fired_at DESC
        LIMIT 50`,
      [userId],
    );
    let max = 0;
    for (const row of r.rows) {
      const n = Number(row.days);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  } catch {
    return 0;
  }
}
