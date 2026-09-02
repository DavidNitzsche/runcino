# Closure pass — the native half

Branch `closure/watch-capture`, commit **`f2e402bb`**, pushed to origin.
Based on `origin/main` at `16664371`, with `origin/closure/safety-owner` (`74462e33`)
merged in — say so at integration. **Not merged to main.**

The project's own pre-push gate ran and passed on the pushed tree:
`✓ next build green` and `watch OK · 223 test cases (223 @Test declarations); 20
boards inside Apple's content box`. The declaration count matching the executed count
is the part worth reading: every test I added is compiled into the target and ran.

Environment: Xcode 26.5. The watch sources at `native-v2/Faff/FaffWatch Watch App`
are a **tracked git symlink** (mode 120000) into `legacy/native/Faff/FaffWatch Watch App`
— one file, two paths. `_watch_grader_parity.test.ts` already records this and its
gate paths are correct; I re-verified the link rather than trusting the note.

---

## 1 · THE CAPTURE TRUNCATION

### 1a · What was actually wrong

The stored row for `-145861381014809` was produced by **`WorkoutEngine.completionFromRecovery`**,
the crash-recovery path — not by the live finish. Every field of the row is that
path's signature, and they only line up one way:

| Field on the row | What it means |
|---|---|
| `routePolyline` null | the recovery path passes `nil` (the pre-crash route died with the process) |
| `avgCadence` null | the recovery path passes `nil` |
| `kcal` null | `stats.kcal` was nil, so the HKWorkoutSession was gone |
| `movingSec` null | the recovery path never sets it; the live path always does |
| `ceilingLift.atSec` **3064** | stamped SEVEN SECONDS PAST the 3057 the row claims as its whole duration |
| `clockAudit.wallSec` 4694 | `completedAt` is 78 min after the start of a 56-minute run |
| `status` "completed" | `snapshot.planComplete == true` — overtime HAD been entered |

Two independent defects, both now closed.

**OVERTIME-1 — the run was never recorded past the last prescribed phase.**
`tick()` has had an overtime branch since 2026-08-26 and the clock kept counting
correctly. What did not exist was any *record* of it: `results` holds one entry per
PRESCRIBED phase and overtime is not a phase. On the live path that cost only the
breakdown (totals read the tracker). On the recovery path — which has no live totals
and falls back to `phaseDistSum` / `phaseDurSum` — it cost the run. The snapshot had
been carrying the overtime SECONDS in `phaseElapsedSec` the whole time, unread,
because `completionFromRecovery` only appends an in-flight phase when
`!snap.planComplete`. It had no distance total at all.

**REPCOUNT-1 — the engine counted seven reps on a six-stride session.**
`repCountForDisplay` was `phases.filter { $0.type == .work }.count`. The session is
ONE 5-mile easy leg (`type: work`) plus six strides, so: seven. That is the
`repCount: 7` / `beforeRepIndex: 7` on all four `recoveryExtensions`, and the runner
read "6 of 7" on stride five while the phase label beside it said "Stride 5 of 6".
Rule 16, literally: two names for one quantity, disagreeing on one screen. The same
quantity was recomputed inline in **four** places, including the "Rep n of m"
takeover board.

### 1b · What I changed

`legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift`

- **`repPhaseIndices`** — ONE resolver. A rep is a work phase immediately adjacent to
  a `.recovery` phase; if no work phase is, it falls back to counting all work phases,
  which reproduces the old behaviour exactly for easy / long / tempo / just-run.
  Structural, not lexical — it reads no labels, so renaming "Stride N of M" cannot
  break it. `repCountForDisplay`, `repIndexForDisplay`, `nextWorkRepOrdinal` and the
  takeover board all read it now.
  Checked against the owner's live payloads: strides **6** (was 7), 10×60s hills 10
  (unchanged), tempo 1 (unchanged), long 1 (unchanged).
