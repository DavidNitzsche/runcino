# F119 — PhoneSync's own sync-failure warning has had no reader since the 0821 board rewrite (2026-09-14)

**Status: FIXED, unit-tested, Rule-18 falsified, full Watch suite clean
(243/243). Committed on `fix/f119-phonesync-status-2026-09-14`, based on
`origin/main`. NOT pushed, NOT merged.**

## 0 · The `FinishSummaryBoard.onDone` timing question, resolved first

This was flagged as needing resolution before wiring anything, since it
determines the shape of everything downstream.

**The doc comment was stale, confirmed by reading `sendCompletion`'s actual
call chain**: `WorkoutRootView.bind`'s `.finished` handler fires
`PhoneSync.shared.sendCompletion` the instant the engine reaches
`.finished` -- well before the runner has tapped through Complete/Effort to
reach Summary. But `sendCompletion` is fire-and-forget: it queues
`transferUserInfo`/`transferFile` and a background POST, then returns
immediately. Nothing in the render path for `FinishSummaryBoard` or
`WatchRecoveryReceiptV5` waits for, or builds anything from, a server
response -- the numbers on both boards come from the LOCAL
`engine.completion`/`RecoverySummary`. So a run can legitimately still be
`.sending`, or have already flipped to `.failed`, for the entire time a
runner is looking at either board.

**This makes `FinishSummaryBoard` the RIGHT wiring target, not the wrong
one** -- it's also the one board in the finish flow that does not
auto-advance and can sit on screen indefinitely, making it the most
observable surface for a sync-status line. Corrected the stale doc comment
in place rather than leaving it standing next to code that now contradicts
it.

## 1 · Zero-readers claim, re-confirmed

Independently re-checked the `RequestDiagnosticsView` trap external review
flagged: confirmed its `syncState` reference resolves to a different type
than `PhoneSync.syncState` (distinguishable only by type annotation, not
name) -- the "zero real readers" claim holds.

## 2 · The fix

### 2.1 Bug 1 -- the one-way state guard (`PhoneSync.swift`)

`session(_:didFinish:error:)` (the primary `WCSession` transfer callback)
and the direct-POST URLSession delegate both had their state-transition
logic pulled out into two new, directly-testable pure methods:
`handlePrimaryTransferResult(failed:)` and
`handleDirectPostResult(id:status:failed:)` -- a real
`WCSessionUserInfoTransfer`/`URLSessionTask` cannot be constructed by a
test, so the logic had to be reachable without one.

