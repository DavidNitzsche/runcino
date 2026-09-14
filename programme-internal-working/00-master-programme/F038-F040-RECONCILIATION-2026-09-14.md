# F038 / F040 reconciliation — 2026-09-14

**Task: does F038's fix (branch `fix/f038-evidence-clock-scoping-2026-09-14`,
commit `bbb3a39b4`) also fix F040's matching defect, in whole or in part, as a
side effect? Answered by LIVE EXECUTION of the real, unmodified post-F038
modules against `DATABASE_URL_RO` (read-only `faff_readonly` role,
`crossover.proxy.rlwy.net:20769/railway`), in an isolated git worktree
(`git worktree add … bbb3a39b4 --detach`, outside any shared checkout — no
other worktree or branch touched). No write of any kind issued against
`DATABASE_URL`. No fixtures, no reimplementation, no mocks — the literal
`buildLiveCanonicalInput`, `buildPrescriptionRunMatches`, `classifyDay`, and
`evaluateThresholdPace` functions, imported and called directly via `tsx`,
same method `F039-F040-SHADOWLOG-INVESTIGATION-2026-09-14.md` used.**

## Determination: **(b) — partial fix.** F038 closes F040's defect #2 for
## both named dates. It does NOT close defect #1 (the missing `version_rows`
## field) for 2026-09-01, and the reason is not the one the task's own
## hypothesis anticipated.

The task's hypothesis was: since `ownedDaysSql()`'s reign-stitching picks
"whichever plan's reign actually covered that date," and F040's own trace
showed the run's stamped `planWorkoutId` for 2026-09-08 names the OLD plan's
row, the reign-owner and the stamped row should be the SAME row — making
Pass 1a succeed directly, no `version_rows` needed.

**This is exactly true for 2026-09-08. It is NOT true for 2026-09-01 — and
the live data shows why, which the hypothesis (framed as one general
mechanism) did not anticipate: for 2026-09-01 the reign-owner row and the
run's stamped row are two DIFFERENT plan versions' rows for the SAME date,
neither of which is "wrong" — they just aren't the same row.**

---

## 1 · Live ground truth, queried raw (Rule 14: verify without the app's own
## filters first), before touching any application code

All `plan_workouts` rows for the two dates, across every plan version this
user has:

| date | row id | plan | plan authored → archived |
|---|---|---|---|
| 2026-09-01 | `wko_eaa8cfd7cb94310b` | `pln_9a57561debb776e5` | 08-31 → 09-03 |
| 2026-09-01 | `wko_470a1327c80a75c3` | `pln_7636bcc0a201bf2d` | 09-03 → 09-14 |
| 2026-09-08 | `wko_7d8d87c29fe046fa` | `pln_9a57561debb776e5` | 08-31 → 09-03 |
| 2026-09-08 | `wko_1cf8cd95971f2226` | `pln_7636bcc0a201bf2d` | 09-03 → 09-14 |
| 2026-09-08 | `wko_ce2271ef8a9e835f` | `pln_7da73e1da5ea7f6f` | 09-14 → (active) |

`ownedDaysSql()`'s reign logic (hand-run, same SQL `readOwnedPlanWorkouts`
issues), for these two dates specifically:

| date | reign-owner row | owning plan |
|---|---|---|
| 2026-09-01 | `wko_eaa8cfd7cb94310b` | `pln_9a57561debb776e5` (reign `[08-31, 09-03)` contains 09-01) |
| 2026-09-08 | `wko_1cf8cd95971f2226` | `pln_7636bcc0a201bf2d` (reign `[09-03, 09-14)` contains 09-08) |

The runs, as actually stamped:

| date | run id | `workoutType` | `planWorkoutId` stamped |
|---|---|---|---|
| 2026-09-01 | `-258355938987883` | `threshold` | `wko_470a1327c80a75c3` (the `pln_7636bcc0a201bf2d` row) |
| 2026-09-08 | `-75144899844434` | `tempo` | `wko_1cf8cd95971f2226` (the `pln_7636bcc0a201bf2d` row) |

**2026-09-08: reign-owner id (`wko_1cf8cd95971f2226`) == stamped id
(`wko_1cf8cd95971f2226`). Pass 1a matches directly, no alias needed.**

