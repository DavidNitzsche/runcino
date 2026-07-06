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

// ──────────────────────────────────────────────────────────────
// iPhone wire-shape aliases · 2026-07-06 · audit P1-15
//
// THE CANONICAL PREFS SHAPE IS NotificationPrefs ABOVE (the server
// keys: master/race_day/race_eve/skip_recovery/weekly_checkin/
// niggle_sick/streak/strava_reconnect + the four time fields). Wave 2
// native migrates G_Settings.swift's NotificationPrefs to these keys
// and the alias layer below becomes dead code — delete it then.
//
// Until that ships, the iPhone sends a 7-key struct whose only overlap
// with the canonical shape is streak_enabled. The server used to 400
// the whole PATCH on the first unknown key, so every phone toggle was
// fake (never saved) and GET returned a shape the phone couldn't use.
// The alias map below translates both directions:
//
//   phone key                  → canonical key
//   readiness_enabled          → niggle_sick_enabled   (morning niggle/sick checks)
//   workout_reminder_enabled   → skip_recovery_enabled (the workout-nudge category)
//   recap_enabled              → weekly_checkin_enabled (weekly recap/check-in)
//   race_countdown_enabled     → race_eve_enabled      (race-proximity messaging;
//                                race_day_enabled stays phone-untogglable per
//                                deck §SETTINGS · RACE-DAY LOCK)
//   reconnect_enabled          → strava_reconnect_enabled
//   streak_enabled             → streak_enabled        (already canonical)
//   adaptation_enabled         → (no engine category yet · accepted +
//                                stored as-is in the jsonb for forward
//                                compat, gates nothing server-side)
// ──────────────────────────────────────────────────────────────

export const PHONE_PREF_ALIASES: Record<string, keyof NotificationPrefs> = {
  readiness_enabled: 'niggle_sick_enabled',
  workout_reminder_enabled: 'skip_recovery_enabled',
  recap_enabled: 'weekly_checkin_enabled',
  race_countdown_enabled: 'race_eve_enabled',
  reconnect_enabled: 'strava_reconnect_enabled',
};

/** Phone-only keys that have no canonical counterpart yet. Accepted on
 *  PATCH and stored verbatim so the phone's toggle round-trips; the
 *  engine ignores them. */
export const PHONE_PASSTHROUGH_KEYS = new Set<string>(['adaptation_enabled']);

/**
 * Rewrite iPhone alias keys in a PATCH body to their canonical keys.
 * Canonical keys pass through untouched (phone alias never overrides an
 * explicit canonical key in the same body — canonical wins). Returns a
 * NEW object; unknown keys are preserved for the route's own validation
 * to reject.
 */
export function translatePhonePrefKeys(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const canonical = PHONE_PREF_ALIASES[k];
    if (canonical) {
      if (!(canonical in body)) out[canonical] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Derive the iPhone alias view from canonical prefs, for GET responses
 * that emit BOTH shapes. `raw` is the stored jsonb (for passthrough keys
 * like adaptation_enabled that live outside NotificationPrefs).
 */
export function phoneAliasView(
  prefs: NotificationPrefs,
  raw?: Record<string, unknown>,
): Record<string, boolean> {
  const view: Record<string, boolean> = {};
  for (const [phoneKey, canonical] of Object.entries(PHONE_PREF_ALIASES)) {
    view[phoneKey] = Boolean(prefs[canonical]);
  }
  for (const k of PHONE_PASSTHROUGH_KEYS) {
    const v = raw?.[k];
    view[k] = typeof v === 'boolean' ? v : true; // phone default = true
  }
  // streak_enabled is identical in both shapes — already in prefs.
  return view;
}

/**
 * Canonical prefs + derived phone alias keys flattened into ONE object,
 * for GET/PATCH response bodies.
 *
 * 2026-07-06 · adversarial review of P1-15. The iPhone's
 * fetchNotificationPrefs (API+Toolkit.swift) FIRST tries
 * JSONDecoder().decode(NotificationPrefs.self, from: <whole body>) and
 * its init(from:) is per-key tolerant — every missing key defaults to
 * true. Decoding {"prefs":{...}} therefore SUCCEEDS with all-true and
 * the {prefs:} Wrap fallback is never reached, so alias keys nested
 * inside `prefs` were invisible to the phone. Worse: the phone's
 * onPrefChange PATCHes the full 7-key struct from that all-true display,
 * silently re-enabling categories disabled on web. The routes therefore
 * spread this object at the TOP LEVEL of the response (phone's direct
 * decode) AND under `prefs` (web Settings.tsx reads j.prefs). Dies with
 * the alias layer when Wave 2 native adopts the canonical shape.
 */
export function dualShapePrefsBody(
  prefs: NotificationPrefs,
  raw?: Record<string, unknown>,
): Record<string, unknown> {
  return { ...prefs, ...phoneAliasView(prefs, raw) };
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
