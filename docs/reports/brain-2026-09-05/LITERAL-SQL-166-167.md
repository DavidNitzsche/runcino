# Literal SQL · migrations 166 and 167

Every executable statement, verbatim, comments stripped. This is the
per-statement approval material. Nothing here has been run against production.

## 166 · plan_decision_ledger

```sql
CREATE TABLE IF NOT EXISTS plan_decision_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_uuid             uuid NOT NULL,

  plan_id               text,
  plan_lineage_id       text NOT NULL,
  replaced_plan_id      text,
  plan_version          text,

  scope                 text NOT NULL
                          CHECK (scope IN ('PLAN', 'WEEK', 'WORKOUT', 'NONE')),
  workout_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_from_iso        date,
  scope_to_iso          date,

  lever                 text NOT NULL
                          CHECK (lever IN (
                            'PACE', 'VOLUME', 'LONG_RUN', 'SESSION_SHAPE',
                            'SCHEDULE', 'PLAN_STRUCTURE', 'RECORD_ONLY')),
  direction             text NOT NULL
                          CHECK (direction IN ('UP', 'DOWN', 'NEUTRAL', 'UNKNOWN')),

  evidence              jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance            text NOT NULL,
  source_mode           text,

  before_state          jsonb,
  after_state           jsonb,

  authority             text NOT NULL
                          CHECK (authority IN (
                            'RUNNER_INITIATED', 'RUNNER_ACCEPTED', 'LIFECYCLE',
                            'COACHING_ADAPTATION', 'AUTHORSHIP')),
  authority_verdict     text NOT NULL
                          CHECK (authority_verdict IN ('PERMITTED', 'REFUSED', 'HELD')),
  hold                  jsonb,

  decision              text NOT NULL
                          CHECK (decision IN (
                            'PROGRESS', 'HOLD', 'REGRESS', 'REFUSE',
                            'APPLY', 'DEFER', 'EXPIRE', 'UNDO')),

  proposal_id           text,
  proposal              jsonb,
  runner_response       text
                          CHECK (runner_response IS NULL OR runner_response IN (
                            'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  responded_at          timestamptz,

  mutation_outcome      text
                          CHECK (mutation_outcome IS NULL OR mutation_outcome IN (
                            'applied', 'rejected', 'undeclared_structural', 'bypassed',
                            'authorship_drift', 'no_plan', 'not_attempted')),
  mutation_violations   jsonb NOT NULL DEFAULT '[]'::jsonb,

  explanation           text NOT NULL,
  model_version         text NOT NULL,
  at                    timestamptz NOT NULL DEFAULT now(),

  superseded_by         uuid,
  superseded_at         timestamptz,
  undone_at             timestamptz,
  undo_reason           text,

  idempotency_key       text,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plan_decision_ledger_explanation_is_present
    CHECK (length(explanation) > 0),

  CONSTRAINT plan_decision_ledger_supersession_is_explained
    CHECK ((superseded_at IS NULL AND superseded_by IS NULL)
        OR (superseded_at IS NOT NULL AND superseded_by IS NOT NULL)),

  CONSTRAINT plan_decision_ledger_undo_is_explained
    CHECK ((undone_at IS NULL AND undo_reason IS NULL)
        OR (undone_at IS NOT NULL AND undo_reason IS NOT NULL AND length(undo_reason) > 0)),

  CONSTRAINT plan_decision_ledger_response_is_timed
    CHECK ((COALESCE(runner_response, 'PENDING') IN ('ACCEPTED', 'DECLINED', 'EXPIRED'))
           = (responded_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS plan_decision_ledger_user_at
  ON plan_decision_ledger (user_uuid, at DESC);

CREATE INDEX IF NOT EXISTS plan_decision_ledger_direction
  ON plan_decision_ledger (user_uuid, direction, at DESC);

CREATE INDEX IF NOT EXISTS plan_decision_ledger_lineage
  ON plan_decision_ledger (plan_lineage_id, at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS plan_decision_ledger_idempotency
  ON plan_decision_ledger (user_uuid, provenance, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS plan_decision_ledger_pending_proposals
  ON plan_decision_ledger (user_uuid, at DESC)
  WHERE runner_response = 'PENDING';

COMMENT ON TABLE plan_decision_ledger IS
  'THE durable decision ledger. One row per coaching decision or plan mutation, written by '
  'lib/plan/mutate.ts (the one door in front of plan_workouts) and by the proposal surface. '
  'Survives a plan rebuild: plan_lineage_id is stable across the chain and there are no '
  'foreign keys, deliberately. Rows are never deleted; a decision that stops being current is '
  'superseded or undone, with its reason. Replaces training_plans.adaptation_log as the record '
  'of truth (that column is untouched and keeps its max(ts) consumers).';
```

