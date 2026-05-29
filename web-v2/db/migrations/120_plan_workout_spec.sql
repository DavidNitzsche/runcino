-- 120_plan_workout_spec.sql
-- Structured per-workout spec column on plan_workouts.
--
-- Phase 21 (run detail redesign) flagged a real gap: the WorkoutBreakdown
-- component on /runs/[id] and the Poster A3 breakdown rows on /today
-- WANT structured workout fields (pace targets, warmup/rep distances,
-- HR caps, fuel checkpoints) but plan_workouts only carried
-- type / distance_mi / sub_label / notes — every structured value was a
-- hardcoded placeholder in the glance-adapter.
--
-- This migration adds workout_spec JSONB · type-dependent shape · with the
-- existing label-only render preserved as fallback (null = use placeholder).
-- Daniels Running Formula §VDOT table and §pace-zone definitions are the
-- source of truth for all numeric targets emitted by the plan-builder.
--
-- Idempotent. Apply with:
--   node scripts/apply-120.mjs

ALTER TABLE plan_workouts
  ADD COLUMN IF NOT EXISTS workout_spec jsonb;

COMMENT ON COLUMN plan_workouts.workout_spec IS
  'Structured workout spec · type-dependent shape. v1 schema:
   easy/long:    { pace_target_s_per_mi_lo, pace_target_s_per_mi_hi, hr_cap_bpm, fuel_mi[] }
   threshold:    { warmup_mi, rep_count, rep_distance_m | rep_distance_mi, rep_pace_s_per_mi, rep_rest_s, cooldown_mi, lthr_bpm }
   tempo:        { warmup_mi, tempo_distance_mi, tempo_pace_s_per_mi, cooldown_mi, hr_target_bpm }
   intervals:    same as threshold
   fartlek:      { warmup_mi, segments: [{ pace_s_per_mi, duration_s }], cooldown_mi }
   progression:  { warmup_mi, prog_distance_mi, prog_start_s_per_mi, prog_end_s_per_mi, cooldown_mi, hr_cap_bpm }
   recovery:     { pace_target_s_per_mi_lo, pace_target_s_per_mi_hi, hr_cap_bpm }
   rest/cross/strength/shakeout: null (or {})
   Citations: Daniels Running Formula §VDOT table (E/M/T/I/R pace bands),
   Research/04-workout-vocabulary.md §5 (threshold) §6 (VO2max).';

CREATE INDEX IF NOT EXISTS plan_workouts_spec_gin_idx
  ON plan_workouts USING gin (workout_spec);
