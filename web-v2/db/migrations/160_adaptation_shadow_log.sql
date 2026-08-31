-- 160_adaptation_shadow_log.sql
-- Adaptation Engine · PACE-only shadow-compare persistence.
--
-- PROPOSED — NOT RUN. Authorized by docs/PRODUCT_DECISIONS.md 2026-09-01 §2
-- ("Persists proposed before/after values and reasons"). Per CLAUDE.md's DDL
-- rule, this migration requires David's explicit per-statement go before
-- execution and has NOT been applied. See
-- docs/reports/pace-shadow-compare-2026-09-01.md §2 for why no existing
-- table was a safe additive-only home:
--
--   · plan_proposals / plan_workout_proposals · LIVE, actionable proposal
--     pipelines with real accept/apply consumers (goal_gap_cron's
--     'goal_outlook' pending rows literally drive the goal-decision card).
--     A shadow row with status='pending' risks being read by a consumer
--     that filters on status alone rather than on a known proposal_kind.
--   · coach_intents · the historical MUTATION-ONLY audit log CLAUDE.md
--     Rule 21 measures ("zero upward adaptations across 309 rows") to judge
--     whether the live engine ever pushes. Writing non-mutating shadow rows
--     here would corrupt that exact measurement.
--   · training_plans.adaptation_log · Rule 6 (multi-writer jsonb) risk: the
--     live adapt.ts pass is the existing writer of this column's
--     {"n":..,"ts":..} shape; a second writer with a different shape on
--     the same column, with no field-level merge, is the exact defect Rule
--     6 exists to catch.
--
-- A dedicated table avoids all three: it has no consumer but this
-- mechanism, and it is additive-only — CREATE TABLE, no ALTER on any
-- existing table.
--
-- One row per adaptation cycle per runner, PACE lever only (per the
-- authorization). `engine_previous`/`engine_proposed` are jsonb `PaceMagnitude`
-- shapes; `phase_breakdown` is the full `PacePhaseOutcome[]` array (Part 1 of
-- the 2026-09-01 decision — never a blended average). `live_*` fields record
-- what lib/plan/adapt.ts's live, mutating detectors did in the SAME cycle, so
-- a later query can compute the agreement/disagreement rate without
-- re-running both engines.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/160_adaptation_shadow_log.sql
-- REVERSED BY: DROP TABLE IF EXISTS adaptation_shadow_log;

CREATE TABLE IF NOT EXISTS adaptation_shadow_log (
  id                  bigserial PRIMARY KEY,
  user_uuid           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  today_iso           date NOT NULL,
  resolved_at         timestamptz NOT NULL DEFAULT now(),
  model_version       text NOT NULL,
  -- The new engine's PACE proposal for this cycle.
  engine_decision      text NOT NULL,   -- AdaptationDecision
  engine_reason_codes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine_explanation   text,
  engine_previous      jsonb,           -- PaceMagnitude | null
  engine_proposed      jsonb,           -- PaceMagnitude | null
  engine_confidence    double precision,
  phase_breakdown      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- PacePhaseOutcome[]
  engine_refusals      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What the live, mutating engine (lib/plan/adapt.ts) did the SAME cycle.
  live_training_lead_fired  boolean NOT NULL DEFAULT false,
  live_recompute_paces_fired boolean NOT NULL DEFAULT false,
  live_reason          text,
  -- The comparison, precomputed so a dashboard query never re-derives it.
  agrees_with_live     boolean,
  source               text NOT NULL DEFAULT 'cron_run_adaptations_shadow'
);

CREATE INDEX IF NOT EXISTS adaptation_shadow_log_user_date_idx
  ON adaptation_shadow_log (user_uuid, today_iso);

COMMENT ON TABLE adaptation_shadow_log IS
  'Adaptation Engine PACE-lever shadow-compare log (docs/PRODUCT_DECISIONS.md '
  '2026-09-01 §2). Read-only observability: this table is written by '
  'lib/adaptation/shadow-compare.ts and read by NOTHING live — no plan '
  'mutation anywhere reads it. Zero rows here should ever change a runner-'
  'visible number.';
