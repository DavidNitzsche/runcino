/**
 * POST /api/notifications/ack
 *   { notification_id?, dedup_key?, category, action, user_id? }
 *
 * Lock-screen rich-action handler. The iPhone NotificationCategories.swift
 * registers UNNotificationActions for the rich categories and POSTs here
 * when the runner taps one. The endpoint:
 *   1. Records the ack on the notifications_log row.
 *   2. Routes per-category to the canonical state-change endpoint:
 *      - skip_recovery READY        → DELETE /api/today/skip (un-skip)
 *      - skip_recovery STILL_SKIPPING → log only (no side-effect; next-day
 *                                       scheduler re-fires)
 *      - weekly_checkin SOLID|TIRED|WRECKED → POST /api/checkin
 *      - niggle_sick BETTER|SAME|WORSE|GONE → POST /api/niggle/recovery
 *      - niggle_sick RECOVERED               → POST /api/sick/recovery
 *
 * Per the deck §C HIG NOTE the ack does NOT require unlock — it POSTs
 * non-sensitive state changes (sick + skip toggles, weekly rating). The
 * one exception is Strava reconnect, which the iOS layer flags
 * authentication_required=true on the UNNotificationAction itself, so
 * iOS handles the unlock before invoking the handler.
 *
 * IMPLEMENTATION: rather than HTTP-roundtrip to the existing endpoints
 * (which would force re-auth + add latency), this endpoint INVOKES the
 * underlying SQL writes directly. Same SQL the canonical endpoints run.
 * /api/checkin / /api/today/skip / /api/niggle/recovery / /api/sick/recovery
 * are untouched.
 *
 * Source spec: docs/2026-05-28-notifications.html §4 + §C-E.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

type Category =
  | 'race_day'
  | 'race_eve'
  | 'skip_recovery'
  | 'weekly_checkin'
  | 'niggle_sick'
  | 'streak'
  | 'strava_reconnect';

interface AckBody {
  notification_id?: number;
  dedup_key?: string;
  category: Category;
  action: string;
  user_id?: string;
  // optional metadata for the niggle_sick variant — when the iPhone
  // already has the niggle vs sick context it can pass kind=sick to
  // route the right way. Otherwise we auto-detect by checking
  // dedup_key prefix (deck §E uses 'niggle-check' vs 'sick-check').
  kind?: 'niggle' | 'sick';
}

export async function POST(req: NextRequest) {
  let body: AckBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.category || !body.action) {
    return NextResponse.json({ error: 'category + action required' }, { status: 400 });
  }
  const userId = body.user_id ?? DAVID_USER_ID;
  const action = body.action.toLowerCase();

  // 1. Stamp the ack on the log row (if we can find it).
  await stampLogAck(body, action);

  // 2. Route by category.
  let sideEffect: Record<string, unknown> = { side_effect: 'none' };
  try {
    switch (body.category) {
      case 'skip_recovery':
        sideEffect = await ackSkipRecovery(userId, action);
        break;
      case 'weekly_checkin':
        sideEffect = await ackWeeklyCheckin(userId, action);
        break;
      case 'niggle_sick':
        sideEffect = await ackNiggleSick(userId, action, body);
        break;
      default:
        // race_day / race_eve / streak / strava_reconnect: ack is informational only
        sideEffect = { side_effect: 'log_only' };
    }
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      side_effect_error: err?.message ?? String(err),
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...sideEffect });
}

// ──────────────────────────────────────────────────────────────
// Ack log update
// ──────────────────────────────────────────────────────────────

async function stampLogAck(body: AckBody, action: string): Promise<void> {
  try {
    if (body.notification_id != null) {
      await pool.query(
        `UPDATE notifications_log SET ack_action = $1, ack_at = now() WHERE id = $2`,
        [action, body.notification_id],
      );
      return;
    }
    if (body.dedup_key) {
      await pool.query(
        `UPDATE notifications_log SET ack_action = $1, ack_at = now()
          WHERE id = (
            SELECT id FROM notifications_log
             WHERE dedup_key = $2
             ORDER BY fired_at DESC LIMIT 1
          )`,
        [action, body.dedup_key],
      );
    }
  } catch (err) {
    // Soft-fail — the side-effect SQL below still runs.
    console.error('[ack] stamp failed:', (err as Error).message);
  }
}

// ──────────────────────────────────────────────────────────────
// skip_recovery
// ──────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

/**
 * READY          → DELETE the skip row for YESTERDAY (the day that was
 *                  skipped). This re-opens the workout in the day-state
 *                  resolver so the runner sees today's plan fresh.
 *                  Note: the deck says "resets day_state to today's
 *                  planned" — we clear yesterday's skip + record today
 *                  as fresh by NOT writing a skip.
 * STILL_SKIPPING → records a fresh skip for TODAY, so the scheduler
 *                  re-fires tomorrow morning (it sees yesterday=missed).
 */
