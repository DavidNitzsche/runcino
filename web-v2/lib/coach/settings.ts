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
  briefing_time: string;            // 'HH:MM' local
  push_enabled: boolean;
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
};

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
