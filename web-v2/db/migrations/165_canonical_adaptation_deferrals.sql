-- 165_canonical_adaptation_deferrals.sql
--
-- ══════════════════════════════════════════════════════════════════════════
-- DELIBERATELY UNAPPLIED. NOTHING RUNS THIS.
-- ══════════════════════════════════════════════════════════════════════════
--
-- Written 2026-09-04 alongside `lib/adaptation/canonical/deferral-queue.ts`,
-- and left unapplied on purpose. CLAUDE.md's operational boundary is explicit:
-- code changes deploy on approval, DDL and data writes need the owner's
-- separate, explicit, per-statement go. No statement in this file has been
-- executed against any database, no application code reads this table, and the
-- deferral queue is in memory until it is.
--
-- To apply, when that decision is made:
--
--     psql $DATABASE_URL -f web-v2/db/migrations/165_canonical_adaptation_deferrals.sql
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

-- One live queue entry per (athlete, lever, evidence). Re-evaluating the same
-- evidence at successive boundaries must refresh the row, never grow the queue.
CREATE UNIQUE INDEX IF NOT EXISTS canonical_adaptation_deferrals_identity
  ON canonical_adaptation_deferrals (user_uuid, lever, idempotency_key);

-- The read the reconsideration pass makes: this athlete's LIVE queue, oldest
-- boundary first.
CREATE INDEX IF NOT EXISTS canonical_adaptation_deferrals_live
  ON canonical_adaptation_deferrals (user_uuid, next_boundary_iso)
  WHERE expired_at IS NULL;

COMMENT ON TABLE canonical_adaptation_deferrals IS
  'Canonical Adaptation Engine · progressions deferred by arbitration, kept until a '
  'boundary reconsiders them. Rows are never deleted: an item that leaves the queue is '
  'stamped with expired_at and a stated expiry_reason. UNAPPLIED as of 2026-09-04.';
