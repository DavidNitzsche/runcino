-- ═════════════════════════════════════════════════════════════════
-- 003_link_user_id.sql — add user_uuid FK to all existing tables
--
-- Adds a nullable user_uuid UUID column referencing users(id) to every
-- existing user-scoped table. Existing rows keep their legacy
-- user_id TEXT = 'me' value. This migration is purely additive.
--
-- Cutover sequence:
--   1. Apply this migration (adds columns, no data change).
--   2. User signs up via new auth flow → creates a `users` row.
--   3. Run backfill SQL at the bottom of this file (commented out)
--      ONCE, supplying the new user's UUID, to populate user_uuid
--      across all the legacy 'me' rows.
--   4. After verification, apply 004 to enforce NOT NULL + drop the
--      legacy `user_id TEXT` columns.
-- ═════════════════════════════════════════════════════════════════

-- Daily check-ins (energy / soreness / stress)
ALTER TABLE daily_checkin
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- Personal goals
ALTER TABLE personal_goals
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- Profile (single row per user)
ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- User prefs (training preferences)
ALTER TABLE user_prefs
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- Training plans
ALTER TABLE training_plans
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- Skipped workouts
ALTER TABLE skipped_workouts
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- Shoes (currently no user_id; SERIAL PK only). Add the user_uuid FK.
ALTER TABLE shoes
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- Recovery sessions
ALTER TABLE recovery_sessions
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- Strava activities → migrate to per-user via connector_tokens linkage.
-- Activities themselves get user_uuid directly for fast queries.
ALTER TABLE strava_activities
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- Races (the per-race plan artifacts, slug-PK'd)
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS user_uuid UUID REFERENCES users(id) ON DELETE CASCADE;

-- Indexes on the new user_uuid columns where query patterns demand it.
CREATE INDEX IF NOT EXISTS idx_daily_checkin_user_uuid_date
  ON daily_checkin (user_uuid, date DESC);
CREATE INDEX IF NOT EXISTS idx_personal_goals_user_uuid
  ON personal_goals (user_uuid);
CREATE INDEX IF NOT EXISTS idx_user_prefs_user_uuid
  ON user_prefs (user_uuid);
CREATE INDEX IF NOT EXISTS idx_training_plans_user_uuid_active
  ON training_plans (user_uuid)
  WHERE archived_iso IS NULL;
CREATE INDEX IF NOT EXISTS idx_skipped_workouts_user_uuid_date
  ON skipped_workouts (user_uuid, date DESC);
CREATE INDEX IF NOT EXISTS idx_shoes_user_uuid
  ON shoes (user_uuid)
  WHERE retired = FALSE;
CREATE INDEX IF NOT EXISTS idx_recovery_sessions_user_uuid_date
  ON recovery_sessions (user_uuid, date DESC);
CREATE INDEX IF NOT EXISTS idx_strava_activities_user_uuid
  ON strava_activities (user_uuid);

-- ═════════════════════════════════════════════════════════════════
-- BACKFILL TEMPLATE — run ONCE after the first user signs up.
-- Uncomment, set the UUID, and execute. This claims every existing
-- single-user row for that account.
-- ═════════════════════════════════════════════════════════════════

-- -- Look up the user UUID
-- SELECT id, email FROM users WHERE email = 'david@example.com';
--
-- -- Set this to the UUID above (use a transaction so we can rollback if any
-- -- of these fail).
-- BEGIN;
-- DO $$
-- DECLARE
--   target_uuid UUID := 'PUT-THE-UUID-HERE'::UUID;
-- BEGIN
--   UPDATE daily_checkin       SET user_uuid = target_uuid WHERE user_id = 'me' AND user_uuid IS NULL;
--   UPDATE personal_goals      SET user_uuid = target_uuid WHERE user_id = 'me' AND user_uuid IS NULL;
--   UPDATE profile             SET user_uuid = target_uuid WHERE user_id = 'me' AND user_uuid IS NULL;
--   UPDATE user_prefs          SET user_uuid = target_uuid WHERE user_id = 'me' AND user_uuid IS NULL;
--   UPDATE training_plans      SET user_uuid = target_uuid WHERE user_id = 'me' AND user_uuid IS NULL;
--   UPDATE skipped_workouts    SET user_uuid = target_uuid WHERE user_id = 'me' AND user_uuid IS NULL;
--   UPDATE recovery_sessions   SET user_uuid = target_uuid WHERE user_uuid IS NULL;
--   UPDATE shoes               SET user_uuid = target_uuid WHERE user_uuid IS NULL;
--   UPDATE strava_activities   SET user_uuid = target_uuid WHERE user_uuid IS NULL;
--   UPDATE races               SET user_uuid = target_uuid WHERE user_uuid IS NULL;
-- END $$;
--
-- -- Verify every row has user_uuid set:
-- SELECT 'daily_checkin' AS tbl, COUNT(*) AS missing FROM daily_checkin WHERE user_uuid IS NULL
-- UNION ALL SELECT 'personal_goals',    COUNT(*) FROM personal_goals    WHERE user_uuid IS NULL
-- UNION ALL SELECT 'profile',           COUNT(*) FROM profile           WHERE user_uuid IS NULL
-- UNION ALL SELECT 'user_prefs',        COUNT(*) FROM user_prefs        WHERE user_uuid IS NULL
-- UNION ALL SELECT 'training_plans',    COUNT(*) FROM training_plans    WHERE user_uuid IS NULL
-- UNION ALL SELECT 'skipped_workouts',  COUNT(*) FROM skipped_workouts  WHERE user_uuid IS NULL
-- UNION ALL SELECT 'recovery_sessions', COUNT(*) FROM recovery_sessions WHERE user_uuid IS NULL
-- UNION ALL SELECT 'shoes',             COUNT(*) FROM shoes             WHERE user_uuid IS NULL
-- UNION ALL SELECT 'strava_activities', COUNT(*) FROM strava_activities WHERE user_uuid IS NULL
-- UNION ALL SELECT 'races',             COUNT(*) FROM races             WHERE user_uuid IS NULL;
--
-- -- All zeros? Commit. Any non-zero? Rollback and investigate.
-- -- COMMIT;
-- -- ROLLBACK;
