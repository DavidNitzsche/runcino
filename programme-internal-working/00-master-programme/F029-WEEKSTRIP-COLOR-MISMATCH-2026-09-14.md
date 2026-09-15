# F029 — week-strip day-color disagrees with the day-detail card for the same day

**Implementer report. Not a closure.** Per the review-protocol role split,
the implementer does not certify its own work — an external reviewer and
David's own device confirmation close this finding, not this document.

- Branch: `fix/f029-weekstrip-color-mismatch-2026-09-14`, created off
  `origin/main` at `e7265c998` (current `origin/main` HEAD at the time of
  implementation).
- Commit: `c114ad67f3638a743a1ec78ffaf6c3a23259ac84`.
- Not merged, not pushed to `main` — per the task's explicit scope
  boundary.

## Escalation context

David hit this live on his own phone (TestFlight build 292) on two
separate days with no prompting — first Thursday, reconfirmed the
following Tuesday. Reported shape: Thursday 9/17's day-detail card
correctly showed EASY (green gradient) after a plan correction, but the
week-strip's underline for that same day, one screen up, was still
orange (the prior quality/intervals color).

## 1. Root-cause determination — stated explicitly, as required

**The suspected cause — a plan-version-bump cache-eviction gap
(`PW-20260914-001`) that the week-strip's cache never received — is
REFUTED.** That finding ID does not exist anywhere in this codebase
(checked: `grep -r "PW-20260914-001"` across the whole repo, zero hits),
and the actual plan-version cache-eviction mechanisms that DO exist
(`PLANVERSION-1`'s `TodayHostV5.reconcileDayCache`/`reconciledDayCache`
for the per-date full-day cache, `WEEKCACHE-1`'s `fetchAndCacheWeek` for
the per-week summary cache) were both already evicting correctly on a
`planVersion` change. Read both in full before writing any code; neither
needed a fix.

**The actual mechanism, confirmed by reading `HostsV5.swift`'s
`TodayHostV5` struct end to end:**

1. The week-strip's rail color comes from `WeekStripDayV5.state` (a
   `V5.DayState`), painted by `WeekStripV5.rail(_:)`
   (`DesignV5/ChartsV5.swift`). For the browsed-date screen (the one the
   report describes — tapping into a day's own card via the shared
   header/strip shell), that array is built by `TodayHostV5.stripDays(for
   model: V5Today)` in `HostsV5.swift`.
2. The day-detail card, for that same browsed date, reads a *different*
   object entirely: `PlanSnapshotStore.shared.current?.day(on:
   effectiveDate)` (`HostsV5.swift`, `body`, the `snapshotDay`
   short-circuit) — feeding both `HeroDayPanelContentV5` and
   `PlanSnapshotDayView`.