async function ackSkipRecovery(userId: string, action: string): Promise<Record<string, unknown>> {
  const today = todayIso();
  const yesterday = new Date(Date.now() - (7 + 24) * 3600000).toISOString().slice(0, 10);
  if (action === 'ready') {
    await pool.query(
      `DELETE FROM day_actions WHERE user_id = $1 AND date_iso = $2 AND action = 'skip'`,
      [userId, yesterday],
    );
    return { side_effect: 'unskipped_yesterday', date_iso: yesterday };
  }
  if (action === 'still_skipping') {
    await pool.query(
      `INSERT INTO day_actions (user_id, date_iso, action)
       VALUES ($1, $2, 'skip')
       ON CONFLICT (user_id, date_iso, action) DO NOTHING`,
      [userId, today],
    );
    return { side_effect: 'skipped_today', date_iso: today };
  }
  return { side_effect: 'unknown_action', action };
}

// ──────────────────────────────────────────────────────────────
// weekly_checkin
// ──────────────────────────────────────────────────────────────

/**
 * SOLID|TIRED|WRECKED → insert into check_ins, mirroring /api/checkin's
 * canonical write. surface='weekly_notification' so the coach state read
 * can distinguish a notif-driven rating from one tapped in-app.
 */
async function ackWeeklyCheckin(userId: string, action: string): Promise<Record<string, unknown>> {
  const valid = ['solid', 'tired', 'wrecked'];
  if (!valid.includes(action)) {
    return { side_effect: 'unknown_action', action };
  }
  await pool.query(
    `INSERT INTO check_ins (user_id, rating, briefing_id, surface, note, ts)
     VALUES ($1, $2, null, 'weekly_notification', null, now())`,
    [userId, action],
  );
  return { side_effect: 'checkin_recorded', rating: action };
}

// ──────────────────────────────────────────────────────────────
// niggle_sick — BETTER|SAME|WORSE|GONE go to niggle; RECOVERED → sick
// ──────────────────────────────────────────────────────────────

async function ackNiggleSick(
  userId: string,
  action: string,
  body: AckBody,
): Promise<Record<string, unknown>> {
  // 'recovered' is the sick path — niggle uses 'gone'.
  const isSick =
    action === 'recovered' ||
    body.kind === 'sick' ||
    body.dedup_key?.startsWith('sick-check:');

  if (isSick) {
    const validSick = ['better', 'same', 'worse', 'recovered'];
    if (!validSick.includes(action)) {
      return { side_effect: 'unknown_action', action };
    }
    const active = (await pool.query(
      `SELECT id FROM sick_episodes
        WHERE user_id = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC LIMIT 1`,
      [userId],
    )).rows[0];
    if (!active) return { side_effect: 'no_active_sick_episode' };
    await pool.query(
      `INSERT INTO sick_recovery (episode_id, response) VALUES ($1, $2)`,
      [active.id, action],
    );
    if (action === 'recovered') {
      await pool.query(`UPDATE sick_episodes SET cleared_at = now() WHERE id = $1`, [active.id]);
      return { side_effect: 'sick_resolved' };
    }
    return { side_effect: 'sick_trend_logged', trend: action };
  }

  // Niggle path
  const validN = ['better', 'same', 'worse', 'gone'];
  if (!validN.includes(action)) {
    return { side_effect: 'unknown_action', action };
  }
  const active = (await pool.query(
    `SELECT id FROM niggles
      WHERE user_id = $1 AND cleared_at IS NULL
      ORDER BY logged_at DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!active) return { side_effect: 'no_active_niggle' };
  await pool.query(
    `INSERT INTO niggle_recovery (niggle_id, response) VALUES ($1, $2)`,
    [active.id, action],
  );
  if (action === 'gone') {
    await pool.query(`UPDATE niggles SET cleared_at = now() WHERE id = $1`, [active.id]);
    return { side_effect: 'niggle_resolved' };
  }
  return { side_effect: 'niggle_trend_logged', trend: action };
}

export const dynamic = 'force-dynamic';
