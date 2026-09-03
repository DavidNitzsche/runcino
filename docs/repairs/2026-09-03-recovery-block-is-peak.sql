-- ───────────────────────────────────────────────────────────────────────────
-- REPAIR · recovery-block weeks stamped `is_peak = TRUE`
-- Raised by the canonical Adaptation Engine replay, finding 6.
-- Prepared 2026-09-03. NOT EXECUTED · needs David's explicit per-statement go.
--
-- WHAT IS WRONG
--   `planWeekFlags` (web-v2/lib/plan/generate.ts) marked the highest-mileage
--   NON-RACE week as the block peak. A post-race recovery block is a REVERSE
--   taper — `RECOVERY_WEEKLY_PCT_OF_BASE` rises every week for every distance —
--   so the argmax of a recovery block is always its last week, and the engine
--   recorded a prescribed post-race recovery week as the runner's PEAK.
--
--   Rule 8: "It cannot look at taper and recover as my 'normal'. Ever."
--   A peak stamp is the strongest possible statement that a week WAS the
--   normal, and it is on four prescribed recovery weeks.
--
-- SCOPE · measured on production 2026-09-03 via `faff_readonly`
--   43 `is_peak = TRUE` rows in total; exactly 4 are wrong, all of them
--   `training_plans.mode = 'recovery'` with `plan_phases.label = 'RECOVERY'`.
--   No taper week and no race week is wrongly stamped.
--
--     pln_36fe43db78fe177d  wk 1  2026-08-24
--     pln_eb73331e19230ad9  wk 1  2026-08-24   <- day after the A-race half
--     pln_974c307d22ee0f61  wk 1  2026-08-24   <- single-week block
--     pln_0e635603799fd7b1  wk 0  2026-08-24   <- single-week block
--
--   All four plans are archived (`archived_iso IS NOT NULL`), so no live plan
--   surface reads them. They are NOT inert: the canonical engine replays
--   history, so these rows still reach `WeekObservation`.
--
-- THE WRITER IS ALREADY FIXED
--   PEAK-NOT-NONBUILDING-1 in `planWeekFlags`, gated by
--   `web-v2/lib/plan/_recovery_block_flags.test.ts` and guard 4 of
--   `scripts/check-normal-window.sh`. No new row can carry this. This file
--   repairs the four that already do.
--
-- NOT IN THIS FILE · `is_cutback`. It is FALSE on all six production recovery
--   weeks. Whether that is a defect is an open decision — see the handback
--   note; `non-building-week.ts` argues FALSE is correct and that the phase
--   label is the Rule 8 carrier. Do not bundle the two.
-- ───────────────────────────────────────────────────────────────────────────


-- ── STATEMENT 1 · VERIFY BEFORE (read-only) ────────────────────────────────
-- Expect exactly 4 rows, matching the list above.
SELECT w.id            AS week_id,
       w.plan_id,
       p.mode,
       (p.archived_iso IS NULL) AS active,
       w.week_idx,
       w.week_start_iso,
       w.is_peak,
       w.is_cutback,
       w.is_race_week,
       ph.label        AS phase
  FROM plan_weeks w
  JOIN training_plans p  ON p.id  = w.plan_id
  LEFT JOIN plan_phases ph ON ph.id = w.phase_id
 WHERE p.mode = 'recovery'
   AND w.is_peak IS TRUE
 ORDER BY p.authored_iso, w.week_idx;


-- ── STATEMENT 2 · THE REPAIR (write) ───────────────────────────────────────
-- Run only after statement 1 returns those 4 rows and nothing else.
-- Expect: UPDATE 4
--
-- Scoped by `p.mode = 'recovery'`, which is the AUTHORING INTENT of the plan
-- that wrote the week — the same witness `prescribedNonNormalWeek` resolves
-- toward. It is deliberately not scoped by the phase label, so a recovery plan
-- whose label was ever written differently is still repaired.
UPDATE plan_weeks w
   SET is_peak = FALSE
  FROM training_plans p
 WHERE w.plan_id = p.id
   AND p.mode    = 'recovery'
   AND w.is_peak IS TRUE;


-- ── STATEMENT 3 · VERIFY AFTER (read-only) ─────────────────────────────────
-- Expect 0 rows.
SELECT w.id AS week_id, w.plan_id, w.week_idx, w.is_peak
  FROM plan_weeks w
  JOIN training_plans p ON p.id = w.plan_id
 WHERE p.mode = 'recovery'
   AND w.is_peak IS TRUE;

-- Expect 39 (was 43, minus the 4 repaired). Reads the whole column rather than
-- the repaired slice, so a WHERE clause that matched too much is visible here.
SELECT count(*) AS total_peak_rows FROM plan_weeks WHERE is_peak IS TRUE;
