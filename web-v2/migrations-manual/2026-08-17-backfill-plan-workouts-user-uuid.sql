-- 2026-08-17-backfill-plan-workouts-user-uuid.sql
--
-- One-shot backfill · plan_workouts.user_uuid (+ the sibling plan-chain
-- tables while we are here). Companion to the code fix that makes all four
-- INSERT sites stamp user_uuid going forward:
--   lib/plan/generate.ts            (persistPlan batch insert)
--   lib/plan/seed-from-onboarding.ts (persistMaintenancePlan)
--   lib/plan/injury-builder.ts       (buildInjuryPlan)
--   app/api/today/reschedule/route.ts (rest-placeholder insert)
--
-- Context: migration 143 added the denormalized user_uuid column and
-- backfilled once (2026-06-10), but the writers were never taught to stamp
-- it (143's "Phase 2"). Every row inserted since is NULL — 112,496 of
-- 116,372 at audit time (2026-08-17). Safe today only because every reader
-- joins through training_plans; this makes ownership structural again.
--
-- DAVID-GATED. Do not run without explicit per-statement go
-- (deployment doctrine: DDL / data writes need a separate explicit go).
--
-- Pre-flight count check (run first, note the number):
--   SELECT COUNT(*) AS null_before FROM plan_workouts WHERE user_uuid IS NULL;
-- Post-run check (expect 0 — every plan_workouts row has a parent plan;
-- if nonzero, the residue is orphaned rows whose plan_id no longer exists
-- in training_plans, which is its own finding):
--   SELECT COUNT(*) AS null_after FROM plan_workouts WHERE user_uuid IS NULL;

BEGIN;

-- workout_spec_required is NOT VALID, but Postgres still enforces NOT VALID
-- checks on UPDATEs of existing rows — backfilling legacy spec-less running
-- days would re-fail the check. Same drop + identical re-add dance as
-- migration 143: net schema delta is zero, constraint stays NOT VALID.
ALTER TABLE plan_workouts DROP CONSTRAINT workout_spec_required;

UPDATE plan_workouts pw
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE pw.plan_id = t.id
   AND pw.user_uuid IS NULL;

ALTER TABLE plan_workouts ADD CONSTRAINT workout_spec_required
  CHECK (type = ANY (ARRAY['rest'::text,'cross'::text,'strength'::text]) OR workout_spec IS NOT NULL)
  NOT VALID;

-- Sibling plan-chain tables drifted the same way since 143's one-shot.
UPDATE plan_phases p
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE p.plan_id = t.id AND p.user_uuid IS NULL;

UPDATE plan_weeks w
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE w.plan_id = t.id AND w.user_uuid IS NULL;

UPDATE plan_mutations m
   SET user_uuid = pw.user_uuid
  FROM plan_workouts pw
 WHERE m.workout_id = pw.id AND m.user_uuid IS NULL;

COMMIT;

-- Deliberately NOT setting NOT NULL yet: do that in a later pass after a
-- week of stamped inserts confirms zero new NULLs (and after deciding what
-- to do with any orphaned rows the post-run check surfaces).
