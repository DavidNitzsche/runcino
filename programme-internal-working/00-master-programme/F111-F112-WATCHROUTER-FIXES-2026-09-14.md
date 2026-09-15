# F111 (High) / F112 (Medium) — `WatchRouterV5.swift` fixes, unit-tested, plus a project-wide Watch sweep — 2026-09-14

**Status: FIXED, unit-tested with a Rule 18 falsification (revert / repro /
restore), build verified for the `FaffWatch Watch App` scheme, full Watch
test suite run clean (243 passed, 0 failed). Committed on
`fix/f111-f112-watchrouter-2026-09-14`, based on `origin/main`, NOT pushed,
NOT merged — left for review.**

Source of truth confirmed via `scripts/native-v2-prep.sh`'s own header
comment: the watch app stays in `legacy/native/Faff/FaffWatch Watch App/`
and ships unchanged into `native-v2`; that is the real file edited here, not
a copy.

---

## 1 · F111 — `recordSplit()` froze `lastSplitSec` during a pending interrupt

### 1.1 The bug

`recordSplit(_:)` only ran from inside `WatchRunSurfaceV5.momentBoard`'s
`.split` case — reachable only when `router.interrupt(engine:tracker:)`
resolves to `.moment(.split(...))`. But `interrupt(...)`'s own precedence
order puts `pendingQuestion` FIRST: a pending bail / ceiling-override /
low-battery / GPS question "outranks everything" (the enum's own doc
comment) and can sit up for minutes. So a mile that passed while a question
was on screen never called `recordSplit`, `lastSplitSec` stayed frozen, and
the NEXT split — drawn AND spoken, since `speak()` fires unconditionally off
`engine.transition` changing — compared itself against a stale baseline with
nothing on screen to say so.

This is the third instance of the exact same shape found in one night:
F066 (bail-check accounting sat behind the `planComplete` display branch in
`WorkoutEngine.tick()`, already fixed) and F110 (`milesAdrift` sits behind
`allowSplitFlash`, also in `tick()` — **confirmed still OPEN, see §3**) are
the other two. `offerBailIfDue()`, a few dozen lines down in this same file,
was already the correct counter-example: it reacts to `engine.milesAdrift` /
`engine.ruleBreachSec` directly via `onChange`, decoupled from whatever the
interrupt stack is showing.

### 1.2 The fix

Matches F066/F110's established shape — the accumulator update becomes
unconditional; the display gate keeps deciding only what's drawn — but goes
one step further than a pure code-location fix, for a testability reason
explained below.

- **Moved the baseline off the View's `@State`, onto `WatchRouterV5` itself**
  (`lastSplitSec`, now `private(set)`), plus a new
  `recordSplit(paceSec:isRace:goalSec:totalDistanceMi:) -> String?` and a
  pure `static func splitComparison(...)` doing the arithmetic. This mirrors
  `WatchRouterV5.grade()` / `.gradingPhase()`, which this same file's own
  comment says are "pure and static... so the router has to be testable
  without an `HKWorkoutSession`." A `@State` var on a SwiftUI View struct is
  invisible to a test target even with `@testable import`; a method on the
  `ObservableObject` router is not.
- `WatchRunSurfaceV5`'s `.onChange(of: engine.transition)` handler — which
  already fires unconditionally and already drives `speak()` regardless of
  what's on screen — now also calls `router.recordSplit(...)` unconditionally
  for a `.split` cue, and caches the returned comparison text in a new
  `@State private var lastSplitComparisonText` for the board to draw later
  if it ever gets the screen.
- `momentBoard`'s `.split` case and `momentValues` no longer recompute the
  comparison at display time (which would run against the ALREADY-ADVANCED
  baseline and diff a number against itself) — they read the cached text.
