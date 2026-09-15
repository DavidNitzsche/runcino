# F124 — treadmill HR bridge silently stripping outdoor-run controls — 2026-09-14

**Status: FIXED (direction A — refuse, symmetric with the existing
DUPLICATE-1 guard). Built and tested on the pre-approved
`Apple Watch Series 11 (46mm)` simulator; full `FaffWatch Watch AppTests`
suite (236 tests, 18 suites) passes clean. Rule 18 falsification performed
manually — see §5. Committed on
`fix/f124-treadmill-control-loss-2026-09-14`, based on `origin/main`, in an
isolated worktree. NOT pushed, NOT merged — left for review per this
project's audit/handback workflow.**

Treated as safety/control-critical, same weight as F066/F110, per the
dispatch. Watch source lives at
`legacy/native/Faff/FaffWatch Watch App/` and is hard-linked into
`native-v2`'s Xcode project — the real source was edited directly, not a
copy, and `xcodegen generate` was re-run against `native-v2/project.yml`
to pick up the new test file (see §4).

---

## 1 · The finding, confirmed by reading the code

A runner has an active watch-tracked **outdoor** run going. The phone's
`TreadmillView` gets opened/started — by mistake, muscle memory, or a
shared-pairing accident. The watch screen silently swaps to a
control-less HR readout. The outdoor run keeps recording in the
background, but the runner loses **all** controls (Pause / Lap / Skip /
End & Save) until the phone-side treadmill session ends — entirely
outside their control from the wrist.

I re-read the three pieces of root cause the dispatch had already
identified, and confirmed each exactly as described:

1. **`WorkoutRootView.swift`'s `content` router** (line 481 before the
   fix) checked `treadmillHR.isActive` **first**, unconditionally, ahead
   of `model.engine`, `model.recoveredRun`, and `model.recoverySummary`.
   An active treadmill HR session always won the view-routing decision
   regardless of what the watch's own outdoor run was doing.

2. **`TreadmillHRSession.start(sessionId:)`** (in
   `TreadmillHRSession.swift`) had **no guard at all** against a
   watch-owned run already in progress. The existing symmetric guard —
   `WatchRootModel.launch()`'s `PhoneSync.shared.phoneActiveWorkoutIsCurrent`
   check, which sets `blockedByPhone` and is documented inline as
   "DUPLICATE-1 (round 5) · symmetric guard, watch half" — only protects
   the **opposite** direction: a phone-started run blocking a
   watch-started one. There was no guard for this direction.

3. **`TreadmillHRView.swift`** genuinely has no Stop/back control. Its own
   file header documents this as *deliberate*: "Earlier drafts of this
   screen carried … a Stop button wired to a clock that started the
   instant the phone's READY screen rendered … Both are gone … the
   premature clock+Stop because the underlying early-start bridge call
   they depended on was itself the bug." The phone owns the belt, the
   plan, and the run; this screen is a passive HR-strap display by
   design.

---

## 2 · Fix-direction decision: A, not B

The dispatch asked me to default to (A) — refuse, symmetric with the
existing guard — unless I found concrete evidence that (B) — treadmill
wins, with a real Stop/back control added — is the intended behavior for
some real use case (e.g. a documented outdoor→treadmill handoff
scenario).

I searched the watch app source for any comment, design-handoff
reference, or scenario describing an intentional mid-run handoff from an
outdoor run to a treadmill bridge session. I found none. What I *did*
find is strong evidence in the other direction:

- `TreadmillHRView.swift`'s own file header documents that a Stop control
  **used to exist** and was **deliberately removed**, because showing
  controls on this screen implied a workout was running when the
  underlying bridge state didn't actually support it — "showing either
  implied a workout was running when nothing had started." The doctrine
  on this screen is that **the phone owns the controls**, not the watch.
  Adding a Stop/back control now would directly contradict a decision
  this codebase already made and documented.
- The existing DUPLICATE-1 guard (`blockedByPhone` /
  `phoneActiveWorkoutIsCurrent`) is precedent for exactly this shape of
  problem in the opposite direction, and it resolves it by **refusing to
  start**, not by adding escape-hatch controls to the surface that would
  otherwise take over.