## 167 · reassessment_schedule

```sql
CREATE TABLE IF NOT EXISTS reassessment_schedule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_uuid              uuid NOT NULL,

  kind                   text NOT NULL
                           CHECK (kind IN (
                             'DEFERRAL',
                             'EARNING_GATE',
                             'CONDITIONAL_DOSE',
                             'POST_RACE_RECOVERY_CHECK',
                             'RETURN_TO_TRAINING_STAGE',
                             'PROPOSAL_EXPIRATION',
                             'FAILED_EVALUATION')),

  reason_code            text NOT NULL,
  reason_detail          text NOT NULL,

  assess_on_iso          date NOT NULL,
  overdue_after_iso      date,

  required_evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence               jsonb NOT NULL DEFAULT '[]'::jsonb,
  newest_evidence_iso    date,

  plan_id                text,
  plan_lineage_id        text,
  plan_version           text NOT NULL,
  evidence_version       text,
  model_version          text,

  lever                  text,
  before_value           double precision,
  proposed_after_value   double precision,
  magnitude              jsonb,
  payload                jsonb NOT NULL DEFAULT '{}'::jsonb,

  status                 text NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN (
                             'PENDING', 'DUE', 'RESOLVED', 'EXPIRED', 'FAILED', 'ABANDONED')),

  attempts               integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error             text,
  last_attempt_at        timestamptz,
  next_retry_at          timestamptz,

  resulting_decision     text,
  resulting_decision_detail text,
  resulting_ledger_id    uuid,
  resolved_at            timestamptz,

  origin_ledger_id       uuid,

  idempotency_key        text NOT NULL,

  queued_at_iso          date NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reassessment_schedule_terminal_is_explained
    CHECK (
      (status IN ('PENDING', 'DUE')
        AND resolved_at IS NULL AND resulting_decision IS NULL)
      OR
      (status IN ('RESOLVED', 'EXPIRED', 'FAILED', 'ABANDONED')
        AND resolved_at IS NOT NULL
        AND resulting_decision IS NOT NULL
        AND resulting_decision_detail IS NOT NULL
        AND length(resulting_decision_detail) > 0)
    ),

  CONSTRAINT reassessment_schedule_failure_names_its_error
    CHECK (status <> 'FAILED' OR (last_error IS NOT NULL AND length(last_error) > 0)),

  CONSTRAINT reassessment_schedule_attempts_are_timed
    CHECK ((attempts = 0) = (last_attempt_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS reassessment_schedule_live_identity
  ON reassessment_schedule (user_uuid, kind, idempotency_key)
  WHERE status IN ('PENDING', 'DUE');

CREATE INDEX IF NOT EXISTS reassessment_schedule_due
  ON reassessment_schedule (assess_on_iso, user_uuid)
  WHERE status IN ('PENDING', 'DUE');

CREATE INDEX IF NOT EXISTS reassessment_schedule_user_live
  ON reassessment_schedule (user_uuid, assess_on_iso)
  WHERE status IN ('PENDING', 'DUE');

CREATE INDEX IF NOT EXISTS reassessment_schedule_retry
  ON reassessment_schedule (next_retry_at)
  WHERE next_retry_at IS NOT NULL AND status IN ('PENDING', 'DUE');

COMMENT ON TABLE reassessment_schedule IS
  'THE durable reassessment scheduler. One row per promise the engine made to look at '
  'something again: deferrals, earning gates, conditional doses, post-race recovery checks, '
  'return-to-training stages, proposal expirations and failed evaluations. Due-ness is a DATE, '
  'so lateness is harmless (CLAUDE.md Rule 23). Rows are never deleted: an item leaving the '
  'live queue is stamped with a terminal status, a resulting decision and a sentence. '
  'Supersedes the unapplied migration 165 (canonical_adaptation_deferrals), which covered one '
  'of these seven kinds.';
```

