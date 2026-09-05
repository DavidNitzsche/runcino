-- 165_canonical_adaptation_deferrals.sql
--
-- ══════════════════════════════════════════════════════════════════════════
-- SUPERSEDED 2026-09-05 BY 167_reassessment_schedule.sql. DO NOT APPLY.
-- ══════════════════════════════════════════════════════════════════════════
--
-- This migration was never applied to production — only to a local scratch
-- database — so retiring it costs nothing, and retiring it is what stops the
-- app growing a THIRD durable queue beside `plan_workout_proposals` and the
-- deferral store.
--
-- `reassessment_schedule` (migration 167) is the one durable scheduler. It
-- carries this table's deferral rows as `kind = 'DEFERRAL'`, with the same
-- columns, the same partial-unique-on-live identity, the same never-delete
-- posture and the same "an item that leaves states why" constraint —
-- generalised from one kind of promise to seven.
-- `lib/adaptation/canonical-shadow/deferral-store.ts` now reads and writes
-- migration 167's table.
--
-- The DDL below is kept for archaeology and for the arguments in this header,
-- which 167 inherits by reference rather than restating. It is guarded so it
-- CANNOT be executed by accident: running this file now raises. That is
-- deliberate — a file that says "do not apply" and still applies cleanly is a
-- comment, not a control (Rule 20).
--
-- ══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = '165_canonical_adaptation_deferrals.sql is SUPERSEDED and must not be applied.',
    DETAIL  = 'Apply web-v2/db/migrations/167_reassessment_schedule.sql instead. It carries '
              'these rows as kind = ''DEFERRAL'' and is the one durable scheduler.',
    HINT    = 'If you are reading history rather than applying schema, read the header only.';
END
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- ORIGINAL HEADER AND DDL FOLLOWS, UNCHANGED, FOR THE RECORD.
-- ══════════════════════════════════════════════════════════════════════════
--
-- NOT APPLIED TO PRODUCTION. APPLIED AND EXERCISED ON A LOCAL SCRATCH DB.
--
-- Written 2026-09-04 alongside `lib/adaptation/canonical/deferral-queue.ts`.
-- CLAUDE.md's operational boundary is explicit: code changes deploy on
-- approval, DDL and data writes need the owner's separate, explicit,
-- per-statement go. No statement in this file has been executed against
-- production or against any hosted database.
--
-- It HAS been applied to a local scratch database — `faff_deferral_scratch` on
-- loopback, created for the purpose — and the read/write path in
-- `lib/adaptation/canonical-shadow/deferral-store.ts` was exercised against it
-- end to end, because an unapplied migration is an untested one and Rule 18
-- does not accept "it looks right" as evidence about DDL. See
-- `lib/adaptation/canonical-shadow/_deferral_store.db.test.ts`, which SKIPS
-- when no scratch database is reachable and says so rather than reporting
-- clean.
--
-- To apply to production, when that decision is made:
--
--     psql $DATABASE_URL -f web-v2/db/migrations/165_canonical_adaptation_deferrals.sql
--
-- Until then `deferral-store.ts` probes for the table once and reports
-- "evaluated but not persisted" rather than throwing, exactly as
-- `run-live-shadow-evaluation.ts` already does for migration 164.
--
-- ── IT IS ADDITIVE ONLY, AND THAT IS THE POINT ─────────────────────────────
--
-- One new table, two new indexes, one comment. It contains no ALTER against an
-- existing table, no rename, no drop, and no NOT NULL applied to data that
-- already exists — every NOT NULL below is on a column of a table being
-- created in the same statement, where there are no rows to violate it. An
-- application running the OLD code against a database with this migration
-- applied behaves identically, because nothing outside this feature reads or
-- writes the table.
--
-- ── WHY A TABLE OF ITS OWN ─────────────────────────────────────────────────
--
-- Two existing homes were considered first, and both are wrong.
--
-- `training_plans.adaptation_log` stores `{"n": 1, "ts": "..."}`, which
-- CLAUDE.md Rule 21 names directly: "a log that records that something happened
-- but not what is not a log." It is also keyed to a plan row, and a queued
-- deferral has to survive a plan rebuild to be worth anything. A rebuild is
-- precisely the moment a deferred progression is most likely to be silently
-- lost, so storing the queue inside the thing that gets rebuilt would defeat
-- the mechanism at its most important moment.
--
-- `coach_intents` is a RUNNER-FACING surface. A deferral is internal engine
-- state. Writing one there would put a proposal the runner never asked about in
-- front of the runner, which is the "forced goal decision" failure mode
-- CLAUDE.md already rules out for a neighbouring mechanism ("the coach
-- projects, it never renegotiates a stated goal ... via a card").
--
-- So: a table of its own, alongside `canonical_adaptation_shadow_log`
-- (migration 164), which is the same engine's other durable surface and made
-- the same argument for the same reason.
--
-- ── WHAT AN EXPIRY MEANS HERE ──────────────────────────────────────────────
--
-- Rows are NEVER deleted. An item that leaves the queue is stamped with
-- `expired_at` and `expiry_reason`, because "this deferral was retired because
-- the block ended" and "this deferral silently vanished" are different facts
-- and only one of them is recoverable afterwards. The live queue is the rows
-- where `expired_at IS NULL`.

CREATE TABLE IF NOT EXISTS canonical_adaptation_deferrals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Rule 14 · the population this row belongs to, stated. Never `user_id`.
  user_uuid             uuid NOT NULL,
  plan_version          text NOT NULL,
  evidence_version      text NOT NULL,

  lever                 text NOT NULL
                          CHECK (lever IN ('THRESHOLD_PACE', 'WEEKLY_VOLUME', 'LONG_RUN')),

  -- The proposal, exactly as the lever made it.
  before_value          double precision NOT NULL,
  proposed_after_value  double precision NOT NULL,
  magnitude             jsonb NOT NULL,

  -- Rule 21 · what it did, in which direction, and on what evidence.
  evidence              jsonb NOT NULL DEFAULT '[]'::jsonb,
  newest_evidence_iso   date,

  -- Why it was deferred: the code and the sentence.
  reason                text NOT NULL
                          CHECK (reason IN (
                            'WEEK_AT_DEMAND_CEILING',
                            'ONE_MATERIAL_LEVER_PER_CYCLE',
                            'ARBITRATED_AT_WEEKLY_BOUNDARY'
                          )),
  reason_detail         text NOT NULL,

  queued_at_iso         date NOT NULL,
  next_boundary_iso     date,

  -- The engine's own idempotency key, so a re-evaluation over unchanged
  -- evidence updates this row rather than queueing a second copy.
  idempotency_key       text NOT NULL,

  -- Nulls until the item leaves the queue. Never a DELETE.
  expired_at            timestamptz,
  expiry_reason         text
                          CHECK (expiry_reason IS NULL OR expiry_reason IN (
                            'EVIDENCE_WENT_STALE',
                            'SUPERSEDED_BY_LARGER_PROPOSAL',
                            'SUPERSEDED_BY_A_SMALLER_PROPOSAL',
                            'FRESH_EVIDENCE_NO_LONGER_SUPPORTS_IT',
                            'BLOCK_ENDED',
                            'PLAN_VERSION_CHANGED'
                          )),
  expiry_detail         text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- An expiry states a reason and a sentence, or it is not an expiry. The
  -- database refuses a row that says "gone" without saying why, which is the
  -- whole point of the queue (Rule 20: a rule with no gate is a hypothesis).
  CONSTRAINT canonical_adaptation_deferrals_expiry_is_explained
    CHECK ((expired_at IS NULL AND expiry_reason IS NULL AND expiry_detail IS NULL)
        OR (expired_at IS NOT NULL AND expiry_reason IS NOT NULL
            AND expiry_detail IS NOT NULL AND length(expiry_detail) > 0))
);

