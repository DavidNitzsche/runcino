# Pre-run experience — handback

3 September 2026 · pre-run experience lead · branch `feat/pre-run-experience`, not on `main`

Scope was the screen between selecting a planned workout and starting the recording: workout
detail, coaching language, segment preview, the Run sheet/lobby, device readiness, and the
handoff into the live console. Not plan generation, pace/HR calculation, race projection, or the
top bar and week strip — those stay with whoever owns them, and this doc flags every place this
work touches their files.

## 1 · What was already there

Audited before writing anything. The workout-detail screen (`TodayBeforeV5`), coaching copy, and
stale/offline states were already solid — a separate branch fixed exactly that area very recently
(navigation and stale-state fixes, 46 findings, verified with screenshots). The legacy v4 pre-run
stack (`RunActionMenu`, `TodayPreRunBodyV3`, `RootTabView`'s watch-vs-phone routing) is dead code
under the shipping build; confirmed by reading `FaffApp.swift`'s own root-view switch, not assumed.

The actual gap was the Run lobby. `RunPickerV5` was two buttons and one sentence. A runner tapping
RUN had no way to see, before committing, what workout was about to start, whether the watch had
it, or whether location was granted — all of that was discoverable only after landing in the live
console.

## 2 · Shipped

### [Built] `RunLobbyV5` — the lobby actually shows what's about to start

Replaces `RunPickerV5` at its one real call site (`ShellV5.swift`'s RUN-pill sheet). `RunPickerV5`
itself is untouched — `GalleryV5` still references it as a component sample.

The lobby fetches today's real workout on open and renders:

- Name, distance, and a **grouped, scannable segment preview** — "10 × 1 min hills," not ten
  identical rows.
- An HR ceiling where one applies.
- On a race day: goal time, pacing strategy, race-HR guidance with the checkpoint abort criterion
  stated in plain language, and fueling — all read from `WatchWorkout` fields the coaching layer
  already computes (`isRace`, `goalSec`, `strategyLabel`, `raceHr`, `fueling`). No new coaching
  logic, no second source of truth.
- Device readiness, stated plainly rather than discovered mid-run: watch paired / installed /
  reachable, location authorization (read-only check — it never prompts early), and the existing
  background-recording sentence, relocated rather than restated.
- Never blocks a run for optional data. A failed workout fetch, no workout today, or no watch all
  leave Outdoor/Treadmill tappable.

### [Built] `PendingRunPlanV5` — closes a real mismatch class

The RUN pill is global and disconnected from whatever day Today is showing, and the live console
(`LiveRunHostV5`) fetched its own copy of "today's workout" independently of whatever the lobby
had just shown. Two reads of "now," normally identical, but nothing guaranteed it — a plan
rebuild or a midnight rollover landing between the two calls could hand back two different
answers a few seconds apart.

The lobby's fetch is now handed forward and consumed exactly once by the console. What was shown
and what starts are the same read.

### [Fixed] A verification-harness gap that was blocking Rule 13 itself

`HRAlerter.start()` requested notification permission unconditionally. `FaffApp.swift` already
carries `-faffToken`'s doc comment explaining exactly why that has to be skipped for a QA
launch — an automated driver cannot tap a SpringBoard permission alert, so requesting one wedges
every verification run behind a dialog nothing can dismiss. One call site was guarded when that
mechanism was built; this one was missed. Found because it was wedging *my own* render-verification
of this feature, not by inspection.

`FaffApp.isQATokenLaunch` is now internal instead of `private` so `HRAlerter` can read it — no
other visibility change.

## 3 · Two real defects, found only by rendering against your real data

Rule 13, and it earned its keep twice in one session. Neither of these would have been caught by
a fixture — both fixture-only versions of my own tests passed while the real render was broken.

**Defect 1 — grouping compared the wrong thing.** Your actual hill-repeat label is
`"Hill 1 of 10 · 1 min"` — the rep index is in the *middle* of the string, followed by a
duration clause, not at the end. My first grouping pass compared raw labels; ten hill reps
rendered as ten separate rows. Fixed by normalizing the label (strip the index wherever it falls,
truncate at the separator) before comparing.

**Defect 2 — the last rep has nothing after it.** Recovery happens *between* reps, so a
work+recovery pattern's final rep is bare. My pair-matching loop required a full trailing pair to
keep counting, so it stopped one short: **"9 × 1 min Hill" plus a stray, ungrouped tenth row** —
a real count silently wrong by one, on screen. Fixed to absorb a trailing bare work rep that
matches the pattern.

```
before   Hill 1 of 10 · 1 min      1 min · HR ~176
         Hill 2 of 10 · 1 min      1 min · HR ~176
         …                         (ten identical rows)
         Hill 10 of 10 · 1 min     1 min · HR ~176

after    9 × 1 min Hill            HR ~176 · 2 min recovery
         Hill 10 of 10 · 1 min     1 min · HR ~176        ← still wrong, one short

fixed    10 × 1 min Hill           HR ~176 · 2 min recovery
```

Both are locked in with regression tests using the exact real label and phase shape, not a
simplification — `test_realHillWorkoutWithPerRepIndexedLabelsStillGroups` and
`test_trailingRepWithNoClosingRecoveryStillCountsTowardTheGroup`.

## 4 · Verification

- **Unit tests:** 27 new cases (`RunLobbyV5Tests.swift`) covering watch/location readiness,
  segment grouping (including both defects above), the race brief, and
  `PendingRunPlanV5` consume/expiry semantics. Full `FaffTests` suite green, run three times to
  confirm no flakiness after fixing one flaky assertion of my own — `consume(maxAge: 0)` could
  race real clock resolution (two `Date()` calls microseconds apart reporting zero elapsed time);
  `maxAge: -1` forces staleness deterministically instead.
- **Device render:** built and ran on iPhone 17 Pro Max against a read-only local copy of your
  real account's data (`scripts/walk-substrate.sh` — all three production reads it issued were
  classified and none were mutating; zero writes). Rendered before and after each fix via
  `-faffToken`/`-faffHost`. Final state, against your actual Tuesday hill workout: "10 × 1 min
  Hill · HR ~176 · 2 min recovery," "No Apple Watch paired. Recording and heart rate are on your
  phone," "Outdoor mode will ask for location access when you start."
- **No screen recording** — screenshots only. I don't have a video-capture path in this
  environment.
- **Build:** `xcodebuild build` and `test` green against the final project file.

## 5 · A small piece of project hygiene, found in passing

My first commit hand-edited `project.pbxproj` via the `xcodeproj` gem to register the two new
files. The pre-push hook caught that this repo's `xcodegen`/`project.yml` produces a different
(and, per the hook's own note, canonical) file — mine would have left the next person's checkout
compiling a different source set than what I tested. Regenerated and re-verified; second commit.
Worth knowing if any other session is hand-editing the `.pbxproj` rather than running the
project's own generator.

## 6 · Integration risk — disclosed before you or anyone reconciles this

- `ShellV5.swift` — one three-line call-site swap (`RunPickerV5` → `RunLobbyV5`) inside
  `RootV5.shell`. This is a file the top-bar/week-strip session may also be touching; the diff is
  small and isolated to the RUN-pill sheet content, not the tab bar or navigation state around it.
- `HostsV5.swift` — `LiveRunHostV5.task` now checks `PendingRunPlanV5` before its own fetch.
  Additive: falls through to the old fetch if nothing was handed forward, so any other change to
  this file's fetch logic composes rather than conflicts.
- `WatchSync.swift` — added `isReachable` (published) and a `force:` parameter on `refresh()`.
  Additive; no existing call site's behavior changes.
- `FaffApp.swift` — `isQATokenLaunch` visibility widened from `private` to internal. No behavior
  change.
- `main` has moved since I branched (`9787680d`) — this needs a real merge by whoever reconciles
  it, not a rebase I'd do blind against work I haven't read.

## 7 · What I am holding for you

Two of these are genuinely yours to call, not mine to guess at.

1. **Watch-mirror recording.** The audit that started this work found that V5 always records via
   `PhoneRunTracker` regardless of whether a Faff watch is paired — unlike the legacy app, which
   mirrors the run onto the watch when one's available. Given the locked 2026-08-31 pivot
   ("iPhone is the focus, Apple Watch is its execution-layer partner"), I read this as an
   intentional simplification and left it alone rather than reopening a recording-architecture
   decision on my own judgment. If that reading is wrong, it's a real gap, not a small one.
2. **Race-day content on Today itself, not just the lobby.** `V5Today` — what the Today screen
   renders — carries no race fields at all; goal time, strategy, and fueling only exist on
   `WatchWorkout`. I surfaced them in the lobby (no backend touch needed, since the lobby already
   fetches `WatchWorkout`), but I did not extend `lib/faff/v5-today.ts` to carry them onto Today
   itself. That's a backend-contract change outside this branch's remit.

One documentation staleness, low stakes: `docs/faff-iphone-design-contract.md` states recording
is "foreground-only," while shipped code has branched on real background-recording capability for
a while. Not something I touched; worth a line whenever someone's next in that file.

## 8 · Exact remaining work

- Reconcile `ShellV5.swift` / `HostsV5.swift` against whatever the top-bar/week-strip session has
  landed on `main` since this branch forked.
- Decide item 1 in section 7 (watch-mirror recording) — confirm or correct my read before anyone
  builds on top of the current phone-only assumption.
- If race-day content on Today is wanted (not just in the lobby), that's a `v5-today.ts` change
  for whoever owns that composer.
- Nothing in this branch is on TestFlight. It's unmerged, and per your deployment doctrine I'm
  handing it back rather than merging it myself.
