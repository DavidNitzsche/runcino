-- 167_reassessment_schedule.sql
--
-- ══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED TO PRODUCTION. APPLIED AND EXERCISED ON A LOCAL SCRATCH DB
-- (`faff_ledger_scratch`, loopback, created for the purpose).
-- ══════════════════════════════════════════════════════════════════════════
--
-- THE DURABLE REASSESSMENT SCHEDULER. One table for every promise the engine
-- makes to look at something again:
--
--   DEFERRAL                  a progression arbitration put off to a boundary
--   EARNING_GATE              a change the runner must earn before it is offered
--   CONDITIONAL_DOSE          a dose that applies only if a condition holds
--   POST_RACE_RECOVERY_CHECK  is this runner ready to train normally again
--   RETURN_TO_TRAINING_STAGE  the next rung of an injury or illness ladder
--   PROPOSAL_EXPIRATION       an unanswered proposal that must not stand forever
--   FAILED_EVALUATION         an assessment that broke and must be retried
--
-- Approval packet, statement by statement, with rollback SQL and verification
-- queries: docs/reports/brain-2026-09-05/MIGRATION-PACKET.md
--
-- ── IT REPLACES MIGRATION 165 RATHER THAN SITTING BESIDE IT ────────────────
--
-- `165_canonical_adaptation_deferrals.sql` was written 2026-09-04 for the
-- deferral queue alone (three levers, one kind of promise). It was applied to a
-- local scratch database and NEVER to production, so retiring it costs nothing
-- and avoids the outcome that matters: a third queue.
--
-- Everything 165 argued is inherited verbatim and is not re-argued here — why a
-- table of its own rather than `training_plans.adaptation_log` (a queued
-- deferral has to survive the plan rebuild that is precisely when it would
-- otherwise be lost) or `coach_intents` (a runner-facing surface; a deferral is
-- internal engine state and putting it there is the forced-decision failure
-- CLAUDE.md already rules out). Read 165's header for that reasoning; this
-- table is the same argument generalised from one kind of promise to seven.
--
-- 165 is stamped SUPERSEDED in place and refuses to execute. `deferral-store.ts`
-- now reads and writes this table with `kind = 'DEFERRAL'`.
--
-- ── RULE 23 IS THE GOVERNING RULE, AND THIS IS HOW EACH CLAUSE LANDS ───────
--
-- "A scheduled job guarantees its own preconditions. A schedule is not a
--  guarantee."
--
--   · A JOB MAY NOT DEPEND ON ANOTHER JOB HAVING RUN. An item states its OWN
--     `required_evidence`, and the sweep re-derives that evidence at assessment
--     time rather than trusting that some earlier job left it lying around. An
--     item whose evidence is not there is not silently dropped and not silently
--     applied: it stays PENDING with its reason, or it becomes FAILED with the
--     error, and both are readable.
--   · LATENESS MUST BE HARMLESS. Due-ness is `assess_on_iso <= today`, never a
--     clock hour. A sweep that runs twelve hours late processes exactly the
--     same due set, and one that runs twice processes it once, because
--     `(user_uuid, kind, idempotency_key)` is unique across LIVE rows.
--   · A JOB THAT DOES NOT RUN MUST BE NOTICED. `overdue_after_iso` is the date
--     past which an unassessed item is a defect rather than a queue. The sweep
--     raises `reassessment_overdue` on `ops_alerts` for anything past it, and
--     the sweep itself is registered in `lib/ops/cron-ledger.ts` so a sweep that
--     never runs raises `cron_stale`. Nothing here disappears quietly.
--
-- ── FAILURE IS A STATE, NOT AN ABSENCE ─────────────────────────────────────
--
-- `attempts`, `last_error`, `last_attempt_at` and `next_retry_at` exist because
-- CLAUDE.md Rule 11 makes three facts out of one: an item that has never been
-- assessed, an item assessed and carried, and an item whose assessment BROKE
-- are three different things. Collapsing the third into the first is how a
-- deferred progression would vanish while every log said the system was
-- healthy — the exact failure this table exists to prevent.
--
-- ── ROWS ARE NEVER DELETED ─────────────────────────────────────────────────
--
-- An item that leaves the live queue is stamped with a terminal `status`, a
-- `resulting_decision`, a sentence and a `resolved_at`, and the table's own
-- CHECK refuses a row that says "gone" without saying why. The live queue is
-- `status IN ('PENDING','DUE')`, and the unique index enforcing one live item
-- per identity is PARTIAL on that predicate, so history accumulates underneath
-- instead of being overwritten by the next re-queue. (165's header argues this
-- at length under "PARTIAL, and the partiality is load-bearing"; the argument
-- is unchanged.)
--
-- ── ADDITIVE ONLY ──────────────────────────────────────────────────────────
--
-- One new table, four new indexes, one comment. No ALTER against an existing
-- table, no rename, no drop, no NOT NULL applied to data that already exists.
-- An application running the OLD code against a database with this migration
-- applied behaves identically.
--
-- REVERSED BY: DROP TABLE IF EXISTS reassessment_schedule;