- **`overtimeSec` / `overtimeMi` / `overtimePhase(...)`** — overtime becomes a real
  phase, typed `"overtime"`, labelled "After the session", `completed: true`,
  `verdict: nil`. One shaper, used by both completion paths.
  - Not `"work"`: folding a jog home into an interval session's work-weighted avg HR
    is the exact defect `buildCompletion` already documents at length.
  - Not `"cooldown"`: nobody prescribed it.
  - Floor of 5 s so ending on the last beat does not emit a tap artefact.
  - Guarded on `afterPhaseCount > 0` — see the falsification section, this was caught
    by an existing hostile-input test.
- **`advance()` plan-complete branch** now sets `phaseStartMi = coveredMi` and clears
  the per-phase sample buffers. Without the first line `phaseCoveredMi` stayed pinned
  to the START of the last prescribed phase for all of overtime, double-counting it.
  Latent before; wrong the moment anything read it.
- **`RunSnapshot.totalDistanceMi`** — new, optional, leniently decoded (same posture
  as `mileSplits`). The snapshot has always carried the whole TIME axis and never a
  distance total.
- **`completionFromRecovery`** — a plan-complete snapshot now appends its overtime the
  same way an in-flight one appends its live phase, and `totalDist` gains the odometer
  as tier 2 (live builder → odometer → phase sum). It does not use `savedAtEpoch` to
  extend the clock past the last snapshot: the engine credits only time it observed.

### 1c · Proof it now records past the last prescribed phase

`legacy/native/Faff/FaffWatch Watch AppTests/_CapturePastPlanTests.swift` — 16 tests,
driving the REAL engine second by second through the existing `SimRun` harness, on a
fixture that is the owner's 2026-09-02 payload phase for phase.

Executed: `xcodebuild test -scheme "FaffWatch Watch App" -destination 'platform=watchOS
Simulator,id=6018E01F-...'` → **223 tests in 16 suites passed** (baseline on
`origin/main` was 195 in 11).

The load-bearing ones:

- `everyOneOfTheSixStridesIsRunAndRecorded` — six stride phases, all `completed`, last
  one "Stride 6 of 6", thirteen phases banked.
- `theSessionKeepsRecordingAfterTheLastPrescribedPhase` — runs the plan out, then 292
  more seconds (the exact duration that went missing), then ends. Asserts the totals
  include it, that there is an `overtime` ROW carrying 292 s and the distance, that it
  carries no verdict, **and that the phases now sum back to the header** on both axes.
- `theHistoricalTruncationDoesNotReproduce` — replays the 2026-09-02 snapshot through
  `completionFromRecovery` with no live builder. Was 5.98 mi / 3057 s; now 6.41 mi /
  3349 s with a 14th phase carrying 292 s / 0.43 mi.
- `aSixStrideSessionCountsSixRepsAndNotSeven` — writes the OLD rule out in the test and
  asserts it says 7 while the engine says 6, so the test cannot agree with itself.

### 1d · The historical run — nothing to present

Repaired by another session with the runner's approval while I was working. I did not
touch that row and hold no proposed diff.

**One consequence, and my change is what closes it.** The repaired row's header says
6.41 mi while its phases still sum to 5.98, because the recovered 0.43 mi belongs to no
phase. On any run captured by this engine the two reconcile — that is exactly what
`theSessionKeepsRecordingAfterTheLastPrescribedPhase` asserts. The gap is a property of
that one repaired row, not a shape future runs will keep producing.

### 1e · What I did NOT fix, and is worth someone's attention

The four `recoveryExtensions` are stamped `atSec` **2954, 2954, 2955, 2955** — four
"+30 sec" records inside two seconds, and then the phase they extended ended at 59 s
with `completed: false` despite +120 s having been added. One press was recorded four
times. That is a control / input-repeat defect on the recovery face, not a capture one,
and I left it alone rather than widen scope. `recordRecoveryExtension` has no debounce.

---

## 2 · STRIDES SURVIVE THE ROUND TRIP

`WatchPhase` has decoded `isStrideSegment` since 2026-08-23. It died on the wrist:
`WatchCompletionPhase` had no such property, so every server-side reader of a finished
run had to infer "this 20-second work phase was a stride" from its label.

