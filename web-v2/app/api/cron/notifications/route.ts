/**
 * GET  /api/cron/notifications   — health probe (no auth)
 * POST /api/cron/notifications   — drain + schedule (Bearer CRON_SECRET)
 *
 * Hybrid scheduler entry point (deck §5). The POST handler is ticked by
 * .github/workflows/notifications.yml (every 30 min waking hours, every
 * 15 min in the 11:00-13:59 UTC race-day wake band) and does TWO things:
 *
 *   1. DRAIN THE QUEUE
 *      For every notifications_pending row where fire_at <= now() AND
 *      processed_at IS NULL, render the payload back into a template
 *      and dispatch it. The row's payload was pre-rendered at enqueue
 *      time so we don't re-resolve state at fire — what the enqueuer
 *      decided was the message IS the message.
 *
 *      Rows are consumed (processed_at set) ONLY on terminal outcomes:
 *      delivered, pref-skip, dedup-skip, permanent APNs rejection
 *      (400 BadDeviceToken / 403 / 410). Retryable outcomes (network,
 *      timeout, 429, 5xx, no tokens, APNs unconfigured) leave the row
 *      pending and count attempts in payload._attempts — give-up marker
 *      after 8. Quiet-hours skips also leave the row pending but do NOT
 *      count an attempt; the row delivers at the first tick outside
 *      quiet hours (M-21).
 *
 *   2. SCHEDULE TIME-BASED CATEGORIES
 *      For every active user, evaluate B (race eve T-21:00), D (Sunday
 *      20:00 weekly check-in), F race-countdown thresholds, and H
 *      ("yesterday is unread", 08:00 local). Enqueue rows when due.
 *      Idempotent — the pending dedup_key prevents duplicate rows landing
 *      for the same key within 24h, and H carries its own once-ever and
 *      seven-day gates on top, because "fires once" is not "once a day".
 *
 * Event-based categories (C skip recovery, E niggle/sick daily, F streak,
 * G strava reconnect) are enqueued at their originating writes — the cron
 * just drains them when fire_at lands.
 *
 * Source spec: docs/2026-05-28-notifications.html §5 (hybrid scheduler).
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { apnsHost } from '@/lib/notifications/apns';
import { raiseAlert } from '@/lib/ops/alerts';
import { dispatchNotification } from '@/lib/notifications/dispatch';
import {
  renderRaceEve,
  renderWeeklyCheckin,
  renderRaceCountdown,
  renderNiggleCheck,
  renderSickCheck,
  renderRaceDay,
  renderSkipRecovery,
  renderStravaReconnect,
  renderStreakMilestone,
  renderRunUnread,
  type RenderedTemplate,
} from '@/lib/notifications/templates';
// 0821 watch handoff § 9 · B8 · "yesterday is unread". The read side of the
// ask-then-ignore loop already knows what the runner did and did not tell us
// about yesterday; this schedules off it rather than re-deriving it.
import {
  loadYesterdaySignals, hasSubjectiveSignal, categorizeWorkoutType,
} from '@/lib/coach/acknowledge';
import { loadNotificationPrefs, categoryEnabled } from '@/lib/notifications/prefs';
import { loadSettings } from '@/lib/coach/settings';
import { mileageByDay } from '@/lib/runs/volume';
import { trainingWeekWindow } from '@/lib/notifications/week-window';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ──────────────────────────────────────────────────────────────
// GET — public health probe (no secret needed)
// ──────────────────────────────────────────────────────────────

export async function GET() {
  let pendingCount = 0;
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications_pending WHERE processed_at IS NULL`,
    );
    pendingCount = r.rows[0]?.n ?? 0;
  } catch { /* table not present → 0 */ }
  // RK-0/RK-6 observability: 24h delivery counts + unacked notification
  // alerts. Best-effort — a missing table reads as 0, never fails the probe.
  let delivered24h = 0;
  let failed24h = 0;
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE delivered = true)::int  AS delivered,
         COUNT(*) FILTER (WHERE delivered = false)::int AS failed
       FROM notifications_log
      WHERE fired_at > now() - interval '24 hours'`,
    );
    delivered24h = r.rows[0]?.delivered ?? 0;
    failed24h = r.rows[0]?.failed ?? 0;
  } catch { /* table not present → 0 */ }
  let unackedAlerts = 0;
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ops_alerts
        WHERE acked_at IS NULL
          AND kind IN ('apns_send_failed', 'notifications_cron_error')`,
    );
    unackedAlerts = r.rows[0]?.n ?? 0;
  } catch { /* table not present → 0 */ }
  return NextResponse.json({
    endpoint: 'POST /api/cron/notifications',
    pending: pendingCount,
    secret_configured: Boolean(process.env.CRON_SECRET),
    apns_configured: Boolean(
      process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      (process.env.APNS_KEY_PEM || process.env.APNS_KEY_PATH),
    ),
    // RK-6: the host sendPush WOULD hit. TestFlight + App Store builds
    // both register PRODUCTION tokens — if apns_production reads false
    // while testing a TestFlight build, every send 400s BadDeviceToken.
    apns_host: apnsHost(),
    apns_production: process.env.APNS_PRODUCTION === '1',
    delivered_24h: delivered24h,
    failed_24h: failed24h,
    unacked_alerts: unackedAlerts,
  });
}

