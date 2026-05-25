-- 104_user_settings.sql
-- Per-user preferences/settings as a single jsonb column on profile.
-- Keys (all optional):
--   units_distance: 'mi' | 'km'           default 'mi'
--   units_temp:     'F'  | 'C'            default 'F'
--   units_pace:     'min_per_mi' | 'min_per_km'
--   long_run_day:   'sun'..'sat'          default 'sun'
--   quality_days:   array of dow shortcodes
--   rest_day:       'sun'..'sat'          default 'sat'
--   briefing_time:  'HH:MM' local         default '07:00'
--   push_enabled:   boolean               default true
--
-- Apply: psql $DATABASE_URL -f web-v2/db/migrations/104_user_settings.sql

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS user_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profile.user_settings IS
  'Per-user preferences. See web-v2/lib/coach/settings.ts for shape and defaults.';