- `WatchCompletionPhase.isStrideSegment: Bool?`, set only when true. Swift synthesises
  `encodeIfPresent` for an Optional, so an ordinary phase's encoded body is unchanged —
  asserted directly in `theKeyIsAbsentRatherThanFalseOnTheWire`.
- `recordCurrentPhase` copies it from the source phase.
- `strideSegmentsComeBackFlaggedAndNothingElseDoes` — six flagged, all labelled
  "Stride…", the 5-mile easy leg (also `.work`) NOT flagged, walk-backs not flagged.

`scripts/check-wire-keys.sh` passes with the new key: **51 emitter keys, all present in
web-v2**. I did not need to touch the TS side.

While reading it I also corrected the `verdict` doc comment on that struct, which still
documented the retired `drifted` / `missed` vocabulary that PACE-SHAPE-1 removed on
2026-09-01 — Rule 20's prose corollary.

---

## 3 · EARLIER-DAY FETCH — VERIFIED ON THE DEVICE

`SurfaceStoreV5.load()`'s `case .failed: stale = true` is right, and its header
argues it well. The gap is that `stale` is only ever read through `isOutage`, which
requires `model == nil` — so with content in hand it lit NOTHING. And after a
`rebind` the content on screen is a DIFFERENT DAY from the one the header and the
strip are naming.

**The fix does not slow the strip down**, which is what made the previous pass decline
it. It does not drive the strip off `model.dateISO` and nothing waits. In
`HostsV5.swift`:

