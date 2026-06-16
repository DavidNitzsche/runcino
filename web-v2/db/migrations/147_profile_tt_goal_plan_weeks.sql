-- 147_profile_tt_goal_plan_weeks.sql
-- Goal plan length (2026-06-15): the SetGoalSheet lets the runner pick a plan
-- length (e.g. 10 or 14 weeks) alongside the goal distance + time. Persist it
-- so the goal-mode plan generator builds to that length instead of the fixed
-- maintenance window. NULL → fall back to the seeder's default. Idempotent.

ALTER TABLE profile ADD COLUMN IF NOT EXISTS tt_goal_plan_weeks INTEGER;
