/**
 * GET   /api/profile/notifications  → { prefs: NotificationPrefs }
 * PATCH /api/profile/notifications  body { partial NotificationPrefs }
 *
 * Reads / updates profile.notification_prefs (jsonb). The /profile
 * settings panel calls these to wire the master toggle + per-category
 * + race-day wake / weekly check-in / quiet hours surfaces.
 *
 * The race_day_enabled flag is intentionally NOT enforced disabled
 * here — the UI renders it disabled (deck §SETTINGS · RACE-DAY LOCK)
 * but the column is honest. If a future hardware key flips it to
 * false, the sender respects it. The deck is the contract, not the
 * column.
 *
 * Source spec: docs/2026-05-28-notifications.html §SETTINGS SURFACE.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { DEFAULT_PREFS, bustPrefsCache, loadNotificationPrefs } from '@/lib/notifications/prefs';
import { requireUserId } from '@/lib/auth/session';

const ALLOWED_KEYS = new Set<keyof typeof DEFAULT_PREFS>([
  'master_enabled',
  'race_day_enabled',
  'race_eve_enabled',
  'skip_recovery_enabled',
  'weekly_checkin_enabled',
  'niggle_sick_enabled',
  'streak_enabled',
  'strava_reconnect_enabled',
  'race_day_wake_time',
  'weekly_checkin_time',
  'quiet_hours_start',
  'quiet_hours_end',
]);

function validHm(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const prefs = await loadNotificationPrefs(userId);
  return NextResponse.json({ prefs });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Validate the patch shape
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'user_id') continue;
    if (!ALLOWED_KEYS.has(k as any)) {
      return NextResponse.json({ error: `Field not allowed: ${k}` }, { status: 400 });
    }
    if (k.endsWith('_enabled')) {
      if (typeof v !== 'boolean') {
        return NextResponse.json({ error: `${k} must be boolean` }, { status: 400 });
      }
      patch[k] = v;
    } else if (k.endsWith('_time') || k.startsWith('quiet_hours_')) {
      if (!validHm(v)) {
        return NextResponse.json({ error: `${k} must be 'HH:MM' (00-23 : 00-59)` }, { status: 400 });
      }
      patch[k] = v;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields in body' }, { status: 400 });
  }

  try {
    // Merge into the JSONB column. COALESCE so missing column doesn't NPE.
    const r = await pool.query(
      `UPDATE profile
          SET notification_prefs = COALESCE(notification_prefs, '{}'::jsonb) || $2::jsonb
        WHERE user_uuid = $1
        RETURNING notification_prefs`,
      [userId, JSON.stringify(patch)],
    );
    if (r.rowCount === 0) {
      // No profile row yet → insert one with the partial prefs merged into defaults.
      const merged = { ...DEFAULT_PREFS, ...patch };
      await pool.query(
        `INSERT INTO profile (user_uuid, notification_prefs) VALUES ($1, $2::jsonb)`,
        [userId, JSON.stringify(merged)],
      );
    }
    bustPrefsCache(userId);
    const updated = await loadNotificationPrefs(userId);
    return NextResponse.json({ ok: true, prefs: updated });
  } catch (err: any) {
    return NextResponse.json({
      error: 'prefs update failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/121_notifications.sql?',
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
