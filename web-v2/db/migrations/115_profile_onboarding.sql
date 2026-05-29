-- 115_profile_onboarding.sql
-- Lilian onboarding (locked 2026-05-28 · docs/2026-05-28-onboarding-lilian.html).
-- Five-screen flow lands its answers on profile when the runner taps
-- "Start training". This migration adds the columns that get filled.
--
-- Columns:
--   - goal_race_distance  (5k | 10k | half | marathon | none)
--   - goal_race_date      (DATE, NULL when "No specific race")
--   - goal_race_time      (TEXT 'HH:MM:SS', NULL when not provided)
--   - timezone            (TEXT, IANA tz like 'America/Los_Angeles')
--   - onboarding_completed_at (TIMESTAMPTZ, stamp at "Start training")
--   - connections_skipped (BOOL, true when step 2 was bypassed)
--
-- `full_name` already exists on profile (set in migration 106 era / earlier);
-- onboarding edits it via the existing /api/profile PATCH handler.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS. Apply with:
--   node scripts/apply-115.mjs

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS goal_race_distance       TEXT
    CHECK (goal_race_distance IS NULL OR goal_race_distance IN
      ('5k', '10k', 'half', 'marathon', 'none')),
  ADD COLUMN IF NOT EXISTS goal_race_date           DATE,
  ADD COLUMN IF NOT EXISTS goal_race_time           TEXT,
  ADD COLUMN IF NOT EXISTS timezone                 TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS connections_skipped      BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profile.goal_race_distance IS
  'Lilian onboarding step 1 · target race distance (or none).';
COMMENT ON COLUMN profile.goal_race_date IS
  'Lilian onboarding step 1 · race anchor date for plan generation.';
COMMENT ON COLUMN profile.goal_race_time IS
  'Lilian onboarding step 1 · optional goal time (HH:MM:SS); biases VDOT.';
COMMENT ON COLUMN profile.timezone IS
  'IANA tz from step 3 (auto-detected via Intl, runner-editable).';
COMMENT ON COLUMN profile.onboarding_completed_at IS
  'Set when the runner taps "Start training" on step 3.';
COMMENT ON COLUMN profile.connections_skipped IS
  'TRUE when runner used "Skip for now" on step 2 (signals).';
