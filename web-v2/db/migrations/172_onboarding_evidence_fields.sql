-- 172_onboarding_evidence_fields.sql
--
-- F074 · two of the three onboarding-evidence fixes need a place to land the
-- runner's raw answer. (The third — recent race time — needs NO new column;
-- it writes into `races.actual_result` through the existing race-evidence
-- pathway, per the 2026-09-14 coach-consult ruling
-- `for coaching consult/consult-log/2026-09-14-017-f074-onboarding-evidence-
-- doctrine.md`: "a recent race is a race, not a separate onboarding concept.")
--
-- Columns:
--
--   · effort_pace_sec_per_mi  — onboarding "known hard-effort pace" (native
--     OnboardingV5 `.effort` mode, "a pace you can hold for 20 minutes,
--     honestly"). Read by `lib/training/self-reported-pr.ts`'s
--     `readSelfReportedEffortPace` and threaded into
--     `lib/training/capacity-resolver.ts`'s threshold ladder as `user_prior`
--     evidence, at the mileage rung only — never `direct`/`inferred`.
--     Bounded loosely at the DB layer (any human running pace); the real
--     plausibility gate is the app-layer `PR_MIN/MAX_PLAUSIBLE_PACE_S_PER_MI`
--     band self-reported-pr.ts already enforces for typed PRs, reused as-is
--     (Rule 16 — one plausibility band, not two).
--
--   · history_layoff_weeks  — onboarding "time off" (native OnboardingV5
--     `.timeoff` mode, "weeks off"). The PRE-BREAK weekly mileage from the
--     same screen reuses the EXISTING `history_avg_weekly_mi` column
--     (migration 118) — it is the same quantity `.consistent` mode already
--     writes there (a self-reported representative weekly mileage), just
--     sourced from before a layoff instead of from an unbroken streak. This
--     migration adds only the one field neither existing column can carry:
--     how long the layoff was, which `capacity-resolver.ts`'s
--     `detrainingDiscountVdot` reads to haircut that mileage prior — Research/
--     01-pace-zones-vdot.md §"Field-test selection for the Coach" trigger
--     table: "Returning from layoff >=2 weeks | Drop 3-5 VDOT ... >=6 weeks |
--     Drop 5-8 VDOT". Bounded at 208 weeks (4 years) — beyond that the
--     self-report is describing "I used to run", not a resumable layoff, and
--     the mileage prior it would discount is already at the population floor.
--
-- Both nullable: absent means "the runner did not answer this question",
-- which must fall through to the existing rungs exactly as a missing
-- `history_avg_weekly_mi` already does (Rule 11 — never coerced to zero).
--
-- Idempotent — ADD COLUMN IF NOT EXISTS. NOT YET APPLIED to any database
-- (DDL requires David's explicit per-statement go per CLAUDE.md's deployment
-- doctrine, and he is unreachable as of this migration's authoring — see
-- `programme-internal-working/00-master-programme/
-- F074-ONBOARDING-EVIDENCE-FIXES-2026-09-14.md` for the full report). Apply
-- with:
--   psql $DATABASE_URL -f web-v2/db/migrations/172_onboarding_evidence_fields.sql

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS effort_pace_sec_per_mi INT
    CHECK (effort_pace_sec_per_mi IS NULL
           OR effort_pace_sec_per_mi BETWEEN 120 AND 1800),
  ADD COLUMN IF NOT EXISTS history_layoff_weeks INT
    CHECK (history_layoff_weeks IS NULL
           OR history_layoff_weeks BETWEEN 0 AND 208);

COMMENT ON COLUMN profile.effort_pace_sec_per_mi IS
  'Onboarding "known hard-effort pace" (.effort mode) · seconds per mile the
   runner says they can hold for ~20 minutes. Self-reported, never measured —
   consumed only as USER_PRIOR by capacity-resolver.ts, at the mileage rung.
   DB bound is a loose sanity check (2:00-30:00/mi); the real plausibility
   gate is PR_MIN/MAX_PLAUSIBLE_PACE_S_PER_MI in self-reported-pr.ts.';
COMMENT ON COLUMN profile.history_layoff_weeks IS
  'Onboarding "time off" (.timeoff mode) · weeks the runner reports being off
   before the pre-break weekly mileage in history_avg_weekly_mi. Feeds
   capacity-resolver.ts detrainingDiscountVdot (Research/01 layoff trigger
   table), scaled down to zero as real logged running arrives (the same
   evidenceCoverage complement that already retires the mileage prior).';