// ──────────────────────────────────────────────────────────────
// POST — drain + schedule
// ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({
      ok: false,
      note: 'CRON_SECRET not configured. Set it in Railway env to enable the cron.',
    }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const stats = {
    drained: 0,
    dispatched: 0,
    skipped_pref: 0,
    skipped_dedup: 0,
    skipped_no_tokens: 0,
    skipped_apns_not_configured: 0,
    skipped_quiet: 0,
    skipped_stale: 0,
    retry_pending: 0,
    gave_up: 0,
    failed: 0,
    enqueued_b: 0,
    enqueued_d: 0,
    enqueued_e: 0,
    enqueued_f_race: 0,
    enqueued_h_unread: 0,
    errors: [] as string[],
  };

  // 1. Drain
  try {
    await drainPending(stats);
  } catch (err: any) {
    stats.errors.push(`drain: ${err?.message ?? err}`);
    await raiseAlertDeduped(
      'notifications_cron_error',
      `notifications cron drain crashed: ${err?.message ?? err}`,
      { phase: 'drain' },
    );
  }

  // 2. Schedule
  try {
    await scheduleTimeBased(stats);
  } catch (err: any) {
    stats.errors.push(`schedule: ${err?.message ?? err}`);
    await raiseAlertDeduped(
      'notifications_cron_error',
      `notifications cron schedule crashed: ${err?.message ?? err}`,
      { phase: 'schedule' },
    );
  }

  return NextResponse.json({ ok: true, ...stats });
}

// ──────────────────────────────────────────────────────────────
// 1. DRAIN — process notifications_pending rows that are due
// ──────────────────────────────────────────────────────────────

/** Max drain attempts before a retryable row is consumed with a give-up
 *  marker. At the 15-30 min tick cadence that is roughly 2-4 hours of
 *  retries — enough to ride out an APNs blip without replaying a stale
 *  notification forever. Counted in payload._attempts (jsonb, no schema
 *  change). */
const MAX_DRAIN_ATTEMPTS = 8;

/**
 * How long past its fire_at a queued notification is still worth sending.
 *
 * 2026-08-21 · watch/push audit. The drain had NO expiry: a row that could
 * not go out — quiet hours (which defer indefinitely and do not even count
 * an attempt), no device token, an APNs blip — was dispatched whenever it
 * finally could, however long after the moment it was written for. The sharp
 * case: race eve fires 21:00 local, and a runner whose quiet_hours_start is
 * 21:00 or earlier had that row held until quiet_hours_end — so "RACE
 * TOMORROW. Early to bed. Kit prepped?" landed at 06:00 on race morning.
 * Sleep banking (same category, same 21:00 slot) had the same hole.
 *
 * Hours are per-category because the cost of lateness is: a wake-up call
 * after the gun is worthless, a stale token nudge is merely late.
 */
const MAX_STALENESS_HOURS: Record<string, number> = {
  race_day: 6,          // a wake-up delivered after the race has started
  race_eve: 6,          // must never cross midnight into race morning
  skip_recovery: 12,    // "still feeling it?" only means today
  niggle_sick: 12,      // "how is it this morning?"
  weekly_checkin: 12,   // the week it summarises has to still be yesterday
  race_countdown: 24,   // week counts are coarse; a day late still reads true
  streak: 24,
  // "Yesterday is unread" is about YESTERDAY. Delivered the following
  // evening it is asking about the day before last, which is a different
  // sentence from the one that was written.
  run_unread: 8,
  strava_reconnect: 72, // not time-anchored — the token stays broken
};
const DEFAULT_STALENESS_HOURS = 24;

