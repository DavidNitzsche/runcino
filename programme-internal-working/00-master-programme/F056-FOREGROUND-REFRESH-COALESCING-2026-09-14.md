# F056 — foreground-refresh coalescing swallows the load-bearing post; a completed run doesn't appear on Today until force-quit — 2026-09-14

**Status: FIXED (bypass, not a window-edge change — see §2 for why the
window-edge fix does not work), built and test-verified on a real iOS
Simulator device, falsified per Rule 18 before landing. WatchSync's own
completion-relay queue was traced and found to share the SAME root cause
through the SAME shared notification/observer — fixed in the same pass, not
a separate mechanism. Committed on `fix/f056-foreground-refresh-coalescing`,
based on current `origin/main`, NOT pushed, NOT merged — left for external
review per this project's standing workflow and this bug's real-priority
status. One honesty note up front, per Rule 13's own standard: the exact
end-to-end phone repro (background the app, let a real HealthKit import
race a real foreground load, watch it fail, then watch it succeed) was
**not** attempted — it needs a live HealthKit dataset and precise
sub-second timing on a device, which this session did not have. What
**was** achieved instead, and is not a weaker substitute dressed up as
equivalent: a real Xcode Simulator build, and a new integration test that
drives the actual production notification path (`NotificationCenter.post`
→ `V5Surface`'s real `.faffForegroundRefresh` observer → the real
`ForegroundWork.shouldLoadOnForeground` call) with a real in-flight async
fetch racing a real second post, falsified against the unfixed observer
and confirmed to reproduce David's exact symptom (`callCount` stuck at 1,
`model` stuck on the pre-run fixture) before the fix, and to pass after.**

---

## 0 · Which source tree is live (confirmed before touching anything)

This worktree's own starting checkout was stale (a May-era pre-rewrite
skeleton with no `native-v2`, no `CLAUDE.md`, no `FaffApp.swift`). Per
`feedback_verify_active_branch.md`'s own standing warning that "Agent
worktrees start on stale OIRJr," fetched `origin/main` and built the working
branch from there (`git checkout -B fix/f056-foreground-refresh-coalescing
origin/main`). On `origin/main`:

- `native-v2/Faff/Faff/FaffApp.swift` is 44,871 bytes — the live, actively
  developed app entry point (matches the conversation's own `git status`
  snapshot showing `native-v2/Faff.xcodeproj/project.pbxproj` as the
  modified file).
- `legacy/native/Faff/Faff/FaffApp.swift` is 680 bytes — a stub, not live.

`native-v2/` is canonical. All edits below are there.

---

## 1 · The real code, quoted, confirming the diagnosis exactly

### 1.1 `FaffApp.swift`'s two posts (before fix)

```swift
.onChange(of: scenePhase) { _, phase in
    guard phase == .active else { return }
    ...
    NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)   // immediate

    let now = Date()
    guard ForegroundWork.shouldImport(now: now, lastImportAt: lastImportAt) else { return }
    lastImportAt = now
    Task {
        await HealthKitImporter.shared.importIfConnected(daysBack: 2)
        // AND AGAIN AFTER THE IMPORT LANDS.
        NotificationCenter.default.post(name: .faffForegroundRefresh, object: nil)   // post-import
    }
}
```

Confirmed exactly as briefed: two deliberate posts per real foreground, the
second specifically to catch a run the import just pulled in.

### 1.2 `Util/ForegroundWork.swift`'s `shouldLoadOnForeground` (before fix)

The coalescing logic lives in its own file, `Util/ForegroundWork.swift` —
not inside `SurfaceStoreV5.swift` itself, which is where the brief's naming
was imprecise (correctly flagged as possible in the task). `SurfaceStoreV5.swift`
is the CALLER:

```swift
static let foregroundLoadCoalesceSec: TimeInterval = 3

static func shouldLoadOnForeground(now: Date, lastLoadAt: Date) -> Bool {
    now.timeIntervalSince(lastLoadAt) > foregroundLoadCoalesceSec
}
```