- `otherDayOnScreen(_:)` compares the day the runner ASKED for (`viewingDate`, or the
  payload's own today when home) against the day the payload on screen is FOR
  (`model.dateISO`) — a fact, not a flag.
- Gated on `!surface.refreshing`, which is why it does not fire on ordinary
  navigation: while the read is in flight the mismatch IS just a load and the existing
  crossfade covers it. The note appears only once the read has come back and the day
  still has not changed.
- Rendered as the design's own `ErrorNote` (fault-red rule, Retry) in a
  `safeAreaInset(edge: .top)` over `content(model)` — ONE place, every Today variant,
  no per-variant plumbing (Rule 17).
- A failed "back to today" lights the identical note, because it is the identical lie.

**Verified by rendering, on his real data (Rule 13).** With the network up the read
succeeds, so I made it fail on purpose: `API.baseURL` pointed at `http://127.0.0.1:9`,
rebuilt, launched against the real cached payload (`faff.cache.v5.today.at` =
2026-09-02 17:20:42Z, owner `0645f40c-…`), tapped Tuesday the 1st.

**And the falsification found a bug in my own copy** — the note appeared and named the
wrong days: "Monday, August 31 did not load. You are looking at Tuesday, September 1",
on a screen showing Wednesday the 2nd. Both one day early, because `Self.iso` parses
`"2026-09-01"` as UTC midnight while my display formatter sat on the device zone, and
PDT renders that instant as the evening of the 31st. On the one component whose whole
job is to say which day you are looking at.

Formatter pinned to UTC; rebuilt; repeated. The screen now reads **"Tuesday, September
1 did not load. You are looking at Wednesday, September 2."** with the fault-red rule
and a working Retry, over the strip still showing Tuesday and Wednesday's real
6.41 mi / 55:49 content below it.

`API.baseURL` is restored to `https://www.faff.run` and `git diff` on that file is
empty. Reading the code would not have found the off-by-one; only the screen did.

**Two corrections to what I told you earlier:**

1. **I did not need port 3111 and I never took it.** The app's `baseURL` defaults to
   `https://www.faff.run`, so the simulator build talks to PRODUCTION, not localhost.
   My brief said otherwise and I checked rather than assumed — worth correcting in
   whatever that instruction came from, because "with no server there it paints a
   12-hour cache and screenshots prove nothing" is not true of this build.
2. **My first attempt to reproduce failed for a silly reason and I nearly reported it
   as a product defect.** I was converting screenshot PIXELS into tap POINTS at 1:1;
   the screenshot is 919 wide and the tap space is 402, a 2.29x factor. Four taps
   landed in dead space and I was one edit away from writing "the day strip appears
   inert on the after-run screen" into this report. It is not. Flagging it because the
   same mistake would produce a very convincing false finding for anyone driving this
   simulator.

## 4 · WATCH COMPATIBILITY AND THE SAFETY STOP

**I merged `origin/closure/safety-owner` (`74462e33`) into `closure/watch-capture`.**
Say so at integration: my branch carries it.

### The telemetry, measured on production (read-only)

| Question | Answer |
|---|---|
| Users with any watch-sourced run in the last 120 days | **ONE** — `0645f40c-…`, 53 runs, most recent 2026-09-02, out of 16 accounts |
| Does that device emit current fields? | Yes — `movingSec` present on every run since 2026-08-21, `paceSamples` and per-phase `verdict` throughout, `ceilingLift` / `recoveryExtensions` on the runs that earned them |
| Is there a watch build identifier anywhere? | **No.** `device_tokens.app_version` is the PHONE's push registration (28 rows, all `3.0.1`) and says nothing about the watch |

Strong but indirect: one active watch user on a build that emits current fields, not
a proven build number. Per the ruling, incomplete build information resolves to the
safer behaviour — and **here the safer behaviour is also free.**

`WatchTodayResponse` has been a two-branch union since long before the No-session
board: `{ workout, …glance }` or `{ message, …glance }`. The message branch is the
ORIGINAL shape every build ever shipped renders — it is what a rest day has always
returned. So a withheld session needs no new field, no version negotiation, no
capability probe. It takes the branch the whole fleet already understands, and
`dayState` rides along for the builds that can draw the board.

### `build-workout.ts` was author number four. It is a consumer now.

`loadNoSessionReason` ran its own `runner_injuries` and `sick_episodes` point reads —
"mirroring `lib/coach/glance-state.ts`", by its own comment. **Both are deleted.** It
takes a `SafetyResolution` and does nothing but translate it into the No-session
board's vocabulary. `resolveSafety(userId)` is called once, at the top, and
**deliberately not behind a `.catch`**: the owner already answers a failed read as
`known: false`, and swallowing that into a null would restore the exact Rule 11
collapse this removes.

The `.catch(() => null)` per read is gone with them. Its comment argued for itself —
"a Postgres blip must not cost the runner their workout" — and that argument is now
answered rather than ignored: an unresolved check withholds the session instead of
quietly prescribing one.

**Week off stays local, and that is deliberate.** A travel week is a SCHEDULING fact
about the calendar, not a claim about the runner's body, and the safety owner
correctly has no opinion on it. Its argued exemption in the swallowed-failure
registry is still valid and still there.

### The gate consumes the owner's predicates, it does not re-derive them

My first draft of `web-v2/lib/watch/safety-stop.ts` mapped `posture` onto ship/withhold
**by hand**. That was a second answer to a question the owner already exports as
`mayEmitRunnableWorkout`, and it was wrong to write even though it happened to agree.
I found it when the ownership gate's own row told me the interface name. Both
predicates are CALLED now. The file owns exactly one thing the owner does not and
should not: **which sentence the runner reads.**

Three withholding cases, three sentences (Rule 11 / Rule 16):

| why | when | sentence |
|---|---|---|
| `stopped` | `!mayEmitRunnableWorkout` and the check RAN | "Not today. Nothing to run while this is open." |
| `unchecked` | `!mayEmitRunnableWorkout` because it did NOT run | "We could not check in on you. Nothing to run until we can." |
| `quality_not_cleared` | running licensed, quality not, session IS quality | "Easy running only today. The hard session is not cleared." |

The third one is a decision I want visible rather than buried. `mayEmitQualityWorkout`
exists and says its purpose is to "prevent the app from confidently presenting a
quality session as cleared". The wire cannot down-scope an interval session into an
easy one — authoring an easy version is a PRESCRIPTION decision owned by the plan
engine, and inventing one here would be another second answer. So under EASY_ONLY an
easy session ships and a quality session is withheld with a sentence naming what IS
licensed. **If the plan engine should instead author an easy substitute, that is a
better answer and it is not mine to build.**

I read `posture` rather than `state` where I read anything at all, and used `known` to
pick between the two withholding sentences — `posture` is total on both branches, and
telling `stopped` from `unchecked` by posture would work today and silently pick the
wrong sentence the day a fifth posture is added.

### Two ratchets went stale because of this, and I lowered both

Both are the ratchet working, and both told me exactly what to do:

- `web-v2/lib/audit/swallowed-failure-registry.ts` — `EMPTIED_BASELINE` **362 → 359**,
  three ids deleted, with the drop written down where the file requires it.
- `web-v2/lib/safety/_safety_ownership.test.ts` — the two `OPEN` rows for
  `build-workout.ts` deleted. Their own text said they were "the row that should be
  DELETED when the watch delegates". **That leaves the ownership allowlist with zero
  OPEN entries**, which was the point of the safety agent leaving them in.

`web-v2/lib/watch/_safety_stop.test.ts` — 9 tests. Behavioural over the gate, plus
source assertions that `resolveSafety` is called and NOT behind a catch, that
`FROM runner_injuries` / `FROM sick_episodes` no longer appear in the file at all, and
that the withhold branch carries no `workout` (a type check cannot see a deleted
branch). Its Rule 22 header states it cannot check that the OWNER reaches the right
posture — it would stay green if `classifySafety` started returning PRESCRIBE for a
broken femur.

## 5 · THE REAL SWIFT GRADER — HOW CLOSE THE BOUNDARY ACTUALLY IS

**Direct answer: `xcodebuild test` runs the real watch code here, and the boundary is
about as close as it gets without an archive.**

`FaffWatch Watch AppTests` is a real XCTest bundle (`native-v2/project.yml`,
`type: bundle.unit-test`, `platform: watchOS`) HOSTED BY the watch app —
`TEST_HOST` / `BUNDLE_LOADER` point at `FaffWatch Watch App.app`. It runs on a
watchOS 26.5 simulator. Baseline on `origin/main`: **195 tests, 11 suites, passing.**

You asked me to be precise about the distance to the shipping binary, because it
changes what any of us can honestly claim. So:

| Same as the shipping binary | NOT the same |
|---|---|
| The same source file, through the symlink — one `WorkoutEngine.swift`, no port, no copy | Simulator (x86-64/arm64 host slice), not device arm64 |
| The same Swift compiler and language mode (`SWIFT_VERSION 5.9`, MainActor default isolation) | Debug configuration, so `-O` optimisation and its arithmetic are not exercised |
| The real types over the real wire structs — `WatchWorkout` decoded from JSON, `WatchCompletion` encoded to it | HealthKit and CoreLocation are stubbed by `WorkoutTracker.setFixture`; no real GPS smoothing, no HR sensor, no barometer |
| The real engine object under test via `@testable import` | No watchOS lifecycle: no wrist-down luminance reduction, no background suspension, no process death |
| `engine.completion` is literally the object the watch POSTs | Nothing renders — no SwiftUI board is instantiated |

So: **the RULES are executed for real, the DEVICE is not.** A defect in the grading
arithmetic, the phase bookkeeping, the snapshot round trip or the wire encoding is
catchable here. A defect that needs a real sensor, a real suspension, or a drawn view
is not — and the post-run finding you just described (`RunShapeV5.of` returning
`.steady`) is in the second category, on the phone, where the equivalent bundle
`FaffTests` exists but nothing renders either.

### What was missing, and now is not

**Measured before writing anything: the string `verdict` appeared in ZERO Swift test
files.** The rule that decides what every completed rep is called had no executable
coverage on the platform that executes it. `_watch_grader_parity.test.ts` is honest
about being a TypeScript port and says so in its own Rule 22 section: "It does not run
Swift."

`legacy/native/Faff/FaffWatch Watch AppTests/_WatchGraderTests.swift` — 12 tests
driving the real `WorkoutEngine` through `tick()` and reading `engine.completion`:

- `.window` inside / faster / slower → `hit` / `fast` / `slow`
- **The owner's 2026-09-01 4×1 mi at 422 / 429 / 422 / 419 against 430 ± 8** →
  `hit, hit, hit, fast`, plus an explicit assertion that no rep says `missed` or
  `drifted`. That session is what PACE-SHAPE-1 was written for, and the old rule
  returned drifted / drifted / drifted / missed on it.
- `.ceiling`: a 534 s/mi cool-down under a 502 ceiling is `hit`, not `slow`; genuinely
  faster than the slack is `fast`; inside the slack is still `hit`
- `.none` / `.effort` / no-target → nil, not a verdict (Rule 11)
- a rep ended early is `incomplete` whatever its pace was
- **the `legacyDefault` fallback** — the shape every already-deployed watch uses for a
  pre-PACE-SHAPE-1 payload — graded rather than assumed

The parity test stays. It answers a question mine does not: whether the server agrees.
Neither replaces the other, and both say so in their headers.

### One thing the rig taught me, recorded because it will bite again

My first run of these tests failed three ways, and every failure was the RIG lying,
not the grader. `runPhase(..., endEarly: true)` on a phase run for its full duration
advances TWICE — the engine advances by itself on the last tick — which cut the
following phase to zero and reported `incomplete` on reps that were run in full. The
helper now carries that warning in its doc comment.

## Falsifications (Rule 18)

**Every fix was broken on purpose and the tests were watched failing.** Six edits
applied at once to `WorkoutEngine.swift`, one run, then `git checkout --` to restore
and a confirming green run. Each defect produced failures in the tests that name it
and nowhere else.

Result: **223 tests, 16 suites, 25 issues across 6 test failures.**

| Broken on purpose | What failed, and what it said |
|---|---|
| **F1** `repPhaseIndices` reverted to `filter { .work }` | `aSixStrideSessionCountsSixRepsAndNotSeven`: `repCountForDisplay → 7` == 6. `theLastStrideIsSixOfSixAndNothingFollowsIt`: `repIndexForDisplay → 7`. `theEasyLegIsNotRepOneAndStrideOneIs`: the easy leg became `repIndexForDisplay → 1` instead of 0 |
| **F2** live path emits `results` instead of `phasesOut` | `theSessionKeepsRecordingAfterTheLastPrescribedPhase`: last phase `"recovery"` not `"overtime"`, and — the one that matters — `sumSec → 3090` against `totalDurationSec → 3382`, `abs(sumMi - total) → 0.58`. **The phases and the header stopped agreeing, by exactly the overtime.** |
| **F3 + F3b** recovery path stops reconstructing overtime, and the odometer tier removed | `theHistoricalTruncationDoesNotReproduce` returned **`totalDistanceMi → 5.98` and `totalDurationSec → 3057`.** Those are the two numbers on the stored row, to the digit. That is the mechanism identified, not inferred. |
| **F4** stride flag not carried back | `strideSegmentsComeBackFlaggedAndNothingElseDoes`: `flagged.count → 0` == 6 |
| **F5** `.ceiling` arm made two-sided | `aCooldownSlowerThanItsCeilingIsHitNotSlow`: `"slow"` == "hit" — the 534 s/mi cool-down under a 502 ceiling, graded a miss again. `anAbsentPaceShapeResolvesThroughTheLegacyDefault` failed with it, which is the useful part: the defect reaches every deployed watch through the legacy fallback, and the test that pins that fallback caught it |

**Restore verified:** `grep -c FALSIFY` returns 0, `repPhaseIndices` and `phasesOut`
are back, and the suite returns to green (see the run log).

### The two ratchets falsified themselves, on real events

I did not have to synthesise the stale-exemption direction — both fired for real during
this work, which is stronger evidence than a synthetic break:

- **`check-swallowed-failure`** FAILED with "These ids are on the EMPTIED ratchet but no
  longer exist in the tree. Somebody FIXED them" and named all three. I deleted the
  lines and lowered `EMPTIED_BASELINE` 362 → 359; it went green.
- **`check-coercion`** FAILED with "Peripheral collapses rose to 179 from 178", and it
  was RIGHT about something I had not noticed: with `loadNoSessionReason`'s internal
  guards gone, the outer `.catch(() => null)` at its call site had become the only
  handler — a blind swallow. I removed the catch rather than raise the baseline; back
  to 178. **I confirmed the attribution rather than guessing**: restoring the pre-edit
  `build-workout.ts` from `HEAD` and re-running the scanner gave 178, mine gave 179, so
  the one new site was unambiguously mine.
- **`check-generated-content`** was failing as a knock-on: its script runs a bundle that
  includes the coercion test. It cleared with the coercion fix.

### The stale-day fix was falsified on the device, and the falsification found a bug

Item 3 could not be reached with the network up, so I made the read fail on purpose:
pointed `API.baseURL` at `http://127.0.0.1:9`, rebuilt, launched against his real
cached payload, and tapped Tuesday the 1st.

**The note appeared — and it named the wrong days.** "Monday, August 31 did not load.
You are looking at Tuesday, September 1", on a screen showing Wednesday the 2nd. Both
dates one day early: `Self.iso` parses `"2026-09-01"` as UTC midnight and my display
formatter was on the device zone, which renders that instant as the evening of the
31st in PDT. On the one component whose entire job is to say which day you are looking
at.

Pinned the formatter to UTC, rebuilt, repeated: **"Tuesday, September 1 did not load.
You are looking at Wednesday, September 2."** — correct, with the fault-red rule and a
working Retry, over his real data.

`API.baseURL` is restored to `https://www.faff.run`; `git diff` on that file is empty.

**This is the item I would have shipped wrong.** Reading the code would not have found
it, and the first draft of this report said "build-verified, treat as unverified".

## Gates

`npx tsc --noEmit` clean. Affected vitest (`lib/watch`, `lib/safety`,
`lib/audit/_swallow_scan`, `lib/training/_watch_grader_parity`,
`lib/coach/_injury_read_rule11`) — 177 passed, 1 skipped.

Prebuild chain, run individually because five other worktrees were running theirs
concurrently and the shared-disk contention made the bundled run unusable
(load average 11): palette-sync, spacing-tokens, modelled-mark, coach-voice,
doctrine, wire-keys, surface-sweep, xcodeproj-sync, swallowed-failure,
derived-consistency, automatic-mutations, normal-window, goal-immutability,
anchor-derivation, client-graph, goal-pace-leak — all OK. wire-keys reports
**51 emitter keys, all present in web-v2**, which is the one that had to accept
`isStrideSegment`. `check-coercion` and `check-generated-content` failed, were
FIXED not exempted (see the falsification section), and re-run.

Swift: `xcodebuild build` green for both the watch and the phone scheme;
`xcodebuild test` green at 223/16.

## Environment findings worth passing on

- **`V5ContrastTests.testDarkRampSmallTypeGapHasNotWidened` FAILS on `origin/main` at
  `16664371`**, before any change of mine: 3.0554 against a 3.06 floor, "rest
  week-strip letter has REGRESSED". Pre-existing, in the PHONE test bundle
  (`FaffTests`), not mine to fix — but note that the `FaffWatch Watch App` scheme's
  test action runs BOTH bundles, so anyone running it sees a red result that has
  nothing to do with the watch. `-only-testing:"FaffWatch Watch AppTests"` isolates it.
- **The watch test bundle drives `AVSpeechSynthesizer` for real.** `SpokenCues.enabled`
  defaults to true, nothing in the suite mutes it, and `advance()` says "Session
  complete." at plan-done. Baseline logs already carry `VoiceDBClient` chatter, so this
  predates me — but given the note in my brief that a spoken simulator disturbed the
  runner once already, **someone should set `spokenCues = false` for the test bundle.**
  I did not, because it touches a shared harness (`SimRun` in `_SessionTimelineTests`)
  and I could not verify whether audio actually reaches the output device.
- **`xcodebuild test` against watch sim `DC794E30-…` (Series 11 46mm) crashes at
  launch** — "Test crashed with signal kill before establishing connection" — and
  stayed broken across runs, once after the bundle had already started every test.
  The identical command against `6018E01F-…` (Ultra 3) is reliable. Simulator state,
  not code; it cost me two runs and a false "my tests hang" hypothesis.
- **The gate chain is unusable as a bundle while other worktrees run theirs.** Five
  `check-*` chains were live at once (one of them running a `check-goal-volume-leak.sh`
  my tree does not have), load average 11, and `check-generated-content` alone took
  185 s. Running the scripts individually is what got me an answer.
- `PHASE_TYPES` in `web-v2/lib/runs/run-shape.ts` (**not my file**) is
  `['warmup','work','recovery','cooldown']`. An `overtime` phase degrades to
  `type: null` there and to `'unknown'` in `verdict.ts`, keeping its duration and
  distance — safe, and the correct reading for a segment nothing prescribed. But it
  would read better as a named type. **Recommend adding `'overtime'` to that list**;
  out of my boundary, so I did not.
- **THE PRE-PUSH HOOK CANNOT BE RUN BY TWO AGENTS AT ONCE, AND SILENTLY LOSES.**
  Mine and `closure/plan-decisions` fired simultaneously and both ran
  `xcodebuild test -destination id=36936A72-… -derivedDataPath /tmp/faff-wtest` —
  the SAME simulator and the SAME shared derived-data path, hard-coded. Two test hosts
  on one simulator under one bundle id: the host dies, and the hook prints "test host
  died rather than a test failing · retrying once" while naming that exact cause. The
  retry then races the other agent again. Both pushes stall for many minutes and the
  failure looks like flakiness rather than contention.
  **It blocked my first push**, and its verdict was self-diagnosing: "40 test cases
  ran, but 223 @Test declarations exist … the test process died inside
  SessionTimelineTests.driftFiresOnSustainedDrift()" — someone else's tests, not mine,
  and no expectation ever failed. Worth noting that its count of **223 @Test
  declarations matches my own green run exactly**, so it agrees every new file is in
  the target; only the host died.
  **Two fixes, either would do: give the destination and `-derivedDataPath` a
  per-branch or per-PID suffix, or take a lock file around the watch-test step.** As
  written, the more parallel agents there are, the less this gate can be trusted — and
  it is the gate standing between a broken watch and `main`. Right now it produces a
  RED result for correct code, which is the failure mode most likely to get a gate
  disabled.
- **The pre-push hook's pbxproj warning is a false positive here, and I did not act on
  it.** It runs `xcodegen`, then reports that `native-v2/Faff.xcodeproj/project.pbxproj`
  "differs from the version in git … Stage it". The entire diff is the random `TEMP_…`
  UUID xcodegen assigns to `Secrets.xcconfig` — which is GITIGNORED, so it gets a fresh
  id on every run. Zero non-`TEMP_` lines differ; the source-file references are
  identical. Staging it would commit noise that re-fires for the next person. The hook
  even says "(this run is what changed it)". Worth teaching it to ignore the xcconfig
  reference, or the warning trains people to ignore it — which is when it stops
  catching the real drift it exists for.
- `web-v2/lib/training/lthr.ts` — I DID change this, and it was necessary.
  `lthrFromFieldTestPhases` picks the longest non-rest phase, and its rest predicate is
  a label regex that `overtime` / "After the session" does not match. A field test
  followed by a twenty-minute jog home would have set `profile.lthr` **from the jog**,
  and every HR ceiling in the block derives from that number. Excluded by type.

## Open, and not mine to close

1. **The four-presses-in-two-seconds `recoveryExtensions`** on the real row
   (§1e). `recordRecoveryExtension` has no debounce.
2. **EASY_ONLY withholds a quality session** rather than down-scoping it, because the
   wire cannot author an easy substitute. If the plan engine should, that is a better
   answer than mine.
3. **`'overtime'` in `run-shape.ts`'s `PHASE_TYPES`.**
4. **Muting spoken cues in the watch test bundle.**
5. **`V5ContrastTests` red on main.**
