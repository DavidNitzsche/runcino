-- 160_adaptation_shadow_log.sql
-- Adaptation Engine · PACE-only shadow-compare persistence.
--
-- Authorized by docs/PRODUCT_DECISIONS.md 2026-09-01 §2 ("Persists proposed
-- before/after values and reasons"). Drafted as additive-only DDL, reviewed
-- against CLAUDE.md's DDL rule and the seven criteria the account owner
-- named, and APPLIED with his explicit go — see
-- docs/reports/shadow-log-production-2026-09-01.md §1 for the criterion-by-
-- criterion review. See docs/reports/pace-shadow-compare-2026-09-01.md §2
-- for why no EXISTING table was a safe additive-only home:
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
-- ── THE SEVEN-CRITERION REVIEW (2026-09-01, before this migration ran) ─────
--
--   1. No changes to live plan behavior · CREATE TABLE only. Nothing here
--      touches plan_workouts, training_plans, or any table a live surface
--      reads. `_shadow_compare.audit.test.ts` proves the writer side too
--      (RO-role fence + before/after plan_workouts checksum).
--   2. No triggers or consumers that can mutate plans · no trigger is
--      defined on this table, and grep across web-v2 confirms nothing
--      reads `adaptation_shadow_log` except `shadow-compare.ts` itself (the
--      writer) and the retention prune cron (DELETE only, on this table
--      alone).
--   3. Bounded growth + an explicit retention policy · see RETENTION below
--      — this was MISSING from the original draft and added before this
--      migration ran, not patched in after.
--   4. Idempotent deployment · CREATE TABLE IF NOT EXISTS / CREATE INDEX IF
--      NOT EXISTS throughout; re-running this file is a no-op.
--   5. Appropriate access controls · verified empirically, not assumed:
--      `faff_readonly` (DATABASE_URL_RO) gets SELECT on a freshly-created
--      table with NO explicit GRANT in the migration (confirmed against
--      migration 159's `travel_windows` on prod — `has_table_privilege
--      ('faff_readonly','travel_windows','SELECT') = true`,
--      `..., 'INSERT') = false`, and no `ALTER DEFAULT PRIVILEGES` row
--      exists for it, so the role's own grant is the mechanism, not a
--      per-migration statement). The same access shape applies here by
--      construction — no additional GRANT needed, and none is present.
--   6. Safe rollback or disablement · REVERSED BY, below. Disablement needs
--      no DDL at all: `persistShadowCompareRecord`'s table-probe cache
--      means removing the cron's call site (or the table itself) silently
--      falls back to a no-op "skipped" result — the mechanism was already
--      built to degrade gracefully around this table's presence.
--   7. No interference with existing proposal or measurement tables · this
--      table is read by nothing else and references two existing tables
--      (`users`, `training_plans`) by FOREIGN KEY only, in the direction
--      that lets THIS table be dropped without touching either.
--
-- ── RETENTION (added during the review above, criterion 3) ─────────────────
--
-- Bounded growth: ~1 row per active plan per eligible cron cycle (currently
-- daily), so an account accumulates roughly 365 rows/year absent pruning.
-- Two independent bounds, enforced by `pruneAdaptationShadowLog()`
-- (`lib/adaptation/shadow-log-retention.ts`), run nightly by
-- `/api/cron/prune-adaptation-shadow-log`:
--
--   · TIME · rows older than `ADAPTATION_SHADOW_LOG_RETENTION_DAYS` (180,
--     comfortably longer than one marathon block plus its review window)
--     are deleted.
--   · COUNT · a hard per-user cap (400 rows) as a backstop against a bug
--     that inserts more than once per cycle — belt-and-suspenders, since
--     180 daily rows never approaches 400 under correct operation.
--
-- Both are DELETE-only, scoped to this table alone, and idempotent — re-
-- running the prune after it has already caught up deletes nothing further.
-- The prune job is deliberately NOT registered in `lib/ops/cron-ledger.ts`'s
-- CRON_JOBS catch-up chain (it is in EXCLUDED_FROM_TICK, with its reason
-- argued there): nothing downstream depends on this table's freshness, so a
-- late prune costs a slightly larger table for a day, never a wrong answer.
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/160_adaptation_shadow_log.sql
-- REVERSED BY: DROP TABLE IF EXISTS adaptation_shadow_log;

CREATE TABLE IF NOT EXISTS adaptation_shadow_log (
  id                  bigserial PRIMARY KEY,
  user_uuid           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The active plan this cycle read, when one existed. Nullable: a cycle can
  -- run (and refuse) before a plan resolves at all. ON DELETE CASCADE mirrors
  -- every other child of training_plans (plan_phases/plan_weeks/
  -- plan_workouts) — a plan's shadow history has no meaning once the plan
  -- itself is gone.
  plan_id             text REFERENCES training_plans(id) ON DELETE CASCADE,
  today_iso           date NOT NULL,
  resolved_at         timestamptz NOT NULL DEFAULT now(),
  model_version       text NOT NULL,

  -- ── Part 3 · authoring/reanchor convergence guard ─────────────────────
  -- See lib/adaptation/authoring-convergence.ts for the four-state read.
  -- `plan_authored_iso` / `last_canonical_reanchor_at` are carried alongside
  -- the derived `convergence_state` (Rule 10 — a persisted derived value
  -- carries its anchor) so a later audit can re-derive the classification
  -- without trusting this row's own label.
  plan_authored_iso            timestamptz,
  last_canonical_reanchor_at   timestamptz,
  convergence_state            text NOT NULL DEFAULT 'REANCHOR_STATUS_UNKNOWN'
    CONSTRAINT adaptation_shadow_log_convergence_state_check
    CHECK (convergence_state IN (
      'AUTHORED_CANONICALLY', 'REANCHORED_CANONICALLY',
      'AUTHORED_TOO_RECENTLY', 'REANCHOR_STATUS_UNKNOWN'
    )),
  convergence_detail           text,

  -- ── phase and workout family affected ──────────────────────────────────
  -- `workout_family` names the session types the PACE lever prices
  -- (threshold/tempo/cruise — fixed by the lever's own scope, carried as
  -- data rather than assumed so a reader never has to know that fact from
  -- code). `phase_breakdown` is the full PacePhaseOutcome[] array (Part 1
  -- of the 2026-09-01 decision — never a blended average).
  -- `phases_moved` is the cheap-to-query summary of it.
  workout_family      text[] NOT NULL DEFAULT ARRAY['threshold','tempo','cruise'],
  phase_breakdown     jsonb NOT NULL DEFAULT '[]'::jsonb,
  phases_moved        text[] NOT NULL DEFAULT '{}',

  -- ── the new engine's RAW PACE decision this cycle (before the HR
  --    compatibility check below is applied) ─────────────────────────────
  engine_decision      text NOT NULL,
  engine_reason_codes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine_explanation   text,
  engine_previous      jsonb,           -- PaceMagnitude | null
  engine_proposed      jsonb,           -- PaceMagnitude | null
  engine_confidence    double precision,
  engine_refusals      jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── the shadow pipeline's OWN final call, after Part 4's HR compatibility
  --    check is applied to `engine_decision` — a SEPARATE fact from it, per
  --    the decision doc: "MATERIAL_INCOMPATIBILITY... DOES refuse the pace
  --    proposal — the shadow record's decision should reflect a refusal,
  --    not a silent pass-through." `engine_decision` is never overwritten
  --    (it stays the traceable, literal PACE-engine output); this is where
  --    the refusal actually shows up. Equal to `engine_decision` whenever
  --    HR compatibility does not refuse.
  final_decision        text,
  final_decision_reason text,

  -- ── capacity belief, evidence mode, confidence, evidence dates ─────────
  -- `capacity_belief` is resolveThresholdCapacity()'s own output verbatim
  -- (paceSecPerMi, vdot, confidence, sourceMode, evidenceIds, reasons).
  -- `evidence_mode` duplicates sourceMode as its own column so a dashboard
  -- query never has to reach into the jsonb for the single most-filtered
  -- field. `evidence_dates` maps each evidenceId to the date it was
  -- observed, where resolvable.
  capacity_belief       jsonb,
  evidence_mode         text,
  evidence_dates        jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── representative and excluded observations ───────────────────────────
  -- The Rule 8 / normal-window split: which quality sessions actually
  -- contributed to this cycle's read, and how many were excluded by the
  -- representative-lookback filter (with the aggregate window numbers
  -- EvidenceLookback already computes — never re-derived here).
  representative_observations  jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_observations        jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── Part 4 · pace/HR compatibility result ──────────────────────────────
  hr_compat_verdict     text
    CONSTRAINT adaptation_shadow_log_hr_compat_verdict_check
    CHECK (hr_compat_verdict IS NULL OR hr_compat_verdict IN (
      'COMPATIBLE', 'COMPATIBLE_ENVIRONMENTAL_EXPLAINED',
      'COMPATIBLE_HR_CEILING_LIKELY_STALE', 'INSUFFICIENT_HR_EVIDENCE',
      'INCOMPATIBLE_REFUSE'
    )),
  hr_compat_reason      text,
  hr_compat_evidence    jsonb,

  -- ── contradictions surfaced this cycle ─────────────────────────────────
  -- e.g. the HR validator refusing a proposal the PACE engine itself would
  -- have progressed, or a convergence state of AUTHORED_TOO_RECENTLY on a
  -- cycle that otherwise reads PROGRESS. Never silently resolved — named.
  contradictions        jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── what the LIVE, mutating engine (lib/plan/adapt.ts) did this cycle ──
  live_training_lead_fired   boolean NOT NULL DEFAULT false,
  live_recompute_paces_fired boolean NOT NULL DEFAULT false,
  live_reason           text,
  agrees_with_live      boolean,

  -- ── zero-mutation proof, carried per-record rather than asserted only in
  --    a test ─────────────────────────────────────────────────────────────
  -- The SAME md5(string_agg(...)) checksum of the account's plan_workouts
  -- `_shadow_compare.audit.test.ts` uses, taken immediately before and
  -- immediately after this cycle's own reads. Equal-and-non-null is the
  -- proof; a mismatch here in production would be the loudest possible
  -- signal that something in this "read-only" path started writing.
  mutation_checksum_before  text,
  mutation_checksum_after   text,
  zero_mutation_verified    boolean,

  source                text NOT NULL DEFAULT 'cron_run_adaptations_shadow'
);

CREATE INDEX IF NOT EXISTS adaptation_shadow_log_user_date_idx
  ON adaptation_shadow_log (user_uuid, today_iso);

CREATE INDEX IF NOT EXISTS adaptation_shadow_log_resolved_at_idx
  ON adaptation_shadow_log (resolved_at);

-- So a "readiness for authority" aggregate can cheaply exclude every
-- contaminated/unready record without a jsonb scan (Part 3's requirement:
-- such an aggregate must exclude AUTHORED_TOO_RECENTLY and
-- REANCHOR_STATUS_UNKNOWN rows, never silently average them in).
CREATE INDEX IF NOT EXISTS adaptation_shadow_log_convergence_idx
  ON adaptation_shadow_log (convergence_state);

COMMENT ON TABLE adaptation_shadow_log IS
  'Adaptation Engine PACE-lever shadow-compare log (docs/PRODUCT_DECISIONS.md '
  '2026-09-01 §2). Read-only observability: this table is written by '
  'lib/adaptation/shadow-compare.ts and pruned by '
  'lib/adaptation/shadow-log-retention.ts. Read by NOTHING live — no plan '
  'mutation anywhere reads it. Zero rows here should ever change a runner-'
  'visible number. Retention: 180 days or 400 rows/user, whichever binds '
  'first — see the header comment above for the full policy.';
