-- 109 — P38 plan adaptation tracking + index

ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS last_adapted_at TIMESTAMPTZ;
ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS adaptation_log  JSONB DEFAULT '[]'::jsonb;

-- Index for the "next quality day" query in adapt.ts
CREATE INDEX IF NOT EXISTS idx_plan_workouts_type_date
  ON plan_workouts (type, date_iso);
