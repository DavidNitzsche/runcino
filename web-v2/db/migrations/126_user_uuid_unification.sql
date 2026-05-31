-- 126_user_uuid_unification.sql
--
-- Schema unification · canonical per-user FK column is `user_uuid uuid
-- REFERENCES users(id)`. Several per-user tables key by `user_id` instead.
-- For 15 of them `user_id` is already typed `uuid` (storing the same uuid
-- value), and one (`coach_intent`, 0 rows, orphan) is `text`.
--
-- This migration adds `user_uuid uuid REFERENCES users(id)` to every per-user
-- table that lacks it, plus an index on user_uuid. `user_id` is intentionally
-- left in place for backward compat — readers + writers are migrated
-- separately and a follow-up migration can drop the legacy column once the
-- BOTH-column tables (training_plans, profile, etc.) have been on user_uuid
-- in prod long enough.
--
-- Backfill is run separately via scripts/_backfill_user_uuid.mjs after this
-- migration lands.
--
-- Tables addressed (16 total):
--   briefings, check_ins, coach_intent, coach_intents, coach_usage,
--   connector_tokens, day_actions, device_tokens, health_samples, niggles,
--   notifications_log, notifications_pending, sessions, sick_episodes,
--   workout_completions, workout_routes
--
-- Apply with: node scripts/apply-126.mjs

-- For every table below, ADD COLUMN IF NOT EXISTS guards re-runs. The
-- REFERENCES users(id) clause enforces the join contract going forward.
-- ON DELETE CASCADE is applied where the row is meaningless without the
-- user (per-user log/sample/session); BIG sessions table uses CASCADE too
-- so user deletion cleans up cleanly.

ALTER TABLE briefings              ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE check_ins              ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE coach_intent           ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE coach_intents          ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE coach_usage            ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE connector_tokens       ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE day_actions            ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE device_tokens          ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE health_samples         ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE niggles                ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notifications_log      ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notifications_pending  ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE sessions               ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE sick_episodes          ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE workout_completions    ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE workout_routes         ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;

-- Indexes on user_uuid for fast per-user scoping. All conditional so the
-- migration is idempotent.
CREATE INDEX IF NOT EXISTS briefings_user_uuid_idx              ON briefings              (user_uuid);
CREATE INDEX IF NOT EXISTS check_ins_user_uuid_idx              ON check_ins              (user_uuid);
CREATE INDEX IF NOT EXISTS coach_intent_user_uuid_idx           ON coach_intent           (user_uuid);
CREATE INDEX IF NOT EXISTS coach_intents_user_uuid_idx          ON coach_intents          (user_uuid);
CREATE INDEX IF NOT EXISTS coach_usage_user_uuid_idx            ON coach_usage            (user_uuid);
CREATE INDEX IF NOT EXISTS connector_tokens_user_uuid_idx       ON connector_tokens       (user_uuid);
CREATE INDEX IF NOT EXISTS day_actions_user_uuid_idx            ON day_actions            (user_uuid);
CREATE INDEX IF NOT EXISTS device_tokens_user_uuid_idx          ON device_tokens          (user_uuid);
CREATE INDEX IF NOT EXISTS health_samples_user_uuid_idx         ON health_samples         (user_uuid);
CREATE INDEX IF NOT EXISTS niggles_user_uuid_idx                ON niggles                (user_uuid);
CREATE INDEX IF NOT EXISTS notifications_log_user_uuid_idx      ON notifications_log      (user_uuid);
CREATE INDEX IF NOT EXISTS notifications_pending_user_uuid_idx  ON notifications_pending  (user_uuid);
CREATE INDEX IF NOT EXISTS sessions_user_uuid_idx               ON sessions               (user_uuid);
CREATE INDEX IF NOT EXISTS sick_episodes_user_uuid_idx          ON sick_episodes          (user_uuid);
CREATE INDEX IF NOT EXISTS workout_completions_user_uuid_idx    ON workout_completions    (user_uuid);
CREATE INDEX IF NOT EXISTS workout_routes_user_uuid_idx         ON workout_routes         (user_uuid);

-- Note · ON DELETE CASCADE on sessions makes session rows go away cleanly
-- when a user is deleted, matching the legacy user_id FK (which already had
-- CASCADE behavior via the auth flow). The other tables similarly cascade.

COMMENT ON COLUMN briefings.user_uuid             IS 'Canonical per-user FK. user_id retained for backward compat; new writes populate both, new reads scope by user_uuid.';
COMMENT ON COLUMN niggles.user_uuid               IS 'Canonical per-user FK. user_id (also uuid) retained for backward compat.';
COMMENT ON COLUMN coach_intent.user_uuid          IS 'Canonical per-user FK. user_id (legacy text) retained for backward compat; table is currently unused (0 rows).';
