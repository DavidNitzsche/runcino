-- 164_canonical_adaptation_shadow_log.sql
-- The CANONICAL Adaptation Engine's own shadow-evaluation log — a SEPARATE
-- table from `adaptation_shadow_log` (migration 160/161). This header argues
-- why, since a reader auditing this migration should not have to trust the
-- application-code comment that made the same call.
--
-- ── WHY NOT EXTEND `adaptation_shadow_log` ─────────────────────────────────
--
-- `adaptation_shadow_log` is the PACE-only shadow-compare mechanism
-- (docs/PRODUCT_DECISIONS.md 2026-09-01 §2, `lib/adaptation/shadow-compare.ts`),
-- and its schema is column-level COUPLED to that mechanism specifically:
-- `hr_compat_verdict`'s CHECK enumerates `lib/adaptation/pace-hr-compatibility
-- .ts`'s own verdicts, `convergence_state`'s CHECK enumerates
-- `authoring-convergence.ts`'s states, `workout_family` defaults to
-- threshold/tempo/cruise because that mechanism is scoped to PACE alone, and
-- `engine_decision` is typed against the OLDER `lib/adaptation/
-- adaptation-engine.ts`'s three-way vocabulary (PROGRESS / HOLD /
-- INSUFFICIENT_EVIDENCE).
--
-- The CANONICAL engine (`lib/adaptation/canonical/`) is a different system —
-- see CLAUDE.md's "three adaptation systems" note and
-- `docs/BRAIN_CONSTITUTION.md`'s ownership table — with a four-way decision
-- vocabulary (PROGRESS / HOLD / REGRESS / REFUSE), THREE levers rather than
-- one (THRESHOLD_PACE, WEEKLY_VOLUME, LONG_RUN), and a materially richer
-- record shape (`CanonicalDecisionRecord` in
-- `lib/adaptation/canonical/decision-record.ts`): a typed plan diff, a list
-- of invariant checks, a rollback descriptor, an evidence-included/excluded/
-- contradictory triad, and a suppression note. Bolting this onto
-- `adaptation_shadow_log` would mean either (a) leaving a fixed half of that
-- table's columns permanently null for every canonical-engine row and the
-- other fixed half null for every pace-shadow-compare row, or (b) growing
-- the table with a second, parallel set of canonical-only columns beside the
-- pace-only ones. Both make "a row in adaptation_shadow_log" answer TWO
-- DIFFERENT QUESTIONS depending on which columns happen to be populated —
-- exactly the shape CLAUDE.md Rule 16 ("one quantity, one name") names as a
-- defect, and the exact ambiguity that migration 160's own header already
-- refused to accept when it declined to reuse `plan_proposals` /
-- `coach_intents` / `training_plans.adaptation_log` for the SAME reason
-- (different consumer shape, different measurement purpose).
--
-- A dedicated table keeps `adaptation_shadow_log` meaning exactly one thing
-- (the pace-only intermediate mechanism) and this table meaning exactly one
-- other thing (the canonical engine's full per-lever decision record), and
-- costs nothing extra to build: same additive-only DDL, same RO-role
-- SELECT-by-default access, same retention posture, same disablement
-- mechanism (a table-existence probe the persistence code already treats as
-- a soft dependency).
--
-- ── SHAPE: ONE ROW PER (ATHLETE, EVALUATION CYCLE, LEVER) ──────────────────
--
-- `evaluateAdaptation()` returns exactly one `CanonicalDecisionRecord` per
-- lever on every call (never zero, per that function's own header — "an
-- engine that returns nothing when it cannot decide is indistinguishable
-- from an engine that was never called"). So a live evaluation cycle writes
-- exactly THREE rows, one per lever, each carrying its own idempotency key.
-- This is the natural grain of `CanonicalDecisionRecord` itself, which
-- already keys on `athlete · plan version · evidence version · lever ·
-- evaluation boundary` — reusing that as the natural row identity rather
-- than inventing a second one.
--
-- ── THE SEVEN-CRITERION REVIEW (mirrors migration 160's) ───────────────────
--
--   1. No changes to live plan behavior · CREATE TABLE only. The canonical
--      engine is pure (`lib/adaptation/canonical/_cannot_mutate.test.ts`
--      proves it from source) and the ONE authorized live caller
--      (`lib/adaptation/canonical-shadow/run-live-shadow-evaluation.ts`)
--      writes to this table alone, through a client
--      (`shadow-log-writer.ts`) that is itself allow-listed to exactly one
--      INSERT shape against exactly this table name.
--   2. No triggers or consumers that can mutate plans · no trigger is
--      defined here, and nothing reads this table except the diagnostic
--      admin endpoint (`app/api/admin/canonical-adaptation-shadow`) and the
--      retention prune job — both read-only or DELETE-only respectively.
--   3. Bounded growth + retention · see RETENTION below.
--   4. Idempotent deployment · `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX
--      IF NOT EXISTS` throughout.
--   5. Appropriate access controls · same empirical basis migration 160
--      cites: a freshly created table with no explicit GRANT gets
--      `faff_readonly` SELECT and no INSERT, by the role's own default
--      privileges, not a per-migration statement.
--   6. Safe rollback or disablement · REVERSED BY below. Disablement needs
--      no DDL: `run-live-shadow-evaluation.ts` probes for the table before
--      writing and reports "skipped" rather than throwing if it is absent
--      (the same posture `persistShadowCompareRecord` already established).
--   7. No interference with existing proposal or measurement tables · reads
--      nothing but its own rows; references `users` and `training_plans` by
--      FOREIGN KEY only, in the direction that lets this table be dropped
--      without touching either.
--
-- ── RETENTION ────────────────────────────────────────────────────────────
--
-- Same policy shape as `adaptation_shadow_log`: 180 days, or a 1200-row-per-
-- user cap (three levers × 400, matching migration 160's per-user cap scaled
-- by lever count), whichever binds first. Enforced by
-- `lib/adaptation/canonical-adaptation-shadow-log-retention.ts` — kept OUTSIDE
-- `lib/adaptation/canonical-shadow/` deliberately, because that directory's
-- own gate (`_never_mutates_plan.test.ts`) allow-lists exactly one write
-- shape (a single INSERT via `shadow-log-writer.ts`), and a DELETE-based
-- retention job is a different write with a different authorization story —
-- run by `/api/cron/prune-adaptation-shadow-log`, the SAME route as the pace
-- table's prune, extended to prune both, rather than a second cron (Rule 23:
-- another schedule is another thing that can silently stop firing).
--
-- Apply with: psql $DATABASE_URL -f web-v2/db/migrations/164_canonical_adaptation_shadow_log.sql
-- REVERSED BY: DROP TABLE IF EXISTS canonical_adaptation_shadow_log;
--
-- NOT YET APPLIED to production as of this commit. Per CLAUDE.md's
-- deployment doctrine, DDL / data writes need David's explicit per-statement
-- go, separate from code-change approval. The persistence code in this
-- directory already degrades gracefully (a "skipped" result, not a crash)
-- when this table does not exist, so landing the code ahead of the DDL is
-- safe — the live shadow evaluation runs, computes, and reports "no
-- persistence table yet" until this migration is applied.

CREATE TABLE IF NOT EXISTS canonical_adaptation_shadow_log (
  id                  bigserial PRIMARY KEY,
  user_uuid           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id             text REFERENCES training_plans(id) ON DELETE CASCADE,

  -- ── identity and versioning, verbatim from CanonicalDecisionRecord ──────
  contract_version    text NOT NULL,
  plan_version        text NOT NULL,
  evidence_version     text NOT NULL,
  evaluated_at_iso     timestamptz NOT NULL,
  boundary             text NOT NULL
    CONSTRAINT canonical_shadow_log_boundary_check
    CHECK (boundary IN ('SESSION_COMPLETED', 'WEEKLY_BOUNDARY', 'EVIDENCE_CORRECTED')),
  idempotency_key      text NOT NULL,

  -- ── the question ────────────────────────────────────────────────────────
  lever                text NOT NULL
    CONSTRAINT canonical_shadow_log_lever_check
    CHECK (lever IN ('THRESHOLD_PACE', 'WEEKLY_VOLUME', 'LONG_RUN')),
  belief               jsonb NOT NULL,   -- CapacityBelief, verbatim (Rule 10: carries its own anchor)
  race                 jsonb NOT NULL,   -- RaceCalendar
  goal                 jsonb NOT NULL,   -- GoalRequirement
  gap                  text NOT NULL,

  -- ── the evidence ────────────────────────────────────────────────────────
  evidence_included    jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_excluded    jsonb NOT NULL DEFAULT '[]'::jsonb,
  contradictory        jsonb NOT NULL DEFAULT '[]'::jsonb,
  window_days          integer NOT NULL DEFAULT 0,
  confidence           jsonb NOT NULL,   -- ConfidenceStatement

  -- ── the change ──────────────────────────────────────────────────────────
  decision             text NOT NULL
    CONSTRAINT canonical_shadow_log_decision_check
    CHECK (decision IN ('PROGRESS', 'HOLD', 'REGRESS', 'REFUSE')),
  before_value          double precision NOT NULL,
  proposed_after_value  double precision,          -- null for HOLD / REFUSE
  magnitude             jsonb,                     -- Magnitude | null
  affected_workout_ids  text[] NOT NULL DEFAULT '{}',
  plan_diff             jsonb NOT NULL,             -- PlanDiff — NEVER applied, see header
  invariants            jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── the explanation ─────────────────────────────────────────────────────
  reason                 text NOT NULL,
  what_would_change_it   jsonb NOT NULL DEFAULT '[]'::jsonb,
  rollback               jsonb,                     -- RollbackInfo | null. Descriptive only:
                                                      -- nothing in this codebase ever reads this
                                                      -- column to apply it. Applying a canonical
                                                      -- proposal is out of scope for every mechanism
                                                      -- that can write here.
  suppressed_by          jsonb,                     -- SuppressionNote | null

  resolved_at            timestamptz NOT NULL DEFAULT now(),
  source                 text NOT NULL DEFAULT 'cron_run_adaptations_canonical_shadow'
);

CREATE INDEX IF NOT EXISTS canonical_adaptation_shadow_log_user_date_idx
  ON canonical_adaptation_shadow_log (user_uuid, evaluated_at_iso);

CREATE INDEX IF NOT EXISTS canonical_adaptation_shadow_log_lever_decision_idx
  ON canonical_adaptation_shadow_log (lever, decision);

-- Idempotency support: a caller building `previouslyEmittedKeys` for
-- `evaluateAdaptation()` (per its own doc comment) reads this cheaply rather
-- than scanning the whole table.
CREATE INDEX IF NOT EXISTS canonical_adaptation_shadow_log_idempotency_idx
  ON canonical_adaptation_shadow_log (user_uuid, idempotency_key);

COMMENT ON TABLE canonical_adaptation_shadow_log IS
  'The canonical Adaptation Engine''s (lib/adaptation/canonical/) own live '
  'shadow-evaluation log. One row per (athlete, evaluation cycle, lever) — '
  'exactly the CanonicalDecisionRecord shape evaluateAdaptation() returns. '
  'DISTINCT from adaptation_shadow_log, which is the older PACE-only '
  'shadow-compare mechanism (see this file''s own header for why they are '
  'separate tables). Written only by '
  'lib/adaptation/canonical-shadow/run-live-shadow-evaluation.ts, through a '
  'client allow-listed to exactly one INSERT shape against this table. Read '
  'by nothing live — no plan mutation anywhere reads this table, and nothing '
  'in this codebase applies plan_diff or rollback automatically. Retention: '
  '180 days or 1200 rows/user, whichever binds first.';