async function drainPending(stats: any): Promise<void> {
  const due = (await pool.query(
    // stale_hours is computed in SQL, not from a parsed timestamp: node-pg
    // mis-shifts tz-less timestamps, and this decides whether a runner gets
    // woken. Let Postgres do the subtraction.
    `SELECT id, user_id, category, payload,
            EXTRACT(EPOCH FROM (now() - fire_at)) / 3600.0 AS stale_hours
       FROM notifications_pending
      WHERE processed_at IS NULL AND fire_at <= now()
      ORDER BY fire_at ASC
      LIMIT 200`,
  )).rows as Array<{ id: number; user_id: string; category: string; payload: any; stale_hours: string | number }>;

  for (const row of due) {
    stats.drained++;
    try {
      // Expiry check BEFORE dispatch — a notification about a moment that
      // has passed is not a late notification, it is a wrong one.
      const staleHours = Number(row.stale_hours) || 0;
      const limit = MAX_STALENESS_HOURS[row.category] ?? DEFAULT_STALENESS_HOURS;
      if (staleHours > limit) {
        stats.skipped_stale++;
        await markProcessed(row.id, {
          outcome: 'expired',
          stale_hours: Math.round(staleHours * 10) / 10,
          limit_hours: limit,
        });
        continue;
      }
      // The pending row carries the fully-rendered template (we stored it
      // pre-rendered at enqueue time so what was decided IS what fires).
      // Bookkeeping keys the drain adds (_attempts, _last_error, _final,
      // _gave_up) ride alongside the template fields and are ignored by
      // the dispatcher.
      const tpl = row.payload as RenderedTemplate;
      const result = await dispatchNotification(row.user_id, tpl);

      // Quiet-hours defer (RK-5/M-21): NOT a failure. Leave the row
      // pending without counting an attempt — it delivers at the first
      // tick outside the runner's quiet hours.
      if (result.skipped === 'quiet_hours') {
        stats.skipped_quiet++;
        continue;
      }

      if (result.skipped === 'category_off' || result.skipped === 'master_off') {
        stats.skipped_pref++;
        await markProcessed(row.id);
      } else if (result.skipped === 'recently_sent') {
        stats.skipped_dedup++;
        await markProcessed(row.id);
      } else if (result.ok && result.sent_count != null && result.sent_count > 0) {
        stats.dispatched++;
        await markProcessed(row.id);
      } else if (result.skipped === 'no_tokens') {
        // Retryable — a race-morning push enqueued before the phone
        // registered should still land once the token arrives.
        stats.skipped_no_tokens++;
        await retryLater(row, 'no_tokens', stats);
      } else if (result.skipped === 'apns_not_configured') {
        // Retryable — env may land mid-day; the queue should survive it.
        stats.skipped_apns_not_configured++;
        await retryLater(row, 'apns_not_configured', stats);
      } else if (result.failed_count != null && result.failed_count > 0) {
        stats.failed++;
        const f = result.failure;
        const reason = f ? `${f.reason}${f.status != null ? ` ${f.status}` : ''}` : 'send_failed';
        await raiseAlertDeduped(
          'apns_send_failed',
          `APNs send failed (${row.category}): ${reason}`,
          { pending_id: row.id, category: row.category, reason, detail: f?.detail ?? null },
        );
        if (f?.permanent) {
          // Terminal APNs rejection (400 BadDeviceToken / 403 / 410) —
          // retrying cannot succeed. Consume the row and record why.
          await markProcessed(row.id, { outcome: 'apns_rejected_permanent', reason, detail: f.detail ?? null });
        } else {
          await retryLater(row, reason, stats);
        }
      } else {
        // Nothing sent, nothing failed, no skip — e.g. only non-iOS
        // tokens registered. Retry; the attempt cap terminates it.
        await retryLater(row, 'no_send_attempted', stats);
      }
    } catch (err: any) {
      stats.errors.push(`drain row ${row.id}: ${err?.message ?? err}`);
      await raiseAlertDeduped(
        'apns_send_failed',
        `Drain dispatch threw (${row.category}): ${err?.message ?? err}`,
        { pending_id: row.id, category: row.category },
      );
      await retryLater(row, `exception: ${err?.message ?? err}`, stats);
    }
  }
}

/** Terminal outcome — consume the pending row. Optional `final` lands in
 *  payload._final so a permanently-rejected row says why it was consumed. */
async function markProcessed(id: number, final?: Record<string, unknown>): Promise<void> {
  if (final) {
    await pool.query(
      `UPDATE notifications_pending
          SET processed_at = now(), payload = payload || $2::jsonb
        WHERE id = $1`,
      [id, JSON.stringify({ _final: final })],
    ).catch(() => {});
  } else {
    await pool.query(
      `UPDATE notifications_pending SET processed_at = now() WHERE id = $1`,
      [id],
    ).catch(() => {});
  }
}

/** Retryable outcome (M-21) — leave processed_at NULL so the next tick
 *  picks the row up again, and count the attempt inside the payload
 *  jsonb. After MAX_DRAIN_ATTEMPTS the row is consumed with a give-up
 *  marker so the queue can't replay a stale notification forever. */
async function retryLater(
  row: { id: number; payload: any },
  reason: string,
  stats: any,
): Promise<void> {
  const attempts = (Number(row.payload?._attempts) || 0) + 1;
  if (attempts >= MAX_DRAIN_ATTEMPTS) {
    stats.gave_up++;
    await pool.query(
      `UPDATE notifications_pending
          SET processed_at = now(), payload = payload || $2::jsonb
        WHERE id = $1`,
      [row.id, JSON.stringify({ _attempts: attempts, _gave_up: true, _last_error: reason })],
    ).catch(() => {});
  } else {
    stats.retry_pending++;
    await pool.query(
      `UPDATE notifications_pending
          SET payload = payload || $2::jsonb
        WHERE id = $1`,
      [row.id, JSON.stringify({ _attempts: attempts, _last_error: reason })],
    ).catch(() => {});
  }
}

/** RK-0 alerts MVP. raiseAlert with a 6h dedup: if an unacked ops_alerts
 *  row of the same kind landed in the last 6 hours, stay quiet — one
 *  alert per incident, not one per failed row per tick. Swallows its own
 *  errors; alerting must never break the drain. */
async function raiseAlertDeduped(
  kind: 'apns_send_failed' | 'notifications_cron_error',
  message: string,
  metadata?: Record<string, any>,
): Promise<void> {
  try {
    const recent = await pool.query(
      `SELECT 1 FROM ops_alerts
        WHERE kind = $1 AND acked_at IS NULL
          AND created_at > now() - interval '6 hours'
        LIMIT 1`,
      [kind],
    );
    if (recent.rows.length > 0) return;
    await raiseAlert({ kind, severity: 'error', message, metadata, source: 'cron/notifications' });
  } catch { /* never let alerting break the drain */ }
}

