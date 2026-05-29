-- 119_strava_webhook.sql
-- Strava Push API subscription state + inbound event log.
--
-- Strava lets us register ONE webhook subscription per app (client_id).
-- When a user creates/updates/deletes an activity OR deauthorizes the
-- app, Strava POSTs to our callback URL. This moves us from poll-based
-- sync (next-page-load) to event-based (seconds after a run finishes).
--
-- TWO TABLES:
--   strava_webhook_subscriptions — one row, our active subscription id
--     + the random verify_token we minted at subscribe time. The token
--     is what Strava's GET handshake echoes back; we MUST validate it.
--
--   strava_webhook_events — every POSTed event lands here first, then
--     a processor (in-line during the POST handler for v1) fetches the
--     activity + upserts into strava_activities. The row records
--     processed_at + process_status so failed events can be replayed.
--
-- Idempotent. Apply with:
--   node scripts/apply-119.mjs

CREATE TABLE IF NOT EXISTS strava_webhook_subscriptions (
  id              bigserial PRIMARY KEY,
  subscription_id int NOT NULL UNIQUE,       -- Strava's id (returned from POST /push_subscriptions)
  callback_url    text NOT NULL,
  verify_token    text NOT NULL,             -- random per-create, validated on handshake
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_event_at   timestamptz,
  events_received int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS strava_webhook_events (
  id              bigserial PRIMARY KEY,
  subscription_id int NOT NULL,
  aspect_type     text NOT NULL,              -- 'create' | 'update' | 'delete'
  object_type     text NOT NULL,              -- 'activity' | 'athlete'
  object_id       bigint NOT NULL,
  owner_id        bigint NOT NULL,            -- Strava athlete_id; used to map → user_uuid
  updates         jsonb,                      -- present on update events; { authorized: 'false' } on athlete deauth
  event_time      bigint NOT NULL,            -- unix ts from Strava payload
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  process_status  text                        -- 'pending' | 'ok' | 'skipped' | 'error'
);

CREATE INDEX IF NOT EXISTS strava_webhook_events_unprocessed_idx
  ON strava_webhook_events (received_at) WHERE processed_at IS NULL;

COMMENT ON TABLE strava_webhook_subscriptions IS
  'Active Strava Push API subscription. One row (Strava enforces one subscription per app).';
COMMENT ON TABLE strava_webhook_events IS
  'Inbound Strava webhook event log. Processed inline; processed_at IS NULL = pending or in-flight.';
COMMENT ON COLUMN strava_webhook_subscriptions.verify_token IS
  '32+ bytes random, validated on Strava GET handshake. Rotate by unsubscribe → subscribe.';
COMMENT ON COLUMN strava_webhook_events.owner_id IS
  'Strava athlete_id; map to user_uuid via connector_tokens.provider_user_id (or legacy profile.strava_athlete_id).';
