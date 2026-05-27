-- 112_strava_push.sql
-- P35 carryover + #161: full Strava push controls.
--
-- P35 added strava_auto_push (boolean). This migration:
--   - adds privacy + title-format preferences
--   - creates strava_pushes table for push history + retry tracking
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/112_strava_push.sql

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS strava_push_privacy     text DEFAULT 'private'
    CHECK (strava_push_privacy IN ('private', 'followers', 'public')),
  ADD COLUMN IF NOT EXISTS strava_push_title_format text DEFAULT 'type_phases';

-- One row per push attempt. Keeps history for the connection card's
-- "last 3 pushes" widget + lets us retry failed ones.
CREATE TABLE IF NOT EXISTS strava_pushes (
    id             bigserial PRIMARY KEY,
    user_uuid      uuid NOT NULL,
    run_id         text NOT NULL,           -- our run/activity id (strava_activities.id::text or data->>'id')
    status         text NOT NULL CHECK (status IN ('pending', 'uploaded', 'failed', 'duplicate')),
    strava_activity_id  bigint,             -- set when Strava finishes processing
    strava_upload_id    bigint,             -- intermediate id returned by /uploads
    title          text,
    privacy        text,
    attempt_count  int NOT NULL DEFAULT 1,
    error_message  text,
    pushed_at      timestamptz NOT NULL DEFAULT now(),
    completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS strava_pushes_user_idx ON strava_pushes (user_uuid, pushed_at DESC);
CREATE INDEX IF NOT EXISTS strava_pushes_run_idx ON strava_pushes (user_uuid, run_id);

COMMENT ON TABLE strava_pushes IS
  'One row per push attempt to Strava. Used for the connection card history widget + retry-on-failure flow.';
COMMENT ON COLUMN profile.strava_push_privacy IS
  'Default visibility for runs pushed to Strava. Per-push override possible via the manual push button.';
COMMENT ON COLUMN profile.strava_push_title_format IS
  'Template key for auto-generated titles. type_phases | tod_type_dist | custom.';
