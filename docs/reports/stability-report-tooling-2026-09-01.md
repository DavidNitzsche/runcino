# Stage 1 stability report tooling — 2026-09-01

Real, runnable, read-only tooling that compiles the Stage 1 stability report
named in `docs/reports/adaptation-authority-policy-brief-2026-09-01.md`'s
external review response, against the production `adaptation_shadow_log`
table (migration 160, applied and live tonight — see
`docs/reports/shadow-log-production-2026-09-01.md`). This is not a one-time
report: it's a script you re-run at any point — now, day 7, day 14 — to see
CURRENT status against the criteria, whatever the real numbers say.

**Location:** `web-v2/scripts/adaptation-stability-report.ts`

```
npx tsx scripts/adaptation-stability-report.ts                # owner account, text
npx tsx scripts/adaptation-stability-report.ts <user-uuid>     # another account
npx tsx scripts/adaptation-stability-report.ts --json          # machine-readable
```

## Constraint held: read-only, enforced not asserted

The script opens its own connection pool against `DATABASE_URL_RO` — the
Postgres role that cannot write to this table at the permission level. It
refuses to run at all if `DATABASE_URL_RO` is unset (no silent fallback to
the writable role). It never imports `lib/db/pool` (the writable pool),
`lib/adaptation/shadow-compare.ts`, `lib/adaptation/adaptation-engine.ts`, or
`lib/plan/adapt.ts` — every query in the file is a `SELECT`, and the phone/
watch checksum check re-implements `shadow-compare.ts`'s own read-only
formula inline rather than importing the file, so this tool has zero
dependency on any adaptation/plan module and cannot be affected by, or
affect, whatever else lands in those files tonight.

This was verified empirically, not just asserted — the same DELETE the
retention job runs, attempted over the same role this script uses:

```
$ node -e "... pool.query(\"DELETE FROM adaptation_shadow_log WHERE id = '1'\") ..."
EXPECTED refusal: permission denied for table adaptation_shadow_log
```

## The nine criteria, and how each is computed

| # | Criterion | How it's computed |
|---|---|---|
| 1 | Consecutive scheduled evaluation days (target 7) | Distinct `today_iso` dates for the user, walked backward from the most recent date to find the current unbroken streak. Reports the full span too, and names any missing calendar dates inside it. |
| 2 | Successful, uncontaminated evaluation cycles (target 5) | One row per calendar day (latest `resolved_at` if more than one that day). Eligible = `convergence_state` is `AUTHORED_CANONICALLY` or `REANCHORED_CANONICALLY` (not `AUTHORED_TOO_RECENTLY`/`REANCHOR_STATUS_UNKNOWN`) AND the cycle wasn't a read failure (best-effort text match on `engine_explanation` for `NO_PACE_PROPOSAL` rows — see below). A miss on that text match fails **closed**: treated as ineligible, never silently counted as good. |
| 3 | Plan mutations / checksum violations | Scans **every row**, not deduped — `zero_mutation_verified !== true` OR `mutation_checksum_before !== mutation_checksum_after`. **HARD FAIL if nonzero, always.** |
| 4 | Unresolved contradictions | Every row's `contradictions` jsonb array (written by `deriveContradictions` in `shadow-compare.ts`), flattened and listed with the row id, date, code and detail. |
| 5 | `MATERIAL_INCOMPATIBILITY` treated as valid progress | Scans every row for `hr_compat_verdict = 'INCOMPATIBLE_REFUSE'` where `final_decision` is anything other than `REFUSED_HR_INCOMPATIBLE`. **HARD FAIL if any found — must never happen.** |
| 6 | Unexplained PROGRESS/HOLD oscillation | Walks the one-row-per-day series across **calendar-adjacent** day pairs only (a gap is skipped, not silently treated as consecutive). A flip between `PROGRESS` and `HOLD` is run through `explainDayOverDayChange()` (below); unexplained flips are named. |
| 7 | Material proposal change day-over-day | Same `explainDayOverDayChange()` mechanism, applied to any change in `finalDecision`, the proposed pace value, or any phase's proposed target — not just PROGRESS/HOLD flips. |
| 8 | Phone/Watch target consistency | See the dedicated section below — this one has a real, named data limitation. |
| 9 | Shadow-log retention/pruning health | Row counts (total, per-user vs the 400 cap), oldest-row age vs the 180-day bound, and a read of the cron heartbeat table. Also has a real, named finding — see below. |

### What "unexplained" means, concretely (#6 and #7)