// ──────────────────────────────────────────────────────────────
// 2. SCHEDULE — emit time-based categories per-user
// ──────────────────────────────────────────────────────────────

interface ActiveUser {
  user_id: string;
  /** IANA timezone identifier · 'America/Los_Angeles' / 'Europe/London' /
   *  'UTC' fallback. Sourced from profile.timezone joined at listActiveUsers
   *  (2026-06-05 backend audit P0-10 · was hardcoded offset-min=0). */
  tz: string;
}

async function listActiveUsers(): Promise<ActiveUser[]> {
  // Per-user-TZ scheduling · 2026-06-05 backend audit P0-10 fix. Was:
  //   tz_offset_min: 0 hardcoded · race-day morning, race-eve 21:00,
  //   weekly check-in, daily niggle/sick all fired at SERVER UTC for
  //   every runner. A Pacific runner's race-eve fired at 14:00 PT
  //   (21:00 UTC) instead of 21:00 PT.
  // Now: join profile.timezone (IANA name like 'America/Los_Angeles');
  // pass it forward as the user's TZ key. All firing decisions go
  // through Intl-based userLocalClock() · honest to the wall-clock the
  // runner actually lives on. Cite docs/2026-06-05-backend-audit.html
  // § P0-10.
  try {
    const r = await pool.query(
      `SELECT DISTINCT dt.user_id, COALESCE(p.timezone, 'UTC') AS tz
         FROM device_tokens dt
         LEFT JOIN profile p ON p.user_uuid = dt.user_id
        WHERE dt.revoked_at IS NULL`,
    );
    return r.rows.map((r: any) => ({ user_id: r.user_id, tz: String(r.tz || 'UTC') }));
  } catch {
    return [];
  }
}

/**
 * Read the runner's local wall clock via Intl. Returns date as
 * YYYY-MM-DD, hour 0-23, minute 0-59, day-of-week (0=Sun…6=Sat). All
 * computed from a single `new Date()` so the four fields agree.
 *
 * 2026-06-05 · backend audit P0-10 · replaces the old offset-based
 * approach which was server-UTC at offset 0 · also collapsed the four
 * different `userNow.toISOString().slice(0,10)` sites in this file
 * (which all silently used UTC) into one helper.
 */
function userLocalClock(tz: string): {
  dateISO: string;
  hour: number;
  minute: number;
  dow: number;
} {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const DOW_MAP: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    dateISO: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) || 0,
    minute: Number(get('minute')) || 0,
    dow: DOW_MAP[get('weekday')] ?? 0,
  };
}

/** YYYY-MM-DD of (runner-local tomorrow) · used by race-eve enqueue. */
function userLocalTomorrow(tz: string): string {
  const tomorrowUtc = new Date(Date.now() + 24 * 3600 * 1000);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(tomorrowUtc);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The UTC instant of `HH:MM` wall-clock on a given runner-local calendar
 * date. Same offset-probe trick as lib/notifications/enqueue.ts's
 * todayAtHourLocal, generalised off "today" so the race-day wake can be
 * queued the evening before.
 */
function localInstant(tz: string, dateISO: string, hour: number, minute: number): Date {
  const [y, m, d] = dateISO.split('-').map((x) => parseInt(x, 10));
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const probe = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of probe.formatToParts(new Date(guess))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess - (asUtc - guess));
}

/** Returns true iff the user-local clock is inside the fire window
 *  [HH:MM, HH:MM + slackMin).
 *
 *  2026-08-21 · watch/push audit · every caller now passes a window measured
 *  in HOURS, not the old 30 minutes. Prod evidence: the GitHub Actions cron
 *  does not deliver the ticks it declares. On 2026-08-16 (AFC race day) it
 *  ticked at ~04:05 UTC and then not again until ~15:51 — an 11h45m gap that
 *  swallowed the whole 13:00-13:30 UTC race-day-wake window. Every other
 *  category survived because its row, once enqueued, waits in the queue; the
 *  scheduler-side categories died outright, and `race_day` has NEVER enqueued
 *  a single row in the lifetime of the table, AFC morning included.
 *
 *  A 30-minute window on an unreliable ticker is a coin flip. Widening the
 *  catchment costs nothing — enqueueIfFresh gates on the dedup key, so ten
 *  ticks inside one window still produce one row — and the drain's
 *  MAX_STALENESS_HOURS is what keeps a late row from arriving wrong. */
function isAtLocalTime(hour: number, minute: number, hm: string, slackMin = 30): boolean {
  const [h, m] = hm.split(':').map(Number);
  const userMin = hour * 60 + minute;
  const targetMin = h * 60 + m;
  const delta = userMin - targetMin;
  // 30-min window (RK-5/F6, two audits converged here). Slack was 15 min
  // against a workflow that polls every 30 ("cron polls every 15" was
  // stale): any target off the tick grid straddle-missed (wake 06:10 →
  // ticks 06:00 delta -10 and 06:30 delta 20 both missed → never fired),
  // and GitHub Actions habitually fires 5-20 min late on top. F6 took 25;
  // 30 closes the residual :01-:04 holes a 25-min window leaves on a
  // 30-min grid. The */15 race-day wake band survives one dropped tick.
  // Two ticks landing inside the same window cannot double-send:
  // enqueueIfFresh blocks on the unprocessed pending row (24h) and on
  // the delivered notifications_log row (24h).
  return delta >= 0 && delta < slackMin;
}

