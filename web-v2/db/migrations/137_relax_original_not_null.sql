-- Migration 137 · relax NOT NULL on plan_workouts.original_* columns
-- ----------------------------------------------------------------------
-- The `original_*` columns capture the adapter's pre-mutation state ·
-- "what the workout looked like before the downgrade/shave". The
-- natural state for a never-adapted row is NULL across all four
-- columns. The natural state for an adapted-then-restored row is ALSO
-- NULL · the restore endpoint clears them after promoting the values
-- back into the active columns.
--
-- Three of the four columns were created NOT NULL · which made the
-- restore endpoint's clear-step trip on a constraint violation:
--   "null value in column \"original_date_iso\" violates not-null constraint"
--
-- Drop NOT NULL on all four columns. The "no original" state is the
-- common state · NULL is the natural sentinel.
--
-- No backfill needed · existing rows that already have values keep
-- them. Only future writes (insert without original_* set, restore
-- endpoint clearing) get the relaxed semantics.
--
-- Cite: designs/briefs/restore-original-date-iso-not-null-bug.md
-- ----------------------------------------------------------------------

ALTER TABLE plan_workouts
  ALTER COLUMN original_date_iso     DROP NOT NULL,
  ALTER COLUMN original_distance_mi  DROP NOT NULL,
  ALTER COLUMN original_type         DROP NOT NULL;

-- original_sub_label was already nullable per schema audit · skip.

COMMENT ON COLUMN plan_workouts.original_date_iso IS
  'Pre-mutation date the adapter saved before a reschedule. NULL when the row has never been adapted, or when restore cleared the audit. 2026-06-01: relaxed from NOT NULL.';
COMMENT ON COLUMN plan_workouts.original_distance_mi IS
  'Pre-mutation distance the adapter saved before a shave. NULL when never adapted or after restore.';
COMMENT ON COLUMN plan_workouts.original_type IS
  'Pre-mutation type the adapter saved before a downgrade. NULL when never adapted or after restore.';
