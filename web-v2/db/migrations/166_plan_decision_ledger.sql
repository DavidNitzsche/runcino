-- 166_plan_decision_ledger.sql
--
-- ══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED TO PRODUCTION. APPLIED AND EXERCISED ON A LOCAL SCRATCH DB
-- (`faff_ledger_scratch`, loopback, created for the purpose).
-- ══════════════════════════════════════════════════════════════════════════
--
-- THE DURABLE DECISION LEDGER. One table. Every decision and every mutation
-- that reaches a runner's plan records what it was, who authorised it, what it
-- rested on, what moved, and what happened next.
--
-- Approval packet, statement by statement, with rollback SQL and verification
-- queries: docs/reports/brain-2026-09-05/MIGRATION-PACKET.md
--
-- ── WHY THIS EXISTS ────────────────────────────────────────────────────────
--
-- CLAUDE.md Rule 21, verbatim: "`training_plans.adaptation_log` stores
-- `{"n": 1, "ts": "..."}` — a counter and a timestamp, and no record of WHAT
-- adapted. So the engine's own log cannot answer 'has this ever pushed up',
-- and establishing the zero above required querying `coach_intents` sideways.
-- A log that records that something happened but not what is not a log."
--
-- `lib/plan/adaptation-log.ts` (2026-09-04) added a `did` array to that JSON
-- and fixed the "not a log" half. It did NOT fix the two structural halves,
-- and both are why this table exists rather than a third key on that object:
--
--   1 · IT LIVES INSIDE THE THING THAT GETS REBUILT. `adaptation_log` is a
--       column on `training_plans`. `clearActivePlansFor` archives the plan
--       row, and a rebuild authors a NEW row whose `adaptation_log` is `[]`.
--       Every decision a runner ever acknowledged is, from the new plan's
--       point of view, gone. A ledger that a rebuild empties is a cache.
--   2 · IT HAS ONE WRITER, AND IT IS THE CRON. `applyAdaptations` is the only
--       thing that appends. `adaptation-log.ts`'s own Rule 22 note says so:
--       "Three other paths can move a workout — /api/today/reschedule,
--       move_day and PATCH /api/plan/workout — and none of them writes here.
--       A count of zero UP from this log is evidence about the nightly pass,
--       not about the app."
--
-- ── WHAT HAPPENS TO `training_plans.adaptation_log` ────────────────────────
--
-- NOTHING, in this migration. It is not dropped, not renamed, not altered, and
-- `applyAdaptations` keeps appending to it exactly as it does today. That is
-- deliberate: `docs/OVERNIGHT-REPORT.md` records consumers deriving "last
-- changed" as `max(adaptation_log.ts)`, and this migration is additive-only.
--
-- Its STATUS changes, and the status is enforced in code rather than in DDL:
-- it is demoted from a record of truth to a per-plan convenience index, and
-- `plan_decision_ledger` becomes the record of truth. The retirement of the
-- column is a separate, non-additive change that needs its own approval and
-- its own reader audit; proposing it here would smuggle a destructive step
-- into an additive migration. See the packet's "what enabling it would allow"
-- section, which states this explicitly rather than leaving it implied.
--
-- ── PLAN LINEAGE IS A REQUIRED COLUMN, NOT AN AFTERTHOUGHT ─────────────────
--
-- `plan_lineage_id` is NOT NULL. A rebuild archives the outgoing plan and
-- authors a new one with a new id; without a lineage the ledger would answer
-- "what has this runner's coaching done" only for the CURRENT plan, which is
-- the exact failure the column list above describes. So:
--
--   · `plan_id`          the plan this decision touched, at the time.
--   · `replaced_plan_id` the plan this one replaced, on an AUTHORSHIP row.
--   · `plan_lineage_id`  stable across every rebuild in a chain. Resolved by
--                        `lib/brain/ledger/plan-lineage.ts`: the lineage of the
--                        replaced plan if the ledger already knows one, else
--                        the replaced plan's own id, else this plan's own id.
--
-- Querying a runner's whole coaching history is therefore one predicate on
-- `plan_lineage_id`, and it survives every rebuild.
--
-- ── NO FOREIGN KEYS, DELIBERATELY ──────────────────────────────────────────
--
-- `canonical_adaptation_shadow_log` (migration 164) references
-- `training_plans(id) ON DELETE CASCADE`, which is right for a shadow log: it
-- is diagnostic, and it should not outlive its subject.
--
-- A LEDGER IS THE OPPOSITE. Its whole value is that it survives the row it
-- describes. A CASCADE here would mean deleting one plan silently erases every
-- decision ever made against it — the same class of loss as storing the record
-- inside `adaptation_log`, arriving by a different door. `user_uuid`,
-- `plan_id`, `replaced_plan_id` and `plan_lineage_id` are therefore plain
-- columns. Rule 14 is satisfied by the queries stating their population, not
-- by a constraint that can delete the evidence.
--
-- ── ROWS ARE NEVER DELETED, AND NEVER REWRITTEN IN PLACE ───────────────────
--
-- A decision that stops being current is SUPERSEDED (`superseded_by` +
-- `superseded_at`) or UNDONE (`undone_at` + `undo_reason`). Both are stamped,
-- both are constrained to arrive with their explanation, and neither erases
-- what the row said. "This was reversed" and "this never happened" are
-- different facts (Rule 11) and only one of them is recoverable afterwards.
--
-- ── ADDITIVE ONLY ──────────────────────────────────────────────────────────
--
-- One new table, five new indexes, one comment. No ALTER against an existing
-- table, no rename, no drop, no NOT NULL applied to data that already exists —
-- every NOT NULL below is on a column of a table created in the same
-- statement, where there are no rows to violate it. An application running the
-- OLD code against a database with this migration applied behaves identically,
-- because nothing outside this feature reads or writes the table.
--
-- REVERSED BY: DROP TABLE IF EXISTS plan_decision_ledger;