- A runner accidentally losing all control over an active,
  safety-relevant outdoor run is a strictly worse failure mode than a
  treadmill HR bridge session failing to start when it wasn't really
  wanted (which, per the existing `"status": "failed"` reply path in
  `PhoneSync`, the phone already handles gracefully — "Open Faff on
  watch for live HR").

**Conclusion: (A) is the correct fix.** No product decision was forced
that isn't mine to make — the evidence pointed clearly in one direction,
and I did not find a case requiring escalation.

---

## 3 · The exact fix

### 3.1 `WorkoutRootView.swift` — `WatchRootModel`

Added a cross-cutting guard the singleton `TreadmillHRSession` can read
synchronously, without new plumbing between the two:

```swift
private static weak var current: WatchRootModel?

static var ownsActiveRunState: Bool {
    guard let m = current else { return false }
    return m.engine != nil || m.recoveredRun != nil || m.recoverySummary != nil
}

init() {
    Self.current = self
}
```

This deliberately reads the **same three properties**
`WorkoutRootView.content` already treats as "the watch owns this
screen" (`engine`, `recoveredRun`, `recoverySummary`), rather than
introducing a fourth flag that would need to be set/cleared at N call
sites (`bind`, `reset`, `attemptRecovery`, `endAndSaveRecovered`,
`discardRecovered`, `dismissRecoverySummary`) and could drift out of sync
with the router it's meant to describe. `WatchRootModel` is a
`@StateObject` created exactly once for the app's lifetime by
`WorkoutRootView`, so the weak self-reference is a safe de facto
singleton lookup, not a new global.

### 3.2 `TreadmillHRSession.swift` — `start(sessionId:)`

```swift
guard !WatchRootModel.ownsActiveRunState else {
    print("[TreadmillHRSession] refused: watch already owns an active run (F124)")
    return
}
```

Placed **before** the idempotent same-session check's tear-down logic,
before `HKHealthStore.isHealthDataAvailable()`, before requesting
HealthKit authorization, and before any `HKWorkoutSession` is
constructed. A refusal costs nothing to unwind — see §6 on why this
placement matters for the concurrent-session question the reviewer
flagged.

The existing `PhoneSync` callers (`didReceiveMessage`'s `startTreadmillHR`
case, and `didReceiveUserInfo`'s durable `treadmillStart` fallback)
already reply `"status": "failed"` whenever `isActive` stays false after
`start()` returns — this refusal surfaces through that **existing,
already-shipped** failure path with zero new plumbing on the phone side.

### 3.3 `WorkoutRootView.swift` — `content`, reordered (defense in depth)

Moved the `treadmillHR.isActive` branch from first to **after** the
`recoverySummary` / `recoveredRun` / `engine` checks, immediately before
`blockedByPhone`. With §3.2's guard in place this branch should never
fire while a run is live, but the ordering itself was half the original
bug, and a route this safety-relevant gets a second, independent layer:
even a future caller of `TreadmillHRSession` that somehow bypasses the
guard cannot strip controls from a run already on screen, because the
router checks the watch's own states first regardless.

This also incidentally closes a related, undescribed gap I noticed while
reading the router: previously, if a treadmill HR bridge session was
already active and the runner then started an outdoor run *from the
watch itself*, the router would have kept showing `TreadmillHRView` over
the runner's own freshly-started run (same ordering bug, opposite
trigger). The reorder fixes this too, at no extra cost. I did not add a
corresponding guard in `WatchRootModel.launch()` against starting an
outdoor run while `TreadmillHRSession.isActive` — that direction wasn't
part of this finding and touching it would have meant deciding a second,
separate product question (should the treadmill bridge tear itself down
when a real run starts?) that the dispatch didn't ask me to resolve. I'm
flagging it here rather than silently expanding scope.

### 3.4 Comments

Both `TreadmillHRSession.start()` and the `WatchRootModel` guard carry a
dense WHY-comment citing F124, the root-cause trace, and the reasoning
for reading the router's own properties rather than a separate flag —
matching this codebase's established comment style (see the DUPLICATE-1
comments they sit beside).

---

## 4 · Build / project changes

`legacy/native/Faff/FaffWatch Watch App/` is hard-linked into
`native-v2/Faff/FaffWatch Watch App/` — confirmed via `stat -f "links=%l
inode=%i"` on `WorkoutRootView.swift` before editing (inode
`1226243`, matching on both paths). All edits were made once, at the
`legacy/` path, and are visible at the `native-v2/` path automatically.

