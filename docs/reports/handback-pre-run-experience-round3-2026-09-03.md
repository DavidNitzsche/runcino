# Pre-run experience — round 3 handback

3 September 2026 · pre-run experience lead · branch `feat/pre-run-experience`, **not on `main`**

Round 3, prompted by David rendering round 2 himself and finding it still mixed Today with
the dedicated Run experience: *"The current implementation still mixes Today with the dedicated
Run experience. The app already has four bottom-navigation destinations: Today, Block, Races,
Run. Preserve that architecture."* This round makes Run a real fourth tab, reworks its content
to confirmation-only, drops the per-rep HR number entirely (not just relabels it), reprioritizes
Today's race content, and closes a reported distance discrepancy (with an honest finding: it
wasn't a live bug). Commits `fdd5628e`, `681bcd33`, `2398f80f`, `0c6902fe`, merged with current
`origin/main` at `282745cc`.

**Mid-session, live production incident (unrelated to this branch):** David hit a stuck "Start
the Run" screen on his actual phone trying to start a real treadmill run — tapped Treadmill,
nothing happened. Diagnosed live: production's backend was healthy and fast (confirmed by
curling it directly, ~0.1–0.2s responses), so the hang was device/network-side, not a `main`
regression and structurally unable to be caused by this branch's unshipped, unmerged work. Talked
him through it; the run eventually started. Flagging here because it happened mid-turn and cost
real time, not because it changed anything about this branch's scope.

## 1 · Run is a real tab, not a sheet Today opens