- Deleted the old `recordSplit(_:)` and the instance `splitComparison(_:)`
  entirely, left as a `elevation(_ feet:)`-style deletion note in place (this
  file's existing convention for a removed function).

### 1.3 Test coverage — new file `WatchRouterV5Tests.swift`

Five tests target this fix directly, run at the router level with no engine,
no tracker, no View:

- `splitRecordedWhileAQuestionIsPendingStillAdvancesTheBaseline` — sets
  `router.pendingQuestion = .bailOffered`, confirms
  `router.interrupt(engine:tracker:)` really would suppress the board, then
  proves `recordSplit` still advances `lastSplitSec` and the NEXT split
  compares correctly against it — the exact scenario named in the task.
- `twoSplitsUnderOneLongInterruptStillProduceTwoDistinctComparisons` — two
  splits under one still-pending question must produce two DIFFERENT
  comparisons (500→520→505), not one comparison against a frozen 500
  baseline (the bug's exact shape).
- `differenceUnderThreeSecondsIsTreatedAsNoise`,
  `raceSplitComparesAgainstGoalPaceRegardlessOfThePreviousMile`,
  `staticSplitComparisonMatchesTheInstanceMethodExactly` — arithmetic and
  race-vs-training-run coverage carried over unchanged from the original
  logic.

**Rule 18 falsification, performed exactly as specified (file copy, not
`git stash` — stashes are shared across worktrees on this box, per standing
project guidance):**

1. Copied the fixed file and the pre-fix `HEAD` version to the scratchpad.
2. Reintroduced the bug shape surgically: wrapped `recordSplit`'s
   `lastSplitSec = paceSec` write in `if pendingQuestion == nil { ... }`
   (i.e. exactly re-created "the baseline only advances when nothing is
   suppressing display", without breaking the file's compileability, since a
   literal full revert to the pre-refactor shape would just fail to compile
   against the new test file rather than fail the test — which is itself a
   demonstration of why the old shape was untestable).
3. Ran `WatchRouterV5Tests` — **exactly the two regression tests failed**
   (`splitRecordedWhileAQuestionIsPendingStillAdvancesTheBaseline`,
   `twoSplitsUnderOneLongInterruptStillProduceTwoDistinctComparisons`), all
   seven other tests in the file stayed green.
4. Restored the real fix from the saved copy, re-ran — all nine tests green
   again.

---

## 2 · F112 — `controlsHeader` hardcoded "Mile N" with zero km conversion

### 2.1 The bug

`controlsHeader` (warm-up / recovery / cooldown / Just-Run header) built its
mile marker as `let mile = Int(tracker.distanceMi) + 1; return "Mile \(mile) ..."`
— no unit read, no conversion, ever. This is a **regression** of a defect
the same file's own `raceMileLabel` comment already describes as fixed once:
*"This was `Int(tracker.distanceMi) + 1` under a 'Km ' prefix... A metric
runner nine miles into a marathon was told 'Km 10' when they had covered
14.5, on the header of the board they read most."* `controlsHeader` was that
"one board over" the comment warns is "still standing."

### 2.2 The fix

Rather than hand-copy `raceMileLabel`'s inline conversion into
`controlsHeader` a second time (which is exactly how this bug happened
twice), the shared logic moved into `WFmt` — the file's own designated home
for "what a number means," per its header comment ("Kept here rather than
in the boards so that 'what 7:42 means' is a routing decision and 'how 7:42
looks' is a design one"):

```swift
static func mileMarker(_ mi: Double, units: String?) -> String {
    let km = isKm(units)
    let covered = km ? mi * 1.609344 : mi
    return (km ? "Km " : "Mile ") + String(Int(covered) + 1)
}
```

Both `raceMileLabel` and `controlsHeader` now call `WFmt.mileMarker(...)` —
one implementation, one place it can regress, and the two headers can no
longer independently disagree about which marker the runner is standing at.
The `1.609344` literal was kept byte-identical to `raceMileLabel`'s original
working (rather than `1 / milesPerKm`) to avoid introducing a floating-point
rounding difference between the two call sites.

### 2.3 Test coverage

`WatchRouterV5Tests` adds four `WFmt.mileMarker` tests (pure, no rig needed):
mile-runner stays in miles; the exact scenario from `raceMileLabel`'s own
comment (9 mi → "Km 15", not "Mile 9" and not the original "Km 10" bug);
zero-distance edge case; and a consistency check across a range of
distances. No existing test exercised `raceMileLabel` or `controlsHeader`
directly before this (both were View-private), so this is new coverage, not
a replacement of anything.

---

## 3 · Project-wide sweep for the same bug shape

Per the task's explicit instruction, treated with the same seriousness as
the phone-side F100 sweep. Scope: `legacy/native/Faff/FaffWatch Watch App/`,
focused on the two files where "what's on screen" state and safety-relevant
accumulators actually intersect — `WatchRouterV5.swift` (fully re-read after
the fix) and `WorkoutEngine.swift` (`tick()`, `advance()`,
`recordCurrentPhase()`, the RPE and bail machinery — all read in full).
`WorkoutTracker.swift` and `WorkoutRootView.swift` were checked for the same
shape but carry no router/interrupt-state awareness at all (sensor-only /
crash-recovery-only), so they are structurally a much lower-risk category
for this exact defect; not exhaustively line-by-line reviewed.

### 3.1 CONFIRMED, STILL OPEN — F110 itself was not actually fixed in code

Re-checked directly against current `WorkoutEngine.swift` (not assumed from
the finding write-up): `noteMileBand(inBand:)` — the sole updater of
`milesAdrift`, the pace-bail trigger — is still nested inside
`if allowSplitFlash, mileIndex > lastMileIndex { ...; noteMileBand(...) }`
at the mile-crossing block in `tick()`. `git log --grep F110` shows only a
docs-only finding-registration commit (`cfc3f27e0`); no code commit exists
for it. **This task's scope explicitly excluded touching F110's fix ("Do not
touch F066's or F110's own fixes beyond reading them as reference
patterns"), so it was left as-is** — flagging here only because the task
brief's framing ("already fixed twice") doesn't match what's actually in the
tree, and because leaving a confirmed High/safety finding unfixed needs to
be visible rather than silently assumed done. This is not a new finding;
it's confirmation that the existing F110 register entry ("Open, high
priority — safety-relevant") is still accurate.

### 3.2 No new instances found

Systematically checked every other accumulator/display interaction in the
two files:

- `WorkoutEngine.tick()`'s HR-ceiling flag, drift-zone (`paceZone`/
  `paceDeltaSPerMi`), fuel/gel firing, mile bookkeeping (`mileSplits`/
  `lastMileIndex` outside the `allowSplitFlash` branch), stall-watch, and
  the finish/advance bookkeeping in `advance()` — all update unconditionally
  with any haptic/flash purely layered on top, not gating the update.
- `recordCurrentPhase()` — `results.append(...)` (the per-phase completion
  record, arguably the most safety-relevant accumulator in the file) is
  fully unconditional; `pendingRpeResultsIndex` (a display trigger) is set
  separately afterward and does not gate the append.
- `noteRuleMetric(hrBpm:tickSec:)` (F066's own fix) is called unconditionally
  in both the normal and `planComplete` branches of `tick()`, confirming
  F066 itself remains correctly fixed.
- Router-side one-shot flags in `WatchRunSurfaceV5` — `ceilingAsked`,
  `batteryOffered`, `firedCueIds` (via `fireDueCue()`) — are each gated on
  `pendingQuestion == nil` too, but these are IDEMPOTENCY flags for a
  one-time offer/cue, not continuously-significant safety accumulators: if
  suppressed, the offer/cue is correctly retried later rather than lost or
  corrupted, which is the documented, intentional behavior ("a cue never
  interrupts a question — the coach does not talk over their own asking").
  Confirmed this is a different, benign shape from F066/F110/F111 rather
  than a fourth instance.
- `bailAnswered` / `bailTaken` / `ceilingLifted` / `skippedRepOrdinals` all
  write only from direct user-tap closures (`onCutItShort`, `onLiftForToday`,
  etc.), which is event-driven by design, not per-tick accounting — not the
  same shape.

No additional confirmed instances to fix or flag beyond the F110
re-confirmation above.

---

## 4 · Verification

- `xcodebuild build -scheme "FaffWatch Watch App"` — **BUILD SUCCEEDED**.
- Checked `ps aux | grep xcodebuild` and `xcrun simctl list devices booted`
  before every test run per the F114 contention warning; a concurrent
  `xcodebuild test` from another worktree was in fact running against
  `DC794E30-...` throughout this session. Created and used a dedicated,
  uniquely-named simulator (`F111F112-WatchTest-46mm`) for every test run in
  this task instead of any shared/already-booted device, then deleted it
  afterward.
- `WatchRouterV5Tests` (new, 9 tests): all pass.
- Full `FaffWatch Watch AppTests` suite: **243 passed, 0 failed** — no
  regressions versus baseline.

## 5 · Files changed

- `legacy/native/Faff/FaffWatch Watch App/WatchRouterV5.swift` — both fixes.
- `legacy/native/Faff/FaffWatch Watch AppTests/WatchRouterV5Tests.swift` —
  new, 9 tests total (5 for F111's `recordSplit`/`splitComparison`, 4 for
  F112's `WFmt.mileMarker`).

Branch: `fix/f111-f112-watchrouter-2026-09-14`, based on `origin/main`. Not
pushed, not merged.
