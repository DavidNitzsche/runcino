-- 121_notifications.sql
-- Push notifications v1 — 7 categories (A → G).
--
-- Source: docs/2026-05-28-notifications.html (mirrored to
-- web-v2/public/decks/notifications.html).
--
-- THREE TABLES + ONE JSONB COLUMN:
--
--   profile.notification_prefs (jsonb column, added to existing table)
--     Per-runner master toggle + 7 per-category toggles + race-day wake +
--     weekly check-in time + quiet hours range. Single source of truth.
--     JSONB so we can extend without ALTERing as we add categories.
--
--   device_tokens
--     APNs device tokens. One row per device. The iPhone POSTs its token
--     on app boot (FaffApp.swift) + on every foreground transition so we
--     pick up Apple's silent rotations. revoked_at flips when APNs returns
--     410 Gone on a send (we mark + skip future sends).
--
--   notifications_log
--     Every send. Dedup + visibility + ack tracking. Indexed on
--     (user_id, fired_at DESC) so per-runner debug surfaces are O(log n).
--     payload holds the full APNs body so a deck-style audit can reconstruct
--     exactly what landed.
--
-- Idempotent. Apply with:
--   node scripts/apply-121.mjs
--
-- See migration 122 for the pending-queue table that drives the scheduler.

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{
    "master_enabled": true,
    "race_day_enabled": true,
    "race_eve_enabled": true,
    "skip_recovery_enabled": true,
    "weekly_checkin_enabled": true,
    "niggle_sick_enabled": true,
    "streak_enabled": true,
    "strava_reconnect_enabled": true,
    "race_day_wake_time": "05:30",
    "weekly_checkin_time": "20:00",
    "quiet_hours_start": "22:00",
    "quiet_hours_end": "06:00"
  }'::jsonb;

COMMENT ON COLUMN profile.notification_prefs IS
  'Notification prefs v1. JSONB shape: { master_enabled, race_day_enabled, race_eve_enabled, skip_recovery_enabled, weekly_checkin_enabled, niggle_sick_enabled, streak_enabled, strava_reconnect_enabled, race_day_wake_time (HH:MM local), weekly_checkin_time (HH:MM local Sunday), quiet_hours_start (HH:MM), quiet_hours_end (HH:MM) }. Race-day is intentionally non-disable-able in UI but the column is read literally by the sender — see deck §SETTINGS SURFACE.';

-- APNs device tokens. One row per device. Updated on app boot + foreground.
CREATE TABLE IF NOT EXISTS device_tokens (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL,
  device_token  text NOT NULL UNIQUE,
  platform      text NOT NULL CHECK (platform IN ('ios', 'web')),
  app_version   text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS device_tokens_user_active_idx
  ON device_tokens (user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE device_tokens IS
  'APNs / WebPush device tokens. One row per device. revoked_at flips when the platform returns 410 Gone or the user de-grants OS-level notifications.';

-- Notifications log. Dedup + ack visibility.
CREATE TABLE IF NOT EXISTS notifications_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  category    text NOT NULL,         -- 'race_day'|'race_eve'|'skip_recovery'|'weekly_checkin'|'niggle_sick'|'streak'|'strava_reconnect'
  fired_at    timestamptz NOT NULL DEFAULT now(),
  apns_id     text,                  -- APNs apns-id header echoed back on 2xx
  payload     jsonb NOT NULL,        -- full APNs body that was sent
  delivered   boolean,               -- null while in flight; true on 2xx, false on error
  ack_action  text,                  -- 'solid'|'tired'|'wrecked'|'ready'|'still_skipping'|'better'|'same'|'worse'|'gone'|'recovered'
  ack_at      timestamptz,
  dedup_key   text                   -- 'race-day:{race_id}' etc. — gate before send
);

CREATE INDEX IF NOT EXISTS notifications_log_user_recent_idx
  ON notifications_log (user_id, fired_at DESC);

CREATE INDEX IF NOT EXISTS notifications_log_dedup_idx
  ON notifications_log (dedup_key, fired_at DESC) WHERE dedup_key IS NOT NULL;

COMMENT ON TABLE notifications_log IS
  'Every notification we attempt to send. dedup_key gate keeps the same key from re-firing within 24h (deck §5 dedup gate). ack_action/ack_at capture rich-notification button taps via /api/notifications/ack.';
