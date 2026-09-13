-- 171_ledger_outcome_plan_verification_failed.sql
--
-- ══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED TO PRODUCTION. `plan_decision_ledger` (migration 166) is itself
-- not applied to production, so this widening has nothing to run against
-- there yet. It IS applied to the loopback scratch fixture
-- (`faff_roundtrip_scratch`, via `scripts/_build_roundtrip_scratch.sh`), which
-- is where `lib/plan/_mutation_read_honesty.db.test.ts` exercises it.
-- ══════════════════════════════════════════════════════════════════════════
--
-- ONE MEMBER, AND A REAL DEFECT.
--
-- `SWALLOWEDGUARD-1` (2026-09-13, `fix/archived-plan-guard-swallowed-failure`)
-- added a new `MutationOutcome` to `lib/plan/mutate.ts`:
--
--     plan_verification_failed
--
-- It is the Rule 11 third state for the archived-plan guard — "the read itself
-- failed, so nothing could be verified", as distinct from `no_plan` (a false
-- "archived" claim) and from letting the write through. CALLERHONESTY-1 /
-- CONTEXTREAD-1 (round 5) extended it to two further reads: the active-plan
-- fallback and the validator-context load.
--
-- 166's `mutation_outcome` CHECK was written before that outcome existed and
-- was never widened. So the ledger insert for exactly the refusal the fix
-- introduced fails its own constraint:
--
--     ERROR: new row for relation "plan_decision_ledger" violates check
--            constraint "plan_decision_ledger_mutation_outcome_check"
--
-- `landDecisionInLedger` contains that (lane B never throws), logs
-- `DECISION NOT RECORDED (failed)` and returns null — so the safety property
-- held (the mutation was still refused, the plan still did not move) and the
-- AUDIT property did not: the one refusal class the round-4 fix exists to make
-- visible was the one class that could never reach the table built to make
-- refusals visible. Verified by direct probe against the scratch fixture
-- before writing this file.
--
-- Not folded into 166 on purpose: 166 is under review for production approval
-- and 168's own header sets the rule — "extending it after the literal SQL was
-- submitted would invalidate that review."
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--     ALTER TABLE plan_decision_ledger
--       DROP CONSTRAINT IF EXISTS plan_decision_ledger_mutation_outcome_check;
--     ALTER TABLE plan_decision_ledger
--       ADD CONSTRAINT plan_decision_ledger_mutation_outcome_check
--       CHECK (mutation_outcome IS NULL OR mutation_outcome IN (
--         'applied', 'rejected', 'undeclared_structural', 'bypassed',
--         'authorship_drift', 'no_plan', 'not_attempted',
--         'ledger_unwritten', 'duplicate'));
--
-- Rolling back is only safe while no row carries the new member. Check first:
--     SELECT count(*) FROM plan_decision_ledger
--      WHERE mutation_outcome = 'plan_verification_failed';
--
-- ── VERIFICATION ────────────────────────────────────────────────────────────
--
--     SELECT pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conname = 'plan_decision_ledger_mutation_outcome_check';
--     -- must now contain 'plan_verification_failed'

DO $$
BEGIN
  IF to_regclass('public.plan_decision_ledger') IS NULL THEN
    RAISE NOTICE '171 · plan_decision_ledger is absent; nothing to widen.';
    RETURN;
  END IF;

  ALTER TABLE plan_decision_ledger
    DROP CONSTRAINT IF EXISTS plan_decision_ledger_mutation_outcome_check;

  ALTER TABLE plan_decision_ledger
    ADD CONSTRAINT plan_decision_ledger_mutation_outcome_check
    CHECK (mutation_outcome IS NULL OR mutation_outcome IN (
      'applied', 'rejected', 'undeclared_structural', 'bypassed',
      'authorship_drift', 'no_plan', 'not_attempted',
      'ledger_unwritten', 'duplicate',
      -- SWALLOWEDGUARD-1 / CALLERHONESTY-1 / CONTEXTREAD-1 · a read this
      -- boundary depends on threw, so nothing was established. Never the same
      -- fact as `no_plan`, which is a measured absence (Rule 11).
      'plan_verification_failed'));
END $$;
