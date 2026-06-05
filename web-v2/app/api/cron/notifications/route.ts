/**
 * GET  /api/cron/notifications   — health probe (no auth)
 * POST /api/cron/notifications   — drain + schedule (Bearer CRON_SECRET)
 *
 * Hybrid scheduler entry point (deck §5). The POST handler runs every
 * 15 min via Railway's cron-job.org integration and does TWO things:
 *
 *   1. DRAIN THE QUEUE
 *      For every notifications_pending row where fire_at <= now() AND
 *      processed_at IS NULL, render the payload back into a template
 *      and dispatch it. The row's payload was pre-rendered at enqueue
 *      time so we don't re-resolve state at fire — what the enqueuer
 *      decided was the message IS the message.
 *
 *   2. SCHEDULE TIME-BASED CATEGORIES
 *      For every active user, evaluate B (race eve T-21:00), D (Sunday
 *      20:00 weekly check-in), and F race-countdown thresholds. Enqueue
 *      rows when due. Idempotent — the pending dedup_key prevents
 *      duplicate rows landing for the same key within 24h.
 *
 * Event-based categories (C skip recovery, E niggle/sick daily, F streak,
 * G strava reconnect) are enqueued at their originating writes — the cron
 * just drains them when fire_at lands.
 *
 * Source spec: docs/2026-05-28-notifications.html §5 (hybrid scheduler).
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
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
  type RenderedTemplate,
} from '@/lib/notifications/templates';
import { loadNotificationPrefs, categoryEnabled } from '@/lib/notifications/prefs';

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
  return NextResponse.json({
    endpoint: 'POST /api/cron/notifications',
    pending: pendingCount,
    secret_configured: Boolean(process.env.CRON_SECRET),
    apns_configured: Boolean(
      process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      (process.env.APNS_KEY_PEM || process.env.APNS_KEY_PATH),
    ),
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
    failed: 0,
    enqueued_b: 0,
    enqueued_d: 0,
    enqueued_e: 0,
    enqueued_f_race: 0,
    errors: [] as string[],
  };

  // 1. Drain
  try {
    await drainPending(stats);
  } catch (err: any) {
    stats.errors.push(`drain: ${err?.message ?? err}`);
  }

  // 2. Schedule
  try {
    await scheduleTimeBased(stats);
  } catch (err: any) {
    stats.errors.push(`schedule: ${err?.message ?? err}`);
  }

  return NextResponse.json({ ok: true, ...stats });
}

// ──────────────────────────────────────────────────────────────
// 1. DRAIN — process notifications_pending rows that are due
// ──────────────────────────────────────────────────────────────

async function drainPending(stats: any): Promise<void> {
  const due = (await pool.query(
    `SELECT id, user_id, category, payload
       FROM notifications_pending
      WHERE processed_at IS NULL AND fire_at <= now()
      ORDER BY fire_at ASC
      LIMIT 200`,
  )).rows as Array<{ id: number; user_id: string; category: string; payload: any }>;

  for (const row of due) {
    stats.drained++;
    try {
      // The pending row carries the fully-rendered template (we stored it
      // pre-rendered at enqueue time so what was decided IS what fires).
      const tpl = row.payload as RenderedTemplate;
      const result = await dispatchNotification(row.user_id, tpl);
      if (result.ok && result.sent_count != null && result.sent_count > 0) {
        stats.dispatched++;
      } else if (result.skipped === 'category_off' || result.skipped === 'master_off') {
        stats.skipped_pref++;
      } else if (result.skipped === 'recently_sent') {
        stats.skipped_dedup++;
      } else if (result.skipped === 'no_tokens') {
        stats.skipped_no_tokens++;
      } else if (result.skipped === 'apns_not_configured') {
        stats.skipped_apns_not_configured++;
      } else if (result.failed_count != null && result.failed_count > 0) {
        stats.failed++;
      }
    } catch (err: any) {
      stats.errors.push(`drain row ${row.id}: ${err?.message ?? err}`);
    } finally {
      // Mark processed either way — the dispatcher logged the attempt
      // on notifications_log; the pending row's job is done.
      await pool.query(
        `UPDATE notifications_pending SET processed_at = now() WHERE id = $1`,
        [row.id],
      ).catch(() => {});
    }
  }
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

/** Returns true iff the user-local current minute equals exactly HH:MM. */
function isAtLocalTime(hour: number, minute: number, hm: string, slackMin = 15): boolean {
  const [h, m] = hm.split(':').map(Number);
  const userMin = hour * 60 + minute;
  const targetMin = h * 60 + m;
  const delta = userMin - targetMin;
  // Cron polls every 15 min → fire if within [0, 15min) of the target.
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
    if (prefs.race_day_enabled && isAtLocalTime(clk.hour, clk.minute, prefs.race_day_wake_time)) {
      const today = clk.dateISO;
      const race = await raceOnDate(u.user_id, today);
      if (race) {
        const tpl = renderRaceDay({
          race_id: race.slug,
          race_slug: race.slug,
          race_name: race.name ?? race.slug,
          gun_time_local: race.gun_time_local ?? '07:00',
          uber_pickup_local: race.uber_pickup_local ?? null,
          distance: race.distance_label ?? '13.1',
        });
        if (await enqueueIfFresh(u.user_id, tpl, new Date())) {
          stats.enqueued_b++; // counted under B/A bucket
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // CATEGORY B — race eve at 21:00 if a race is in next 24h
    // ──────────────────────────────────────────────────────────
    if (prefs.race_eve_enabled && isAtLocalTime(clk.hour, clk.minute, '21:00')) {
      const tomorrow = userLocalTomorrow(u.tz);
      const race = await raceOnDate(u.user_id, tomorrow);
      if (race) {
        const tpl = renderRaceEve({
          race_id: race.slug,
          race_slug: race.slug,
          shakeout_done: await shakeoutDoneToday(u.user_id),
        });
        if (await enqueueIfFresh(u.user_id, tpl, new Date())) {
          stats.enqueued_b++;
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // CATEGORY D — weekly check-in Sunday at prefs.weekly_checkin_time
    // ──────────────────────────────────────────────────────────
    if (
      prefs.weekly_checkin_enabled &&
      dow === 0 && // Sunday
      isAtLocalTime(clk.hour, clk.minute, prefs.weekly_checkin_time)
    ) {
      const summary = await weekSummary(u.user_id, u.tz);
      if (summary && summary.days_run > 0) {
        const tpl = renderWeeklyCheckin({
          user_id: u.user_id,
          week_start_iso: summary.week_start_iso,
          actual_mi: summary.actual_mi,
          planned_mi: summary.planned_mi,
          days_run: summary.days_run,
          days_total: 7,
        });
        if (await enqueueIfFresh(u.user_id, tpl, new Date())) {
          stats.enqueued_d++;
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // CATEGORY E — daily niggle/sick check at 07:15 local
    // ──────────────────────────────────────────────────────────
    if (prefs.niggle_sick_enabled && isAtLocalTime(clk.hour, clk.minute, '07:15')) {
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
    if (
      prefs.streak_enabled &&
      dow === 0 &&
      isAtLocalTime(clk.hour, clk.minute, '09:00')
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
  }
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
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await pool.query(
      `SELECT 1 FROM runs WHERE user_uuid = $1 AND start_time::date = $2::date LIMIT 1`,
      [userId, today],
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function weekSummary(
  userId: string,
  userTz: string,
): Promise<{ week_start_iso: string; actual_mi: number; planned_mi: number; days_run: number } | null> {
  try {
    // 2026-06-05 · backend audit P0-10 fix · compute ISO Monday in
    // the RUNNER'S TZ, not server UTC. At Pacific Sunday 21:00 (the
    // weekly check-in fire time) server UTC is already Monday 05:00 ·
    // the old getUTCDay()-based Monday computation rolled forward by
    // a week and the summary covered the WRONG seven days.
    const clk = userLocalClock(userTz);
    const [y, m, d] = clk.dateISO.split('-').map(Number);
    // Anchor the runner's "today" at noon UTC of their local date · then
    // walk back (dow - 1) days for ISO Monday. The noon anchor is purely
    // arithmetic · we only consume the YYYY-MM-DD slice.
    const todayUtcAnchor = new Date(Date.UTC(y, m - 1, d, 12));
    const dow = clk.dow === 0 ? 7 : clk.dow; // map Sun=0 → 7 for ISO week
    const monday = new Date(todayUtcAnchor);
    monday.setUTCDate(monday.getUTCDate() - (dow - 1));
    const weekStart = monday.toISOString().slice(0, 10);

    const r = await pool.query(
      `SELECT
         COALESCE(SUM(distance_mi), 0)::float AS actual_mi,
         COUNT(DISTINCT start_time::date)::int AS days_run
       FROM runs
      WHERE user_uuid = $1 AND start_time::date >= $2::date AND start_time::date < $2::date + interval '7 days'`,
      [userId, weekStart],
    );
    const planned = await pool.query(
      `SELECT COALESCE(SUM(distance_mi), 0)::float AS planned_mi
         FROM plan_workouts
        WHERE user_uuid = $1 AND date_iso >= $2 AND date_iso < ($2::date + interval '7 days')::text`,
      [userId, weekStart],
    ).catch(() => ({ rows: [{ planned_mi: 0 }] }));

    return {
      week_start_iso: weekStart,
      actual_mi: r.rows[0]?.actual_mi ?? 0,
      planned_mi: planned.rows[0]?.planned_mi ?? 0,
      days_run: r.rows[0]?.days_run ?? 0,
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
