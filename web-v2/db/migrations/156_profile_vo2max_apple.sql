-- 156 — profile.vo2max_apple (+ updated_at)
--
-- Formalizes two columns that ALREADY EXIST in prod (added by hand, no
-- migration file, no writer — verified 2026-08-28: present on Railway,
-- NULL for every runner, zero code references). The nightly
-- /api/cron/max-hr-ratchet refresh (lib/training/biometrics-refresh.ts)
-- now writes them: the latest Apple Watch vo2_max sample from
-- health_samples, and when it was recorded.
--
-- DISPLAY / REFERENCE ONLY. Race-evidence VDOT (lib/training/vdot-inputs.ts)
-- stays the pace source of truth; nothing in pace resolution reads this.
--
-- Additive · idempotent · safe to re-run (no-op where the hand-added
-- columns already exist).

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS vo2max_apple            NUMERIC,
  ADD COLUMN IF NOT EXISTS vo2max_apple_updated_at TIMESTAMPTZ;
