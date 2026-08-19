/**
 * settings.ts — per-user preferences (profile.user_settings jsonb).
 */
import { pool } from '@/lib/db/pool';

export interface UserSettings {
  units_distance: 'mi' | 'km';
  units_temp: 'F' | 'C';
  units_pace: 'min_per_mi' | 'min_per_km';
  long_run_day: 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
  rest_day:     'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
  quality_days: ('sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat')[];
  /** 2026-06-20 · days the runner can actually run (goal/race setup asks).
   *  When set (>=2 days), the plan places long/quality/easy ONLY on these days
   *  and rests the others — Research/22 "shift rest days to user schedule".
   *  Undefined = unset → the engine keeps its long_run_day/quality_days/rest_day
   *  defaults, so existing runners are unchanged. */
  available_days?: ('sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat')[];
  briefing_time: string;            // 'HH:MM' local
  push_enabled: boolean;
  /** 2026-06-12 · timezone mode. 'manual' pins profile.timezone (Settings
   *  override); 'auto' (default when absent) lets device sync follow travel.
   *  Written via setRunnerTimezone, read by captureTimezoneFromDevice. */
  tz_mode?: 'auto' | 'manual';
  /** 2026-08-19 · "Start runs from this phone." THE single source of truth
   *  for whether the phone offers to record a run — the iPhone design's RUN
   *  pill appears only when this is true, and every screen that offers to
   *  start a run reads this one flag rather than deciding for itself.
   *
   *  Defaults TRUE (see DEFAULT_SETTINGS). The recorder already ships and is
   *  already reachable for a runner with no watch (PhoneRunTracker →
   *  PhoneRunView → POST /api/watch/workouts/complete with source 'phone'),
   *  so defaulting false would silently REMOVE a capability every watchless
   *  runner has today, and would leave a fresh install with no way to start a
   *  run until the runner found a setting. Off is therefore opt-OUT.
   *
   *  Two limits the runner is told about at the setting, because neither is
   *  fixable from here and both are the difference between a run saved and a
   *  run lost:
   *    · Recording is FOREGROUND-ONLY. The iPhone target carries no
   *      UIBackgroundModes location entry and PhoneRunTracker keeps
   *      allowsBackgroundLocationUpdates false, so a phone pocketed with the
   *      screen off stops advancing distance.
   *    · There is no heart rate without a watch. The phone has no HR sensor;
   *      the treadmill console's HEART tile is fed by a watch streaming into
   *      HealthKit (TreadmillHRStreamer) and has no source without one. */
  phone_run_enabled?: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  units_distance: 'mi',
  units_temp: 'F',
  units_pace: 'min_per_mi',
  long_run_day: 'sun',
  rest_day: 'sat',
  quality_days: ['tue', 'thu'],
  briefing_time: '07:00',
  push_enabled: true,
  phone_run_enabled: true,
};

/** Runner-facing copy for the phone-run setting. Kept beside the flag so the
 *  web settings surface and the iPhone read the same words. Coach voice: the
 *  two limits are stated as facts, not warnings, and nothing is hyped. */
export const PHONE_RUN_SETTING_COPY = {
  label: 'Start runs from this phone',
  help:
    'Keep the screen on while you run. The phone stops recording in your pocket. ' +
    'No heart rate without a watch.',
} as const;

export async function loadSettings(userId: string): Promise<UserSettings> {
  try {
    const r = (await pool.query(
      `SELECT user_settings FROM profile
        WHERE user_uuid = $1
        ORDER BY (user_uuid = $1) DESC LIMIT 1`,
      [userId]
    )).rows[0]?.user_settings ?? {};
    return { ...DEFAULT_SETTINGS, ...r };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function patchSettings(userId: string, patch: Partial<UserSettings>): Promise<void> {
  // jsonb concat merges; later keys win.
  await pool.query(
    `UPDATE profile SET user_settings = user_settings || $2
      WHERE user_uuid = $1`,
    [userId, JSON.stringify(patch)]
  );
}
