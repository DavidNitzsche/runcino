-- 150_plan_mutation_rejections.sql
-- The visibility half of the plan mutation boundary (lib/plan/mutate.ts).
--
-- A rejected adaptation that nobody ever sees is the same class of bug as an
-- unguarded write. When `mutatePlan` rolls a mutation back it lands a row here,
-- on a separate connection (the mutation's own transaction is gone by then), so
-- the refusal is a fact in the database rather than a line in a log that has
-- already rotated.
--
-- Rows are also written for the outcomes that are NOT refusals but are still
-- decisions someone should be able to audit:
--
--   'rejected'               a structural mutation introduced a doctrine
--                            violation; the transaction was rolled back.
--   'undeclared_structural'  a caller declared `derivations` (paces/spec/label
--                            only) but moved a structural field; rolled back.
--   'bypassed'               a caller used the marked escape hatch. `detail
--                            ->>'bypass_reason'` says why. Committed.
--   'authorship_drift'       a freshly PERSISTED plan carries a violation the
--                            in-memory validation did not see (persistPlan
--                            re-derives distances from the spec and overlays
--                            sealed days AFTER validateComposedPlan ran).
--                            Report-only — committed, because a rolled-back
--                            rebuild leaves the runner with no plan at all.
--   'no_plan'                a plan_workouts write with no resolvable owning
--                            plan; rolled back.
--
-- PURELY ADDITIVE and IDEMPOTENT. New table, new indexes, nothing dropped,
-- nothing renamed, no constraint on any existing row. Safe to re-run.
--
-- Apply with:
--   psql $DATABASE_URL -f web-v2/db/migrations/150_plan_mutation_rejections.sql

CREATE TABLE IF NOT EXISTS plan_mutation_rejections (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_uuid     UUID,
  plan_id       TEXT,
  -- Named write site, e.g. 'adapt/apply', 'api/plan/workout PATCH'.
  source        TEXT NOT NULL,
  outcome       TEXT NOT NULL,
  -- The violations THIS mutation introduced (or, for authorship_drift, the
  -- violations found in the persisted plan).
  violations    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The violations the plan already carried. Reported, never blocking — a
  -- mutation is refused for what it breaks, not for what it inherited.
  pre_existing  JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail        JSONB
);

CREATE INDEX IF NOT EXISTS plan_mutation_rejections_user_at_idx
  ON plan_mutation_rejections (user_uuid, at DESC);

CREATE INDEX IF NOT EXISTS plan_mutation_rejections_at_idx
  ON plan_mutation_rejections (at DESC);

CREATE INDEX IF NOT EXISTS plan_mutation_rejections_outcome_at_idx
  ON plan_mutation_rejections (outcome, at DESC);

COMMENT ON TABLE plan_mutation_rejections IS
  'Plan mutation boundary audit (lib/plan/mutate.ts). One row per refused or bypassed write to plan_workouts, plus authorship drift found by reading a freshly persisted plan back.';
