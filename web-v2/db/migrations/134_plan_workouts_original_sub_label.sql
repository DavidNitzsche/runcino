-- Migration 134 · preserve sub_label across adapter downgrades
-- ----------------------------------------------------------------------
-- The atomic downgrade (lib/plan/adapt.ts) clears sub_label so the row
-- reads coherently as easy/recovery/rest. That was the right call ·
-- but the runner-facing surface wants to render "EASY · was CRUISE
-- INTERVALS" so we need the ORIGINAL sub_label preserved alongside
-- the existing original_type / original_distance_mi / original_date_iso
-- columns.
--
-- This migration:
--   1. Adds `original_sub_label TEXT` (nullable)
--   2. Backfills existing rows · where the row IS adapted (original_*
--      differs from current) and we don't have original_sub_label, we
--      derive a generic label from original_type so the "was X" subline
--      at least carries an honest type-name. Future downgrades capture
--      the actual sub_label via the adapter.
--
-- Per web agent brief designs/briefs/adaptation-visibility-backend-brief.md.
-- ----------------------------------------------------------------------

ALTER TABLE plan_workouts
  ADD COLUMN IF NOT EXISTS original_sub_label TEXT;

COMMENT ON COLUMN plan_workouts.original_sub_label IS
  'Sub-label as authored · preserved when the adapter downgrades and clears sub_label. Frontend renders "was CRUISE INTERVALS" sublines from this when wasAdapted is true. Null on as-authored rows.';

-- Backfill · existing rows that LOST their sub_label to a downgrade.
-- Detection · type IN (easy,recovery,rest) but original_type is quality
-- AND sub_label is null. Derive a generic display label from original_type
-- (we don't have the actual lost sub_label · this is the best we can
-- recover · post-adapter downgrades will capture the real sub_label).
UPDATE plan_workouts
   SET original_sub_label = CASE
     WHEN original_type = 'threshold' THEN 'THRESHOLD'
     WHEN original_type = 'tempo'     THEN 'TEMPO'
     WHEN original_type = 'intervals' THEN 'INTERVALS'
     WHEN original_type = 'vo2max'    THEN 'VO2 MAX'
     WHEN original_type = 'long'      THEN 'LONG RUN'
     WHEN original_type = 'race'      THEN 'RACE'
     WHEN original_type = 'race_week_tuneup' THEN 'RACE WEEK TUNE-UP'
     WHEN original_type = 'shakeout'  THEN 'SHAKEOUT'
     WHEN original_type = 'recovery'  THEN 'RECOVERY'
     WHEN original_type = 'easy'      THEN 'EASY'
     ELSE UPPER(original_type)
   END
 WHERE original_sub_label IS NULL
   AND original_type IS NOT NULL
   AND original_type <> type;
