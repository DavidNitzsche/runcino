-- 149_training_plans_mode_recovery.sql
-- Allow plan mode 'recovery' on training_plans.
--
-- pickPlanMode() (lib/plan/goal-tiers.ts) returns 'recovery' for a runner
-- inside the post-race recovery window (the mandatory Pfitzinger post-race
-- block). Until the round-2 fix (loadLastRaceFinished now derives the last
-- race's distance from its label via distanceMiOf instead of the rarely-
-- populated meta.distanceMi), recovery mode was UNREACHABLE in production —
-- so the original CHECK only ever needed the two modes that actually
-- occurred: 'race-prep' and 'maintenance'.
--
-- Now that recovery mode is reachable, a just-finished-race runner's plan
-- generation composes a valid recovery block, then the persist transaction
-- throws:
--   new row for relation "training_plans" violates check constraint
--   "training_plans_mode_check"
-- The whole rebuild transaction rolls back, so the runner is left with NO
-- plan (or stuck on the stale prior plan) instead of their recovery block.
-- Confirmed live on prod via scripts/_audit_r2_nonrace_live.mjs (all three
-- recovery cases failed to generate).
--
-- Fix: widen the allowed set to include 'recovery'. Purely ADDITIVE and
-- IDEMPOTENT — it permits one more value, invalidates no existing row, and
-- can be re-run safely (DROP ... IF EXISTS then ADD).
--
-- Apply with: node scripts/apply-149.mjs

ALTER TABLE training_plans
  DROP CONSTRAINT IF EXISTS training_plans_mode_check;

ALTER TABLE training_plans
  ADD CONSTRAINT training_plans_mode_check
  CHECK (mode = ANY (ARRAY['race-prep'::text, 'maintenance'::text, 'recovery'::text]));