/**
 * Idempotent enqueue. The pending dedup index prevents duplicate rows
 * for the same dedup_key within the prior 24h.
 */
async function enqueueIfFresh(
  userId: string,
  tpl: RenderedTemplate,
  fireAt: Date,
): Promise<boolean> {
  // Recently-sent on log AND recently-pending on queue both gate enqueue.
  const dup = await pool.query(
    `SELECT 1 FROM notifications_log
       WHERE dedup_key = $1
         AND fired_at > now() - interval '24 hours'
         AND delivered = true
      UNION ALL
     SELECT 1 FROM notifications_pending
       WHERE dedup_key = $1
         AND created_at > now() - interval '24 hours'
         AND processed_at IS NULL
      LIMIT 1`,
    [tpl.dedup_key],
  ).catch(() => ({ rows: [] }));
  if (dup.rows.length > 0) return false;

  await pool.query(
    `INSERT INTO notifications_pending (user_id, user_uuid, category, fire_at, payload, dedup_key)
     VALUES ($1, $1, $2, $3, $4::jsonb, $5)`,
    [userId, tpl.category, fireAt.toISOString(), JSON.stringify(tpl), tpl.dedup_key],
  );
  return true;
}

async function scheduleTimeBased(stats: any): Promise<void> {
  const users = await listActiveUsers();
  for (const u of users) {
    const prefs = await loadNotificationPrefs(u.user_id);
    if (!prefs.master_enabled) continue;
    // 2026-06-05 · backend audit P0-10 fix · userLocalClock reads
    // wall-clock in the runner's TZ via Intl. Replaces the prior
    // nowInUserTz(0) + toISOString().slice(0,10) chain, which was
    // server-UTC for every runner. Today's ISO date is now the
    // runner's calendar date, not the server's.
    const clk = userLocalClock(u.tz);
    const dow = clk.dow;

    // ──────────────────────────────────────────────────────────
    // CATEGORY A — race day morning
    //   Fire on race-day, at prefs.race_day_wake_time (default 05:30)
    //   Bypasses quiet hours unconditionally (deck §A QUIET HRS).
    // ──────────────────────────────────────────────────────────
    //
    //   2026-08-21 · watch/push audit · REWRITTEN. This used to require a
    //   cron tick to land inside the 30 minutes after the wake time, and
    //   then enqueue with fire_at = now. On a ticker that skips 11 hours at
    //   a stretch that is a lottery, and the table says it never once won:
    //   zero race_day rows have ever been enqueued, including the morning
    //   of AFC. Now the row is queued with fire_at = the wake INSTANT, and
    //   it is queued for tomorrow's race as well as today's — so one tick
    //   anywhere in the ~24h beforehand is enough, and the queue does the
    //   waiting. Idempotent on `race-day:{race_id}`.
    if (prefs.race_day_enabled) {
      const [wakeH, wakeM] = prefs.race_day_wake_time.split(':').map(Number);
      for (const dayISO of [clk.dateISO, userLocalTomorrow(u.tz)]) {
        const race = await raceOnDate(u.user_id, dayISO);
        if (!race) continue;
        const fireAt = localInstant(u.tz, dayISO, wakeH || 0, wakeM || 0);
        // A wake-up whose moment is already well past is not worth queuing;
        // the drain would expire it anyway (MAX_STALENESS_HOURS.race_day).
        if (fireAt.getTime() < Date.now() - MAX_STALENESS_HOURS.race_day * 3600_000) continue;
        const tpl = renderRaceDay({
          race_id: race.slug,
          race_slug: race.slug,
          race_name: race.name ?? race.slug,
          // No invented gun time / distance. Every race row in prod carries
          // NEITHER meta.gun_time NOR meta.start_time, so the old
          // `?? '07:00'` and `?? '13.1'` defaults meant this push would have
          // told the runner their marathon went off at 7:00 over 13.1 miles.
          // The template drops what it does not know.
          gun_time_local: race.gun_time_local,
          uber_pickup_local: race.uber_pickup_local ?? null,
          distance: race.distance_label,
        });
        if (await enqueueIfFresh(u.user_id, tpl, fireAt)) {
          stats.enqueued_b++; // counted under B/A bucket
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // CATEGORY B — race eve at 21:00 if a race is in next 24h
    // ──────────────────────────────────────────────────────────
    //
    //   2026-08-21 · the shake-out read is only honest once the day is
    //   mostly done, so this still waits until the afternoon — but it now
    //   accepts any tick from 15:00 local onward and pins fire_at to 21:00,
    //   instead of needing a tick inside 21:00-21:30.
    if (prefs.race_eve_enabled && isAtLocalTime(clk.hour, clk.minute, '15:00', 8 * 60)) {
      const tomorrow = userLocalTomorrow(u.tz);
      const race = await raceOnDate(u.user_id, tomorrow);
      if (race) {
        const tpl = renderRaceEve({
          race_id: race.slug,
          race_slug: race.slug,
          shakeout_done: await shakeoutDoneToday(u.user_id),
        });
        const fireAt = localInstant(u.tz, clk.dateISO, 21, 0);
        if (await enqueueIfFresh(u.user_id, tpl, fireAt)) {
          stats.enqueued_b++;
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // CATEGORY D — weekly check-in on the runner's LAST training day
    //   (long_run_day) at prefs.weekly_checkin_time.
    //
    //   2026-07-06 · audit P1-24 + week-boundary P2 · was hardcoded
    //   Sunday (dow === 0) with an ISO-Monday summary window. The
    //   training week ENDS on user_settings.long_run_day (one SoT with
    //   /api/plan/week, locked 2026-06-16) — a Saturday-long runner's
    //   Sunday check-in totalled a window that split their week in two.
    //   Now: fire on long_run_day evening, sum the week that ends that
    //   day. David (long_run_day=sun) is byte-identical: still Sunday.
    // ──────────────────────────────────────────────────────────
    //
    //   2026-08-21 · window widened from 30 min to 4 h (checkin_time →
    //   +4h, still the same local evening). The summary is computed HERE,
    //   at enqueue, so this must stay after the check-in hour — a summary
    //   built at 06:00 would not contain the long run it is summarising.
    if (
      prefs.weekly_checkin_enabled &&
      isAtLocalTime(clk.hour, clk.minute, prefs.weekly_checkin_time, 4 * 60)
    ) {
      const settings = await loadSettings(u.user_id);
      const DOW_OF: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      const longRunDow = DOW_OF[settings.long_run_day] ?? 0;
      const summary = dow === longRunDow
        ? await weekSummary(u.user_id, clk.dateISO, dow, longRunDow)
        : null;
      if (summary && summary.days_run > 0) {
        const tpl = renderWeeklyCheckin({
          user_id: u.user_id,
          week_start_iso: summary.week_start_iso,
          actual_mi: summary.actual_mi,
          planned_mi: summary.planned_mi,
          days_run: summary.days_run,
          days_total: summary.days_planned,
        });
        if (await enqueueIfFresh(u.user_id, tpl, new Date())) {
          stats.enqueued_d++;
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // CATEGORY E — daily niggle/sick check at 07:15 local
    // ──────────────────────────────────────────────────────────
    //
    //   2026-08-21 · window widened 30 min → 4h45m, stopping at noon: the
    //   body asks "how is it this morning?", so it must not enqueue into
    //   the afternoon.
    if (prefs.niggle_sick_enabled && isAtLocalTime(clk.hour, clk.minute, '07:15', 285)) {
      const today = clk.dateISO;
      const niggle = await activeNiggle(u.user_id);
      if (niggle) {
        const tpl = renderNiggleCheck({
          user_id: u.user_id,
          niggle_id: niggle.id,
          date_iso: today,
          body_part: niggle.body_part,
          days_active: Math.max(1, Math.floor((Date.now() - new Date(niggle.logged_at).getTime()) / (24 * 3600 * 1000))),
        });
        if (await enqueueIfFresh(u.user_id, tpl, new Date())) {
          stats.enqueued_e++;
        }
      } else {
        const sick = await activeSickEpisode(u.user_id);
        if (sick) {
          const tpl = renderSickCheck({
            user_id: u.user_id,
            episode_id: sick.id,
            date_iso: today,
            days_active: Math.max(1, Math.floor((Date.now() - new Date(sick.logged_at).getTime()) / (24 * 3600 * 1000))),
          });
          if (await enqueueIfFresh(u.user_id, tpl, new Date())) {
            stats.enqueued_e++;
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // CATEGORY F — race-countdown weekly thresholds
    //   Fire on a Sunday morning when the NEXT A-race is at one
    //   of the magic week counts (deck §F TRIGGER variant 2).
    // ──────────────────────────────────────────────────────────
    // 2026-08-21 · watch/push audit · was `prefs.streak_enabled`. Streak
    // milestones are deliberately dead (the only caller has been commented
    // out since 2026-06-03; the web settings row was deleted 2026-08-17), so
    // this push — the one half of the F bucket that actually fires — was
    // governed by a toggle labelled for the half that never can.
    if (
      prefs.race_countdown_enabled &&
      dow === 0 &&
      // 2026-08-21 · window widened 30 min → 6h. A week count is not
      // clock-sensitive; it only has to land on the Sunday.
      isAtLocalTime(clk.hour, clk.minute, '09:00', 6 * 60)
    ) {
      const race = await nextARace(u.user_id, clk.dateISO);
      if (race && [12, 10, 8, 6, 4, 2].includes(race.weeks_to_race)) {
        const tpl = renderRaceCountdown({
          user_id: u.user_id,
          race_id: race.slug,
          race_slug: race.slug,
          race_name: race.name ?? race.slug,
          weeks_to_race: race.weeks_to_race,
          phase_next: race.phase_next ?? null,
        });
        if (await enqueueIfFresh(u.user_id, tpl, new Date())) {
          stats.enqueued_f_race++;
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // CATEGORY H — yesterday is unread
    //   0821 watch handoff § 9. A run is IN and the runner has not
    //   read it: no RPE, no check-in chip, no morning rating. The
    //   design's whole instruction about this one is that it fires
    //   ONCE, because "a second reminder would make it a nag".
    //
    //   Morning window, 08:00 local through noon. Later than that and
    //   the day it is asking about is no longer the day the runner
    //   would name if you asked them.
    // ──────────────────────────────────────────────────────────
    if (prefs.run_unread_enabled && isAtLocalTime(clk.hour, clk.minute, '08:00', 4 * 60)) {
      const unread = await unreadRunYesterday(u.user_id, clk.dateISO).catch(() => null);
      if (unread) {
        const tpl = renderRunUnread({
          user_id: u.user_id,
          run_date_iso: unread.run_date_iso,
          category: unread.category,
          distance_mi: unread.distance_mi,
        });
        if (await enqueueIfFresh(u.user_id, tpl, new Date())) {
          stats.enqueued_h_unread++;
        }
      }
    }
  }
}

/**
 * B8 · is yesterday's run in, and still unread?
 *
 * "Unread" is the runner's own read, not the engine's: RPE, a check-in
 * chip, a morning rating. The engine's grade lands automatically and needs
 * nobody; what the week's shape actually waits on is how it felt, which is
 * exactly the loop lib/coach/acknowledge.ts was built to close. So this
 * asks that module rather than re-deriving the same five signals here.
 *
 * Narrow on purpose:
 *
 *   · Only a long or a quality session. An unjudged recovery jog does not
 *     change anything downstream, so there is nothing true to say about it.
 *     Off-plan, ten miles is the one distance that names itself.
 *   · Never twice for the same run — an all-time check on that run's key,
 *     because the dispatcher's own gate is 24 hours and 24 hours is not
 *     "once".
 *   · Never twice in seven days across DIFFERENT runs either. A runner who
 *     does not use check-ins would otherwise get this every morning they
 *     ran, which is the same nag arriving under a different date. The copy
 *     doctrine's own rule: an observation about a pattern is written at
 *     most twice, and the pattern here is "you are not reading your runs".
 *
 * Returns null on any read failure. A notification is never worth a 500 on
 * the cron.
 */
async function unreadRunYesterday(
  userId: string,
  todayISO: string,
): Promise<{ run_date_iso: string; category: 'long' | 'quality'; distance_mi: number } | null> {
  const yesterdayISO = new Date(Date.parse(todayISO + 'T12:00:00Z') - 86400000)
    .toISOString().slice(0, 10);

  // Cheap gate first — one query — so a runner who has already been told
  // never pays for the five-signal read below.
  const gate = (await pool.query<{ ever: boolean; recent: boolean }>(
    `SELECT
       EXISTS(SELECT 1 FROM notifications_log
               WHERE dedup_key = $1 AND delivered = true) AS ever,
       EXISTS(SELECT 1 FROM notifications_log
               WHERE dedup_key LIKE $2 AND delivered = true
                 AND fired_at > now() - interval '7 days') AS recent`,
    [`run-unread:${userId}:${yesterdayISO}`, `run-unread:${userId}:%`],
  ).catch(() => ({ rows: [{ ever: true, recent: true }] }))).rows[0];
  if (!gate || gate.ever || gate.recent) return null;

  const signals = await loadYesterdaySignals(userId, todayISO);
  if (signals.ranMi <= 0) return null;
  if (hasSubjectiveSignal(signals)) return null;

  const hit = (category: 'long' | 'quality') => ({
    run_date_iso: signals.yesterdayISO,
    category,
    // Canonical miles · the kicker's dose. loadYesterdaySignals already
    // rounds this off canonicalMileageByDay, so nothing is re-derived.
    distance_mi: signals.ranMi,
  });
  const cat = categorizeWorkoutType(signals.plannedType);
  if (cat === 'long') return hit('long');
  if (cat === 'quality') return hit('quality');
  // Off-plan. Ten miles is a long run whatever the calendar called it;
  // anything shorter is left alone rather than guessed at.
  if (signals.plannedType == null && signals.ranMi >= 10) return hit('long');
  return null;
}

// ──────────────────────────────────────────────────────────────
// Helpers — small reads off existing tables. None of these touch
// the LLM (Cardinal Rule #1) — they read state, render templates.
// ──────────────────────────────────────────────────────────────

async function raceOnDate(
  userId: string,
  date: string,
): Promise<{
  slug: string;
  name: string | null;
  gun_time_local: string | null;
  uber_pickup_local: string | null;
  distance_label: string | null;
} | null> {
  try {
    const r = await pool.query(
      `SELECT slug, meta FROM races
        WHERE user_uuid = $1
          AND meta->>'date' = $2
        ORDER BY (meta->>'priority' = 'A') DESC LIMIT 1`,
      [userId, date],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      slug: row.slug,
      name: row.meta?.name ?? null,
      gun_time_local: row.meta?.gun_time ?? row.meta?.start_time ?? null,
      uber_pickup_local: row.meta?.transport?.pickup_time ?? null,
      distance_label: row.meta?.distance_label ?? row.meta?.distance ?? null,
    };
  } catch {
    return null;
  }
}

async function nextARace(
  userId: string,
  today: string,
): Promise<{
  slug: string;
  name: string | null;
  weeks_to_race: number;
  phase_next: string | null;
} | null> {
  try {
    const r = await pool.query(
      `SELECT slug, meta FROM races
        WHERE user_uuid = $1
          AND meta->>'priority' = 'A'
          AND (meta->>'date')::date >= $2::date
        ORDER BY (meta->>'date') ASC LIMIT 1`,
      [userId, today],
    );
    const row = r.rows[0];
    if (!row) return null;
    const date = row.meta?.date as string;
    const days = Math.floor((new Date(date).getTime() - new Date(today).getTime()) / (24 * 3600 * 1000));
    const weeks = Math.round(days / 7);
    return {
      slug: row.slug,
      name: row.meta?.name ?? null,
      weeks_to_race: weeks,
      phase_next: row.meta?.phase_next ?? null,
    };
  } catch {
    return null;
  }
}

async function shakeoutDoneToday(userId: string): Promise<boolean> {
  // 2026-07-06 · audit P1-24 · was `SELECT 1 FROM runs WHERE
  // start_time::date = …` — runs has NO start_time column (jsonb-body
  // table, migration 129); the query threw, the catch returned false,
  // and race-eve always said "Shake-out skipped — that's fine." even
  // when the runner ran. Now reads through the canonical volume reader
  // (data->>'date' semantics + identity dedup, same as every other
  // runs consumer — lib/runs/volume.ts).
  try {
    const today = await runnerToday(userId);
    const byDay = await mileageByDay(userId, today, today);
    return (byDay.get(today)?.mi ?? 0) > 0;
  } catch {
    return false;
  }
}

async function weekSummary(
  userId: string,
  todayISO: string,
  dow: number,
  longRunDow: number,
): Promise<{ week_start_iso: string; actual_mi: number; planned_mi: number; days_run: number; days_planned: number } | null> {
  // 2026-07-06 · audit P1-24 · two fixes in one:
  //   1. was `SUM(distance_mi) … COUNT(DISTINCT start_time::date)` on
  //      runs — neither column exists (jsonb-body table) · the query
  //      threw, the catch returned null, category D never enqueued for
  //      ANY user. Actual miles now come from the canonical volume
  //      reader (lib/runs/volume.ts:mileageByDay · data->>'distanceMi',
  //      identity-deduped so a HK+Strava double-ingest can't inflate
  //      the week).
  //   2. was ISO-Monday anchored · now the training-week window that
  //      ENDS on long_run_day (trainingWeekWindow · one SoT with
  //      /api/plan/week). Caller only invokes this ON long_run_day, so
  //      the window is [today-6, today].
  try {
    const { week_start_iso, week_end_iso } = trainingWeekWindow(todayISO, dow, longRunDow);

    const byDay = await mileageByDay(userId, week_start_iso, week_end_iso);
    let actualMi = 0;
    let daysRun = 0;
    for (const { mi } of byDay.values()) {
      if (mi <= 0) continue;
      actualMi += mi;
      daysRun++;
    }

    // 2026-08-17 · coach-experience audit: this summed plan_workouts by
    // bare user_uuid with NO active-plan filter, so every archived plan
    // generation stacked ("WEEK DONE · 23.2 / 1262.2 MI" in prod). Scope
    // through the ACTIVE plan — which also drops the direct
    // pw.user_uuid filter (null on all new inserts; readers must join
    // via training_plans, per the multi-user audit).
    // 2026-08-21 · watch/push audit · also count the RUNNING days the plan
    // held. The template's denominator was a hardcoded 7, so a runner on a
    // four-day week who ran all four read "4 of 7 days" — a complete week
    // rendered as three misses. rest rows are excluded; DISTINCT because a
    // day can carry more than one plan row (e.g. a double).
    const planned = await pool.query(
      `SELECT COALESCE(SUM(pw.distance_mi), 0)::float AS planned_mi,
              COUNT(DISTINCT pw.date_iso) FILTER (WHERE pw.type <> 'rest')::int AS days_planned
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
          AND pw.date_iso >= $2 AND pw.date_iso <= $3`,
      [userId, week_start_iso, week_end_iso],
    ).catch(() => ({ rows: [{ planned_mi: 0, days_planned: 0 }] }));

    // No plan rows for the week → fall back to 7, the honest denominator for
    // "days" when there is nothing prescribed to count against.
    const daysPlanned = Number(planned.rows[0]?.days_planned) || 0;
    return {
      week_start_iso,
      actual_mi: Math.round(actualMi * 10) / 10,
      planned_mi: planned.rows[0]?.planned_mi ?? 0,
      days_run: daysRun,
      days_planned: daysPlanned > 0 ? daysPlanned : 7,
    };
  } catch {
    return null;
  }
}

async function activeNiggle(userId: string): Promise<{ id: number; body_part: string; logged_at: string } | null> {
  try {
    const r = await pool.query(
      `SELECT id, body_part, logged_at FROM niggles
        WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC LIMIT 1`,
      [userId],
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

async function activeSickEpisode(userId: string): Promise<{ id: number; logged_at: string } | null> {
  try {
    const r = await pool.query(
      `SELECT id, logged_at FROM sick_episodes
        WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC LIMIT 1`,
      [userId],
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

// Used by event-bus writers (skip recovery, strava reconnect, streak)
// to enqueue a pending row without going through the cron poll.
//
// NOT exported here — exported from lib/notifications/enqueue.ts so
// callers don't depend on the route module.
export type EnqueueOptions = {
  fire_at?: Date;
};