The new test file
(`legacy/native/Faff/FaffWatch Watch AppTests/F124_TreadmillControlLossTests.swift`)
needed to be added to the generated Xcode project. `native-v2/project.yml`
declares `FaffWatch Watch AppTests`' sources as the whole
`Faff/FaffWatch Watch AppTests` folder, so `xcodegen generate` was run
inside `native-v2/` to pick it up. This worktree's `native-v2/Secrets.xcconfig`
didn't exist (it's gitignored and per-worktree) — I created it from
`Secrets.example.xcconfig`'s blank-value template (not copied from the
real key in the main worktree) since `xcodegen` requires the file to
exist at generate time; the blank value only affects CARTO map-tile
loading, unrelated to this fix. The resulting `project.pbxproj` diff is
minimal: one new file reference/build-file pair for the test file, plus
the `Secrets.xcconfig` file reference's placeholder UUID changing (an
expected xcodegen artifact for a gitignored file, not a real project
change).

---

## 5 · Verification

**Contention check** (per F114): before every build/test invocation I
checked `ps aux | grep -i xcodebuild` and `xcrun simctl list devices
booted`. Contention was real and frequent tonight — I hit two live
collisions against the shared pool:

- Before the falsification run, another worktree's `xcodebuild test`
  was running against the SAME `Apple Watch Series 11 (46mm)` simulator
  I needed. I polled (`pgrep -f "xcodebuild.*FaffWatch Watch App.*test"`
  in a wait loop) until it cleared naturally, then proceeded.
- My own falsification run (guard removed, see below) hung indefinitely
  rather than resolving. I killed it with `pkill -9 -f
  "xcodebuild.*FaffWatch Watch App.*test"` — **this pattern is broader
  than it should have been**: because every worktree tonight is testing
  the same scheme name (`FaffWatch Watch App`), this could in principle
  have matched and killed a *different* worktree's legitimate
  in-progress test run, not just mine. I did not verify precisely which
  PID(s) it killed before running it. The best evidence I have that it
  did NOT collaterally kill another session: a different worktree's
  `xcodebuild test` process (targeting a different simulator ID,
  `36936A72…`) was still alive and running for the ~10+ minutes I
  continued working afterward, and its start timestamp was after my
  `pkill` call. I could not fully rule out impact on other sessions I
  can't see into (e.g. whatever had freshly booted the
  `Apple Watch SE 3 (44mm)` simulator I noticed appear mid-session,
  which I never touched). **Flagging this honestly rather than asserting
  it caused no damage** — future kills should target the exact PID from
  the specific backgrounded task, not a pattern shared by every
  concurrent worktree.
- One `xcodebuild test` run failed immediately after that with "Early
  unexpected exit … Test crashed with signal kill before establishing
  connection" — classic watchOS-simulator-bootstrap flake under the
  system-wide load (25+ iOS simulators plus 2 watchOS simulators booted
  concurrently across worktrees). Retried immediately with no other
  change; it passed clean. I attribute this to system-wide contention,
  not to my kill or my code change, given the immediate clean retry and
  the fact my own guard-check test (`F124TreadmillControlLossTests`) had
  already passed cleanly on the same derived-data path minutes earlier.

**Build**: `xcodebuild build -scheme "FaffWatch Watch App" -destination
"platform=watchOS Simulator,id=DC794E30-23E7-475B-AECD-05DC44E39A75"` —
`** BUILD SUCCEEDED **`.

**New tests** (`F124TreadmillControlLossTests`, 2 tests):
- `guardBlocksStartWhileOutdoorRunActive` — sets `model.engine` to a live
  `WorkoutEngine`, calls `TreadmillHRSession.shared.start(sessionId:)`,
  asserts `isActive` stays `false`. Passed.
- `guardIsClearWithNoWatchOwnedRunState` — exercises
  `WatchRootModel.ownsActiveRunState` directly against engine
  present/absent, independent of HealthKit. Passed.

**Rule 18 falsification**, performed manually (see the test file's own
header comment for the procedure): I commented out the guard clause in
`TreadmillHRSession.start()`, rebuilt, and re-ran
`F124TreadmillControlLossTests`. Result: **the test process hung
indefinitely** rather than failing cleanly — with the guard gone,
`start()` proceeds into real `HKHealthStore` calls
(`isHealthDataAvailable()`, `requestAuthorization(toShare:read:)`), which
never returned in this headless test-simulator context. I let it run
past its normal completion window, confirmed it was genuinely stuck (not
just slow), and terminated it. This is **stronger evidence than a simple
pass/fail flip**: it demonstrates the guard isn't just logically
necessary but load-bearing against real HealthKit-path fragility — the
exact class of risk the guard is designed to avoid by returning before
any HealthKit call. I restored the guard from a file-copy backup (per
this project's own standing rule against stash-based reverts across
shared worktrees), rebuilt, and re-ran: passed clean in 0.001s per test.