### 1.3 `ViewsV5/SurfaceStoreV5.swift`'s observer (before fix) — the exact defect

```swift
foreground = NotificationCenter.default.addObserver(
    forName: .faffForegroundRefresh, object: nil, queue: .main
) { [weak self] _ in
    Task { @MainActor in
        guard let self else { return }
        let now = Date()
        guard ForegroundWork.shouldLoadOnForeground(now: now, lastLoadAt: self.lastForegroundLoadAt) else { return }
        self.lastForegroundLoadAt = now          // ← stamped BEFORE `await load()`
        await self.load()
    }
}

private var lastForegroundLoadAt: Date = .distantPast
```

Confirmed exactly as briefed: `lastForegroundLoadAt` is written at
load-**START**, one line before the `await`. If the post-import post lands
inside the 3-second window measured from that start-stamp, it is coalesced
away, and the first load — which already ran and answered before the import
finished — is the only thing that ever asked the server. Force-quitting
resets `lastForegroundLoadAt` to `.distantPast`, which is the entire reason
a relaunch "fixes" it: it defeats the window, not because a relaunch does
anything else meaningful.

---

## 2 · Which fix direction, and why the other one does not actually work

The task offered two candidate directions. **Direction 2 (bypass) was
chosen — Direction 1 (measure from load-finish) was analyzed first and
rejected on the arithmetic, not on convenience.**

`FaffApp` fires the HealthKit import and `V5Surface`'s own GET as **two
separate, concurrent tasks** off the same foreground event — not a
sequential pair. Call the surface's own fetch duration `L` and the import's
duration `I`. The import is the "expensive" side by the code's own
comments, and further confirmed by David's own on-device timing (0.7–2s for
the import vs. a V5 GET the same comments describe as well under 1s), so
the ordinary case is `L < I` — **the surface's own load finishes before the
import does.**

- **Start-stamped (the bug):** the post-import post at `t = I` is checked
  against a stamp of `0`. Gap = `I − 0 = I`.
- **Finish-stamped (the "obvious" fix):** the post-import post at `t = I` is
  checked against a stamp of `L` (the first load's own finish time, already
  written by the time the import completes, since `L < I`). Gap =
  `I − L`, which is **strictly smaller** than `I` for any `L > 0`.

Moving the stamp to the finish edge **narrows** the window in exactly the
concurrent-start case this bug lives in. It does not widen it, and does not
close the bug — a finish-stamped `V5Surface` would still coalesce the
post-import post in the ordinary case, because `I − L` stays well inside the
3-second window for the round-trip times this project has already measured.
This is written into `ForegroundWork.mustLoadKey`'s own doc comment so the
next person doesn't re-try the same "obvious" fix.

**The actual fix:** the post-import post (and `WatchSync`'s own
completion-landed post — see §3) is never supposed to be coalesced, at any
gap, because it only exists when something changed after the first load's
fetch already ran. So it is tagged, and the tag bypasses the throttle
entirely rather than trying to reshape the window to catch it.

---

## 3 · The fix, quoted

### 3.1 `Util/ForegroundWork.swift` — new bypass key + parameter

```swift
/// userInfo key on `.faffForegroundRefresh`. When the value is `true`, the
/// post is guaranteed load-bearing ... and `shouldLoadOnForeground` must
/// not coalesce it away regardless of how recently this surface last loaded.
static let mustLoadKey = "faff.foreground.mustLoad"

static func shouldLoadOnForeground(now: Date, lastLoadAt: Date, mustLoad: Bool = false) -> Bool {
    mustLoad || now.timeIntervalSince(lastLoadAt) > foregroundLoadCoalesceSec
}
```

