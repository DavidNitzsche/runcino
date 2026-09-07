-- 169_runner_beliefs.sql
--
-- ══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED TO PRODUCTION. APPLIED AND EXERCISED ON A LOCAL SCRATCH DB
-- (`faff_roundtrip_scratch`, loopback, created for the purpose).
-- ══════════════════════════════════════════════════════════════════════════
--
-- Approval packet, statement by statement, with rollback SQL and verification
-- queries: docs/reports/brain-2026-09-05/MIGRATION-PACKET.md, ADDENDUM 3.
--
-- ── WHY THIS EXISTS ────────────────────────────────────────────────────────
--
-- Steps 1 ("load canonical runner state") and 5 ("update beliefs") of
-- `lib/brain/orchestration/steps.ts`'s sixteen-step orchestrator have no
-- durable store: `belief.ts` is a shape with no table behind it,
-- `ownership.ts` and `quantity-owners.ts` are surveys of who ANSWERS each
-- question, and none of the three persists an answer anywhere. A plan
-- rebuild archives `training_plans` and starts a fresh row; nothing today
-- carries a belief across that boundary — the exact gap CLAUDE.md names for
-- `plan_decision_ledger`'s own `plan_lineage_id` column, one level up.
--
-- This table is the schema ONLY. `lib/runner-state/store/schema.ts#
-- ensureBeliefStoreSchema` is this file's literal source of truth — this
-- migration is a byte-for-byte transcription of that function's CREATE TABLE
-- and two indexes, run through `assertScratchDatabase` on every scratch
-- invocation so the two can never drift silently. It contains no coaching
-- logic, no belief computation and no owner call.
--
-- ── WHY ONE APPEND-ONLY TABLE AND NOT AN UPSERT ────────────────────────────
--
-- `plan_decision_ledger` (Rule 6) already settled this shape for a sibling
-- problem: rows are never deleted and never rewritten in place, because an
-- append-only table cannot lose a belief to a race between a reader and a
-- writer, and "what did we believe on that Tuesday" is itself a question
-- worth being able to answer later. There is ONE write path (`INSERT`,
-- `lib/runner-state/store/write.ts`) and the CURRENT belief is defined as the
-- newest row per `(user_uuid, registry, belief_key)` — `read.ts`'s
-- `readLatestBelief`. No `UPDATE` anywhere in the owning directory.
--
-- ── WHY `plan_lineage_id` AND NOT `plan_id` ────────────────────────────────
--
-- A plan rebuild changes `training_plans.id`. It does not change the runner.
-- `lib/brain/ledger/decision-ledger.ts#resolvePlanLineage` already solved
-- exactly this for the decision ledger, and `lib/runner-state/store/
-- lineage.ts` reuses that function rather than re-deriving the chase.
-- `plan_lineage_id` is NOT NULL for the same reason the ledger's column is:
-- a belief with no plan at all still belongs to a runner, and
-- `orphan:<user uuid>` says so plainly instead of inventing a plan id.
--
-- ── ADDITIVE ONLY ───────────────────────────────────────────────────────────
--
-- One new table, two new indexes. No ALTER, no rewrite, no backfill.
-- Nothing existing is touched. Applying this migration cannot change the
-- answer any existing query returns.
--
-- ── RUNTIME BEHAVIOUR BEFORE THIS APPLIES ──────────────────────────────────
--
-- `lib/runner-state/store/schema.ts#beliefsTableExistsCheck` (ORCHESTRATIONWIRE-1,
-- 2026-09-06) probes for this table before every read or write, mirroring
-- `plan_decision_ledger`'s three-state probe. `app/api/cron/run-adaptations/
-- route.ts` already calls `updateRunnerBeliefs` for every active runner, every
-- night — every single call answers the declared, honest `absent` refusal
-- until this migration lands, reported via the `belief_store_pass` ops alert
-- rather than thrown as a raw SQL error into the rest of that runner's pass.
-- The moment this migration is applied, the next cron pass starts writing.

-- MIGRATIONTXN-1 (2026-09-07) · explicit transaction, same argument as
-- 166's own MIGRATIONTXN-1 note: the table, two indexes and one comment
-- below are individually atomic but not atomic as a batch without this.
-- (`ensureBeliefStoreSchema`, the application-code twin this file is a
-- transcription of, runs its own single CREATE TABLE statement outside any
-- migration file and is unaffected by this wrap either way.)
BEGIN;

CREATE TABLE IF NOT EXISTS runner_beliefs (
  id                 bigserial PRIMARY KEY,
  user_uuid          uuid NOT NULL,
  -- 'BELIEF' keys into belief.ts's BeliefKey vocabulary (a runner FACT).
  -- 'QUANTITY' keys into quantity-owners.ts's QuantityId vocabulary (a
  -- PRESCRIPTION ceiling derived from one or more BELIEF rows). Never
  -- conflated: a query that wants "does this runner's threshold pace
  -- belief exist" and one that wants "what is this week's threshold dose
  -- ceiling" ask different registries on purpose.
  registry           text NOT NULL CHECK (registry IN ('BELIEF', 'QUANTITY')),
  belief_key         text NOT NULL,
  -- Rule 10 · the anchor. What this reading was computed FROM, so a row
  -- read back later carries the physiological/plan basis it was derived
  -- against rather than presenting a bare number as timeless.
  plan_lineage_id    text NOT NULL,
  -- Rule 11 · three facts, never one. reading_ok = false means an
  -- honestly-stated ABSENT or FAILED, carried in reading_absent_reason.
  -- It is a CHECK, not a convention: a row cannot claim both.
  reading_ok         boolean NOT NULL,
  reading_value      jsonb,
  reading_absent_reason jsonb,
  CHECK (
    (reading_ok = true  AND reading_value IS NOT NULL AND reading_absent_reason IS NULL) OR
    (reading_ok = false AND reading_value IS NULL AND reading_absent_reason IS NOT NULL)
  ),
  confidence         double precision CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source_mode        text,
  supporting         jsonb NOT NULL DEFAULT '[]'::jsonb,
  contradicting      jsonb NOT NULL DEFAULT '[]'::jsonb,
  tension            jsonb,
  recency            jsonb,
  rule8_side         text NOT NULL CHECK (rule8_side IN ('HABIT', 'ABSORBED_LOAD', 'NEITHER')),
  moves_up_on        jsonb NOT NULL DEFAULT '[]'::jsonb,
  moves_down_on      jsonb NOT NULL DEFAULT '[]'::jsonb,
  never_moves_on     jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_module       text NOT NULL,
  owner_symbol       text NOT NULL,
  owner_answers      text NOT NULL,
  -- Rule 10 · when the underlying owner resolved this, which may be
  -- earlier than stored_at when a loader batches several beliefs off
  -- one shared resolution.
  computed_at        timestamptz NOT NULL,
  model_version      text NOT NULL,
  stored_at          timestamptz NOT NULL DEFAULT now()
);

-- The read path is always "newest row for this runner+key" — one index
-- carries every query this directory issues.
CREATE INDEX IF NOT EXISTS runner_beliefs_latest_idx
  ON runner_beliefs (user_uuid, registry, belief_key, stored_at DESC);

-- The rebuild-survival query groups by lineage, never by plan_id.
CREATE INDEX IF NOT EXISTS runner_beliefs_lineage_idx
  ON runner_beliefs (user_uuid, plan_lineage_id);

COMMENT ON TABLE runner_beliefs IS
  'Steps 1/5 · the durable belief store. Append-only; the current belief is '
  'the newest row per (user_uuid, registry, belief_key). A reading_ok=false '
  'row is an honest refusal, never a coerced zero.';

COMMIT;
