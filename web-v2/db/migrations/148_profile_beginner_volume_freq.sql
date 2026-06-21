-- 148_profile_beginner_volume_freq.sql
--
-- True-beginner support (David 2026-06-20). The app-level validation and the
-- plan engine now accept 0/5 mi weekly and 0/1/2 days a week, but the DB CHECK
-- constraints still only allowed 15/25/35/45/55 and 3-6 — so onboarding HARD-
-- FAILED (profile insert violated the check) for any runner below 15 mi/week or
-- below 3 days/week. Widen both constraints to match.
--
-- Purely additive: every previously-valid value (15-55, 3-6) stays valid, and
-- no existing row violates the wider constraint, so no data migration is needed.

ALTER TABLE profile DROP CONSTRAINT IF EXISTS profile_weekly_mileage_target_check;
ALTER TABLE profile ADD CONSTRAINT profile_weekly_mileage_target_check
  CHECK (weekly_mileage_target IS NULL
         OR weekly_mileage_target = ANY (ARRAY[0, 5, 15, 25, 35, 45, 55]));

ALTER TABLE profile DROP CONSTRAINT IF EXISTS profile_weekly_frequency_check;
ALTER TABLE profile ADD CONSTRAINT profile_weekly_frequency_check
  CHECK (weekly_frequency IS NULL
         OR (weekly_frequency >= 0 AND weekly_frequency <= 6));
