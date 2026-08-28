-- 157_coach_intents_superseded.sql
-- Symmetric supersede for coach_intents when a plan is archived/replaced.
--
-- plan_proposals got this on 2026-08-27 (supersedeProposalsForArchivedPlans):
-- a pending proposal pointing at an archived plan is stamped 'superseded' so
-- it stops surfacing as a live decision. coach_intents rows have the same
-- dangling-provenance problem — their `field` column holds a plan_workouts.id,
-- and when the plan is archived those rows keep pointing at workouts no
-- surface renders, while pending ones (acknowledged_at IS NULL) keep feeding
-- the briefing voice changes made to a plan that no longer exists.
--
-- Additive only: one nullable column. Mark, don't delete — the intent rows
-- are the adapter's audit trail and several detectors read them by reason+ts
-- as idempotency markers; those reads are unaffected by this stamp.
--
-- Writer: lib/plan/proposals-state.ts supersedeIntentsForArchivedPlans,
-- swept nightly per-user by the plan-drift cron (best-effort, catch-guarded,
-- so this column landing after the code deploy costs one logged failure per
-- night, not an outage).
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/157_coach_intents_superseded.sql
-- REVERSED BY: ALTER TABLE coach_intents DROP COLUMN IF EXISTS superseded_at;

ALTER TABLE coach_intents ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

COMMENT ON COLUMN coach_intents.superseded_at IS
  'Stamped when the plan this intent''s field (a plan_workouts.id) belonged to was archived/replaced. The row stays as audit trail; a non-null value means the workout it points at is no longer part of the active plan.';