-- One LIVE queue entry per (athlete, lever, evidence). Re-evaluating the same
-- evidence at successive boundaries must refresh the row, never grow the queue.
--
-- PARTIAL, on `expired_at IS NULL`, and the partiality is load-bearing rather
-- than an optimisation. Rows here are never deleted: an item that leaves the
-- queue is stamped with a reason and kept, because "retired because the block
-- ended" and "silently vanished" are different facts and only one of them is
-- recoverable afterwards. A TOTAL unique index would put those two
-- requirements in direct conflict — the expired row would occupy the identity,
-- so re-queueing the same (athlete, lever, evidence) later could only succeed
-- by UPDATING the expired row back to live, which erases the expiry it was
-- kept to record. Partial, the history accumulates and at most one row per
-- identity is ever live.
CREATE UNIQUE INDEX IF NOT EXISTS canonical_adaptation_deferrals_live_identity
  ON canonical_adaptation_deferrals (user_uuid, lever, idempotency_key)
  WHERE expired_at IS NULL;

-- The read the reconsideration pass makes: this athlete's LIVE queue, oldest
-- boundary first.
CREATE INDEX IF NOT EXISTS canonical_adaptation_deferrals_live
  ON canonical_adaptation_deferrals (user_uuid, next_boundary_iso)
  WHERE expired_at IS NULL;

COMMENT ON TABLE canonical_adaptation_deferrals IS
  'Canonical Adaptation Engine · progressions deferred by arbitration, kept until a '
  'boundary reconsiders them. Rows are never deleted: an item that leaves the queue is '
  'stamped with expired_at and a stated expiry_reason. SHADOW-ONLY: nothing reads this '
  'table to change a plan, and AUTOMATIC_ADAPTATION_AUTHORITY remains false. Not applied '
  'to production as of 2026-09-04.';
