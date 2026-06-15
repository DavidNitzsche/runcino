-- 145_profile_tt_goal_time_seconds.sql
-- Goal-time precision (2026-06-15): the EXACT goal time in seconds, alongside
-- the existing tt_goal_distance / tt_goal_time (bucket) columns. The bucket
-- midpoint skewed the goal-readiness projection ~4% (a 26:00 5K lands in the
-- "25-28" bucket → midpoint ~26:30). One source of truth: onboarding and the
-- /api/profile/goal edit route both write this column; goal-ready reads it,
-- falling back to the bucket midpoint when NULL (older clients / pre-migration
-- rows). Idempotent: IF NOT EXISTS is safe to re-run.

ALTER TABLE profile ADD COLUMN IF NOT EXISTS tt_goal_time_seconds INTEGER;