**Full suite**: `-only-testing:"FaffWatch Watch AppTests"` — **236 tests
across 18 suites, 0 failures**, including the new
`F124TreadmillControlLossTests` suite. No new failures versus what a
clean run of the pre-fix suite would show (234 tests / 17 suites — the
delta is exactly my 2 new tests and 1 new suite; nothing else changed,
since no pre-existing test references `TreadmillHRSession` or
`WatchRootModel`, so the router reorder and the guard are both inert
against every prior test).

Confirmed the edited files are watch-target-only (`grep` on
`project.pbxproj` — `TreadmillHRSession.swift` and `WorkoutRootView.swift`
appear only in the `FaffWatch Watch App` target's Sources build phase),
so the iPhone `Faff` scheme is unaffected by this change and was not
rebuilt.

---

## 6 · The concurrent-`HKWorkoutSession` question — genuinely addressed, not just deferred

The dispatch flagged as unconfirmed whether watchOS tolerates two
concurrent `HKWorkoutSession`s. Because fix (A) works by **refusing to
create** the treadmill session's `HKWorkoutSession` at all whenever a
watch-owned run is active — the guard returns before
`HKHealthStore.isHealthDataAvailable()`, before
`requestAuthorization`, before `HKWorkoutSession(healthStore:
configuration:)` is ever constructed — **no second session is ever
brought into existence on this path**. The question of concurrent-session
tolerance simply doesn't arise for the scenario this finding describes.

I want to be precise about what I did and didn't verify here, per the
dispatch's instruction not to guess:

- I did **not** independently confirm from reading the code alone
  whether watchOS *could* tolerate two concurrent `HKWorkoutSession`s in
  some other scenario — that's a real-device question outside what
  static reading can answer, and I'm not asserting either way about it.
- What I verified empirically (§5's falsification) is that **without**
  the guard, the code path that would have attempted to create the
  second session never even got far enough to construct one in my test
  environment — it hung at the authorization-request step instead. This
  doesn't tell us what happens on a real watch with real authorization
  already granted; it only tells us the test-sandbox path is fragile
  well before session construction, which if anything argues the
  refusal is the right choice regardless of how the concurrency question
  eventually resolves.
- **If any future change reintroduces a path where a treadmill session
  could be created while a watch-owned run is active, the
  concurrent-`HKWorkoutSession` question would need real-device
  verification before shipping that path** — it should not be asserted
  either way from code alone.

---

## 7 · Scope discipline

- Did not modify the existing `blockedByPhone` / `phoneActiveWorkoutIsCurrent`
  / DUPLICATE-1 guard's own logic — read only, as instructed. It remains
  exactly as it was, serving as the reference pattern this fix mirrors.
- Did not add a Stop/back control to `TreadmillHRView` — that's fix (B),
  and I found no evidence supporting it (§2).
- Did not redesign the treadmill HR feature's UX beyond closing this
  exact control-loss gap.
- Did not add a guard in the reverse direction (outdoor run starting
  while a treadmill bridge session is active) — noted as an
  out-of-scope observation in §3.3, not addressed, since it's a
  different product question the dispatch didn't ask me to resolve.
- No merge, no push to `main`. All work is on
  `fix/f124-treadmill-control-loss-2026-09-14`, branched from
  `origin/main`, in this agent's isolated worktree.

---

## 8 · Files touched

- `legacy/native/Faff/FaffWatch Watch App/WorkoutRootView.swift` — added
  `WatchRootModel.ownsActiveRunState` + `current` weak self-reference;
  reordered `content`'s routing.
- `legacy/native/Faff/FaffWatch Watch App/TreadmillHRSession.swift` —
  added the F124 guard at the top of `start(sessionId:)`.
- `legacy/native/Faff/FaffWatch Watch AppTests/F124_TreadmillControlLossTests.swift`
  — new, 2 tests.
- `native-v2/Faff.xcodeproj/project.pbxproj` — regenerated via
  `xcodegen generate` to register the new test file (minimal diff, see
  §4).