The actual bug: `handleDirectPostResult`'s success branch used to read `if
self.syncState == .sending { self.syncState = .sent }` -- one-way, only
ever `.sending` → `.sent`. But the direct-POST path is the BACKUP, and it
can succeed AFTER the primary has already failed and set `syncState` to
`.failed(...)`. When that happened, the guard's condition was false and
`syncState` stayed `.failed` forever, even though the run had, in fact,
safely reached the backend by the other route. Fixed with a `switch`:
`.sending` or `.failed` both correct to `.sent` on a successful backup
POST; `.idle`/`.sent` are left alone (nothing to correct).

### 2.2 Bug 2 -- silent retry-queue eviction (`PhoneSync.swift`)

`enqueueDirect`'s 50-entry cap used to evict the oldest unsent completion
with `q.removeFirst(q.count - 50)` and no trace at all. Per this file's own
header ("a recorded run once vanished" is why `syncState` exists), an
eviction here IS a vanished run, not routine housekeeping. Fixed to decode
the evicted entries' `workoutId` (via a small `Decodable`-only mirror
struct, since the real `WatchCompletion` model is `Encodable` only) and log
one line per eviction through a new `static var evictionLogger: (String) ->
Void` seam -- production default prints exactly like every other notable
event in this file (`[PhoneSync] ...`); a test replaces the closure to
assert the call actually fired, rather than scraping stdout.

### 2.3 UI wiring (`FacesFinishV5.swift`, `WatchRouterV5.swift`)

New `FinishSyncStatus` enum (`.sent`/`.sending`/`.failed`) as the plain
presentation-layer value `FinishSummaryBoard` draws -- this file's own
header says these boards "know nothing about... PhoneSync," so
`WatchRouterV5.swift` owns the translation (`finishSyncStatus(for:)`) from
the real `PhoneSync.SyncState`, matching the existing
wire-to-presentation layering `WatchLobbyAdapter` already uses for the
lobby boards.

- `.sent` → nothing drawn (the ordinary, successful case).
- `.sending` → "Saving", dim (`WatchV5.valueDim`).
- `.failed` → "Still saving · trying another way", **amber**
  (`WatchV5.attention`), never `WatchV5.fault` (red) -- this project's
  color doctrine reserves red for something worse than "still working on
  it," and a retrying backup path is not that.

Both `WatchFinishSurfaceV5` and `WatchRecoveryReceiptV5` now hold
`@ObservedObject private var phoneSync: PhoneSync = .shared` so the status
line redraws live as sync resolves while the runner is looking at the
board, not just at first render.

Two new SwiftUI previews added (`Summary · sending`, and a `.failed`
counterpart) so the two non-default states can be visually confirmed per
Rule 13, not just judged from code.

## 3 · Verification

- `xcodegen generate` run to register the two new test files
  (`PhoneSyncStatusTests.swift`, `FinishSyncStatusTests.swift`) in the
  Watch test target -- confirmed necessary: a pre-registration run reported
  "Executed 0 tests" despite the files existing on disk.
- `xcodebuild test`, scoped to the two new suites: **9/9 passed**
  (`FinishSyncStatusTests`: 4 tests covering all 3 states plus the
  never-red invariant; `PhoneSyncStatusTests`: 5 tests covering both bug
  fixes).
- Full `FaffWatch Watch AppTests` target: **243 tests in 19 suites passed,
  0 failures** -- no regressions.
- Rule 18: `evictionPastCapLogsBeforeDropping` and `noEvictionNoLog`
  together constitute the falsifying pair for Bug 2 -- the pre-fix
  `removeFirst` with no logging call would fail the first (asserts
  `logged.count == 1`) while trivially passing the second; both pass
  against the fixed code, and the eviction test's specific assertion on
  the evicted entry's `workoutId` appearing in the log message confirms
  the fix decodes and reports the RIGHT entry, not just "something."
  `backupSuccessAfterPrimaryFailureCorrectsToSent` is the direct falsifier
  for Bug 1 -- constructs the exact `.failed` → successful-backup-POST
  sequence the one-way guard used to mishandle.

## 4 · Scope discipline

- Sync TRANSPORT mechanisms (`WCSession` transfer, direct-POST networking
  itself) untouched -- only the status tracking/surfacing around them
  changed.
- Reused `FacesFinishV5.swift`'s existing "Provisional" caption convention
  (dim label, `WatchV5.number` face) for the new status line rather than
  inventing a new visual pattern.
- `RequestDiagnosticsView`'s unrelated `syncState` (a different type) left
  untouched.

## 5 · Files changed

```
legacy/native/Faff/FaffWatch Watch App/PhoneSync.swift          | ~110 ++--
legacy/native/Faff/FaffWatch Watch App/WatchRouterV5.swift       |  ~43 ++
legacy/native/Faff/FaffWatch Watch App/FacesFinishV5.swift       | ~135 ++
legacy/native/Faff/FaffWatch Watch AppTests/PhoneSyncStatusTests.swift  | new
legacy/native/Faff/FaffWatch Watch AppTests/FinishSyncStatusTests.swift | new
native-v2/Faff.xcodeproj/project.pbxproj                          | registers the 2 new test files
```

Branch: `fix/f119-phonesync-status-2026-09-14`, based on `origin/main`.
Committed by the code-agent lead after finding and completing a small gap
left by the implementer's own turn ending mid-verification (the eviction
logger was defined but never actually called at the call site — added the
missing decode-and-log call before committing; all other content is the
implementer's own work, independently re-verified).