CREATE TABLE IF NOT EXISTS plan_decision_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── the runner · Rule 14, the population is stated, never `user_id` ──────
  user_uuid             uuid NOT NULL,

  -- ── plan lineage ────────────────────────────────────────────────────────
  plan_id               text,
  plan_lineage_id       text NOT NULL,
  replaced_plan_id      text,
  plan_version          text,

  -- ── workout scope · what this decision reached ──────────────────────────
  scope                 text NOT NULL
                          CHECK (scope IN ('PLAN', 'WEEK', 'WORKOUT', 'NONE')),
  workout_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_from_iso        date,
  scope_to_iso          date,

  -- ── the lever and the direction · Rule 21's census, in one query ────────
  lever                 text NOT NULL
                          CHECK (lever IN (
                            'PACE', 'VOLUME', 'LONG_RUN', 'SESSION_SHAPE',
                            'SCHEDULE', 'PLAN_STRUCTURE', 'RECORD_ONLY')),
  direction             text NOT NULL
                          CHECK (direction IN ('UP', 'DOWN', 'NEUTRAL', 'UNKNOWN')),

  -- ── evidence and provenance ─────────────────────────────────────────────
  -- `provenance` is the named write site (`adapt/apply`, `api/plan/workout
  -- PATCH`), the same string `plan_mutation_rejections.source` already carries,
  -- so the two audit surfaces join on a vocabulary that already exists.
  evidence              jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance            text NOT NULL,
  -- DIRECT / INFERRED / RACE_DERIVED / VDOT_FALLBACK / USER_PRIOR /
  -- POPULATION_PRIOR, per DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md.
  -- Nullable: a runner-initiated edit rests on no estimate at all, and
  -- inventing a source mode for it would be a lie with a controlled vocabulary.
  source_mode           text,

  -- ── before and after ────────────────────────────────────────────────────
  before_state          jsonb,
  after_state           jsonb,

  -- ── authority · lib/brain/mutation/authority.ts, verbatim ───────────────
  authority             text NOT NULL
                          CHECK (authority IN (
                            'RUNNER_INITIATED', 'RUNNER_ACCEPTED', 'LIFECYCLE',
                            'COACHING_ADAPTATION', 'AUTHORSHIP')),
  authority_verdict     text NOT NULL
                          CHECK (authority_verdict IN ('PERMITTED', 'REFUSED', 'HELD')),
  -- {owner, blocker, expiresWhen} when a COACHING_ADAPTATION ran under a named
  -- hold. A hold that is not written down is a bypass.
  hold                  jsonb,

  -- ── the decision ────────────────────────────────────────────────────────
  decision              text NOT NULL
                          CHECK (decision IN (
                            'PROGRESS', 'HOLD', 'REGRESS', 'REFUSE',
                            'APPLY', 'DEFER', 'EXPIRE', 'UNDO')),

  -- ── the proposal, and the runner's answer to it ─────────────────────────
  proposal_id           text,
  proposal              jsonb,
  runner_response       text
                          CHECK (runner_response IS NULL OR runner_response IN (
                            'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  responded_at          timestamptz,

  -- ── what actually happened to the plan · lib/plan/mutate.ts outcomes ────
  mutation_outcome      text
                          CHECK (mutation_outcome IS NULL OR mutation_outcome IN (
                            'applied', 'rejected', 'undeclared_structural', 'bypassed',
                            'authorship_drift', 'no_plan', 'not_attempted')),
  mutation_violations   jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── the explanation, the model, the time ────────────────────────────────
  explanation           text NOT NULL,
  model_version         text NOT NULL,
  at                    timestamptz NOT NULL DEFAULT now(),

  -- ── superseded / undone · never a DELETE, never an in-place rewrite ─────
  superseded_by         uuid,
  superseded_at         timestamptz,
  undone_at             timestamptz,
  undo_reason           text,

  -- ── idempotency · a re-run of the same pass refreshes, never duplicates ─
  idempotency_key       text,

  created_at            timestamptz NOT NULL DEFAULT now(),

  -- An explanation is not optional. A ledger row that cannot say why is the
  -- `{"n": 1}` failure with more columns (Rule 21).
  CONSTRAINT plan_decision_ledger_explanation_is_present
    CHECK (length(explanation) > 0),

  -- A supersession names its successor, or it is not a supersession.
  CONSTRAINT plan_decision_ledger_supersession_is_explained
    CHECK ((superseded_at IS NULL AND superseded_by IS NULL)
        OR (superseded_at IS NOT NULL AND superseded_by IS NOT NULL)),

  -- An undo states a reason. "It was reversed" without "because" is the same
  -- shape as an expiry with no expiry_reason, which migration 165 already
  -- refused for the same argument.
  CONSTRAINT plan_decision_ledger_undo_is_explained
    CHECK ((undone_at IS NULL AND undo_reason IS NULL)
        OR (undone_at IS NOT NULL AND undo_reason IS NOT NULL AND length(undo_reason) > 0)),

  -- A settled runner response carries the moment it settled; a pending or
  -- absent one does not. COALESCE rather than a bare IN, because a NULL
  -- comparison makes a CHECK pass vacuously and a constraint that cannot fail
  -- is Rule 18's whole complaint.
  CONSTRAINT plan_decision_ledger_response_is_timed
    CHECK ((COALESCE(runner_response, 'PENDING') IN ('ACCEPTED', 'DECLINED', 'EXPIRED'))
           = (responded_at IS NOT NULL))
);

-- The runner's own history, newest first. The read every audit surface makes.
CREATE INDEX IF NOT EXISTS plan_decision_ledger_user_at
  ON plan_decision_ledger (user_uuid, at DESC);

-- THE RULE 21 QUERY, and the reason this index exists rather than a comment
-- saying the query is possible:
--
--   SELECT direction, count(*) FROM plan_decision_ledger
--    WHERE user_uuid = $1 AND undone_at IS NULL GROUP BY direction;
--
-- Five downgrades against zero upgrades is not a runner's record, it is an
-- engine's disposition, and this is how it is measured without reconstructing
-- it sideways from `coach_intents`.
CREATE INDEX IF NOT EXISTS plan_decision_ledger_direction
  ON plan_decision_ledger (user_uuid, direction, at DESC);

-- The whole lineage, across every rebuild. The point of the lineage column.
CREATE INDEX IF NOT EXISTS plan_decision_ledger_lineage
  ON plan_decision_ledger (plan_lineage_id, at DESC);

-- One live row per (runner, write site, idempotency key). PARTIAL, because a
-- row with no key is a distinct event every time and must never collide.
CREATE UNIQUE INDEX IF NOT EXISTS plan_decision_ledger_idempotency
  ON plan_decision_ledger (user_uuid, provenance, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Open proposals awaiting an answer.
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
