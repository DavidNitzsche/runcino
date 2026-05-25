-- 106 — profile schema additions
--
-- Adds:
--   - birthday (DATE, ISO) — replaces static `age` (auto-updates as runner ages)
--   - lthr (INT bpm) — Friel LTHR, primary zone anchor (Research/03 §6)
--   - hrmax_observed (INT bpm) — user-entered or derived max HR, supersedes
--     legacy `hrmax` which was a derived/observed mix
--   - experience_level (TEXT) — beginner/intermediate/advanced/advanced_plus
--     drives max weekly mileage cap in plan generation
--   - lthr_method (TEXT) — how it was set (manual/half_marathon/marathon/test)
--   - lthr_set_at (TIMESTAMPTZ) — when last updated; re-test every 6-12 weeks
--
-- Idempotent — safe to re-run.

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS birthday          DATE,
  ADD COLUMN IF NOT EXISTS lthr              INTEGER,
  ADD COLUMN IF NOT EXISTS hrmax_observed    INTEGER,
  ADD COLUMN IF NOT EXISTS experience_level  TEXT
    CHECK (experience_level IS NULL OR experience_level IN
      ('beginner','intermediate','advanced','advanced_plus')),
  ADD COLUMN IF NOT EXISTS lthr_method       TEXT,
  ADD COLUMN IF NOT EXISTS lthr_set_at       TIMESTAMPTZ;

-- Backfill: if `age` is set but `birthday` is null, set birthday to Jan 1 of
-- (current_year - age) as a placeholder. User will correct in profile.
UPDATE profile
   SET birthday = make_date(EXTRACT(YEAR FROM NOW())::int - age, 1, 1)
 WHERE birthday IS NULL AND age IS NOT NULL;