Commit `681bcd33`. `FaffTabV5` gains `.run`, a true peer of `.today`/`.block`/`.races` — its own
`NavigationStack`, its own path, mounted and opacity-gated exactly like the other three (alive
from launch, the launch gate still only waits on the original three since `isSuperset(of:)`
doesn't require an exact match). The RUN pill's tap now does `selected = .run` through the same
binding the plain tabs use — re-tapping it while already on Run pops that tab to root, identical
to re-tapping Today. `V5SheetHost`/`RunLobbyV5`-as-sheet and the `runPickerOpen` state are gone.

`LiveRunMode` gains an explicit `.watch` case. `LiveRunHostV5`'s `recordingOwner` auto-resolution
is deleted — the runner's tap on the Run tab (Apple Watch / Outdoor / Treadmill) **is** the
recording-owner decision now, frozen at the moment of the tap, never re-inferred from live
reachability when the console appears. `.outdoor` unconditionally starts the phone tracker; it
can no longer silently redirect to the watch.

**Merge note:** reconciling against current `origin/main` hit one real conflict here —
`StatusBarScrimV5()` had been deliberately removed from this exact call site on `main` (David,
twice: *"the status bar skrim and fade is WRONG and should not be there"*). Took main's removal,
not my stale call to a since-deleted struct.

## 2 · Run's content — confirmation only, explicit choice, no per-rep HR number

Commit `2398f80f`.

- **Dropped**: the "why this workout" purpose fetch/text, the race brief's HR ladder and fueling
  prose, the session HR-ceiling line. Today owns all of that now — Run doesn't re-teach it.
- **Kept, tightened**: title, one "distance · duration" line (e.g. "6.0 mi · approximately 50
  min" — the two facts the earlier version showed as a corner label and nothing, now together),
  grouped structure, and **one** execution cue (the coach's own `cue` field, plus the short-rep
  caution only when it applies).
- **Three explicit tiles, not automatic resolution**: Apple Watch, Outdoor on iPhone, Treadmill.
  The Apple Watch tile is a live choice only when the watch can be confirmed to hold today's
  workout (the same "reachable AND a confirmed 'Synced…' status" bar this feature has used since
  Decision 1); otherwise it renders as a compact blocked row — *"Not reachable right now."* — with
  Retry, and is **not tappable**. This is the literal fix for *"do not silently choose the phone
  merely because the Watch is temporarily unreachable."*
- **Short-rep HR (HR-ROLE-1, corrected again)**: an observational bpm is now **dropped from the
  row entirely**, not relabelled "reads N". *"Showing a precise HR value and then telling the
  runner not to use it creates false importance"* — round 2's "reads 176" wording fix didn't go
  far enough; the number itself had to go. `RunLobbySegmentGroup.hrIsObservational` still records
  the classification internally (still tested) per *"preserve the canonical semantic distinction
  internally, but do not surface non-actionable precision."*
- **Cancel is gone** — nothing to cancel back out of on a tab.

Verified live (artifact 01, §6) against the real hills workout: `10×60s hills`, `6.0 mi ·
approximately 50 min`, `10 × 1 min Hill` with **no HR number at all** next to it, `Run by effort
and form. Heart rate will lag these short reps.`, then Apple Watch (blocked, Retry) / Outdoor on
iPhone / Treadmill.

## 3 · Today — race content reprioritized, not flattened

Commit `0c6902fe`. Same fields, regrouped: name + today's execution target + strategy render
together at full weight; goal (still visibly distinct from the target — Rule 16 untouched), HR
guidance, and fueling now follow as a visually quieter secondary group. *"Do not place every race
field into one enormous block"* — nothing was removed, the hierarchy just says which three facts
matter first.

## 4 · The distance discrepancy — traced, not a live bug, closed anyway

Commit `fdd5628e`. Delegated the trace (production plan row → Today's dose → the watch/Run
payload) to a research pass with read-only production access. Finding: **both `cardFromSpec`
(Today) and `build-workout.ts` (the watch/Run payload) already read the identical
`plan_workouts.distance_mi` for the same row — 6.0 mi, matching, no drift.** The reported 6.0-vs-
6.5 was two different databases being compared (production vs. an isolated QA seed from a
different verification session), not a code defect.

But the trace also found the two composers applying **different transforms** to that column —
`roundTo(_, 1)` in one, a raw `Number()` in the other — agreeing today only because the stored
value happens to already be pre-rounded. Nothing enforced that they'd keep agreeing. Fixed anyway:
`canonicalWorkoutDistanceMi()` in `lib/format/run.ts` is now the one function both call. A new
contract test (`_canonical_workout_distance.test.ts`) asserts the function's behavior and scans
both files to confirm they call it — **falsified before trusting it**: reverted one call site,
watched the liveness check fail, restored it, watched it pass again.

## 5 · Verification

- **Swift**: 211/211 passing (187 from this round's own work + 24 picked up from `main`'s
  merged week-strip/navigation work), both before and after the merge.
- **TypeScript**: clean.
- **Backend**: `_canonical_workout_distance.test.ts` (5 cases, falsified), plus the broader
  `lib/training`/`lib/watch`/`lib/format` suites — 1503/1504 passing. The one failure
  (`_durability_anchor.audit.test.ts`'s "resolves end to end" case) is a live-network audit test
  hitting real production data that timed out under parallel load; re-ran it alone and it passed
  in 7s — confirmed flaky, not a regression, and the file is untouched by this branch.
- **Device render** (isolated local substrate, this branch's own build, port 3113 — not another
  worktree's server, the mistake from round 2): five new artifacts under
  `docs/reports/pre-run-verification-2026-09-03-round3/`:

| # | Artifact | What it shows |
|---|---|---|
| 01 | `01-run-tab-hills-watch-unreachable.png` | Run tab, real hills workout: no purpose prose, no per-rep HR, Apple Watch blocked+Retry, Outdoor/Treadmill tappable |
| 02 | `02-today-tab-no-run-controls.png` | Today, same moment — zero recording/start controls anywhere on screen |
| 03 | `03-treadmill-console-canonical-workout.png` | Tapped Treadmill — same canonical workout ("Hill 1 of 10 · 1 min in 1.5 mi") reached the live console unchanged |
| 04 | `04-outdoor-console-canonical-workout.png` | Tapped Outdoor — same workout, live GPS console, real iOS location-permission prompt (first run on a fresh install) |
| 05 | `05-run-tab-fetch-failure-unstructured.png` | Workout fetch failure induced (bad host) — Retry/Retry workout/Start-unstructured tiles, scoped to Run only, Today unaffected |

Also confirmed: Block and Races tabs still render correctly after the shell restructuring; Run
tab content persists across tab switches (mounted once, not refetched per visit — same pattern as
the other three); force-quitting mid-outdoor-run cleanly abandons it (no lingering session on
relaunch, consistent with the app's own "closing the app ends it" copy).

**Not independently re-verified this round** (unchanged from round 2, still open): race-day
render on Run/Today (still no real race day reachable without touching a shared simulator's
clock), watch-reachable end-to-end (no real paired watch in this environment), a genuine
screen recording of the full flow, small-phone and Dynamic-Type states specifically for the new
tab layout.

## 6 · Duplicate-recording protection — now structural, not just decided once

Round 1/2's guarantee was "one recording owner, resolved once, before anything starts." Round 3
makes it stronger: the owner is no longer *resolved* at all in `LiveRunHostV5` — it's *named* by
which tile the runner tapped. `mode == .watch` never touches `tracker`; `mode == .outdoor` always
does. There is no code path left where reachability at console-open time changes which device
records. **Still open, same as every prior round**: no cross-device check preventing a start
directly from the watch face at the same moment as a phone start — that requires a
`WatchConnectivity`-level session check neither this file nor `RunLobbyV5` can reach.

## 7 · Integration

- Pushed to `origin/feat/pre-run-experience`. **Not merged into `main`.**
- Merged with current `origin/main` (`282745cc`) — one real conflict (`StatusBarScrimV5`, §1),
  resolved in main's favor; `project.pbxproj` regenerated via `xcodegen generate` rather than
  hand-merged, matching this branch's established pattern.
- Files touched this round: `ShellV5.swift`, `HostsV5.swift`, `RunLobbyV5.swift`,
  `RunLobbyV5Tests.swift`, `TodayBeforeV5.swift`, `lib/format/run.ts`, `lib/training/spec-card.ts`,
  `lib/watch/build-workout.ts`, plus the new `_canonical_workout_distance.test.ts`.
- No backend contract change beyond the distance fix — `WatchWorkout`'s shape is unchanged, so
  the watch app itself needs no update for this round.

## The completion test, again

*Today tells me what to do and why. Run lets me choose how to execute and record it. Both read
the same canonical workout, but neither duplicates the other's job.*

Rendered proof for the state actually verified this round (a structured hills workout, watch
unreachable): yes — Today shows purpose/structure/HR guidance and nothing about recording; Run
shows a compact confirmation and three explicit, honestly-labeled execution choices; both trace
to the identical canonical workout, proven by the same 6.0 mi / same phase structure surviving
into both the treadmill and outdoor live consoles untouched. Race day and a genuinely reachable
watch remain unverified by render — real gaps, named rather than assumed closed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
