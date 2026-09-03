-- 163_plan_reschedules.sql
-- The rescheduling decision record.  RS-1 / RS-5 / RS-6.
--
-- Doctrine: docs/RESCHEDULING_CONTRACT.md (locked 2026-09-03), and
-- docs/MASTER_CORE_PRODUCT_PROGRAM.md §"P1 · Workout rescheduling".
--
-- WHY ITS OWN TABLE, AND NOT plan_mutations
--
--   "Rescheduling is not adaptation. Adaptation changes training because
--    demonstrated capacity changed. Rescheduling changes placement because
--    the runner supplied a constraint. Separate typed decisions, owners,
--    RECORDS and mutation paths."
--
-- `plan_mutations` is the adaptation seam's record. It carries `trigger_kind`
-- and `signal_snapshot` — the shape of an engine-initiated change made on
-- evidence. Writing a runner-supplied calendar constraint into it would
-- collapse two decisions into one row, and would make "has this engine ever
-- pushed the runner" unanswerable in exactly the way CLAUDE.md Rule 21
-- describes, because a reschedule would show up in the adaptation ledger as
-- though the engine had decided something.
--
-- WHAT IT HAS TO HOLD  (Q40)
--
--   original workout id · original date and prescription · the rescheduling
--   decision · the new version · the new date and prescription · the reason
--   for any reduction · the stimulus-preservation assessment · undo
--   information.
--
-- The full typed `RescheduleDecision` goes in `decision` jsonb, and the five
-- questions worth querying without opening the blob are lifted into columns:
-- which row, which dates, which move kind, how much stimulus survived, and
-- whether the identity changed.
--
--   stimulus_preservation   FULL | PARTIAL | SUBSTITUTED | LOST
--   identity_kind           SAME_INSTANCE | REVISED_VERSION
--
-- These are the answer to Q40's SECOND question and are deliberately NOT an
-- execution grade. `executionGrade` — did he do the workout ultimately
-- prescribed — is answered elsewhere, later, by the post-run owner, and the
-- two must never collapse into one column.
--
-- `undone_at` is RS-6. Undo is a status change plus the inverse edit set, both
-- inside one `mutatePlan` transaction. The decision blob is never rewritten,
-- so the record of what was decided survives being undone.
--
-- ORDER OF LANDING
--
-- Per db/migrations/README.md this is a case-1 migration: it adds a TABLE, so
-- it may land before or after the code. `lib/plan/reschedule.ts` treats the
-- table's absence honestly — `recordDecision` throws
-- `RescheduleRecordUnavailable`, the mutation boundary rolls the whole
-- transaction back, and the runner is told the change was NOT made. It never
-- proceeds with an unrecorded mutation, because a reschedule with no lineage
-- cannot be undone and cannot answer Q40.
--
-- user_uuid carries the standard FK to users, so account deletion covers this
-- table both via the runtime user-keyed enumeration and via ON DELETE CASCADE.
-- NOTE for the weekly deletion-plan fixture probe: once this is applied, the
-- fixture in lib/account/deletion-plan.test.ts needs its next repaste.
--
-- Additive only: one new table, two new indexes. Idempotent.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/163_plan_reschedules.sql
-- REVERSED BY: DROP TABLE IF EXISTS plan_reschedules;
--
-- APPLIED to production 2026-09-03, under David's explicit statement-shape
-- authorization. Verified: isolated-DB dry run (twice, idempotent), FK and
-- CHECK constraint behavior (six cases), rollback, and cross-user scoping
-- in the code that uses this table. Full evidence in
-- docs/migrations/163-plan-reschedules-evidence-2026-09-03.md. Schema
-- creation only — no reschedule row exists yet, and moving Sunday's long
-- run remains a separate, still-unapproved decision.

CREATE TABLE IF NOT EXISTS plan_reschedules (
  id                     text PRIMARY KEY,
  user_uuid              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                text NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  -- The row the runner asked to move. Loose reference on purpose: a rebuild
  -- mints new plan_workouts ids for the same dates, and a decision must remain
  -- readable after one rather than cascading away.
  plan_workout_id        text NOT NULL,
  decided_at             timestamptz NOT NULL DEFAULT now(),

  -- The typed decision's discriminants, lifted out of the blob so a query can
  -- tell a reschedule from an adaptation without parsing jsonb.
  kind                   text NOT NULL DEFAULT 'RESCHEDULE'
                           CHECK (kind = 'RESCHEDULE'),
  origin                 text NOT NULL DEFAULT 'RUNNER_CONSTRAINT'
                           CHECK (origin = 'RUNNER_CONSTRAINT'),

  move_kind              text NOT NULL,

  -- Q40's second question. Never an execution grade.
  stimulus_preservation  text NOT NULL
                           CHECK (stimulus_preservation IN ('FULL','PARTIAL','SUBSTITUTED','LOST')),
  identity_kind          text NOT NULL
                           CHECK (identity_kind IN ('SAME_INSTANCE','REVISED_VERSION')),

  original_date_iso      text NOT NULL,
  new_date_iso           text NOT NULL,

  -- The complete RescheduleDecision: constraint as declared, original
  -- prescription verbatim, every row edit with its before and after, the
  -- reduction reason where there was one, and the undo set.
  decision               jsonb NOT NULL,

  undone_at              timestamptz,

  -- A pure date change must never be recorded as a revised version, and a
  -- revised version must never claim FULL preservation. The two questions do
  -- not collapse, and the table refuses to let them.
  CONSTRAINT plan_reschedules_identity_ck CHECK (
    (identity_kind = 'SAME_INSTANCE'   AND stimulus_preservation = 'FULL')
    OR
    (identity_kind = 'REVISED_VERSION' AND stimulus_preservation <> 'FULL')
  )
);

CREATE INDEX IF NOT EXISTS plan_reschedules_user_decided_idx
  ON plan_reschedules (user_uuid, decided_at DESC);

CREATE INDEX IF NOT EXISTS plan_reschedules_plan_idx
  ON plan_reschedules (plan_id, original_date_iso);

COMMENT ON TABLE plan_reschedules IS
  'Runner-initiated rescheduling decisions. NOT adaptation: a row here means '
  'the runner supplied a calendar constraint and approved a placement change. '
  'It never means a fitness belief moved, and it is never evidence the plan '
  'was too demanding. The adaptation seam records to plan_mutations instead.';

COMMENT ON COLUMN plan_reschedules.stimulus_preservation IS
  'How much of the ORIGINAL intended stimulus survived (Q40 question 2). This '
  'is NOT an execution grade. Whether the runner executed the workout '
  'ULTIMATELY prescribed is a separate question answered by the post-run '
  'owner, and the two must never be collapsed.';
