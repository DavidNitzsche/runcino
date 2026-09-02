-- 161 · adaptation_shadow_log · widen the convergence_state CHECK to the
-- guard's fifth state.
--
-- NOT APPLIED as of 2026-09-02. Queued for the owner's explicit per-statement
-- go (CLAUDE.md · deployment doctrine: DDL needs a separate explicit go).
-- Additive, reversible (the previous constraint is restored by the DOWN block
-- at the bottom), touches no row and no other table.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- Migration 160 created this table with
--   CHECK (convergence_state IN ('AUTHORED_CANONICALLY', 'REANCHORED_CANONICALLY',
--                                'AUTHORED_TOO_RECENTLY', 'REANCHOR_STATUS_UNKNOWN'))
-- and later the same day `lib/adaptation/authoring-convergence.ts` gained a
-- fifth state, CANNOT_CONVERGE_NO_CANONICAL_PRICING (CANNOT-CONVERGE-1), which
-- the independent audit found was the MAJORITY state in production. Every
-- shadow-compare cycle resolving to that state has since failed its INSERT
-- with SQLSTATE 23514 and been dropped with a console warning — so the one
-- convergence state a promotion review most needs to see is the one the log
-- cannot hold. `lib/adaptation/shadow-compare.ts` now raises an ops alert on
-- that violation (Rule 23), and `lib/adaptation/_shadow_log_schema.test.ts`
-- fails the build if the guard's state union ever again outgrows the latest
-- CHECK in this directory.
--
-- ── UP ───────────────────────────────────────────────────────────────────

ALTER TABLE adaptation_shadow_log
  DROP CONSTRAINT IF EXISTS adaptation_shadow_log_convergence_state_check;

ALTER TABLE adaptation_shadow_log
  ADD CONSTRAINT adaptation_shadow_log_convergence_state_check
  CHECK (convergence_state IN (
    'AUTHORED_CANONICALLY', 'REANCHORED_CANONICALLY',
    'AUTHORED_TOO_RECENTLY', 'REANCHOR_STATUS_UNKNOWN',
    'CANNOT_CONVERGE_NO_CANONICAL_PRICING'
  ));

-- ── DOWN (manual) ────────────────────────────────────────────────────────
-- ALTER TABLE adaptation_shadow_log
--   DROP CONSTRAINT IF EXISTS adaptation_shadow_log_convergence_state_check;
-- ALTER TABLE adaptation_shadow_log
--   ADD CONSTRAINT adaptation_shadow_log_convergence_state_check
--   CHECK (convergence_state IN (
--     'AUTHORED_CANONICALLY', 'REANCHORED_CANONICALLY',
--     'AUTHORED_TOO_RECENTLY', 'REANCHOR_STATUS_UNKNOWN'
--   ));
-- (DOWN would refuse if any row already carries the fifth state; delete or
-- relabel those rows first, deliberately, never as a side effect.)
