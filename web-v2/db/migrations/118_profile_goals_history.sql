-- 118_profile_goals_history.sql
-- Extends the Lilian onboarding (migration 115) for the "No specific race"
-- path. When the runner picks "No specific race" in Step 1 we route them to
-- a new Step 1b · goal-details screen that captures:
--
--   A. Optional time-trial goal     (distance + bucketed time range)
--   B. Required weekly target       (mileage chip + frequency chip)
--   C. Required running history     (avg weekly mi / longest recent run /
--                                    years running) — or pre-filled from
--                                    Strava when connected
--
-- All values land here as TEXT/INT chip values (caps-tracked Inter
-- ladders, never free text — per the user mandate).
--
-- Plan-gen handoff: these feed the maintenance-mode buildPlan() inputs
-- when there's no race anchor. See
-- /api/onboarding/complete/route.ts for the documented mapping.
--
-- Idempotent. Apply with:
--   node scripts/apply-118.mjs

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS tt_goal_distance         TEXT
    CHECK (tt_goal_distance IS NULL OR tt_goal_distance IN
      ('1mi', '5k', '10k')),
  ADD COLUMN IF NOT EXISTS tt_goal_time             TEXT,
  ADD COLUMN IF NOT EXISTS weekly_mileage_target    INT
    CHECK (weekly_mileage_target IS NULL OR weekly_mileage_target IN
      (15, 25, 35, 45, 55)),
  ADD COLUMN IF NOT EXISTS weekly_frequency         INT
    CHECK (weekly_frequency IS NULL OR weekly_frequency BETWEEN 3 AND 6),
  ADD COLUMN IF NOT EXISTS history_avg_weekly_mi    INT,
  ADD COLUMN IF NOT EXISTS history_longest_recent_mi INT,
  ADD COLUMN IF NOT EXISTS history_years_running    TEXT
    CHECK (history_years_running IS NULL OR history_years_running IN
      ('<1', '1-3', '3-7', '7+'));

COMMENT ON COLUMN profile.tt_goal_distance IS
  'Step 1b · optional time-trial distance for no-race plan (1mi|5k|10k).';
COMMENT ON COLUMN profile.tt_goal_time IS
  'Step 1b · bucketed time range chip value (e.g. "22-25", "Under 5:00").';
COMMENT ON COLUMN profile.weekly_mileage_target IS
  'Step 1b · target weekly mileage chip (15|25|35|45|55).';
COMMENT ON COLUMN profile.weekly_frequency IS
  'Step 1b · days per week the runner wants to run (3..6).';
COMMENT ON COLUMN profile.history_avg_weekly_mi IS
  'Step 1b · runner-reported avg weekly mi over last 4 wks (chip midpoint);
   bypassed when Strava is connected (computed live there).';
COMMENT ON COLUMN profile.history_longest_recent_mi IS
  'Step 1b · longest recent run in miles (chip midpoint).';
COMMENT ON COLUMN profile.history_years_running IS
  'Step 1b · years running bucket (<1|1-3|3-7|7+).';
