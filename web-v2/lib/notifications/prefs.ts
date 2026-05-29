/**
 * Notification preferences reader. Backed by profile.notification_prefs JSONB
 * (migration 121). The scheduler reads this on every poll to decide whether
 * to fire a given category; the settings UI writes it via /api/profile/notifications.
 *
 * Defaults mirror the column DEFAULT in 121_notifications.sql exactly.
 * Reads are cached for 60s per user; the writer (PATCH) busts the cache
 * on update.
 */

import { pool } from '@/lib/db/pool';
import type { NotificationCategory } from './apns';

export interface NotificationPrefs {
  master_enabled: boolean;
  race_day_enabled: boolean;
  race_eve_enabled: boolean;
  skip_recovery_enabled: boolean;
  weekly_checkin_enabled: boolean;
  niggle_sick_enabled: boolean;
  streak_enabled: boolean;
  strava_reconnect_enabled: boolean;
  race_day_wake_time: string;     // 'HH:MM'
  weekly_checkin_time: string;    // 'HH:MM' (Sunday)
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  master_enabled: true,
  race_day_enabled: true,
  race_eve_enabled: true,
  skip_recovery_enabled: true,
  weekly_checkin_enabled: true,
  niggle_sick_enabled: true,
  streak_enabled: true,
  strava_reconnect_enabled: true,
  race_day_wake_time: '05:30',
  weekly_checkin_time: '20:00',
  quiet_hours_start: '22:00',
  quiet_hours_end: '06:00',
};

interface CacheEntry { value: NotificationPrefs; expires: number; }
const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export async function loadNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;

  try {
    const r = await pool.query(
      `SELECT notification_prefs FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userId],
    );
    const raw = r.rows[0]?.notification_prefs ?? {};
    const merged: NotificationPrefs = { ...DEFAULT_PREFS, ...raw };
    cache.set(userId, { value: merged, expires: Date.now() + TTL_MS });
    return merged;
  } catch {
    // Column missing or query failed → return defaults so callers don't crash.
    return DEFAULT_PREFS;
  }
}

export function bustPrefsCache(userId: string): void {
  cache.delete(userId);
}

/** Map a category to the prefs flag that gates it. */
export function categoryEnabled(prefs: NotificationPrefs, c: NotificationCategory): boolean {
  if (!prefs.master_enabled) return false;
  switch (c) {
    case 'race_day':         return prefs.race_day_enabled;
    case 'race_eve':         return prefs.race_eve_enabled;
    case 'skip_recovery':    return prefs.skip_recovery_enabled;
    case 'weekly_checkin':   return prefs.weekly_checkin_enabled;
    case 'niggle_sick':      return prefs.niggle_sick_enabled;
    case 'streak':           return prefs.streak_enabled;
    case 'strava_reconnect': return prefs.strava_reconnect_enabled;
  }
}
