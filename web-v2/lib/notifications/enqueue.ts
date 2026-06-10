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
import { runnerTimezone } from '@/lib/runtime/runner-tz';
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
  // A fireAt produced by nextMorning0715 WITHOUT an explicit tz was
  // computed on the server clock (UTC on Railway → 07:15 UTC = 00:15 PT,
  // the wrong morning slot). The call sites don't know the runner's tz
  // but this function knows the runner — recompute 07:15 in their
  // profile.timezone here, same resolution the cron scheduler uses.
  if (needsUserTzRecompute.has(fireAt)) {
    try {
      const tz = await runnerTimezone(userId);
      fireAt = morning0715InTz(new Date(), tz);
    } catch { /* keep the server-clock fallback rather than failing the enqueue */ }
  }

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
      `INSERT INTO notifications_pending (user_id, user_uuid, category, fire_at, payload, dedup_key)
       VALUES ($1, $1, $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [userId, tpl.category, fireAt.toISOString(), JSON.stringify(tpl), tpl.dedup_key],
    );
    return { enqueued: true, pending_id: Number(ins.rows[0].id) };
  } catch (err: any) {
    console.error('[enqueue] failed:', err?.message ?? err);
    return { enqueued: false, reason: 'error' };
  }
}

/** Dates returned by nextMorning0715 without an explicit tz carry this
 *  marker so enqueueNotification (which knows the user) can recompute
 *  them in the runner's timezone before the row lands. WeakSet — no
 *  mutation of the Date, nothing leaks. */
const needsUserTzRecompute = new WeakSet<Date>();

/** Next 07:15 wall-clock in the given IANA tz, as a UTC instant. Reads
 *  the current wall-clock in tz via Intl (same pattern as the cron
 *  route's userLocalClock) and adds the minutes until the next 07:15. */
function morning0715InTz(now: Date, tz: string): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? '0') || 0;
  const nowMin = (get('hour') % 24) * 60 + get('minute');
  const target = 7 * 60 + 15;
  const deltaMin = nowMin < target ? target - nowMin : 24 * 60 - nowMin + target;
  const fireAt = new Date(now.getTime() + deltaMin * 60 * 1000);
  fireAt.setUTCSeconds(0, 0);
  return fireAt;
}

/** Convenience for "fire at next morning 7:15 local of `now`". Used by
 *  skip recovery (deck §C TRIGGER) + niggle/sick first-day checks.
 *
 *  Pass an IANA tz to get the runner-local 07:15 directly. Without one
 *  (the existing call sites pass only `now`) the returned Date is
 *  server-clock 07:15 BUT carries a marker that makes
 *  enqueueNotification recompute it in the runner's profile.timezone —
 *  on UTC Railway the unmarked value would be 00:15 PT. */
export function nextMorning0715(now: Date = new Date(), tz?: string): Date {
  if (tz) return morning0715InTz(now, tz);
  const next = new Date(now);
  next.setHours(7, 15, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  needsUserTzRecompute.add(next);
  return next;
}

/** 2026-06-09 Phase 2 (3.4) · "today at HH:MM in the RUNNER'S timezone"
 *  as an absolute Date. Unlike nextMorning0715 (server-local), this is
 *  tz-correct: builds the wall-clock instant in `tz` via the
 *  formatToParts offset trick (same approach as lib/runs/identity.ts).
 *  If that instant already passed, returns it anyway — the dispatcher
 *  fires past-due rows on its next pass, which for a 21:00 bedtime
 *  nudge enqueued by the 01:15 cron is never the case. */
export function todayAtHourLocal(tz: string, hour: number, minute = 0, now: Date = new Date()): Date {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [y, m, d] = dtf.format(now).split('-').map((x) => parseInt(x, 10));
  // First guess: treat the target wall-clock as UTC, then correct by the
  // zone's offset at that instant.
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const offsetProbe = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of offsetProbe.formatToParts(new Date(guess))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess - (asUtc - guess));
}
