-- ═════════════════════════════════════════════════════════════════
-- 004_drop_legacy_text_user_id.sql — final cutover
--
-- ONLY apply this AFTER 003's backfill is complete and every row in
-- every user-scoped table has a non-null user_uuid value.
--
-- This migration:
--   1. Drops the legacy `user_id TEXT` columns (the 'me' single-user pattern).
--   2. Enforces NOT NULL on `user_uuid`.
--   3. Drops the legacy indexes on `user_id` text columns.
--
-- Reversible only via restore-from-backup. Take a snapshot first.
-- ═════════════════════════════════════════════════════════════════

-- Sanity guard: refuse to run if any user_uuid is still null.
-- Wraps everything in a DO block so we can abort cleanly.
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM daily_checkin       WHERE user_uuid IS NULL) +
    (SELECT COUNT(*) FROM personal_goals      WHERE user_uuid IS NULL) +
    (SELECT COUNT(*) FROM profile             WHERE user_uuid IS NULL) +
    (SELECT COUNT(*) FROM user_prefs          WHERE user_uuid IS NULL) +
    (SELECT COUNT(*) FROM training_plans      WHERE user_uuid IS NULL) +
    (SELECT COUNT(*) FROM skipped_workouts    WHERE user_uuid IS NULL) +
    (SELECT COUNT(*) FROM recovery_sessions   WHERE user_uuid IS NULL) +
    (SELECT COUNT(*) FROM shoes               WHERE user_uuid IS NULL) +
    (SELECT COUNT(*) FROM strava_activities   WHERE user_uuid IS NULL) +
    (SELECT COUNT(*) FROM races               WHERE user_uuid IS NULL)
    INTO missing_count;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Refusing to drop legacy user_id: % rows still have NULL user_uuid. Run the 003 backfill first.', missing_count;
  END IF;
END $$;

-- Enforce NOT NULL on every user_uuid column
ALTER TABLE daily_checkin       ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE personal_goals      ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE profile             ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE user_prefs          ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE training_plans      ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE skipped_workouts    ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE recovery_sessions   ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE shoes               ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE strava_activities   ALTER COLUMN user_uuid SET NOT NULL;
ALTER TABLE races               ALTER COLUMN user_uuid SET NOT NULL;

-- Drop legacy text user_id columns.
-- For tables where user_id was part of a UNIQUE constraint with date,
-- we need to add the new (user_uuid, date) unique constraint first.
ALTER TABLE daily_checkin       DROP CONSTRAINT IF EXISTS daily_checkin_user_id_date_key;
ALTER TABLE daily_checkin       ADD CONSTRAINT daily_checkin_user_uuid_date_key UNIQUE (user_uuid, date);
ALTER TABLE daily_checkin       DROP COLUMN IF EXISTS user_id;

ALTER TABLE skipped_workouts    DROP CONSTRAINT IF EXISTS skipped_workouts_user_id_date_key;
ALTER TABLE skipped_workouts    ADD CONSTRAINT skipped_workouts_user_uuid_date_key UNIQUE (user_uuid, date);
ALTER TABLE skipped_workouts    DROP COLUMN IF EXISTS user_id;

ALTER TABLE personal_goals      DROP COLUMN IF EXISTS user_id;
ALTER TABLE user_prefs          DROP COLUMN IF EXISTS user_id;
ALTER TABLE training_plans      DROP COLUMN IF EXISTS user_id;

-- Profile uses user_id as its PK currently — replace with user_uuid.
ALTER TABLE profile             DROP CONSTRAINT IF EXISTS profile_pkey;
ALTER TABLE profile             DROP COLUMN IF EXISTS user_id;
ALTER TABLE profile             ADD PRIMARY KEY (user_uuid);

-- Drop legacy single-user indexes that referenced user_id
DROP INDEX IF EXISTS personal_goals_user_idx;
DROP INDEX IF EXISTS daily_checkin_user_date_idx;
DROP INDEX IF EXISTS skipped_workouts_by_date;
DROP INDEX IF EXISTS training_plans_active;

-- Replace with user_uuid-keyed equivalents
CREATE INDEX IF NOT EXISTS idx_personal_goals_by_uuid
  ON personal_goals (user_uuid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_plans_by_uuid_active
  ON training_plans (user_uuid)
  WHERE archived_iso IS NULL;
