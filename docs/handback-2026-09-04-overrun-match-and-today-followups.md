# 2026-09-04 · Post-crisis follow-ups: OVERRUN-MATCH-1, PASSIVE-SYNC-TYPE-CONFIRM-1, two Today UI fixes

Continuation of the same day's crisis session (full retrospective for that
half — RECAP-1, PACETYPE-1, STUCKCONN-1, WORKOUTPHASES-1, HRPHASE-1,
HRGRADE-1, CACHEDAT-1 — is `docs/PRODUCT_DECISIONS.md`'s
`## 2026-09-04 · Crisis session` entry and
`docs/reports/core-closure-2026-09-04/HANDBACK.md`; not restated here).
This covers what happened after that: David reviewing the live build in his
simulator, catching two more real UI defects and one real data-matching
defect, all shipped to production the same session.

## Verdict

**Shipped and verified in production**, one commit: `39d69b71`. All three
fixes confirmed live against real account data after deploy, not against a
fixture. One open item carried forward at the end (§5).

---

## 1 · REDUNDANT-PACE-1 — "average work pace" repeated the header's own number

**David, live, on the LONG-run recap card:** *"dont need the 8:38 average
work pace if its right above it in the blue."*

**Root cause.** `TodayAfterV5`'s post-run facts block
(`WorkoutResultFactsV5`) prints `model.paceWork` — the work-phase-only
average — as a second line under the poster header, which already shows
the whole-run pace. For a structured session (intervals with a warm-up/
cool-down) those two numbers genuinely differ and both are worth showing.
For an unstructured session — LONG, EASY — there is no separate warm-up/
cool-down phase, so the "work" pace and the whole-run pace are
arithmetically the same number. The card was stating one fact twice
(Rule 17).

**Fix.** Added `headerPaceCoreText` — reads the same `panel.stats` pace
entry the poster header already renders, strips its unit suffix — and
compares it against `model.paceWork` at the call site. `workPaceText` is
only passed through when the two differ:

```swift
WorkoutResultFactsV5(
    workPaceText: model.paceWork == headerPaceCoreText ? nil : model.paceWork
)
```

`native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift`.

**Verified live**, simulator, real account data (Rule 13): before the fix,
the LONG-run card read `15.51 mi · 2:13:47 · 8:38/mi` in the header followed
by a redundant `8:38 average work pace` line; after, the second line is
gone. Screenshotted both states.

---

## 2 · ACTIVITY-PLACEMENT-1 — a day's real activity was the last thing on the page

**David, live, tapping into Monday (Aug 31):** *"monday is not showing post
run page. the status like this shoudl all be together at the top."*

**What was actually happening (not what it looked like).** Monday's page
was NOT hiding the run — a proper investigation (querying
`resolveDayExecutions()` directly, then the live `/api/v5/plan-snapshot`
and `/api/v5/today` endpoints, not just eyeballing the client) showed the
server correctly returned the run under `supplemental_runs`. The client's
`PlanSnapshotDayView` was correctly rendering an "Activity → Also logged"
card for it — that card was just placed dead last, below the still-open
prescription card and the treadmill-guidance card, off the bottom of the
screen. Two swipe attempts against the wrong coordinate space (pixel
values read off a screenshot, passed as if they were device points)
produced identical screenshots and looked like the row didn't exist; a
`touch_path` drag at the correct point-space coordinates found it.

**Fix.** Moved the `activityOverlay` block (matched/supplemental run) to
render immediately after the headline/notes, before the workout/rest card
— same principle `TodayBeforeV5`'s own `supplementalRunsSection` already
states in its header comment: "it reads right under the hero."

