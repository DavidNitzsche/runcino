-- 161_pace_canary_applications.sql
-- Owner-only PACE canary · application audit trail (before/after row
-- snapshots, refusal reasons, rate-limit bookkeeping).
--
-- ── STATUS: DRAFTED, NOT APPLIED ────────────────────────────────────────────
--
-- Per CLAUDE.md's DDL rule ("DDL / data writes ... still require David's
-- explicit per-statement go before execution") and the task's own instruction
-- ("draft the migration but do NOT apply it; that's a separate authorization
-- from tonight's already-applied migration 160"), this file is a DRAFT ONLY.
-- It has NOT been run against production. `psql $DATABASE_URL_RO -c
-- "select to_regclass('public.pace_canary_applications')"` returns NULL as of
-- this commit — confirm that still holds before ever applying it.
--
-- This is also, independently, a real safety property and not just a
-- procedural one: the canary's write path (`lib/adaptation/pace-canary.ts`)
-- refuses with `PERSISTENCE_TABLE_MISSING` whenever this table does not
-- exist — see that file's header. So on production TODAY, even if the
-- `PACE_CANARY_ENABLED` env flag were somehow set and the allowlist
-- populated, the canary still cannot write a single row, because the table
-- this migration would create does not exist. Never applying this file is
-- itself a kill switch, requiring no deploy and no env change — mirroring
-- the graceful-degradation posture `db/migrations/160_adaptation_shadow_log.sql`
-- / `lib/adaptation/shadow-compare.ts` already established.
--
-- Reviewed, before ever being proposed for application, against the same
-- seven criteria migration 160's header used (see that file for the model):
--
--   1. No changes to live plan behavior · CREATE TABLE only. Nothing here
--      touches plan_workouts, training_plans, or any table a live surface
--      reads by default. The one thing this table's PRESENCE changes is
--      whether `lib/adaptation/pace-canary.ts` is even ABLE to write --
--      and it can only write when the separate `PACE_CANARY_ENABLED` env
--      flag and user allowlist are also both satisfied. Three independent
--      gates, not one.
--   2. No triggers or consumers that can mutate plans · no trigger defined.
--      Read by `lib/adaptation/pace-canary.ts` (rate-limit lookback,
--      rollback) and nothing else — grep confirms no other module names
--      this table.
--   3. Bounded growth + retention · at most ONE applied row per user per
--      7-day rate-limit window (enforced in code, see PACE_CANARY_RATE_LIMIT_
--      DAYS in pace-canary.ts), plus refusal rows on every ineligible cycle
--      -- bounded the same way `adaptation_shadow_log` is (one row per
--      eligible cron cycle). Given the canary starts scoped to exactly one
--      allowlisted account, growth is trivially bounded; the same 180-day /
--      400-row retention posture as migration 160 should be extended here
--      before this is ever applied at wider scope -- flagged, not built,
--      since this table has no live rows to retain yet.
--   4. Idempotent deployment · CREATE TABLE IF NOT EXISTS / CREATE INDEX IF
--      NOT EXISTS throughout.
--   5. Appropriate access controls · same posture as migration 160's own
--      empirically-verified claim (a freshly created table with no explicit
--      GRANT gives the `faff_readonly` role SELECT and not INSERT) --
--      RE-VERIFY empirically before ever applying, do not assume it still
--      holds.
--   6. Safe rollback/disablement · REVERSED BY, below. Disablement needs no
--      DDL: the code's table-probe (mirroring shadow-compare.ts) means an
--      absent table already means "cannot write" -- see the note above.
--   7. No interference with existing proposal/measurement tables · this
--      table is read by nothing else, and its only foreign keys are outward
--      (`users`, `training_plans`, `plan_workouts`), in the direction that
--      lets it be dropped without touching any of them.
--
-- Apply with (ONLY on explicit, separate authorization):
--   psql $DATABASE_URL -f web-v2/db/migrations/161_pace_canary_applications.sql
-- REVERSED BY: DROP TABLE IF EXISTS pace_canary_applications;

CREATE TABLE IF NOT EXISTS pace_canary_applications (
  id                    bigserial PRIMARY KEY,
  user_uuid             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id               text REFERENCES training_plans(id) ON DELETE CASCADE,
  today_iso             date NOT NULL,
  requested_at          timestamptz NOT NULL DEFAULT now(),

  -- 'applied' | 'refused' | 'rolled_back'. A refused cycle still gets a row
  -- -- Rule 20: a refusal that isn't recorded is a rule nobody can audit.
  status                text NOT NULL
    CONSTRAINT pace_canary_applications_status_check
    CHECK (status IN ('applied', 'refused', 'rolled_back')),

  -- ── why (always present; the reason a cycle was refused, or 'ELIGIBLE'
  --    for one that applied) ─────────────────────────────────────────────
  refusal_code          text,
  refusal_detail        text,

  -- ── what the PACE engine + shadow-compare pipeline said this cycle
  --    (Rule 8/11 traceability -- the full ShadowCompareRecord this
  --    application decision was made from, so an audit never has to
  --    re-derive "why did the canary think this was eligible") ──────────
  shadow_compare_record jsonb NOT NULL,

  -- ── the moving phases this application targeted (subset of
  --    shadow_compare_record.engine.phaseBreakdown where moved = true,
  --    after the operational canary cap -- see PACE_CANARY_MAX_STEP_SEC_
  --    PER_MI in pace-canary.ts, an ENGINEERING rollout limit, not a
  --    doctrine-cited physiological constant) ─────────────────────────────
  target_phase_labels   text[] NOT NULL DEFAULT '{}',

  -- ── complete before/after row snapshots, item 8 of the spec. Array of
  --    {id, dateIso, type, phaseLabel, paceTargetSPerMi} for every
  --    plan_workouts row this application touched (or would have touched,
  --    on a refused cycle -- empty array there). ──────────────────────────
  rows_before           jsonb NOT NULL DEFAULT '[]'::jsonb,
  rows_after            jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── post-write verification (item 10) -- re-read after commit, compared
  --    against the INTENDED after-values recorded above. True only when
  --    every row's live value matched what was written. Null on a refused
  --    cycle (nothing to verify). ───────────────────────────────────────
  post_write_verified   boolean,

  -- ── rollback (item 11) -- populated only when status = 'rolled_back' ──
  rolled_back_at         timestamptz,
  rollback_reason         text,

  -- ── the coach_intents row this application wrote in the same transaction
  --    (reason = 'plan_adapt_pace_canary_applied'), so the nightly reanchor
  --    defer mechanism (lib/training/pace-anchor.ts adapterMovedAnchorWithin)
  --    and this table agree on one fact rather than keeping two records of
  --    it (Rule 16). Null on a refused cycle. ─────────────────────────────
  coach_intent_written  boolean NOT NULL DEFAULT false,

  source                text NOT NULL DEFAULT 'cron_run_adaptations_pace_canary'
);

-- Rate-limit lookback (item 4: at most one APPLIED row per user per 7 days)
-- and the rollback lookup both filter on (user_uuid, status, requested_at) --
-- one index covers both.
CREATE INDEX IF NOT EXISTS pace_canary_applications_user_status_idx
  ON pace_canary_applications (user_uuid, status, requested_at DESC);

COMMENT ON TABLE pace_canary_applications IS
  'Owner-only PACE canary application audit trail (docs/reports/'
  'pace-canary-infrastructure-2026-09-01.md). DRAFTED, NOT YET APPLIED -- see '
  'this file''s header. Written by lib/adaptation/pace-canary.ts. Read by '
  'nothing else. The canary refuses to write PACE changes at all while this '
  'table does not exist -- its absence is itself a kill switch.';