A day-over-day change counts as **explained** when at least one of these is
true between the two consecutive days:

- **New evidence** — the capacity belief's `evidenceIds` changed, or the set
  of representative-observation activity ids changed.
- **Changed runner state** — the capacity belief's confidence, pace, or
  source mode changed, or the convergence state changed, or the HR
  compatibility verdict changed.
- **Phase transition** — the set of active phase labels changed, or the set
  of phases marked `moved` changed.

A change with none of those three present is flagged **UNEXPLAINED**. This
is a real, falsifiable predicate over the persisted row
(`explainDayOverDayChange()`), not a description of a check that exists only
in prose — see the falsification section below.

### Phone/Watch consistency — the real limitation, stated plainly

`/api/v5/today` (`web-v2/app/api/v5/today/route.ts`, `SELECT
pace_target_s_per_mi, workout_spec FROM plan_workouts ...`) and the watch
payload (`web-v2/lib/watch/build-workout.ts`) both read `plan_workouts`
**live**, and that table is mutated **in place** with no history/snapshot
table behind it. There is no way to ask "what would `/api/v5/today` have
returned on 2026-08-29" from stored data alone — if that row ever differed,
it has been overwritten by now. This report says so directly rather than
faking a reconstruction.

What it checks instead, and what that does and doesn't prove:

- **(a)** Every persisted shadow-compare row carries its own before/after
  `plan_workouts` checksum. Any mismatch is surfaced as a hard-fail mutation
  violation (criterion #3) — proving the shadow-evaluation pass itself never
  altered what the phone/watch would see.
- **(b)** Whether the most recent row, if dated today, still matches
  `plan_workouts` as read right now — proving nothing else has mutated the
  plan out from under the last evaluation between then and now.

Neither proves what the phone/watch showed on any earlier date — only that
this shadow mechanism has not been a source of drift. Full historical
reconstruction is reported as `fullHistoricalReconstructionPossible: false`
in the JSON output, not glossed over.

### Retention/pruning health — a real finding, not a fabricated pass

Reading `web-v2/app/api/cron/prune-adaptation-shadow-log/route.ts` in full:
it calls `pruneAdaptationShadowLog()` and returns, but it **never calls
`lib/ops/cron-ledger.ts`'s `recordCronSuccess()`**. That means the standard
cron-ledger heartbeat read (`ops_alerts` where `kind='cron_ok'` and
`source='cron/prune-adaptation-shadow-log'`) will read empty **even if the
GitHub Actions schedule (`.github/workflows/prune-adaptation-shadow-log.yml`,
05:00 UTC) has been firing correctly every night** — confirmed empirically
against production tonight:

```sql
SELECT source, kind, created_at FROM ops_alerts
 WHERE source LIKE '%prune-adaptation%' ORDER BY created_at DESC LIMIT 5;
-- (0 rows)
```

The report names this explicitly (Rule 11: "the heartbeat is absent" and "the
job never ran" are different facts) rather than reporting a false negative as
if it were a failure. It also states the separate, honest fact that with only
16 rows total and the oldest row 0.8 days old, neither retention bound (180
days / 400 rows) is anywhere near binding — so this sub-check **cannot yet
empirically prove pruning works either**, for the same "not yet enough time
has passed" reason the headline criteria can't yet pass. Wiring
`recordCronSuccess` into that route is a real, small fix, but it's out of
scope for this read-only reporting task and touches a file other agents may
still be working on tonight — flagged here, not fixed here.

## Verdict states — pass, not-yet-enough-data, and hard-fail, defined so this tool doesn't need re-interpreting later

| Verdict | Meaning | Exit code |
|---|---|---|
| `HARD_FAIL` | A checksum/mutation violation, or a `MATERIAL_INCOMPATIBILITY` accepted as valid progress, was found. **Alarming. Stop and look.** | 2 |
| `NEEDS_REVIEW` | No hard failures, but at least one of: unresolved contradictions, an unexplained oscillation, an unexplained material change, or a phone/watch consistency mismatch. Needs a human look, but is not the same class of alarm as a hard fail. | 1 |
| `CAP_EXCEEDED_ESCALATE` | ≥14 days have elapsed since the first shadow-log record and fewer than 5 eligible cycles have accumulated. Per the policy brief's own day-14 cap, this needs a decision — either the eligibility bar is being missed for a reason worth naming, or the cadence itself needs review. | 1 |
| `NOT_YET_ENOUGH_DATA` | No hard failures, no open review items, fewer than 5 eligible cycles, day-14 cap not yet reached. **This is the expected, honest state while the mechanism is still accumulating evidence — explicitly not a failure.** | 0 |
| `PASS` | ≥5 eligible, uncontaminated cycles, zero hard failures, zero open review items. | 0 |

Verdict priority is hard-fail first, then open review items, then the
eligible-cycle count against the cap — a `NEEDS_REVIEW` state is never
silently promoted to `PASS` just because the cycle count also happens to
clear 5.

## Falsified before trusted (Rule 18)

A gate that has never been made to fail is a hypothesis. Before trusting this
tool's verdict logic, every branch was falsified against synthetic
`ShadowRow` fixtures — both the positive case (a real violation correctly
triggers the verdict) and the negative case (a clean row does **not**
false-positive):

```
ok: checksum mismatch → HARD_FAIL (got HARD_FAIL)
ok: INCOMPATIBLE_REFUSE + finalDecision PROGRESS → HARD_FAIL (got HARD_FAIL)
ok: properly-refused INCOMPATIBLE_REFUSE row does NOT flag as a violation (got 0)
ok: nonzero contradictions → NEEDS_REVIEW (got NEEDS_REVIEW)
ok: one PROGRESS→HOLD flip detected (got 1)
ok: flip with identical evidence/state/phase is UNEXPLAINED (got 1)
ok: unexplained oscillation → NEEDS_REVIEW (got NEEDS_REVIEW)
ok: flip WITH new evidence is explained, not flagged (got 0)
ok: 5 clean uncontaminated cycles → PASS (got PASS)
ok: day-14 cap, <5 eligible → CAP_EXCEEDED_ESCALATE (got CAP_EXCEEDED_ESCALATE)
ok: 1 clean cycle, day cap not exceeded → NOT_YET_ENOUGH_DATA (got NOT_YET_ENOUGH_DATA)
ok: AUTHORED_TOO_RECENTLY is NOT eligible (got count=0)
ok: ineligibility reason names contamination

FALSIFIER RESULT: ALL PASS
```

The falsifier itself was a scratch file (not committed — it imported the
exported pure functions, fed them synthetic rows, and asserted on the
result); the functions it exercises are exported from the script itself
(`consecutiveDaysReport`, `eligibleCyclesReport`, `mutationViolations`,
`materialIncompatibilityAcceptedAsProgress`, `unresolvedContradictions`,
`explainDayOverDayChange`, `oscillationReport`, `materialChangeReport`,
`computeVerdict`, and the `ShadowRow`/`StabilityReport` types), so the same
falsification can be re-run or extended later without needing to touch the
script's main body.

## Real, current output against production — 2026-09-01

Run for real tonight, right after the shadow log went live. `tsc --noEmit`
clean across the whole project beforehand. Exit code: `0`.

```
STAGE 1 STABILITY REPORT · adaptation_shadow_log
user: 0645f40c-951d-4ccc-b86e-9979cd26c795    generated: 2026-09-01T18:07:46.172Z    rows read: 4
──────────────────────────────────────────────────────────────────────────────
VERDICT: NOT_YET_ENOUGH_DATA
  - 2 of 5 target eligible cycles so far, 2 of 7 target consecutive days. No hard failures, no open review items. Per policy: continue running, re-check at day 7 and, if still short, day 14. This is the expected, honest state — not a failure.
──────────────────────────────────────────────────────────────────────────────
1 · Consecutive scheduled evaluation days
   target 7 · current streak 2 (2026-08-31 → 2026-09-01) · met target: false
   distinct days seen: 2 · span 2026-08-31..2026-09-01 (2 calendar days)

2 · Successful, uncontaminated evaluation cycles
   target 5 · eligible so far: 2 · met target: false
   eligible days: 2026-08-31, 2026-09-01

3 · Plan mutations / checksum violations (HARD FAIL if nonzero)
   count: 0

4 · Unresolved contradictions
   count: 0

5 · MATERIAL_INCOMPATIBILITY accepted as valid PROGRESS (HARD FAIL if any)
   count: 0

6 · Unexplained PROGRESS/HOLD oscillation across consecutive days
   consecutive day-pairs checked: 1 (0 pair(s) skipped — not calendar-adjacent)
   flips found: 0 · unexplained: 0

7 · Material proposal changes day-over-day (same mechanism, applied generally)
   consecutive day-pairs checked: 1 (0 pair(s) skipped)
   changes found: 0 · unexplained: 0

8 · Phone/Watch target consistency
   live plan_workouts checksum (now): 925312284e816aabe3b4d09c6226e286:103
   most recent shadow row: 2026-09-01 checksumAfter=925312284e816aabe3b4d09c6226e286:103
   current-day match (if most recent row is dated today): true
   every row internally consistent (before==after): true
   full historical reconstruction possible: false
   NOTE: [see limitation note above]

9 · Shadow-log retention/pruning health
   total rows (all users): 16
   oldest row: 2026-08-31 23:50:02.753+00 (age 0.8 days, retention bound 180 days)
   any user near the 400-row cap: false
   oldest row near the retention bound: false
   prune heartbeat found: false
   NOTE: [see retention finding above]

──────────────────────────────────────────────────────────────────────────────
All users currently in adaptation_shadow_log (context only — verdict above is scoped to the
requested user):
   0645f40c-951d-4ccc-b86e-9979cd26c795  rows=4 days=2 lastConvergence=REANCHORED_CANONICALLY lastDecision=PROGRESS
   606bcc38-298b-48a1-9e9a-090509b213c9  rows=2 days=2 lastConvergence=REANCHOR_STATUS_UNKNOWN lastDecision=HOLD
   9298919a-edc0-488f-94a6-14a50232beb1  rows=2 days=2 lastConvergence=REANCHOR_STATUS_UNKNOWN lastDecision=INSUFFICIENT_EVIDENCE
   b04e35e9-01df-4d1b-9fee-44332be312f6  rows=2 days=2 lastConvergence=REANCHOR_STATUS_UNKNOWN lastDecision=HOLD
   bcefea06-43ae-4573-a066-020142915f01  rows=2 days=2 lastConvergence=REANCHOR_STATUS_UNKNOWN lastDecision=HOLD
   d2f504ac-8549-40fe-b3af-cae011c594fa  rows=2 days=2 lastConvergence=REANCHOR_STATUS_UNKNOWN lastDecision=NO_PACE_PROPOSAL
   fb21cb09-0d33-42d7-a848-f56fd81d3f53  rows=2 days=2 lastConvergence=REANCHOR_STATUS_UNKNOWN lastDecision=NO_PACE_PROPOSAL
```

This is the honest, correct result. Shadow-compare went live only a few
hours before this report ran: 2 distinct calendar days of data (2026-08-31
and 2026-09-01), 2 of the target 5 eligible cycles, well under the day-7 and
day-14 checkpoints. **Do not read `NOT_YET_ENOUGH_DATA` as anything other
than "keep running, re-check later"** — it is a distinct, calm state from
`HARD_FAIL` and `NEEDS_REVIEW` by construction (see the verdict table above),
and the exit code (`0`) reflects that.

The footer table also shows, honestly, that six other accounts are in the
table with `REANCHOR_STATUS_UNKNOWN` convergence and `HOLD`/
`INSUFFICIENT_EVIDENCE`/`NO_PACE_PROPOSAL` decisions — consistent with the
policy brief's own description of the owner's account
(`0645f40c-951d-4ccc-b86e-9979cd26c795`) as the only account with real
training history. The report is scoped to the owner account by default
(matching the canary discussion in the policy brief), but the full-table
context is printed every run rather than hidden.

## Re-running at day 7 / day 14

Nothing about this tool changes between runs — same command, same read-only
connection, fresh numbers computed from whatever is in the table at that
moment:

```
npx tsx scripts/adaptation-stability-report.ts
```

At day 7, expect either `PASS` (if 5 eligible cycles have accumulated with no
violations), `NOT_YET_ENOUGH_DATA` (if fewer than 5 have accumulated but the
day-14 cap hasn't been hit), `NEEDS_REVIEW` (an open item needing a look), or
`HARD_FAIL` (stop immediately). At day 14, `NOT_YET_ENOUGH_DATA` is no longer
possible — the verdict logic automatically moves to `CAP_EXCEEDED_ESCALATE` if
5 eligible cycles still haven't accumulated by then, which is the policy
brief's own escalation point, not a new judgment call invented here.

## Files touched

- `web-v2/scripts/adaptation-stability-report.ts` — new. The tool.
- `docs/reports/stability-report-tooling-2026-09-01.md` — this report.

No other file was touched. `adaptation-engine.ts`, `shadow-compare.ts`, and
`load.ts` were read for context (to know the shape of `ShadowRow` and the
contradiction codes) but not edited, imported at runtime, or depended on in
any way that could be affected by concurrent work on them tonight.