**Complication.** By the time this was ready to commit, `main` had moved
45 commits, including `57ec2840 fix(today): HEROPANEL-1` — a same-day
rewrite of `PlanSnapshotDayView` that pulled the whole colored hero
(type/kicker/dose/stat-plate) out of this file entirely into a shared
`HeroDayPanelContentV5`, deleting the `ScrollView` wrapper and the old
`header` computed property this fix's first draft had been written
against. The stashed diff conflicted. Re-derived the same fix (activity
block before the workout/rest card) against the new structure rather than
force the stale one — see the merge conflict resolution in
`native-v2/Faff/Faff/ViewsV5/PlanSnapshotDayView.swift`, commit `39d69b71`.

**Verified live**, both before and after the HEROPANEL-1 merge: the
"Activity → Also logged · 6.18 mi · 51:35" card now renders directly under
the (now colored) hero, visible without scrolling.

---

## 3 · OVERRUN-MATCH-1 + PASSIVE-SYNC-TYPE-CONFIRM-1 — a run that went LONGER than prescribed was filed as unrelated

This is the substantial one. David: *"Mondays run did match it just went
longer."*

### 3.1 · What actually happened

Monday 2026-08-31: prescribed EASY, 4.5 mi. David ran 6.18 mi (+37.3%),
started from the **Apple Watch's own stock Workout app** (confirmed by
David directly, not inferred), synced into the app as a passive HealthKit
ingest (`source: 'apple_watch'`). The day's own week strip correctly
marked the day `isDone: true` (any run occurred that day), but the actual
Today/plan-snapshot detail view for that date showed the prescription as
still open, with the real run relegated to "supplemental" — a stranger to
its own session, in the app's own vocabulary.

### 3.2 · Root cause #1 — the ingest-time distance band was symmetric

