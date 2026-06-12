-- 144_profile_weight_kg.sql
-- Settings consolidation (2026-06-12): a manual weight field.
-- Weight was the one profile metric with no column — it was read only from
-- HealthKit body_mass (lib/coach/run-state.ts calorie estimate). Settings
-- now lets the runner set it; NULL means "not set, fall back to HealthKit".
-- Idempotent: IF NOT EXISTS is safe to re-run.

ALTER TABLE profile ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(6,2);