3. `PlanSnapshotStore` is refreshed by five independent triggers
   (documented on `planSnapshotSyncTask`'s own comment): launch,
   foreground, explicit Retry, pull-to-refresh, and **a plan mutation**
   — and for a plan mutation, `.onReceive(.faffPlanMutated)` calls
   *only* `syncPlanSnapshot()`. It does **not** call `surface.load()`.
4. `surface.model` (the `V5Today` passed into `stripDays(for:)` as
   `model`, and passed to the shared shell as `shellModel`) is refreshed
   **only** by `surface.load()` — launch, foreground, pull-to-refresh, or
   an explicit per-date fetch. A bare plan correction never calls it.
5. Before this fix, `stripDays(for:)` only ever consulted
   `PlanSnapshotStore` (via `snapshotWeekStripDays`) when the selected
   date fell **outside** `model`'s already-loaded week. A correction to a
   day *inside* that week — the ordinary case, since corrections land on
   days close to today — fell straight through to `model.weekStrip` with
   **zero reconciliation against the snapshot at all.**

Net effect: a plan correction updates `PlanSnapshotStore` immediately (so
the day-detail card is correct within moments), but leaves
`surface.model.weekStrip` untouched — sometimes for the rest of the
session, until the next foreground/launch/pull-to-refresh — and the
week-strip painted 100% off `model.weekStrip` for the single most common
navigation case. This is a direct, verified violation of
`PlanSnapshotStore.swift`'s own header comment, which already claims the
snapshot is "the ONE locally persisted, versioned copy of the runner's
whole authored block, and **the only thing Today/the week strip are
allowed to read** for date navigation" — the week strip simply wasn't
honoring that for the in-week case.

This is **not** the cache-eviction shape first suspected (nothing was
failing to be evicted); it's a client read-path that never consulted the
fresher of two legitimately different sources for the one field
(day-type/color) both of them carry.

## 2. The fix

`TodayHostV5.stripDays(for:)` (`native-v2/Faff/Faff/ViewsV5/HostsV5.swift`)
now reconciles every cell — not only the out-of-week ones — against
`PlanSnapshotStore.shared.current` before returning the strip. Factored
into a pure, directly-testable static function,
`TodayHostV5.reconcileStripDayType(_:snapshot:)`, following this file's
own `reconciledDayCache` precedent for testability (a bare, unrendered
`@State`-holding view does not reliably persist state across statements
outside a live SwiftUI hierarchy — the same reason `PlanVersionInvalidationTests`
calls the static function directly rather than driving a live view).

Deliberately narrow scope: only `state` and `isRest` — the two fields
`WeekStripV5.rail(_:)` actually paints from — are overridden from the
snapshot. `isDone`/`resolution` (completion) are left reading `model`,
because finishing a run is **not** one of `syncPlanSnapshot`'s five
triggers; pulling completion from the snapshot would have traded this bug
for its mirror image (a just-finished run reading "not done" on the strip
until the next foreground). A day the snapshot has no entry for (not yet
synced, or outside its authored range) is returned unchanged — the same
"degrade to whatever `model` already said" contract every other snapshot
read in this file already keeps.

Neither `PlanSnapshotDayView`'s own logic (the day-detail card, already
correct) nor the `dayCache`/`weekCache` plan-version eviction mechanisms
(`PLANVERSION-1`/`WEEKCACHE-1`) were touched, per the task's scope
boundary — both were already correct.

A dense WHY-comment citing F029 and this exact trace was added at the fix
site in `HostsV5.swift`, matching the codebase's established comment
style.

## 3. Verification

- **Build**: `xcodebuild -project Faff.xcodeproj -scheme Faff -destination
  'platform=iOS Simulator,id=13C15A03-551C-455F-91BA-011F2407D557' build`
  → `** BUILD SUCCEEDED **` (simulator: `Faff-Review-1`, approved pool,
  already booted — no new simulator created).
- **New regression test**: `WeekStripSnapshotReconciliationTests` (6
  cases) added to `FaffTests` (registered in `Faff.xcodeproj/project.pbxproj`
  — this is a legacy, non-synchronized pbxproj, so the file reference,
  build file, group membership, and Sources-phase entry were all added by
  hand). All 6 pass.
- **Rule 18 falsification, performed exactly as required**: temporarily
  reduced `reconcileStripDayType` to `return day` unchanged (simulating
  the pre-fix behavior) via a plain file copy/restore, never
  `git stash` (this repo's worktrees share a stash — see
  `feedback_git_stash_shared_across_worktrees`). Re-ran the test target:
  **4 of 6 tests failed**, including
  `testCorrectedDayOverridesStaleQualityStateWithSnapshotsEasy` — the
  exact reported disagreement reproduced (cell stayed `.quality`/`.rest`
  instead of repainting to the corrected `.easy`). Restored the real fix
  from the backup copy (diffed byte-identical against the pre-falsification
  file), re-ran: all 6 pass again.
- **Contention check**: `ps aux | grep -i xcodebuild` showed no concurrent
  `xcodebuild` process before either test run; `xcrun simctl list devices
  booted` confirmed `Faff-Review-1` was the target and no conflicting run
  was in flight against it.
- **Full suite, no regressions**: `-only-testing:FaffTests` (whole
  target) → **558 tests, 0 failures**, matching the expected-failure
  control case (`SweepPositiveControlTests`) behaving as designed, not a
  real failure.

## 4. Housekeeping note (not part of the fix)

This worktree had no `native-v2/Secrets.xcconfig` (gitignored, holds only
`CARTO_API_KEY`, no credentials specific to this fix) — copied in from
the primary `native-v2/` checkout to unblock the build. Confirmed still
gitignored (`git check-ignore` before and after); not committed.
