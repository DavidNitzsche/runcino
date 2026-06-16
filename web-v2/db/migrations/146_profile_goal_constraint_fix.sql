-- 146_profile_goal_constraint_fix.sql
-- Two fixes for the fitness-goal save path:
--
-- 1. Ensure tt_goal_time_seconds exists (migration 145 had no apply script).
-- 2. Widen the tt_goal_distance check constraint to accept the full
--    distance-label set used by /api/profile/goal.  Migration 118 constrained
--    it to ('1mi','5k','10k') — the new endpoint sends 'Half Marathon',
--    'Marathon', '50K', '100K' etc., causing every save to fail with a
--    constraint violation.
--
-- Idempotent. Apply with: node scripts/apply-146.mjs

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS tt_goal_time_seconds INTEGER;

ALTER TABLE profile
  DROP CONSTRAINT IF EXISTS profile_tt_goal_distance_check;

ALTER TABLE profile
  ADD CONSTRAINT profile_tt_goal_distance_check
  CHECK (
    tt_goal_distance IS NULL OR tt_goal_distance IN (
      '1mi', '5k', '10k',
      '5K', '10K', 'Half Marathon', 'Marathon', '50K', '100K'
    )
  );
