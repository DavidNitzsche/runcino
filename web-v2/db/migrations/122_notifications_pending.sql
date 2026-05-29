-- 122_notifications_pending.sql
-- Pending-queue table for the hybrid scheduler.
--
-- Source: docs/2026-05-28-notifications.html §5 (scheduler architecture).
--
-- The cron endpoint at /api/cron/notifications scans this table every
-- 15 min for rows where fire_at <= now() AND processed_at IS NULL. Events
-- (skip recovery, niggle/sick, streak milestones, race-day morning, race
-- eve) are enqueued here by their originating writers — day_actions skip
-- insert, niggles insert, sick insert, run-ingest streak check, race
-- insert. Time-only triggers (weekly check-in) get enqueued by the cron
-- itself at the user-local time the runner configured in prefs.
--
-- We deliberately keep this simple — no priority lane, no retry counter,
-- no DLQ. v1 is "fire at fire_at; on error, log + drop". Misses are
-- low-stakes for everything except race-day, which gets a separate
-- T-wake +5min retry row at enqueue time (deck §A · RELIABILITY).
--
-- Idempotent. Apply with:
--   node scripts/apply-122.mjs

CREATE TABLE IF NOT EXISTS notifications_pending (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL,
  category     text NOT NULL,        -- same enum as notifications_log.category
  fire_at      timestamptz NOT NULL, -- when the cron should attempt the send
  payload      jsonb NOT NULL,       -- pre-rendered slots: { title, body, action_buttons, data, dedup_key }
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,          -- set on send-or-drop; sets to now() either way
  dedup_key    text                  -- copy of payload.dedup_key for fast unique gate
);

-- Hot path: cron polls "due, unprocessed rows in fire_at order".
CREATE INDEX IF NOT EXISTS notifications_pending_due_idx
  ON notifications_pending (fire_at) WHERE processed_at IS NULL;

-- Secondary path: dedup at enqueue time (an event-bus writer can SKIP
-- LOCKED-check before inserting a duplicate). Same key inside the prior
-- 24h on a still-unprocessed row → drop on the writer side.
CREATE INDEX IF NOT EXISTS notifications_pending_dedup_idx
  ON notifications_pending (dedup_key, fire_at DESC)
  WHERE dedup_key IS NOT NULL AND processed_at IS NULL;

COMMENT ON TABLE notifications_pending IS
  'Pending push notifications waiting to fire. The cron at /api/cron/notifications drains this every 15 min. Processed rows kept indefinitely for debug; processed_at IS NULL = not yet sent.';