`mustLoad` defaults to `false` — every existing call site (the pure-function
tests included) keeps asking exactly the question it always asked. This is
the ONE canonical decision point (per `CLAUDE.md`'s doctrine on one resolver
per derived decision) — the bypass lives inside `shouldLoadOnForeground`
itself, not as a second `if` bolted on at each call site.

### 3.2 `FaffApp.swift` — tag the post-import post

```swift
Task {
    await HealthKitImporter.shared.importIfConnected(daysBack: 2)
    NotificationCenter.default.post(
        name: .faffForegroundRefresh, object: nil,
        userInfo: [ForegroundWork.mustLoadKey: true]
    )
}
```

The FIRST (immediate) post is left untagged on purpose — it has nothing new
to report yet, and letting it fall into another surface's coalescing window
is the correct, cheap behavior REQUESTSTORM-2 already established.

### 3.3 `ViewsV5/SurfaceStoreV5.swift` — the observer honors the tag

```swift
foreground = NotificationCenter.default.addObserver(
    forName: .faffForegroundRefresh, object: nil, queue: .main
) { [weak self] note in
    let mustLoad = (note.userInfo?[ForegroundWork.mustLoadKey] as? Bool) == true
    Task { @MainActor in
        guard let self else { return }
        let now = Date()
        guard ForegroundWork.shouldLoadOnForeground(
            now: now, lastLoadAt: self.lastForegroundLoadAt, mustLoad: mustLoad
        ) else { return }
        self.lastForegroundLoadAt = now
        await self.load()
    }
}
```

### 3.4 `WatchSync.swift` — the completion-relay's own post, tagged the same way

See §4 for why this is in scope. `flushPendingCompletions()`'s post, which
only fires once `landed` is non-empty (a completion actually reached the
server):

```swift
NotificationCenter.default.post(
    name: .faffForegroundRefresh, object: nil,
    userInfo: [ForegroundWork.mustLoadKey: true]
)
```

This is the third instance of the exact bug family named in the task
(single-throttle → REQUESTSTORM-2 → this), and the fix does not repeat the
pattern of "move the number" — it removes the throttle's authority over
this one class of post entirely, rather than relocating the boundary again.

---

## 4 · WatchSync's completion-relay queue — traced, and the verdict is nuanced

The task named `WatchSync.swift`'s completion-relay queue (~line 208–229)
as a possible second, independent contributor via its own 60-second
throttle. Traced fully. **The literal hypothesis — that the 60s throttle
gates the primary watch-delivery path — is not confirmed. A different, real
contributor was found instead, sharing this bug's exact root cause.**

### 4.1 The 60s throttle (`refresh()`, line ~217–232) does NOT gate the primary delivery path

```swift
private var lastRefreshAt: Date = .distantPast

func refresh(force: Bool = false) async {
    guard force || Date().timeIntervalSince(lastRefreshAt) > 60 else { return }
    lastRefreshAt = Date()
    await pushTodayToWatch()
    flushPendingContextIfPossible()
    await flushPendingCompletions()
}
```

`flushPendingCompletions()` — the function that actually drains the queue
and posts `.faffForegroundRefresh` — is also called **directly**, bypassing
`refresh()` and its 60s throttle entirely, from every real delivery path:

- `session(_:didReceiveUserInfo:)` (line ~835–857) — **the actual path a
  finished watch run takes**, via `transferUserInfo`.
- `session(_:didReceive:)` (line ~800–809) — the >60KB-payload fallback via
  `transferFile`.
- `session(_:activationDidCompleteWith:error:)` (line ~744–762) — retried on
  every session activation.

None of these three wait on `lastRefreshAt`. The 60s throttle only
rate-limits the foreground/reachability-triggered **re-checks**
(`sessionReachabilityDidChange` → `refresh()`), not the delivery-triggered
drain. So as literally stated, the "independent 60-second throttle" is not
the mechanism — a watch-recorded completion is not silently held back for
up to a minute by this code.

### 4.2 What IS real: the same shared notification, the same shared bug