**2026-09-01: reign-owner id (`wko_eaa8cfd7cb94310b`) ≠ stamped id
(`wko_470a1327c80a75c3`).** The run was stamped against
`pln_7636bcc0a201bf2d`'s copy of 09-01's row — a plan whose OWN reign
(`[09-03, 09-14)`) does not even cover 2026-09-01 — not against the plan that
actually reigned on that calendar date (`pln_9a57561debb776e5`). Both rows
are real `plan_workouts` rows, both type `threshold`; the run simply carries
the id of a different plan version's copy of the same day than the one
reign-stitching picks. (Most likely mechanism, consistent with everything
else this investigation and F040 found: whatever stamped `planWorkoutId` at
completion/sync time resolved against the plan that was ACTIVE at that later
moment, not the plan that was active on the run's own calendar date — the
same "which plan's clock am I reading" confusion class F038 fixes elsewhere,
here appearing on the WRITE side rather than the read side. Not re-diagnosed
further here — out of scope for this reconciliation.)

This means F040's own general claim — "any run whose `planWorkoutId` names a
now-archived plan version's workout row … is unmatchable through this call
site" — has a corollary the report's two-date sample didn't need to
distinguish, but a live check does: **F038's reign-stitched row is not
guaranteed to be the SAME archived row the run is stamped against.** Two
archived plans can each carry a row for the same date; F038 picks the one
whose reign contains the date, but a run can be stamped against the other
one. `version_rows` (defect #1) is the ONLY mechanism that closes that gap,
because it aliases every version for the date, not just the reign-winner.

---

## 2 · Live execution, BEFORE the follow-up (F038 alone, exactly as it stands
## on `fix/f038-evidence-clock-scoping-2026-09-14`, commit `bbb3a39b4`)

`buildLiveCanonicalInput('0645f40c-951d-4ccc-b86e-9979cd26c795',
'2026-09-14T12:00:00.000Z', 'ACTIVE')`, real code, real DB:

```
2026-09-01 present in qualitySessions: false
2026-09-08 present in qualitySessions: true
  { dateISO: "2026-09-08", activityId: "-75144899844434", tests: "THRESHOLD", grade: "INSUFFICIENT" }
```

Direct `classifyDay` call (same rows `buildPrescriptionRunMatches` builds
today, no `version_rows`):

```
--- 2026-09-01 ---
owned (reign-stitched) row: { id: 'wko_eaa8cfd7cb94310b', type: 'threshold' }
classifyDay (no version_rows): [{ id: "wko_eaa8cfd7cb94310b", type: "threshold", matchedRun: null }]

--- 2026-09-08 ---
owned (reign-stitched) row: { id: 'wko_1cf8cd95971f2226', type: 'tempo' }
classifyDay (no version_rows): [{ id: "wko_1cf8cd95971f2226", type: "tempo", matchedRun: "-75144899844434" }]
```

**F038 alone: 2026-09-08 matches (confirms the task's hypothesis for this
date). 2026-09-01 still does NOT match — F040 is only PARTIALLY resolved by
F038 as a side effect, and only for dates where the reign-owner row happens
to be the same row the run was stamped against.**

Confirms F040's defect #2 (missing historical rows) IS closed by F038 for
both dates — before F038, 2026-09-01 had ZERO rows at all under
`readPlanWorkouts(plan.id)` (F040's own live finding); after F038, both dates
have a real row to compare against. What's left standing for 2026-09-01 is
defect #1 exactly, in the specific shape above.

---

## 3 · The follow-up fix implemented

**Scope: `web-v2/lib/adaptation/canonical-shadow/live-input.ts` only** (plus
its own structural test). No change to `day-resolver.ts` — it already
supports `version_rows` as an optional field on `PrescribedRow`
(`PLAN-VERSION-ALIAS-1`, unchanged); the gap was entirely that
`live-input.ts` never populated it.

1. **`readOwnedPlanWorkouts`'s SQL** now wraps the existing `ownedDaysSql()`
   output as a CTE (`owned`) and LEFT JOINs a `versions` CTE — the SAME
   `jsonb_agg(jsonb_build_object('id', pw.id, 'type', pw.type))` pattern
   `day-resolver.ts`'s `resolveDateRangeExecutions` already runs
   (lines ~484-492 there) — grouped by `date_iso`, over the SAME
   `user_uuid`/date-range parameters already bound (`$1`/`$2`/`$3`), so this
   is one extra CTE in an existing query, not a second round trip.
2. **`OwnedPlanWorkoutRow`** (via its parent `PlanWorkoutRow`) gains an
   optional `version_rows?: PlanRowVersion[] | null` field, imported as
   `DayResolverPlanRowVersion` from `day-resolver.ts`'s own exported type —
   no new type invented.
3. **`buildPrescriptionRunMatches`**'s `prescribedRows` mapping now carries
   `version_rows: w.version_rows ?? null` onto each `DayResolverPrescribedRow`
   it hands `classifyDay`. `readPlanWorkouts` (forward-looking) never selects
   this column, so a `PlanWorkoutRow` built from it carries `undefined`,
   which `classifyDay`'s Pass 1b already treats as "no aliases known" — the
   conservative default, unchanged behavior for every forward-looking caller.

Net diff: `web-v2/lib/adaptation/canonical-shadow/live-input.ts` (+~35/-9
lines). Test file `_f038_reign_scoping.test.ts` gained a new `describe('5 ·
F040 follow-up …')` block (3 assertions) and widened its existing
`fnStart + 800` window to `fnStart + 1300` on the two tests that slice
`readOwnedPlanWorkouts`'s body (the real function body is now ~1005 stripped
chars; 1300 gives comfortable margin without loosening the assertions
themselves). No other file touched.

## 4 · Live execution, AFTER the follow-up

Same `buildLiveCanonicalInput` call, same account, same "now":

```
2026-09-01 present in qualitySessions: true
  { dateISO: "2026-09-01", activityId: "-258355938987883", tests: "THRESHOLD", grade: "INSUFFICIENT" }
2026-09-08 present in qualitySessions: true
  { dateISO: "2026-09-08", activityId: "-75144899844434", tests: "THRESHOLD", grade: "INSUFFICIENT" }
```

Direct `classifyDay` call, WITH `version_rows` populated (every
`plan_workouts` row for that date, across every version):

```
--- 2026-09-01 ---
classifyDay (WITH version_rows): [{ id: "wko_eaa8cfd7cb94310b", type: "threshold", matchedRun: "-258355938987883" }]

--- 2026-09-08 ---
classifyDay (WITH version_rows): [{ id: "wko_1cf8cd95971f2226", type: "tempo", matchedRun: "-75144899844434" }]
```

**Both dates now match, with the correct run, via the REAL post-fix code
path (`buildPrescriptionRunMatches` calling the modified `readOwnedPlanWorkouts`
→ `classifyDay` Pass 1b for 09-01, Pass 1a for 09-08).** F040's core matching
defect, as documented for these two dates, is closed.

---

## 5 · `evaluateThresholdPace`, re-evaluated with the corrected
## `qualitySessions` — does the live shadow log actually flip?

**No — and this matters, because it is an honest, separate finding, not a
loose end of this fix.** `evaluateThresholdPace` was called directly (same
method the F039/F040 report used, `evaluatedAtISO = '2026-09-14T12:00:00Z'`,
`currentAnchorSecPerMi = belief.thresholdPaceSecPerMi = 440`,
`anchorMovedToday = false`) with the fully-corrected `qualitySessions` array
(both dates present):

```json
{
  "lever": "THRESHOLD_PACE",
  "decision": "REFUSE",
  "reason": "Threshold pace stays at 7:20/mi. No qualifying threshold session in the last 28 days, so there is nothing to read the anchor against either way.",
  "excluded": [
    { "activityId": "-258355938987883", "dateISO": "2026-09-01",
      "reason": "NOT_REPRESENTATIVE_FOR_PACE",
      "detail": "Conditions make pace unrepresentative · HILLY_WITHOUT_TRUSTED_GRADE_ADJUSTMENT, HEAT_WITHOUT_SUPPORTED_ADJUSTMENT." },
    { "activityId": "-75144899844434", "dateISO": "2026-09-08",
      "reason": "GRADE_DOES_NOT_COUNT",
      "detail": "The session graded INSUFFICIENT, which does not establish the intended stimulus." }
  ]
}
```

Both sessions now REACH admissibility (they are no longer invisible to the
lever — a real, separate improvement over the pre-fix state, where 09-01
never appeared in `qualitySessions` at all and so was never even considered),
but each is EXCLUDED for its own independent, pre-existing, and correct
reason, unrelated to F038 or F040:

- **2026-09-01** — `NOT_REPRESENTATIVE_FOR_PACE` (hills/heat without a
  trusted adjustment). This is `admissibility.ts`'s own, deliberately
  conservative pace-representativeness rule (Q27), doing exactly its
  documented job. Not a bug.
- **2026-09-08** — `GRADE_DOES_NOT_COUNT` (graded `INSUFFICIENT`). This is
  the documented, KNOWN limitation stated in `live-input.ts`'s own file
  header: `buildGradedSession`'s C1/C2 (work-duration / segment completion)
  are supplied as `absent()` because this loader has no `workout_spec`
  interval parser yet, so "most live sessions will grade INSUFFICIENT until
  a work-duration parser is built." Also not a bug this task's scope covers
  — a separate, already-named gap.

**So: the matching defect (F040) is now closed for both dates, live-verified
by direct execution of the real code. The live `canonical_adaptation_shadow_log`
would still very likely continue reading `REFUSE` for `THRESHOLD_PACE` on
most evaluations even with this fix deployed — not because of F040 any more,
but because of two entirely separate, already-documented admissibility/
grading gaps that this task was explicitly not scoped to fix.** Reporting
this plainly rather than implying the shadow log would start producing
approvals, per Rule 11 ("don't know," "measured zero," and "the read failed"
are three different facts — and "matched but inadmissible for an unrelated
reason" is a fourth that must not be reported as "still broken because of
F040").

---

## 6 · Verification

- **`tsc --noEmit -p tsconfig.json`** (full `web-v2`, `npm ci`'d fresh in the
  isolated worktree) — clean, exit 0, both before and after the follow-up.
- **`vitest run` targeted suite** (`_f038_reign_scoping.test.ts` +
  `_f038_reign_scoping.audit.test.ts` [live, `DATABASE_URL_RO`] +
  `_supplementalgrade.test.ts` + 4 adjacent plan/conservation suites) —
  **87/87 passing** after the follow-up (84 pre-existing + 3 new).
- **Falsified the 3 new assertions (Rule 18)**: reverted `live-input.ts` to
  the committed `bbb3a39b4` state via `git checkout --` in this same isolated
  worktree (never `git stash` — shared across worktrees, per this project's
  own standing caution), reran the test file: all 3 new assertions failed
  loud, for the expected reason (`version_rows`/`versions AS (` absent).
  Restored the fix, reran: 87/87 green again.
- **Broad regression sweep**: `vitest run lib/adaptation/ lib/execution/
  lib/plan/` — **4911 passed / 1 timed-out under parallel load / 86 skipped**.
  The one timeout (`_spike_rule_gate.test.ts`, an 8781-archetype sweep,
  `lib/plan/`, nothing to do with `canonical-shadow`/`day-resolver`) passed
  cleanly in 6.4s run in isolation — a resource-contention artifact of
  running the full tree concurrently, not a regression from this change.
- **`_f038_reign_scoping.audit.test.ts` (the live F038 falsifier)** — reran
  standalone after the follow-up, **6/6 passing**, confirming the follow-up
  did not disturb F038's own already-proven weekly-volume/long-run
  reign-stitching.

## 7 · What was NOT done, on purpose

- **No fix to the pace-representativeness or grade-admissibility gaps**
  surfaced in §5 — both are real, both are pre-existing, and both are
  outside this task's scope (`live-input.ts` matching / `day-resolver.ts`
  aliasing only). Naming them here so they are not lost, not fixing them.
- **No change to `weekly-volume.ts` or `long-run.ts`** — untouched, per the
  task's own explicit instruction.
- **No merge, no push.** Committed locally on a new branch,
  `fix/f040-version-rows-followup-2026-09-14`, based on
  `fix/f038-evidence-clock-scoping-2026-09-14` (`bbb3a39b4`), left for review.

## 8 · Answer to the task's three possible outcomes

**(b).** F038's fix resolves F040's defect #2 (missing historical rows) for
both example dates. It resolves defect #1 (the `version_rows` gap) ONLY
where the reign-stitched row happens to be the same row the run is stamped
against (2026-09-08, live-confirmed) — not in general (2026-09-01,
live-confirmed to still fail under F038 alone, for a documented, different
reason: the run is stamped against a DIFFERENT archived plan version's copy
of the day than the one `ownedDaysSql()` picks). The remaining gap was
exactly the trivial, contained addition the task anticipated — implemented,
live-verified, and committed as a separate follow-up commit.
