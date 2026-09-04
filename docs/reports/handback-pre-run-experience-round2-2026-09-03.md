# Pre-run experience — round 2 handback

**Addendum, same day:** after this round was written up, David flagged the "BEFORE YOU
START" device-readiness block (§3 below) directly — a screenshot of it, with "wtf is all
this?" — and then the actual correction: **"None of this is needed. The runs start from the
watch."** Commit `e4e8be08` removes it: `RunLobbyRecordingLine`, `RunLobbyHrLine`,
`RunLobbyLocationReadiness` (and their tests), the `readinessSection`/`readinessRow` view code,
and the `locationReadiness` state that fed it — 231 lines net removed. `recordingOwner` and
`outdoorSubtitle` stay, because Decision 1's actual watch-vs-phone routing lives in
`HostsV5.swift` and never read this section in the first place; only the visible checklist and
its Retry button are gone. The lobby now goes straight from workout guidance to
Outdoor/Treadmill/Cancel. Rendered against the real hills workout after the change (artifact 08)
before committing. Test count dropped from 195 to 185 (the 10 deleted tests belonged to the
deleted types) — full suite still green. **§3 and artifact 01 below describe the state that has
since been removed; read them as history, not current behavior.**

3 September 2026 · pre-run experience lead · branch `feat/pre-run-experience`, **not on `main`**