`flushPendingCompletions()` posts `.faffForegroundRefresh` — **the exact
same notification, consumed by the exact same `V5Surface` observer with the
exact same coalescing throttle** described in §1–2. This post is
unconditionally load-bearing (it only fires when `landed` is non-empty — a
completion the server just accepted), which is precisely the shape of post
that REQUESTSTORM-3 exists to protect. Before this fix, it had no tag and
was fully exposed to the same swallow: if a watch-recorded run's completion
lands within 3 seconds of some other load already in flight on the same
surface — plausible, since finishing a watch run and picking up the phone
are naturally close in time — the exact same "run doesn't appear until
force-quit" symptom follows, independently of whether `FaffApp`'s own
double-post race ever fires.

**Verdict: real, independently-reachable, same root cause — not the 60s
throttle as hypothesized, but the shared coalescing window.** Fixed in the
same pass (§3.4), and the `refresh()` throttle's doc comment now records
both halves of this finding so a future reader doesn't have to re-derive it
(see `WatchSync.swift`'s `lastRefreshAt` doc comment).

---

## 5 · Verification

### 5.1 What was and was not achieved, stated plainly (Rule 13)

**Not achieved:** a literal on-device repro — background the real app,
race a real HealthKit import against a real foreground load, observe the
run fail to appear, then observe it appear after the fix. This needs a live
HealthKit dataset with a run to import and precise control over the
timing, neither of which this session had. Stating this plainly rather than
substituting something weaker and calling it the same thing.

**Achieved, and it is a real device verification, not a pure-logic-only
one:** a new XCTest, `testPostImportPostIsNotSwallowedByAnInFlightFirstLoad`,
that exercises the **actual production code path** — a real `V5Surface`,
real `NotificationCenter.post` calls against the real `.faffForegroundRefresh`
name, landing on the surface's real `init`-installed observer, calling the
real `ForegroundWork.shouldLoadOnForeground` — with an async fetch closure
that genuinely suspends (`Task.sleep`) to put a real in-flight load on the
main actor's task queue while the second, tagged post arrives. This is run
on a **booted iOS 26.5 Simulator (iPhone 17 Pro)** via `xcodebuild test`,
not `swift test` against bare logic.

### 5.2 Falsification (Rule 18) — the test was broken on purpose first

1. Backed up the fixed `SurfaceStoreV5.swift` to a plain file copy (per
   `feedback_git_stash_shared_across_worktrees.md` — no `git stash`, which
   is shared across this machine's worktrees).
2. Reverted the observer to the pre-fix shape (ignoring `mustLoad`,
   restoring the exact bug).
3. Rebuilt and re-ran `testPostImportPostIsNotSwallowedByAnInFlightFirstLoad`
   on the simulator. **It failed**, reproducing the exact symptom:

   ```
   XCTAssertEqual failed: ("1") is not equal to ("2") - THE POST-IMPORT POST
   MUST TRIGGER ITS OWN LOAD. ...
   XCTAssertEqual failed: ("Optional(Faff.V5TodayState.beforeRun)") is not
   equal to ("Optional(Faff.V5TodayState.injuryFlare)") - THE SURFACE MUST
   REFLECT THE SECOND LOAD, NOT THE FIRST. ...
   Test Suite 'LifecycleSweepTests' failed ... Executed 1 test, with 2 failures
   ```

4. Restored the fixed file from the backup, rebuilt, re-ran. **Passed.**
5. Also falsified the pure-function claim by construction: the pre-fix
   `shouldLoadOnForeground(now:lastLoadAt:)` had no parameter capable of
   expressing "load anyway" at all — there was no argument to pass to make
   `testMustLoadBypassesCoalescingAtAnyGap` even compile against the old
   signature, which is a stronger falsification than a runtime assertion.

### 5.3 Full test results, real device, after the fix

```
xcodebuild -project Faff.xcodeproj -scheme Faff \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:FaffTests/LifecycleSweepTests test
...
Test Case '-[FaffTests.LifecycleSweepTests testMustLoadBypassesCoalescingAtAnyGap]' passed (0.001 seconds).
Test Case '-[FaffTests.LifecycleSweepTests testPostImportPostIsNotSwallowedByAnInFlightFirstLoad]' passed (1.005 seconds).
Test Suite 'LifecycleSweepTests' passed at 2026-09-14 16:56:53.434.
	 Executed 9 tests, with 0 failures (0 unexpected) in 2.447 (2.451) seconds
```

Also ran the two directly-adjacent sibling suites clean:

```
Test Suite 'RequestCoalescingTests' passed ... Executed 5 tests, with 0 failures
Test Suite 'StuckConnectionTests' passed ... Executed 7 tests, with 0 failures
```

A full-target run (`-only-testing:FaffTests`, all ~9 test files) hit one
unrelated infrastructure flake — `ColdOpenCacheHonestyTests.
testWarmCacheFetchFailsKeepsContentAndDisclosesAge` failed with "Unable to
initialize test bundle" / "Failed to load test bundle from ... Faff.app" —
a simulator/test-runner resource issue (this machine has a dozen+ other
simulators booted concurrently by other sessions per this project's own
worktree-sharing setup), not a code failure. Re-ran that single test in
isolation immediately after: **passed** (4.4s). Not touched by this diff —
it lives in cache-identity-window logic, unrelated to foreground refresh.

### 5.4 Build

```
xcodebuild -project Faff.xcodeproj -scheme Faff \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
...
** BUILD SUCCEEDED **
```

(`native-v2/Secrets.xcconfig` was missing from this fresh worktree checkout
— it's gitignored per `native-v2/.gitignore` and required by `project.yml`'s
`configFiles:` wiring; copied from the committed `Secrets.example.xcconfig`
template, exactly as that template's own header instructs. Not part of this
commit.)

### 5.5 Launch, real simulator

Attached to a booted "iPhone 17 Pro" simulator, launched the built
`Faff.app` (`run.faff.app`). Confirmed running via
`simctl spawn ... launchctl list | grep faff` (PID present, no crash).
Screenshot capture itself failed (`captureFailed`) on this shared machine —
a tooling/resource issue with the screenshot pipeline, not the app; not
pursued further since the primary verification (§5.2–5.3, the actual
race through the actual code path) is the load-bearing evidence here, not a
visual screenshot of a static launch screen that carries no information
about this specific timing bug.

---

## 6 · Scope discipline

Touched exactly: `FaffApp.swift` (one post's `userInfo`), `WatchSync.swift`
(one post's `userInfo` + one doc comment), `Util/ForegroundWork.swift` (one
new key, one new default parameter, doc comments), `ViewsV5/SurfaceStoreV5.swift`
(the observer closure signature and its guard), and
`FaffTests/ClientSweep/LifecycleSweepTests.swift` (two new tests). No other
foreground-refresh logic was touched. The immediate (non-import) post in
`FaffApp.swift`, `RootTabView`/`SettingsView`/`TargetsView`/`DecisionsSectionV5`/
`HostsV5`'s own separate posts of `.faffForegroundRefresh`, and
`v5ReloadOnForeground`'s per-view throttle are all unchanged — none of them
are the load-bearing "something just changed server-side" signal this fix
is scoped to.

---

## 7 · Files changed

- `native-v2/Faff/Faff/Util/ForegroundWork.swift`
- `native-v2/Faff/Faff/FaffApp.swift`
- `native-v2/Faff/Faff/ViewsV5/SurfaceStoreV5.swift`
- `native-v2/Faff/Faff/WatchSync.swift`
- `native-v2/Faff/FaffTests/ClientSweep/LifecycleSweepTests.swift`

Branch: `fix/f056-foreground-refresh-coalescing`, based on `origin/main` at
`9fbc79543` (fetched fresh this session). Committed, not pushed, not merged.