CREATE TABLE IF NOT EXISTS reassessment_schedule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Rule 14 · the population this row belongs to, stated. Never `user_id`.
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

  -- ── reason · the code and the sentence ──────────────────────────────────
  -- Deliberately NOT a CHECK-constrained enum: seven kinds have seven
  -- vocabularies, and a shared CHECK would either have to list every code every
  -- kind will ever use (a constraint that blocks a code change on a DDL
  -- approval) or be so wide it constrains nothing. The per-kind vocabulary is
  -- typed in `lib/ops/reassessment-scheduler.ts` and gated there.
  reason_code            text NOT NULL,
  reason_detail          text NOT NULL,

  -- ── the assessment date · due-ness is a DATE, never a clock hour ────────
  assess_on_iso          date NOT NULL,
  -- Past this date an unassessed item is a defect and raises an alert. NULL
  -- means "this item has no deadline", which is a real answer for a standing
  -- earning gate and is not the same as a deadline of never.
  overdue_after_iso      date,

  -- ── required evidence · what must be true before this can be answered ───
  required_evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What supported it when it was queued, so a reader can judge it later.
  evidence               jsonb NOT NULL DEFAULT '[]'::jsonb,
  newest_evidence_iso    date,

  -- ── plan and version ────────────────────────────────────────────────────
  plan_id                text,
  plan_lineage_id        text,
  plan_version           text NOT NULL,
  evidence_version       text,
  model_version          text,

  -- ── the payload · what will be re-offered at the boundary ───────────────
  lever                  text,
  before_value           double precision,
  proposed_after_value   double precision,
  magnitude              jsonb,
  payload                jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── status ──────────────────────────────────────────────────────────────
  -- PENDING   queued, not yet due.
  -- DUE       due and awaiting assessment.
  -- RESOLVED  assessed; `resulting_decision` says what came of it.
  -- EXPIRED   retired for a stated reason without being assessed.
  -- FAILED    assessment broke past the retry budget. Loud, never silent.
  -- ABANDONED withdrawn by a runner action (a plan rebuild, an explicit undo).
  status                 text NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN (
                             'PENDING', 'DUE', 'RESOLVED', 'EXPIRED', 'FAILED', 'ABANDONED')),

  -- ── attempts · Rule 11, a broken read is not an empty one ───────────────
  attempts               integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error             text,
  last_attempt_at        timestamptz,
  next_retry_at          timestamptz,

  -- ── the resulting decision ──────────────────────────────────────────────
  resulting_decision     text,
  resulting_decision_detail text,
  -- The ledger row this item produced, when it produced one. No FK: the ledger
  -- outlives everything by design and this table must not be able to cascade.
  resulting_ledger_id    uuid,
  resolved_at            timestamptz,

  -- The ledger row that queued this item, when there was one.
  origin_ledger_id       uuid,

  -- ── identity ────────────────────────────────────────────────────────────
  -- The engine's own idempotency key, so a re-assessment over unchanged
  -- evidence refreshes this row rather than queueing a second copy.
  idempotency_key        text NOT NULL,

  queued_at_iso          date NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- A terminal status states what came of the item and when, or it is not a
  -- resolution. The database refuses a row that says "gone" without saying why
  -- — 165's constraint, generalised from expiry to every terminal state.
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

  -- A FAILED item carries the error that failed it. "It failed" with no message
  -- is the swallowed-failure shape `check-swallowed-failure.sh` exists to keep
  -- out of the code, asserted here in the schema as well.
  CONSTRAINT reassessment_schedule_failure_names_its_error
    CHECK (status <> 'FAILED' OR (last_error IS NOT NULL AND length(last_error) > 0)),

  -- An attempt that happened has a time; a row with attempts = 0 has not been
  -- tried. Rule 11: never-tried and tried-and-fine must stay distinguishable.
  CONSTRAINT reassessment_schedule_attempts_are_timed
    CHECK ((attempts = 0) = (last_attempt_at IS NULL))
);

-- ONE LIVE ITEM PER (runner, kind, identity). PARTIAL on the live statuses, and
-- the partiality is load-bearing rather than an optimisation: rows here are
-- never deleted, so a TOTAL unique index would put "keep the history" and
-- "re-queue the same identity later" in direct conflict — the terminal row
-- would occupy the identity and re-queueing could only succeed by reviving it,
-- which erases the resolution it was kept to record.
CREATE UNIQUE INDEX IF NOT EXISTS reassessment_schedule_live_identity
  ON reassessment_schedule (user_uuid, kind, idempotency_key)
  WHERE status IN ('PENDING', 'DUE');

-- THE SWEEP'S READ: everything due today, across every runner, oldest first.
-- Deliberately NOT keyed on user first — the sweep asks "what is due", and a
-- user-first index would make it scan.
CREATE INDEX IF NOT EXISTS reassessment_schedule_due
  ON reassessment_schedule (assess_on_iso, user_uuid)
  WHERE status IN ('PENDING', 'DUE');

-- One runner's live queue, oldest boundary first. The read a per-user
-- evaluation makes (`loadLiveQueue`).
CREATE INDEX IF NOT EXISTS reassessment_schedule_user_live
  ON reassessment_schedule (user_uuid, assess_on_iso)
  WHERE status IN ('PENDING', 'DUE');

-- Retries waiting for their backoff to elapse.
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
