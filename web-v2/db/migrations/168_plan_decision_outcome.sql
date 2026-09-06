-- 168_plan_decision_outcome.sql
--
-- STEP 16 · did the decision work?
--
-- The sixteenth orchestration step, and the one that did not exist. Nothing
-- re-read a decision after its reassessment date to record whether it turned
-- out to be right, so the engine could not tell a decision that helped from one
-- that cost the runner a week.
--
-- A SEPARATE TABLE rather than columns on `plan_decision_ledger`, for three
-- reasons that are not tidiness:
--
--   1 · it is written by a DIFFERENT job at a DIFFERENT time — days or weeks
--       after the decision — so an outcome row appearing is itself the signal
--       that the loop closed.
--   2 · 166 is under review for production approval. Extending it after the
--       literal SQL was submitted would invalidate that review.
--   3 · a decision can be re-evaluated as more evidence arrives. One decision,
--       many observations over time, is a row set and not a column.
--
-- ADDITIVE ONLY. No ALTER, no rewrite, no backfill. Nothing existing is touched.
--
-- NOT APPLIED TO PRODUCTION. Scratch only until the literal statements are
-- approved.

CREATE TABLE IF NOT EXISTS plan_decision_outcome (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The decision this judges. No FK, for the same reason 166 carries none: a
  -- record whose whole value is outliving its subject must not be deletable by
  -- a cascade.
  decision_id           uuid NOT NULL,
  user_uuid             uuid NOT NULL,
  plan_lineage_id       text NOT NULL,

  -- ── WHAT THE DECISION SAID IT WOULD DO ───────────────────────────────────
  lever                 text NOT NULL,
  chosen_option         text NOT NULL,
  rejected_options      jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_direction    text NOT NULL
                          CHECK (expected_direction IN ('UP', 'DOWN', 'NEUTRAL', 'UNKNOWN')),
  prediction            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── WHAT ACTUALLY HAPPENED ───────────────────────────────────────────────
  observed_from_iso     date NOT NULL,
  observed_to_iso       date NOT NULL,
  subsequent_execution  jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovery              jsonb NOT NULL DEFAULT '{}'::jsonb,
  later_performance     jsonb NOT NULL DEFAULT '{}'::jsonb,
  pain_or_injury        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── THE VERDICT ──────────────────────────────────────────────────────────
  --
  -- UNRESOLVED is a first-class answer and the default. Rule 11: "not enough
  -- has happened yet" is not "the decision was fine", and an engine that
  -- cannot say the first will report the second.
  verdict               text NOT NULL
                          CHECK (verdict IN (
                            'PRODUCTIVE', 'EXCESSIVE', 'UNDERDOSED', 'UNRESOLVED')),
  verdict_because       text NOT NULL,
  -- What was missing, when the verdict is UNRESOLVED. Never a shrug.
  unresolved_reason     text,
  confidence            numeric(4,3),

  model_version         text,
  evaluated_at          timestamptz NOT NULL DEFAULT now(),
  -- One evaluation per decision per observation window, so a nightly sweep
  -- re-evaluating the same decision updates rather than accumulating.
  idempotency_key       text NOT NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plan_decision_outcome_window_ordered
    CHECK (observed_to_iso >= observed_from_iso),
  CONSTRAINT plan_decision_outcome_unresolved_is_explained
    CHECK ((verdict = 'UNRESOLVED') = (unresolved_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS plan_decision_outcome_idem
  ON plan_decision_outcome (decision_id, idempotency_key);

CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_runner
  ON plan_decision_outcome (user_uuid, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_lineage
  ON plan_decision_outcome (plan_lineage_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_verdict
  ON plan_decision_outcome (user_uuid, lever, verdict);

COMMENT ON TABLE plan_decision_outcome IS
  'Step 16 · whether a coaching decision turned out to be right. Written by a '
  'later sweep, never by the decision itself. UNRESOLVED is a real answer.';