`app/api/ingest/workout/route.ts` stamps a device-ingested run with
`workoutType`/`workoutTypeSource: 'plan'` (the signal
`lib/execution/day-resolver.ts`'s LEGACY tier trusts) only when the run's
distance falls within a band of the day's prescribed distance. That band
was **±30%, symmetric**: `actualMi >= plannedMi * 0.7 && actualMi <=
plannedMi * 1.3`. For a 4.5 mi prescription the ceiling was 5.85 mi.
Monday's 6.18 mi run missed it by one third of a mile and got **no stamp
at all**.

**Why symmetric was wrong.** A run materially *shorter* than prescribed is
plausibly a different session (a bail, an unplanned rest-day jog) — that
half of the guard is sound. A run *longer* than prescribed is, per
CLAUDE.md's own mission statement, exactly the case this app exists to
recognize: *"there's a world where we push forward and the plan has to
push us more and more."* Treating an EASY day run 37% long as unrelated to
its own prescription is the opposite of that.

**Fix.** Widened the ceiling to **+100%** (double the prescription),
floor unchanged at -30%. Extracted the whole predicate out of the route
into `lib/runs/plan-type-stamp.ts`'s `distanceMatchesPlan()` — a pure,
exported, unit-tested function — rather than leaving it as inline logic
only reachable through a full ingest POST.

```ts
export function distanceMatchesPlan(actualMi: number, plannedMi: number | null): boolean {
  if (plannedMi == null || plannedMi <= 0) return true;
  return actualMi >= plannedMi * 0.7 && actualMi <= plannedMi * 2.0;
}
```

Falsifying tests in `lib/runs/_plan_type_stamp.test.ts` (Rule 18): the
exact live case (4.5 → 6.18 matches), the floor and new ceiling boundary,
a materially short run still refused, a wildly unrelated same-day effort
(a marathon on a 4.5 mi easy day) still refused, and an explicit assertion
that the *old* ±30% ceiling (5.85 mi) would have refused 6.18 mi — proving
the fix actually moved the boundary, not just that the new predicate agrees
with itself.

### 3.3 · Root cause #2 — the day-resolver refused every passive sync, no exceptions

Even after the ingest fix (which only affects *future* ingests — Monday's
row was already written), `resolveDayExecutions()`'s LEGACY tier in
`lib/execution/day-resolver.ts` still refused to match it. Its own header
comment explains why, from a real, separate incident logged the same day
(`WORKOUT-EXECUTION-ID-1`, 2026-09-03): a friend's unrelated 4.48 mi easy
run, `source: 'apple_watch'`, had been auto-stamped `workoutType:
'intervals'` by the ingest route's old date+distance heuristic — with zero
check against what the run itself actually was — and got rendered as
`INTERVALS · done` over a 6 mi hill session David hadn't gone out to run
yet. The fix for that incident excluded every source except `watch` /
`treadmill` / `phone` (the app's own live tracker) from LEGACY-tier type
matching, blanket, regardless of distance or the run's own data.

**Why blanket was too wide.** The friend's-run defect was never really
about *which app* recorded the run — it was that the `workoutType` stamp
was *borrowed* from the plan by date+distance alone, with no check against
what the run's own data said it was. `lib/runs/run-shape.ts`'s own header
comment on the `type` field confirms the field exists for exactly this:
*"MIXED SEMANTICS: 'Run' on Strava-era rows (Strava's activity type) and
'easy' on some faff rows (a workout type)"* — some passive-sync rows do
carry a genuine, independent self-classification. Monday's run was one:
`data.type: "easy"`, agreeing with the prescription's `"easy"` on its own,
completely apart from the borrowed stamp. The friend's run never had that
— survey of the account (`SELECT source, type FROM runs WHERE source =
'apple_watch'`) shows most `apple_watch` rows carry no `type` at all (54 of
66), some carry the generic Strava/HealthKit label `"Run"` (5), and a
handful carry a real classification like `"easy"` (7, Monday's among
them).

**Fix.** Added `ownTypeConfirms()` — a passive sync's *own* `type` field is
trusted as independent corroboration only when it is not empty and not the
generic `"Run"`/`"run"` label (which confirms nothing; any run, related or
not, could carry it), and agrees case-insensitively with the prescription's
(normalized) type. The LEGACY tier's source gate now reads:

```ts
const isConfirmedAppleWatchSync = source === 'apple_watch' && ownTypeConfirms(r.data.type, t);
if (!LIVE_TRACKED_SOURCES.has(source) && !isConfirmedAppleWatchSync) return false;
```

Deliberately scoped to `apple_watch` specifically, not every passive
source — Strava and manual entry still never qualify here, own type or
not, because a freeform third-party label is a weaker signal than the
Watch's own HealthKit workout-type field. (An earlier draft of this
condition accidentally admitted *any* non-live-tracked source with a
confirming type, including Strava — caught before commit by writing the
Strava-still-refuses test case and watching it fail, then correcting the
condition to check `source === 'apple_watch'` explicitly.)

Five new test cases in `lib/execution/_day_resolver.test.ts`, under
`PASSIVE-SYNC-TYPE-CONFIRM-1`: the live incident matches; no own type still
refuses (the original friend's-run shape, unchanged — falsifies against
regression); the generic `"Run"` label still refuses; an own type that
*disagrees* with the prescription still refuses even with a matching
stamp; a Strava-sourced sync never qualifies regardless of own type. All
22 pre-existing tests in that file (the original `WORKOUT-EXECUTION-ID-1`
suite) still pass unchanged — the fix does not reopen the incident it
would otherwise have reopened.

### 3.4 · Backfill

The ingest-route fix only changes future ingests; Monday's row was already
written under the old logic. A scoped account-wide check (same widened
band, same "no existing stamp" condition) found **exactly one** affected
row — Monday's own run, `id: -41598809443969`. Backfilled it with the
stamp the widened band would have applied at ingest time:

```sql
UPDATE runs
SET data = data || jsonb_build_object('workoutType', 'easy', 'workoutTypeSource', 'plan')
WHERE id::text = '-41598809443969'
```

Executed after the fix was already committed and the affected-row count
was known and shown, per this project's DDL/data-write approval discipline.

### 3.5 · Verification chain

- `distanceMatchesPlan()` and `ownTypeConfirms()` unit-tested (12 new test
  cases total across two files, all passing; 586 tests passing across
  `lib/execution` + `lib/runs`).
- `resolveDayExecutions()` called directly against production data
  (bypassing HTTP) before commit: `matchedRun: { runId:
  '-41598809443969', match: 'legacy_type', distanceMi: 6.18 }`.
- `npx tsc --noEmit` clean across the whole project after the merge.
- `scripts/check-swallowed-failure.sh` and `scripts/check-doctrine.sh`
  clean (pre-existing exemptions only, nothing new).
- `main` had moved 45 commits since this worktree's base — fast-forwarded
  local `main` to `origin/main` (zero unpushed local commits, safe), then
  reapplied the stashed changes; only `PlanSnapshotDayView.swift`
  conflicted (§2), the four `web-v2` files (untouched upstream) and
  `TodayAfterV5.swift` (touched upstream by unrelated commits — HEROPANEL-1,
  WORKOUTPHASES-1/2, RECAP-1/STUCKCONN-1/PACETYPE-1 — but not in the same
  region) auto-merged clean.
- `xcodebuild` succeeded against the merged tree, `793CC699-…` simulator.
- `scripts/verify-commit.sh 39d69b71` — isolated-worktree run, 422s, all
  four sections present and passing: `npm run prebuild` PASS,
  `check-web-build.sh` PASS, CI unit tests PASS (835 passed, 24 skipped),
  `check-watch.sh` correctly N/A (commit touches no watch paths).
- Pushed to `origin/main` fast-forward (`bc4f071a..39d69b71`).
- Railway deploy polled to completion: `BUILDING` → `DEPLOYING` →
  `SUCCESS`, commit hash confirmed to match (`39d69b717660217fd92f5d80cf7cac2d1bd1a8fc`)
  — Rule 19, a push is not a deploy until the platform says so.
- **Post-deploy, against live production** (not the pre-deploy DB-only
  check): `GET /api/v5/today?date=2026-08-31` now returns `state:
  "after_run"`, `supplementalRuns: []`, `panel.type: "Easy"` — the
  prescription reads as completed, not open, and the run is no longer
  filed as a stranger to it.

Debug session tokens minted for verification (`kind: 'debug-verify-*'`)
were revoked immediately after each use.

---

## 4 · Commit

`39d69b71 fix: OVERRUN-MATCH-1, PASSIVE-SYNC-TYPE-CONFIRM-1, redundant pace + activity placement`

Files: `native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift`,
`native-v2/Faff/Faff/ViewsV5/PlanSnapshotDayView.swift`,
`web-v2/app/api/ingest/workout/route.ts`,
`web-v2/lib/execution/day-resolver.ts`,
`web-v2/lib/execution/_day_resolver.test.ts` (new cases),
`web-v2/lib/runs/plan-type-stamp.ts` (new),
`web-v2/lib/runs/_plan_type_stamp.test.ts` (new).

---

## 5 · Open, not closed this session

David asked directly, mid-session, and it was never given a complete,
verified answer:

> "I feel like my hr reading is off for the hill intervals. is that the
> only thing the coach cares about is HR? not incline or speed or
> anything?"

What was found before the thread got dropped for the UI/matching issues
above: Hill 1's raw `hrSamples` for that session showed all 18 samples
across the full 60-second phase reading **exactly 134 bpm**, zero
variation — flagged as a likely watch sampling/interpolation artifact, not
a code bug, but never checked against the other 9 hills to see if the
flat-line pattern is universal or isolated, and never checked against that
session's actual `workout_spec.rules` to give a grounded answer on whether
incline/speed are ever graded (recalled, not re-confirmed this session:
the session's rules were HR-only). This still owes David a real answer,
built the same way everything above was — off the actual data, not a
guess.