Round 1 (the lobby, grouped segments, `PendingRunPlanV5`) was reviewed and merged/deployed
separately while this round was in progress (`d4d423bd` on `main`, confirmed by
`docs/MASTER_CORE_PRODUCT_PROGRAM.md`'s `2b461db7`). That merge correctly held back the two
items round 1 flagged as not its call — watch-mirror recording architecture, and race content on
Today — which became Decisions 1 and 2 below. **This doc is the second round, on top of what's
already live**, per the explicit instruction not to treat the assignment as complete or hand it
back yet.

This branch has since been **merged with the current `origin/main`** (which had moved three
commits since round 1: two real gate fixes — the hand-drawn HR tilde, five em dashes — and one
spacing-token fix, all inside `RunLobbyV5.swift`). The merge was clean, no conflicts, and the
full test suite passed before and after. **The branch is pushed to origin; it has not been
merged into `main`.**

## 1 · Decision 1 — Apple Watch execution, one recording owner per session

Commit `8c5c7f51`.

- `RunLobbyRecordingOwner` resolves once, from live `WatchSync` state (paired, installed,
  reachable, and — the actual bar for "has the workout" — a `lastSync` string starting with
  `"Synced"`): `.watch` or `.phone`. Nothing downstream re-derives it.
- **`.watch`**: `LiveRunHostV5` routes `.outdoor` mode to a new `LiveRunWatchCompanionV5` instead
  of starting `PhoneRunTracker`. The phone shows standing-by status (reachability dot, workout
  name/distance, an explicit "closing this screen doesn't stop the watch's recording" sentence)
  and never calls `tracker.start(...)`. This is the actual duplicate-recording guard: the phone
  code path that creates an activity is structurally unreached when the watch owns the session.
- **`.phone`** (no watch, or watch present but unreachable/not synced): unchanged phone recording,
  now carrying the real workout identity through — `PhoneRunTracker.start(canonicalWorkoutId:)`
  and `LiveRunPlanV5.workoutId` (new field, populated from `WatchWorkout.workoutId`) so a
  phone-recorded run reconciles to the same prescription a watch-recorded one would have.
- Traced the legacy `WatchMirrorView` before writing `LiveRunWatchCompanionV5` rather than
  reviving it wholesale — kept the standby-status shape, fixed the one real gap in it (reachability
  drop wasn't live; now bound to `WatchSync.isReachable`).

**What this does not close** (disclosed, not discovered later): there is no live cross-device
session-state check stopping a runner from starting the watch workout directly from the wrist
*and separately* starting a phone recording — the guard closes the routing path through this
lobby, not every path to `HKWorkoutSession` on either device. If that matters, it's a `WatchSync`/
`WCSession`-level guard, outside `RunLobbyV5`'s reach.

## 2 · Decision 2 — race content on Today, through the canonical owner

Commit `c1deac94`. New file `web-v2/lib/faff/race-on-today.ts` — `buildRaceOnToday()` — is the
one new backend surface this round required, and it does not invent anything: it calls
`loadEffectiveRaceTarget()` (the same resolver the lobby's race brief already reads),
`raceHrLine()`, and `resolveRaceFuel()`/`computeRaceFueling()`. Wired into `v5-today.ts`'s
race-day branch and `app/api/v5/today/route.ts`. `V5Today.race` is optional — an older client or
a non-race day decodes exactly as before.

Fields: `slug, name, distanceMi, role (race|controlled_c_effort), priority,
executionTargetSec, goalSec, strategyLabel, hrLine, checkpointMi, checkpointAbortBpm,
fuelingSummary`. `TodayBeforeV5` renders it as a distinct block right after the day panel: role,
name/distance, **two separate clocks** for today's execution target and the stated goal (never
merged into one number — Rule 16), strategy, HR line, fueling, and a button to the full race
detail (`onOpenRace(slug)`, threaded through `TodayBeforeLiveV5` → `HostsV5`).

**Verified against real, unmutated data, at the JSON layer**: queried `?date=2026-09-13` (Santa
Monica 10k, B-priority, no stated goal) and `?date=2026-09-26` (Dodgers, C-priority, goal
45:00) against this branch's own server. Both compose correctly — Dodgers is the sharper proof,
since goal (2700s) and execution target (2825s) come back as genuinely distinct numbers, not one
value doing double duty. **Not verified by on-device render** — see §6.

## 3 · HR language and capability claims

Commit `63831167`, refined into two enums replacing the old single `RunLobbyWatchReadiness.line`:

- `RunLobbyRecordingLine` — `.watchWillRecord(lastSync:)` / `.phoneWillRecord(watchReason:)`.
  Text is now genuinely conditioned on live state: *"Your watch is paired but not reachable right
  now"* (not "no watch paired" collapsing "paired-but-unreachable" and "never paired" into the
  same sentence), *"Your phone will record this run"*, with a Retry action wired to
  `WatchSync.refresh(force: true)` when the watch path is live but currently down.
- `RunLobbyHrLine` — `.connectedFromWatch` / `.unavailable`, resolved from the *same* recording
  owner, not from device choice: *"No heart-rate source is available. Your phone can record GPS
  and pace; heart rate will be unavailable."* only renders when the phone genuinely has no HR
  source, never inferred from "no watch."

Rendered live against real data (artifact 01, §7): both lines fire correctly together for a
watch-paired-but-unreachable, no-other-HR-source state.

## 4 · Short-rep HR is not a target — corrected at the doctrine owner

Commit `63831167`, backend half in `lib/training/zones.ts` (`hrRoleForRepDuration`), wired into
`lib/watch/build-workout.ts`'s one phase-emission choke point, gated by a new doctrine claim
(`HR.rep-target-role-below-kinetics-floor`, citing `Research/03` §13/14, falsified both
directions). Reuses `HR_REP_KINETICS_FLOOR_SEC` — the *same* floor the read-side signal code
already uses (`lib/coach/reading-scope.ts`) — rather than inventing a second threshold.

The bpm value is unchanged; only its semantic role changes below the floor. `RunLobbySegments`
renders `"reads 176"` for `.observational` vs `"HR 176"` for `.target` (word choice carries the
distinction — the tilde that used to sit here was removed on `main` separately, correctly, since
this bpm is a measured anchor, not a modelled one). The lobby's guidance block adds one line only
when at least one segment is observational: *"Effort and controlled form govern this. The reps
are too short for heart rate to guide pace live. Don't chase it."*

Rendered live against your actual 10×60s hills workout (artifact 01) — this is the literal
scenario from the brief.

## 5 · Title, hierarchy, and the failed-workout state

- **Title**: `RunLobbyTitle.split(_:)` divides at `" @ "` into headline + descriptor, rendered as
  two separate text elements instead of one truncating line. Verified at default size and the
  Dynamic Type accessibility ceiling (artifacts 02–04) — wraps clean, no ellipsis, and
  Outdoor/Treadmill/Cancel stay reachable by scroll rather than being pushed off-screen.
- **Hierarchy**: `workoutCard` now renders, in order: title (split), purpose (fetched from the
  same `V5Today.why`/`thesis.coachLine` precedence `TodayBeforeV5` already uses — no new
  coaching text), grouped structure, execution guidance (HR ceiling sentence + the
  observational-HR caution above). `readinessSection` follows: recording line, HR line, location.
  Then the actual blocking state if any, then Outdoor/Treadmill, then Cancel. Matches the
  requested 8-step order without duplicating workout detail.
- **Failed-workout loading**: `RunLobbyWorkoutState.hasNoCanonicalWorkout` gates the start
  section — on failure it shows "Couldn't load today's planned workout. Starting now will record
  an unstructured run," a Retry (only when the state is `.failed`, not merely absent), and
  relabels the tiles `Start unstructured · Outdoor` / `Start unstructured · Treadmill` in place of
  the normal ones. Verified live by pointing the app at an unreachable host (artifact 06) — the
  normal start action is genuinely gone, not just captioned differently.

## 6 · Pending workout handoff — hardened

`PendingRunPlanV5` (round 1) plus this round's additions:

- **Date guard**: `consume(expectedDateISO:)` clears and refuses a snapshot recorded for a
  different date — closes the midnight-rollover case (lobby opened late one day, consumed after
  rollover) without relying on the caller to separately check dates.
- **Plan-freshness re-check on start**: `start(_:)` is now `async`; it re-fetches immediately
  before recording and compares via `RunLobbyPlanCheck.prescriptionChanged` (workoutId, name,
  phases, distance, race/goal fields — deliberately excluding envelope metadata like
  `readinessScore`/`expiresAt`, so a readiness-score refresh alone doesn't false-positive). A real
  change shows "Your plan updated" and updates the shown workout instead of silently starting the
  stale one — the exact behavior asked for.
- **Double-tap**: `isStarting` guards re-entry into `start(_:)`.
- **Watch sync**: unchanged contract — `WatchWorkout` is the one shape both lobby and watch
  consume; Decision 1 adds the recording-owner resolution on top, not a second contract.
- **Background/foreground**: not separately hardened this round — `PendingRunPlanV5` has no
  timer or observer of app lifecycle; its only staleness gate is `maxAge` (600s) plus the date
  guard above, which are lifecycle-agnostic by construction (a backgrounded app doesn't advance
  wall-clock time any differently than a foregrounded one). Flagging as reasoned-through, not
  separately tested with an explicit background/foreground harness.

40+ new/updated `RunLobbyV5Tests.swift` cases cover: HR role resolution, recording owner/line
resolution (including the exact "watch paired but unreachable" combination), title split,
`RunLobbyPlanCheck` (including the readiness-score-is-not-a-change guard), and
`PendingRunPlanV5`'s date guard (four new cases: cross-date snapshot never reaches start, matching
date consumes normally, no expected date skips the check, a mismatch clears rather than sticks).

## 7 · Rendering and interaction proof

**Correction from round 1**: round 1's screenshots were described but the report directory did
not contain the files. This round's are committed at
`docs/reports/pre-run-verification-2026-09-03/` — actual PNGs, not a description of them.

Also found and fixed mid-session: the walk server my first pass queried on `localhost:3111` was
not this branch's server — it was another concurrent worktree's (`racepace-2026-09-01`) process
already bound to that port and database, so every early "race" query came back `null` for reasons
that had nothing to do with the backend code (it was running someone else's checkout). Rebuilt
the substrate under an isolated database and port (`faff_visual_walk_prerun`, `:3113`) scoped to
this worktree, confirmed a 200 auth check against it specifically, and only then re-ran the
verification queries. Worth flagging in case other concurrent sessions hit the same default-port
collision.

| # | Artifact | What it shows |
|---|---|---|
| 01 | `01-lobby-hills-watch-unreachable-no-hr.png` | The brief's literal scenario: 10×60s hills, `reads 176`, coherent short-hill guidance, "watch paired but not reachable," "no heart-rate source available" |
| 02 | `02-today-dynamic-type-ceiling.png` | Today at the accessibility Dynamic Type ceiling |
| 03 | `03-lobby-dynamic-type-ceiling-top.png` | Lobby at the same ceiling — title wraps clean, no ellipsis |
| 04 | `04-lobby-dynamic-type-ceiling-controls-reachable.png` | Scrolled to bottom — Outdoor/Treadmill/Cancel still reachable |
| 05 | `05-today-default-intervals.png` | Today at default size, for comparison |
| 06 | `06-lobby-workout-fetch-failure-unstructured-fallback.png` | Fetch failure — normal start action replaced by Retry/unstructured tiles |
| 07 | `07-live-console-unstructured-treadmill-pre-start.png` | The unstructured path walked through to the live console, never past Start |

**Interaction sequence actually walked**: Today → tap RUN → review workout (hills, HR-role
correct) → verify device (watch unreachable, no HR) → tapped "Start unstructured · Outdoor" (in
the induced-failure state) → confirmed the transition into `LiveRunTreadmillV5`'s live console →
backed out by terminating the app **without ever tapping Start** — no activity was created,
against the isolated local substrate only.

**Named states not captured, disclosed rather than skipped silently:**

- **Race day, on-device.** The JSON composition is verified (§2) against real race dates, but
  today's device date is 2026-09-03, not a race day, and the visible week strip/Upcoming view
  doesn't reach 2026-09-13 or -26. Rendering it would need either the shared simulator's system
  clock changed (risk to whatever concurrent sessions are using it — CLAUDE.md notes this repo
  runs 50+ parallel agent worktrees) or a fresh isolated simulator, which needs a one-time access
  grant I didn't get a response to this session. Reported honestly rather than substituted with a
  fixture.
- **Watch reachable / HR available / easy / long / threshold** — not captured this round. Getting
  a genuinely reachable Watch Connectivity session between two simulators, or a live HealthKit HR
  source, needs setup beyond a screenshot loop; the easy/long/threshold days exist in the visible
  week but I ran out of safe, low-risk navigation attempts within this session's time budget
  (several coordinate-mapping misses cost real time — see note below).
- **Small supported phone** — not captured. Would need a different device destination; deprioritized
  behind the states above given time.
- **Screen recording** — still not produced. No video-capture path found in this environment
  beyond individual screenshots; same limitation round 1 flagged.

One operational note for whoever verifies next: the simulator control tool's screenshot images
are returned at a different pixel scale than the tap coordinate space (`440×956` points for this
device) — several early taps in this session landed on the wrong element until the ratio was
worked out from a known-good tap. Divide the visually-estimated position by roughly 2.1 to get
point coordinates, or better, compute from the device's stated point dimensions directly rather
than eyeballing the screenshot.

## 8 · Build, tests, integration

- **Swift**: `xcodebuild test` — 195/195 passing, both before and after merging `origin/main`.
  Network fence confirms zero requests reached `faff.run` from the test bundle.
- **TypeScript**: `npx tsc --noEmit` clean.
- **Backend unit tests**: `race-on-today.test.ts` (8 cases), doctrine gate (full registry,
  including the new HR claim), `zones.test.ts` — 715 passing across the three files.
- **Merge**: `origin/main` (3 commits ahead — the em-dash/tilde/spacing fixes from round 1's own
  review) merged into this branch cleanly, no conflicts. Rebuilt and retested after — still
  195/195.
- **Pushed** to `origin/feat/pre-run-experience` (`fd3be065`). **Not merged into `main`.**
- **project.pbxproj**: regenerated via the repo's own pre-push `xcodegen` hook each time a new
  Swift file was added by hand; the only outstanding uncommitted diff is the known cosmetic
  `Secrets.xcconfig` GUID-placeholder churn (a gitignored local secrets file's temp UUID), left
  unstaged as noise rather than committed.
- **TestFlight**: not shipped. Unmerged, per deployment doctrine.

## 9 · What's still genuinely open

1. Cross-device duplicate-recording guard is closed for the lobby-routing path only (§1) — a
   direct-from-wrist watch start alongside a separate phone start is not guarded by anything this
   branch touches.
2. Race-day Today content is verified at the JSON layer, not by on-device render (§2, §7).
3. Five of the fifteen named states were not captured this round (§7) — watch-reachable, HR-available,
   easy/long/threshold days, small phone, plus no screen recording.
4. `PendingRunPlanV5` background/foreground behavior is reasoned through, not separately tested
   with a lifecycle harness (§6).

## The completion test, honestly answered

*Can the runner see exactly what will start, understand how to run it, know which device will
record it, and trust that the same canonical workout will actually execute?*

For the state that was actually rendered against real data this round — a structured quality
workout, watch paired but unreachable, no phone HR source — **yes**, and it's provable: artifact
01 shows the exact workout, the exact guidance, and the exact device/HR state in one screen,
sourced from the one canonical fetch that also starts the run. For race day specifically, the
same claim rests on a verified JSON contract but an unverified render — that's a real gap, not a
rounding error, and it's the honest reason this still isn't a clean yes across every state named
in the brief.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
