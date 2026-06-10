-- 143_plan_chain_user_uuid.sql · 2026-06-10
--
-- Multi-user hardening. The plan detail chain (plan_phases / plan_weeks /
-- plan_workouts / plan_mutations) carried NO user column — the only four
-- per-user-data tables in the schema without one. Isolation depended on
-- every query joining through training_plans.user_uuid (app-layer
-- discipline, ~4,600 rows exposed to one missed join).
--
-- This adds a denormalized user_uuid, backfills it from the owning plan,
-- and indexes it. Existing app code keeps working unchanged — the
-- plan_id-join pattern stays valid; this makes ownership structural.
--
-- Phase 2 (separate, later): teach the writers (lib/plan/generate.ts,
-- lib/plan/seed-from-onboarding.ts, adaptation writers) to stamp
-- user_uuid on INSERT, re-run the backfill, then SET NOT NULL. Until
-- then new rows may have NULL user_uuid — queries must keep the
-- plan_id join, treating user_uuid as a defense-in-depth column.
--
-- NOT auto-run: Railway's build does not execute migrations. Apply
-- manually with David's per-statement go (deployment doctrine).

BEGIN;

ALTER TABLE plan_phases    ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE plan_weeks     ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE plan_workouts  ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE plan_mutations ADD COLUMN IF NOT EXISTS user_uuid uuid REFERENCES users(id) ON DELETE CASCADE;

-- Backfill from the owning plan.
UPDATE plan_phases p
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE p.plan_id = t.id AND p.user_uuid IS NULL;

UPDATE plan_weeks w
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE w.plan_id = t.id AND w.user_uuid IS NULL;

-- workout_spec_required is NOT VALID, but Postgres still enforces
-- NOT VALID checks on UPDATEs of existing rows — so backfilling
-- legacy pre-constraint rows (spec-less running days) re-fails the
-- check. Drop + re-add the identical constraint around the backfill:
-- net schema delta is zero, and it stays NOT VALID (unvalidated
-- against legacy rows) exactly as before.
ALTER TABLE plan_workouts DROP CONSTRAINT workout_spec_required;

UPDATE plan_workouts pw
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE pw.plan_id = t.id AND pw.user_uuid IS NULL;

ALTER TABLE plan_workouts ADD CONSTRAINT workout_spec_required
  CHECK (type = ANY (ARRAY['rest'::text,'cross'::text,'strength'::text]) OR workout_spec IS NOT NULL)
  NOT VALID;

-- plan_mutations hangs off plan_workouts, not training_plans directly.
UPDATE plan_mutations m
   SET user_uuid = pw.user_uuid
  FROM plan_workouts pw
 WHERE m.workout_id = pw.id AND m.user_uuid IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_phases_user    ON plan_phases (user_uuid);
CREATE INDEX IF NOT EXISTS idx_plan_weeks_user     ON plan_weeks (user_uuid);
CREATE INDEX IF NOT EXISTS idx_plan_workouts_user  ON plan_workouts (user_uuid, date_iso);
CREATE INDEX IF NOT EXISTS idx_plan_mutations_user ON plan_mutations (user_uuid);

COMMIT;
