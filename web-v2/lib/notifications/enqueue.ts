/**
 * enqueue.ts — event-bus writers' entry point.
 *
 * Used by code paths that fire on a state change rather than a wall-clock
 * cron tick:
 *   - skip recovery: enqueue on day_actions row insert (POST /api/today/skip)
 *   - niggle/sick first-day check: enqueue on niggles / sick_episodes insert
 *   - streak milestone: enqueue inside the run-ingest path
 *   - strava reconnect: enqueue when push.ts hits the 3rd consecutive 401
 *
 * The cron at /api/cron/notifications drains the resulting pending rows.
 *
 * Idempotency: enqueueNotification gates on the dedup_key — if the same
 * key already has an UNPROCESSED pending row OR a successfully-sent log
 * row within 24h, the enqueue is a no-op. So a writer can call it from
 * a hot path without worrying about duplicate sends if the same event
 * fires twice.
 */

import { pool } from '@/lib/db/pool';
import type { RenderedTemplate } from './templates';

export interface EnqueueResult {
  enqueued: boolean;
  reason?: 'already_pending' | 'already_sent' | 'error';
  pending_id?: number;
}

export async function enqueueNotification(
  userId: string,
  tpl: RenderedTemplate,
  fireAt: Date = new Date(),
): Promise<EnqueueResult> {
  // Dedup: same key on either log (sent) or pending (queued) inside 24h.
  try {
    const dup = await pool.query(
      `SELECT 1
         FROM notifications_log
        WHERE dedup_key = $1
          AND fired_at > now() - interval '24 hours'
          AND delivered = true
       UNION ALL
       SELECT 1
         FROM notifications_pending
        WHERE dedup_key = $1
          AND created_at > now() - interval '24 hours'
          AND processed_at IS NULL
       LIMIT 1`,
      [tpl.dedup_key],
    );
    if (dup.rows.length > 0) {
      return { enqueued: false, reason: 'already_pending' };
    }

    const ins = await pool.query(
      `INSERT INTO notifications_pending (user_id, category, fire_at, payload, dedup_key)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [userId, tpl.category, fireAt.toISOString(), JSON.stringify(tpl), tpl.dedup_key],
    );
    return { enqueued: true, pending_id: Number(ins.rows[0].id) };
  } catch (err: any) {
    console.error('[enqueue] failed:', err?.message ?? err);
    return { enqueued: false, reason: 'error' };
  }
}

/** Convenience for "fire at next morning 7:15 local of `now`". Used by
 *  skip recovery (deck §C TRIGGER). Single-tz beta uses server-local. */
export function nextMorning0715(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setHours(7, 15, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}
